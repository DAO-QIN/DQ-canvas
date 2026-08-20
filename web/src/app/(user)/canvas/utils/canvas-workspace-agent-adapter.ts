import {
    WorkspaceAgentContractError,
    assertWorkspaceActionAuthorized,
    defineWorkspaceActionReceipt,
    defineWorkspaceActionRequest,
    defineWorkspaceSnapshot,
    workspaceActionRequestFingerprint,
    workspaceActionRequiresConfirmation,
    workspaceConfirmationRequiredReceipt,
    type WorkspaceAction,
    type WorkspaceActionReceipt,
    type WorkspaceActionRequest,
    type WorkspaceSnapshot,
    type WorkspaceStableResourceLocator,
} from "@/lib/creative-workspace";
import type { CanvasSaveReceipt } from "@/lib/canvas-project-receipt";

import { CanvasNodeType } from "../types";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "./canvas-agent-ops";

export type CanvasWorkspaceAgentState = Readonly<{ snapshot: CanvasAgentSnapshot; revision: number }>;
export type CanvasWorkspaceAgentExecutor = (ops: readonly CanvasAgentOp[]) => CanvasAgentSnapshot | Promise<CanvasAgentSnapshot>;
export type CanvasWorkspaceAgentPersister = (snapshot: CanvasAgentSnapshot) => Promise<CanvasSaveReceipt>;

const SNAPSHOT_NODE_LIMIT = 200;
const SNAPSHOT_RELATION_LIMIT = 500;
const READ_COMMANDS = new Set(["workspace.read", "selection.read"]);
const VIEW_COMMANDS = new Set(["selection.set", "viewport.set"]);
const CONTROL_COMMANDS = new Set(["generation.authorize"]);
const WRITE_COMMANDS = new Set(["content.create", "content.update", "content.delete", "relation.create", "relation.delete", "generation.run"]);

export function createCanvasWorkspaceSnapshot(state: CanvasWorkspaceAgentState): WorkspaceSnapshot {
    const nodes = selectedFirst(state.snapshot.nodes, state.snapshot.selectedNodeIds).slice(0, SNAPSHOT_NODE_LIMIT);
    const nodeIds = new Set(nodes.map((node) => node.id));
    const entities = nodes.map((node) => {
        const resource = stableCanvasResource(node.metadata?.storageKey) || stableCanvasResource(internalCanvasStorageKey(node.metadata));
        const text = canvasNodeText(node.type, node.metadata);
        return {
            id: node.id,
            kind: node.type,
            name: safeSnapshotText(node.title, "未命名节点", 400),
            locked: Boolean(node.metadata?.locked),
            bounds: { x: node.position.x, y: node.position.y, width: node.width, height: node.height },
            ...(text ? { text } : {}),
            ...(resource ? { resource } : {}),
        };
    });
    const relations = state.snapshot.connections
        .filter((connection) => nodeIds.has(connection.fromNodeId) && nodeIds.has(connection.toNodeId))
        .slice(0, SNAPSHOT_RELATION_LIMIT)
        .map((connection) => ({ id: connection.id, fromId: connection.fromNodeId, toId: connection.toNodeId, kind: "connection" }));
    return defineWorkspaceSnapshot({
        schemaVersion: 1,
        surface: "canvas",
        projectId: state.snapshot.projectId,
        title: safeSnapshotText(state.snapshot.title, "未命名画布", 400),
        revision: state.revision,
        selectionIds: state.snapshot.selectedNodeIds.filter((id) => nodeIds.has(id)),
        entities,
        relations,
        truncated: nodes.length < state.snapshot.nodes.length || relations.length < state.snapshot.connections.length,
    });
}

export function canvasWorkspaceActionsToOps(requestValue: WorkspaceActionRequest, state: CanvasWorkspaceAgentState): readonly CanvasAgentOp[] {
    const request = defineWorkspaceActionRequest(requestValue);
    assertCanvasRequestIdentity(request, state);
    const nodes = new Map(state.snapshot.nodes.map((node) => [node.id, node]));
    return Object.freeze(request.actions.flatMap((action) => canvasActionToOps(action, nodes, state.snapshot)));
}

