import { ActiveSelection, Canvas, Circle, Ellipse, FabricImage, Group, Line, Rect, Shadow, Textbox, Triangle, util, type FabricObject, type ImageSource, type TPointerEventInfo } from "fabric";

import {
    DESIGN_LIMITS,
    createDesignFrameExportPlan,
    designResourceCacheKey,
    resolveDesignAssetVersion,
    type DesignAssetVersion,
    type DesignDocument,
    type DesignElement,
    type DesignFrame,
    type DesignFrameExportPlan,
    type DesignResourceResolver,
    type DesignTransform,
    type DesignViewport,
    type ResolvedDesignResource,
} from "@/lib/design";

import type { DesignEditorSelection } from "../model/design-editor-commands";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
const VIEWPORT_COMMIT_DELAY_MS = 180;
const SNAP_THRESHOLD_PX = 8;
const SNAP_RELEASE_THRESHOLD_PX = 12;

export type DesignSnapAxisLock = { pointIndex: number; position: number };
type DesignSnapScopeIndex = {
    frame: { vertical: number[]; horizontal: number[] };
    elements: Array<{ id: string; vertical: number[]; horizontal: number[] }>;
};
export type DesignSnapIndex = Map<string, DesignSnapScopeIndex>;
type DesignSnapSession = {
    target: FabricObject;
    candidates: { vertical: number[]; horizontal: number[] };
    verticalLock: DesignSnapAxisLock | null;
    horizontalLock: DesignSnapAxisLock | null;
};

type DesignFabricObjectMeta =
    | { kind: "frame"; id: string; frameId: null; projectionKey: "frame"; base: Pick<DesignFrame, "x" | "y" | "width" | "height">; baseScaleX: number; baseScaleY: number }
    | { kind: "element"; id: string; frameId: string | null; projectionKey: DesignFabricElementProjectionKey; base: DesignTransform; baseScaleX: number; baseScaleY: number };

type DesignFabricElementProjectionKey = "text" | `image:${string}` | "line" | "shape:rectangle" | "shape:ellipse" | `arrow:${"none" | "arrow" | "circle"}:${"none" | "arrow" | "circle"}`;

type DesignFabricFrameProjectionEntry = Readonly<{
    key: `frame:${string}`;
    frame: null;
    source: DesignFrame;
    meta: Extract<DesignFabricObjectMeta, { kind: "frame" }>;
}>;
type DesignFabricElementProjectionEntry = Readonly<{
    key: `element:${string}`;
    frame: DesignFrame | null;
    source: DesignElement;
    assetVersion: DesignAssetVersion | null;
    meta: Extract<DesignFabricObjectMeta, { kind: "element" }>;
}>;
type DesignFabricProjectionEntry = DesignFabricFrameProjectionEntry | DesignFabricElementProjectionEntry;
type DesignFabricProjectionUpdateResult = Readonly<{ object: FabricObject; reusable: boolean }>;

export type DesignFabricDependencies = Readonly<{
    resolveResource?: DesignResourceResolver;
    loadImageSource?: (url: string) => Promise<ImageSource>;
}>;

export type DesignFabricTransformIntent =
    { kind: "frame"; id: string; patch: Pick<DesignFrame, "x" | "y" | "width" | "height"> } | { kind: "element"; id: string; transform: DesignTransform } | { kind: "elements"; transforms: Array<{ id: string; transform: DesignTransform }> };

export type DesignFabricObjectSnapshot = { left: number; top: number; angle: number; scaleX: number; scaleY: number };

export type DesignFabricPoint = Readonly<{ x: number; y: number }>;
export type DesignFabricRect = Readonly<{ x: number; y: number; width: number; height: number }>;
export type DesignFabricSelectionSnapshot = Readonly<{
    revision: number;
    kind: "frame" | "elements" | null;
    ids: readonly string[];
    sceneBounds: DesignFabricRect | null;
    screenBounds: DesignFabricRect | null;
}>;
export type DesignFabricViewportSnapshot = Readonly<{
    revision: number;
    viewport: Readonly<DesignViewport>;
    surface: DesignFabricRect;
}>;
export type DesignFabricResizeSnapshot = Readonly<{
    revision: number;
    surface: DesignFabricRect;
}>;
export type DesignFabricObserver<T> = (snapshot: T) => void;
export type DesignFabricUnsubscribe = () => void;
export type DesignFabricObservationAdapter = Readonly<{
    getSelectionSnapshot: () => DesignFabricSelectionSnapshot;
    getViewportSnapshot: () => DesignFabricViewportSnapshot;
    getResizeSnapshot: () => DesignFabricResizeSnapshot;
    getSelectionBounds: () => DesignFabricRect | null;
    sceneToScreen: (point: DesignFabricPoint) => DesignFabricPoint;
    screenToScene: (point: DesignFabricPoint) => DesignFabricPoint;
    subscribeSelection: (listener: DesignFabricObserver<DesignFabricSelectionSnapshot>, emitCurrent?: boolean) => DesignFabricUnsubscribe;
    subscribeViewport: (listener: DesignFabricObserver<DesignFabricViewportSnapshot>, emitCurrent?: boolean) => DesignFabricUnsubscribe;
    subscribeResize: (listener: DesignFabricObserver<DesignFabricResizeSnapshot>, emitCurrent?: boolean) => DesignFabricUnsubscribe;
}>;

export type DesignFabricDiagnostics = Readonly<{
    objectCount: number;
    objects: readonly Readonly<{
        key: string;
        kind: DesignFabricObjectMeta["kind"];
        id: string;
        frameId: string | null;
        projectionKey: string;
        instanceId: number;
        index: number;
        left: number;
        top: number;
        width: number;
        height: number;
        angle: number;
    }>[];
    active: Readonly<{
        kind: "active-selection" | "object" | null;
        instanceId: number | null;
        ids: readonly string[];
        left: number | null;
        top: number | null;
        width: number | null;
        height: number | null;
    }>;
    counters: Readonly<{ created: number; replaced: number; removed: number; reordered: number; updated: number }>;
}>;

export type DesignFabricFrameExportResult = Readonly<{
    frameId: string;
    fileName: string;
    mimeType: DesignFrameExportPlan["mimeType"];
    width: number;
    height: number;
    blob: Blob;
}>;

export function createDesignFabricTransformIntent(meta: DesignFabricObjectMeta, snapshot: DesignFabricObjectSnapshot, frame: DesignFrame | null): DesignFabricTransformIntent {
    const ratioX = Math.max(0.000_001, Math.abs(snapshot.scaleX / nonZero(meta.baseScaleX)));
    const ratioY = Math.max(0.000_001, Math.abs(snapshot.scaleY / nonZero(meta.baseScaleY)));
    if (meta.kind === "frame") {
        return {
            kind: "frame",
            id: meta.id,
            patch: {
                x: coordinate(snapshot.left),
                y: coordinate(snapshot.top),
                width: Math.round(clamp(meta.base.width * ratioX, 1, DESIGN_LIMITS.maxFrameEdge)),
                height: Math.round(clamp(meta.base.height * ratioY, 1, DESIGN_LIMITS.maxFrameEdge)),
            },
        };
    }
    return {
        kind: "element",
        id: meta.id,
        transform: {
            x: coordinate(snapshot.left - (frame?.x ?? 0)),
            y: coordinate(snapshot.top - (frame?.y ?? 0)),
            width: round(clamp(meta.base.width * ratioX, 0.001, DESIGN_LIMITS.maxElementEdge)),
            height: round(clamp(meta.base.height * ratioY, 0.001, DESIGN_LIMITS.maxElementEdge)),
            rotation: round(snapshot.angle),
            flipX: meta.base.flipX,
            flipY: meta.base.flipY,
        },
    };
}

export class DesignFabricAdapter {
    private document: DesignDocument | null = null;
    private viewportCommitTimer: ReturnType<typeof setTimeout> | null = null;
    private pan: { x: number; y: number } | null = null;
    private projecting = false;
    private readonly meta = new WeakMap<FabricObject, DesignFabricObjectMeta>();
    private readonly objects = new Map<string, FabricObject>();
    private readonly instanceIds = new WeakMap<FabricObject, number>();
    private readonly frameChildren = new Map<string, FabricObject[]>();
    private readonly resourceResolutions = new Map<string, Promise<ResolvedDesignResource>>();
    private readonly imageSources = new Map<string, Promise<ImageSource>>();
    private readonly resolvedImageKeys = new WeakMap<FabricObject, string>();
    private nextInstanceId = 1;
    private counters = { created: 0, replaced: 0, removed: 0, reordered: 0, updated: 0 };
    private snapIndex: DesignSnapIndex = new Map();
    private snapSession: DesignSnapSession | null = null;
    private movingFrame: { id: string; left: number; top: number } | null = null;
    private snapGuides: Array<{ axis: "horizontal" | "vertical"; position: number }> = [];
    private renderedSnapGuides = false;
    private selectionRevision = 0;
    private viewportRevision = 0;
    private resizeRevision = 0;
    private projectionGeneration = 0;
    private destroyed = false;
    private selection: DesignEditorSelection = null;
    private selectionSnapshot: DesignFabricSelectionSnapshot = EMPTY_SELECTION_SNAPSHOT;
    private viewportSnapshot: DesignFabricViewportSnapshot;
    private resizeSnapshot: DesignFabricResizeSnapshot;
    private readonly selectionObservers = new Set<DesignFabricObserver<DesignFabricSelectionSnapshot>>();
    private readonly viewportObservers = new Set<DesignFabricObserver<DesignFabricViewportSnapshot>>();
    private readonly resizeObservers = new Set<DesignFabricObserver<DesignFabricResizeSnapshot>>();

