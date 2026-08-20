import { defineWorkspaceActionReceipt, defineWorkspaceActionRequest, workspaceActionRequestFingerprint, workspaceActionRequiresConfirmation, type WorkspaceActionReceipt, type WorkspaceActionRequest } from "./agent-contract";
import type { CreativeConversation, CreativeRunRequest } from "@/lib/creative-runtime-contract";

export type WorkspaceAgentStableStageKey = "planning" | "skills" | "plan" | "confirmation" | "executing" | "reviewing" | "finalizing" | "paused";
export type WorkspaceAgentRunStageKey = WorkspaceAgentStableStageKey | "reconnecting";
export type WorkspaceAgentRunStage = Readonly<{
    key: WorkspaceAgentRunStageKey;
    text: string;
    resumeKey?: WorkspaceAgentStableStageKey;
}>;

export type WorkspaceAgentAssistantDetail = Readonly<{
    nodeIds?: string[];
    taskType?: "text" | "image" | "video" | "audio";
    runId?: string;
    taskId?: string;
    title?: string;
}>;

export type WorkspaceAgentActionRequestEvent = Readonly<{
    request: WorkspaceActionRequest;
    requiresConfirmation: boolean;
    reply?: string;
    source: "event" | "snapshot";
}>;

export type WorkspaceAgentActionReceiptEvent<LegacyOp = unknown> = Readonly<{
    request: WorkspaceActionRequest;
    receipt: WorkspaceActionReceipt;
    message?: string;
    ops?: LegacyOp[];
    source: "event" | "snapshot";
}>;

export type WorkspaceAgentRunHandlers<LegacyOp = unknown> = {
    onLegacyPlan?: (ops: LegacyOp[], reply: string) => void;
    onAssistant: (text: string, detail?: WorkspaceAgentAssistantDetail) => void;
    onStage: (stage: WorkspaceAgentRunStage) => void;
    onPaused: (paused: boolean) => void;
    onLegacyOps?: (ops: LegacyOp[]) => void;
    onWorkspaceActionRequest?: (event: WorkspaceAgentActionRequestEvent) => void;
    onWorkspaceActionConfirmed?: (request: WorkspaceActionRequest) => void;
    onWorkspaceActionRejected?: (input: { batchId: string; fingerprint: string }) => void;
    onWorkspaceActionReceipt?: (event: WorkspaceAgentActionReceiptEvent<LegacyOp>) => void;
};

export type WorkspaceAgentRunSummary = Readonly<{
    id: string;
    conversationId?: string;
    status: "planning" | "running" | "awaiting_confirmation" | "paused" | "completed" | "failed" | "cancelled";
    workspaceActionRequest?: WorkspaceActionRequest;
    workspaceActionReceipt?: WorkspaceActionReceipt;
    tasks?: readonly Readonly<{ id?: string; title?: string; status?: string; error?: string }>[];
}>;

export type WorkspaceAgentRunControlAction = "pause" | "resume" | "cancel";

export type WorkspaceAgentRunCreateResult = Readonly<{
    run: WorkspaceAgentRunSummary;
    conversation?: CreativeConversation;
    created: boolean;
}>;

export type WorkspaceAgentRunApi = Readonly<{
    create: (input: CreativeRunRequest) => Promise<WorkspaceAgentRunCreateResult>;
    list: (input: { surface: "canvas" | "design"; projectId: string }) => Promise<WorkspaceAgentRunSummary[]>;
    control: (runId: string, action: WorkspaceAgentRunControlAction) => Promise<WorkspaceAgentRunSummary>;
    retry: (runId: string, taskId?: string) => Promise<WorkspaceAgentRunSummary>;
}>;

export type WorkspaceAgentRunController = Readonly<{
    create: (input: CreativeRunRequest | (() => CreativeRunRequest), prepareRun?: () => Promise<void>) => Promise<WorkspaceAgentRunCreateResult>;
    restore: (input: { surface: "canvas" | "design"; projectId: string }) => Promise<WorkspaceAgentRunSummary | null>;
    control: (runId: string, action: WorkspaceAgentRunControlAction) => Promise<WorkspaceAgentRunSummary>;
    retry: (runId: string, taskId?: string) => Promise<WorkspaceAgentRunSummary>;
}>;

