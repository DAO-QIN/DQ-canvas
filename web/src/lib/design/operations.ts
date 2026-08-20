import { sha256Hex } from "./fingerprint";
import { DESIGN_LIMITS } from "./limits";
import type { DesignHistorySource, DesignHistoryTransaction } from "./history";
import type { DesignAnnotation, DesignAsset, DesignAssetVersion, DesignElement, DesignFrame, DesignGuide, DesignNormalizedRect, DesignTransform, DesignWorkspace } from "./schema";

export type DesignOperationScope = { scope: "workspace" } | { scope: "frame"; frameId: string };

type DesignOperationBase = { opId: string };

export type DesignOperation =
    | (DesignOperationBase & { type: "update-workspace"; patch: Partial<Pick<DesignWorkspace, "background" | "viewport">> })
    | (DesignOperationBase & { type: "create-frame"; frame: DesignFrame; index: number })
    | (DesignOperationBase & { type: "update-frame"; frameId: string; patch: Partial<Pick<DesignFrame, "name" | "x" | "y" | "width" | "height" | "background" | "locked" | "export">> })
    | (DesignOperationBase & { type: "delete-frame"; frameId: string; deleteElements: boolean })
    | (DesignOperationBase & { type: "create-guide"; guide: DesignGuide })
    | (DesignOperationBase & { type: "update-guide"; guideId: string; patch: Partial<Pick<DesignGuide, "axis" | "position" | "frameId" | "locked">> })
    | (DesignOperationBase & { type: "delete-guide"; guideId: string })
    | (DesignOperationBase & { type: "create-element"; element: DesignElement; index: number })
    | (DesignOperationBase & { type: "update-transform"; elementId: string; transform: DesignTransform })
    | (DesignOperationBase & { type: "update-element"; elementId: string; patch: { name?: string; opacity?: number; locked?: boolean; hidden?: boolean } })
    | (DesignOperationBase & {
          type: "update-text";
          elementId: string;
          patch: Partial<Pick<Extract<DesignElement, { kind: "text" }>, "text" | "fontFamily" | "fontSize" | "fontWeight" | "fontStyle" | "lineHeight" | "letterSpacing" | "align" | "verticalAlign" | "fill" | "stroke" | "strokeWidth">>;
      })
    | (DesignOperationBase & {
          type: "update-shape";
          elementId: string;
          patch: Partial<Pick<Extract<DesignElement, { kind: "shape" }>, "fill" | "stroke" | "strokeWidth" | "cornerRadius">>;
      })
    | (DesignOperationBase & {
          type: "update-line";
          elementId: string;
          patch: Partial<Pick<Extract<DesignElement, { kind: "line" }>, "stroke" | "strokeWidth" | "dash" | "cap">>;
      })
    | (DesignOperationBase & {
          type: "update-arrow";
          elementId: string;
          patch: Partial<Pick<Extract<DesignElement, { kind: "arrow" }>, "stroke" | "strokeWidth" | "dash" | "startHead" | "endHead">>;
      })
    | (DesignOperationBase & { type: "set-image-crop"; elementId: string; crop: DesignNormalizedRect | null })
    | (DesignOperationBase & { type: "set-image-asset-version"; elementId: string; assetVersionId: string })
    | (DesignOperationBase & { type: "delete-elements"; elementIds: string[] })
    | (DesignOperationBase & { type: "move-elements"; elementIds: string[]; target: DesignOperationScope; index: number })
    | (DesignOperationBase & { type: "reorder-elements"; target: DesignOperationScope; elementIds: string[] })
    | (DesignOperationBase & { type: "add-asset"; asset: DesignAsset; initialVersion: DesignAssetVersion })
    | (DesignOperationBase & { type: "add-asset-version"; assetVersion: DesignAssetVersion; setCurrent: boolean })
    | (DesignOperationBase & { type: "set-current-asset-version"; assetId: string; assetVersionId: string })
    | (DesignOperationBase & { type: "add-annotation"; annotation: DesignAnnotation })
    | (DesignOperationBase & { type: "resolve-annotation"; annotationId: string; resolved: boolean; updatedAt: string })
    | (DesignOperationBase & { type: "delete-annotation"; annotationId: string });