    constructor(
        private readonly canvas: Canvas,
        private readonly callbacks: {
            onViewportCommit: (viewport: DesignViewport) => void;
            onSelectionChange: (selection: DesignEditorSelection) => void;
            onTransformCommit: (intent: DesignFabricTransformIntent) => void;
        },
        private readonly dependencies: DesignFabricDependencies = {},
    ) {
        const surface = this.surfaceRect();
        this.viewportSnapshot = freezeViewportSnapshot(0, currentViewport(canvas), surface);
        this.resizeSnapshot = freezeResizeSnapshot(0, surface);
        canvas.on("mouse:wheel", this.onWheel);
        canvas.on("mouse:down", this.onMouseDown);
        canvas.on("mouse:move", this.onMouseMove);
        canvas.on("mouse:up", this.onMouseUp);
        canvas.on("selection:created", this.onSelection);
        canvas.on("selection:updated", this.onSelection);
        canvas.on("selection:cleared", this.onSelectionCleared);
        canvas.on("object:moving", this.onObjectMoving);
        canvas.on("object:scaling", this.onObjectTransforming);
        canvas.on("object:rotating", this.onObjectTransforming);
        canvas.on("object:resizing", this.onObjectTransforming);
        canvas.on("object:modified", this.onObjectModified);
        canvas.on("before:render", this.onBeforeRender);
        canvas.on("after:render", this.onAfterRender);
    }

    project(document: DesignDocument, selection: DesignEditorSelection = null) {
        if (this.destroyed) return;
        const generation = ++this.projectionGeneration;
        this.document = document;
        this.clearViewportCommit();
        this.pan = null;
        this.projecting = true;
        this.snapIndex = buildDesignSnapIndex(document);
        this.clearSnapSession();
        this.canvas.backgroundColor = document.workspace.background;
        this.reconcileProjection(document);
        this.resolveProjectedImages(document, generation);
        this.previewViewport(document.workspace.viewport);
        this.setSelection(selection);
        this.projecting = false;
        this.publishSelectionSnapshot();
    }

    setSelection(selection: DesignEditorSelection) {
        this.selection = selection;
        const wasProjecting = this.projecting;
        let rejected = false;
        this.projecting = true;
        try {
            if (!selection) {
                this.canvas.discardActiveObject();
                this.canvas.requestRenderAll();
                return;
            }
            if (selection.kind === "frame") {
                const object = this.objects.get(`frame:${selection.id}`);
                if (object) this.canvas.setActiveObject(object);
                else this.canvas.discardActiveObject();
            } else {
                const objects = selection.ids.flatMap((id) => {
                    const object = this.objects.get(`element:${id}`);
                    return object ? [object] : [];
                });
                const metas = objects.map((object) => this.meta.get(object));
                const frameIds = new Set(metas.flatMap((meta) => (meta?.kind === "element" ? [meta.frameId] : [])));
                if (objects.length !== selection.ids.length || frameIds.size > 1) {
                    rejected = true;
                    this.selection = null;
                    this.canvas.discardActiveObject();
                } else if (objects.length === 1) this.canvas.setActiveObject(objects[0]);
                else if (objects.length > 1) {
                    const active = new ActiveSelection(objects, { canvas: this.canvas, multiSelectionStacking: "canvas-stacking" });
                    const containsLocked = selection.ids.some((id) => this.document?.elements.find((element) => element.id === id)?.locked);
                    active.set({ lockMovementX: containsLocked, lockMovementY: containsLocked, lockScalingX: true, lockScalingY: true, lockRotation: true, lockScalingFlip: true, hasControls: false, hasBorders: true, borderColor: "#5270b5" });
                    this.canvas.setActiveObject(active);
                } else this.canvas.discardActiveObject();
            }
            this.canvas.requestRenderAll();
        } finally {
            this.projecting = wasProjecting;
            this.publishSelectionSnapshot();
            if (rejected && !wasProjecting) this.callbacks.onSelectionChange(null);
        }
    }

    previewViewport(viewport: DesignViewport) {
        this.canvas.setViewportTransform([viewport.zoom, 0, 0, viewport.zoom, viewport.x, viewport.y]);
        this.canvas.requestRenderAll();
        this.publishViewportSnapshot(viewport);
        this.publishSelectionSnapshot();
    }

    resize(width: number, height: number) {
        const nextWidth = Math.max(1, Math.floor(width));
        const nextHeight = Math.max(1, Math.floor(height));
        if (this.canvas.getWidth() === nextWidth && this.canvas.getHeight() === nextHeight) {
            this.canvas.requestRenderAll();
            return;
        }
        this.canvas.setDimensions({ width: nextWidth, height: nextHeight });
        this.canvas.requestRenderAll();
        this.publishResizeSnapshot();
        this.publishViewportSnapshot(currentViewport(this.canvas));
        this.publishSelectionSnapshot();
    }

    workspaceCenter(viewport: DesignViewport): { x: number; y: number } {
        return {
            x: round((this.canvas.getWidth() / 2 - viewport.x) / viewport.zoom),
            y: round((this.canvas.getHeight() / 2 - viewport.y) / viewport.zoom),
        };
    }

    fitViewport(document: DesignDocument, padding = 64): DesignViewport {
        const bounds = documentBounds(document);
        const width = Math.max(1, this.canvas.getWidth() - padding * 2);
        const height = Math.max(1, this.canvas.getHeight() - padding * 2);
        const zoom = clamp(Math.min(width / bounds.width, height / bounds.height), MIN_ZOOM, MAX_ZOOM);
        return {
            x: round((this.canvas.getWidth() - bounds.width * zoom) / 2 - bounds.x * zoom),
            y: round((this.canvas.getHeight() - bounds.height * zoom) / 2 - bounds.y * zoom),
            zoom: round(zoom),
        };
    }

    getSelectionSnapshot(): DesignFabricSelectionSnapshot {
        return this.selectionSnapshot;
    }

    getViewportSnapshot(): DesignFabricViewportSnapshot {
        return this.viewportSnapshot;
    }

    getResizeSnapshot(): DesignFabricResizeSnapshot {
        return this.resizeSnapshot;
    }

    getSelectionBounds(): DesignFabricRect | null {
        return this.selectionSnapshot.sceneBounds;
    }

    sceneToScreen(point: DesignFabricPoint): DesignFabricPoint {
        return designSceneToScreen(point, currentViewport(this.canvas), this.canvasOffset());
    }

    screenToScene(point: DesignFabricPoint): DesignFabricPoint {
        return designScreenToScene(point, currentViewport(this.canvas), this.canvasOffset());
    }

    subscribeSelection(listener: DesignFabricObserver<DesignFabricSelectionSnapshot>, emitCurrent = true): DesignFabricUnsubscribe {
        return subscribeDesignFabricObserver(this.selectionObservers, listener, this.selectionSnapshot, emitCurrent);
    }

    subscribeViewport(listener: DesignFabricObserver<DesignFabricViewportSnapshot>, emitCurrent = true): DesignFabricUnsubscribe {
        return subscribeDesignFabricObserver(this.viewportObservers, listener, this.viewportSnapshot, emitCurrent);
    }

    subscribeResize(listener: DesignFabricObserver<DesignFabricResizeSnapshot>, emitCurrent = true): DesignFabricUnsubscribe {
        return subscribeDesignFabricObserver(this.resizeObservers, listener, this.resizeSnapshot, emitCurrent);
    }

    getDiagnostics(): DesignFabricDiagnostics {
        const canvasObjects = this.canvas.getObjects();
        const objects = [...this.objects.entries()].map(([key, object]) => {
            const meta = this.meta.get(object)!;
            const bounds = object.getBoundingRect();
            return Object.freeze({
                key,
                kind: meta.kind,
                id: meta.id,
                frameId: meta.frameId,
                projectionKey: meta.projectionKey,
                instanceId: this.objectInstanceId(object),
                index: canvasObjects.indexOf(object),
                left: round(bounds.left),
                top: round(bounds.top),
                width: round(bounds.width),
                height: round(bounds.height),
                angle: round(object.angle),
            });
        });
        const active = this.canvas.getActiveObject();
        const activeIds = this.canvas.getActiveObjects().flatMap((object) => {
            const meta = this.meta.get(object);
            return meta ? [meta.id] : [];
        });
        const activeBounds = active?.getBoundingRect();
        return Object.freeze({
            objectCount: canvasObjects.length,
            objects: Object.freeze(objects),
            active: Object.freeze({
                kind: active ? (active instanceof ActiveSelection ? "active-selection" : "object") : null,
                instanceId: active ? this.objectInstanceId(active) : null,
                ids: Object.freeze(activeIds),
                left: activeBounds ? round(activeBounds.left) : null,
                top: activeBounds ? round(activeBounds.top) : null,
                width: activeBounds ? round(activeBounds.width) : null,
                height: activeBounds ? round(activeBounds.height) : null,
            }),
            counters: Object.freeze({ ...this.counters }),
        });
    }

