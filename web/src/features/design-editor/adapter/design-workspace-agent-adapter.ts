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
} from "@/lib/creative-workspace";
import {
    applyDesignOperationBatch,
    createDesignImageImportBatch,
    designOperationBatchFingerprint,
    type DesignDocument,
    type DesignElement,
    type DesignOperation,
    type DesignOperationBatch,
    type DesignOperationReceipt,
    type DesignOperationScope,
} from "@/lib/design";

import {
    alignDesignElements,
    createElementOperation,
    createFrameOperation,
    distributeDesignElements,
    reorderDesignElements,
    type DesignAlignment,
    type DesignCreatableElementKind,
    type DesignDistribution,
    type DesignLayerReorder,
} from "../model/design-editor-commands";

export type DesignWorkspaceAgentCommit = Readonly<{ receipt: DesignOperationReceipt }>;
export type DesignWorkspaceAgentCommitter = (batch: DesignOperationBatch) => Promise<DesignWorkspaceAgentCommit>;
type CompiledDesignWorkspaceActions = Readonly<{ batch: DesignOperationBatch; operationIdsByAction: ReadonlyMap<string, readonly string[]> }>;

const READ_COMMANDS = new Set(["workspace.read", "selection.read"]);
const CONTROL_COMMANDS = new Set(["generation.authorize"]);
const WRITE_COMMANDS = new Set(["content.create-frame", "content.create-element", "content.update", "content.delete", "content.align", "content.distribute", "content.reorder", "asset.insert-image", "generation.run"]);
const SNAPSHOT_ENTITY_LIMIT = 500;

export function createDesignWorkspaceSnapshot(document: DesignDocument, selectionIds: readonly string[] = []): WorkspaceSnapshot {
    const frames = document.frames.slice(0, SNAPSHOT_ENTITY_LIMIT);
    const remaining = Math.max(0, SNAPSHOT_ENTITY_LIMIT - frames.length);
    const selected = new Set(selectionIds);
    const elements = selectedFirst(document.elements, selectionIds).slice(0, remaining);
    const visibleIds = new Set([...frames.map((frame) => frame.id), ...elements.map((element) => element.id)]);
    return defineWorkspaceSnapshot({
        schemaVersion: 1,
        surface: "design",
        projectId: document.id,
        title: document.metadata.title,
        revision: document.revision,
        selectionIds: Array.from(selected).filter((id) => visibleIds.has(id)),
        entities: [
            ...frames.map((frame) => ({ id: frame.id, kind: "frame", name: frame.name, locked: frame.locked, bounds: { x: frame.x, y: frame.y, width: frame.width, height: frame.height } })),
            ...elements.map((element) => designElementSnapshot(document, element)),
        ],
        relations: [],
        truncated: frames.length < document.frames.length || elements.length < document.elements.length,
    });
}

export function designWorkspaceActionsToBatch(requestValue: WorkspaceActionRequest, document: DesignDocument): DesignOperationBatch {
    return compileDesignWorkspaceActions(requestValue, document).batch;
}

function compileDesignWorkspaceActions(requestValue: WorkspaceActionRequest, document: DesignDocument): CompiledDesignWorkspaceActions {
    const request = defineWorkspaceActionRequest(requestValue);
    assertDesignRequestIdentity(request, document);
    const operationIdsByAction = new Map<string, readonly string[]>();
    const operations = request.actions.flatMap((action) => {
        const compiled = designActionToOperations(action, document);
        operationIdsByAction.set(action.actionId, Object.freeze(compiled.map((operation) => operation.opId)));
        return compiled;
    });
    if (!operations.length) throw new WorkspaceAgentContractError("Design 写操作批次不能为空");
    const batch: DesignOperationBatch = {
        batchId: request.batchId,
        expectedRevision: request.baseRevision,
        mode: "atomic",
        source: "agent",
        label: request.actions
            .map((action) => action.label)
            .join("；")
            .slice(0, 200),
        operations,
    };
    const preview = applyDesignOperationBatch(document, batch, { now: () => document.metadata.updatedAt });
    if (preview.receipt.status !== "applied") throw designReceiptError(preview.receipt);
    return Object.freeze({ batch, operationIdsByAction });
}