export type DesignOperationBatch = {
    batchId: string;
    expectedRevision: number;
    mode: "atomic" | "partial";
    source: DesignHistorySource;
    label: string;
    operations: DesignOperation[];
};

export type DesignOperationErrorCode =
    | "INVALID_BATCH"
    | "INVALID_OPERATION"
    | "REVISION_CONFLICT"
    | "BATCH_ID_CONFLICT"
    | "FRAME_NOT_FOUND"
    | "ELEMENT_NOT_FOUND"
    | "ASSET_NOT_FOUND"
    | "ASSET_VERSION_NOT_FOUND"
    | "ANNOTATION_NOT_FOUND"
    | "ID_CONFLICT"
    | "TYPE_MISMATCH"
    | "LOCKED"
    | "DOCUMENT_INVALID";

export type DesignOperationError = { code: DesignOperationErrorCode; message: string; path?: string };

export type DesignOperationResult = {
    opId: string;
    type: DesignOperation["type"];
    status: "applied" | "rejected" | "rolled-back" | "skipped";
    affectedIds: string[];
    error: DesignOperationError | null;
};

export type DesignOperationReceipt = {
    batchId: string;
    fingerprint: string;
    status: "applied" | "partial" | "rejected" | "conflict" | "replayed";
    originalStatus: "applied" | "partial" | "rejected" | "conflict" | null;
    baseRevision: number;
    resultRevision: number;
    results: DesignOperationResult[];
    transaction: DesignHistoryTransaction | null;
};

export type DesignOperationReplay = { documentId: string; batchId: string; fingerprint: string; receipt: DesignOperationReceipt };

export class DesignOperationBatchValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DesignOperationBatchValidationError";
    }
}

const OPERATION_KEYS: Record<DesignOperation["type"], readonly string[]> = {
    "update-workspace": ["opId", "type", "patch"],
    "create-frame": ["opId", "type", "frame", "index"],
    "update-frame": ["opId", "type", "frameId", "patch"],
    "delete-frame": ["opId", "type", "frameId", "deleteElements"],
    "create-guide": ["opId", "type", "guide"],
    "update-guide": ["opId", "type", "guideId", "patch"],
    "delete-guide": ["opId", "type", "guideId"],
    "create-element": ["opId", "type", "element", "index"],
    "update-transform": ["opId", "type", "elementId", "transform"],
    "update-element": ["opId", "type", "elementId", "patch"],
    "update-text": ["opId", "type", "elementId", "patch"],
    "update-shape": ["opId", "type", "elementId", "patch"],
    "update-line": ["opId", "type", "elementId", "patch"],
    "update-arrow": ["opId", "type", "elementId", "patch"],
    "set-image-crop": ["opId", "type", "elementId", "crop"],
    "set-image-asset-version": ["opId", "type", "elementId", "assetVersionId"],
    "delete-elements": ["opId", "type", "elementIds"],
    "move-elements": ["opId", "type", "elementIds", "target", "index"],
    "reorder-elements": ["opId", "type", "target", "elementIds"],
    "add-asset": ["opId", "type", "asset", "initialVersion"],
    "add-asset-version": ["opId", "type", "assetVersion", "setCurrent"],
    "set-current-asset-version": ["opId", "type", "assetId", "assetVersionId"],
    "add-annotation": ["opId", "type", "annotation"],
    "resolve-annotation": ["opId", "type", "annotationId", "resolved", "updatedAt"],
    "delete-annotation": ["opId", "type", "annotationId"],
};

export function parseDesignOperationBatch(value: unknown): DesignOperationBatch {
    const input = strictRecord(value, ["batchId", "expectedRevision", "mode", "source", "label", "operations"], "批次");
    const batchId = id(input.batchId, "batchId");
    if (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0) invalid("expectedRevision 必须是非负安全整数");
    if (input.mode !== "atomic" && input.mode !== "partial") invalid("mode 必须是 atomic 或 partial");
    if (input.source !== "ui" && input.source !== "agent" && input.source !== "system") invalid("source 无效");
    if (typeof input.label !== "string" || !input.label.trim() || input.label.length > DESIGN_LIMITS.maxNameLength) invalid("label 无效");
    if (!Array.isArray(input.operations) || input.operations.length < 1 || input.operations.length > DESIGN_LIMITS.maxOperationsPerBatch) invalid(`operations 必须包含 1 到 ${DESIGN_LIMITS.maxOperationsPerBatch} 项`);
    const seen = new Set<string>();
    const operations = input.operations.map((item, index) => {
        const operation = parseOperation(item, index);
        if (seen.has(operation.opId)) invalid(`opId 重复：${operation.opId}`);
        seen.add(operation.opId);
        return operation;
    });
    return { batchId, expectedRevision: Number(input.expectedRevision), mode: input.mode, source: input.source, label: input.label.trim(), operations };
}