    async exportFrame(requestedPlan: DesignFrameExportPlan): Promise<DesignFabricFrameExportResult> {
        const document = this.document;
        if (this.destroyed || !document) throw new Error("Design 画布尚未准备好");
        if (requestedPlan.documentId !== document.id || requestedPlan.documentRevision !== document.revision) throw new Error("画板已发生变化，请重新确认导出设置");
        const options = {
            format: requestedPlan.format,
            scale: requestedPlan.scale,
            quality: requestedPlan.quality,
            background: requestedPlan.background,
        } as const;
        let plan = { ...createDesignFrameExportPlan(document, requestedPlan.frame.id, options), fileName: requestedPlan.fileName };
        await this.ensureFrameImagesReady(plan);
        if (this.destroyed || this.document?.id !== plan.documentId || this.document.revision !== plan.documentRevision) throw new Error("画板在准备图片时发生变化，请重新导出");
        plan = { ...createDesignFrameExportPlan(this.document, plan.frame.id, options), fileName: requestedPlan.fileName };

        const exportCanvas = this.renderFrameCanvas(plan, plan.scale);
        const blob = await encodeDesignExportCanvas(exportCanvas, plan.mimeType, plan.quality);
        return { frameId: plan.frame.id, fileName: plan.fileName, mimeType: plan.mimeType, width: plan.pixelWidth, height: plan.pixelHeight, blob };
    }

    async previewFrame(frameId: string, options: Pick<DesignFrameExportPlan, "format" | "background">, maxEdge = 320): Promise<Blob> {
        const document = this.document;
        if (this.destroyed || !document) throw new Error("Design 画布尚未准备好");
        const plan = createDesignFrameExportPlan(document, frameId, { ...options, scale: 1, quality: 1 });
        await this.ensureFrameImagesReady(plan);
        if (this.destroyed || this.document?.id !== plan.documentId || this.document.revision !== plan.documentRevision) throw new Error("画板在准备预览时发生变化");
        const multiplier = Math.min(1, Math.max(1, maxEdge) / Math.max(plan.frame.width, plan.frame.height));
        return encodeDesignExportCanvas(this.renderFrameCanvas(plan, multiplier), "image/png", 1);
    }

    moveSelectionForDiagnostics(deltaX: number, deltaY: number) {
        const active = this.canvas.getActiveObject();
        if (!active) return;
        active.set({ left: active.left + deltaX, top: active.top + deltaY });
        active.setCoords();
        this.canvas.fire("object:moving", { target: active } as never);
        this.canvas.fire("object:modified", { target: active } as never);
        this.canvas.requestRenderAll();
    }

    destroy() {
        this.destroyed = true;
        this.projectionGeneration += 1;
        this.clearViewportCommit();
        this.canvas.off("mouse:wheel", this.onWheel);
        this.canvas.off("mouse:down", this.onMouseDown);
        this.canvas.off("mouse:move", this.onMouseMove);
        this.canvas.off("mouse:up", this.onMouseUp);
        this.canvas.off("selection:created", this.onSelection);
        this.canvas.off("selection:updated", this.onSelection);
        this.canvas.off("selection:cleared", this.onSelectionCleared);
        this.canvas.off("object:moving", this.onObjectMoving);
        this.canvas.off("object:scaling", this.onObjectTransforming);
        this.canvas.off("object:rotating", this.onObjectTransforming);
        this.canvas.off("object:resizing", this.onObjectTransforming);
        this.canvas.off("object:modified", this.onObjectModified);
        this.canvas.off("before:render", this.onBeforeRender);
        this.canvas.off("after:render", this.onAfterRender);
        this.document = null;
        this.pan = null;
        this.snapIndex.clear();
        this.clearSnapSession();
        this.frameChildren.clear();
        this.objects.clear();
        this.resourceResolutions.clear();
        this.imageSources.clear();
        this.selectionObservers.clear();
        this.viewportObservers.clear();
        this.resizeObservers.clear();
        this.canvas.dispose();
    }

    private reconcileProjection(document: DesignDocument) {
        const nextEntries = designFabricProjectionEntries(document);
        const nextKeys = new Set<string>(nextEntries.map((entry) => entry.key));
        const activeObject = this.canvas.getActiveObject();
        const activeSelection = activeObject instanceof ActiveSelection ? activeObject : null;
        if (activeSelection) this.canvas.discardActiveObject();

        for (const [key, object] of this.objects) {
            if (nextKeys.has(key)) continue;
            this.canvas.remove(object);
            this.objects.delete(key);
            this.counters.removed += 1;
        }

        const nextObjects: FabricObject[] = [];
        for (const entry of nextEntries) {
            const current = this.objects.get(entry.key);
            const currentMeta = current ? this.meta.get(current) : null;
            const update = current && currentMeta?.projectionKey === entry.meta.projectionKey ? updateProjectedObject(current, entry.source, entry.frame, "assetVersion" in entry ? entry.assetVersion : null) : null;
            const object = update?.reusable ? update.object : this.replaceProjectedObject(entry, current);
            if (update?.reusable) this.counters.updated += 1;
            const meta = withProjectionScales(entry.meta, object);
            this.meta.set(object, meta);
            this.objects.set(entry.key, object);
            nextObjects.push(object);
        }

        for (let index = 0; index < nextObjects.length; index += 1) if (this.canvas.moveObjectTo(nextObjects[index], index)) this.counters.reordered += 1;
        this.rebuildFrameChildren(nextEntries);
        this.canvas.requestRenderAll();
    }

    private replaceProjectedObject(entry: DesignFabricProjectionEntry, current?: FabricObject) {
        const object = entry.meta.kind === "frame" ? projectFrame(entry.source as DesignFrame) : projectElement(entry.source as DesignElement, entry.frame?.x ?? 0, entry.frame?.y ?? 0);
        this.objectInstanceId(object);
        if (current) {
            this.canvas.remove(current);
            this.counters.replaced += 1;
        } else this.counters.created += 1;
        this.canvas.add(object);
        return object;
    }

    private resolveProjectedImages(document: DesignDocument, generation: number) {
        if (!this.dependencies.resolveResource) return;
        const versions = new Map(document.assetVersions.map((version) => [version.id, version]));
        for (const element of document.elements) {
            if (element.kind !== "image" || element.hidden) continue;
            const version = versions.get(element.assetVersionId);
            if (!version) continue;
            void this.loadResolvedImage(version, () => this.isCurrentImageProjection(element.id, version.id, generation))
                .then(({ source, resource }) => this.installResolvedImage(element.id, version.id, generation, source, resource.cacheKey))
                .catch(() => undefined);
        }
    }

    private loadResolvedImage(version: DesignAssetVersion, isCurrent: () => boolean) {
        const resolver = this.dependencies.resolveResource;
        if (!resolver) return Promise.reject(new Error("Design 图片资源解析器未配置"));
        const locatorKey = designResourceCacheKey(version.locator);
        let resolution = this.resourceResolutions.get(locatorKey);
        if (!resolution) {
            resolution = resolveDesignAssetVersion(version, resolver, "editor");
            this.resourceResolutions.set(locatorKey, resolution);
            void resolution.catch(() => {
                if (this.resourceResolutions.get(locatorKey) === resolution) this.resourceResolutions.delete(locatorKey);
            });
        }
        return resolution.then((resource) => {
            if (!isCurrent()) throw new Error("图片投影已过期");
            let source = this.imageSources.get(resource.cacheKey);
            if (!source) {
                const load = this.dependencies.loadImageSource ?? ((url: string) => util.loadImage(url, { crossOrigin: "anonymous" }));
                source = load(resource.url);
                this.imageSources.set(resource.cacheKey, source);
                void source.catch(() => {
                    if (this.imageSources.get(resource.cacheKey) === source) this.imageSources.delete(resource.cacheKey);
                });
            }
            return source.then((imageSource) => ({ source: imageSource, resource }));
        });
    }

    private async ensureFrameImagesReady(plan: DesignFrameExportPlan) {
        const generation = this.projectionGeneration;
        const versions = new Map(plan.assetVersions.map((version) => [version.id, version]));
        await Promise.all(
            plan.elements.flatMap((element) => {
                if (element.kind !== "image") return [];
                const version = versions.get(element.assetVersionId);
                if (!version) return [Promise.reject(new Error(`图片版本不存在：${element.name}`))];
                return [
                    this.loadResolvedImage(version, () => this.isCurrentImageProjection(element.id, version.id, generation))
                        .then(({ source, resource }) => {
                            this.installResolvedImage(element.id, version.id, generation, source, resource.cacheKey);
                            const object = this.objects.get(`element:${element.id}`);
                            if (!(object instanceof Group) || this.resolvedImageKeys.get(object) !== resource.cacheKey) throw new Error(`图片尚未完成投影：${element.name}`);
                        })
                        .catch((error) => {
                            throw new Error(`无法准备图片“${element.name}”：${error instanceof Error ? error.message : "未知错误"}`);
                        }),
                ];
            }),
        );
    }

