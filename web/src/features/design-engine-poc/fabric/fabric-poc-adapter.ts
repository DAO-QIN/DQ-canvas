import { ActiveSelection, Canvas, Ellipse, FabricImage, FabricObject, Rect, Textbox, type TMat2D } from "fabric";

import { cloneDesignPocDocument, normalizeDesignPocDocument } from "../contract/document";
import { applyDesignPocOperations } from "../contract/operations";
import type { DesignPocAdapter, DesignPocAsset, DesignPocDocument, DesignPocElement, DesignPocExportResult, DesignPocFrame, DesignPocMetrics, DesignPocOperation, DesignPocOperationReceipt } from "../contract/types";

type PocFabricObject = FabricObject & {
    designPocRole?: "frame" | "element";
    designPocFrame?: DesignPocFrame;
    designPocElement?: DesignPocElement;
};

FabricObject.customProperties = [...new Set([...FabricObject.customProperties, "designPocRole", "designPocFrame", "designPocElement"])];

export class FabricPocAdapter implements DesignPocAdapter {
    readonly engine = "fabric" as const;
    private project = { id: "design-poc-product-campaign", title: "DQ 商品图多画板 PoC" };
    private assets: DesignPocAsset[] = [];
    private viewport = { x: 0, y: 0, zoom: 0.12 };
    private undoStack: DesignPocDocument[] = [];
    private redoStack: DesignPocDocument[] = [];
    private destroyed = false;

    constructor(private readonly canvas: Canvas) {}

    async load(document: DesignPocDocument, options: { recordHistory?: boolean } = {}) {
        this.assertActive();
        const normalized = normalizeDesignPocDocument(document);
        if (options.recordHistory) {
            this.undoStack.push(this.exportDocument());
            this.redoStack = [];
        } else {
            this.undoStack = [];
            this.redoStack = [];
        }
        await this.sync(normalized);
    }

    exportDocument() {
        this.assertActive();
        const objects = this.canvas.getObjects() as PocFabricObject[];
        const frames = objects
            .filter((object) => object.designPocRole === "frame" && object.designPocFrame)
            .map((object) => ({
                ...object.designPocFrame!,
                x: round(object.left),
                y: round(object.top),
                width: round(object.width * object.scaleX),
                height: round(object.height * object.scaleY),
            }));
        const frameMap = new Map(frames.map((frame) => [frame.id, frame]));
        const elements = objects
            .filter((object) => object.designPocRole === "element" && object.designPocElement)
            .map((object) => {
                const stored = object.designPocElement!;
                const frame = frameMap.get(stored.frameId);
                if (!frame) throw new Error(`Fabric 元素 Frame 缺失：${stored.id}`);
                return {
                    ...stored,
                    x: round(object.left - frame.x),
                    y: round(object.top - frame.y),
                    width: round(object.width * object.scaleX),
                    height: round(object.height * object.scaleY),
                    rotation: round(object.angle),
                    opacity: stored.opacity,
                    locked: !object.selectable,
                } as DesignPocElement;
            });
        const transform = this.canvas.viewportTransform || ([1, 0, 0, 1, 0, 0] as TMat2D);
        return normalizeDesignPocDocument({
            schemaVersion: 1,
            id: this.project.id,
            title: this.project.title,
            frames,
            assets: this.assets,
            elements,
            viewport: { x: round(transform[4]), y: round(transform[5]), zoom: round(transform[0]) },
        });
    }

    async apply(operations: DesignPocOperation[]): Promise<DesignPocOperationReceipt> {
        const current = this.exportDocument();
        const outcome = applyDesignPocOperations(current, operations);
        if (outcome.receipt.appliedOperationIds.length) {
            this.undoStack.push(current);
            this.redoStack = [];
            await this.sync(outcome.document);
        }
        return outcome.receipt;
    }

