import {
    WorkspaceAgentContractError,
    defineWorkspaceActionRequest,
    defineWorkspaceSnapshot,
    type WorkspaceActionEffect,
    type WorkspaceActionKind,
    type WorkspaceActionRequest,
    type WorkspaceActionValue,
    type WorkspaceSnapshot,
} from "@/lib/creative-workspace";
import type { CreativeSurface } from "@/lib/creative-runtime-contract";
import { canvasProjectRevision } from "@/lib/canvas-project-receipt";
import { sha256Hex } from "@/lib/sha256";
import { getCanvasProjectForUser } from "./canvas-project-service";
import { getDesignProjectForUser } from "./design-project-service";
import type { AgentWorkspaceActionProposal } from "./agent-run-validation";
import type { AgentRun } from "./agent-run-store";
import { createCanvasWorkspaceSnapshot } from "@/app/(user)/canvas/utils/canvas-workspace-agent-adapter";
import { createDesignWorkspaceSnapshot } from "@/features/design-editor/adapter/design-workspace-agent-adapter";

type TargetPolicy = "none" | "selection" | "entities" | "relations" | "new-entity" | "new-relation";
type CommandPolicy = Readonly<{
    surfaces: readonly ("canvas" | "design")[];
    kind: WorkspaceActionKind;
    effect: WorkspaceActionEffect;
    targets: TargetPolicy;
    minTargets?: number;
    rejectLockedTargets?: boolean;
}>;

const COMMAND_POLICIES: Readonly<Record<string, CommandPolicy>> = Object.freeze({
    "workspace.read": { surfaces: ["canvas", "design"], kind: "inspect", effect: "read", targets: "none" },
    "selection.read": { surfaces: ["canvas", "design"], kind: "inspect", effect: "read", targets: "selection" },
    "selection.set": { surfaces: ["canvas"], kind: "select", effect: "read", targets: "entities" },
    "viewport.set": { surfaces: ["canvas"], kind: "arrange", effect: "read", targets: "none" },
    "content.create": { surfaces: ["canvas"], kind: "create", effect: "write", targets: "new-entity" },
    "content.create-frame": { surfaces: ["design"], kind: "create", effect: "write", targets: "new-entity" },
    "content.create-element": { surfaces: ["design"], kind: "create", effect: "write", targets: "new-entity" },
    "content.update": { surfaces: ["canvas", "design"], kind: "update", effect: "write", targets: "entities", minTargets: 1, rejectLockedTargets: true },
    "content.delete": { surfaces: ["canvas", "design"], kind: "delete", effect: "write", targets: "entities", minTargets: 1, rejectLockedTargets: true },
    "content.align": { surfaces: ["design"], kind: "arrange", effect: "write", targets: "entities", minTargets: 2, rejectLockedTargets: true },
    "content.distribute": { surfaces: ["design"], kind: "arrange", effect: "write", targets: "entities", minTargets: 3, rejectLockedTargets: true },
    "content.reorder": { surfaces: ["design"], kind: "arrange", effect: "write", targets: "entities", minTargets: 1, rejectLockedTargets: true },
    "relation.create": { surfaces: ["canvas"], kind: "create", effect: "write", targets: "new-relation" },
    "relation.delete": { surfaces: ["canvas"], kind: "delete", effect: "write", targets: "relations", minTargets: 1 },
    "asset.insert-image": { surfaces: ["design"], kind: "create", effect: "write", targets: "none" },
    "generation.run": { surfaces: ["canvas"], kind: "generate", effect: "write", targets: "entities", minTargets: 1, rejectLockedTargets: true },
});

