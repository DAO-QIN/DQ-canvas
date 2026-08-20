import { sha256Hex } from "./fingerprint";
import { DESIGN_LIMITS } from "./limits";
import type { DesignOperationBatch, DesignOperationScope } from "./operations";
import type { DesignAssetVersion, DesignDocument, DesignImageElement, DesignPoint, DesignStableResourceLocator } from "./schema";

export type DesignImageImportInput = Readonly<{
    requestId: string;
    name: string;
    locator: DesignStableResourceLocator;
    mimeType: DesignAssetVersion["mimeType"];
    width: number;
    height: number;
    displaySize?: Readonly<{ width: number; height: number }>;
    createdAt: string;
    target: DesignOperationScope;
    position: DesignPoint;
    source: DesignAssetVersion["source"];
    operation: DesignAssetVersion["provenance"]["operation"];
    generationTaskId?: string | null;
}>;

export class DesignImageImportError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DesignImageImportError";
    }
}

export function createDesignImageImportBatch(document: DesignDocument, input: DesignImageImportInput): DesignOperationBatch {
    const requestId = stableId(input.requestId, "requestId");
    const name = requiredName(input.name);
    const width = imageEdge(input.width, "width");
    const height = imageEdge(input.height, "height");
    const displaySize = input.displaySize ? elementSize(input.displaySize) : { width, height };
    const createdAt = isoDate(input.createdAt);
    const target = targetScope(document, input.target);
    const position = designPoint(input.position);
    const locator = stableLocator(input.locator);
    const mimeType = enumeration(input.mimeType, "mimeType", ["image/png", "image/jpeg", "image/webp"] as const);
    const source = enumeration(input.source, "source", ["upload", "library", "generated", "derived"] as const);
    const operation = enumeration(input.operation, "operation", ["upload", "import", "generate", "background-removal", "edit", "upscale", "other"] as const);
    const generationTaskId = input.generationTaskId == null ? null : stableId(input.generationTaskId, "generationTaskId");
    const suffix = sha256Hex(`${document.id}\0${requestId}`).slice(0, 32);
    const assetId = `asset-${suffix}`;
    const versionId = `version-${suffix}`;
    const elementId = `element-${suffix}`;
    const frameId = target.scope === "frame" ? target.frameId : null;
    const index = targetLayer(document, target).elementIds.length;

    const initialVersion: DesignAssetVersion = {
        id: versionId,
        assetId,
        parentVersionId: null,
        source,
        locator,
        mimeType,
        width,
        height,
        createdAt,
        provenance: { operation, sourceElementId: null, generationTaskId },
    };
    const element: DesignImageElement = {
        id: elementId,
        frameId,
        name,
        transform: { x: position.x, y: position.y, width: displaySize.width, height: displaySize.height, rotation: 0, flipX: false, flipY: false },
        opacity: 1,
        blendMode: "normal",
        locked: false,
        hidden: false,
        kind: "image",
        assetVersionId: versionId,
        crop: null,
        fit: "contain",
        cornerRadius: 0,
    };

    return {
        batchId: `batch-image-import-${suffix}`,
        expectedRevision: document.revision,
        mode: "atomic",
        source: "ui",
        label: "导入图片",
        operations: [
            {
                opId: `op-add-asset-${suffix}`,
                type: "add-asset",
                asset: { id: assetId, kind: "image", name, currentVersionId: versionId, versionIds: [versionId] },
                initialVersion,
            },
            { opId: `op-create-element-${suffix}`, type: "create-element", element, index },
        ],
    };
}

function targetScope(document: DesignDocument, target: DesignOperationScope): DesignOperationScope {
    if (target.scope === "workspace") {
        targetLayer(document, target);
        return { scope: "workspace" };
    }
    const frameId = stableId(target.frameId, "target.frameId");
    if (!document.frames.some((frame) => frame.id === frameId)) throw new DesignImageImportError(`Frame 不存在：${frameId}`);
    const normalized = { scope: "frame" as const, frameId };
    targetLayer(document, normalized);
    return normalized;
}

function targetLayer(document: DesignDocument, target: DesignOperationScope) {
    const layer = document.layers.find((candidate) => (target.scope === "workspace" ? candidate.scope === "workspace" : candidate.scope === "frame" && candidate.frameId === target.frameId));
    if (!layer) throw new DesignImageImportError(target.scope === "workspace" ? "Workspace 图层不存在" : `Frame 图层不存在：${target.frameId}`);
    return layer;
}

function stableLocator(locator: DesignStableResourceLocator): DesignStableResourceLocator {
    if (locator.kind === "library-asset") return { kind: "library-asset", libraryAssetId: stableId(locator.libraryAssetId, "locator.libraryAssetId") };
    const storageKey = locator.storageKey;
    if (!storageKey || storageKey.length > DESIGN_LIMITS.maxStorageKeyLength || unsafeResource(storageKey)) throw new DesignImageImportError("locator.storageKey 必须是稳定存储键");
    return { kind: "storage-key", storageKey };
}

function stableId(value: string, field: string) {
    const output = value?.trim();
    if (!output || output.length > DESIGN_LIMITS.maxIdLength || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(output)) throw new DesignImageImportError(`${field} 无效`);
    return output;
}

function requiredName(value: string) {
    const output = value?.trim();
    if (!output || output.length > DESIGN_LIMITS.maxNameLength) throw new DesignImageImportError("name 无效");
    return output;
}

function imageEdge(value: number, field: string) {
    if (!Number.isSafeInteger(value) || value < 1 || value > DESIGN_LIMITS.maxExportEdge) throw new DesignImageImportError(`${field} 无效`);
    return value;
}

function elementSize(value: Readonly<{ width: number; height: number }>) {
    const width = elementEdge(value?.width, "displaySize.width");
    const height = elementEdge(value?.height, "displaySize.height");
    return { width, height };
}

function elementEdge(value: number, field: string) {
    if (!Number.isFinite(value) || value <= 0 || value > DESIGN_LIMITS.maxElementEdge) throw new DesignImageImportError(`${field} 无效`);
    return round(value);
}

function designPoint(value: DesignPoint) {
    if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y) || Math.abs(value.x) > DESIGN_LIMITS.maxCoordinate || Math.abs(value.y) > DESIGN_LIMITS.maxCoordinate) throw new DesignImageImportError("position 无效");
    return { x: round(value.x), y: round(value.y) };
}

function isoDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new DesignImageImportError("createdAt 无效");
    return new Date(value).toISOString();
}

function enumeration<const T extends readonly string[]>(value: string, field: string, allowed: T): T[number] {
    if (!allowed.includes(value)) throw new DesignImageImportError(`${field} 无效`);
    return value as T[number];
}

function unsafeResource(value: string) {
    const normalized = value.trim();
    return normalized !== value || /^(?:data:|blob:|https?:|\/)/i.test(normalized) || normalized.includes("..") || /(?:^|[?&])(expires|signature|x-amz-signature)=/i.test(normalized) || /[\\\0-\x1f?#]/.test(normalized);
}

function round(value: number) {
    const factor = 10 ** DESIGN_LIMITS.numberPrecision;
    return Object.is(value, -0) ? 0 : Math.round(value * factor) / factor;
}
