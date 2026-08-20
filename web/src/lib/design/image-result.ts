import { sha256Hex } from "./fingerprint";
import { fitImageSize } from "./image-placement";
import type { DesignOperation, DesignOperationBatch, DesignOperationScope } from "./operations";
import type { DesignAssetVersion, DesignDocument, DesignImageElement, DesignPoint, DesignStableResourceLocator } from "./schema";

const SIBLING_GAP = 48;

export type DesignImageResultInput = Readonly<{
    requestId: string;
    generationTaskId: string | null;
    name: string;
    locator: DesignStableResourceLocator;
    mimeType: DesignAssetVersion["mimeType"];
    width: number;
    height: number;
    createdAt: string;
    target: DesignOperationScope;
    position: DesignPoint;
    sourceElementId?: string | null;
    operation: Extract<DesignAssetVersion["provenance"]["operation"], "generate" | "background-removal" | "edit" | "upscale" | "other">;
}>;

export type DesignImageResultPlan = Readonly<{
    batch: DesignOperationBatch;
    elementId: string;
    assetId: string;
    assetVersionId: string;
    sourceElementId: string | null;
}>;

export class DesignImageResultError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DesignImageResultError";
    }
}

/** Plans a generated image as a new asset or an immutable sibling version. */
export function createDesignImageResultPlan(document: DesignDocument, input: DesignImageResultInput): DesignImageResultPlan {
    const requestId = stableId(input.requestId, "requestId");
    const taskId = input.generationTaskId == null ? null : stableId(input.generationTaskId, "generationTaskId");
    const sourceElementId = input.sourceElementId == null ? null : stableId(input.sourceElementId, "sourceElementId");
    const sourceElement = sourceElementId ? sourceImageElement(document, sourceElementId) : null;
    const sourceVersion = sourceElement ? document.assetVersions.find((version) => version.id === sourceElement.assetVersionId) : null;
    if (sourceElement && !sourceVersion) throw new DesignImageResultError(`源图片版本不存在：${sourceElement.assetVersionId}`);

    const suffix = sha256Hex(`${document.id}\0${requestId}`).slice(0, 32);
    const versionId = `version-${suffix}`;
    const elementId = `element-${suffix}`;
    const assetId = sourceVersion?.assetId ?? `asset-${suffix}`;
    const target = sourceElement ? elementScope(sourceElement) : validateTarget(document, input.target);
    const displaySize = fitImageSize(input.width, input.height);
    const position = sourceElement ? siblingPosition(document, sourceElement, displaySize) : point(input.position);
    const version: DesignAssetVersion = {
        id: versionId,
        assetId,
        parentVersionId: sourceVersion?.id ?? null,
        source: sourceVersion ? "derived" : "generated",
        locator: input.locator,
        mimeType: input.mimeType,
        width: input.width,
        height: input.height,
        createdAt: input.createdAt,
        provenance: { operation: input.operation, sourceElementId, generationTaskId: taskId },
    };
    const element: DesignImageElement = {
        id: elementId,
        frameId: target.scope === "frame" ? target.frameId : null,
        name: input.name.trim() || "生成结果",
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
    const layer = targetLayer(document, target);
    const addVersion: DesignOperation = sourceVersion
        ? { opId: `op-add-version-${suffix}`, type: "add-asset-version", assetVersion: version, setCurrent: true }
        : {
              opId: `op-add-asset-${suffix}`,
              type: "add-asset",
              asset: { id: assetId, kind: "image", name: element.name, currentVersionId: versionId, versionIds: [versionId] },
              initialVersion: version,
          };
    const batch: DesignOperationBatch = {
        batchId: `batch-image-result-${suffix}`,
        expectedRevision: document.revision,
        mode: "atomic",
        source: "system",
        label: sourceVersion ? "添加图片派生版本" : "插入生成图片",
        operations: [addVersion, { opId: `op-create-element-${suffix}`, type: "create-element", element, index: layer.elementIds.length }],
    };
    return Object.freeze({ batch, elementId, assetId, assetVersionId: versionId, sourceElementId });
}

export function designDocumentHasImageResult(document: DesignDocument, taskId: string) {
    const version = document.assetVersions.find((candidate) => candidate.provenance.generationTaskId === taskId);
    if (!version) return null;
    const element = document.elements.find((candidate): candidate is DesignImageElement => candidate.kind === "image" && candidate.assetVersionId === version.id);
    return { assetId: version.assetId, assetVersionId: version.id, elementId: element?.id ?? null };
}

function sourceImageElement(document: DesignDocument, id: string) {
    const element = document.elements.find((candidate) => candidate.id === id);
    if (!element) throw new DesignImageResultError(`源元素不存在：${id}`);
    if (element.kind !== "image") throw new DesignImageResultError(`源元素不是图片：${id}`);
    if (element.locked) throw new DesignImageResultError(`源图片已锁定：${id}`);
    return element;
}

function siblingPosition(document: DesignDocument, source: DesignImageElement, size: Readonly<{ width: number; height: number }>) {
    const right = { x: source.transform.x + source.transform.width + SIBLING_GAP, y: source.transform.y };
    if (!source.frameId) return point(right);
    const frame = document.frames.find((candidate) => candidate.id === source.frameId);
    if (!frame) throw new DesignImageResultError(`源图片所属 Frame 不存在：${source.frameId}`);
    if (right.x + size.width <= frame.width) return point(right);
    return point({ x: source.transform.x, y: source.transform.y + source.transform.height + SIBLING_GAP });
}

function elementScope(element: DesignImageElement): DesignOperationScope {
    return element.frameId ? { scope: "frame", frameId: element.frameId } : { scope: "workspace" };
}

function validateTarget(document: DesignDocument, target: DesignOperationScope) {
    targetLayer(document, target);
    return target;
}

function targetLayer(document: DesignDocument, target: DesignOperationScope) {
    const layer = document.layers.find((candidate) => (target.scope === "workspace" ? candidate.scope === "workspace" : candidate.scope === "frame" && candidate.frameId === target.frameId));
    if (!layer) throw new DesignImageResultError(target.scope === "workspace" ? "Workspace 图层不存在" : `Frame 图层不存在：${target.frameId}`);
    return layer;
}

function stableId(value: string, field: string) {
    const output = value?.trim();
    if (!output || output.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(output)) throw new DesignImageResultError(`${field} 无效`);
    return output;
}

function point(value: DesignPoint) {
    if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new DesignImageResultError("position 无效");
    return { x: round(value.x), y: round(value.y) };
}

function round(value: number) {
    return Math.round(value * 1000) / 1000;
}
