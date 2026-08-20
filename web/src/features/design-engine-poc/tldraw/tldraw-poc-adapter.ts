import { AssetRecordType, createShapeId, toRichText, type Editor, type TLAssetId, type TLCreateShapePartial, type TLFrameShape, type TLGeoShape, type TLImageShape, type TLShape, type TLShapeId, type TLTextShape } from "tldraw";

import { normalizeDesignPocDocument } from "../contract/document";
import { applyDesignPocOperations } from "../contract/operations";
import type { DesignPocAdapter, DesignPocAsset, DesignPocDocument, DesignPocElement, DesignPocExportResult, DesignPocFrame, DesignPocMetrics, DesignPocOperation, DesignPocOperationReceipt } from "../contract/types";

type DesignShapeMeta = {
    designPocRole?: "frame" | "frame-background" | "element";
    designPocFrame?: DesignPocFrame;
    designPocElement?: DesignPocElement;
};

export class TldrawPocAdapter implements DesignPocAdapter {
    readonly engine = "tldraw" as const;
    private destroyed = false;

    constructor(private readonly editor: Editor) {}

    async load(document: DesignPocDocument, options: { recordHistory?: boolean } = {}) {
        this.assertActive();
        const normalized = normalizeDesignPocDocument(document);
        this.sync(normalized, options.recordHistory === true ? "record" : "ignore");
        if (!options.recordHistory) this.editor.clearHistory();
    }

    exportDocument() {
        this.assertActive();
        const shapes = this.editor.getCurrentPageShapes();
        const frames = shapes
            .filter((shape): shape is TLFrameShape => shape.type === "frame" && meta(shape).designPocRole === "frame")
            .map((shape) => {
                const stored = meta(shape).designPocFrame;
                if (!stored) throw new Error(`tldraw Frame 元数据缺失：${shape.id}`);
                return { ...stored, x: round(shape.x), y: round(shape.y), width: round(shape.props.w), height: round(shape.props.h) };
            });
        const frameMap = new Map(frames.map((frame) => [frame.id, frame]));
        const elements = shapes.filter((shape) => meta(shape).designPocRole === "element").map((shape) => this.readElement(shape, frameMap));
        const assets = this.editor.getAssets().flatMap((asset): DesignPocAsset[] => {
            if (asset.type !== "image" || typeof asset.meta.designPocAsset !== "object" || !asset.meta.designPocAsset) return [];
            return [asset.meta.designPocAsset as DesignPocAsset];
        });
        const camera = this.editor.getCamera();
        const source = shapes.find((shape) => meta(shape).designPocRole === "frame");
        const project = source ? (meta(source).designPocProject as { id?: unknown; title?: unknown } | undefined) : undefined;
        return normalizeDesignPocDocument({
            schemaVersion: 1,
            id: typeof project?.id === "string" ? project.id : "design-poc-product-campaign",
            title: typeof project?.title === "string" ? project.title : "DQ 商品图多画板 PoC",
            frames,
            assets,
            elements,
            viewport: { x: round(camera.x), y: round(camera.y), zoom: round(camera.z) },
        });
    }

    async apply(operations: DesignPocOperation[]): Promise<DesignPocOperationReceipt> {
        const outcome = applyDesignPocOperations(this.exportDocument(), operations);
        if (outcome.receipt.appliedOperationIds.length) this.sync(outcome.document, "record");
        return outcome.receipt;
    }

    async undo() {
        this.assertActive();
        this.editor.undo();
    }

    async redo() {
        this.assertActive();
        this.editor.redo();
    }

    getSelection() {
        this.assertActive();
        return this.editor
            .getSelectedShapeIds()
            .map((id) => this.editor.getShape(id))
            .flatMap((shape) => (shape && meta(shape).designPocRole === "element" ? [String(shape.id).replace(/^shape:/, "")] : []));
    }

    setSelection(ids: string[]) {
        this.assertActive();
        const shapeIds = ids.map(elementShapeId).filter((id) => Boolean(this.editor.getShape(id)));
        this.editor.setSelectedShapes(shapeIds);
    }