export async function executeCanvasWorkspaceActions(input: { request: WorkspaceActionRequest; state: CanvasWorkspaceAgentState; applyOps: CanvasWorkspaceAgentExecutor; persist?: CanvasWorkspaceAgentPersister }): Promise<WorkspaceActionReceipt> {
    let request: WorkspaceActionRequest;
    try {
        request = defineWorkspaceActionRequest(input.request);
        assertCanvasRequestIdentity(request, input.state);
        validateCanvasActionEffects(request.actions);
    } catch (error) {
        return rejectedReceipt(input.request, input.state, error);
    }
    if (workspaceActionRequiresConfirmation(request) && !request.confirmation) return workspaceConfirmationRequiredReceipt(request);
    try {
        assertWorkspaceActionAuthorized(request);
        const ops = canvasWorkspaceActionsToOps(request, input.state);
        const next = ops.length ? await input.applyOps(ops) : input.state.snapshot;
        const affectedByAction = canvasAffectedIds(request.actions, input.state.snapshot, next);
        const hasDocumentWrite = ops.length > 0 && request.actions.some((action) => action.effect === "write" && !CONTROL_COMMANDS.has(action.command));
        const saveReceipt = hasDocumentWrite ? await persistCanvasWorkspaceSnapshot(request, next, input.persist) : undefined;
        return defineWorkspaceActionReceipt(request, {
            surface: "canvas",
            projectId: request.projectId,
            batchId: request.batchId,
            fingerprint: workspaceActionRequestFingerprint(request),
            status: "applied",
            baseRevision: request.baseRevision,
            resultRevision: saveReceipt?.resultRevision ?? request.baseRevision,
            affectedIds: Array.from(new Set(affectedByAction.flat())),
            results: request.actions.map((action, index) => ({ actionId: action.actionId, status: "applied", affectedIds: affectedByAction[index] })),
        });
    } catch (error) {
        return rejectedReceipt(request, input.state, error);
    }
}

async function persistCanvasWorkspaceSnapshot(request: WorkspaceActionRequest, snapshot: CanvasAgentSnapshot, persist?: CanvasWorkspaceAgentPersister) {
    if (!persist) throw new CanvasWorkspacePersistenceError("PERSISTENCE_REQUIRED", "Canvas 写操作缺少持久化回执", false);
    let receipt: CanvasSaveReceipt;
    try {
        receipt = await persist(snapshot);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Canvas 保存失败";
        const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
        const conflict = status === 409 || /revision|冲突/i.test(message);
        throw new CanvasWorkspacePersistenceError(conflict ? "REVISION_CONFLICT" : "PERSISTENCE_FAILED", message, !status || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500);
    }
    if (receipt.projectId !== request.projectId) throw new CanvasWorkspacePersistenceError("PERSISTENCE_RECEIPT_INVALID", "Canvas 保存回执不属于当前项目", false);
    if (receipt.baseRevision !== request.baseRevision) throw new CanvasWorkspacePersistenceError("REVISION_CONFLICT", `Canvas 保存回执 base revision ${receipt.baseRevision} 与请求 ${request.baseRevision} 不一致`, true);
    if (receipt.status === "conflict") throw new CanvasWorkspacePersistenceError("REVISION_CONFLICT", receipt.error?.message || "Canvas 保存 revision 冲突", Boolean(receipt.error?.retryable));
    if (receipt.status !== "applied" && receipt.status !== "replayed") throw new CanvasWorkspacePersistenceError("PERSISTENCE_RECEIPT_INVALID", "Canvas 保存回执状态无效", false);
    if (receipt.resultRevision <= request.baseRevision) throw new CanvasWorkspacePersistenceError("PERSISTENCE_RECEIPT_INVALID", "Canvas 保存回执没有推进项目 revision", false);
    return receipt;
}

