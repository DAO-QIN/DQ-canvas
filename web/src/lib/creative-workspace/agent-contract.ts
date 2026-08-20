import { sha256Hex } from "@/lib/sha256";

export const WORKSPACE_AGENT_SURFACES = ["canvas", "design"] as const;
export const WORKSPACE_AGENT_ACTION_KINDS = ["inspect", "select", "create", "update", "arrange", "delete", "generate"] as const;
export const WORKSPACE_AGENT_RECEIPT_STATUSES = ["applied", "partial", "rejected", "replayed", "conflict", "confirmation-required"] as const;

export type WorkspaceAgentSurface = (typeof WORKSPACE_AGENT_SURFACES)[number];
export type WorkspaceActionKind = (typeof WORKSPACE_AGENT_ACTION_KINDS)[number];
export type WorkspaceActionEffect = "read" | "write";
export type WorkspaceActionReceiptStatus = (typeof WORKSPACE_AGENT_RECEIPT_STATUSES)[number];
export type WorkspaceStableResourceLocator = Readonly<{ kind: "storage-key"; storageKey: string } | { kind: "library-asset"; libraryAssetId: string }>;
export type WorkspaceSnapshotEntity = Readonly<{
    id: string;
    kind: string;
    name: string;
    parentId?: string;
    locked?: boolean;
    hidden?: boolean;
    bounds?: Readonly<{ x: number; y: number; width: number; height: number }>;
    text?: string;
    resource?: WorkspaceStableResourceLocator;
}>;

export type WorkspaceSnapshot = Readonly<{
    schemaVersion: 1;
    surface: WorkspaceAgentSurface;
    projectId: string;
    title: string;
    revision: number;
    selectionIds: readonly string[];
    entities: readonly WorkspaceSnapshotEntity[];
    relations: readonly Readonly<{ id: string; fromId: string; toId: string; kind: string }>[];
    truncated: boolean;
}>;

export type WorkspaceAction = Readonly<{
    actionId: string;
    kind: WorkspaceActionKind;
    effect: WorkspaceActionEffect;
    command: string;
    label: string;
    targetIds: readonly string[];
    parameters: Readonly<Record<string, WorkspaceActionValue>>;
}>;

export type WorkspaceActionValue = string | number | boolean | null | WorkspaceStableResourceLocator | readonly string[] | Readonly<{ x: number; y: number; width?: number; height?: number }>;

export type WorkspaceActionRequest = Readonly<{
    surface: WorkspaceAgentSurface;
    projectId: string;
    baseRevision: number;
    batchId: string;
    actions: readonly WorkspaceAction[];
    confirmation?: WorkspaceActionConfirmation;
}>;

export type WorkspaceActionConfirmation = Readonly<{
    batchId: string;
    fingerprint: string;
    confirmedAt: string;
}>;

export type WorkspaceActionReceipt = Readonly<{
    surface: WorkspaceAgentSurface;
    projectId: string;
    batchId: string;
    fingerprint: string;
    status: WorkspaceActionReceiptStatus;
    baseRevision: number;
    resultRevision: number;
    affectedIds: readonly string[];
    results: readonly Readonly<{ actionId: string; status: "applied" | "rejected" | "skipped"; affectedIds: readonly string[]; error?: Readonly<{ code: string; message: string }> }>[];
    error?: Readonly<{ code: string; message: string; retryable: boolean }>;
}>;

export class WorkspaceAgentContractError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "WorkspaceAgentContractError";
    }
}

const MAX_ID_LENGTH = 160;
const MAX_LABEL_LENGTH = 400;
const MAX_TEXT_LENGTH = 2_000;
const MAX_ENTITIES = 500;
const MAX_RELATIONS = 1_000;
const MAX_ACTIONS = 100;
export const MAX_WORKSPACE_SNAPSHOT_BYTES = 256 * 1024;

export function defineWorkspaceSnapshot(value: WorkspaceSnapshot): WorkspaceSnapshot {
    const snapshot = normalizeWorkspaceSnapshot(value);
    if (byteLength(snapshot) > MAX_WORKSPACE_SNAPSHOT_BYTES) throw new WorkspaceAgentContractError("工作台快照超过 256 KiB 上限");
    return snapshot;
}

