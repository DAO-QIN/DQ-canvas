import type { AuthSettings } from "@/lib/auth/store";
import type { CreativeAsset, CreativeConversationContext, CreativeSurface } from "@/lib/creative-runtime-contract";
import type { AgentRun, AgentRunTask } from "@/lib/server/agent-run-store";
import type { AgentPlan } from "@/lib/server/agent-run-validation";
import { resolveAgentPlanningProfile } from "@/lib/server/agent-run-planning-profile";
import { agentCanvasSnapshotNodes, agentCanvasSnapshotRelations, selectedCanvasNodeIds } from "./agent-canvas-snapshot";

export { selectedCanvasNodeIds } from "./agent-canvas-snapshot";

export function availableAgentSkills(settings: AuthSettings, surface: CreativeSurface) {
    const workspaces = surface === "canvas" ? new Set(["canvas"]) : surface === "design" ? new Set(["design"]) : surface === "drama" ? new Set(["drama"]) : new Set(["image", "video", "drama"]);
    return settings.agentSkills.filter((skill) => skill.enabled && (skill.workspaces || ["image"]).some((workspace) => workspaces.has(workspace)));
}

export function selectAgentSkills(settings: AuthSettings, surface: CreativeSurface, requestedSkillIds: string[] = [], plannedSkillIds: string[] = []) {
    const available = availableAgentSkills(settings, surface);
    const requested = new Set(requestedSkillIds.map((id) => id.trim()).filter(Boolean));
    const planned = new Set(plannedSkillIds.map((id) => id.trim()).filter(Boolean));
    const selected = requested.size ? requested : planned;
    return available.filter((skill) => selected.has(skill.id)).slice(0, 6);
}

export function plannerAgentSkills(settings: AuthSettings, run: Pick<AgentRun, "surface" | "prompt" | "snapshot" | "selectedSkillIds">) {
    const available = availableAgentSkills(settings, run.surface);
    const requested = new Set((run.selectedSkillIds || []).map((id) => id.trim()).filter(Boolean));
    const profile = resolveAgentPlanningProfile(run);
    const scoped = available.filter((skill) => (skill.workspaces || ["image"]).some((workspace) => profile.skillWorkspaces.has(workspace)));
    const matched = scoped.filter((skill) => skill.keywords.some((keyword) => keyword.trim() && run.prompt.toLowerCase().includes(keyword.trim().toLowerCase())));
    const ordered = [...available.filter((skill) => requested.has(skill.id)), ...matched, ...scoped];
    return Array.from(new Map(ordered.map((skill) => [skill.id, skill])).values()).slice(0, 8);
}