    private renderFrameCanvas(plan: DesignFrameExportPlan, multiplier: number): HTMLCanvasElement {
        const frameObject = this.objects.get(`frame:${plan.frame.id}`);
        if (!(frameObject instanceof Rect)) throw new Error(`Frame 尚未投影：${plan.frame.name}`);
        const elementObjects = plan.elements.map((element) => {
            const object = this.objects.get(`element:${element.id}`);
            if (!object) throw new Error(`元素尚未投影：${element.name}`);
            return object;
        });
        const includedObjects = new Set<unknown>([frameObject, ...elementObjects]);
        const originalViewport = [...this.canvas.viewportTransform] as [number, number, number, number, number, number];
        const originalCanvasBackground = this.canvas.backgroundColor;
        const originalFramePresentation = { fill: frameObject.fill, stroke: frameObject.stroke, strokeWidth: frameObject.strokeWidth, shadow: frameObject.shadow };
        try {
            this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
            this.canvas.backgroundColor = designFrameExportBackground(plan);
            frameObject.set({ fill: "rgba(0,0,0,0)", stroke: undefined, strokeWidth: 0, shadow: null });
            return this.canvas.toCanvasElement(multiplier, {
                left: plan.frame.x,
                top: plan.frame.y,
                width: plan.frame.width,
                height: plan.frame.height,
                filter: (object) => includedObjects.has(object),
            });
        } finally {
            frameObject.set(originalFramePresentation);
            this.canvas.backgroundColor = originalCanvasBackground;
            this.canvas.setViewportTransform(originalViewport);
            this.canvas.requestRenderAll();
        }
    }

    private isCurrentImageProjection(elementId: string, assetVersionId: string, generation: number) {
        if (this.destroyed || generation !== this.projectionGeneration || !this.document) return false;
        const element = this.document.elements.find((candidate) => candidate.id === elementId);
        return element?.kind === "image" && !element.hidden && element.assetVersionId === assetVersionId;
    }

    private installResolvedImage(elementId: string, assetVersionId: string, generation: number, source: ImageSource, cacheKey: string) {
        if (!this.isCurrentImageProjection(elementId, assetVersionId, generation) || !this.document) return;
        const element = this.document.elements.find((candidate): candidate is Extract<DesignElement, { kind: "image" }> => candidate.id === elementId && candidate.kind === "image" && !candidate.hidden);
        const version = this.document.assetVersions.find((candidate) => candidate.id === assetVersionId);
        if (!element || element.assetVersionId !== assetVersionId || !version) return;
        const key = `element:${element.id}`;
        const current = this.objects.get(key);
        const meta = current ? this.meta.get(current) : null;
        if (!current || meta?.kind !== "element" || meta.projectionKey !== designElementProjectionKey(element)) return;
        if (this.resolvedImageKeys.get(current) === cacheKey && current instanceof Group && updateProjectedResolvedImage(current, element, version)) {
            this.meta.set(current, withProjectionScales(meta, current));
            this.canvas.requestRenderAll();
            return;
        }

        const frame = element.frameId ? (this.document.frames.find((candidate) => candidate.id === element.frameId) ?? null) : null;
        const replacement = projectResolvedImage(element, version, source, frame?.x ?? 0, frame?.y ?? 0);
        const index = this.canvas.getObjects().indexOf(current);
        const selection = this.selection;
        const wasProjecting = this.projecting;
        this.projecting = true;
        try {
            this.objectInstanceId(replacement);
            this.canvas.remove(current);
            this.canvas.add(replacement);
            if (index >= 0) this.canvas.moveObjectTo(replacement, index);
            this.meta.set(replacement, withProjectionScales(meta, replacement));
            this.resolvedImageKeys.set(replacement, cacheKey);
            this.objects.set(key, replacement);
            this.counters.replaced += 1;
            this.rebuildFrameChildren(designFabricProjectionEntries(this.document));
            this.setSelection(selection);
            this.canvas.requestRenderAll();
        } finally {
            this.projecting = wasProjecting;
        }
    }

    private objectInstanceId(object: FabricObject) {
        const current = this.instanceIds.get(object);
        if (current) return current;
        const next = this.nextInstanceId++;
        this.instanceIds.set(object, next);
        return next;
    }

    private rebuildFrameChildren(entries: readonly DesignFabricProjectionEntry[]) {
        this.frameChildren.clear();
        for (const entry of entries) {
            if (entry.meta.kind !== "element" || !entry.meta.frameId) continue;
            const object = this.objects.get(entry.key);
            if (!object) continue;
            const children = this.frameChildren.get(entry.meta.frameId) ?? [];
            children.push(object);
            this.frameChildren.set(entry.meta.frameId, children);
        }
    }

    private readonly onSelection = (event: { selected?: FabricObject[] }) => {
        if (this.projecting) return;
        const selected = event.selected ?? this.canvas.getActiveObjects();
        const elementMetas = selected.map((object) => this.meta.get(object)).filter((meta): meta is Extract<DesignFabricObjectMeta, { kind: "element" }> => meta?.kind === "element");
        if (elementMetas.length === selected.length && elementMetas.length) {
            const frameId = elementMetas[0].frameId;
            if (elementMetas.every((meta) => meta.frameId === frameId)) {
                const active = this.canvas.getActiveObject();
                if (active instanceof ActiveSelection) {
                    const containsLocked = elementMetas.some((meta) => this.document?.elements.find((element) => element.id === meta.id)?.locked);
                    active.set({ lockMovementX: containsLocked, lockMovementY: containsLocked, lockScalingX: true, lockScalingY: true, lockRotation: true, hasControls: false });
                }
                this.callbacks.onSelectionChange({ kind: "elements", ids: elementMetas.map((meta) => meta.id) });
                this.publishSelectionSnapshot();
                return;
            }
            this.canvas.discardActiveObject();
            this.callbacks.onSelectionChange(null);
            this.publishSelectionSnapshot();
            return;
        }
        const object = selected[0] ?? this.canvas.getActiveObject();
        const meta = object ? this.meta.get(object) : null;
        this.callbacks.onSelectionChange(meta ? (meta.kind === "frame" ? { kind: "frame", id: meta.id } : { kind: "elements", ids: [meta.id] }) : null);
        this.publishSelectionSnapshot();
    };

    private readonly onSelectionCleared = () => {
        if (!this.projecting) this.callbacks.onSelectionChange(null);
        this.publishSelectionSnapshot();
    };

    private readonly onObjectMoving = (event: { target?: FabricObject }) => {
        const target = event.target;
        const meta = target ? this.meta.get(target) : null;
        if (!target) return;
        if (target instanceof ActiveSelection || meta?.kind === "element") this.snapMovingTarget(target);
        if (meta?.kind !== "frame") {
            this.publishSelectionSnapshot();
            return;
        }
        const left = target.left;
        const top = target.top;
        const previous = this.movingFrame?.id === meta.id ? this.movingFrame : { id: meta.id, left: meta.base.x, top: meta.base.y };
        const deltaX = left - previous.left;
        const deltaY = top - previous.top;
        if (deltaX || deltaY) {
            for (const object of this.frameChildren.get(meta.id) ?? []) object.set({ left: object.left + deltaX, top: object.top + deltaY });
        }
        this.movingFrame = { id: meta.id, left, top };
        this.publishSelectionSnapshot();
    };

    private readonly onObjectTransforming = () => {
        this.publishSelectionSnapshot();
    };

    private readonly onObjectModified = (event: { target?: FabricObject }) => {
        const movedFrameId = this.movingFrame?.id ?? null;
        this.movingFrame = null;
        if (movedFrameId) for (const object of this.frameChildren.get(movedFrameId) ?? []) object.setCoords();
        this.clearSnapSession();
        if (this.projecting || !this.document || !event.target) return;
        if (event.target instanceof ActiveSelection) {
            const transforms = event.target.getObjects().flatMap((object) => {
                const meta = this.meta.get(object);
                if (meta?.kind !== "element") return [];
                const point = object.getPointByOrigin("left", "top");
                const frame = meta.frameId ? (this.document?.frames.find((candidate) => candidate.id === meta.frameId) ?? null) : null;
                return [{ id: meta.id, transform: { ...meta.base, x: coordinate(point.x - (frame?.x ?? 0)), y: coordinate(point.y - (frame?.y ?? 0)) } }];
            });
            if (transforms.length) this.callbacks.onTransformCommit({ kind: "elements", transforms });
            this.publishSelectionSnapshot();
            return;
        }
        const meta = this.meta.get(event.target);
        if (!meta) {
            this.publishSelectionSnapshot();
            return;
        }
        const frame = meta.kind === "element" && meta.frameId ? (this.document.frames.find((candidate) => candidate.id === meta.frameId) ?? null) : null;
        this.callbacks.onTransformCommit(createDesignFabricTransformIntent(meta, { left: event.target.left, top: event.target.top, angle: event.target.angle, scaleX: event.target.scaleX, scaleY: event.target.scaleY }, frame));
        this.publishSelectionSnapshot();
    };

    private snapMovingTarget(target: FabricObject) {
        if (!this.document) return;
        const session = this.snapSession?.target === target ? this.snapSession : this.createSnapSession(target);
        if (!session) return;
        const rect = target.getBoundingRect();
        const zoom = Math.max(MIN_ZOOM, this.canvas.viewportTransform[0]);
        const threshold = SNAP_THRESHOLD_PX / zoom;
        const releaseThreshold = SNAP_RELEASE_THRESHOLD_PX / zoom;
        const vertical = resolveAxisSnap([rect.left, rect.left + rect.width / 2, rect.left + rect.width], session.candidates.vertical, threshold, releaseThreshold, session.verticalLock);
        const horizontal = resolveAxisSnap([rect.top, rect.top + rect.height / 2, rect.top + rect.height], session.candidates.horizontal, threshold, releaseThreshold, session.horizontalLock);
        if (vertical) target.left += vertical.delta;
        if (horizontal) target.top += horizontal.delta;
        if (vertical || horizontal) target.setCoords();
        session.verticalLock = vertical?.lock ?? null;
        session.horizontalLock = horizontal?.lock ?? null;
        this.snapGuides = [...(vertical ? [{ axis: "vertical" as const, position: vertical.position }] : []), ...(horizontal ? [{ axis: "horizontal" as const, position: horizontal.position }] : [])];
    }