export async function executeDesignWorkspaceActions(input: { request: WorkspaceActionRequest; document: DesignDocument; commitBatch: DesignWorkspaceAgentCommitter }): Promise<WorkspaceActionReceipt> {
    let request: WorkspaceActionRequest;
    try {
        request = defineWorkspaceActionRequest(input.request);
        assertDesignRequestIdentity(request, input.document);
        validateDesignActionEffects(request.actions);
    } catch (error) {
        return rejectedReceipt(input.request, input.document, error);
    }
    if (workspaceActionRequiresConfirmation(request) && !request.confirmation) return workspaceConfirmationRequiredReceipt(request);
    let compiled: CompiledDesignWorkspaceActions;
    try {
        assertWorkspaceActionAuthorized(request);
        if (request.actions.every((action) => action.effect === "read" || CONTROL_COMMANDS.has(action.command))) return readReceipt(request, input.document);
        compiled = compileDesignWorkspaceActions(request, input.document);
    } catch (error) {
        return rejectedReceipt(request, input.document, error);
    }
    let committed: DesignWorkspaceAgentCommit;
    try {
        committed = await input.commitBatch(compiled.batch);
    } catch (error) {
        if (isRevisionConflictError(error)) return rejectedReceipt(request, input.document, error);
        throw error;
    }
    try {
        return designReceiptToWorkspaceReceipt(request, committed.receipt, compiled);
    } catch (error) {
        return rejectedReceipt(request, input.document, error);
    }
}

export function designReceiptToWorkspaceReceipt(requestValue: WorkspaceActionRequest, receipt: DesignOperationReceipt, compiled?: CompiledDesignWorkspaceActions) {
    const request = defineWorkspaceActionRequest(requestValue);
    if (receipt.batchId !== request.batchId || receipt.baseRevision !== request.baseRevision) throw new WorkspaceAgentContractError("Design receipt 与 Agent action request 不匹配");
    if (compiled) validateDesignReceipt(compiled.batch, receipt);
    const resultByAction = mapDesignResultsToActions(request.actions, receipt, compiled?.operationIdsByAction);
    const errorResult = receipt.results.find((result) => result.error)?.error;
    const status = receipt.status === "applied" || receipt.status === "replayed" || receipt.status === "partial" || receipt.status === "conflict" ? receipt.status : "rejected";
    const error = errorResult
        ? { code: errorResult.code, message: errorResult.message, retryable: errorResult.code === "REVISION_CONFLICT" }
        : status === "rejected" || status === "conflict"
          ? { code: "DESIGN_OPERATION_REJECTED", message: "Design 操作批次被拒绝", retryable: status === "conflict" }
          : undefined;
    return defineWorkspaceActionReceipt(request, {
        surface: "design",
        projectId: request.projectId,
        batchId: request.batchId,
        fingerprint: workspaceActionRequestFingerprint(request),
        status,
        baseRevision: receipt.baseRevision,
        resultRevision: receipt.resultRevision,
        affectedIds: Array.from(new Set(receipt.results.flatMap((result) => result.affectedIds))),
        results: resultByAction,
        ...(error ? { error } : {}),
    });
}