class CanvasWorkspacePersistenceError extends Error {
    constructor(
        readonly code: "PERSISTENCE_REQUIRED" | "PERSISTENCE_FAILED" | "PERSISTENCE_RECEIPT_INVALID" | "REVISION_CONFLICT",
        message: string,
        readonly retryable: boolean,
    ) {
        super(message);
        this.name = "CanvasWorkspacePersistenceError";
    }
}

function canvasActionToOps(action: WorkspaceAction, nodes: Map<string, CanvasAgentSnapshot["nodes"][number]>, snapshot: CanvasAgentSnapshot): CanvasAgentOp[] {
    assertCanvasActionEffect(action);
    if (READ_COMMANDS.has(action.command) || CONTROL_COMMANDS.has(action.command)) return [];
    if (action.command === "selection.set") {
        assertTargetsExist(action, nodes);
        return [{ type: "select_nodes", ids: [...action.targetIds] }];
    }
    if (action.command === "viewport.set") {
        const position = pointParameter(action, "position", true);
        const zoom = numberParameter(action, "zoom", true);
        if (zoom <= 0 || zoom > 8) throw new WorkspaceAgentContractError("viewport zoom 超出允许范围");
        return [{ type: "set_viewport", viewport: { x: position.x, y: position.y, k: zoom } }];
    }
    if (action.command === "content.create") {
        const nodeId = singleTarget(action, false) || `agent-${action.actionId}`;
        if (nodes.has(nodeId)) throw new WorkspaceAgentContractError(`节点 ID 已存在：${nodeId}`);
        const nodeType = canvasNodeType(stringParameter(action, "nodeType", true));
        const bounds = boundsParameter(action, "bounds", false);
        const position = pointParameter(action, "position", false) ?? (bounds ? { x: bounds.x, y: bounds.y } : { x: 0, y: 0 });
        const title = stringParameter(action, "title", false);
        const text = stringParameter(action, "text", false);
        const resource = resourceParameter(action, "resource", false);
        if (resource?.kind === "library-asset") throw new WorkspaceAgentContractError("Canvas 节点创建前必须先把素材库资源解析为稳定 storageKey");
        return [
            {
                type: "add_node",
                id: nodeId,
                nodeType,
                ...(title ? { title } : {}),
                position,
                ...(bounds ? { width: bounds.width, height: bounds.height } : {}),
                metadata: {
                    ...(text ? { composerContent: text, prompt: text } : {}),
                    ...(resource ? { storageKey: resource.storageKey } : {}),
                },
            },
        ];
    }
    if (action.command === "content.update") {
        assertTargetsEditable(action, nodes);
        const position = pointParameter(action, "position", false);
        const bounds = boundsParameter(action, "bounds", false);
        const title = stringParameter(action, "title", false);
        const text = stringParameter(action, "text", false);
        const locked = booleanParameter(action, "locked", false);
        if (!position && !bounds && title === undefined && text === undefined && locked === undefined) throw new WorkspaceAgentContractError("content.update 没有可应用的字段");
        return action.targetIds.map((targetId) => ({
            type: "update_node",
            id: targetId,
            patch: {
                ...(title === undefined ? {} : { title }),
                ...(position ? { position } : bounds ? { position: { x: bounds.x, y: bounds.y } } : {}),
                ...(bounds ? { width: bounds.width, height: bounds.height } : {}),
            },
            metadata: { ...(text === undefined ? {} : { composerContent: text, prompt: text }), ...(locked === undefined ? {} : { locked }) },
        }));
    }
    if (action.command === "content.delete") {
        assertTargetsEditable(action, nodes);
        return [{ type: "delete_node", ids: [...action.targetIds] }];
    }
    if (action.command === "relation.create") {
        const fromNodeId = stringParameter(action, "fromId", true);
        const toNodeId = stringParameter(action, "toId", true);
        if (!nodes.has(fromNodeId) || !nodes.has(toNodeId)) throw new WorkspaceAgentContractError("连接引用了不存在的节点");
        return [{ type: "connect_nodes", id: singleTarget(action, false) || `connection-${action.actionId}`, fromNodeId, toNodeId }];
    }
    if (action.command === "relation.delete") {
        const connectionIds = new Set(snapshot.connections.map((connection) => connection.id));
        if (!action.targetIds.length || action.targetIds.some((id) => !connectionIds.has(id))) throw new WorkspaceAgentContractError("待删除连接不存在");
        return [{ type: "delete_connections", ids: [...action.targetIds] }];
    }
    if (action.command === "generation.run") {
        const nodeId = singleTarget(action, true);
        assertTargetsEditable(action, nodes);
        const mode = stringParameter(action, "mode", false);
        if (mode && !["text", "image", "video", "audio"].includes(mode)) throw new WorkspaceAgentContractError("generation mode 无效");
        return [{ type: "run_generation", nodeId, ...(mode ? { mode: mode as "text" | "image" | "video" | "audio" } : {}), ...(stringParameter(action, "prompt", false) ? { prompt: stringParameter(action, "prompt", false) } : {}) }];
    }
    throw new WorkspaceAgentContractError(`Canvas 不支持工作台命令：${action.command}`);
}