    private createSnapSession(target: FabricObject) {
        const metas = target instanceof ActiveSelection ? target.getObjects().map((object) => this.meta.get(object)) : [this.meta.get(target)];
        const elementMetas = metas.filter((meta): meta is Extract<DesignFabricObjectMeta, { kind: "element" }> => meta?.kind === "element");
        if (!elementMetas.length || elementMetas.some((meta) => meta.frameId !== elementMetas[0].frameId)) return null;
        const session: DesignSnapSession = {
            target,
            candidates: designSnapCandidates(this.snapIndex, elementMetas[0].frameId, new Set(elementMetas.map((meta) => meta.id))),
            verticalLock: null,
            horizontalLock: null,
        };
        this.snapSession = session;
        return session;
    }

    private clearSnapSession() {
        this.snapSession = null;
        this.snapGuides = [];
    }

    private readonly onBeforeRender = () => {
        if (this.snapGuides.length || this.renderedSnapGuides) this.canvas.clearContext(this.canvas.contextTop);
        this.renderedSnapGuides = false;
    };

    private readonly onAfterRender = () => {
        if (!this.snapGuides.length) return;
        const context = this.canvas.contextTop;
        const inverseZoom = 1 / Math.max(MIN_ZOOM, currentViewport(this.canvas).zoom);
        const viewport = currentViewport(this.canvas);
        const sceneLeft = -viewport.x / viewport.zoom;
        const sceneTop = -viewport.y / viewport.zoom;
        const sceneRight = sceneLeft + this.canvas.getWidth() / viewport.zoom;
        const sceneBottom = sceneTop + this.canvas.getHeight() / viewport.zoom;
        context.save();
        context.setTransform(...this.canvas.viewportTransform);
        context.strokeStyle = "#ef4f91";
        context.lineWidth = inverseZoom;
        context.setLineDash([4 * inverseZoom, 3 * inverseZoom]);
        for (const guide of this.snapGuides) {
            context.beginPath();
            if (guide.axis === "vertical") {
                context.moveTo(guide.position, sceneTop);
                context.lineTo(guide.position, sceneBottom);
            } else {
                context.moveTo(sceneLeft, guide.position);
                context.lineTo(sceneRight, guide.position);
            }
            context.stroke();
        }
        context.restore();
        this.renderedSnapGuides = true;
    };

    private readonly onWheel = (event: TPointerEventInfo<WheelEvent>) => {
        if (!this.document) return;
        const previous = currentViewport(this.canvas);
        const zoom = clamp(previous.zoom * Math.pow(0.999, event.e.deltaY), MIN_ZOOM, MAX_ZOOM);
        const pointer = event.viewportPoint;
        const ratio = zoom / previous.zoom;
        const viewport = { x: round(pointer.x - (pointer.x - previous.x) * ratio), y: round(pointer.y - (pointer.y - previous.y) * ratio), zoom: round(zoom) };
        this.previewViewport(viewport);
        this.scheduleViewportCommit(viewport);
        event.e.preventDefault();
        event.e.stopPropagation();
    };

    private readonly onMouseDown = (event: TPointerEventInfo) => {
        const pointer = event.e as MouseEvent;
        if (pointer.button !== 1 && !pointer.altKey) return;
        this.clearViewportCommit();
        this.pan = { x: pointer.clientX, y: pointer.clientY };
        this.canvas.defaultCursor = "grabbing";
        this.canvas.setCursor("grabbing");
        pointer.preventDefault();
    };

    private readonly onMouseMove = (event: TPointerEventInfo) => {
        if (!this.pan) return;
        const pointer = event.e as MouseEvent;
        const viewport = currentViewport(this.canvas);
        viewport.x = round(viewport.x + pointer.clientX - this.pan.x);
        viewport.y = round(viewport.y + pointer.clientY - this.pan.y);
        this.pan = { x: pointer.clientX, y: pointer.clientY };
        this.previewViewport(viewport);
    };

    private readonly onMouseUp = () => {
        if (!this.pan) {
            this.clearSnapSession();
            return;
        }
        this.pan = null;
        this.canvas.defaultCursor = "default";
        this.canvas.setCursor("default");
        this.callbacks.onViewportCommit(currentViewport(this.canvas));
    };

    private publishSelectionSnapshot() {
        const next = createDesignFabricSelectionSnapshot(this.canvas, this.meta, currentViewport(this.canvas), this.canvasOffset(), this.selectionRevision);
        if (sameDesignFabricSelectionSnapshot(this.selectionSnapshot, next)) return;
        this.selectionRevision += 1;
        this.selectionSnapshot = Object.freeze({ ...next, revision: this.selectionRevision });
        notifyDesignFabricObservers(this.selectionObservers, this.selectionSnapshot);
    }

    private publishViewportSnapshot(viewport: DesignViewport) {
        const next = freezeViewportSnapshot(this.viewportRevision, viewport, this.surfaceRect());
        if (sameDesignFabricViewportSnapshot(this.viewportSnapshot, next)) return;
        this.viewportRevision += 1;
        this.viewportSnapshot = freezeViewportSnapshot(this.viewportRevision, viewport, next.surface);
        notifyDesignFabricObservers(this.viewportObservers, this.viewportSnapshot);
    }

    private publishResizeSnapshot() {
        const surface = this.surfaceRect();
        if (sameDesignFabricRect(this.resizeSnapshot.surface, surface)) return;
        this.resizeRevision += 1;
        this.resizeSnapshot = freezeResizeSnapshot(this.resizeRevision, surface);
        notifyDesignFabricObservers(this.resizeObservers, this.resizeSnapshot);
    }

    private surfaceRect(): DesignFabricRect {
        return Object.freeze({ x: 0, y: 0, width: round(this.canvas.getWidth()), height: round(this.canvas.getHeight()) });
    }

    private canvasOffset(): DesignFabricPoint {
        const rect = this.canvas.upperCanvasEl?.getBoundingClientRect?.() ?? this.canvas.getElement().getBoundingClientRect();
        return Object.freeze({ x: round(rect.left), y: round(rect.top) });
    }

    private scheduleViewportCommit(viewport: DesignViewport) {
        this.clearViewportCommit();
        this.viewportCommitTimer = setTimeout(() => {
            this.viewportCommitTimer = null;
            this.callbacks.onViewportCommit(viewport);
        }, VIEWPORT_COMMIT_DELAY_MS);
    }

    private clearViewportCommit() {
        if (this.viewportCommitTimer) clearTimeout(this.viewportCommitTimer);
        this.viewportCommitTimer = null;
    }
}

function designFabricProjectionEntries(document: DesignDocument): DesignFabricProjectionEntry[] {
    const elements = new Map(document.elements.map((element) => [element.id, element]));
    const frames = new Map(document.frames.map((frame) => [frame.id, frame]));
    const assetVersions = new Map(document.assetVersions.map((version) => [version.id, version]));
    const entries: DesignFabricProjectionEntry[] = document.frames.map((frame) => ({
        key: `frame:${frame.id}`,
        frame: null,
        source: frame,
        meta: { kind: "frame", id: frame.id, frameId: null, projectionKey: "frame", base: frame, baseScaleX: 1, baseScaleY: 1 },
    }));
    const appendLayer = (elementIds: readonly string[], frame: DesignFrame | null) => {
        for (const id of elementIds) {
            const element = elements.get(id);
            if (!element || element.hidden) continue;
            entries.push({
                key: `element:${element.id}`,
                frame,
                source: element,
                assetVersion: element.kind === "image" ? (assetVersions.get(element.assetVersionId) ?? null) : null,
                meta: { kind: "element", id: element.id, frameId: element.frameId, projectionKey: designElementProjectionKey(element), base: element.transform, baseScaleX: 1, baseScaleY: 1 },
            });
        }
    };
    appendLayer(document.layers.find((layer) => layer.scope === "workspace")?.elementIds ?? [], null);
    for (const frame of document.frames) {
        const layer = document.layers.find((candidate) => candidate.scope === "frame" && candidate.frameId === frame.id);
        appendLayer(layer?.elementIds ?? [], frames.get(frame.id) ?? null);
    }
    return entries;
}

function designFrameExportBackground(plan: DesignFrameExportPlan) {
    if (plan.background === "transparent") return "rgba(0,0,0,0)";
    if (plan.background === "white") return "#ffffff";
    return plan.frame.background ?? (plan.format === "jpeg" ? "#ffffff" : "rgba(0,0,0,0)");
}

function encodeDesignExportCanvas(canvas: HTMLCanvasElement, mimeType: DesignFrameExportPlan["mimeType"], quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (!blob) {
                    reject(new Error(`浏览器无法编码 ${mimeType}`));
                    return;
                }
                if (blob.type && blob.type !== mimeType) {
                    reject(new Error(`浏览器不支持 ${mimeType}，实际返回 ${blob.type}`));
                    return;
                }
                resolve(blob.type ? blob : new Blob([blob], { type: mimeType }));
            },
            mimeType,
            quality,
        );
    });
}