export function buildAgentWorkspaceActionRequest(input: {
    runId: string;
    surface: CreativeSurface;
    projectId?: string;
    snapshot: unknown;
    proposals: readonly AgentWorkspaceActionProposal[];
    generationTasks?: readonly Readonly<{ id: string; title: string; type: "text" | "image" | "video" | "audio" }>[];
}): WorkspaceActionRequest {
    const surface = input.surface;
    if (surface !== "canvas" && surface !== "design") throw new WorkspaceAgentContractError("当前入口不支持工作台动作");
    if (!input.projectId) throw new WorkspaceAgentContractError("工作台动作缺少项目标识");
    if (!input.proposals.length && !input.generationTasks?.length) throw new WorkspaceAgentContractError("工作台动作不能为空");
    const snapshot = defineWorkspaceSnapshot(input.snapshot as WorkspaceSnapshot);
    if (snapshot.surface !== surface || snapshot.projectId !== input.projectId) throw new WorkspaceAgentContractError("工作台快照与 Agent Run 身份不匹配");

    const generationTasks = normalizeGenerationTasks(input.generationTasks);
    const seed = sha256Hex(stableStringify({ runId: input.runId, surface, projectId: input.projectId, revision: snapshot.revision, proposals: input.proposals, generationTasks }));
    const batchId = `agent-workspace-${seed.slice(0, 32)}`;
    const entityById = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
    const relationIds = new Set(snapshot.relations.map((relation) => relation.id));
    const actions = input.proposals.map((proposal, index) => {
        if (proposal.command === "generation.authorize") throw new WorkspaceAgentContractError("generation.authorize 只能由服务端生成");
        const policy = COMMAND_POLICIES[proposal.command];
        if (!policy || !policy.surfaces.includes(surface)) throw new WorkspaceAgentContractError(`${surface} 不支持工作台命令：${proposal.command}`);
        const actionSeed = sha256Hex(`${seed}:${index}:${proposal.command}`);
        const actionId = `agent-action-${actionSeed.slice(0, 32)}`;
        const targetIds = resolveTargetIds(proposal, policy, snapshot, entityById, relationIds, actionSeed);
        validateParameterReferences(proposal, entityById);
        return {
            actionId,
            kind: policy.kind,
            effect: policy.effect,
            command: proposal.command,
            label: proposal.label,
            targetIds,
            // The shared contract performs the runtime validation at this trust boundary.
            parameters: (proposal.parameters || {}) as Record<string, WorkspaceActionValue>,
        };
    });
    if (generationTasks.length) {
        const actionSeed = sha256Hex(`${seed}:generation-authorize`);
        actions.push({
            actionId: `agent-action-${actionSeed.slice(0, 32)}`,
            kind: "generate",
            effect: "write",
            command: "generation.authorize",
            label: generationTasks.length === 1 ? `生成「${generationTasks[0].title}」` : `生成 ${generationTasks.length} 项内容`,
            targetIds: [],
            parameters: { taskIds: generationTasks.map((task) => task.id), taskTypes: generationTasks.map((task) => task.type) },
        });
    }
    return defineWorkspaceActionRequest({ surface, projectId: input.projectId, baseRevision: snapshot.revision, batchId, actions });
}

export async function buildAgentWorkspaceActionRequestForRun(
    run: Pick<AgentRun, "id" | "userId" | "surface" | "projectId" | "snapshot">,
    proposals: readonly AgentWorkspaceActionProposal[],
    generationTasks: readonly Readonly<{ id: string; title: string; type: "text" | "image" | "video" | "audio" }>[] = [],
    trustedSnapshot?: WorkspaceSnapshot,
) {
    if (run.surface !== "canvas" && run.surface !== "design") throw new WorkspaceAgentContractError("当前入口不支持工作台动作");
    if (!run.projectId) throw new WorkspaceAgentContractError("工作台动作缺少项目标识");
    const snapshot = trustedSnapshot || (await getAgentWorkspaceSnapshotForRun(run));
    return buildAgentWorkspaceActionRequest({ runId: run.id, surface: run.surface, projectId: run.projectId, snapshot, proposals, generationTasks });
}

export async function getAgentWorkspaceSnapshotForRun(run: Pick<AgentRun, "userId" | "surface" | "projectId" | "snapshot">): Promise<WorkspaceSnapshot> {
    if (run.surface !== "canvas" && run.surface !== "design") throw new WorkspaceAgentContractError("当前入口不支持工作台快照");
    if (!run.projectId) throw new WorkspaceAgentContractError("工作台快照缺少项目标识");
    const selectionIds = clientSelectionIds(run.snapshot);
    return run.surface === "canvas"
        ? getCanvasProjectForUser(run.userId, run.projectId).then((project) =>
              createCanvasWorkspaceSnapshot({
                  revision: canvasProjectRevision(project),
                  snapshot: {
                      projectId: project.id,
                      title: project.title,
                      nodes: project.nodes,
                      connections: project.connections,
                      selectedNodeIds: selectionIds,
                      viewport: project.viewport,
                  },
              }),
          )
        : getDesignProjectForUser(run.userId, run.projectId).then((project) => createDesignWorkspaceSnapshot(project.document, selectionIds));
}