type ApiEnvelope<T> = { code?: number; data?: T; msg?: string };

export function watchWorkspaceAgentRun<LegacyOp = unknown>(runId: string, handlers: WorkspaceAgentRunHandlers<LegacyOp>, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const stream = new EventSource(`/api/agent/runs/${encodeURIComponent(runId)}/events`);
        let appliedLegacyPlan = false;
        let connectionErrors = 0;
        let settled = false;
        let paused: boolean | undefined;
        let latestStageKey: WorkspaceAgentStableStageKey = "planning";
        let latestOutput: { nodeIds?: string[]; taskType?: "text" | "image" | "video" | "audio" } | undefined;
        const completedOutputNodeIds = new Set<string>();
        const emittedRequests = new Set<string>();
        const emittedReceipts = new Set<string>();
        const emittedRejections = new Set<string>();
        const requestsByFingerprint = new Map<string, WorkspaceActionRequest>();
        let latestFailedTask: { taskId: string; title?: string } | undefined;

        const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            stream.close();
            signal?.removeEventListener("abort", abort);
            if (error) reject(error);
            else resolve();
        };
        const abort = () => finish();
        if (signal?.aborted) {
            finish();
            return;
        }
        signal?.addEventListener("abort", abort, { once: true });
        const read = <T>(event: Event) => JSON.parse((event as MessageEvent<string>).data) as T;
        const listen = (type: string, callback: (event: Event) => void) => {
            stream.addEventListener(type, (event) => {
                if (settled) return;
                try {
                    callback(event);
                } catch (error) {
                    finish(error instanceof Error ? error : new Error("Agent 事件格式无效"));
                }
            });
        };
        const setPaused = (value: boolean) => {
            if (paused === value) return;
            paused = value;
            handlers.onPaused(value);
        };
        const reportStage = (stage: WorkspaceAgentRunStage) => {
            if (stage.key !== "reconnecting") latestStageKey = stage.key;
            handlers.onStage(stage);
        };
        const emitRequest = (requestValue: WorkspaceActionRequest, source: WorkspaceAgentActionRequestEvent["source"], reply?: string, requiresConfirmation?: boolean) => {
            const request = defineWorkspaceActionRequest(requestValue);
            const fingerprint = workspaceActionRequestFingerprint(request);
            requestsByFingerprint.set(fingerprint, request);
            const identity = `${fingerprint}:${request.confirmation?.confirmedAt || "pending"}`;
            if (emittedRequests.has(identity)) return;
            emittedRequests.add(identity);
            const confirmationRequired = requiresConfirmation ?? workspaceActionRequiresConfirmation(request);
            handlers.onWorkspaceActionRequest?.({ request, requiresConfirmation: confirmationRequired, reply, source });
            reportStage({ key: "confirmation", text: request.confirmation || !confirmationRequired ? "正在应用工作台操作" : "等待确认工作台操作" });
        };
        const emitReceipt = (requestValue: WorkspaceActionRequest, receiptValue: WorkspaceActionReceipt, source: WorkspaceAgentActionReceiptEvent<LegacyOp>["source"], message?: string, ops?: LegacyOp[]) => {
            const request = defineWorkspaceActionRequest(requestValue);
            requestsByFingerprint.set(workspaceActionRequestFingerprint(request), request);
            const receipt = defineWorkspaceActionReceipt(request, receiptValue);
            const identity = `${receipt.fingerprint}:${receipt.status}:${receipt.resultRevision}`;
            if (emittedReceipts.has(identity)) return;
            emittedReceipts.add(identity);
            handlers.onWorkspaceActionReceipt?.({ request, receipt, message, ops, source });
        };

        listen("run.planning", () => reportStage({ key: "planning", text: "正在理解需求并分析当前工作区" }));
        listen("skills.selected", () => reportStage({ key: "skills", text: "正在匹配合适的创作技能" }));
        listen("canvas.ops", (event) => {
            const payload = read<{ data?: { ops?: LegacyOp[]; reply?: string } }>(event);
            if (!appliedLegacyPlan && payload.data?.ops?.length) {
                appliedLegacyPlan = true;
                handlers.onLegacyPlan?.(payload.data.ops, payload.data.reply || "创作计划已添加到工作区，后台正在执行任务。");
            }
            reportStage({ key: "plan", text: "执行计划已生成，正在准备任务" });
        });
        listen("workspace.actions", (event) => {
            const payload = read<{ data?: { request?: WorkspaceActionRequest; requiresConfirmation?: boolean; reply?: string } }>(event);
            if (!payload.data?.request) throw new Error("Agent 工作台动作缺少 request");
            emitRequest(payload.data.request, "event", payload.data.reply, payload.data.requiresConfirmation);
        });
        listen("workspace.actions.confirmed", (event) => {
            const payload = read<{ data?: { request?: WorkspaceActionRequest } }>(event);
            if (!payload.data?.request) throw new Error("Agent 工作台确认事件缺少 request");
            const request = defineWorkspaceActionRequest(payload.data.request);
            handlers.onWorkspaceActionConfirmed?.(request);
            emitRequest(request, "event");
        });
        listen("workspace.actions.rejected", (event) => {
            const payload = read<{ data?: { batchId?: string; fingerprint?: string } }>(event);
            const batchId = payload.data?.batchId?.trim() || "";
            const fingerprint = payload.data?.fingerprint?.trim() || "";
            if (!batchId || !fingerprint) throw new Error("Agent 工作台拒绝事件无效");
            const identity = `${batchId}:${fingerprint}`;
            if (emittedRejections.has(identity)) return;
            emittedRejections.add(identity);
            handlers.onWorkspaceActionRejected?.({ batchId, fingerprint });
        });
        listen("workspace.actions.receipt", (event) => {
            const payload = read<{ data?: { receipt?: WorkspaceActionReceipt; request?: WorkspaceActionRequest; message?: string; ops?: LegacyOp[] } }>(event);
            const request = payload.data?.request;
            const receipt = payload.data?.receipt;
            if (!receipt) throw new Error("Agent 工作台回执事件缺少 receipt");
            const knownRequest = request || requestsByFingerprint.get(receipt.fingerprint);
            if (!knownRequest) throw new Error("Agent 工作台回执缺少对应 request");
            emitReceipt(knownRequest, receipt, "event", payload.data?.message, payload.data?.ops);
        });
        listen("task.running", (event) => {
            const payload = read<{ data?: { title?: string; attempts?: number; ops?: LegacyOp[] } }>(event);
            if (payload.data?.ops?.length) handlers.onLegacyOps?.(payload.data.ops);
            reportStage({ key: "executing", text: `正在执行「${payload.data?.title || "创作任务"}」${payload.data?.attempts ? `（第 ${payload.data.attempts} 次）` : ""}` });
        });
        listen("task.created", (event) => {
            const payload = read<{ data?: { ops?: LegacyOp[] } }>(event);
            if (payload.data?.ops?.length) handlers.onLegacyOps?.(payload.data.ops);
        });
        listen("task.child.completed", (event) => {
            const payload = read<{ data?: ChildTaskEventData<LegacyOp> }>(event);
            if (payload.data?.ops?.length) handlers.onLegacyOps?.(payload.data.ops);
            for (const nodeId of payload.data?.outputNodeIds || []) completedOutputNodeIds.add(nodeId);
            latestOutput = { nodeIds: Array.from(completedOutputNodeIds), taskType: payload.data?.type };
            const progress = childProgressText(payload.data);
            reportStage({ key: "executing", text: progress });
            handlers.onAssistant(progress, latestOutput);
        });
        listen("task.child.failed", (event) => {
            const payload = read<{ data?: ChildTaskEventData<LegacyOp> }>(event);
            if (payload.data?.ops?.length) handlers.onLegacyOps?.(payload.data.ops);
            const progress = childProgressText(payload.data);
            reportStage({ key: "executing", text: progress });
            handlers.onAssistant(progress, latestOutput);
        });
        listen("task.completed", (event) => {
            const payload = read<{ data?: { message?: string; title?: string; outputNodeIds?: string[]; type?: "text" | "image" | "video" | "audio"; ops?: LegacyOp[] } }>(event);
            if (payload.data?.ops?.length) handlers.onLegacyOps?.(payload.data.ops);
            latestOutput = { nodeIds: payload.data?.outputNodeIds, taskType: payload.data?.type };
            handlers.onAssistant(payload.data?.message || `「${payload.data?.title || "创作任务"}」已完成，正在继续处理。`, latestOutput);
        });
        listen("task.failed", (event) => {
            const payload = read<{ data?: { taskId?: string; title?: string; error?: string; ops?: LegacyOp[] } }>(event);
            if (payload.data?.ops?.length) handlers.onLegacyOps?.(payload.data.ops);
            if (!payload.data?.taskId) return;
            latestFailedTask = { taskId: payload.data.taskId, title: payload.data.title };
            handlers.onAssistant(`「${payload.data.title || "创作任务"}」执行失败：${payload.data.error || "生成服务暂时不可用"}`, { taskType: undefined, nodeIds: [], ...latestFailedTask, runId });
        });
        listen("task.retry.requested", (event) => {
            const payload = read<{ data?: { ops?: LegacyOp[] } }>(event);
            if (payload.data?.ops?.length) handlers.onLegacyOps?.(payload.data.ops);
        });
        listen("run.review.retry", () => reportStage({ key: "reviewing", text: "发现可优化内容，正在重新生成" }));
        listen("run.review.passed", () => reportStage({ key: "finalizing", text: "检查完成，正在整理结果" }));
        listen("run.review.unavailable", () => reportStage({ key: "finalizing", text: "正在整理已完成结果" }));
        listen("run.completed", (event) => {
            const payload = read<{ data?: { reply?: string } }>(event);
            handlers.onAssistant(payload.data?.reply || "创作计划与后台生成任务已全部完成。", latestOutput);
            finish();
        });
        listen("run.failed", (event) => {
            const payload = read<{ data?: { message?: string } }>(event);
            if (!latestFailedTask) handlers.onAssistant(payload.data?.message || "Agent 执行失败", { runId, title: "Agent 执行失败" });
            finish();
        });
        listen("run.cancelled", (event) => {
            const payload = read<{ data?: { ops?: LegacyOp[] } }>(event);
            if (payload.data?.ops?.length) handlers.onLegacyOps?.(payload.data.ops);
            handlers.onAssistant("Agent 任务已取消。");
            finish();
        });
        listen("run.paused", () => {
            setPaused(true);
            reportStage({ key: "paused", text: "任务已暂停" });
        });
        listen("run.resumed", () => {
            setPaused(false);
            reportStage({ key: "executing", text: "任务已恢复，正在继续执行" });
        });
        listen("run.snapshot", (event) => {
            const payload = read<WorkspaceAgentRunSummary>(event);
            if (payload.workspaceActionRequest) {
                if (payload.workspaceActionReceipt) emitReceipt(payload.workspaceActionRequest, payload.workspaceActionReceipt, "snapshot");
                else emitRequest(payload.workspaceActionRequest, "snapshot");
            }
            if (payload.status === "cancelled") {
                handlers.onAssistant("Agent 任务已取消。");
                finish();
            }
            if (payload.status === "completed") {
                handlers.onAssistant("Agent 任务已完成，结果已经返回。");
                finish();
            }
            if (payload.status === "failed") {
                const failed = payload.tasks?.find((task) => task.status === "failed" && task.id);
                if (!latestFailedTask && failed?.id) handlers.onAssistant(`「${failed.title || "创作任务"}」执行失败：${failed.error || "生成服务暂时不可用"}`, { runId, taskId: failed.id, title: failed.title || "创作任务失败" });
                else if (!latestFailedTask) handlers.onAssistant("Agent 执行失败", { runId, title: "Agent 执行失败" });
                finish();
            }
            if (payload.status === "paused") setPaused(true);
            if (payload.status === "planning" || payload.status === "running" || payload.status === "awaiting_confirmation") setPaused(false);
        });
        stream.onopen = () => {
            connectionErrors = 0;
        };
        stream.onerror = () => {
            if (settled) return;
            connectionErrors += 1;
            if (connectionErrors >= 5) finish(new Error("Agent 事件连接多次重试后仍无法恢复"));
            else reportStage({ key: "reconnecting", resumeKey: latestStageKey, text: `连接暂时中断，正在进行第 ${connectionErrors} 次自动恢复` });
        };
    });
}