function designActionToOperations(action: WorkspaceAction, document: DesignDocument): DesignOperation[] {
    assertDesignActionEffect(action);
    if (READ_COMMANDS.has(action.command) || CONTROL_COMMANDS.has(action.command)) return [];
    if (action.command === "content.create-frame") {
        const center = pointParameter(action, "position", false) ?? { x: 600, y: 600 };
        const frameId = singleTarget(action, false) || `frame-${action.actionId}`;
        const operation = createFrameOperation(document, frameId, operationId(action, 0), center);
        const width = numberParameter(action, "width", false);
        const height = numberParameter(action, "height", false);
        const name = stringParameter(action, "name", false);
        return [{ ...operation, frame: { ...operation.frame, ...(name ? { name } : {}), ...(width ? { width } : {}), ...(height ? { height } : {}) } }];
    }
    if (action.command === "content.create-element") {
        const elementId = singleTarget(action, false) || `element-${action.actionId}`;
        const kind = designElementKind(stringParameter(action, "elementKind", true));
        const frameId = stringParameter(action, "frameId", false);
        if (frameId && !document.frames.some((frame) => frame.id === frameId)) throw new WorkspaceAgentContractError(`Frame 不存在：${frameId}`);
        const selection = frameId ? ({ kind: "frame", id: frameId } as const) : null;
        const operation = createElementOperation(document, selection, kind, elementId, operationId(action, 0), pointParameter(action, "position", false) ?? { x: 600, y: 600 });
        const name = stringParameter(action, "name", false);
        const text = stringParameter(action, "text", false);
        if (text && operation.element.kind !== "text") throw new WorkspaceAgentContractError("只有文字元素可设置 text");
        return [{ ...operation, element: { ...operation.element, ...(name ? { name } : {}), ...(text && operation.element.kind === "text" ? { text } : {}) } as DesignElement }];
    }
    if (action.command === "content.update") return updateDesignElements(action, document);
    if (action.command === "content.delete") {
        assertElementTargets(action, document);
        return [{ opId: operationId(action, 0), type: "delete-elements", elementIds: [...action.targetIds] }];
    }
    if (action.command === "content.align") {
        assertElementTargets(action, document);
        const alignment = stringParameter(action, "alignment", true) as DesignAlignment;
        if (!(["left", "horizontal-center", "right", "top", "vertical-center", "bottom"] as const).includes(alignment)) throw new WorkspaceAgentContractError("alignment 无效");
        return alignDesignElements(document, [...action.targetIds], alignment, actionIdFactory(action));
    }
    if (action.command === "content.distribute") {
        assertElementTargets(action, document);
        const distribution = stringParameter(action, "distribution", true) as DesignDistribution;
        if (distribution !== "horizontal" && distribution !== "vertical") throw new WorkspaceAgentContractError("distribution 无效");
        return distributeDesignElements(document, [...action.targetIds], distribution, actionIdFactory(action));
    }
    if (action.command === "content.reorder") {
        assertElementTargets(action, document);
        const direction = stringParameter(action, "direction", true) as DesignLayerReorder;
        if (!(["forward", "backward", "front", "back"] as const).includes(direction)) throw new WorkspaceAgentContractError("reorder direction 无效");
        const operation = reorderDesignElements(document, [...action.targetIds], direction, actionIdFactory(action));
        if (!operation) throw new WorkspaceAgentContractError("当前元素无法按要求重排");
        return [operation];
    }
    if (action.command === "asset.insert-image") {
        const resource = resourceParameter(action, "resource");
        const mimeType = stringParameter(action, "mimeType", true);
        if (mimeType !== "image/png" && mimeType !== "image/jpeg" && mimeType !== "image/webp") throw new WorkspaceAgentContractError("图片 mimeType 无效");
        const frameId = stringParameter(action, "frameId", false);
        const target: DesignOperationScope = frameId ? { scope: "frame", frameId } : { scope: "workspace" };
        const batch = createDesignImageImportBatch(document, {
            requestId: action.actionId,
            name: stringParameter(action, "name", false) || "Agent 图片",
            locator: resource,
            mimeType,
            width: integerParameter(action, "width"),
            height: integerParameter(action, "height"),
            createdAt: stringParameter(action, "createdAt", false) || document.metadata.updatedAt,
            target,
            position: pointParameter(action, "position", false) ?? { x: 0, y: 0 },
            source: resource.kind === "library-asset" ? "library" : "upload",
            operation: "import",
        });
        return batch.operations.map((operation, index) => ({ ...operation, opId: operationId(action, index) }));
    }
    if (action.command === "generation.run") throw new WorkspaceAgentContractError("Design 生成动作必须先走 DQ generation task，成功结果再以 asset.insert-image 写回");
    throw new WorkspaceAgentContractError(`Design 不支持工作台命令：${action.command}`);
}

function updateDesignElements(action: WorkspaceAction, document: DesignDocument): DesignOperation[] {
    assertElementTargets(action, document);
    const position = pointParameter(action, "position", false);
    const width = numberParameter(action, "width", false);
    const height = numberParameter(action, "height", false);
    const rotation = numberParameter(action, "rotation", false);
    const name = stringParameter(action, "name", false);
    const opacity = numberParameter(action, "opacity", false);
    const locked = booleanParameter(action, "locked", false);
    const hidden = booleanParameter(action, "hidden", false);
    const text = stringParameter(action, "text", false);
    const operations: DesignOperation[] = [];
    action.targetIds.forEach((elementId, index) => {
        const element = document.elements.find((candidate) => candidate.id === elementId)!;
        if (position || width !== undefined || height !== undefined || rotation !== undefined) {
            operations.push({
                opId: operationId(action, index * 3),
                type: "update-transform",
                elementId,
                transform: { ...element.transform, ...(position ? { x: position.x, y: position.y } : {}), ...(width !== undefined ? { width } : {}), ...(height !== undefined ? { height } : {}), ...(rotation !== undefined ? { rotation } : {}) },
            });
        }
        if (name !== undefined || opacity !== undefined || locked !== undefined || hidden !== undefined) {
            operations.push({
                opId: operationId(action, index * 3 + 1),
                type: "update-element",
                elementId,
                patch: { ...(name !== undefined ? { name } : {}), ...(opacity !== undefined ? { opacity } : {}), ...(locked !== undefined ? { locked } : {}), ...(hidden !== undefined ? { hidden } : {}) },
            });
        }
        if (text !== undefined) {
            if (element.kind !== "text") throw new WorkspaceAgentContractError(`元素不是文字：${elementId}`);
            operations.push({ opId: operationId(action, index * 3 + 2), type: "update-text", elementId, patch: { text } });
        }
    });
    if (!operations.length) throw new WorkspaceAgentContractError("content.update 没有可应用的字段");
    return operations;
}