    async exportFrame(frameId: string, options: { scale: 1 | 2; format: "png" | "jpeg" }): Promise<DesignPocExportResult> {
        this.assertActive();
        const id = frameShapeId(frameId);
        if (!this.editor.getShape(id)) throw new Error(`tldraw Frame 不存在：${frameId}`);
        const started = performance.now();
        const result = await this.editor.toImage([id], { format: options.format, background: true, padding: 0, scale: options.scale, pixelRatio: 1, darkMode: false });
        return { blob: result.blob, width: result.width, height: result.height, durationMs: performance.now() - started };
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

    destroy() {
        this.destroyed = true;
    }

    private sync(document: DesignPocDocument, history: "record" | "ignore") {
        this.assertActive();
        this.editor.run(
            () => {
                const shapeIds = [...this.editor.getCurrentPageShapeIds()];
                if (shapeIds.length) this.editor.deleteShapes(shapeIds);
                const assetIds = this.editor.getAssets().map((asset) => asset.id);
                if (assetIds.length) this.editor.deleteAssets(assetIds);
                this.editor.createAssets(document.assets.map(createTldrawAsset));
                this.editor.createShapes(document.frames.map((frame) => createFrameShape(frame, document)));
                for (const frame of document.frames) {
                    this.editor.createShape(createFrameBackgroundShape(frame));
                    this.editor.createShapes(
                        document.elements
                            .filter((element) => element.frameId === frame.id)
                            .toSorted((left, right) => left.zIndex - right.zIndex)
                            .map((element) => createElementShape(element, document.assets)),
                    );
                }
                this.editor.setCamera({ x: document.viewport.x, y: document.viewport.y, z: document.viewport.zoom });
            },
            { history },
        );
    }

    private readElement(shape: TLShape, frames: Map<string, DesignPocFrame>): DesignPocElement {
        const stored = meta(shape).designPocElement;
        if (!stored) throw new Error(`tldraw 元素元数据缺失：${shape.id}`);
        const frame = frames.get(stored.frameId);
        if (!frame) throw new Error(`tldraw 元素 Frame 缺失：${stored.id}`);
        const width = shape.type === "image" || shape.type === "geo" ? shape.props.w : stored.width;
        const height = shape.type === "image" || shape.type === "geo" ? shape.props.h : stored.height;
        return {
            ...stored,
            x: round(shape.x),
            y: round(shape.y),
            width: round(width),
            height: round(height),
            rotation: round((shape.rotation * 180) / Math.PI),
            opacity: stored.opacity,
            locked: shape.isLocked,
        };
    }

    private assertActive() {
        if (this.destroyed) throw new Error("tldraw PoC 适配器已销毁");
    }
}

function createTldrawAsset(asset: DesignPocAsset) {
    return AssetRecordType.create({
        id: assetRecordId(asset.id),
        type: "image",
        props: { w: asset.width, h: asset.height, name: asset.name, isAnimated: false, mimeType: asset.mimeType, src: asset.src },
        meta: { designPocAsset: asset },
    });
}

function createFrameShape(frame: DesignPocFrame, document: DesignPocDocument): TLCreateShapePartial<TLFrameShape> {
    return {
        id: frameShapeId(frame.id),
        type: "frame",
        x: frame.x,
        y: frame.y,
        props: { w: frame.width, h: frame.height, name: frame.name, color: "black" },
        meta: { designPocRole: "frame", designPocFrame: frame, designPocProject: { id: document.id, title: document.title } },
    };
}

function createFrameBackgroundShape(frame: DesignPocFrame): TLCreateShapePartial<TLGeoShape> {
    return {
        id: backgroundShapeId(frame.id),
        parentId: frameShapeId(frame.id),
        type: "geo",
        x: 0,
        y: 0,
        isLocked: true,
        props: {
            geo: "rectangle",
            w: frame.width,
            h: frame.height,
            color: frame.background === "#111827" ? "black" : "grey",
            fill: "solid",
            dash: "solid",
            size: "s",
            font: "sans",
            align: "middle",
            verticalAlign: "middle",
            richText: toRichText(""),
            labelColor: "black",
            url: "",
            growY: 0,
            scale: 1,
        },
        meta: { designPocRole: "frame-background" },
    };
}

function createElementShape(element: DesignPocElement, assets: DesignPocAsset[]): TLCreateShapePartial<TLShape> {
    const common = {
        id: elementShapeId(element.id),
        parentId: frameShapeId(element.frameId),
        x: element.x,
        y: element.y,
        rotation: (element.rotation * Math.PI) / 180,
        opacity: element.hidden ? 0 : element.opacity,
        isLocked: element.locked,
        meta: { designPocRole: "element", designPocElement: element },
    };
    if (element.kind === "image") {
        const asset = assets.find((candidate) => candidate.id === element.assetId);
        if (!asset) throw new Error(`tldraw 图片资源不存在：${element.assetId}`);
        return {
            ...common,
            type: "image",
            props: {
                w: element.width,
                h: element.height,
                playing: false,
                url: "",
                assetId: assetRecordId(asset.id),
                crop: element.crop ? { topLeft: { x: element.crop.x, y: element.crop.y }, bottomRight: { x: element.crop.x + element.crop.width, y: element.crop.y + element.crop.height } } : null,
                flipX: element.flipX,
                flipY: element.flipY,
                altText: element.name,
            },
        } as TLCreateShapePartial<TLImageShape>;
    }
    if (element.kind === "text") {
        const scale = Math.max(0.25, element.fontSize / 32);
        return {
            ...common,
            type: "text",
            props: {
                color: colorToken(element.color),
                size: "xl",
                font: "sans",
                textAlign: element.align === "left" ? "start" : element.align === "right" ? "end" : "middle",
                w: element.width / scale,
                richText: toRichText(element.text),
                scale,
                autoSize: false,
            },
        } as TLCreateShapePartial<TLTextShape>;
    }
    return {
        ...common,
        type: "geo",
        props: {
            geo: element.shape,
            w: element.width,
            h: element.height,
            color: colorToken(element.stroke),
            fill: "solid",
            dash: "solid",
            size: element.strokeWidth > 3 ? "m" : "s",
            font: "sans",
            align: "middle",
            verticalAlign: "middle",
            richText: toRichText(""),
            labelColor: "black",
            url: "",
            growY: 0,
            scale: 1,
        },
    } as TLCreateShapePartial<TLGeoShape>;
}

function frameShapeId(id: string) {
    return createShapeId(`poc-frame-${id}`);
}

function backgroundShapeId(id: string) {
    return createShapeId(`poc-background-${id}`);
}

function elementShapeId(id: string) {
    return createShapeId(id);
}

function assetRecordId(id: string) {
    return AssetRecordType.createId(id) as TLAssetId;
}

function meta(shape: TLShape) {
    return shape.meta as DesignShapeMeta & { designPocProject?: unknown };
}

function colorToken(value: string): "black" | "blue" | "green" | "yellow" | "grey" | "white" {
    const color = value.toLowerCase();
    if (color.includes("2563eb") || color.includes("1d4ed8")) return "blue";
    if (color.includes("10b981")) return "green";
    if (color.includes("f59e0b")) return "yellow";
    if (color.includes("ffffff")) return "white";
    if (color.includes("334155") || color.includes("94a3b8")) return "grey";
    return "black";
}

function round(value: number) {
    return Math.round(value * 1000) / 1000;
}
