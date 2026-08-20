"use client";

export type WorkspaceImageCropRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type WorkspaceImageDimensions = Readonly<{
    width: number;
    height: number;
}>;

export type WorkspaceImageUpscaleAlgorithm = "nearest" | "bilinear" | "high";

export const MAX_WORKSPACE_UPSCALE_LONG_EDGE = 4096;

export type WorkspaceImageUpscaleParams = {
    targetLongEdge: number;
    algorithm: WorkspaceImageUpscaleAlgorithm;
};

export type WorkspaceImageSplitParams = {
    rows: number;
    columns: number;
};

export type WorkspaceImageSplitPiece = {
    row: number;
    column: number;
    dataUrl: string;
};

export async function cropWorkspaceImage(dataUrl: string, crop?: WorkspaceImageCropRect) {
    const image = await loadImage(dataUrl);
    if (crop) {
        return drawCrop(image, Math.floor(crop.x * image.width), Math.floor(crop.y * image.height), Math.ceil(crop.width * image.width), Math.ceil(crop.height * image.height));
    }
    const size = Math.min(image.width, image.height);
    const sx = Math.max(0, Math.floor((image.width - size) / 2));
    const sy = Math.max(0, Math.floor((image.height - size) / 2));
    return drawCrop(image, sx, sy, size, size);
}

export async function splitWorkspaceImage(dataUrl: string, params: WorkspaceImageSplitParams): Promise<WorkspaceImageSplitPiece[]> {
    const image = await loadImage(dataUrl);
    const rows = Math.max(1, Math.floor(params.rows));
    const columns = Math.max(1, Math.floor(params.columns));
    const pieces: WorkspaceImageSplitPiece[] = [];

    for (let row = 0; row < rows; row += 1) {
        const sy = Math.floor((row * image.height) / rows);
        const sh = Math.floor(((row + 1) * image.height) / rows) - sy;
        for (let column = 0; column < columns; column += 1) {
            const sx = Math.floor((column * image.width) / columns);
            const sw = Math.floor(((column + 1) * image.width) / columns) - sx;
            pieces.push({ row, column, dataUrl: drawCrop(image, sx, sy, sw, sh) });
        }
    }

    return pieces;
}

export async function upscaleWorkspaceImage(dataUrl: string, params: WorkspaceImageUpscaleParams) {
    const image = await loadImage(dataUrl);
    const { width, height } = resolveWorkspaceUpscaleSize(image.width, image.height, params.targetLongEdge);
    return params.algorithm === "high" ? drawStepUpscale(image, width, height) : drawResize(image, image.width, image.height, width, height, params.algorithm);
}

export function resolveWorkspaceUpscaleSize(width: number, height: number, targetLongEdge: number) {
    const longEdge = Math.max(1, width, height);
    const target = Math.min(MAX_WORKSPACE_UPSCALE_LONG_EDGE, Math.max(1, Math.round(targetLongEdge)));
    const scale = target / longEdge;
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function resolveWorkspaceImageDimensions(decoded: WorkspaceImageDimensions | null, authoritative?: WorkspaceImageDimensions | null) {
    const source = validWorkspaceImageDimensions(authoritative) ? authoritative : decoded;
    return validWorkspaceImageDimensions(source) ? { width: source.width, height: source.height } : null;
}

function validWorkspaceImageDimensions(value?: WorkspaceImageDimensions | null): value is WorkspaceImageDimensions {
    return Boolean(value && Number.isFinite(value.width) && Number.isFinite(value.height) && value.width > 0 && value.height > 0);
}

function drawCrop(image: HTMLImageElement, sx: number, sy: number, sw: number, sh: number) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, sw);
    canvas.height = Math.max(1, sh);
    const context = canvas.getContext("2d");
    if (!context) return image.src;
    context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
}

function drawStepUpscale(image: HTMLImageElement, width: number, height: number) {
    let source: CanvasImageSource = image;
    let sourceWidth = image.width;
    let sourceHeight = image.height;

    while (sourceWidth * 2 < width && sourceHeight * 2 < height) {
        const nextWidth = sourceWidth * 2;
        const nextHeight = sourceHeight * 2;
        const next = drawResizeCanvas(source, sourceWidth, sourceHeight, nextWidth, nextHeight, "high");
        source = next;
        sourceWidth = nextWidth;
        sourceHeight = nextHeight;
    }

    return drawResize(source, sourceWidth, sourceHeight, width, height, "high");
}

function drawResize(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number, algorithm: WorkspaceImageUpscaleAlgorithm) {
    return drawResizeCanvas(source, sourceWidth, sourceHeight, width, height, algorithm).toDataURL("image/png");
}

function drawResizeCanvas(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number, algorithm: WorkspaceImageUpscaleAlgorithm) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return canvas;
    context.imageSmoothingEnabled = algorithm !== "nearest";
    context.imageSmoothingQuality = algorithm === "bilinear" ? "medium" : "high";
    context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
    return canvas;
}

function loadImage(dataUrl: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("图片解码失败"));
        image.src = dataUrl;
    });
}