function designElementSnapshot(document: DesignDocument, element: DesignElement) {
    const version = element.kind === "image" ? document.assetVersions.find((candidate) => candidate.id === element.assetVersionId) : null;
    return {
        id: element.id,
        kind: element.kind,
        name: element.name,
        ...(element.frameId ? { parentId: element.frameId } : {}),
        locked: element.locked,
        hidden: element.hidden,
        bounds: { x: element.transform.x, y: element.transform.y, width: element.transform.width, height: element.transform.height },
        ...(element.kind === "text" ? { text: element.text } : {}),
        ...(version ? { resource: version.locator } : {}),
    };
}

function readReceipt(request: WorkspaceActionRequest, document: DesignDocument) {
    const documentIds = [...document.frames.map((frame) => frame.id), ...document.elements.map((element) => element.id)];
    const results = request.actions.map((action) => ({
        actionId: action.actionId,
        status: "applied" as const,
        affectedIds: action.command === "workspace.read" ? documentIds : action.command === "selection.read" ? [...action.targetIds] : [],
    }));
    const affectedIds = Array.from(new Set(results.flatMap((result) => result.affectedIds)));
    return defineWorkspaceActionReceipt(request, {
        surface: "design",
        projectId: request.projectId,
        batchId: request.batchId,
        fingerprint: workspaceActionRequestFingerprint(request),
        status: "applied",
        baseRevision: request.baseRevision,
        resultRevision: request.baseRevision,
        affectedIds,
        results,
    });
}

function mapDesignResultsToActions(actions: readonly WorkspaceAction[], receipt: DesignOperationReceipt, operationIdsByAction?: ReadonlyMap<string, readonly string[]>) {
    return actions.map((action) => {
        const ids = operationIdsByAction?.get(action.actionId);
        const results = ids
            ? ids.map((id) => receipt.results.find((result) => result.opId === id)).filter((result): result is DesignOperationReceipt["results"][number] => Boolean(result))
            : receipt.results.filter((result) => result.opId.startsWith(`op-${action.actionId}-`));
        const rejected = results.find((result) => result.status !== "applied" || result.error);
        return {
            actionId: action.actionId,
            status: rejected ? (rejected.status === "skipped" ? "skipped" : "rejected") : "applied",
            affectedIds: Array.from(new Set(results.flatMap((result) => result.affectedIds))),
            ...(rejected?.error ? { error: { code: rejected.error.code, message: rejected.error.message } } : {}),
        } as const;
    });
}

function validateDesignReceipt(batch: DesignOperationBatch, receipt: DesignOperationReceipt) {
    const expectedIds = batch.operations.map((operation) => operation.opId);
    const resultIds = receipt.results.map((result) => result.opId);
    if (receipt.fingerprint !== designOperationBatchFingerprint(batch) || expectedIds.length !== resultIds.length || expectedIds.some((id, index) => resultIds[index] !== id)) {
        throw new WorkspaceAgentContractError("Design 服务端回执与提交批次内容不匹配");
    }
}

function rejectedReceipt(requestValue: WorkspaceActionRequest, document: DesignDocument, error: unknown): WorkspaceActionReceipt {
    let request: WorkspaceActionRequest;
    try {
        request = defineWorkspaceActionRequest(requestValue);
    } catch {
        request = defineWorkspaceActionRequest({
            surface: "design",
            projectId: document.id,
            baseRevision: document.revision,
            batchId: "invalid-agent-request",
            actions: [{ actionId: "invalid-agent-action", kind: "inspect", effect: "read", command: "workspace.read", label: "无效请求", targetIds: [], parameters: {} }],
        });
    }
    const message = error instanceof Error ? error.message : "Design Agent 操作无效";
    const code = isRevisionConflictError(error) ? "REVISION_CONFLICT" : /LOCKED|锁定/.test(message) ? "LOCKED" : /资源|locator|storageKey/i.test(message) ? "RESOURCE_INVALID" : "INVALID_ACTION";
    const status = code === "REVISION_CONFLICT" ? "conflict" : "rejected";
    const receiptError = { code, message, retryable: code === "REVISION_CONFLICT" };
    return defineWorkspaceActionReceipt(request, {
        surface: request.surface,
        projectId: request.projectId,
        batchId: request.batchId,
        fingerprint: workspaceActionRequestFingerprint(request),
        status,
        baseRevision: request.baseRevision,
        resultRevision: document.revision,
        affectedIds: [],
        results: request.actions.map((action) => ({ actionId: action.actionId, status: "rejected", affectedIds: [], error: receiptError })),
        error: receiptError,
    });
}