export function defineWorkspaceActionRequest(value: WorkspaceActionRequest): WorkspaceActionRequest {
    const input = strictRecord(value, ["surface", "projectId", "baseRevision", "batchId", "actions", "confirmation"], "action request");
    const surface = workspaceSurface(input.surface);
    const projectId = id(input.projectId, "projectId");
    const batchId = id(input.batchId, "batchId");
    const baseRevision = revision(input.baseRevision, "baseRevision");
    if (!Array.isArray(input.actions) || input.actions.length < 1 || input.actions.length > MAX_ACTIONS) throw new WorkspaceAgentContractError(`actions 必须包含 1 到 ${MAX_ACTIONS} 项`);
    const seen = new Set<string>();
    const actions = Object.freeze(input.actions.map((action, index) => normalizeAction(action, index, seen)));
    const provisional = Object.freeze({ surface, projectId, baseRevision, batchId, actions });
    const confirmation = input.confirmation === undefined ? undefined : normalizeConfirmation(input.confirmation, provisional);
    return Object.freeze({ ...provisional, ...(confirmation ? { confirmation } : {}) });
}

export function workspaceActionRequestFingerprint(value: Omit<WorkspaceActionRequest, "confirmation"> | WorkspaceActionRequest) {
    const normalized = defineWorkspaceActionRequest({ ...value, confirmation: undefined });
    return `sha256:${sha256Hex(stableStringify(normalized))}`;
}

export function workspaceActionRequiresConfirmation(value: WorkspaceActionRequest) {
    return defineWorkspaceActionRequest(value).actions.some((action) => action.effect === "write");
}

export function confirmWorkspaceActionRequest(value: WorkspaceActionRequest, confirmedAt = new Date().toISOString()): WorkspaceActionRequest {
    const request = defineWorkspaceActionRequest({ ...value, confirmation: undefined });
    if (!request.actions.some((action) => action.effect === "write")) return request;
    return defineWorkspaceActionRequest({ ...request, confirmation: { batchId: request.batchId, fingerprint: workspaceActionRequestFingerprint(request), confirmedAt } });
}

export function assertWorkspaceActionAuthorized(value: WorkspaceActionRequest) {
    const request = defineWorkspaceActionRequest(value);
    if (!request.actions.some((action) => action.effect === "write")) return request;
    const expected = workspaceActionRequestFingerprint(request);
    if (!request.confirmation || request.confirmation.batchId !== request.batchId || request.confirmation.fingerprint !== expected) throw new WorkspaceAgentContractError("写操作必须经过当前批次的显式确认");
    return request;
}

