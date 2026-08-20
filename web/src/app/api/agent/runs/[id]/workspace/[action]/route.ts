import { after, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { readJsonBodyResult } from "@/lib/auth/request";
import { getAuthSettings } from "@/lib/auth/store";
import { confirmAgentWorkspaceActions, rejectAgentWorkspaceActions, submitAgentWorkspaceActionReceipt, AgentWorkspaceActionTransitionError } from "@/lib/server/agent-run-workspace-actions";
import { runGenerationTaskRecoveryBatch } from "@/lib/server/generation-task-recovery-service";
import { scheduleGenerationTask } from "@/lib/server/generation-task-scheduler";
import { withGenerationConcurrencyLimit } from "@/lib/server/generation-task-store";
import { resolveInternalOrigin } from "@/lib/server/internal-origin";
import { getAgentRun } from "@/lib/server/agent-run-store";
import { WorkspaceAgentContractError } from "@/lib/creative-workspace";

const ACTIONS = new Set(["confirm", "reject", "receipt"]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    const { id, action } = await params;
    if (!ACTIONS.has(action)) return NextResponse.json({ code: 400, data: null, msg: "不支持的工作台操作" }, { status: 400 });
    const body = await readJsonBodyResult<Record<string, unknown>>(request, 512 * 1024);
    if (!body.ok) return NextResponse.json({ code: body.status, data: null, msg: body.message }, { status: body.status });
    try {
        if (action === "confirm") {
            const run = await confirmAgentWorkspaceActions({ runId: id, userId: user.id, fingerprint: String(body.data.fingerprint || "") });
            if (!run) throw new AgentWorkspaceActionTransitionError("Agent 状态已变化，请刷新后重试");
            return NextResponse.json({ code: 0, data: { run, request: run.workspaceActionRequest }, msg: "工作台操作已确认" });
        }
        if (action === "reject") {
            const run = await rejectAgentWorkspaceActions({ runId: id, userId: user.id, fingerprint: String(body.data.fingerprint || "") });
            if (!run) throw new AgentWorkspaceActionTransitionError("Agent 状态已变化，请刷新后重试");
            await scheduleGenerationTask("agent", run.id, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "workspace_rejected" });
            return NextResponse.json({ code: 0, data: { run }, msg: "已拒绝工作台操作" });
        }

        const existing = await getAgentRun(id);
        if (!existing || existing.userId !== user.id) throw new AgentWorkspaceActionTransitionError("Agent 任务不存在", 404);
        const requestedReceiptStatus = body.data.receipt && typeof body.data.receipt === "object" ? String((body.data.receipt as Record<string, unknown>).status || "") : "";
        const requiresGenerationSlot = !existing.workspaceActionReceipt && existing.tasks.length > 0 && (requestedReceiptStatus === "applied" || requestedReceiptStatus === "replayed");
        const transition = () => submitAgentWorkspaceActionReceipt({ runId: id, userId: user.id, receipt: body.data.receipt });
        const settings = requiresGenerationSlot ? await getAuthSettings() : null;
        const result = settings ? await withGenerationConcurrencyLimit(user.id, "agent", 10 * 60 * 1000, settings.generationConcurrency.agent, transition) : await transition();
        if (result === null) return NextResponse.json({ code: 429, data: null, msg: `当前最多同时运行 ${settings!.generationConcurrency.agent} 个 Agent 任务` }, { status: 429 });
        const { run, replayed } = result;
        if (!replayed && run.status === "running") {
            const origin = resolveInternalOrigin(new URL(request.url).origin);
            const cookie = request.headers.get("cookie") || "";
            await scheduleGenerationTask("agent", run.id, { executionPhase: "created", nextPollAt: Date.now(), lastUpstreamStatus: "workspace_receipt_applied" });
            after(() => runGenerationTaskRecoveryBatch({ origin, cookie, limit: 1, taskIds: [run.id] }));
        } else if (!replayed) {
            await scheduleGenerationTask("agent", run.id, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: run.status });
        }
        return NextResponse.json({ code: 0, data: { run, replayed }, msg: replayed ? "工作台回执已处理" : run.status === "running" ? "工作台操作已应用，开始生成" : "工作台操作已处理" });
    } catch (error) {
        if (error instanceof AgentWorkspaceActionTransitionError) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        if (error instanceof WorkspaceAgentContractError) return NextResponse.json({ code: 400, data: null, msg: error.message }, { status: 400 });
        throw error;
    }
}
