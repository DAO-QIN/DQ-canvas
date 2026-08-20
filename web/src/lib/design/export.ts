import { DESIGN_EXPORT_FORMATS, DESIGN_EXPORT_SCALES, DESIGN_LIMITS } from "./limits";
import type { DesignAssetVersion, DesignDocument, DesignElement, DesignExportFormat, DesignExportScale, DesignFrame } from "./schema";
import { parseDesignDocumentV1 } from "./validation";

export type DesignFrameExportOptions = {
    format?: DesignExportFormat;
    scale?: DesignExportScale;
    quality?: number;
    background?: "frame" | "transparent" | "white";
};

export type DesignFrameExportPlan = {
    documentId: string;
    documentRevision: number;
    frame: DesignFrame;
    format: DesignExportFormat;
    mimeType: `image/${DesignExportFormat}`;
    fileName: string;
    scale: DesignExportScale;
    quality: number;
    background: "frame" | "transparent" | "white";
    pixelWidth: number;
    pixelHeight: number;
    elements: DesignElement[];
    assetVersions: DesignAssetVersion[];
};

export type DesignFrameExportRequest = {
    frameId: string;
    options?: DesignFrameExportOptions;
};

export function createDesignFrameExportPlan(documentValue: unknown, frameId: string, options: DesignFrameExportOptions = {}): DesignFrameExportPlan {
    const document = parseDesignDocumentV1(documentValue);
    return createValidatedDesignFrameExportPlan(document, frameId, options);
}

function createValidatedDesignFrameExportPlan(document: DesignDocument, frameId: string, options: DesignFrameExportOptions): DesignFrameExportPlan {
    const frame = document.frames.find((item) => item.id === frameId);
    if (!frame) throw new Error(`Frame 不存在：${frameId}`);
    const format = options.format ?? frame.export.format;
    const scale = options.scale ?? frame.export.scale;
    const quality = options.quality ?? frame.export.quality;
    const background = options.background ?? frame.export.background;
    if (!DESIGN_EXPORT_FORMATS.includes(format) || !DESIGN_EXPORT_SCALES.includes(scale)) throw new Error("导出格式或倍率无效");
    if (!Number.isFinite(quality) || quality < 0.01 || quality > 1) throw new Error("导出质量必须在 0.01 到 1 之间");
    if (format === "jpeg" && background === "transparent") throw new Error("JPEG 导出不支持透明背景");
    const pixelWidth = frame.width * scale;
    const pixelHeight = frame.height * scale;
    if (!Number.isInteger(pixelWidth) || !Number.isInteger(pixelHeight) || pixelWidth > DESIGN_LIMITS.maxExportEdge || pixelHeight > DESIGN_LIMITS.maxExportEdge) throw new Error(`导出像素尺寸必须是整数且不超过 ${DESIGN_LIMITS.maxExportEdge}`);

    const layer = document.layers.find((item) => item.scope === "frame" && item.frameId === frameId);
    if (!layer || layer.scope !== "frame") throw new Error(`Frame 图层不存在：${frameId}`);
    const byId = new Map(document.elements.map((item) => [item.id, item]));
    const elements = layer.elementIds.flatMap((id) => {
        const item = byId.get(id);
        return item && !item.hidden ? [structuredClone(item)] : [];
    });
    const neededVersions = new Set(elements.flatMap((item) => (item.kind === "image" ? [item.assetVersionId] : [])));
    const assetVersions = document.assetVersions.filter((item) => neededVersions.has(item.id)).map((item) => structuredClone(item));
    return {
        documentId: document.id,
        documentRevision: document.revision,
        frame: structuredClone(frame),
        format,
        mimeType: designExportMimeType(format),
        fileName: designExportFileName(frame.name, format),
        scale,
        quality,
        background,
        pixelWidth,
        pixelHeight,
        elements,
        assetVersions,
    };
}

export function createDesignFrameExportBatchPlan(documentValue: unknown, requests: readonly DesignFrameExportRequest[]): DesignFrameExportPlan[] {
    if (!requests.length) throw new Error("至少选择一个 Frame 才能导出");
    const document = parseDesignDocumentV1(documentValue);
    const seenFrames = new Set<string>();
    const seenNames = new Map<string, number>();
    return requests.map(({ frameId, options }) => {
        if (seenFrames.has(frameId)) throw new Error(`Frame 重复：${frameId}`);
        seenFrames.add(frameId);
        const plan = createValidatedDesignFrameExportPlan(document, frameId, options ?? {});
        const key = plan.fileName.toLocaleLowerCase();
        const occurrence = (seenNames.get(key) ?? 0) + 1;
        seenNames.set(key, occurrence);
        if (occurrence === 1) return plan;
        const extension = designExportFileExtension(plan.format);
        const baseName = plan.fileName.slice(0, -(extension.length + 1));
        return { ...plan, fileName: `${baseName}-${occurrence}.${extension}` };
    });
}

export function designExportMimeType(format: DesignExportFormat): `image/${DesignExportFormat}` {
    return `image/${format}`;
}

export function designExportFileExtension(format: DesignExportFormat): DesignExportFormat {
    return format;
}

export function designExportFileName(frameName: string, format: DesignExportFormat): string {
    const safeBase = frameName
        .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
        .replace(/^[.\s]+|[.\s]+$/g, "")
        .replace(/\s+/g, " ")
        .slice(0, 120);
    return `${safeBase || "frame"}.${designExportFileExtension(format)}`;
}
