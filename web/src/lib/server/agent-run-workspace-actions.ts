import {
    assertWorkspaceActionAuthorized,
    confirmWorkspaceActionRequest,
    defineWorkspaceActionReceipt,
    defineWorkspaceActionRequest,
    workspaceActionRequestFingerprint,
    workspaceActionRequiresConfirmation,
    type WorkspaceActionReceipt,
} from "@/lib/creative-workspace";
import { canvasProjectRevision } from "@/lib/canvas-project-receipt";
import { mutateCreativeRun } from "./creative-runtime-store";
import { getCanvasProjectForUser } from "./canvas-project-service";
import { getDesignProjectForUser } from "./design-project-service";
import { planToOps } from "./agent-run-canvas-ops";
import { AGENT_RUN_TTL_MS, getAgentRun, type AgentRun, type AgentRunTask } from "./agent-run-store";
import type { AgentPlan } from "./agent-run-validation";

export class AgentWorkspaceActionTransitionError extends Error {
    constructor(
        message: string,
        readonly status = 409,
    ) {
        super(message);
        this.name = "AgentWorkspaceActionTransitionError";
    }
}

export async function confirmAgentWorkspaceActions(input: { runId: string; userId: string; fingerprint: string; confirmedAt?: string }) {
    const fingerprint = requiredFingerprint(input.fingerprint);
    const confirmedAt = input.confirmedAt || new Date().toISOString();
    return mutateCreativeRun<AgentRun>(
        input.runId,
        AGENT_RUN_TTL_MS,
        (current) => {
            assertOwner(current, input.userId);
            const request = pendingRequest(current);
            assertFingerprint(request, fingerprint);
            const confirmed = confirmWorkspaceActionRequest(request, confirmedAt);
            if (request.confirmation) return { run: current };
            return {
                run: { ...current, workspaceActionRequest: confirmed },
                event: { type: "workspace.actions.confirmed", data: { request: confirmed } },
            };
        },
        ["awaiting_confirmation"],
    );
}

export async function rejectAgentWorkspaceActions(input: { runId: string; userId: string; fingerprint: string }) {
    const fingerprint = requiredFingerprint(input.fingerprint);
    return mutateCreativeRun<AgentRun>(
        input.runId,
        AGENT_RUN_TTL_MS,
        (current) => {
            assertOwner(current, input.userId);
            const request = pendingRequest(current);
            assertFingerprint(request, fingerprint);
            return {
                run: { ...current, status: "cancelled", executionId: undefined, tasks: cancelPlannedTasks(current.tasks) },
                event: { type: "workspace.actions.rejected", data: { batchId: request.batchId, fingerprint } },
                assistant: { status: "cancelled", content: "已取消这组工作台操作，未继续生成。" },
            };
        },
        ["awaiting_confirmation"],
    );
}

export async function submitAgentWorkspaceActionReceipt(input: { runId: string; userId: string; receipt: unknown }) {
    const current = await readCurrentRun(input.runId, input.userId);
    const request = pendingRequest(current);
    if (workspaceActionRequiresConfirmation(request)) assertWorkspaceActionAuthorized(request);
    const receipt = defineWorkspaceActionReceipt(request, input.receipt as WorkspaceActionReceipt);
    if (current.workspaceActionReceipt) {
        if (JSON.stringify(current.workspaceActionReceipt) !== JSON.stringify(receipt)) throw new AgentWorkspaceActionTransitionError("当前批次已提交不同回执");
        return { run: current, replayed: true } as const;
    }
    await assertReceiptProjectRevision(current, receipt);

    const successful = receipt.status === "applied" || receipt.status === "replayed";
    const updated = await mutateCreativeRun<AgentRun>(
        input.runId,
        AGENT_RUN_TTL_MS,
        (latest) => {
            assertOwner(latest, input.userId);
            const latestRequest = pendingRequest(latest);
            if (workspaceActionRequestFingerprint(latestRequest) !== receipt.fingerprint) throw new AgentWorkspaceActionTransitionError("工作台操作已变化，请刷新后重试");
            if (workspaceActionRequiresConfirmation(latestRequest)) assertWorkspaceActionAuthorized(latestRequest);
            const normalized = defineWorkspaceActionReceipt(latestRequest, receipt);
            if (latest.workspaceActionReceipt) {
                if (JSON.stringify(latest.workspaceActionReceipt) !== JSON.stringify(normalized)) throw new AgentWorkspaceActionTransitionError("当前批次已提交不同回执");
                return { run: latest };
            }
            const hasTasks = successful && latest.tasks.length > 0;
            const status = successful ? (hasTasks ? "running" : "completed") : "failed";
            const message = successful ? (hasTasks ? "工作台操作已应用，开始执行生成任务。" : "工作台操作已完成。") : normalized.error?.message || "工作台操作未完整应用，已停止后续生成。";
            const ops = successful && hasTasks && latest.surface === "canvas" ? canvasPlanOps(latest) : undefined;
            return {
                run: {
                    ...latest,
                    status,
                    executionId: undefined,
                    workspaceActionReceipt: normalized,
                    tasks: successful ? latest.tasks : cancelPlannedTasks(latest.tasks),
                    timings: status === "completed" || status === "failed" ? { ...(latest.timings || { requestAcceptedAt: latest.createdAt }), runCompletedAt: Date.now() } : latest.timings,
                },
                event: { type: "workspace.actions.receipt", data: { receipt: normalized, message, ...(ops?.length ? { ops } : {}) } },
                ...(status === "completed"
                    ? { assistant: { status: "completed" as const, content: message, metadata: { assetIds: latest.assetIds, taskIds: [] } } }
                    : status === "failed"
                      ? { assistant: { status: "failed" as const, content: message } }
                      : {}),
            };
        },
        ["awaiting_confirmation"],
    );
    if (updated) return { run: updated, replayed: false } as const;
    const raced = await readCurrentRun(input.runId, input.userId);
    if (raced.workspaceActionReceipt && JSON.stringify(raced.workspaceActionReceipt) === JSON.stringify(receipt)) return { run: raced, replayed: true } as const;
    throw new AgentWorkspaceActionTransitionError("Agent 状态已变化，请刷新后重试");
}