function assertCanvasRequestIdentity(request: WorkspaceActionRequest, state: CanvasWorkspaceAgentState) {
    if (request.surface !== "canvas" || request.projectId !== state.snapshot.projectId) throw new WorkspaceAgentContractError("Canvas action request 不属于当前项目");
    if (request.baseRevision !== state.revision) throw new WorkspaceAgentContractError(`Canvas revision 冲突：期望 ${request.baseRevision}，当前 ${state.revision}`);
}

function validateCanvasActionEffects(actions: readonly WorkspaceAction[]) {
    actions.forEach(assertCanvasActionEffect);
}

function assertCanvasActionEffect(action: WorkspaceAction) {
    if (READ_COMMANDS.has(action.command) && action.effect !== "read") throw new WorkspaceAgentContractError(`${action.command} 必须声明为 read`);
    if (VIEW_COMMANDS.has(action.command) && action.effect !== "read") throw new WorkspaceAgentContractError(`${action.command} 必须声明为 read`);
    if (WRITE_COMMANDS.has(action.command) && action.effect !== "write") throw new WorkspaceAgentContractError(`${action.command} 必须声明为 write`);
    if (CONTROL_COMMANDS.has(action.command) && action.effect !== "write") throw new WorkspaceAgentContractError(`${action.command} 必须声明为 write`);
    if (!READ_COMMANDS.has(action.command) && !VIEW_COMMANDS.has(action.command) && !CONTROL_COMMANDS.has(action.command) && !WRITE_COMMANDS.has(action.command)) throw new WorkspaceAgentContractError(`Canvas 不支持工作台命令：${action.command}`);
}

function assertTargetsExist(action: WorkspaceAction, nodes: Map<string, CanvasAgentSnapshot["nodes"][number]>) {
    if (action.targetIds.some((id) => !nodes.has(id))) throw new WorkspaceAgentContractError(`${action.command} 引用了不存在的节点`);
}

function assertTargetsEditable(action: WorkspaceAction, nodes: Map<string, CanvasAgentSnapshot["nodes"][number]>) {
    assertTargetsExist(action, nodes);
    if (!action.targetIds.length) throw new WorkspaceAgentContractError(`${action.command} 缺少目标节点`);
    const locked = action.targetIds.find((id) => nodes.get(id)?.metadata?.locked);
    if (locked) throw new WorkspaceAgentContractError(`节点已锁定：${locked}`);
}

function canvasAffectedIds(actions: readonly WorkspaceAction[], before: CanvasAgentSnapshot, after: CanvasAgentSnapshot) {
    const beforeIds = new Set(before.nodes.map((node) => node.id));
    const afterIds = new Set(after.nodes.map((node) => node.id));
    return actions.map((action) => {
        if (action.command === "workspace.read") return after.nodes.map((node) => node.id);
        if (action.command === "selection.read") return after.selectedNodeIds;
        if (CONTROL_COMMANDS.has(action.command)) return [];
        if (action.command === "content.create") return action.targetIds.length ? [...action.targetIds] : after.nodes.filter((node) => !beforeIds.has(node.id)).map((node) => node.id);
        if (action.command === "content.delete") return action.targetIds.filter((id) => !afterIds.has(id));
        return [...action.targetIds];
    });
}