export function defineWorkspaceActionReceipt(requestValue: WorkspaceActionRequest, receiptValue: WorkspaceActionReceipt): WorkspaceActionReceipt {
    const request = defineWorkspaceActionRequest(requestValue);
    const input = strictRecord(receiptValue, ["surface", "projectId", "batchId", "fingerprint", "status", "baseRevision", "resultRevision", "affectedIds", "results", "error"], "action receipt");
    const status = WORKSPACE_AGENT_RECEIPT_STATUSES.includes(input.status as WorkspaceActionReceiptStatus) ? (input.status as WorkspaceActionReceiptStatus) : invalid("receipt status 无效");
    const fingerprint = text(input.fingerprint, "fingerprint", 80);
    if (input.surface !== request.surface || input.projectId !== request.projectId || input.batchId !== request.batchId || input.baseRevision !== request.baseRevision || fingerprint !== workspaceActionRequestFingerprint(request)) {
        throw new WorkspaceAgentContractError("领域适配器返回了不匹配的工作台回执");
    }
    const resultRevision = revision(input.resultRevision, "resultRevision");
    const affectedIds = uniqueIds(input.affectedIds, "affectedIds", MAX_ENTITIES);
    if (!Array.isArray(input.results) || input.results.length !== request.actions.length) throw new WorkspaceAgentContractError("receipt results 必须与 actions 一一对应");
    const actionIds = new Set(request.actions.map((action) => action.actionId));
    const results = Object.freeze(input.results.map((value, index) => normalizeResult(value, index, actionIds)));
    const resultActionIds = new Set(results.map((result) => result.actionId));
    if (resultActionIds.size !== results.length || resultActionIds.size !== actionIds.size || [...actionIds].some((actionId) => !resultActionIds.has(actionId))) {
        throw new WorkspaceAgentContractError("receipt results 必须与 actions 唯一对应");
    }
    const error = input.error === undefined ? undefined : normalizeError(input.error);
    if (["rejected", "conflict", "confirmation-required"].includes(status) && !error) throw new WorkspaceAgentContractError(`${status} 回执必须包含错误`);
    if ((status === "applied" || status === "replayed") && (error || results.some((result) => result.status !== "applied"))) throw new WorkspaceAgentContractError(`${status} 回执不能包含未执行动作`);
    if (status === "partial" && (!results.some((result) => result.status === "applied") || !results.some((result) => result.status !== "applied"))) throw new WorkspaceAgentContractError("partial 回执必须同时包含已执行和未执行动作");
    const resultAffectedIds = Array.from(new Set(results.flatMap((result) => result.affectedIds))).sort();
    if (JSON.stringify([...affectedIds].sort()) !== JSON.stringify(resultAffectedIds)) throw new WorkspaceAgentContractError("receipt affectedIds 与动作结果不一致");
    return Object.freeze({ surface: request.surface, projectId: request.projectId, batchId: request.batchId, fingerprint, status, baseRevision: request.baseRevision, resultRevision, affectedIds, results, ...(error ? { error } : {}) });
}

export function workspaceConfirmationRequiredReceipt(value: WorkspaceActionRequest): WorkspaceActionReceipt {
    const request = defineWorkspaceActionRequest(value);
    const error = Object.freeze({ code: "CONFIRMATION_REQUIRED", message: "写操作需要用户显式确认", retryable: true });
    return defineWorkspaceActionReceipt(request, {
        surface: request.surface,
        projectId: request.projectId,
        batchId: request.batchId,
        fingerprint: workspaceActionRequestFingerprint(request),
        status: "confirmation-required",
        baseRevision: request.baseRevision,
        resultRevision: request.baseRevision,
        affectedIds: [],
        results: request.actions.map((action) => ({ actionId: action.actionId, status: "skipped", affectedIds: [], error })),
        error,
    });
}

function normalizeWorkspaceSnapshot(value: WorkspaceSnapshot): WorkspaceSnapshot {
    const input = strictRecord(value, ["schemaVersion", "surface", "projectId", "title", "revision", "selectionIds", "entities", "relations", "truncated"], "snapshot");
    if (input.schemaVersion !== 1) throw new WorkspaceAgentContractError("snapshot.schemaVersion 无效");
    if (!Array.isArray(input.entities) || input.entities.length > MAX_ENTITIES) throw new WorkspaceAgentContractError(`snapshot.entities 最多 ${MAX_ENTITIES} 项`);
    if (!Array.isArray(input.relations) || input.relations.length > MAX_RELATIONS) throw new WorkspaceAgentContractError(`snapshot.relations 最多 ${MAX_RELATIONS} 项`);
    const entityIds = new Set<string>();
    const entities = Object.freeze(input.entities.map((value, index) => normalizeEntity(value, index, entityIds)));
    const relationIds = new Set<string>();
    const relations = Object.freeze(input.relations.map((value, index) => normalizeRelation(value, index, relationIds, entityIds)));
    return Object.freeze({
        schemaVersion: 1,
        surface: workspaceSurface(input.surface),
        projectId: id(input.projectId, "snapshot.projectId"),
        title: text(input.title, "snapshot.title", MAX_LABEL_LENGTH),
        revision: revision(input.revision, "snapshot.revision"),
        selectionIds: uniqueIds(input.selectionIds, "snapshot.selectionIds", MAX_ENTITIES).filter((selectedId) => entityIds.has(selectedId)),
        entities,
        relations,
        truncated: Boolean(input.truncated),
    });
}

