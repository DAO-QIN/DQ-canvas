import type { WorkspaceImageAnnotationInput, WorkspaceImageCropRect } from "@/components/creative-workspace";
import { DESIGN_LIMITS, createDesignImageResultPlan, type DesignDocument, type DesignImageResultPlan, type DesignOperation, type DesignPoint } from "@/lib/design";
import type { UploadedImage } from "@/services/image-storage";

import type { DesignEditorSelection } from "./design-editor-commands";

export type SelectedDesignImage = NonNullable<ReturnType<typeof selectedDesignImage>>;

export function selectedDesignImage(document: DesignDocument, selection: DesignEditorSelection) {
    if (selection?.kind !== "elements" || selection.ids.length !== 1) return null;
    const element = document.elements.find((candidate) => candidate.id === selection.ids[0]);
    if (element?.kind !== "image") return null;
    const version = document.assetVersions.find((candidate) => candidate.id === element.assetVersionId);
    return version ? { element, version } : null;
}

export function createDesignImageCropOperation(elementId: string, crop: WorkspaceImageCropRect): Extract<DesignOperation, { type: "set-image-crop" }> {
    return { opId: `op-crop-${clientId()}`, type: "set-image-crop", elementId, crop: normalizeRect(crop) };
}

export function createDesignImageAnnotationOperation(elementId: string, input: WorkspaceImageAnnotationInput, now = new Date().toISOString()): Extract<DesignOperation, { type: "add-annotation" }> {
    const text = input.text.trim();
    if (!text || text.length > DESIGN_LIMITS.maxAnnotationLength) throw new Error("批注内容无效");
    const id = `annotation-${clientId()}`;
    return {
        opId: `op-${id}`,
        type: "add-annotation",
        annotation: {
            id,
            text,
            target: { kind: "element", elementId, region: input.region ? normalizeRect(input.region) : null },
            resolved: false,
            createdAt: now,
            updatedAt: now,
        },
    };
}

export function unresolvedDesignImageAnnotationPrompt(document: DesignDocument, elementId: string) {
    const annotations = document.annotations.filter((annotation) => !annotation.resolved && annotation.target.kind === "element" && annotation.target.elementId === elementId);
    if (!annotations.length) return "";
    const lines = annotations.map((annotation, index) => {
        const region = annotation.target.kind === "element" ? annotation.target.region : null;
        const area = region ? `区域 x=${percent(region.x)}, y=${percent(region.y)}, w=${percent(region.width)}, h=${percent(region.height)}` : "整张图片";
        return `${index + 1}. ${area}：${annotation.text}`;
    });
    return `请同时遵循以下画板批注，仅修改对应区域，未批注区域保持不变：\n${lines.join("\n")}`;
}

export function appendDesignImageAnnotationsToPrompt(document: DesignDocument, elementId: string, prompt: string) {
    const annotations = unresolvedDesignImageAnnotationPrompt(document, elementId);
    return annotations ? `${prompt.trim()}\n\n${annotations}`.trim() : prompt.trim();
}

export function createDesignDerivedImagePlan(input: {
    document: DesignDocument;
    sourceElementId: string;
    requestId: string;
    generationTaskId: string | null;
    image: Pick<UploadedImage, "storageKey" | "mimeType" | "width" | "height">;
    operation: "background-removal" | "edit" | "upscale" | "other";
    name: string;
    sceneCenter: DesignPoint;
    createdAt?: string;
}): DesignImageResultPlan {
    const source = selectedDesignImage(input.document, { kind: "elements", ids: [input.sourceElementId] });
    if (!source) throw new Error("源图片不存在");
    const mimeType = designImageMimeType(input.image.mimeType);
    return createDesignImageResultPlan(input.document, {
        requestId: input.requestId,
        generationTaskId: input.generationTaskId,
        name: input.name,
        locator: { kind: "storage-key", storageKey: input.image.storageKey },
        mimeType,
        width: Math.max(1, Math.floor(input.image.width)),
        height: Math.max(1, Math.floor(input.image.height)),
        createdAt: input.createdAt || new Date().toISOString(),
        target: source.element.frameId ? { scope: "frame", frameId: source.element.frameId } : { scope: "workspace" },
        position: input.sceneCenter,
        sourceElementId: source.element.id,
        operation: input.operation,
    });
}

export function sameDesignImageSource(document: DesignDocument, elementId: string, versionId: string) {
    const source = selectedDesignImage(document, { kind: "elements", ids: [elementId] });
    return source?.version.id === versionId;
}

function normalizeRect(rect: WorkspaceImageCropRect) {
    const x = clamp(rect.x, 0, 0.999);
    const y = clamp(rect.y, 0, 0.999);
    return {
        x: round(x),
        y: round(y),
        width: round(clamp(rect.width, 0.001, 1 - x)),
        height: round(clamp(rect.height, 0.001, 1 - y)),
    };
}

function designImageMimeType(value: string) {
    if (value === "image/png" || value === "image/jpeg" || value === "image/webp") return value;
    throw new Error("派生图片格式不受支持");
}

function percent(value: number) {
    return `${Math.round(value * 1000) / 10}%`;
}

function round(value: number) {
    return Math.round(value * 1000) / 1000;
}

function clamp(value: number, minimum: number, maximum: number) {
    return Math.min(maximum, Math.max(minimum, value));
}

function clientId() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