    async undo() {
        this.assertActive();
        const previous = this.undoStack.pop();
        if (!previous) return;
        this.redoStack.push(this.exportDocument());
        await this.sync(previous);
    }

    async redo() {
        this.assertActive();
        const next = this.redoStack.pop();
        if (!next) return;
        this.undoStack.push(this.exportDocument());
        await this.sync(next);
    }

    getSelection() {
        this.assertActive();
        return this.canvas.getActiveObjects().flatMap((object) => {
            const element = (object as PocFabricObject).designPocElement;
            return element ? [element.id] : [];
        });
    }

    setSelection(ids: string[]) {
        this.assertActive();
        this.canvas.discardActiveObject();
        const selected = (this.canvas.getObjects() as PocFabricObject[]).filter((object) => object.designPocElement && ids.includes(object.designPocElement.id));
        if (selected.length === 1) this.canvas.setActiveObject(selected[0]);
        else if (selected.length > 1) this.canvas.setActiveObject(new ActiveSelection(selected, { canvas: this.canvas }));
        this.canvas.requestRenderAll();
    }

    async exportFrame(frameId: string, options: { scale: 1 | 2; format: "png" | "jpeg" }): Promise<DesignPocExportResult> {
        this.assertActive();
        const frameObject = (this.canvas.getObjects() as PocFabricObject[]).find((object) => object.designPocRole === "frame" && object.designPocFrame?.id === frameId);
        if (!frameObject?.designPocFrame) throw new Error(`Fabric Frame 不存在：${frameId}`);
        const frame = frameObject.designPocFrame;
        const started = performance.now();
        const viewport = [...this.canvas.viewportTransform] as TMat2D;
        this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        const element = this.canvas.toCanvasElement(options.scale, { left: frame.x, top: frame.y, width: frame.width, height: frame.height });
        this.canvas.setViewportTransform(viewport);
        this.canvas.requestRenderAll();
        const blob = await canvasToBlob(element, options.format);
        return { blob, width: element.width, height: element.height, durationMs: performance.now() - started };
    }

    getMetrics(): DesignPocMetrics {
        const document = this.exportDocument();
        return {
            engine: this.engine,
            elementCount: document.elements.length,
            frameCount: document.frames.length,
            documentBytes: new TextEncoder().encode(JSON.stringify(document)).byteLength,
            zoom: document.viewport.zoom,
        };
    }

    async destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        await this.canvas.dispose();
    }

    private async sync(document: DesignPocDocument) {
        this.assertActive();
        this.project = { id: document.id, title: document.title };
        this.assets = structuredClone(document.assets);
        this.viewport = { ...document.viewport };
        this.canvas.discardActiveObject();
        this.canvas.clear();
        for (const frame of document.frames) {
            const frameObject = new Rect({
                left: frame.x,
                top: frame.y,
                originX: "left",
                originY: "top",
                width: frame.width,
                height: frame.height,
                fill: frame.background,
                stroke: "#64748b",
                strokeWidth: 4,
                selectable: false,
                evented: false,
                objectCaching: false,
            });
            tagFrame(frameObject, frame);
            this.canvas.add(frameObject);
            for (const element of document.elements.filter((candidate) => candidate.frameId === frame.id).toSorted((left, right) => left.zIndex - right.zIndex)) {
                this.canvas.add(await createFabricElement(element, frame, document.assets));
            }
        }
        this.canvas.setViewportTransform([document.viewport.zoom, 0, 0, document.viewport.zoom, document.viewport.x, document.viewport.y]);
        this.canvas.requestRenderAll();
    }

    private assertActive() {
        if (this.destroyed) throw new Error("Fabric PoC 适配器已销毁");
    }
}