function normalizeEntity(value: unknown, index: number, seen: Set<string>): WorkspaceSnapshotEntity {
    const input = strictRecord(value, ["id", "kind", "name", "parentId", "locked", "hidden", "bounds", "text", "resource"], `entities[${index}]`, false);
    const entityId = id(input.id, `entities[${index}].id`);
    if (seen.has(entityId)) throw new WorkspaceAgentContractError(`snapshot entity id 重复：${entityId}`);
    seen.add(entityId);
    const parentId = input.parentId === undefined ? undefined : id(input.parentId, `entities[${index}].parentId`);
    const bounds = input.bounds === undefined ? undefined : normalizeEntityBounds(input.bounds, `entities[${index}].bounds`);
    const resource = input.resource === undefined ? undefined : normalizeResource(input.resource, `entities[${index}].resource`);
    return Object.freeze({
        id: entityId,
        kind: text(input.kind, `entities[${index}].kind`, 80),
        name: text(input.name, `entities[${index}].name`, MAX_LABEL_LENGTH),
        ...(parentId ? { parentId } : {}),
        ...(input.locked === undefined ? {} : { locked: Boolean(input.locked) }),
        ...(input.hidden === undefined ? {} : { hidden: Boolean(input.hidden) }),
        ...(bounds ? { bounds } : {}),
        ...(input.text === undefined ? {} : { text: text(input.text, `entities[${index}].text`, MAX_TEXT_LENGTH) }),
        ...(resource ? { resource } : {}),
    });
}

function normalizeRelation(value: unknown, index: number, seen: Set<string>, entityIds: Set<string>) {
    const input = strictRecord(value, ["id", "fromId", "toId", "kind"], `relations[${index}]`);
    const relationId = id(input.id, `relations[${index}].id`);
    if (seen.has(relationId)) throw new WorkspaceAgentContractError(`snapshot relation id 重复：${relationId}`);
    seen.add(relationId);
    const fromId = id(input.fromId, `relations[${index}].fromId`);
    const toId = id(input.toId, `relations[${index}].toId`);
    if (!entityIds.has(fromId) || !entityIds.has(toId)) throw new WorkspaceAgentContractError(`relations[${index}] 引用了不存在的实体`);
    return Object.freeze({ id: relationId, fromId, toId, kind: text(input.kind, `relations[${index}].kind`, 80) });
}

function normalizeAction(value: unknown, index: number, seen: Set<string>): WorkspaceAction {
    const input = strictRecord(value, ["actionId", "kind", "effect", "command", "label", "targetIds", "parameters"], `actions[${index}]`);
    const actionId = id(input.actionId, `actions[${index}].actionId`);
    if (seen.has(actionId)) throw new WorkspaceAgentContractError(`actionId 重复：${actionId}`);
    seen.add(actionId);
    if (!WORKSPACE_AGENT_ACTION_KINDS.includes(input.kind as WorkspaceActionKind)) throw new WorkspaceAgentContractError(`actions[${index}].kind 无效`);
    if (input.effect !== "read" && input.effect !== "write") throw new WorkspaceAgentContractError(`actions[${index}].effect 无效`);
    const parametersInput = strictRecord(input.parameters, undefined, `actions[${index}].parameters`);
    if (Object.keys(parametersInput).length > 30) throw new WorkspaceAgentContractError(`actions[${index}].parameters 字段过多`);
    const parameters = Object.freeze(
        Object.fromEntries(
            Object.entries(parametersInput).map(([key, parameter]) => {
                const parameterKey = id(key, `actions[${index}].parameters key`);
                if (sensitiveKey(parameterKey)) throw new WorkspaceAgentContractError(`actions[${index}].parameters 包含敏感字段`);
                return [parameterKey, normalizeParameter(parameter, `actions[${index}].parameters.${key}`)];
            }),
        ),
    );
    return Object.freeze({
        actionId,
        kind: input.kind as WorkspaceActionKind,
        effect: input.effect,
        command: text(input.command, `actions[${index}].command`, 120),
        label: text(input.label, `actions[${index}].label`, MAX_LABEL_LENGTH),
        targetIds: uniqueIds(input.targetIds, `actions[${index}].targetIds`, MAX_ENTITIES),
        parameters,
    });
}