function designElementProjectionKey(element: DesignElement): DesignFabricElementProjectionKey {
    if (element.kind === "shape") return `shape:${element.shape}`;
    if (element.kind === "arrow") return `arrow:${element.startHead}:${element.endHead}`;
    if (element.kind === "image") return `image:${element.assetVersionId}`;
    return element.kind;
}

function withProjectionScales(meta: DesignFabricObjectMeta, object: FabricObject): DesignFabricObjectMeta {
    return { ...meta, baseScaleX: object.scaleX, baseScaleY: object.scaleY };
}

function updateProjectedObject(object: FabricObject, source: DesignFrame | DesignElement, frame: DesignFrame | null, assetVersion: DesignAssetVersion | null): DesignFabricProjectionUpdateResult {
    return "export" in source ? updateProjectedFrame(object, source) : updateProjectedElement(object, source, frame?.x ?? 0, frame?.y ?? 0, assetVersion);
}

function updateProjectedFrame(object: FabricObject, frame: DesignFrame) {
    if (!(object instanceof Rect)) return { object, reusable: false } as const;
    object.set({ left: frame.x, top: frame.y, width: frame.width, height: frame.height, scaleX: 1, scaleY: 1, angle: 0, flipX: false, flipY: false, fill: frame.background ?? "#ffffff" });
    interactive(object, frame.locked, false);
    object.setCoords();
    return { object, reusable: true } as const;
}

function updateProjectedElement(object: FabricObject, element: DesignElement, offsetX: number, offsetY: number, assetVersion: DesignAssetVersion | null) {
    const transform = element.transform;
    let reusable = false;
    if (element.kind === "shape") {
        if (element.shape === "ellipse" && object instanceof Ellipse) {
            object.set({ rx: transform.width / 2, ry: transform.height / 2, fill: element.fill ?? "transparent", stroke: element.stroke ?? undefined, strokeWidth: element.strokeWidth });
            reusable = true;
        } else if (element.shape === "rectangle" && object instanceof Rect) {
            object.set({ width: transform.width, height: transform.height, rx: element.cornerRadius, ry: element.cornerRadius, fill: element.fill ?? "transparent", stroke: element.stroke ?? undefined, strokeWidth: element.strokeWidth });
            reusable = true;
        }
    } else if (element.kind === "text" && object instanceof Textbox) {
        updateProjectedText(object, element);
        reusable = true;
    } else if (element.kind === "image" && object instanceof Group) reusable = assetVersion ? updateProjectedResolvedImage(object, element, assetVersion) || updateProjectedImage(object, element) : updateProjectedImage(object, element);
    else if (element.kind === "line" && object instanceof Line) {
        updateFabricLine(object, transform.width, transform.height, { stroke: element.stroke, strokeWidth: element.strokeWidth, dash: element.dash, cap: element.cap });
        reusable = true;
    } else if (element.kind === "arrow" && object instanceof Group) reusable = updateProjectedArrow(object, element);
    if (!reusable) return { object, reusable: false } as const;
    setProjectedElementTransform(object, element, offsetX, offsetY);
    interactive(object, element.locked, true);
    object.setCoords();
    return { object, reusable: true } as const;
}

function setProjectedElementTransform(object: FabricObject, element: DesignElement, offsetX: number, offsetY: number) {
    const transform = element.transform;
    object.set({
        left: offsetX + transform.x,
        top: offsetY + transform.y,
        angle: transform.rotation,
        opacity: element.opacity,
        flipX: transform.flipX,
        flipY: transform.flipY,
        scaleX: 1,
        scaleY: element.kind === "text" && object instanceof Textbox ? transform.height / Math.max(1, object.height) : 1,
    });
}

function updateProjectedText(object: Textbox, element: Extract<DesignElement, { kind: "text" }>) {
    object.set({
        text: element.text,
        width: element.transform.width,
        fontFamily: element.fontFamily,
        fontSize: element.fontSize,
        fontWeight: element.fontWeight,
        fontStyle: element.fontStyle,
        lineHeight: element.lineHeight,
        charSpacing: element.fontSize ? (element.letterSpacing / element.fontSize) * 1000 : 0,
        textAlign: element.align,
        fill: element.fill,
        stroke: element.stroke ?? undefined,
        strokeWidth: element.strokeWidth,
    });
}

function updateProjectedImage(object: Group, element: Extract<DesignElement, { kind: "image" }>) {
    const [background, firstDiagonal, secondDiagonal, label] = object.getObjects();
    if (!(background instanceof Rect) || !(firstDiagonal instanceof Line) || !(secondDiagonal instanceof Line) || !(label instanceof Textbox)) return false;

    withNeutralGroupLayout(object, () => {
        const transform = element.transform;
        background.set({ left: 0, top: 0, width: transform.width, height: transform.height, rx: element.cornerRadius, ry: element.cornerRadius });
        updateFabricLine(firstDiagonal, transform.width, transform.height, { stroke: "#bdc6d3", strokeWidth: 1, dash: undefined });
        updateFabricLine(secondDiagonal, transform.width, transform.height, { stroke: "#bdc6d3", strokeWidth: 1, dash: undefined, reversed: true });
        label.set({ left: 0, top: Math.max(0, transform.height / 2 - 10), width: transform.width, fontSize: Math.min(18, Math.max(10, transform.height / 8)) });
    });
    return true;
}

function updateProjectedResolvedImage(object: Group, element: Extract<DesignElement, { kind: "image" }>, version: DesignAssetVersion) {
    const [background, image] = object.getObjects();
    if (!(background instanceof Rect) || !(image instanceof FabricImage) || object.getObjects().length !== 2) return false;
    withNeutralGroupLayout(object, () => {
        const transform = element.transform;
        background.set({ left: 0, top: 0, width: transform.width, height: transform.height, rx: element.cornerRadius, ry: element.cornerRadius });
        setResolvedImageGeometry(image, element, version);
        object.clipPath = roundedImageClip(transform.width, transform.height, element.cornerRadius);
    });
    return true;
}

export function designImageRenderGeometry(element: Extract<DesignElement, { kind: "image" }>, version: DesignAssetVersion) {
    const crop = element.crop ?? { x: 0, y: 0, width: 1, height: 1 };
    const source = {
        x: round(version.width * crop.x),
        y: round(version.height * crop.y),
        width: round(version.width * crop.width),
        height: round(version.height * crop.height),
    };
    const target = element.transform;
    if (element.fit === "fill") return Object.freeze({ source: Object.freeze(source), destination: Object.freeze({ x: 0, y: 0, width: target.width, height: target.height }) });
    const scale = element.fit === "cover" ? Math.max(target.width / source.width, target.height / source.height) : Math.min(target.width / source.width, target.height / source.height);
    const width = round(source.width * scale);
    const height = round(source.height * scale);
    return Object.freeze({ source: Object.freeze(source), destination: Object.freeze({ x: round((target.width - width) / 2), y: round((target.height - height) / 2), width, height }) });
}

function setResolvedImageGeometry(image: FabricImage, element: Extract<DesignElement, { kind: "image" }>, version: DesignAssetVersion) {
    const geometry = designImageRenderGeometry(element, version);
    image.set({
        left: geometry.destination.x,
        top: geometry.destination.y,
        cropX: geometry.source.x,
        cropY: geometry.source.y,
        width: geometry.source.width,
        height: geometry.source.height,
        scaleX: geometry.destination.width / geometry.source.width,
        scaleY: geometry.destination.height / geometry.source.height,
        originX: "left",
        originY: "top",
    });
}

function roundedImageClip(width: number, height: number, cornerRadius: number) {
    return new Rect({ width, height, rx: cornerRadius, ry: cornerRadius, originX: "center", originY: "center", fill: "#000000" });
}

function updateProjectedArrow(object: Group, element: Extract<DesignElement, { kind: "arrow" }>) {
    const [shaft, ...heads] = object.getObjects();
    if (!(shaft instanceof Line)) return false;
    const expectedHeadTypes = [element.startHead, element.endHead].filter((head): head is "arrow" | "circle" => head !== "none");
    if (heads.length !== expectedHeadTypes.length || heads.some((head, index) => !matchesArrowHead(head, expectedHeadTypes[index]))) return false;

    withNeutralGroupLayout(object, () => {
        const transform = element.transform;
        updateFabricLine(shaft, transform.width, transform.height, { stroke: element.stroke, strokeWidth: element.strokeWidth, dash: element.dash });
        let headIndex = 0;
        if (element.startHead !== "none") updateArrowHead(heads[headIndex++], element.startHead, 0, 0, transform.width, transform.height, element.stroke, element.strokeWidth, true);
        if (element.endHead !== "none") updateArrowHead(heads[headIndex], element.endHead, transform.width, transform.height, transform.width, transform.height, element.stroke, element.strokeWidth, false);
    });
    return true;
}

function matchesArrowHead(object: FabricObject, kind: "arrow" | "circle") {
    return kind === "circle" ? object instanceof Circle : object instanceof Triangle;
}