export function agentPlannerSystemPrompt(surface: CreativeSurface, fallbackExample: string) {
    const identity =
        surface === "canvas"
            ? "你是 DQ-绘图 画布创作 Agent，也能进行普通对话。"
            : surface === "design"
              ? "你是 DQ-绘图 画板创作 Agent，负责读取和编辑当前排版画板，也能进行普通对话。"
              : surface === "drama"
                ? "你是 DQ-绘图 短剧项目创作 Agent，负责围绕当前项目规划文本、图片、视频和音频产物，也能进行普通对话。"
                : "你是 DQ-绘图 统一创作 Agent，负责通过一个对话入口规划并生成文本、图片、视频和音频产物，也能进行普通对话。";
    const surfaceRules =
        surface === "canvas"
            ? "明确要求创建、修改、删除、移动、连接画布节点，或生成媒体产物时为 generation。对当前画布的读取、选择、视口、创建、更新、排列、删除和连接意图写入 workspaceActions；只填写 command、用户可理解的 label、快照中真实存在的 targetIds 和命令参数，不得生成 actionId、batchId、surface、projectId、revision、effect、kind 或 confirmation。用户要求修改已有画布产物时必须填写该节点真实 targetNodeId。选中文本/提示词节点并要求修改、优化或改写时，只规划一个 type=text 的原位编辑任务，targetNodeId 必须是该文本节点；除非用户同时明确要求生成媒体，否则禁止规划图片、视频或音频任务。canvasSnapshot.selectedNodeIds 是用户本轮明确选中并展示在输入框中的附件：非空时，当前编辑任务必须优先且只能从这些节点选择 targetNodeId，禁止被 conversationContext 的上一张、旧主体或其他未选中画布节点覆盖；只有本轮没有选中节点时，才允许结合会话记忆选择旧节点。"
            : surface === "design"
              ? "明确要求生成媒体或读取、创建、更新、排列、删除当前画板内容时为 generation。对当前画板内容的操作意图写入 workspaceActions；只填写 command、用户可理解的 label、快照中真实存在的 targetIds 和命令参数，不得生成 actionId、batchId、surface、projectId、revision、effect、kind 或 confirmation。媒体生成本身写入 deliverables，生成结果由服务端通过 Design binding 原子写回，禁止使用 generation.run 伪造 Design 操作。"
              : "明确要求生成或修改文本、图片、视频、音频产物时为 generation。禁止填写 workspaceActions，禁止创建、更新、删除或连接任何 Canvas/Design 内容，targetNodeId 必须省略。";
    const projectRule =
        surface === "drama" ? "短剧项目中的角色、场景、多镜头和依赖生产默认是 complex，并保持项目视觉与叙事一致。" : surface === "canvas" ? "Canvas 的品牌系列、多物料和依赖生产默认是 complex。" : "多物料、系列内容和依赖生产默认是 complex。";
    const handoffRule =
        surface === "chat"
            ? "只有用户原文明确要求创建、建立或整理成画布/短剧项目时才填写 projectHandoff；生成短视频、短片、图片或系列媒体不等于创建项目，必须省略 projectHandoff。只做明确项目交接且无需新产物时允许 deliverables=[]。projectHandoff.assetIds 只能引用 referencedAssets，当前 Run 新生成的资产会由服务端自动合并。"
            : "当前入口不得填写 projectHandoff。";
    return `${identity}先结合 conversationContext 的长期摘要和近期消息理解用户的自然语言、指代和连续创作关系，再判断 intent：问候、闲聊、能力咨询、使用说明和知识问答为 conversation；${surfaceRules}conversation 必须 workspaceActions=[]、deliverables=[]、decisions=[]，直接在 reply 回答。generation 可以只包含 workspaceActions，也可以同时包含 workspaceActions 和 deliverables；必须先形成 foundation：brief 说明目标、受众、使用场景、核心信息、约束和参考素材策略；direction 给出一个明确推荐的风格、构图/镜头、色彩、光线、视觉关键词和避免事项。${projectRule}${handoffRule}requestedSkillIds 非空时必须使用且只使用这些技能；否则根据完整需求语义从 availableSkills 主动选择真正适用的技能，可不选，禁止仅凭单个关键词强行命中，最终选择写入 skillIds。referenceContext.source=current-turn-explicit 表示 referencedAssets 是本轮用户明确附件，必须优先且排他；source=conversation-memory-candidates 表示它们只是同会话最近成功媒体候选，只有自然语义明确延续、修改、变体或保持上一轮主体/场景时，才把确需使用的资产 ID 写入 deliverable.assetIds，新主题、独立创作或无法确认时不得引用。随后规划整套 deliverables 和依赖顺序，并主动从 availableModels 中为每个产物选择能力匹配的逻辑模型，决定画幅、质量、数量、时长、音色或格式。只能引用 referencedAssets 中存在的资产 ID；需要使用一个或多个资产时，将它们写入对应 deliverable.assetIds。若 requestedModelIds 非空，它们是用户手动锁定的媒体模型，相关类型的 deliverable 必须使用这些模型之一；Agent 仍须负责完整规划和编排。每个 deliverable 的 prompt 必须执行同一 foundation，保持主体、信息、色彩和视觉语言一致。不要盲目照抄默认值，默认值只在没有更明确判断时作为兜底。严格遵守 planningBudget.maxOutputTokens，优先保留可执行参数并压缩解释。reply 用自然中文概括推荐方向；decisions 用 2–6 项说明“选择了什么、为什么”；每个 deliverable 必须填写 model。优先调用 create_agent_plan；若渠道不支持工具调用，必须直接返回与函数参数完全一致的单个 JSON 对象，不要 Markdown 或额外文本，严格仿照这个完整结构：${fallbackExample}。不得暴露隐藏思维链，只输出可验证的决策摘要。`;
}

