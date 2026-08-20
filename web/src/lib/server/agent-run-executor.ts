import { getAuthSettings } from "@/lib/auth/store";
import { nanoid } from "nanoid";
import { resolveLogicalModelCandidates } from "@/lib/server/logical-model-router";
import { systemAiIdempotencyKey } from "@/lib/server/system-ai-billing";
import { getAgentRun, updateAgentRunById, type AgentRun } from "@/lib/server/agent-run-store";
import { agentPlannerInput, agentPlannerSystemPrompt, agentPlanReply, conversationFallbackReply, plannerAgentSkills, selectAgentSkills, taskPlanSummary } from "@/lib/server/agent-run-surface-policy";
import { getCreativeAssetsByIds, getCreativeConversationContext, listRecentCreativeMediaAssets } from "@/lib/server/creative-runtime-store";
import { toSafeGenerationErrorMessage } from "@/lib/server/generation-errors";
import { parseAgentPlanCall, type AgentFunctionCallResult } from "./agent-function-call";
import { agentModelOptions, agentPlanFallbackExample, agentPlanTool, canContinue, executeTasks, normalizeTasks, planToOps, refundFunctionCall, requestFunctionCall } from "./agent-run-execution";
import { isExplicitProjectHandoffRequest, normalizeAgentProjectHandoff } from "./agent-run-project-handoff";
import { normalizeCanvasPlanForSelection } from "./agent-run-task-input";
import { GenerationSubmissionUncertainError } from "@/lib/server/generation-submission-error";
import { rankTextPlanningCandidates } from "@/lib/server/text-planning-runtime";
import { filterAgentPlannerModels } from "@/lib/server/agent-run-planning-profile";
import { buildAgentWorkspaceActionRequestForRun, getAgentWorkspaceSnapshotForRun } from "./agent-workspace-actions";
import { workspaceActionRequiresConfirmation } from "@/lib/creative-workspace";
import { scheduleGenerationTask } from "./generation-task-scheduler";

const globalAgentExecutors = globalThis as typeof globalThis & { __dqAgentRunControllers?: Map<string, AbortController> };
const controllers = (globalAgentExecutors.__dqAgentRunControllers ??= new Map<string, AbortController>());

export function abortAgentRun(id: string) {
    controllers.get(id)?.abort();
}