function rejectedReceipt(requestValue: WorkspaceActionRequest, state: CanvasWorkspaceAgentState, error: unknown): WorkspaceActionReceipt {
    let request: WorkspaceActionRequest;
    try {
        request = defineWorkspaceActionRequest(requestValue);
    } catch {
        request = defineWorkspaceActionRequest({
            surface: "canvas",
            projectId: state.snapshot.projectId,
            baseRevision: state.revision,
            batchId: "invalid-agent-request",
            actions: [{ actionId: "invalid-agent-action", kind: "inspect", effect: "read", command: "workspace.read", label: "无效请求", targetIds: [], parameters: {} }],
        });
    }
    const message = error instanceof Error ? error.message : "Canvas Agent 操作无效";
    const persistenceError = error instanceof CanvasWorkspacePersistenceError ? error : undefined;
    const code = persistenceError?.code || (/revision|冲突/i.test(message) ? "REVISION_CONFLICT" : /锁定/.test(message) ? "LOCKED" : "INVALID_ACTION");
    const status = code === "REVISION_CONFLICT" ? "conflict" : "rejected";
    const receiptError = { code, message, retryable: persistenceError?.retryable ?? code === "REVISION_CONFLICT" };
    return defineWorkspaceActionReceipt(request, {
        surface: request.surface,
        projectId: request.projectId,
        batchId: request.batchId,
        fingerprint: workspaceActionRequestFingerprint(request),
        status,
        baseRevision: request.baseRevision,
        resultRevision: state.revision,
        affectedIds: [],
        results: request.actions.map((action) => ({ actionId: action.actionId, status: "rejected", affectedIds: [], error: receiptError })),
        error: receiptError,
    });
}

function selectedFirst<T extends { id: string }>(items: readonly T[], selectedIds: readonly string[]) {
    const selected = new Set(selectedIds);
    return [...items.filter((item) => selected.has(item.id)), ...items.filter((item) => !selected.has(item.id))];
}

function safeSnapshotText(value: unknown, fallback: string, max: number) {
    const text = typeof value === "string" ? value.trim().slice(0, max) : "";
    return text && !/^(?:data|blob|https?):/i.test(text) ? text : fallback;
}

function canvasNodeText(type: CanvasNodeType, metadata: CanvasAgentSnapshot["nodes"][number]["metadata"]) {
    if (![CanvasNodeType.Text, CanvasNodeType.Brief, CanvasNodeType.Task, CanvasNodeType.BrandKit, CanvasNodeType.Config].includes(type)) return undefined;
    const value = type === CanvasNodeType.Config ? metadata?.size || metadata?.composerContent || metadata?.prompt || metadata?.content : metadata?.composerContent || metadata?.prompt || metadata?.content;
    const text = safeSnapshotText(value, "", 2_000);
    return text || undefined;
}

