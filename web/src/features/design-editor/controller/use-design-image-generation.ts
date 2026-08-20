"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import { createResultSubmissionCoordinator, type CreativeWorkspaceGenerationTask, type DesignSurfaceBinding, type ResultSubmissionReceipt } from "@/lib/creative-workspace";
import { designOperationBatchFingerprint, type DesignPoint } from "@/lib/design";
import { cancelImageGenerationTask, createImageGenerationTask, isImageGenerationTaskDeferredError, waitForImageGenerationTask } from "@/services/api/image";
import { resolveDesignResource } from "@/services/api/design-resources";
import { notifyGenerationTaskCreated } from "@/hooks/use-generation-task-tray";
import { useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

import { appendDesignImageAnnotationsToPrompt } from "../model/design-image-tools";
import { decideDesignImageTaskCommit, designGenerationBinding, selectedDesignReference } from "../model/design-image-generation";
import type { DesignEditorSaveStatus, DesignEditorStore } from "../store/design-editor-store";

type DesignImageGenerationNotifier = { success: (content: string) => unknown; error: (content: string) => unknown; warning: (content: string) => unknown };

export type PendingDesignImagePlacement = Readonly<{ task: CreativeWorkspaceGenerationTask; reason: string; canPlace: boolean }>;

export function useDesignImageGeneration(input: {
    projectId: string;
    store: DesignEditorStore;
    recoveryTasks: readonly CreativeWorkspaceGenerationTask[];
    enabled: boolean;
    notify: DesignImageGenerationNotifier;
    sceneCenter: () => DesignPoint;
    refetchTasks: () => Promise<unknown>;
}) {
    const { projectId, store, recoveryTasks, enabled, notify, sceneCenter, refetchTasks } = input;
    const config = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const openImageConfig = useCallback(() => openConfigDialog(true, "image"), [openConfigDialog]);
    const saveStatus = useStore(store, (state) => state.status);
    const confirmedRevision = useStore(store, (state) => state.confirmedRevision);
    const documentRevision = useStore(store, (state) => state.project?.document.revision ?? null);
    const selectedReferenceKey = useStore(store, designSelectedReferenceKey);
    const [submitting, setSubmitting] = useState(false);
    const [selectedReference, setSelectedReference] = useState<ReferenceImage | null>(null);
    const [selectedReferenceLoading, setSelectedReferenceLoading] = useState(false);
    const [pendingPlacements, setPendingPlacements] = useState<PendingDesignImagePlacement[]>([]);
    const [committingTaskIds, setCommittingTaskIds] = useState<readonly string[]>([]);
    const coordinator = useMemo(() => createResultSubmissionCoordinator(), []);
    const announced = useRef(new Set<string>());
    const mounted = useRef(true);
    const pollControllers = useRef(new Map<string, AbortController>());

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            for (const controller of pollControllers.current.values()) controller.abort();
            pollControllers.current.clear();
        };
    }, []);

    const sourceReference = useCallback(async () => {
        const state = store.getState();
        const document = state.project?.document;
        if (!document) return null;
        const source = selectedDesignReference(document, state.selection);
        if (!source) return null;
        const resolved = await resolveDesignResource(source.version.locator, { purpose: "editor" });
        return {
            id: source.element.id,
            name: source.element.name,
            type: source.version.mimeType,
            dataUrl: resolved.url,
            previewUrl: resolved.url,
            url: resolved.url,
            width: source.version.width,
            height: source.version.height,
        } satisfies ReferenceImage;
    }, [store]);

    useEffect(() => {
        let current = true;
        if (!selectedReferenceKey) {
            setSelectedReference(null);
            setSelectedReferenceLoading(false);
            return () => {
                current = false;
            };
        }
        setSelectedReference(null);
        setSelectedReferenceLoading(true);
        void sourceReference()
            .then((reference) => {
                if (current && mounted.current) setSelectedReference(reference);
            })
            .catch(() => {
                if (current && mounted.current) setSelectedReference(null);
            })
            .finally(() => {
                if (current && mounted.current) setSelectedReferenceLoading(false);
            });
        return () => {
            current = false;
        };
    }, [selectedReferenceKey, sourceReference]);

    const runTask = useCallback(
        async (taskConfig: AiConfig, prompt: string, references: ReferenceImage[], binding: DesignSurfaceBinding, clientRequestId: string, attemptNo: number, parentTaskId?: string) => {
            const task = await createImageGenerationTask({ ...taskConfig, model: taskConfig.imageModel }, prompt, references, undefined, {
                logSource: "image-workbench",
                logTitle: prompt.slice(0, 80),
                surface: "design",
                projectId,
                clientRequestId,
                attemptNo,
                parentTaskId,
                binding,
            });
            notifyGenerationTaskCreated("design", projectId);
            const controller = new AbortController();
            pollControllers.current.get(task.id)?.abort();
            pollControllers.current.set(task.id, controller);
            void waitForImageGenerationTask({ ...taskConfig, model: taskConfig.imageModel }, task, { signal: controller.signal })
                .catch((error) => {
                    if (mounted.current && !isImageGenerationTaskDeferredError(error) && !(error instanceof DOMException && error.name === "AbortError")) notify.error(error instanceof Error ? error.message : "图片生成失败");
                })
                .finally(() => {
                    if (pollControllers.current.get(task.id) === controller) pollControllers.current.delete(task.id);
                    if (mounted.current) void refetchTasks();
                });
            return task;
        },
        [notify, projectId, refetchTasks],
    );

    const submit = useCallback(
        async (prompt: string, references: ReferenceImage[] = []) => {
            const text = prompt.trim();
            if (!text || submitting) return false;
            const state = store.getState();
            const document = state.project?.document;
            if (!document || state.status === "loading" || state.status === "not-found" || state.status === "conflict" || state.status === "error") return false;
            if (!isAiConfigReady(config, config.imageModel)) {
                openConfigDialog(true, "image");
                return false;
            }
            setSubmitting(true);
            try {
                const binding = designGenerationBinding(document, state.selection, projectId);
                const taskPrompt = binding.elementId ? appendDesignImageAnnotationsToPrompt(document, binding.elementId, text) : text;
                const selectedReference = await sourceReference();
                const allReferences = selectedReference ? [selectedReference, ...references.filter((reference) => reference.id !== selectedReference.id)] : references;
                const count = Math.max(1, Math.min(10, Math.floor(Number(config.count)) || 1));
                const groupId = clientId();
                await Promise.all(Array.from({ length: count }, (_, index) => runTask(config, taskPrompt, allReferences, binding, `design-image-${groupId}-${index + 1}-of-${count}`, 1)));
                notify.success(count === 1 ? "图片任务已创建" : `已创建 ${count} 个图片任务`);
                return true;
            } catch (error) {
                notify.error(error instanceof Error && error.message ? error.message : "图片任务创建失败");
                return false;
            } finally {
                setSubmitting(false);
            }
        },
        [config, isAiConfigReady, notify, openConfigDialog, projectId, runTask, sourceReference, store, submitting],
    );

    const retry = useCallback(
        async (task: CreativeWorkspaceGenerationTask) => {
            try {
                if (!task.prompt || task.binding?.surface !== "design") return false;
                const state = store.getState();
                const document = state.project?.document;
                if (!document) return false;
                const nextBinding = { ...task.binding, baseRevision: document.revision } satisfies DesignSurfaceBinding;
                let references: ReferenceImage[] = [];
                if (nextBinding.elementId) {
                    const source = document.elements.find((element) => element.id === nextBinding.elementId && element.kind === "image");
                    const version = source?.kind === "image" ? document.assetVersions.find((candidate) => candidate.id === source.assetVersionId) : null;
                    if (source?.kind === "image" && version) {
                        const resolved = await resolveDesignResource(version.locator, { purpose: "editor" });
                        references = [{ id: source.id, name: source.name, type: version.mimeType, dataUrl: resolved.url, previewUrl: resolved.url, url: resolved.url, width: version.width, height: version.height }];
                    }
                }
                const retryConfig = { ...config, imageModel: task.model || config.imageModel, quality: task.quality || config.quality, size: task.size || config.size };
                await runTask(retryConfig, task.prompt, references, nextBinding, task.clientRequestId || `design-image-retry-${task.id}`, Math.max(1, (task.attemptNo || 1) + 1), task.id);
                notify.success("重试任务已创建");
                return true;
            } catch (error) {
                notify.error(error instanceof Error && error.message ? error.message : "图片任务重试失败");
                return false;
            }
        },
        [config, notify, runTask, store],
    );

    const cancel = useCallback(
        async (task: CreativeWorkspaceGenerationTask) => {
            try {
                await cancelImageGenerationTask({ id: task.id });
                pollControllers.current.get(task.id)?.abort();
                pollControllers.current.delete(task.id);
                await refetchTasks();
                notify.success("图片任务已取消");
                return true;
            } catch (error) {
                notify.error(error instanceof Error && error.message ? error.message : "图片任务取消失败");
                return false;
            }
        },
        [notify, refetchTasks],
    );

    const commitTask = useCallback(
        async (task: CreativeWorkspaceGenerationTask, explicit = false) => {
            const state = store.getState();
            const document = state.project?.document;
            if (!document) return;
            const decision = decideDesignImageTaskCommit(document, task, sceneCenter(), explicit ? document.revision : undefined);
            if (decision.kind === "ignore") return;
            if (decision.kind === "pending-placement") {
                if (mounted.current) setPendingPlacements((current) => upsertPending(current, task, decision.reason, decision.canPlace !== false && state.status === "saved"));
                return;
            }
            if (decision.kind === "replayed") {
                if (isPersistedDesignDocument(state.status, state.confirmedRevision, document.revision)) {
                    if (mounted.current) setPendingPlacements((current) => current.filter((item) => item.task.id !== task.id));
                } else if (mounted.current) {
                    setPendingPlacements((current) => upsertPending(current, task, localReplayReason(state.status), false));
                }
                return;
            }
            if (state.status !== "saved") {
                if (mounted.current) setPendingPlacements((current) => upsertPending(current, task, "画板仍有未保存修改，保存完成后可放置结果", false));
                return;
            }
            const binding = task.binding;
            if (!binding || binding.surface !== "design") return;
            const request = {
                taskId: task.id,
                receiptId: `design-result-${task.id}`,
                batchId: decision.plan.batch.batchId,
                fingerprint: designOperationBatchFingerprint(decision.plan.batch),
                binding,
            } as const;
            if (mounted.current) setCommittingTaskIds((current) => (current.includes(task.id) ? current : [...current, task.id]));
            try {
                const receipt = await coordinator.submit(request, async () => {
                    const committed = await store.getState().dispatchBatchAndWait(decision.plan.batch);
                    return resultReceipt(
                        request,
                        committed.receipt.status === "replayed" ? "replayed" : committed.receipt.status === "applied" ? "applied" : committed.receipt.status === "partial" ? "partial" : committed.receipt.status === "conflict" ? "conflict" : "rejected",
                        committed.receipt.results.flatMap((result) => result.affectedIds),
                        committed.receipt.results.find((result) => result.error)?.error,
                    );
                });
                if (!mounted.current) return;
                if (receipt.status === "applied" || receipt.status === "replayed") {
                    setPendingPlacements((current) => current.filter((item) => item.task.id !== task.id));
                    if (!announced.current.has(task.id)) {
                        announced.current.add(task.id);
                        notify.success(explicit ? "生成结果已放置" : "生成结果已写入画板");
                    }
                } else setPendingPlacements((current) => upsertPending(current, task, receipt.error?.message || "生成结果等待放置", receipt.status === "conflict"));
            } catch (error) {
                if (!mounted.current) return;
                const current = store.getState();
                const localResult = current.project ? decideDesignImageTaskCommit(current.project.document, task, sceneCenter()).kind === "replayed" : false;
                setPendingPlacements((placements) => upsertPending(placements, task, error instanceof Error && error.message ? error.message : "生成结果写回失败", !localResult && current.status === "saved"));
            } finally {
                if (mounted.current) setCommittingTaskIds((current) => current.filter((id) => id !== task.id));
            }
        },
        [coordinator, notify, sceneCenter, store],
    );

    useEffect(() => {
        if (!enabled) return;
        const candidates = recoveryTasks.filter((task) => (task.type === "image" || task.type === "image_process") && task.status === "succeeded" && task.binding?.surface === "design" && task.binding.projectId === projectId);
        if (!candidates.length) return;
        let current = true;
        void (async () => {
            for (const task of candidates) {
                if (!current || !mounted.current) return;
                await commitTask(task);
            }
        })();
        return () => {
            current = false;
        };
    }, [commitTask, confirmedRevision, documentRevision, enabled, projectId, recoveryTasks, saveStatus]);

    const place = useCallback((task: CreativeWorkspaceGenerationTask) => commitTask(task, true), [commitTask]);

    return {
        config,
        updateConfig,
        submitting,
        selectedReference,
        selectedReferenceLoading,
        pendingPlacements,
        committingTaskIds,
        submit,
        retry,
        cancel,
        place,
        openImageConfig,
    };
}