async function createFabricElement(element: DesignPocElement, frame: DesignPocFrame, assets: DesignPocAsset[]) {
    const left = frame.x + element.x;
    const top = frame.y + element.y;
    let object: PocFabricObject;
    if (element.kind === "image") {
        const asset = assets.find((candidate) => candidate.id === element.assetId);
        if (!asset) throw new Error(`Fabric 图片资源不存在：${element.assetId}`);
        const crop = element.crop || { x: 0, y: 0, width: 1, height: 1 };
        const image = await FabricImage.fromURL(
            asset.src,
            { crossOrigin: "anonymous" },
            {
                left,
                top,
                originX: "left",
                originY: "top",
                cropX: asset.width * crop.x,
                cropY: asset.height * crop.y,
                width: asset.width * crop.width,
                height: asset.height * crop.height,
                angle: element.rotation,
                opacity: element.hidden ? 0 : element.opacity,
                flipX: element.flipX,
                flipY: element.flipY,
                selectable: !element.locked,
                evented: !element.locked,
                objectCaching: false,
            },
        );
        image.scaleX = element.width / (asset.width * crop.width);
        image.scaleY = element.height / (asset.height * crop.height);
        object = image as PocFabricObject;
    } else if (element.kind === "text") {
        const text = new Textbox(element.text, {
            left,
            top,
            originX: "left",
            originY: "top",
            width: element.width,
            fontFamily: element.fontFamily,
            fontSize: element.fontSize,
            fontWeight: element.fontWeight,
            lineHeight: element.lineHeight,
            charSpacing: (element.letterSpacing / element.fontSize) * 1000,
            textAlign: element.align,
            fill: element.color,
            strokeWidth: 0,
            angle: element.rotation,
            opacity: element.hidden ? 0 : element.opacity,
            selectable: !element.locked,
            evented: !element.locked,
            objectCaching: false,
        });
        text.scaleY = element.height / Math.max(1, text.height);
        object = text as PocFabricObject;
    } else if (element.shape === "ellipse") {
        object = new Ellipse({
            left,
            top,
            originX: "left",
            originY: "top",
            rx: element.width / 2,
            ry: element.height / 2,
            fill: element.fill,
            stroke: element.stroke,
            strokeWidth: element.strokeWidth,
            angle: element.rotation,
            opacity: element.hidden ? 0 : element.opacity,
            selectable: !element.locked,
            evented: !element.locked,
            objectCaching: false,
        }) as PocFabricObject;
    } else {
        object = new Rect({
            left,
            top,
            originX: "left",
            originY: "top",
            width: element.width,
            height: element.height,
            rx: element.radius,
            ry: element.radius,
            fill: element.fill,
            stroke: element.stroke,
            strokeWidth: element.strokeWidth,
            angle: element.rotation,
            opacity: element.hidden ? 0 : element.opacity,
            selectable: !element.locked,
            evented: !element.locked,
            objectCaching: false,
        }) as PocFabricObject;
    }
    object.designPocRole = "element";
    object.designPocElement = cloneDesignPocDocument({ schemaVersion: 1, id: "clone-helper", title: "clone", frames: [frame], assets, elements: [element], viewport: { x: 0, y: 0, zoom: 1 } }).elements[0];
    return object;
}

function tagFrame(object: Rect, frame: DesignPocFrame) {
    const tagged = object as PocFabricObject;
    tagged.designPocRole = "frame";
    tagged.designPocFrame = structuredClone(frame);
}

async function canvasToBlob(canvas: HTMLCanvasElement, format: "png" | "jpeg") {
    if (typeof OffscreenCanvas !== "undefined") {
        const output = new OffscreenCanvas(canvas.width, canvas.height);
        const context = output.getContext("2d");
        if (!context) throw new Error("Fabric 导出 OffscreenCanvas 上下文创建失败");
        context.drawImage(canvas, 0, 0);
        return output.convertToBlob({ type: `image/${format}`, quality: format === "jpeg" ? 0.92 : undefined });
    }
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Fabric 导出 Blob 失败"))), `image/${format}`, format === "jpeg" ? 0.92 : undefined);
    });
}

function round(value: number) {
    return Math.round(value * 1000) / 1000;
}