export function agentPlannerInput(
    run: AgentRun,
    conversationContext: CreativeConversationContext,
    referencedAssets: CreativeAsset[],
    referenceSource: "current-turn-explicit" | "conversation-memory-candidates" | "none",
    availableSkills: AuthSettings["agentSkills"],
    availableModels: Array<{ id: string; name: string; capability: string }>,
    settings: AuthSettings,
) {
    const planningProfile = resolveAgentPlanningProfile(run);
    const selectedNodeIds = run.surface === "canvas" ? selectedCanvasNodeIds(run.snapshot) : [];
    const recentMessages = conversationContext.recentMessages.slice(-6);
    const payload = {
        requirement: run.prompt.slice(0, 12_000),
        conversationContext: {
            summary: conversationContext.summary.slice(0, 3000),
            recentMessages: recentMessages.map((item) => ({ role: item.role, content: item.content.slice(0, 800), sequence: item.sequence })),
        },
        surface: run.surface,
        ...(run.projectId ? { projectId: run.projectId } : {}),
        ...(run.surface === "canvas"
            ? { canvasSnapshot: compactCanvasSnapshot(run.snapshot) }
            : run.surface === "design"
              ? { designSnapshot: compactDesignSnapshot(run.snapshot) }
              : run.surface === "drama"
                ? { projectSnapshot: compactProjectSnapshot(run.snapshot) }
                : {}),
        ...(selectedNodeIds.length ? { currentTurnSelection: { selectedNodeIds, rule: "这些节点是本轮明确附件；编辑任务不得改用历史节点" } } : {}),
        referenceContext: { source: referenceSource },
        referencedAssets: referencedAssets.slice(-6).map(plannerAssetSummary),
        requestedSkillIds: run.selectedSkillIds || [],
        requestedModelIds: run.requestedModelIds || [],
        availableSkills: availableSkills.slice(0, 20).map(plannerSkillSummary),
        availableModels: availableModels.slice(0, 40),
        defaultModels: settings.defaultModels,
        generationDefaults: settings.generationDefaults,
        planningBudget: { complexity: planningProfile.complexity, maxOutputTokens: planningProfile.maxOutputTokens },
    };
    return fitPlannerInput(payload, planningProfile.maxInputChars);
}

function plannerSkillSummary(skill: AuthSettings["agentSkills"][number]) {
    return {
        id: skill.id,
        name: skill.name,
        plannerSummary: (skill.plannerSummary || skill.description || skill.instructions).slice(0, 240),
        workspaces: skill.workspaces || ["image"],
    };
}

export function compactCanvasSnapshot(snapshot: unknown) {
    const source = record(snapshot);
    const selectedNodeIds = selectedCanvasNodeIds(snapshot);
    const selected = new Set(selectedNodeIds);
    const connections = agentCanvasSnapshotRelations(snapshot).filter((connection) => {
        const from = connection.fromNodeId;
        const to = connection.toNodeId;
        return selected.has(from) || selected.has(to);
    });
    for (const connection of connections) {
        selected.add(connection.fromNodeId);
        selected.add(connection.toNodeId);
    }
    const nodes = agentCanvasSnapshotNodes(snapshot)
        .filter((node) => selected.has(node.id) || node.type === "config")
        .slice(0, 20)
        .map((node) => ({
            id: node.id,
            type: node.type,
            title: node.title.slice(0, 160),
            width: node.width,
            height: node.height,
            locked: node.locked,
            hidden: node.hidden,
            ...(node.resource ? { resource: node.resource } : {}),
            metadata: {
                size: node.size,
                content: node.content?.slice(0, 600),
                naturalWidth: node.width,
                naturalHeight: node.height,
            },
        }));
    const configuredSize = nodes.find((node) => node.type === "config")?.metadata.size;
    return {
        schemaVersion: source.schemaVersion === 1 ? 1 : undefined,
        surface: source.surface === "canvas" ? "canvas" : undefined,
        projectId: text(source.projectId),
        title: text(source.title).slice(0, 160),
        revision: nonNegativeInteger(source.revision),
        imageSize: text(source.imageSize).slice(0, 40) || configuredSize,
        selectedNodeIds,
        nodes,
        connections: connections.slice(0, 30),
        truncated: Boolean(source.truncated),
    };
}

export function compactDesignSnapshot(snapshot: unknown) {
    const source = record(snapshot);
    const selectionIds = strings(source.selectionIds).slice(0, 40);
    return {
        schemaVersion: 1,
        surface: "design",
        projectId: text(source.projectId).slice(0, 160),
        title: text(source.title).slice(0, 160),
        revision: nonNegativeInteger(source.revision),
        selectionIds,
        entities: records(source.entities).slice(0, 80).map(compactDesignEntity),
        relations: records(source.relations)
            .slice(0, 80)
            .map((relation) => ({ id: text(relation.id).slice(0, 160), fromId: text(relation.fromId).slice(0, 160), toId: text(relation.toId).slice(0, 160), kind: text(relation.kind).slice(0, 80) })),
        truncated: Boolean(source.truncated),
    };
}