export async function listWorkspaceAgentRuns(input: { surface: "canvas" | "design"; projectId: string }) {
    const query = new URLSearchParams({ surface: input.surface, projectId: input.projectId });
    const data = await workspaceAgentRequest<{ runs: WorkspaceAgentRunSummary[] }>(`/api/agent/runs?${query}`, { cache: "no-store" });
    return data.runs;
}

export function createWorkspaceAgentRun(input: CreativeRunRequest) {
    return workspaceAgentRequest<WorkspaceAgentRunCreateResult>("/api/agent/runs", jsonPost(input));
}

export function controlWorkspaceAgentRun(runId: string, action: WorkspaceAgentRunControlAction) {
    return workspaceAgentRequest<{ run: WorkspaceAgentRunSummary }>(workspaceRunUrl(runId, action), { method: "POST" }).then((data) => data.run);
}

export function retryWorkspaceAgentRun(runId: string, taskId?: string) {
    const url = taskId ? `${workspaceRunUrl(runId, "tasks")}/${encodeURIComponent(taskId)}/retry` : workspaceRunUrl(runId, "retry");
    return workspaceAgentRequest<{ run: WorkspaceAgentRunSummary }>(url, { method: "POST" }).then((data) => data.run);
}

export function restorableWorkspaceAgentRun(runs: readonly WorkspaceAgentRunSummary[]) {
    return runs.find((run) => run.status === "planning" || run.status === "running" || run.status === "paused" || run.status === "awaiting_confirmation") || null;
}