export function isPersistedDesignDocument(status: DesignEditorSaveStatus, confirmedRevision: number | null, documentRevision: number) {
    return status === "saved" && confirmedRevision === documentRevision;
}

function resultReceipt(
    request: { taskId: string; receiptId: string; batchId: string; fingerprint: string; binding: DesignSurfaceBinding },
    status: ResultSubmissionReceipt["status"],
    affectedIds: string[],
    error?: { code: string; message: string } | null,
): ResultSubmissionReceipt {
    return {
        ...request,
        status,
        affectedIds,
        ...(error ? { error: { ...error, retryable: status !== "conflict" } } : status === "conflict" || status === "rejected" ? { error: { code: "DESIGN_RESULT_COMMIT_FAILED", message: "生成结果未能写入画板", retryable: false } } : {}),
    };
}

function upsertPending(current: readonly PendingDesignImagePlacement[], task: CreativeWorkspaceGenerationTask, reason: string, canPlace: boolean): PendingDesignImagePlacement[] {
    return [...current.filter((item) => item.task.id !== task.id), { task, reason, canPlace }];
}

function localReplayReason(status: DesignEditorSaveStatus) {
    if (status === "error") return "生成结果已写入本地草稿，但保存失败；请先重试保存";
    if (status === "conflict") return "生成结果仅存在于本地冲突草稿，尚未持久化";
    return "生成结果正在保存，服务端确认后将自动完成";
}

function designSelectedReferenceKey(state: ReturnType<DesignEditorStore["getState"]>) {
    const document = state.project?.document;
    if (!document) return "";
    const source = selectedDesignReference(document, state.selection);
    return source ? `${source.element.id}\0${source.version.id}` : "";
}

function clientId() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
