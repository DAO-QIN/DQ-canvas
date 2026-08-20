"use client";

import { Button, Modal, Select, Spin } from "antd";
import { ArrowRight, ArrowRightLeft, Check, ExternalLink, RefreshCw, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { WorkspaceHandoffReceipt, WorkspaceHandoffSurface } from "@/lib/creative-workspace";
import { executeWorkspaceHandoff, workspaceHandoffReceiptFromError } from "@/services/api/workspace-handoffs";

export type WorkspaceHandoffTargetOption = Readonly<{
    id: string;
    title: string;
    revision: number;
    surface: WorkspaceHandoffSurface;
}>;

export type WorkspaceHandoffProps = Readonly<{
    sourceSurface: WorkspaceHandoffSurface;
    sourceProjectId: string;
    sourceRevision: number;
    selectionIds: readonly string[];
    selectionLabel?: string;
    loadTargets: () => Promise<readonly WorkspaceHandoffTargetOption[]>;
    flushSource: () => Promise<void>;
    getCurrentRevision: () => number;
    onOpenTarget: (target: WorkspaceHandoffTargetOption) => void;
    disabled?: boolean;
    triggerLabel?: string;
    triggerIcon?: ReactNode;
}>;

export function canSubmitWorkspaceHandoff(selectionIds: readonly string[], target: WorkspaceHandoffTargetOption | null, view: ViewState = "ready") {
    return selectionIds.length > 0 && Boolean(target) && view !== "submitting" && view !== "loading-targets";
}

type ViewState = "idle" | "loading-targets" | "ready" | "submitting" | "result" | "error";

const STORAGE_PREFIX = "dq.workspace-handoff.v1";

export function WorkspaceHandoffDialog(props: WorkspaceHandoffProps) {
    const [open, setOpen] = useState(false);
    const [targets, setTargets] = useState<readonly WorkspaceHandoffTargetOption[]>([]);
    const [targetId, setTargetId] = useState("");
    const [view, setView] = useState<ViewState>("idle");
    const [request, setRequest] = useState<WorkspaceHandoffPersistedRequest | null>(null);
    const [receipt, setReceipt] = useState<WorkspaceHandoffReceipt | null>(null);
    const [error, setError] = useState("");
    const recoveryAttempted = useRef("");
    const selectionKey = useMemo(() => workspaceHandoffStorageKey(props.sourceSurface, props.sourceProjectId, props.selectionIds), [props.sourceProjectId, props.sourceSurface, props.selectionIds]);
    const storageKey = useMemo(() => `${STORAGE_PREFIX}.${selectionKey}`, [selectionKey]);
    const target = targets.find((item) => item.id === targetId) || null;
    const targetSurface = props.sourceSurface === "canvas" ? "design" : "canvas";
    const hasSelection = props.selectionIds.length > 0;

    const load = useCallback(async () => {
        setView("loading-targets");
        setError("");
        setReceipt(null);
        try {
            const nextTargets = (await props.loadTargets()).filter((item) => item.surface === targetSurface && item.id !== props.sourceProjectId);
            setTargets(nextTargets);
            const stored = readStoredRequest(storageKey);
            if (stored && isCompatibleStoredRequest(stored, props, nextTargets)) {
                setRequest(stored);
                setTargetId(stored.target.projectId);
                setView("ready");
            } else {
                if (stored) removeStoredRequest(storageKey);
                setRequest(null);
                setTargetId((current) => (nextTargets.some((item) => item.id === current) ? current : nextTargets[0]?.id || ""));
                setView("ready");
            }
        } catch (loadError) {
            setTargets([]);
            setView("error");
            setError(errorMessage(loadError, "目标项目加载失败"));
        }
    }, [props, storageKey, targetSurface]);

    useEffect(() => {
        if (!open) return;
        void load();
        // Parent workspace renders must not refetch the target list.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, selectionKey]);

    useEffect(() => {
        if (!open || !request || !target || view !== "ready" || recoveryAttempted.current === request.handoffId) return;
        recoveryAttempted.current = request.handoffId;
        void submit(request, target);
        // A stored request is deliberately replayed once after refresh so a
        // target write that completed before a network interruption can settle.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, request, target, view]);

    const reset = useCallback(() => {
        removeStoredRequest(storageKey);
        recoveryAttempted.current = "";
        setRequest(null);
        setReceipt(null);
        setError("");
        setView(targets.length ? "ready" : "idle");
    }, [storageKey, targets.length]);

    const submit = useCallback(
        async (existingRequest?: WorkspaceHandoffPersistedRequest, selectedTarget?: WorkspaceHandoffTargetOption | null) => {
            const destination = selectedTarget || target;
            if (!destination || !hasSelection || view === "submitting") return;
            setView("submitting");
            setError("");
            setReceipt(null);
            try {
                await props.flushSource();
                const sourceRevision = normalizeRevision(props.getCurrentRevision());
                const nextRequest = workspaceHandoffRequestForSubmission(existingRequest || request, props, destination, sourceRevision);
                if (!existingRequest && !request) {
                    writeStoredRequest(storageKey, nextRequest);
                    setRequest(nextRequest);
                }
                const nextReceipt = await executeWorkspaceHandoff(nextRequest);
                setReceipt(nextReceipt);
                setView("result");
                removeStoredRequest(storageKey);
            } catch (submitError) {
                const failedReceipt = workspaceHandoffReceiptFromError(submitError);
                if (failedReceipt) {
                    setReceipt(failedReceipt);
                    setView("result");
                    removeStoredRequest(storageKey);
                } else {
                    setView("error");
                    setError(errorMessage(submitError, "素材交接失败"));
                }
            }
        },
        [hasSelection, props, request, storageKey, target, view],
    );

    const openDialog = () => {
        setOpen(true);
        setReceipt(null);
        setError("");
    };

    const closeDialog = () => {
        if (view !== "submitting") setOpen(false);
    };

    const status = receiptStatus(receipt);
    const actionDisabled = !canSubmitWorkspaceHandoff(props.selectionIds, target, view);

    return (
        <>
            <button
                type="button"
                className="grid size-8 place-items-center rounded-lg text-inherit transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-white/10"
                aria-label={props.triggerLabel || `交接到${targetSurface === "design" ? "画板" : "画布"}`}
                title={props.triggerLabel || `交接到${targetSurface === "design" ? "画板" : "画布"}`}
                disabled={props.disabled || !hasSelection}
                onClick={openDialog}
            >
                {props.triggerIcon || <ArrowRightLeft className="size-4" />}
            </button>
            <Modal
                title={
                    <span className="flex items-center gap-2">
                        <ArrowRightLeft className="size-4" />
                        跨工作台交接
                    </span>
                }
                open={open}
                onCancel={closeDialog}
                footer={null}
                destroyOnClose={false}
                centered
                width={460}
            >
                <div className="space-y-4 pt-2">
                    <div className="rounded-lg border border-[#e4e7ec] bg-[#f7f8fa] px-3 py-2 text-xs text-[#687385] dark:border-[#303640] dark:bg-[#20242b] dark:text-[#aab2bd]">
                        当前选中 {props.selectionIds.length} 项{props.selectionLabel ? ` · ${props.selectionLabel}` : ""}，目标为 {targetSurface === "design" ? "Design 画板" : "节点画布"}。
                    </div>
                    {view === "loading-targets" ? (
                        <div className="flex min-h-24 items-center justify-center">
                            <Spin size="small" />
                        </div>
                    ) : null}
                    {view !== "loading-targets" && !targets.length && view !== "error" ? <EmptyTargets onRefresh={() => void load()} /> : null}
                    {view !== "loading-targets" && targets.length ? (
                        <label className="block space-y-2">
                            <span className="text-sm font-medium">选择目标项目</span>
                            <Select
                                className="w-full"
                                value={targetId || undefined}
                                placeholder="选择既有项目"
                                options={targets.map((item) => ({ value: item.id, label: `${item.title} · r${item.revision}` }))}
                                virtual={false}
                                onChange={setTargetId}
                                disabled={view === "submitting" || Boolean(request)}
                            />
                        </label>
                    ) : null}
                    {view === "error" && error ? <StatusBox tone="danger" icon={<TriangleAlert className="size-4" />} title={error} /> : null}
                    {view === "submitting" ? <StatusBox tone="info" icon={<Spin size="small" />} title="正在保存源项目并交接素材…" /> : null}
                    {view === "result" && receipt ? <HandoffResult receipt={receipt} onOpenTarget={() => target && props.onOpenTarget(target)} /> : null}
                    <div className="flex items-center justify-between gap-2 border-t border-[#edf0f4] pt-3 dark:border-[#303640]">
                        <div className="flex items-center gap-2">
                            <Button size="small" icon={<RefreshCw className="size-3.5" />} onClick={() => void load()} disabled={view === "submitting"}>
                                刷新项目
                            </Button>
                            {request || receipt ? (
                                <Button size="small" icon={<X className="size-3.5" />} onClick={reset} disabled={view === "submitting"}>
                                    重新选择
                                </Button>
                            ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                            <Button onClick={closeDialog} disabled={view === "submitting"}>
                                关闭
                            </Button>
                            {view !== "result" ? (
                                <Button type="primary" icon={<ArrowRight className="size-3.5" />} onClick={() => void submit(request || undefined)} disabled={actionDisabled}>
                                    {request ? "重试交接" : "开始交接"}
                                </Button>
                            ) : null}
                        </div>
                    </div>
                    {status ? (
                        <span className="sr-only" role="status">
                            {status}
                        </span>
                    ) : null}
                </div>
            </Modal>
        </>
    );
}

function HandoffResult({ receipt, onOpenTarget }: { receipt: WorkspaceHandoffReceipt; onOpenTarget: () => void }) {
    const effective = receipt.status === "replayed" ? receipt.originalStatus || "applied" : receipt.status;
    if (effective === "applied")
        return (
            <StatusBox
                tone="success"
                icon={<Check className="size-4" />}
                title={receipt.status === "replayed" ? "交接已安全重放" : "素材交接完成"}
                detail={`${receipt.targetIds.length} 项已写入目标项目`}
                action={
                    <Button size="small" icon={<ExternalLink className="size-3.5" />} onClick={onOpenTarget}>
                        打开目标项目
                    </Button>
                }
            />
        );
    return (
        <StatusBox
            tone={effective === "conflict" ? "warning" : "danger"}
            icon={<TriangleAlert className="size-4" />}
            title={receipt.error?.message || (effective === "conflict" ? "目标项目版本冲突" : "交接未应用")}
            detail="目标 Store 没有确认本次素材写入"
        />
    );
}

function StatusBox({ tone, icon, title, detail, action }: { tone: "success" | "warning" | "danger" | "info"; icon: ReactNode; title: string; detail?: string; action?: ReactNode }) {
    const colors = {
        success: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/25 dark:text-emerald-200",
        warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-200",
        danger: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/70 dark:bg-red-950/25 dark:text-red-200",
        info: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/70 dark:bg-blue-950/25 dark:text-blue-200",
    } as const;
    return (
        <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs ${colors[tone]}`} role={tone === "danger" || tone === "warning" ? "alert" : "status"}>
            <span className="mt-0.5 shrink-0">{icon}</span>
            <span className="min-w-0 flex-1">
                <strong className="block text-sm">{title}</strong>
                {detail ? <span className="mt-0.5 block opacity-75">{detail}</span> : null}
            </span>
            {action}
        </div>
    );
}

function EmptyTargets({ onRefresh }: { onRefresh: () => void }) {
    return (
        <div className="rounded-lg border border-dashed border-[#d8dde5] px-3 py-5 text-center text-xs text-[#7a8492] dark:border-[#3a414d] dark:text-[#aab2bd]">
            <p>暂无可用目标项目</p>
            <Button className="mt-3" size="small" onClick={onRefresh}>
                重新加载
            </Button>
        </div>
    );
}

export type WorkspaceHandoffPersistedRequest = Readonly<{
    handoffId: string;
    source: { surface: WorkspaceHandoffSurface; projectId: string; revision: number; selectionIds: readonly string[] };
    target: { surface: WorkspaceHandoffSurface; projectId: string; baseRevision: number };
}>;

export function workspaceHandoffStorageKey(surface: WorkspaceHandoffSurface, projectId: string, selectionIds: readonly string[]) {
    return `${surface}.${projectId}.${[...selectionIds].sort().join(",") || "empty"}`;
}

export function buildWorkspaceHandoffRequest(props: Pick<WorkspaceHandoffProps, "sourceSurface" | "sourceProjectId" | "selectionIds">, target: WorkspaceHandoffTargetOption, sourceRevision: number): WorkspaceHandoffPersistedRequest {
    return {
        handoffId: createHandoffId(),
        source: { surface: props.sourceSurface, projectId: props.sourceProjectId, revision: normalizeRevision(sourceRevision), selectionIds: [...props.selectionIds] },
        target: { surface: target.surface, projectId: target.id, baseRevision: normalizeRevision(target.revision) },
    };
}

export function workspaceHandoffRequestForSubmission(
    existingRequest: WorkspaceHandoffPersistedRequest | null,
    props: Pick<WorkspaceHandoffProps, "sourceSurface" | "sourceProjectId" | "selectionIds">,
    target: WorkspaceHandoffTargetOption,
    sourceRevision: number,
) {
    return existingRequest || buildWorkspaceHandoffRequest(props, target, sourceRevision);
}

export function isCompatibleStoredRequest(value: unknown, props: Pick<WorkspaceHandoffProps, "sourceSurface" | "sourceProjectId" | "selectionIds">, targets: readonly WorkspaceHandoffTargetOption[]): value is WorkspaceHandoffPersistedRequest {
    if (!value || typeof value !== "object") return false;
    const input = value as Partial<WorkspaceHandoffPersistedRequest>;
    return Boolean(
        input.handoffId &&
        input.source?.surface === props.sourceSurface &&
        input.source.projectId === props.sourceProjectId &&
        Array.isArray(input.source.selectionIds) &&
        workspaceHandoffStorageKey(input.source.surface, input.source.projectId, input.source.selectionIds) === workspaceHandoffStorageKey(props.sourceSurface, props.sourceProjectId, props.selectionIds) &&
        input.target?.surface === (props.sourceSurface === "canvas" ? "design" : "canvas") &&
        targets.some((target) => target.id === input.target?.projectId),
    );
}

function readStoredRequest(key: string): WorkspaceHandoffPersistedRequest | null {
    try {
        const value = JSON.parse(window.sessionStorage.getItem(key) || "null") as unknown;
        return value && typeof value === "object" ? (value as WorkspaceHandoffPersistedRequest) : null;
    } catch {
        return null;
    }
}

function writeStoredRequest(key: string, request: WorkspaceHandoffPersistedRequest) {
    try {
        window.sessionStorage.setItem(key, JSON.stringify(request));
    } catch {
        // Session storage is an enhancement; the in-memory request remains valid.
    }
}

function removeStoredRequest(key: string) {
    try {
        window.sessionStorage.removeItem(key);
    } catch {
        // Ignore storage policy failures.
    }
}

function createHandoffId() {
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `handoff-${id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80)}`;
}

function normalizeRevision(value: number) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function receiptStatus(receipt: WorkspaceHandoffReceipt | null) {
    if (!receipt) return "";
    return receipt.status === "replayed" ? `交接已重放：${receipt.originalStatus || "applied"}` : receipt.status;
}

function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}