export async function executeAgentRun(run: AgentRun, origin: string, cookie: string) {
    abortAgentRun(run.id);
    const controller = new AbortController();
    const executionId = nanoid();
    let acceptedPlan: { userId: string; model: string; call: AgentFunctionCallResult } | undefined;
    let planningPersisted = false;
    const refundAcceptedPlan = async () => {
        if (!acceptedPlan || planningPersisted) return;
        await refundFunctionCall(acceptedPlan.userId, acceptedPlan.model, acceptedPlan.call);
        acceptedPlan = undefined;
    };
    controllers.set(run.id, controller);
    try {
        const claimed = await updateAgentRunById(
            run.id,
            { status: "running", executionId, timings: { ...(run.timings || { requestAcceptedAt: run.createdAt }), ...(run.tasks.length ? {} : { planningStartedAt: Date.now() }) } },
            { type: run.tasks.length ? "run.resumed" : "run.planning" },
            ["planning", "running"],
        );
        if (!claimed) return;
        if (claimed.tasks.length) {
            const settings = await getAuthSettings();
            await executeTasks(run.id, origin, cookie, executionId, settings);
            return;
        }
        const requestedModelIds = Array.from(new Set((claimed.requestedModelIds || []).map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean)));
        const usesMemoryCandidates = claimed.surface === "chat" && claimed.referencedAssetIds.length === 0;
        const [settings, explicitAssets, conversationContext, memoryAssets] = await Promise.all([
            getAuthSettings(),
            getCreativeAssetsByIds(claimed.referencedAssetIds),
            getCreativeConversationContext(claimed.conversationId, claimed.userId, claimed.id),
            usesMemoryCandidates ? listRecentCreativeMediaAssets(claimed.conversationId, claimed.userId, 6) : Promise.resolve([]),
        ]);
        const allModels = agentModelOptions(settings);
        const requestedModels = requestedModelIds.map((id) => allModels.find((model) => model.id === id));
        if (requestedModels.some((model) => !model || model.capability === "text")) throw new Error("部分所选模型当前不可用，请重新选择");
        if (!(await canContinue(run.id, executionId))) return;
        const referencedAssets = usesMemoryCandidates ? memoryAssets : explicitAssets;
        const referenceSource = claimed.referencedAssetIds.length ? "current-turn-explicit" : usesMemoryCandidates && referencedAssets.length ? "conversation-memory-candidates" : "none";
        const trustedWorkspaceSnapshot = claimed.surface === "canvas" || claimed.surface === "design" ? await getAgentWorkspaceSnapshotForRun(claimed) : undefined;
        const planningRun = trustedWorkspaceSnapshot ? { ...claimed, snapshot: trustedWorkspaceSnapshot } : claimed;
        const availableModels = constrainPlannerModels(filterAgentPlannerModels(allModels, planningRun), allModels, requestedModelIds);
        const skillOptions = plannerAgentSkills(settings, planningRun);
        const requestedAgentModelId = typeof claimed.requestedAgentModelId === "string" ? claimed.requestedAgentModelId.trim() : "";
        const model = requestedAgentModelId || settings.defaultModels.textModel;
        const candidates = resolveLogicalModelCandidates(settings, "text", model);
        if (requestedAgentModelId && !candidates.length) throw new Error("所选智能体模型当前不可用，请重新选择");
        if (!model || !candidates.length) throw new Error("后台尚未配置可用的默认文本模型");
        const fallbackExample = agentPlanFallbackExample(availableModels);
        const planningInput = [
            {
                role: "system",
                content: agentPlannerSystemPrompt(claimed.surface, fallbackExample),
            },
            {
                role: "user",
                content: JSON.stringify(agentPlannerInput(planningRun, conversationContext!, referencedAssets, referenceSource, skillOptions, availableModels, settings)),
            },
        ];
        let plan: Awaited<ReturnType<typeof parseAgentPlanCall>> | undefined;
        let latestPlanningError: unknown;
        for (const candidate of rankTextPlanningCandidates(candidates.map((candidate) => ({ ...candidate, channelId: candidate.channel.id })))) {
            try {
                const planCall = await requestFunctionCall(
                    origin,
                    cookie,
                    candidate,
                    planningInput,
                    agentPlanTool,
                    "create_agent_plan",
                    controller.signal,
                    run.userId,
                    model,
                    false,
                    systemAiIdempotencyKey("agent-plan", run.userId, run.id, candidate.channel.id, candidate.upstreamModel),
                );
                plan = await parseAgentPlanCall(planCall, () => refundFunctionCall(claimed.userId, model, planCall), undefined, {
                    allowProjectHandoff: claimed.surface === "chat" && isExplicitProjectHandoffRequest(claimed.prompt),
                    allowWorkspaceActions: claimed.surface === "canvas" || claimed.surface === "design",
                });
                if (plan) acceptedPlan = { userId: claimed.userId, model, call: planCall };
                break;
            } catch (error) {
                if (controller.signal.aborted) throw error;
                if (error instanceof GenerationSubmissionUncertainError) throw error;
                latestPlanningError = error;
            }
        }
        if (!plan) throw latestPlanningError instanceof Error ? latestPlanningError : new Error("没有可用的文本模型渠道");
        if (claimed.surface === "canvas") plan = normalizeCanvasPlanForSelection(plan, planningRun.snapshot, claimed.prompt);
        const skills = selectAgentSkills(settings, claimed.surface, claimed.selectedSkillIds, plan.skillIds);
        await updateAgentRunById(run.id, {}, { type: "skills.selected", data: { skills: skills.map((skill) => ({ id: skill.id, name: skill.name })) } }, ["running"], executionId);
        if (!(await canContinue(run.id, executionId))) {
            await refundAcceptedPlan();
            return;
        }
        if (plan.intent === "conversation") {
            const completed = await updateAgentRunById(
                run.id,
                {
                    status: "completed",
                    snapshot: planningRun.snapshot,
                    tasks: [],
                    reviewed: true,
                    executionId: undefined,
                    timings: { ...(claimed.timings || { requestAcceptedAt: claimed.createdAt }), planningCompletedAt: Date.now(), allResultsReadyAt: Date.now(), runCompletedAt: Date.now() },
                },
                { type: "run.completed", data: { completed: 0, reply: plan.reply?.trim() || conversationFallbackReply(claimed.surface) } },
                ["running"],
                executionId,
            );
            if (!completed) {
                await refundAcceptedPlan();
                return;
            }
            planningPersisted = true;
            return;
        }
        const tasks = normalizeTasks(plan, skills, settings, planningRun.snapshot, claimed.prompt, claimed.surface, referencedAssets, claimed.requestedImageSize, requestedModelIds);
        const projectHandoff = normalizeAgentProjectHandoff(plan, claimed.surface, referencedAssets, claimed.prompt);
        const reply = agentPlanReply({ ...plan, projectHandoff }, tasks, claimed.surface);
        const workspaceActionRequest =
            (claimed.surface === "canvas" || claimed.surface === "design") && (plan.workspaceActions?.length || tasks.length)
                ? await buildAgentWorkspaceActionRequestForRun(
                      claimed,
                      plan.workspaceActions || [],
                      tasks.map((task) => ({ id: task.id, title: task.title, type: task.type })),
                      trustedWorkspaceSnapshot,
                  )
                : undefined;
        if (workspaceActionRequest) {
            const planned = await updateAgentRunById(
                run.id,
                {
                    status: "awaiting_confirmation",
                    executionId: undefined,
                    snapshot: planningRun.snapshot,
                    tasks,
                    workspaceActionRequest,
                    workspaceActionReceipt: undefined,
                    foundation: plan.foundation,
                    projectHandoff,
                    reviewed: tasks.length ? claimed.reviewed : true,
                    timings: { ...(claimed.timings || { requestAcceptedAt: claimed.createdAt }), planningCompletedAt: Date.now() },
                },
                {
                    type: "workspace.actions",
                    data: {
                        request: workspaceActionRequest,
                        requiresConfirmation: workspaceActionRequiresConfirmation(workspaceActionRequest),
                        reply,
                        tasks: tasks.map(taskPlanSummary),
                        projectHandoff,
                    },
                },
                ["running"],
                executionId,
            );
            if (!planned) {
                await refundAcceptedPlan();
                return;
            }
            planningPersisted = true;
            await scheduleGenerationTask("agent", run.id, { executionPhase: "awaiting_confirmation", nextPollAt: undefined, lastUpstreamStatus: "awaiting_confirmation" });
            return;
        }
        const event = claimed.surface === "canvas" ? { type: "canvas.ops", data: { ops: planToOps(plan, tasks, run.id, planningRun.snapshot), reply } } : { type: "run.planned", data: { reply, tasks: tasks.map(taskPlanSummary), projectHandoff } };
        const planned = await updateAgentRunById(
            run.id,
            {
                snapshot: planningRun.snapshot,
                tasks,
                foundation: plan.foundation,
                projectHandoff,
                reviewed: tasks.length ? claimed.reviewed : true,
                timings: { ...(claimed.timings || { requestAcceptedAt: claimed.createdAt }), planningCompletedAt: Date.now() },
            },
            event,
            ["running"],
            executionId,
        );
        if (!planned) {
            await refundAcceptedPlan();
            return;
        }
        planningPersisted = true;
        await executeTasks(run.id, origin, cookie, executionId, settings);
    } catch (error) {
        let failure = error;
        try {
            await refundAcceptedPlan();
        } catch (refundError) {
            console.error("Agent planning refund failed", refundError instanceof Error ? refundError.message : refundError);
            failure = refundError;
        }
        const latest = await getAgentRun(run.id);
        if (latest && !["awaiting_confirmation", "paused", "cancelled"].includes(latest.status))
            await updateAgentRunById(
                run.id,
                { status: "failed", executionId: undefined, timings: { ...(latest.timings || { requestAcceptedAt: latest.createdAt }), runCompletedAt: Date.now() } },
                { type: "run.failed", data: { message: toSafeGenerationErrorMessage(failure, "Agent 执行失败") } },
                ["planning", "running"],
                executionId,
            );
    } finally {
        if (controllers.get(run.id) === controller) controllers.delete(run.id);
    }
}

function constrainPlannerModels<T extends { id: string; capability: string }>(plannerModels: T[], allModels: T[], requestedModelIds: string[]) {
    if (!requestedModelIds.length) return plannerModels;
    const requested = new Set(requestedModelIds);
    const selectedMedia = allModels.filter((model) => requested.has(model.id) && model.capability !== "text");
    // Keep text models available for copy/script deliverables, but constrain
    // every media capability to the user's explicitly selected set.
    const textModels = plannerModels.filter((model) => model.capability === "text");
    return Array.from(new Map([...textModels, ...selectedMedia].map((model) => [model.id, model])).values());
}