function compactDesignEntity(entity: Record<string, unknown>) {
    const bounds = record(entity.bounds);
    const resource = record(entity.resource);
    return {
        id: text(entity.id).slice(0, 160),
        kind: text(entity.kind).slice(0, 80),
        name: text(entity.name).slice(0, 200),
        ...(text(entity.parentId) ? { parentId: text(entity.parentId).slice(0, 160) } : {}),
        locked: Boolean(entity.locked),
        hidden: Boolean(entity.hidden),
        ...(Object.keys(bounds).length
            ? {
                  bounds: {
                      x: finiteNumber(bounds.x),
                      y: finiteNumber(bounds.y),
                      width: positiveNumber(bounds.width),
                      height: positiveNumber(bounds.height),
                  },
              }
            : {}),
        ...(text(entity.text) ? { text: text(entity.text).slice(0, 600) } : {}),
        ...(resource.kind === "storage-key" && text(resource.storageKey)
            ? { resource: { kind: "storage-key", storageKey: text(resource.storageKey).slice(0, 1000) } }
            : resource.kind === "library-asset" && text(resource.libraryAssetId)
              ? { resource: { kind: "library-asset", libraryAssetId: text(resource.libraryAssetId).slice(0, 160) } }
              : {}),
    };
}

function compactProjectSnapshot(snapshot: unknown) {
    const source = record(snapshot);
    return Object.fromEntries(
        Object.entries(source)
            .slice(0, 30)
            .map(([key, value]) => [key, compactValue(value, 0)]),
    );
}

function compactValue(value: unknown, depth: number): unknown {
    if (typeof value === "string") return value.slice(0, 800);
    if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
    if (depth >= 3) return undefined;
    if (Array.isArray(value)) return value.slice(0, 12).map((item) => compactValue(item, depth + 1));
    if (value && typeof value === "object")
        return Object.fromEntries(
            Object.entries(value)
                .slice(0, 24)
                .map(([key, item]) => [key, compactValue(item, depth + 1)]),
        );
    return undefined;
}