function updateArrowHead(object: FabricObject | undefined, kind: "arrow" | "circle", x: number, y: number, width: number, height: number, stroke: string, strokeWidth: number, start: boolean) {
    if (kind === "circle" && object instanceof Circle) {
        object.set({ left: x - strokeWidth, top: y - strokeWidth, radius: strokeWidth, fill: stroke });
        return;
    }
    if (kind === "arrow" && object instanceof Triangle) {
        object.set({
            left: x,
            top: y,
            width: strokeWidth * 4,
            height: strokeWidth * 4,
            fill: stroke,
            angle: (Math.atan2(height, width) * 180) / Math.PI + (start ? -90 : 90),
            originX: "center",
            originY: "center",
        });
    }
}

function updateFabricLine(object: Line, width: number, height: number, options: { stroke: string; strokeWidth: number; dash?: number[]; cap?: "butt" | "round" | "square"; reversed?: boolean }) {
    object.set({
        x1: options.reversed ? width : 0,
        y1: 0,
        x2: options.reversed ? 0 : width,
        y2: height,
        stroke: options.stroke,
        strokeWidth: options.strokeWidth,
        strokeDashArray: options.dash ? [...options.dash] : undefined,
        ...(options.cap ? { strokeLineCap: options.cap } : {}),
    });
}

function withNeutralGroupLayout(group: Group, update: () => void) {
    group.set({ left: 0, top: 0, angle: 0, flipX: false, flipY: false, scaleX: 1, scaleY: 1 });
    update();
    group.triggerLayout();
}

function projectFrame(frame: DesignFrame) {
    const object = new Rect({
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
        fill: frame.background ?? "#ffffff",
        stroke: "#c8ced8",
        strokeWidth: 1,
        shadow: new Shadow({ color: "rgba(15, 23, 42, 0.14)", blur: 18, offsetX: 0, offsetY: 8 }),
        originX: "left",
        originY: "top",
        objectCaching: true,
    });
    return interactive(object, frame.locked, false);
}

function projectElement(element: DesignElement, offsetX: number, offsetY: number): FabricObject {
    const transform = element.transform;
    const common = {
        left: offsetX + transform.x,
        top: offsetY + transform.y,
        angle: transform.rotation,
        opacity: element.opacity,
        flipX: transform.flipX,
        flipY: transform.flipY,
        originX: "left" as const,
        originY: "top" as const,
        objectCaching: true,
    };
    let object: FabricObject;
    if (element.kind === "text") {
        const text = new Textbox(element.text, {
            ...common,
            width: transform.width,
            fontFamily: element.fontFamily,
            fontSize: element.fontSize,
            fontWeight: element.fontWeight,
            fontStyle: element.fontStyle,
            lineHeight: element.lineHeight,
            charSpacing: element.fontSize ? (element.letterSpacing / element.fontSize) * 1000 : 0,
            textAlign: element.align,
            fill: element.fill,
            stroke: element.stroke ?? undefined,
            strokeWidth: element.strokeWidth,
        });
        text.scaleY = transform.height / Math.max(1, text.height);
        object = text;
    } else if (element.kind === "shape") {
        object =
            element.shape === "ellipse"
                ? new Ellipse({ ...common, rx: transform.width / 2, ry: transform.height / 2, fill: element.fill ?? "transparent", stroke: element.stroke ?? undefined, strokeWidth: element.strokeWidth })
                : new Rect({ ...common, width: transform.width, height: transform.height, rx: element.cornerRadius, ry: element.cornerRadius, fill: element.fill ?? "transparent", stroke: element.stroke ?? undefined, strokeWidth: element.strokeWidth });
    } else if (element.kind === "image") {
        object = new Group(
            [
                new Rect({ left: 0, top: 0, width: transform.width, height: transform.height, rx: element.cornerRadius, ry: element.cornerRadius, fill: "#e8edf5", stroke: "#aeb8c7", strokeWidth: 1 }),
                new Line([0, 0, transform.width, transform.height], { stroke: "#bdc6d3", strokeWidth: 1 }),
                new Line([transform.width, 0, 0, transform.height], { stroke: "#bdc6d3", strokeWidth: 1 }),
                new Textbox("图片素材", { left: 0, top: Math.max(0, transform.height / 2 - 10), width: transform.width, textAlign: "center", fontSize: Math.min(18, Math.max(10, transform.height / 8)), fill: "#68768b" }),
            ],
            common,
        );
    } else if (element.kind === "line") {
        object = new Line([0, 0, transform.width, transform.height], { ...common, stroke: element.stroke, strokeWidth: element.strokeWidth, strokeDashArray: [...element.dash], strokeLineCap: element.cap });
    } else {
        const objects: FabricObject[] = [new Line([0, 0, transform.width, transform.height], { stroke: element.stroke, strokeWidth: element.strokeWidth, strokeDashArray: [...element.dash] })];
        if (element.startHead !== "none") objects.push(createArrowHead(element.startHead, 0, 0, transform.width, transform.height, element.stroke, element.strokeWidth, true));
        if (element.endHead !== "none") objects.push(createArrowHead(element.endHead, transform.width, transform.height, transform.width, transform.height, element.stroke, element.strokeWidth, false));
        object = new Group(objects, common);
    }
    return interactive(object, element.locked, true);
}

function projectResolvedImage(element: Extract<DesignElement, { kind: "image" }>, version: DesignAssetVersion, source: ImageSource, offsetX: number, offsetY: number) {
    const transform = element.transform;
    const background = new Rect({ left: 0, top: 0, width: transform.width, height: transform.height, rx: element.cornerRadius, ry: element.cornerRadius, fill: "transparent", strokeWidth: 0 });
    const image = new FabricImage(source, { objectCaching: true, imageSmoothing: true });
    setResolvedImageGeometry(image, element, version);
    const object = new Group([background, image], {
        left: offsetX + transform.x,
        top: offsetY + transform.y,
        angle: transform.rotation,
        opacity: element.opacity,
        flipX: transform.flipX,
        flipY: transform.flipY,
        originX: "left",
        originY: "top",
        objectCaching: true,
        clipPath: roundedImageClip(transform.width, transform.height, element.cornerRadius),
    });
    return interactive(object, element.locked, true);
}

function createArrowHead(kind: "arrow" | "circle", x: number, y: number, width: number, height: number, stroke: string, strokeWidth: number, start: boolean): FabricObject {
    if (kind === "circle") return new Circle({ left: x - strokeWidth, top: y - strokeWidth, radius: strokeWidth, fill: stroke });
    return new Triangle({
        left: x,
        top: y,
        width: strokeWidth * 4,
        height: strokeWidth * 4,
        fill: stroke,
        angle: (Math.atan2(height, width) * 180) / Math.PI + (start ? -90 : 90),
        originX: "center",
        originY: "center",
    });
}

function interactive<T extends FabricObject>(object: T, locked: boolean, rotatable: boolean): T {
    object.set({
        selectable: true,
        evented: true,
        hasControls: !locked,
        hasBorders: true,
        lockMovementX: locked,
        lockMovementY: locked,
        lockScalingX: locked,
        lockScalingY: locked,
        lockRotation: locked || !rotatable,
        lockScalingFlip: true,
        borderColor: "#5270b5",
        cornerColor: "#ffffff",
        cornerStrokeColor: "#5270b5",
        transparentCorners: false,
    });
    if (!rotatable) object.setControlsVisibility({ mtr: false });
    return object;
}

function currentViewport(canvas: Canvas): DesignViewport {
    const transform = canvas.viewportTransform;
    return { x: round(transform[4]), y: round(transform[5]), zoom: round(transform[0]) };
}

export function designSceneToScreen(point: DesignFabricPoint, viewport: DesignViewport, canvasOffset: DesignFabricPoint = { x: 0, y: 0 }): DesignFabricPoint {
    return Object.freeze({
        x: round(canvasOffset.x + viewport.x + point.x * viewport.zoom),
        y: round(canvasOffset.y + viewport.y + point.y * viewport.zoom),
    });
}

export function designScreenToScene(point: DesignFabricPoint, viewport: DesignViewport, canvasOffset: DesignFabricPoint = { x: 0, y: 0 }): DesignFabricPoint {
    const zoom = Math.max(MIN_ZOOM, Math.abs(viewport.zoom));
    return Object.freeze({
        x: round((point.x - canvasOffset.x - viewport.x) / zoom),
        y: round((point.y - canvasOffset.y - viewport.y) / zoom),
    });
}

export function designSceneRectToScreen(rect: DesignFabricRect, viewport: DesignViewport, canvasOffset: DesignFabricPoint = { x: 0, y: 0 }): DesignFabricRect {
    const topLeft = designSceneToScreen({ x: rect.x, y: rect.y }, viewport, canvasOffset);
    return Object.freeze({ x: topLeft.x, y: topLeft.y, width: round(rect.width * viewport.zoom), height: round(rect.height * viewport.zoom) });
}