function normalizeParameter(value: unknown, label: string): WorkspaceActionValue {
    if (typeof value === "string") return text(value, label, MAX_TEXT_LENGTH);
    if (typeof value === "boolean" || value === null) return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return Object.freeze(uniqueIds(value, label, MAX_ENTITIES));
    const input = strictRecord(value, undefined, label);
    if (input.kind === "storage-key" || input.kind === "library-asset") return normalizeResource(input, label);
    return normalizeBounds(input, label);
}

function normalizeResource(value: unknown, label: string): WorkspaceStableResourceLocator {
    const input = strictRecord(value, undefined, label);
    if (input.kind === "storage-key") {
        strictRecord(input, ["kind", "storageKey"], label);
        const storageKey = stableLocatorValue(input.storageKey, `${label}.storageKey`);
        return Object.freeze({ kind: "storage-key", storageKey });
    }
    if (input.kind === "library-asset") {
        strictRecord(input, ["kind", "libraryAssetId"], label);
        return Object.freeze({ kind: "library-asset", libraryAssetId: id(input.libraryAssetId, `${label}.libraryAssetId`) });
    }
    throw new WorkspaceAgentContractError(`${label}.kind 无效`);
}

function normalizeBounds(value: unknown, label: string) {
    const input = strictRecord(value, undefined, label);
    const allowed = input.width === undefined && input.height === undefined ? ["x", "y"] : ["x", "y", "width", "height"];
    strictRecord(input, allowed, label);
    const x = finiteNumber(input.x, `${label}.x`);
    const y = finiteNumber(input.y, `${label}.y`);
    if (allowed.length === 2) return Object.freeze({ x, y });
    const width = finiteNumber(input.width, `${label}.width`, true);
    const height = finiteNumber(input.height, `${label}.height`, true);
    return Object.freeze({ x, y, width, height });
}

function normalizeEntityBounds(value: unknown, label: string) {
    const input = strictRecord(value, ["x", "y", "width", "height"], label);
    return Object.freeze({
        x: finiteNumber(input.x, `${label}.x`),
        y: finiteNumber(input.y, `${label}.y`),
        width: finiteNumber(input.width, `${label}.width`, true),
        height: finiteNumber(input.height, `${label}.height`, true),
    });
}

function normalizeConfirmation(value: unknown, request: Omit<WorkspaceActionRequest, "confirmation">): WorkspaceActionConfirmation {
    const input = strictRecord(value, ["batchId", "fingerprint", "confirmedAt"], "confirmation");
    const confirmation = Object.freeze({ batchId: id(input.batchId, "confirmation.batchId"), fingerprint: text(input.fingerprint, "confirmation.fingerprint", 80), confirmedAt: isoTimestamp(input.confirmedAt, "confirmation.confirmedAt") });
    if (confirmation.batchId !== request.batchId || confirmation.fingerprint !== workspaceActionRequestFingerprint(request)) throw new WorkspaceAgentContractError("确认信息与当前批次不匹配");
    return confirmation;
}

function normalizeResult(value: unknown, index: number, actionIds: Set<string>) {
    const input = strictRecord(value, ["actionId", "status", "affectedIds", "error"], `results[${index}]`);
    const actionId = id(input.actionId, `results[${index}].actionId`);
    if (!actionIds.has(actionId)) throw new WorkspaceAgentContractError(`results[${index}] 对应未知 actionId`);
    if (input.status !== "applied" && input.status !== "rejected" && input.status !== "skipped") throw new WorkspaceAgentContractError(`results[${index}].status 无效`);
    const error = input.error === undefined ? undefined : normalizeResultError(input.error, `results[${index}].error`);
    if (input.status !== "applied" && !error) throw new WorkspaceAgentContractError(`results[${index}] 未执行时必须包含错误`);
    return Object.freeze({ actionId, status: input.status, affectedIds: uniqueIds(input.affectedIds, `results[${index}].affectedIds`, MAX_ENTITIES), ...(error ? { error } : {}) });
}