const defaultRunApi: WorkspaceAgentRunApi = {
    create: createWorkspaceAgentRun,
    list: listWorkspaceAgentRuns,
    control: controlWorkspaceAgentRun,
    retry: retryWorkspaceAgentRun,
};

export function createWorkspaceAgentRunController(api: WorkspaceAgentRunApi = defaultRunApi): WorkspaceAgentRunController {
    return {
        create: async (input, prepareRun) => {
            await prepareRun?.();
            return api.create(typeof input === "function" ? input() : input);
        },
        restore: async (input) => restorableWorkspaceAgentRun(await api.list(input)),
        control: (runId, action) => api.control(runId, action),
        retry: (runId, taskId) => api.retry(runId, taskId),
    };
}

export function confirmWorkspaceAgentRunActions(runId: string, fingerprint: string) {
    return workspaceAgentRequest<{ run: WorkspaceAgentRunSummary; request: WorkspaceActionRequest }>(workspaceActionUrl(runId, "confirm"), jsonPost({ fingerprint }));
}

export function rejectWorkspaceAgentRunActions(runId: string, fingerprint: string) {
    return workspaceAgentRequest<{ run: WorkspaceAgentRunSummary }>(workspaceActionUrl(runId, "reject"), jsonPost({ fingerprint }));
}