function resolveTargetIds(proposal: AgentWorkspaceActionProposal, policy: CommandPolicy, snapshot: WorkspaceSnapshot, entityById: Map<string, WorkspaceSnapshot["entities"][number]>, relationIds: Set<string>, seed: string) {
    const proposed = Array.from(new Set(proposal.targetIds || []));
    if (policy.targets === "new-entity" || policy.targets === "new-relation") {
        if (proposed.length) throw new WorkspaceAgentContractError(`${proposal.command} 的新对象 ID 必须由服务端生成`);
        return [`agent-${policy.targets === "new-relation" ? "relation" : "entity"}-${seed.slice(0, 32)}`];
    }
    if (policy.targets === "none") {
        if (proposed.length) throw new WorkspaceAgentContractError(`${proposal.command} 不接受目标对象`);
        return [];
    }
    const targets = policy.targets === "selection" && !proposed.length ? [...snapshot.selectionIds] : proposed;
    if ((policy.minTargets || 0) > targets.length) throw new WorkspaceAgentContractError(`${proposal.command} 至少需要 ${policy.minTargets} 个目标`);
    if (policy.targets === "relations") {
        const missing = targets.find((id) => !relationIds.has(id));
        if (missing) throw new WorkspaceAgentContractError(`${proposal.command} 引用了不存在的关系：${missing}`);
        return targets;
    }
    const missing = targets.find((id) => !entityById.has(id));
    if (missing) throw new WorkspaceAgentContractError(`${proposal.command} 引用了不存在的实体：${missing}`);
    if (policy.rejectLockedTargets) {
        const locked = targets.find((id) => entityById.get(id)?.locked);
        if (locked) throw new WorkspaceAgentContractError(`${proposal.command} 不得操作已锁定实体：${locked}`);
    }
    return targets;
}

function validateParameterReferences(proposal: AgentWorkspaceActionProposal, entityById: Map<string, WorkspaceSnapshot["entities"][number]>) {
    if (proposal.command !== "relation.create") return;
    const parameters = proposal.parameters || {};
    for (const key of ["fromId", "toId"] as const) {
        const value = parameters[key];
        if (typeof value !== "string" || !entityById.has(value)) throw new WorkspaceAgentContractError(`relation.create.${key} 必须引用现有实体`);
    }
}

function clientSelectionIds(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const source = value as Record<string, unknown>;
    const selection = Array.isArray(source.selectionIds) ? source.selectionIds : Array.isArray(source.selectedNodeIds) ? source.selectedNodeIds : [];
    return Array.from(new Set(selection.filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9_:.\/-]{0,159}$/.test(id.trim())).map((id) => id.trim()))).slice(0, 500);
}

function normalizeGenerationTasks(value: readonly Readonly<{ id: string; title: string; type: "text" | "image" | "video" | "audio" }>[] | undefined) {
    if (!value?.length) return [];
    if (value.length > 50) throw new WorkspaceAgentContractError("生成任务数量超过上限");
    const seen = new Set<string>();
    return value.map((task) => {
        const id = task.id.trim();
        const title = task.title.trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9_:.\/-]{0,159}$/.test(id) || seen.has(id) || !title || title.length > 200 || !["text", "image", "video", "audio"].includes(task.type)) throw new WorkspaceAgentContractError("生成任务摘要无效");
        seen.add(id);
        return { id, title, type: task.type };
    });
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (value && typeof value === "object")
        return `{${Object.entries(value as Record<string, unknown>)
            .filter(([, nested]) => nested !== undefined)
            .toSorted(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
            .join(",")}}`;
    return JSON.stringify(value);
}