function createDesignFabricSelectionSnapshot(canvas: Canvas, meta: WeakMap<FabricObject, DesignFabricObjectMeta>, viewport: DesignViewport, canvasOffset: DesignFabricPoint, revision: number): DesignFabricSelectionSnapshot {
    const activeObjects = canvas.getActiveObjects();
    if (!activeObjects.length) return Object.freeze({ ...EMPTY_SELECTION_SNAPSHOT, revision });
    const entries = activeObjects.flatMap((object) => {
        const objectMeta = meta.get(object);
        return objectMeta ? [{ object, meta: objectMeta }] : [];
    });
    if (!entries.length) return Object.freeze({ ...EMPTY_SELECTION_SNAPSHOT, revision });
    const sceneBounds = unionDesignFabricRects(entries.map(({ object }) => freezeDesignFabricRect(object.getBoundingRect())));
    const elementEntries = entries.filter((entry): entry is { object: FabricObject; meta: Extract<DesignFabricObjectMeta, { kind: "element" }> } => entry.meta.kind === "element");
    const frameEntries = entries.filter((entry): entry is { object: FabricObject; meta: Extract<DesignFabricObjectMeta, { kind: "frame" }> } => entry.meta.kind === "frame");
    const kind = elementEntries.length === entries.length ? "elements" : frameEntries.length === 1 && entries.length === 1 ? "frame" : null;
    const ids = Object.freeze((kind === "elements" ? elementEntries : kind === "frame" ? frameEntries : []).map((entry) => entry.meta.id));
    if (!kind || !sceneBounds) return Object.freeze({ revision, kind: null, ids: Object.freeze([]), sceneBounds: null, screenBounds: null });
    return Object.freeze({ revision, kind, ids, sceneBounds, screenBounds: designSceneRectToScreen(sceneBounds, viewport, canvasOffset) });
}

function freezeDesignFabricRect(rect: { left?: number; top?: number; x?: number; y?: number; width: number; height: number }): DesignFabricRect {
    return Object.freeze({ x: round(rect.left ?? rect.x ?? 0), y: round(rect.top ?? rect.y ?? 0), width: round(Math.max(0, rect.width)), height: round(Math.max(0, rect.height)) });
}

function unionDesignFabricRects(rects: readonly DesignFabricRect[]): DesignFabricRect | null {
    if (!rects.length) return null;
    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const rect of rects) {
        left = Math.min(left, rect.x);
        top = Math.min(top, rect.y);
        right = Math.max(right, rect.x + rect.width);
        bottom = Math.max(bottom, rect.y + rect.height);
    }
    return Object.freeze({ x: round(left), y: round(top), width: round(Math.max(0, right - left)), height: round(Math.max(0, bottom - top)) });
}

function sameDesignFabricSelectionSnapshot(left: DesignFabricSelectionSnapshot, right: DesignFabricSelectionSnapshot) {
    return left.kind === right.kind && sameStringArray(left.ids, right.ids) && sameNullableDesignFabricRect(left.sceneBounds, right.sceneBounds) && sameNullableDesignFabricRect(left.screenBounds, right.screenBounds);
}

function sameDesignFabricViewportSnapshot(left: DesignFabricViewportSnapshot, right: DesignFabricViewportSnapshot) {
    return left.viewport.x === right.viewport.x && left.viewport.y === right.viewport.y && left.viewport.zoom === right.viewport.zoom && sameDesignFabricRect(left.surface, right.surface);
}

function sameNullableDesignFabricRect(left: DesignFabricRect | null, right: DesignFabricRect | null) {
    return left === right || Boolean(left && right && sameDesignFabricRect(left, right));
}

function sameDesignFabricRect(left: DesignFabricRect, right: DesignFabricRect) {
    return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

function sameStringArray(left: readonly string[], right: readonly string[]) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function freezeViewportSnapshot(revision: number, viewport: DesignViewport, surface: DesignFabricRect): DesignFabricViewportSnapshot {
    return Object.freeze({ revision, viewport: Object.freeze({ x: round(viewport.x), y: round(viewport.y), zoom: round(viewport.zoom) }), surface: freezeDesignFabricRect(surface) });
}

function freezeResizeSnapshot(revision: number, surface: DesignFabricRect): DesignFabricResizeSnapshot {
    return Object.freeze({ revision, surface: freezeDesignFabricRect(surface) });
}

function subscribeDesignFabricObserver<T>(observers: Set<DesignFabricObserver<T>>, listener: DesignFabricObserver<T>, snapshot: T, emitCurrent: boolean): DesignFabricUnsubscribe {
    observers.add(listener);
    if (emitCurrent) listener(snapshot);
    return () => observers.delete(listener);
}

function notifyDesignFabricObservers<T>(observers: Set<DesignFabricObserver<T>>, snapshot: T) {
    for (const observer of [...observers]) observer(snapshot);
}

const EMPTY_SELECTION_SNAPSHOT: DesignFabricSelectionSnapshot = Object.freeze({ revision: 0, kind: null, ids: Object.freeze([]), sceneBounds: null, screenBounds: null });

export function closestSnap(points: number[], candidates: number[], threshold: number) {
    const result = closestSnapWithPoint(points, candidates, threshold);
    return result ? { delta: result.delta, position: result.position } : null;
}

export function resolveAxisSnap(points: number[], candidates: number[], threshold: number, releaseThreshold: number, lock: DesignSnapAxisLock | null) {
    if (lock && lock.pointIndex < points.length) {
        const delta = lock.position - points[lock.pointIndex];
        if (Math.abs(delta) <= releaseThreshold) return { delta: round(delta), position: lock.position, lock };
    }
    const closest = closestSnapWithPoint(points, candidates, threshold);
    return closest ? { delta: closest.delta, position: closest.position, lock: { pointIndex: closest.pointIndex, position: closest.position } } : null;
}

function closestSnapWithPoint(points: number[], candidates: number[], threshold: number) {
    let closest: { delta: number; position: number; pointIndex: number } | null = null;
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
        const point = points[pointIndex];
        for (const position of candidates) {
            const delta = position - point;
            if (Math.abs(delta) <= threshold && (!closest || Math.abs(delta) < Math.abs(closest.delta))) closest = { delta: round(delta), position: round(position), pointIndex };
        }
    }
    return closest;
}

export function buildDesignSnapIndex(document: DesignDocument): DesignSnapIndex {
    const index: DesignSnapIndex = new Map();
    const frames = new Map(document.frames.map((frame) => [frame.id, frame]));
    for (const element of document.elements) {
        if (element.hidden) continue;
        const frame = element.frameId ? frames.get(element.frameId) : null;
        const key = designScopeKey(element.frameId);
        const scope = index.get(key) ?? {
            frame: {
                vertical: frame ? [frame.x, frame.x + frame.width / 2, frame.x + frame.width] : [],
                horizontal: frame ? [frame.y, frame.y + frame.height / 2, frame.y + frame.height] : [],
            },
            elements: [],
        };
        const offsetX = frame?.x ?? 0;
        const offsetY = frame?.y ?? 0;
        const bounds = rotatedSceneBounds(element, offsetX, offsetY);
        scope.elements.push({
            id: element.id,
            vertical: [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width],
            horizontal: [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height],
        });
        index.set(key, scope);
    }
    return index;
}

export function designSnapCandidates(index: DesignSnapIndex, frameId: string | null, selectedIds: Set<string>) {
    const scope = index.get(designScopeKey(frameId));
    if (!scope) return { vertical: [], horizontal: [] };
    const vertical = [...scope.frame.vertical];
    const horizontal = [...scope.frame.horizontal];
    for (const element of scope.elements) {
        if (selectedIds.has(element.id)) continue;
        vertical.push(...element.vertical);
        horizontal.push(...element.horizontal);
    }
    return { vertical, horizontal };
}

function designScopeKey(frameId: string | null) {
    return frameId ? `frame:${frameId}` : "workspace";
}

function rotatedSceneBounds(element: DesignElement, offsetX: number, offsetY: number) {
    const { x, y, width, height, rotation } = element.transform;
    const angle = (rotation * Math.PI) / 180;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const points = [
        { x: x + offsetX, y: y + offsetY },
        { x: x + offsetX + width * cosine, y: y + offsetY + width * sine },
        { x: x + offsetX - height * sine, y: y + offsetY + height * cosine },
        { x: x + offsetX + width * cosine - height * sine, y: y + offsetY + width * sine + height * cosine },
    ];
    const left = Math.min(...points.map((point) => point.x));
    const top = Math.min(...points.map((point) => point.y));
    const right = Math.max(...points.map((point) => point.x));
    const bottom = Math.max(...points.map((point) => point.y));
    return { x: left, y: top, width: right - left, height: bottom - top };
}

function documentBounds(document: DesignDocument) {
    const rectangles = [
        ...document.frames.map((frame) => ({ x: frame.x, y: frame.y, width: frame.width, height: frame.height })),
        ...document.elements.map((element) => {
            const frame = element.frameId ? document.frames.find((candidate) => candidate.id === element.frameId) : null;
            return { x: (frame?.x ?? 0) + element.transform.x, y: (frame?.y ?? 0) + element.transform.y, width: element.transform.width, height: element.transform.height };
        }),
    ];
    if (!rectangles.length) return { x: -400, y: -300, width: 800, height: 600 };
    const minX = Math.min(...rectangles.map((item) => item.x));
    const minY = Math.min(...rectangles.map((item) => item.y));
    const maxX = Math.max(...rectangles.map((item) => item.x + item.width));
    const maxY = Math.max(...rectangles.map((item) => item.y + item.height));
    return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function coordinate(value: number) {
    return round(clamp(value, -DESIGN_LIMITS.maxCoordinate, DESIGN_LIMITS.maxCoordinate));
}

function nonZero(value: number) {
    return Math.abs(value) < 0.000_001 ? 1 : value;
}

function clamp(value: number, minimum: number, maximum: number) {
    return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number) {
    return Math.round(value * 1000) / 1000;
}