export function submitWorkspaceAgentRunReceipt(runId: string, receipt: WorkspaceActionReceipt) {
    return workspaceAgentRequest<{ run: WorkspaceAgentRunSummary; replayed: boolean }>(workspaceActionUrl(runId, "receipt"), jsonPost({ receipt }));
}

function workspaceActionUrl(runId: string, action: "confirm" | "reject" | "receipt") {
    return `/api/agent/runs/${encodeURIComponent(runId)}/workspace/${action}`;
}

function workspaceRunUrl(runId: string, action: string) {
    return `/api/agent/runs/${encodeURIComponent(runId)}/${action}`;
}

function jsonPost(body: unknown): RequestInit {
    return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function workspaceAgentRequest<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
    if (!response.ok || !payload.data) {
        const error = new Error(payload.msg || "Agent 工作台请求失败") as Error & { status?: number };
        error.status = response.status;
        throw error;
    }
    return payload.data;
}

type ChildTaskEventData<LegacyOp> = {
    title?: string;
    type?: "text" | "image" | "video" | "audio";
    completedCount?: number;
    failedCount?: number;
    totalCount?: number;
    outputNodeIds?: string[];
    ops?: LegacyOp[];
};

function childProgressText(data?: ChildTaskEventData<unknown>) {
    const completed = nonNegativeCount(data?.completedCount);
    const failed = nonNegativeCount(data?.failedCount);
    const total = Math.max(1, nonNegativeCount(data?.totalCount));
    return `「${data?.title || "创作任务"}」已完成 ${completed}/${total}${failed ? `，失败 ${failed}` : ""}`;
}

function nonNegativeCount(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}