function normalizeResultError(value: unknown, label: string) {
    const input = strictRecord(value, ["code", "message", "retryable"], label, false);
    return Object.freeze({ code: text(input.code, `${label}.code`, 120), message: text(input.message, `${label}.message`, 1_000), ...(input.retryable === undefined ? {} : { retryable: Boolean(input.retryable) }) });
}

function normalizeError(value: unknown) {
    const input = strictRecord(value, ["code", "message", "retryable"], "receipt.error");
    return Object.freeze({ code: text(input.code, "receipt.error.code", 120), message: text(input.message, "receipt.error.message", 1_000), retryable: Boolean(input.retryable) });
}

function strictRecord(value: unknown, allowed: readonly string[] | undefined, label: string, requireAll = true) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkspaceAgentContractError(`${label} 必须是对象`);
    const input = value as Record<string, unknown>;
    if (allowed) {
        const allowedSet = new Set(allowed);
        const unknownKey = Object.keys(input).find((key) => !allowedSet.has(key));
        if (unknownKey) throw new WorkspaceAgentContractError(`${label} 包含未知字段 ${unknownKey}`);
        if (requireAll) {
            const missing = allowed.find((key) => key !== "confirmation" && key !== "error" && !(key in input));
            if (missing) throw new WorkspaceAgentContractError(`${label} 缺少字段 ${missing}`);
        }
    }
    return input;
}

function workspaceSurface(value: unknown): WorkspaceAgentSurface {
    return WORKSPACE_AGENT_SURFACES.includes(value as WorkspaceAgentSurface) ? (value as WorkspaceAgentSurface) : invalid("surface 必须是 canvas 或 design");
}

function id(value: unknown, label: string) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > MAX_ID_LENGTH || !/^[A-Za-z0-9][A-Za-z0-9_:.\/-]*$/.test(value.trim())) throw new WorkspaceAgentContractError(`${label} 无效`);
    return value.trim();
}

function text(value: unknown, label: string, max: number) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > max || unsafeString(value)) throw new WorkspaceAgentContractError(`${label} 无效或包含临时/敏感数据`);
    return value.trim();
}

function stableLocatorValue(value: unknown, label: string) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > 1_024 || unsafeString(value) || /^temporary(?:\/|:)/i.test(value.trim())) throw new WorkspaceAgentContractError(`${label} 必须是稳定存储键`);
    return value.trim();
}

function unsafeString(value: string) {
    const normalized = value.trim();
    return /^(?:data|blob|https?):/i.test(normalized) || /(?:^|[_-])(?:api[_-]?key|access[_-]?token|authorization|secret)(?:$|[_-])/i.test(normalized);
}

function sensitiveKey(value: string) {
    return /(?:^|[_-])(?:api[_-]?key|access[_-]?token|authorization|password|secret)(?:$|[_-])/i.test(value);
}

function uniqueIds(value: unknown, label: string, max: number) {
    if (!Array.isArray(value) || value.length > max) throw new WorkspaceAgentContractError(`${label} 无效`);
    return Object.freeze(Array.from(new Set(value.map((item, index) => id(item, `${label}[${index}]`)))));
}

function revision(value: unknown, label: string) {
    if (!Number.isSafeInteger(value) || Number(value) < 0) throw new WorkspaceAgentContractError(`${label} 无效`);
    return Number(value);
}

function finiteNumber(value: unknown, label: string, positive = false) {
    if (typeof value !== "number" || !Number.isFinite(value) || (positive && value <= 0)) throw new WorkspaceAgentContractError(`${label} 无效`);
    return value;
}

function isoTimestamp(value: unknown, label: string) {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new WorkspaceAgentContractError(`${label} 无效`);
    return new Date(value).toISOString();
}

function byteLength(value: object) {
    return new TextEncoder().encode(JSON.stringify(value)).length;
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

function invalid(message: string): never {
    throw new WorkspaceAgentContractError(message);
}