export function designOperationBatchFingerprint(batch: DesignOperationBatch) {
    const serialized = stableStringify(parseDesignOperationBatch(batch));
    return `sha256:${sha256Hex(serialized)}`;
}

function parseOperation(value: unknown, index: number): DesignOperation {
    const loose = strictRecord(value, undefined, `operations[${index}]`);
    if (typeof loose.type !== "string" || !(loose.type in OPERATION_KEYS)) invalid(`operations[${index}].type 不受支持`);
    const type = loose.type as DesignOperation["type"];
    const input = strictRecord(value, OPERATION_KEYS[type], `operations[${index}]`);
    id(input.opId, `operations[${index}].opId`);
    validateOperationPayload(type, input, index);
    return input as unknown as DesignOperation;
}

function validateOperationPayload(type: DesignOperation["type"], input: Record<string, unknown>, index: number) {
    const label = `operations[${index}]`;
    if (type === "update-workspace") strictRecord(input.patch, ["background", "viewport"], `${label}.patch`, false);
    if (type === "update-frame") strictRecord(input.patch, ["name", "x", "y", "width", "height", "background", "locked", "export"], `${label}.patch`, false);
    if (type === "update-guide") strictRecord(input.patch, ["axis", "position", "frameId", "locked"], `${label}.patch`, false);
    if (type === "update-element") strictRecord(input.patch, ["name", "opacity", "locked", "hidden"], `${label}.patch`, false);
    if (type === "update-text") strictRecord(input.patch, ["text", "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "align", "verticalAlign", "fill", "stroke", "strokeWidth"], `${label}.patch`, false);
    if (type === "update-shape") strictRecord(input.patch, ["fill", "stroke", "strokeWidth", "cornerRadius"], `${label}.patch`, false);
    if (type === "update-line") strictRecord(input.patch, ["stroke", "strokeWidth", "dash", "cap"], `${label}.patch`, false);
    if (type === "update-arrow") strictRecord(input.patch, ["stroke", "strokeWidth", "dash", "startHead", "endHead"], `${label}.patch`, false);
    if (
        (type === "update-workspace" || type === "update-frame" || type === "update-guide" || type === "update-element" || type === "update-text" || type === "update-shape" || type === "update-line" || type === "update-arrow") &&
        Object.keys(input.patch as object).length === 0
    )
        invalid(`${label}.patch 不能为空`);
    if (type === "move-elements" || type === "reorder-elements") {
        const scope = strictRecord(input.target, undefined, `${label}.target`);
        if (scope.scope === "workspace") strictRecord(input.target, ["scope"], `${label}.target`);
        else if (scope.scope === "frame") strictRecord(input.target, ["scope", "frameId"], `${label}.target`);
        else invalid(`${label}.target.scope 无效`);
    }
}

function strictRecord(value: unknown, allowed: readonly string[] | undefined, label: string, requireAll = true) {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} 必须是对象`);
    const input = value as Record<string, unknown>;
    if (allowed) {
        const allowedSet = new Set(allowed);
        const unknown = Object.keys(input).find((key) => !allowedSet.has(key));
        if (unknown) invalid(`${label} 包含未知字段 ${unknown}`);
        if (requireAll) {
            const missing = allowed.find((key) => !(key in input));
            if (missing) invalid(`${label} 缺少字段 ${missing}`);
        }
    }
    return input;
}

function id(value: unknown, label: string) {
    if (typeof value !== "string" || value.length < 1 || value.length > DESIGN_LIMITS.maxIdLength || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) invalid(`${label} 无效`);
    return value;
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
            .toSorted(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}

function invalid(message: string): never {
    throw new DesignOperationBatchValidationError(message);
}