async function readCurrentRun(runId: string, userId: string) {
    const run = await getAgentRun(runId);
    if (!run || run.userId !== userId) throw new AgentWorkspaceActionTransitionError("Agent 任务不存在", 404);
    if (run.status !== "awaiting_confirmation") {
        if (run.workspaceActionReceipt) return run;
        throw new AgentWorkspaceActionTransitionError("Agent 任务不在等待工作台操作回执");
    }
    return run;
}

function pendingRequest(run: AgentRun) {
    if (!run.workspaceActionRequest) throw new AgentWorkspaceActionTransitionError("Agent 任务没有待处理的工作台操作");
    return defineWorkspaceActionRequest(run.workspaceActionRequest);
}

function assertOwner(run: AgentRun, userId: string) {
    if (run.userId !== userId) throw new AgentWorkspaceActionTransitionError("Agent 任务不存在", 404);
}

function requiredFingerprint(value: unknown) {
    if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value.trim())) throw new AgentWorkspaceActionTransitionError("工作台操作 fingerprint 无效", 400);
    return value.trim();
}

function assertFingerprint(request: ReturnType<typeof defineWorkspaceActionRequest>, fingerprint: string) {
    if (workspaceActionRequestFingerprint(request) !== fingerprint) throw new AgentWorkspaceActionTransitionError("工作台操作已变化，请刷新后重试");
}

function cancelPlannedTasks(tasks: AgentRunTask[]) {
    return tasks.map((task): AgentRunTask => (task.status === "ready" || task.status === "running" ? { ...task, status: "cancelled", error: "工作台操作未获授权" } : task));
}

async function assertReceiptProjectRevision(run: AgentRun, receipt: WorkspaceActionReceipt) {
    const request = pendingRequest(run);
    const documentWrite = request.actions.some((action) => action.effect === "write" && action.command !== "generation.authorize");
    if (receipt.status !== "applied" && receipt.status !== "replayed" && receipt.status !== "partial") return;
    const currentRevision = await currentProjectRevision(run);
    if (!documentWrite) {
        if (receipt.resultRevision !== request.baseRevision) throw new AgentWorkspaceActionTransitionError("控制或只读操作不得改变项目 revision", 400);
        if (currentRevision !== request.baseRevision) throw new AgentWorkspaceActionTransitionError(`工作台项目 revision 已变化：期望 ${request.baseRevision}，当前 ${currentRevision}`);
        return;
    }
    if (currentRevision !== receipt.resultRevision) throw new AgentWorkspaceActionTransitionError(`工作台回执 revision ${receipt.resultRevision} 与当前项目 ${currentRevision} 不一致`);
    if (receipt.resultRevision <= request.baseRevision) throw new AgentWorkspaceActionTransitionError("写操作回执没有推进项目 revision", 400);
}

async function currentProjectRevision(run: AgentRun) {
    if (!run.projectId) throw new AgentWorkspaceActionTransitionError("Agent 任务缺少项目标识");
    try {
        if (run.surface === "canvas") return canvasProjectRevision(await getCanvasProjectForUser(run.userId, run.projectId));
        if (run.surface === "design") return (await getDesignProjectForUser(run.userId, run.projectId)).revision;
    } catch {
        throw new AgentWorkspaceActionTransitionError("当前工作台项目无法验证");
    }
    throw new AgentWorkspaceActionTransitionError("当前入口不支持工作台回执", 400);
}

function canvasPlanOps(run: AgentRun) {
    if (!run.foundation) throw new AgentWorkspaceActionTransitionError("Canvas 生成计划缺少创作基础");
    const plan: AgentPlan = {
        intent: "generation",
        objective: run.prompt,
        foundation: run.foundation,
        deliverables: run.tasks.map((task) => ({
            id: task.id,
            targetNodeId: task.targetNodeId,
            title: task.title,
            type: task.type,
            model: task.model,
            prompt: task.prompt,
            count: task.count,
            ratio: task.ratio,
            quality: task.quality,
            seconds: task.seconds,
            voice: task.voice,
            format: task.format,
            dependencies: task.dependencies,
        })),
    };
    return planToOps(plan, run.tasks, run.id, run.snapshot);
}