function fitPlannerInput<T extends Record<string, unknown>>(payload: T, maxChars: number): T {
    if (JSON.stringify(payload).length <= maxChars) return payload;
    const conversationContext = record(payload.conversationContext);
    const canvasSnapshot = record(payload.canvasSnapshot);
    const designSnapshot = record(payload.designSnapshot);
    const compact = {
        ...payload,
        conversationContext: {
            summary: text(conversationContext.summary).slice(0, 1600),
            recentMessages: records(conversationContext.recentMessages)
                .slice(-4)
                .map((message) => ({ ...message, content: text(message.content).slice(0, 400) })),
        },
        referencedAssets: records(payload.referencedAssets)
            .slice(-4)
            .map((asset) => ({ ...asset, textContent: text(asset.textContent).slice(0, 300) || undefined })),
        availableSkills: records(payload.availableSkills)
            .slice(0, 8)
            .map((skill) => ({ ...skill, plannerSummary: text(skill.plannerSummary).slice(0, 120) })),
        ...(Object.keys(canvasSnapshot).length ? { canvasSnapshot: { ...canvasSnapshot, nodes: records(canvasSnapshot.nodes).slice(0, 10) } } : {}),
        ...(Object.keys(designSnapshot).length ? { designSnapshot: { ...designSnapshot, entities: records(designSnapshot.entities).slice(0, 40) } } : {}),
    };
    if (JSON.stringify(compact).length <= maxChars) return compact as T;
    const reduced = {
        ...compact,
        conversationContext: { summary: text(record(compact.conversationContext).summary).slice(0, 800), recentMessages: records(record(compact.conversationContext).recentMessages).slice(-2) },
        projectSnapshot: compactValue(compact.projectSnapshot, 2),
        canvasSnapshot: Object.keys(canvasSnapshot).length ? { ...record(compact.canvasSnapshot), nodes: records(record(compact.canvasSnapshot).nodes).slice(0, 6) } : undefined,
        designSnapshot: Object.keys(designSnapshot).length ? { ...record(compact.designSnapshot), entities: records(record(compact.designSnapshot).entities).slice(0, 20) } : undefined,
        availableSkills: records(compact.availableSkills).slice(0, 4),
    };
    if (JSON.stringify(reduced).length <= maxChars) return reduced as T;
    const minimal = {
        requirement: "",
        surface: payload.surface,
        projectId: payload.projectId,
        currentTurnSelection: payload.currentTurnSelection,
        referenceContext: payload.referenceContext,
        referencedAssets: records(reduced.referencedAssets).slice(-2),
        conversationContext: { summary: text(record(reduced.conversationContext).summary).slice(0, 300), recentMessages: [] },
        canvasSnapshot: Object.keys(record(reduced.canvasSnapshot)).length ? { ...record(reduced.canvasSnapshot), nodes: records(record(reduced.canvasSnapshot).nodes).slice(0, 4) } : undefined,
        designSnapshot: Object.keys(record(reduced.designSnapshot)).length ? { ...record(reduced.designSnapshot), entities: records(record(reduced.designSnapshot).entities).slice(0, 10) } : undefined,
        projectSnapshot: compactValue(reduced.projectSnapshot, 1),
        requestedSkillIds: payload.requestedSkillIds,
        availableSkills: records(reduced.availableSkills).slice(0, 2),
        availableModels: records(payload.availableModels).slice(0, 12),
        defaultModels: payload.defaultModels,
        planningBudget: payload.planningBudget,
    };
    const remaining = Math.max(200, maxChars - JSON.stringify(minimal).length - 16);
    return { ...minimal, requirement: text(payload.requirement).slice(0, remaining) } as unknown as T;
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function records(value: unknown): Array<Record<string, unknown>> {
    return Array.isArray(value) ? value.map(record) : [];
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function finiteNumber(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function positiveNumber(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function nonNegativeInteger(value: unknown) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function strings(value: unknown) {
    return Array.isArray(value) ? Array.from(new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()))) : [];
}

export function taskPlanSummary(task: AgentRunTask) {
    return { id: task.id, title: task.title, type: task.type, model: task.model, dependencies: task.dependencies, referenceAssetIds: task.references?.map((item) => item.assetId).filter(Boolean) || [] };
}

export function conversationFallbackReply(surface: CreativeSurface) {
    if (surface === "canvas") return "在的，你可以直接告诉我想了解什么，或让我操作当前画布。";
    if (surface === "design") return "在的，你可以直接询问当前画板，也可以让我读取、创建或调整画板内容。";
    if (surface === "drama") return "在的，你可以直接询问当前项目，也可以让我继续创作角色、场景、分镜或媒体产物。";
    return "在的，你可以直接告诉我想了解什么，或描述你想创作的内容。";
}

export function resolveTaskReference(requestedIds: string[] | undefined, assets: Map<string, CreativeAsset>, taskType: AgentRunTask["type"]) {
    return resolveTaskReferences(requestedIds, assets, taskType)[0];
}

export function resolveTaskReferences(requestedIds: string[] | undefined, assets: Map<string, CreativeAsset>, taskType: AgentRunTask["type"]) {
    const requested = Array.from(new Set((requestedIds || []).map((id) => id.trim()).filter(Boolean)))
        .map((id) => assets.get(id))
        .filter((asset): asset is CreativeAsset => Boolean(asset));
    return requested.filter((asset) => {
        if (taskType === "image") return asset.type === "image" && Boolean(assetAccessUrl(asset));
        if (taskType === "video") return asset.type !== "text" && Boolean(assetAccessUrl(asset));
        if (taskType === "audio") return asset.type === "audio" || asset.type === "text";
        return true;
    });
}

export function assetAccessUrl(asset?: CreativeAsset) {
    if (!asset) return undefined;
    return [asset.remoteUrl, asset.serverUrl].find((value) => typeof value === "string" && value.trim() && !value.startsWith("data:"))?.trim();
}

export function creativeAssetContext(asset: CreativeAsset) {
    const content = asset.textContent?.trim();
    const url = assetAccessUrl(asset);
    return [`资产 ID：${asset.id}`, `类型：${asset.type}`, `标题：${asset.title}`, content ? `文本：${content.slice(0, 2000)}` : "", url ? `媒体地址：${url}` : ""].filter(Boolean).join("；");
}

export function agentPlanReply(_plan: AgentPlan, tasks: AgentRunTask[], surface: CreativeSurface) {
    const hasReferences = tasks.some((task) => task.targetNodeId || task.references?.length);
    if (surface === "canvas" && tasks.length === 1 && tasks[0]?.type === "text" && tasks[0].targetNodeId) return "已收到，我会直接修改当前提示词节点，不会自动生成图片。";
    if (surface === "canvas") return hasReferences ? "已收到，我会基于当前参考素材完成这次画布创作。" : "已收到，我会按你的要求完成这次画布创作。";
    if (surface === "drama") return hasReferences ? "已收到，我会基于当前项目素材继续创作。" : "已收到，我会按你的要求继续完成项目创作。";
    return hasReferences ? "已收到，我会基于当前参考素材完成这次创作。" : "已收到，我会按你的要求完成这次创作。";
}

function plannerAssetSummary(asset: CreativeAsset) {
    return {
        id: asset.id,
        type: asset.type,
        title: asset.title,
        ...(asset.textContent ? { textContent: asset.textContent.slice(0, 600) } : {}),
        ...(assetAccessUrl(asset) ? { url: assetAccessUrl(asset) } : {}),
        ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
    };
}