function stableCanvasResource(storageKey: unknown): WorkspaceStableResourceLocator | undefined {
    if (typeof storageKey !== "string" || !storageKey.trim() || storageKey.length > 1_024) return undefined;
    const normalized = storageKey.trim();
    if (normalized.startsWith("/") || /^(?:data|blob|https?|temporary)(?::|\/)/i.test(normalized) || /[\\\0-\x1f?#]/.test(normalized) || normalized.includes("..")) return undefined;
    const segments = normalized.split("/");
    return segments.every((segment) => segment && segment !== "." && segment !== "..") ? { kind: "storage-key", storageKey: normalized } : undefined;
}

function internalCanvasStorageKey(metadata: CanvasAgentSnapshot["nodes"][number]["metadata"]) {
    const candidates = [metadata?.serverUrl, metadata?.content];
    for (const candidate of candidates) {
        if (typeof candidate !== "string") continue;
        const normalized = candidate.trim().replace(/\\/g, "/");
        for (const route of ["/api/reference-assets/", "/api/generation-log-assets/"]) {
            const routeIndex = normalized.indexOf(route);
            if (routeIndex < 0) continue;
            try {
                return normalized
                    .slice(routeIndex + route.length)
                    .split(/[?#]/, 1)[0]
                    .split("/")
                    .map(decodeURIComponent)
                    .join("/");
            } catch {
                return undefined;
            }
        }
    }
    return undefined;
}

function canvasNodeType(value: string) {
    if (!Object.values(CanvasNodeType).includes(value as CanvasNodeType)) throw new WorkspaceAgentContractError(`Canvas nodeType 无效：${value}`);
    return value as CanvasNodeType;
}

function singleTarget(action: WorkspaceAction, required: boolean) {
    if (action.targetIds.length > 1 || (required && action.targetIds.length !== 1)) throw new WorkspaceAgentContractError(`${action.command} 必须指定一个目标`);
    return action.targetIds[0];
}

function stringParameter(action: WorkspaceAction, key: string, required: true): string;
function stringParameter(action: WorkspaceAction, key: string, required: false): string | undefined;
function stringParameter(action: WorkspaceAction, key: string, required: boolean) {
    const value = action.parameters[key];
    if (value === undefined && !required) return undefined;
    if (typeof value !== "string" || !value.trim()) throw new WorkspaceAgentContractError(`${action.command}.${key} 必须是字符串`);
    return value.trim();
}

function numberParameter(action: WorkspaceAction, key: string, required: true): number;
function numberParameter(action: WorkspaceAction, key: string, required: false): number | undefined;
function numberParameter(action: WorkspaceAction, key: string, required: boolean) {
    const value = action.parameters[key];
    if (value === undefined && !required) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value)) throw new WorkspaceAgentContractError(`${action.command}.${key} 必须是数字`);
    return value;
}

function booleanParameter(action: WorkspaceAction, key: string, required: boolean) {
    const value = action.parameters[key];
    if (value === undefined && !required) return undefined;
    if (typeof value !== "boolean") throw new WorkspaceAgentContractError(`${action.command}.${key} 必须是布尔值`);
    return value;
}

function pointParameter(action: WorkspaceAction, key: string, required: true): { x: number; y: number };
function pointParameter(action: WorkspaceAction, key: string, required: false): { x: number; y: number } | undefined;
function pointParameter(action: WorkspaceAction, key: string, required: boolean) {
    const value = action.parameters[key];
    if (value === undefined && !required) return undefined;
    if (!value || typeof value !== "object" || !("x" in value) || !("y" in value) || "kind" in value || typeof value.x !== "number" || typeof value.y !== "number") throw new WorkspaceAgentContractError(`${action.command}.${key} 必须是坐标`);
    return { x: value.x, y: value.y };
}

function boundsParameter(action: WorkspaceAction, key: string, required: true): { x: number; y: number; width: number; height: number };
function boundsParameter(action: WorkspaceAction, key: string, required: false): { x: number; y: number; width: number; height: number } | undefined;
function boundsParameter(action: WorkspaceAction, key: string, required: boolean) {
    const value = required ? pointParameter(action, key, true) : pointParameter(action, key, false);
    if (!value) return undefined;
    const raw = action.parameters[key];
    if (!raw || typeof raw !== "object" || !("width" in raw) || !("height" in raw) || typeof raw.width !== "number" || typeof raw.height !== "number" || raw.width <= 0 || raw.height <= 0)
        throw new WorkspaceAgentContractError(`${action.command}.${key} 必须包含正尺寸`);
    return { ...value, width: raw.width, height: raw.height };
}

function resourceParameter(action: WorkspaceAction, key: string, required: boolean) {
    const value = action.parameters[key];
    if (value === undefined && !required) return undefined;
    if (!value || typeof value !== "object" || !("kind" in value) || (value.kind !== "storage-key" && value.kind !== "library-asset")) throw new WorkspaceAgentContractError(`${action.command}.${key} 必须是稳定资源定位符`);
    return value as WorkspaceStableResourceLocator;
}