function isRevisionConflictError(error: unknown) {
    const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
    const message = error instanceof Error ? error.message : "";
    return status === 409 || /REVISION_CONFLICT|revision\s*(?:冲突|conflict)/i.test(message);
}

function designReceiptError(receipt: DesignOperationReceipt) {
    const error = receipt.results.find((result) => result.error)?.error;
    return new WorkspaceAgentContractError(error ? `${error.code}: ${error.message}` : `Design batch 预验失败：${receipt.status}`);
}

function assertDesignRequestIdentity(request: WorkspaceActionRequest, document: DesignDocument) {
    if (request.surface !== "design" || request.projectId !== document.id) throw new WorkspaceAgentContractError("Design action request 不属于当前项目");
    if (request.baseRevision !== document.revision) throw new WorkspaceAgentContractError(`Design revision 冲突：期望 ${request.baseRevision}，当前 ${document.revision}`);
}

function validateDesignActionEffects(actions: readonly WorkspaceAction[]) {
    actions.forEach(assertDesignActionEffect);
}

function assertDesignActionEffect(action: WorkspaceAction) {
    if (READ_COMMANDS.has(action.command) && action.effect !== "read") throw new WorkspaceAgentContractError(`${action.command} 必须声明为 read`);
    if (WRITE_COMMANDS.has(action.command) && action.effect !== "write") throw new WorkspaceAgentContractError(`${action.command} 必须声明为 write`);
    if (CONTROL_COMMANDS.has(action.command) && action.effect !== "write") throw new WorkspaceAgentContractError(`${action.command} 必须声明为 write`);
    if (!READ_COMMANDS.has(action.command) && !CONTROL_COMMANDS.has(action.command) && !WRITE_COMMANDS.has(action.command)) throw new WorkspaceAgentContractError(`Design 不支持工作台命令：${action.command}`);
}

function assertElementTargets(action: WorkspaceAction, document: DesignDocument) {
    if (!action.targetIds.length) throw new WorkspaceAgentContractError(`${action.command} 缺少目标元素`);
    const elements = action.targetIds.map((id) => document.elements.find((element) => element.id === id));
    const missing = elements.findIndex((element) => !element);
    if (missing >= 0) throw new WorkspaceAgentContractError(`元素不存在：${action.targetIds[missing]}`);
    const locked = elements.find((element) => element?.locked);
    if (locked) throw new WorkspaceAgentContractError(`元素已锁定：${locked.id}`);
}

function operationId(action: WorkspaceAction, index: number) {
    return `op-${action.actionId}-${index}`;
}

function actionIdFactory(action: WorkspaceAction) {
    let index = 0;
    return () => `${action.actionId}-${index++}`;
}

function selectedFirst<T extends { id: string }>(items: readonly T[], selectedIds: readonly string[]) {
    const selected = new Set(selectedIds);
    return [...items.filter((item) => selected.has(item.id)), ...items.filter((item) => !selected.has(item.id))];
}

function singleTarget(action: WorkspaceAction, required: boolean) {
    if (action.targetIds.length > 1 || (required && action.targetIds.length !== 1)) throw new WorkspaceAgentContractError(`${action.command} 必须指定一个目标`);
    return action.targetIds[0];
}

function designElementKind(value: string): DesignCreatableElementKind {
    if (!(["text", "rectangle", "ellipse", "line", "arrow"] as const).includes(value as DesignCreatableElementKind)) throw new WorkspaceAgentContractError(`Design elementKind 无效：${value}`);
    return value as DesignCreatableElementKind;
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

function integerParameter(action: WorkspaceAction, key: string) {
    const value = numberParameter(action, key, true);
    if (!Number.isSafeInteger(value) || value <= 0) throw new WorkspaceAgentContractError(`${action.command}.${key} 必须是正整数`);
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

function resourceParameter(action: WorkspaceAction, key: string) {
    const value = action.parameters[key];
    if (!value || typeof value !== "object" || !("kind" in value) || (value.kind !== "storage-key" && value.kind !== "library-asset")) throw new WorkspaceAgentContractError(`${action.command}.${key} 必须是稳定资源定位符`);
    return value;
}
