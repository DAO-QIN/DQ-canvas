import { sha256Hex } from "@/lib/sha256";

export const WORKSPACE_HANDOFF_SURFACES = ["canvas", "design"] as const;
export const WORKSPACE_HANDOFF_RECEIPT_STATUSES = ["applied", "replayed", "conflict", "rejected"] as const;

export type WorkspaceHandoffSurface = (typeof WORKSPACE_HANDOFF_SURFACES)[number];
export type WorkspaceHandoffReceiptStatus = (typeof WORKSPACE_HANDOFF_RECEIPT_STATUSES)[number];

export type WorkspaceHandoffSource = Readonly<{
    surface: WorkspaceHandoffSurface;
    projectId: string;
    revision: number;
    selectionIds: readonly string[];
}>;

export type WorkspaceHandoffTarget = Readonly<{
    surface: WorkspaceHandoffSurface;
    projectId: string;
    baseRevision: number;
}>;

export type WorkspaceHandoffRequest = Readonly<{
    handoffId: string;
    source: WorkspaceHandoffSource;
    target: WorkspaceHandoffTarget;
}>;

export type WorkspaceHandoffReceipt = Readonly<{
    handoffId: string;
    fingerprint: string;
    status: WorkspaceHandoffReceiptStatus;
    originalStatus?: Exclude<WorkspaceHandoffReceiptStatus, "replayed">;
    source: WorkspaceHandoffSource;
    target: Readonly<{
        surface: WorkspaceHandoffSurface;
        projectId: string;
        baseRevision: number;
        resultRevision: number;
    }>;
    targetBatchId: string;
    targetFingerprint: string | null;
    targetIds: readonly string[];
    error?: Readonly<{ code: string; message: string; retryable: boolean }>;
}>;

export class WorkspaceHandoffContractError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "WorkspaceHandoffContractError";
    }
}

const MAX_ID_LENGTH = 160;
const MAX_HANDOFF_ID_LENGTH = 96;
const MAX_SELECTION = 20;

export function parseWorkspaceHandoffRequest(value: unknown): WorkspaceHandoffRequest {
    const input = strictRecord(value, ["handoffId", "source", "target"], "handoff request");
    const handoffId = id(input.handoffId, "handoffId", MAX_HANDOFF_ID_LENGTH);
    const sourceInput = strictRecord(input.source, ["surface", "projectId", "revision", "selectionIds"], "source");
    const targetInput = strictRecord(input.target, ["surface", "projectId", "baseRevision"], "target");
    const source = Object.freeze({
        surface: surface(sourceInput.surface, "source.surface"),
        projectId: id(sourceInput.projectId, "source.projectId"),
        revision: revision(sourceInput.revision, "source.revision"),
        selectionIds: selectionIds(sourceInput.selectionIds),
    });
    const target = Object.freeze({
        surface: surface(targetInput.surface, "target.surface"),
        projectId: id(targetInput.projectId, "target.projectId"),
        baseRevision: revision(targetInput.baseRevision, "target.baseRevision"),
    });
    if (source.surface === target.surface) throw invalid("source.surface 与 target.surface 必须不同");
    if (source.projectId === target.projectId) throw invalid("source.projectId 与 target.projectId 必须不同");
    return Object.freeze({ handoffId, source, target });
}

export function workspaceHandoffRequestFingerprint(value: WorkspaceHandoffRequest) {
    return `sha256:${sha256Hex(stableStringify(parseWorkspaceHandoffRequest(value)))}`;
}

function selectionIds(value: unknown) {
    if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SELECTION) throw invalid(`source.selectionIds 必须包含 1 到 ${MAX_SELECTION} 项`);
    const result = value.map((item, index) => id(item, `source.selectionIds[${index}]`));
    if (new Set(result).size !== result.length) throw invalid("source.selectionIds 不能重复");
    return Object.freeze(result);
}

function surface(value: unknown, label: string): WorkspaceHandoffSurface {
    if (value !== "canvas" && value !== "design") throw invalid(`${label} 必须是 canvas 或 design`);
    return value;
}

function revision(value: unknown, label: string) {
    if (!Number.isSafeInteger(value) || Number(value) < 0) throw invalid(`${label} 必须是非负安全整数`);
    return Number(value);
}

function id(value: unknown, label: string, maximum = MAX_ID_LENGTH) {
    if (typeof value !== "string" || value.length < 1 || value.length > maximum || value.trim() !== value || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) throw invalid(`${label} 无效`);
    return value;
}

function strictRecord(value: unknown, keys: readonly string[], label: string) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(`${label} 必须是对象`);
    const input = value as Record<string, unknown>;
    const allowed = new Set(keys);
    const unknown = Object.keys(input).find((key) => !allowed.has(key));
    if (unknown) throw invalid(`${label} 包含未知字段 ${unknown}`);
    const missing = keys.find((key) => !(key in input));
    if (missing) throw invalid(`${label} 缺少字段 ${missing}`);
    return input;
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
            .filter(([, nested]) => nested !== undefined)
            .toSorted(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}

function invalid(message: string): WorkspaceHandoffContractError {
    return new WorkspaceHandoffContractError(message);
}
