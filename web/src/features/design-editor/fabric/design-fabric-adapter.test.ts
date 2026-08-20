import { ActiveSelection, Circle, FabricImage, Group, Textbox, type Canvas, type FabricObject, type ImageSource } from "fabric";
import { describe, expect, it, vi } from "vitest";

import { applyDesignOperationBatch, createDesignFrameExportPlan } from "@/lib/design";
import { createDesignDocumentFixture } from "@/lib/design/design.test-fixture";

import { createDesignEditorStore } from "../store/design-editor-store";
import {
    buildDesignSnapIndex,
    closestSnap,
    createDesignFabricTransformIntent,
    DesignFabricAdapter,
    designSceneRectToScreen,
    designSceneToScreen,
    designScreenToScene,
    designSnapCandidates,
    resolveAxisSnap,
    type DesignFabricSelectionSnapshot,
} from "./design-fabric-adapter";

describe("Phase 6 Fabric transform intent", () => {
    it("converts a Frame gesture to integer persisted dimensions", () => {
        const intent = createDesignFabricTransformIntent(
            { kind: "frame", id: "frame-one", frameId: null, projectionKey: "frame", base: { x: 100, y: 200, width: 1200, height: 800 }, baseScaleX: 1, baseScaleY: 1 },
            { left: 125.1254, top: 240.4444, angle: 0, scaleX: 1.25, scaleY: 0.5 },
            null,
        );
        expect(intent).toEqual({ kind: "frame", id: "frame-one", patch: { x: 125.125, y: 240.444, width: 1500, height: 400 } });
    });

    it("uses relative Fabric scale and converts Frame children back to local coordinates", () => {
        const intent = createDesignFabricTransformIntent(
            {
                kind: "element",
                id: "element-text",
                frameId: "frame-one",
                projectionKey: "text",
                base: { x: 80, y: 90, width: 480, height: 120, rotation: 10, flipX: false, flipY: true },
                baseScaleX: 1,
                baseScaleY: 0.4,
            },
            { left: 250, top: 470, angle: 33.3333, scaleX: 1.5, scaleY: 0.8 },
            { id: "frame-one", name: "Frame", x: 100, y: 200, width: 1200, height: 1200, background: "#ffffff", locked: false, export: { format: "png", scale: 1, quality: 1, background: "frame" } },
        );
        expect(intent).toEqual({
            kind: "element",
            id: "element-text",
            transform: { x: 150, y: 270, width: 720, height: 240, rotation: 33.333, flipX: false, flipY: true },
        });
    });
});

describe("Phase 7 Fabric snapping", () => {
    it("selects the closest candidate within the scene threshold", () => {
        expect(closestSnap([95, 145, 195], [100, 202], 8)).toEqual({ delta: 5, position: 100 });
        expect(closestSnap([95, 145, 195], [210], 8)).toBeNull();
    });

    it("indexes visible element bounds once per workspace or Frame scope", () => {
        const document = createDesignDocumentFixture();
        const workspaceElement = document.elements.find((element) => element.id === "element-workspace-guide")!;
        const frameElement = document.elements.find((element) => element.id === "element-title")!;
        const hiddenElement = document.elements.find((element) => element.id === "element-hidden-badge")!;
        const index = buildDesignSnapIndex({
            ...document,
            frames: document.frames.filter((frame) => frame.id === "frame-main"),
            elements: [workspaceElement, { ...frameElement, transform: { ...frameElement.transform, x: 40, y: 60, width: 100, height: 40, rotation: 0 } }, hiddenElement],
        });

        expect([...index.keys()]).toEqual(["workspace", "frame:frame-main"]);
        expect(index.get("workspace")?.elements).toEqual([{ id: workspaceElement.id, vertical: [12, 62, 112], horizontal: [20, 70, 120] }]);
        expect(index.get("frame:frame-main")?.elements).toEqual([{ id: frameElement.id, vertical: [140, 190, 240], horizontal: [260, 280, 300] }]);
    });

    it("excludes every selected element while retaining its Frame edges and center", () => {
        const document = createDesignDocumentFixture();
        const index = buildDesignSnapIndex(document);
        const candidates = designSnapCandidates(index, "frame-main", new Set(["element-product", "element-title", "element-line", "element-arrow"]));

        expect(candidates).toEqual({ vertical: [100, 1100, 2100], horizontal: [200, 1200, 2200] });
        expect(designSnapCandidates(index, "frame-social", new Set(["element-social-product"]))).toEqual({ vertical: [2400, 2940, 3480], horizontal: [200, 875, 1550] });
        expect(designSnapCandidates(index, null, new Set(["element-workspace-guide"]))).toEqual({ vertical: [], horizontal: [] });
    });

    it("uses an 8px engage threshold and keeps the same point locked until 12px", () => {
        const engaged = resolveAxisSnap([94, 144, 194], [100, 300], 8, 12, null);
        expect(engaged).toEqual({ delta: 6, position: 100, lock: { pointIndex: 0, position: 100 } });

        expect(resolveAxisSnap([89, 139, 189], [100, 300], 8, 12, engaged?.lock ?? null)).toEqual({ delta: 11, position: 100, lock: { pointIndex: 0, position: 100 } });
        expect(resolveAxisSnap([87, 137, 187], [100, 300], 8, 12, engaged?.lock ?? null)).toBeNull();
    });
});

describe("Phase 8 Fabric read-only observations", () => {
    it("round-trips scene and screen coordinates with the canvas DOM offset", () => {
        const viewport = { x: -125.25, y: 80.5, zoom: 1.75 };
        const offset = { x: 32, y: 48 };
        const scene = { x: 123.456, y: -45.25 };

        const screen = designSceneToScreen(scene, viewport, offset);

        expect(screen).toEqual({ x: 122.798, y: 49.313 });
        expect(designScreenToScene(screen, viewport, offset)).toEqual(scene);
    });

    it("converts a scene rectangle into screen coordinates and dimensions", () => {
        expect(designSceneRectToScreen({ x: 10, y: 20, width: 30, height: 40 }, { x: -5, y: 7, zoom: 2.5 }, { x: 100, y: 200 })).toEqual({
            x: 120,
            y: 257,
            width: 75,
            height: 100,
        });
    });

    it("publishes immediate, deduplicated viewport and resize snapshots with revisions", () => {
        const canvas = new FakeDesignCanvas({ width: 800, height: 600, left: 20, top: 30 });
        const adapter = createAdapter(canvas);
        const viewportSnapshots: ReturnType<DesignFabricAdapter["getViewportSnapshot"]>[] = [];
        const resizeSnapshots: ReturnType<DesignFabricAdapter["getResizeSnapshot"]>[] = [];
        const unsubscribeViewport = adapter.subscribeViewport((snapshot) => viewportSnapshots.push(snapshot));
        const unsubscribeResize = adapter.subscribeResize((snapshot) => resizeSnapshots.push(snapshot));

        expect(viewportSnapshots).toHaveLength(1);
        expect(resizeSnapshots).toHaveLength(1);
        adapter.previewViewport({ x: 12, y: -8, zoom: 1.5 });
        adapter.previewViewport({ x: 12, y: -8, zoom: 1.5 });
        adapter.resize(1000.9, 700.2);
        adapter.resize(1000.9, 700.2);

        expect(viewportSnapshots.map((snapshot) => snapshot.revision)).toEqual([0, 1, 2]);
        expect(viewportSnapshots.at(-1)).toMatchObject({ viewport: { x: 12, y: -8, zoom: 1.5 }, surface: { x: 0, y: 0, width: 1000, height: 700 } });
        expect(resizeSnapshots.map((snapshot) => snapshot.revision)).toEqual([0, 1]);
        expect(canvas.requestRenderAll).toHaveBeenCalledTimes(4);

        unsubscribeViewport();
        unsubscribeResize();
        adapter.previewViewport({ x: 13, y: -8, zoom: 1.5 });
        adapter.resize(1100, 700);
        expect(viewportSnapshots).toHaveLength(3);
        expect(resizeSnapshots).toHaveLength(2);
    });

    it("deep-freezes every public observation snapshot", () => {
        const canvas = new FakeDesignCanvas({ width: 800, height: 600 });
        const adapter = createAdapter(canvas);
        const viewport = adapter.getViewportSnapshot();
        const resize = adapter.getResizeSnapshot();
        const selection = adapter.getSelectionSnapshot();

        expect(Object.isFrozen(viewport)).toBe(true);
        expect(Object.isFrozen(viewport.viewport)).toBe(true);
        expect(Object.isFrozen(viewport.surface)).toBe(true);
        expect(Object.isFrozen(resize)).toBe(true);
        expect(Object.isFrozen(resize.surface)).toBe(true);
        expect(Object.isFrozen(selection)).toBe(true);
        expect(Object.isFrozen(selection.ids)).toBe(true);
    });

    it("reports selected Frame scene and screen bounds", () => {
        const canvas = new FakeDesignCanvas({ width: 800, height: 600, left: 25, top: 40 });
        const adapter = createAdapter(canvas);
        const document = createDesignDocumentFixture();
        document.elements = [];
        document.layers = document.layers.map((layer) => ({ ...layer, elementIds: [] }));

        adapter.project(document, { kind: "frame", id: "frame-main" });

        expect(adapter.getSelectionSnapshot()).toMatchObject({
            kind: "frame",
            ids: ["frame-main"],
            sceneBounds: { x: 100, y: 200, width: 2001, height: 2001 },
            screenBounds: { x: 60, y: 70, width: 500.25, height: 500.25 },
        });
        expect(adapter.getSelectionBounds()).toEqual({ x: 100, y: 200, width: 2001, height: 2001 });
    });

    it("reports selected element bounds and recomputes screen bounds after viewport and surface resize", () => {
        const canvas = new FakeDesignCanvas({ width: 800, height: 600, left: 10, top: 20 });
        const adapter = createAdapter(canvas);
        const document = createDesignDocumentFixture();
        document.frames = [];
        document.elements = [
            {
                id: "shape-one",
                frameId: null,
                name: "Shape",
                transform: { x: 40, y: 60, width: 100, height: 80, rotation: 0, flipX: false, flipY: false },
                opacity: 1,
                blendMode: "normal",
                locked: false,
                hidden: false,
                kind: "shape",
                shape: "rectangle",
                fill: "#ffffff",
                stroke: null,
                strokeWidth: 0,
                cornerRadius: 0,
            },
        ];
        document.layers = [{ scope: "workspace", elementIds: ["shape-one"] }];
        const snapshots: DesignFabricSelectionSnapshot[] = [];
        adapter.subscribeSelection((snapshot) => snapshots.push(snapshot), false);

        adapter.project(document, { kind: "elements", ids: ["shape-one"] });
        expect(adapter.getSelectionSnapshot()).toMatchObject({ kind: "elements", ids: ["shape-one"], sceneBounds: { x: 40, y: 60, width: 100, height: 80 }, screenBounds: { x: 30, y: 15, width: 25, height: 20 } });

        adapter.previewViewport({ x: 5, y: 7, zoom: 2 });
        canvas.setOffset(30, 45);
        adapter.resize(900, 650);

        expect(adapter.getSelectionSnapshot().screenBounds).toEqual({ x: 115, y: 172, width: 200, height: 160 });
        expect(snapshots.map((snapshot) => snapshot.revision)).toEqual([1, 2, 3]);
    });

    it("publishes a selected element snapshot while object:moving is still in progress", () => {
        const canvas = new FakeDesignCanvas({ width: 800, height: 600 });
        const adapter = createAdapter(canvas);
        const document = oneShapeDocument();
        const snapshots: DesignFabricSelectionSnapshot[] = [];
        adapter.project(document, { kind: "elements", ids: ["shape-one"] });
        adapter.subscribeSelection((snapshot) => snapshots.push(snapshot), false);
        const target = canvas.getActiveObjects()[0];

        target.set({ left: 65, top: 75 });
        target.setCoords();
        canvas.emit("object:moving", { target });

        expect(snapshots).toHaveLength(1);
        expect(snapshots[0]).toMatchObject({ kind: "elements", ids: ["shape-one"], sceneBounds: { x: 65, y: 75, width: 100, height: 80 } });
    });

    it("publishes the final multi-selection snapshot after object:modified", () => {
        const canvas = new FakeDesignCanvas({ width: 800, height: 600 });
        const adapter = createAdapter(canvas);
        const document = twoShapeDocument();
        const snapshots: DesignFabricSelectionSnapshot[] = [];
        adapter.project(document, { kind: "elements", ids: ["shape-one", "shape-two"] });
        adapter.subscribeSelection((snapshot) => snapshots.push(snapshot), false);
        const selection = canvas.getActiveObject();
        expect(selection).toBeInstanceOf(ActiveSelection);
        selection!.set({ left: selection!.left + 20 });
        selection!.setCoords();

        canvas.emit("object:modified", { target: selection! });

        expect(snapshots).toHaveLength(1);
        expect(snapshots[0].kind).toBe("elements");
        expect(snapshots[0].ids).toEqual(["shape-one", "shape-two"]);
    });

    it("derives bounds linearly from 200 selected objects without scanning other canvas objects", () => {
        const canvas = new FakeDesignCanvas({ width: 800, height: 600 });
        const adapter = createAdapter(canvas);
        const document = createDesignDocumentFixture();
        document.frames = [];
        document.elements = Array.from({ length: 400 }, (_, index) => ({
            id: `shape-${index}`,
            frameId: null,
            name: `Shape ${index}`,
            transform: { x: index * 10, y: index, width: 5, height: 5, rotation: 0, flipX: false, flipY: false },
            opacity: 1,
            blendMode: "normal" as const,
            locked: false,
            hidden: false,
            kind: "shape" as const,
            shape: "rectangle" as const,
            fill: "#ffffff",
            stroke: null,
            strokeWidth: 0,
            cornerRadius: 0,
        }));
        document.layers = [{ scope: "workspace", elementIds: document.elements.map((element) => element.id) }];
        const selectedIds = document.elements.slice(0, 200).map((element) => element.id);

        adapter.project(document, { kind: "elements", ids: selectedIds });
        const selected = canvas.getActiveObjects();
        const boundsCalls = selected.map((object) => vi.spyOn(object, "getBoundingRect"));
        canvas.getObjects.mockClear();

        adapter.previewViewport({ x: 1, y: 2, zoom: 1.25 });

        expect(canvas.getObjects).not.toHaveBeenCalled();
        expect(selected).toHaveLength(200);
        expect(boundsCalls.reduce((total, spy) => total + spy.mock.calls.length, 0)).toBe(200);
        expect(adapter.getSelectionSnapshot().ids).toHaveLength(200);
    });
});

describe("Phase 9 Fabric stable-id projection", () => {
    it("rejects cross-frame selections at the adapter boundary", () => {
        const restoreFabricTextEnvironment = installFabricTextEnvironment();
        try {
            const canvas = new FakeDesignCanvas({ width: 1200, height: 800 });
            const onSelectionChange = vi.fn();
            const adapter = new DesignFabricAdapter(canvas as unknown as Canvas, {
                onViewportCommit: vi.fn(),
                onSelectionChange,
                onTransformCommit: vi.fn(),
            });
            const document = createDesignDocumentFixture();

            adapter.project(document, { kind: "elements", ids: ["element-product", "element-line"] });
            onSelectionChange.mockClear();
            adapter.setSelection({ kind: "elements", ids: ["element-product", "element-social-product"] });

            expect(canvas.getActiveObject()).toBeNull();
            expect(adapter.getSelectionSnapshot()).toMatchObject({ kind: null, ids: [] });
            expect(onSelectionChange).toHaveBeenCalledWith(null);
        } finally {
            restoreFabricTextEnvironment();
        }
    });

    it("updates text, image, line and arrow renderers in place while preserving object identity", () => {
        const restoreFabricTextEnvironment = installFabricTextEnvironment();
        try {
            const canvas = new FakeDesignCanvas({ width: 1200, height: 800 });
            const adapter = createAdapter(canvas);
            const document = richElementDocument();
            adapter.project(document, { kind: "elements", ids: ["text-one"] });

            const before = new Map(canvas.getObjects().map((object, index) => [document.elements[index].id, object]));
            const next = structuredClone(document);
            next.revision += 1;
            const text = next.elements.find((element) => element.id === "text-one");
            if (text?.kind === "text") Object.assign(text, { text: "更新后的标题", fontSize: 34, fontWeight: 400, fill: "#dc2626", lineHeight: 1.5, letterSpacing: 2 });
            const image = next.elements.find((element) => element.id === "image-one");
            if (image?.kind === "image") Object.assign(image.transform, { width: 320, height: 180 });
            if (image?.kind === "image") image.cornerRadius = 18;
            const line = next.elements.find((element) => element.id === "line-one");
            if (line?.kind === "line") Object.assign(line.transform, { width: 500, height: 30 });
            if (line?.kind === "line") Object.assign(line, { stroke: "#2563eb", strokeWidth: 7, dash: [9, 3], cap: "square" });
            const arrow = next.elements.find((element) => element.id === "arrow-one");
            if (arrow?.kind === "arrow") Object.assign(arrow.transform, { width: 420, height: 240 });
            if (arrow?.kind === "arrow") Object.assign(arrow, { stroke: "#16a34a", strokeWidth: 9, dash: [4, 2] });
            adapter.project(next, { kind: "elements", ids: ["text-one"] });

            const textObject = canvas.getObjects()[0];
            const imageObject = canvas.getObjects()[1];
            const lineObject = canvas.getObjects()[2];
            const arrowObject = canvas.getObjects()[3];
            expect(textObject).toBe(before.get("text-one"));
            expect(imageObject).toBe(before.get("image-one"));
            expect(lineObject).toBe(before.get("line-one"));
            expect(arrowObject).toBe(before.get("arrow-one"));
            expect(textObject).toMatchObject({ text: "更新后的标题", width: 260, fontSize: 34, fontWeight: 400, fill: "#dc2626", lineHeight: 1.5, charSpacing: expect.closeTo((2 / 34) * 1000, 5) });
            expect(textObject.scaleY * (textObject as Textbox).height).toBeCloseTo(120, 5);
            expect(imageObject).toBeInstanceOf(Group);
            expect((imageObject as Group).getObjects()).toHaveLength(4);
            expect((imageObject as Group).getObjects()[0]).toMatchObject({ width: 320, height: 180, rx: 18, ry: 18 });
            expect((imageObject as Group).getObjects()[1]).toMatchObject({ x1: 0, y1: 0, x2: 320, y2: 180 });
            expect((imageObject as Group).getObjects()[2]).toMatchObject({ x1: 320, y1: 0, x2: 0, y2: 180 });
            expect((imageObject as Group).getObjects()[3]).toMatchObject({ width: 320, fontSize: 18 });
            expect(lineObject).toMatchObject({ x1: 0, y1: 0, x2: 500, y2: 30, stroke: "#2563eb", strokeWidth: 7, strokeDashArray: [9, 3], strokeLineCap: "square" });
            expect(arrowObject).toBeInstanceOf(Group);
            expect((arrowObject as Group).getObjects()[0]).toMatchObject({ x1: 0, y1: 0, x2: 420, y2: 240, stroke: "#16a34a", strokeWidth: 9, strokeDashArray: [4, 2] });
            expect((arrowObject as Group).getObjects()[1]).toMatchObject({ width: 36, height: 36, fill: "#16a34a" });
            expect(adapter.getDiagnostics().counters).toMatchObject({ created: 4, replaced: 0, removed: 0, updated: 4 });
        } finally {
            restoreFabricTextEnvironment();
        }
    });

    it("replaces an image placeholder with a resolved Fabric image and preserves selection", async () => {
        const restoreFabricTextEnvironment = installFabricTextEnvironment();
        try {
            const canvas = new FakeDesignCanvas({ width: 1200, height: 800 });
            const resolveResource = vi.fn().mockResolvedValue({ url: "/api/reference-assets/image.png", cacheKey: "asset:image", expiresAt: null });
            const loadImageSource = vi.fn().mockResolvedValue(imageSource(3000, 3000));
            const adapter = createAdapter(canvas, { resolveResource, loadImageSource });
            const document = singleImageDocument("asset-product-v2");

            adapter.project(document, { kind: "elements", ids: ["element-product"] });
            expect(canvas.getActiveObject()).toBeInstanceOf(Group);
            await vi.waitFor(() => expect((canvas.getObjects().find((object) => object instanceof Group) as Group).getObjects()[1]).toBeInstanceOf(FabricImage));

            const imageGroup = canvas.getObjects().find((object) => object instanceof Group) as Group;
            const image = imageGroup.getObjects()[1] as FabricImage;
            expect(resolveResource).toHaveBeenCalledWith(document.assetVersions.find((version) => version.id === "asset-product-v2")!.locator, { purpose: "editor" });
            expect(loadImageSource).toHaveBeenCalledWith("/api/reference-assets/image.png");
            expect(image).toMatchObject({ cropX: 375, cropY: 300, width: 2250, height: 2400 });
            expect(canvas.getActiveObjects()).toEqual([imageGroup]);
            expect(adapter.getDiagnostics().objects[1]).toMatchObject({ id: "element-product", projectionKey: "image:asset-product-v2" });
        } finally {
            restoreFabricTextEnvironment();
        }
    });

    it("exports a Frame at source coordinates and restores editor presentation", async () => {
        const restoreFabricTextEnvironment = installFabricTextEnvironment();
        try {
            const canvas = new FakeDesignCanvas({ width: 1200, height: 800 });
            const document = singleShapeFrameDocument();
            const adapter = createAdapter(canvas);
            adapter.project(document, { kind: "frame", id: "frame-main" });
            const frameObject = canvas.getObjects()[0];
            const initialPresentation = { fill: frameObject.fill, stroke: frameObject.stroke, strokeWidth: frameObject.strokeWidth, shadow: frameObject.shadow };
            const initialViewport = [...canvas.viewportTransform];

            const result = await adapter.exportFrame(createDesignFrameExportPlan(document, "frame-main", { format: "webp", scale: 2, background: "transparent", quality: 0.8 }));

            expect(canvas.toCanvasElement).toHaveBeenCalledWith(2, expect.objectContaining({ left: 100, top: 200, width: 2000, height: 2000, filter: expect.any(Function) }));
            const exportOptions = canvas.toCanvasElement.mock.calls[0][1]!;
            expect(canvas.getObjects().filter((object) => exportOptions.filter?.(object))).toEqual(canvas.getObjects());
            expect(result).toMatchObject({ frameId: "frame-main", fileName: "Amazon 主图.webp", mimeType: "image/webp", width: 4000, height: 4000 });
            expect(result.blob).toBeInstanceOf(Blob);
            expect(canvas.viewportTransform).toEqual(initialViewport);
            expect(frameObject).toMatchObject(initialPresentation);
        } finally {
            restoreFabricTextEnvironment();
        }
    });

    it("uses white for JPEG Frame background when the Frame has no fill", async () => {
        const canvas = new FakeDesignCanvas({ width: 1200, height: 800 });
        const document = singleShapeFrameDocument();
        document.frames[0].background = null;
        const adapter = createAdapter(canvas);
        adapter.project(document, null);
        const initialFill = canvas.getObjects()[0].fill;
        let exportedBackground: unknown;
        let exportedFrameFill: unknown;
        canvas.toCanvasElement.mockImplementation(() => {
            exportedBackground = canvas.backgroundColor;
            exportedFrameFill = canvas.getObjects()[0].fill;
            return { toBlob: (callback: BlobCallback, mimeType?: string) => callback(new Blob(["frame"], { type: mimeType || "image/png" })) } as unknown as HTMLCanvasElement;
        });

        await adapter.exportFrame(createDesignFrameExportPlan(document, "frame-main", { format: "jpeg", scale: 1, background: "frame", quality: 0.8 }));

        expect(exportedBackground).toBe("#ffffff");
        expect(exportedFrameFill).toBe("rgba(0,0,0,0)");
        expect(canvas.getObjects()[0].fill).toBe(initialFill);
    });

    it("waits for required images and rejects an export when a resource cannot load", async () => {
        const restoreFabricTextEnvironment = installFabricTextEnvironment();
        try {
            const canvas = new FakeDesignCanvas({ width: 1200, height: 800 });
            const resource = deferred<{ url: string; cacheKey: string; expiresAt: null }>();
            const resolveResource = vi.fn().mockReturnValue(resource.promise);
            const adapter = createAdapter(canvas, { resolveResource, loadImageSource: vi.fn().mockResolvedValue(imageSource(3000, 3000)) });
            const document = singleImageDocument("asset-product-v2");
            adapter.project(document, null);

            const exporting = adapter.exportFrame(createDesignFrameExportPlan(document, "frame-main", { scale: 1 }));
            await Promise.resolve();
            expect(canvas.toCanvasElement).not.toHaveBeenCalled();
            resource.resolve({ url: "/ready.png", cacheKey: "ready", expiresAt: null });
            await expect(exporting).resolves.toMatchObject({ frameId: "frame-main", mimeType: "image/png" });
            expect(canvas.toCanvasElement).toHaveBeenCalledTimes(1);

            const failedCanvas = new FakeDesignCanvas({ width: 1200, height: 800 });
            const failedAdapter = createAdapter(failedCanvas, { resolveResource: vi.fn().mockRejectedValue(new Error("无权读取资源")) });
            failedAdapter.project(document, null);
            await expect(failedAdapter.exportFrame(createDesignFrameExportPlan(document, "frame-main", { scale: 1 }))).rejects.toThrow("无法准备图片“主商品图”：无权读取资源");
            expect(failedCanvas.toCanvasElement).not.toHaveBeenCalled();
        } finally {
            restoreFabricTextEnvironment();
        }
    });

    it("rejects a stale export plan after the projected revision changes", async () => {
        const canvas = new FakeDesignCanvas({ width: 1200, height: 800 });
        const document = singleShapeFrameDocument();
        const adapter = createAdapter(canvas);
        adapter.project(document, null);
        const stalePlan = createDesignFrameExportPlan(document, "frame-main", { scale: 1 });
        adapter.project({ ...document, revision: document.revision + 1 }, null);

        await expect(adapter.exportFrame(stalePlan)).rejects.toThrow("画板已发生变化");
        expect(canvas.toCanvasElement).not.toHaveBeenCalled();
    });

    it("preserves a collision-safe batch filename after revalidating the current document", async () => {
        const canvas = new FakeDesignCanvas({ width: 1200, height: 800 });
        const document = singleShapeFrameDocument();
        const adapter = createAdapter(canvas);
        adapter.project(document, null);
        const plan = { ...createDesignFrameExportPlan(document, "frame-main", { scale: 1 }), fileName: "Amazon 主图-2.png" };

        await expect(adapter.exportFrame(plan)).resolves.toMatchObject({ fileName: "Amazon 主图-2.png" });
    });

    it("ignores an old image response after the projected asset version changes", async () => {
        const restoreFabricTextEnvironment = installFabricTextEnvironment();
        try {
            const canvas = new FakeDesignCanvas({ width: 1200, height: 800 });
            const oldResolution = deferred<{ url: string; cacheKey: string; expiresAt: null }>();
            const resolveResource = vi.fn().mockImplementation((locator: { kind: string; libraryAssetId?: string }) => (locator.kind === "library-asset" ? oldResolution.promise : Promise.resolve({ url: "/new.png", cacheKey: "new", expiresAt: null })));
            const loadImageSource = vi.fn().mockImplementation(async (url: string) => imageSource(url === "/new.png" ? 3000 : 10, url === "/new.png" ? 3000 : 10));
            const adapter = createAdapter(canvas, { resolveResource, loadImageSource });
            const oldDocument = singleImageDocument("asset-product-v2");
            adapter.project(oldDocument, null);
            const next = structuredClone(oldDocument);
            next.revision += 1;
            const element = next.elements.find((candidate) => candidate.id === "element-product");
            if (element?.kind === "image") element.assetVersionId = "asset-product-v1";
            adapter.project(next, null);
            await vi.waitFor(() => expect(adapter.getDiagnostics().objects[1]?.projectionKey).toBe("image:asset-product-v1"));
            oldResolution.resolve({ url: "/old.png", cacheKey: "old", expiresAt: null });
            await Promise.resolve();
            await Promise.resolve();

            expect(loadImageSource).not.toHaveBeenCalledWith("/old.png");
            expect(adapter.getDiagnostics().objects[1]).toMatchObject({ id: "element-product", projectionKey: "image:asset-product-v1" });
        } finally {
            restoreFabricTextEnvironment();
        }
    });

    it("does not install a late image after deletion or adapter destruction", async () => {
        const restoreFabricTextEnvironment = installFabricTextEnvironment();
        try {
            const canvas = new FakeDesignCanvas({ width: 1200, height: 800 });
            const resolution = deferred<{ url: string; cacheKey: string; expiresAt: null }>();
            const loadImageSource = vi.fn().mockResolvedValue(imageSource(3000, 3000));
            const adapter = createAdapter(canvas, { resolveResource: vi.fn().mockReturnValue(resolution.promise), loadImageSource });
            const document = singleImageDocument("asset-product-v2");
            adapter.project(document, null);
            const withoutImage = structuredClone(document);
            withoutImage.revision += 1;
            withoutImage.elements = withoutImage.elements.filter((element) => element.id !== "element-product");
            withoutImage.layers = withoutImage.layers.map((layer) => ({ ...layer, elementIds: layer.elementIds.filter((id) => id !== "element-product") }));
            adapter.project(withoutImage, null);
            resolution.resolve({ url: "/late.png", cacheKey: "late", expiresAt: null });
            await Promise.resolve();
            await Promise.resolve();
            expect(loadImageSource).not.toHaveBeenCalled();
            expect(adapter.getDiagnostics().objects.some((object) => object.id === "element-product")).toBe(false);

            adapter.destroy();
            expect(canvas.dispose).toHaveBeenCalledTimes(1);
        } finally {
            restoreFabricTextEnvironment();
        }
    });

    it("replaces only an arrow when head topology changes and keeps other stable instances", () => {
        const restoreFabricTextEnvironment = installFabricTextEnvironment();
        try {
            const canvas = new FakeDesignCanvas({ width: 1200, height: 800 });
            const adapter = createAdapter(canvas);
            const document = richElementDocument();
            adapter.project(document, { kind: "elements", ids: ["arrow-one"] });
            const arrow = canvas.getObjects()[3];
            const text = canvas.getObjects()[0];
            const next = structuredClone(document);
            const changed = next.elements.find((element) => element.id === "arrow-one");
            if (changed?.kind === "arrow") changed.startHead = "circle";
            adapter.project(next, { kind: "elements", ids: ["arrow-one"] });
            expect(canvas.getObjects()[0]).toBe(text);
            expect(canvas.getObjects()[3]).not.toBe(arrow);
            expect((canvas.getObjects()[3] as Group).getObjects()).toHaveLength(3);
            expect((canvas.getObjects()[3] as Group).getObjects()[1]).toBeInstanceOf(Circle);
            expect(adapter.getDiagnostics().counters).toMatchObject({ created: 4, replaced: 1, removed: 0 });
        } finally {
            restoreFabricTextEnvironment();
        }
    });

    it("replaces an arrow when a head changes renderer type", () => {
        const restoreFabricTextEnvironment = installFabricTextEnvironment();
        try {
            const canvas = new FakeDesignCanvas({ width: 1200, height: 800 });
            const adapter = createAdapter(canvas);
            const document = richElementDocument();
            adapter.project(document, { kind: "elements", ids: ["arrow-one"] });
            const arrow = canvas.getObjects()[3];
            const next = structuredClone(document);
            const changed = next.elements.find((element) => element.id === "arrow-one");
            if (changed?.kind === "arrow") changed.endHead = "circle";
            adapter.project(next, { kind: "elements", ids: ["arrow-one"] });
            expect(canvas.getObjects()[3]).not.toBe(arrow);
            expect((canvas.getObjects()[3] as Group).getObjects()[1]).toBeInstanceOf(Circle);
            expect(adapter.getDiagnostics().counters).toMatchObject({ created: 4, replaced: 1, removed: 0 });
        } finally {
            restoreFabricTextEnvironment();
        }
    });

    it("keeps unchanged and compatible Frame/shape instances while updating the selected object in place", () => {
        const canvas = new FakeDesignCanvas({ width: 1000, height: 700 });
        const adapter = createAdapter(canvas);
        const document = oneShapeDocument();
        document.frames = [createDesignDocumentFixture().frames[0]];
        document.elements[0].frameId = "frame-main";
        document.layers = [
            { scope: "workspace", elementIds: [] },
            { scope: "frame", frameId: "frame-main", elementIds: ["shape-one"] },
        ];
        adapter.project(document, { kind: "elements", ids: ["shape-one"] });
        const frameObject = canvas.getObjects()[0];
        const shapeObject = canvas.getObjects()[1];

        const next = structuredClone(document);
        next.revision += 1;
        next.frames[0].background = "#f1f5f9";
        next.elements[0].transform = { ...next.elements[0].transform, x: 120, y: 140, width: 180, height: 90 };
        if (next.elements[0].kind === "shape") next.elements[0].fill = "#22c55e";
        adapter.project(next, { kind: "elements", ids: ["shape-one"] });

        expect(canvas.getObjects()[0]).toBe(frameObject);
        expect(canvas.getObjects()[1]).toBe(shapeObject);
        expect(canvas.getActiveObjects()).toEqual([shapeObject]);
        expect(shapeObject).toMatchObject({ left: 220, top: 340, width: 180, height: 90, fill: "#22c55e" });
        expect(adapter.getViewportSnapshot().viewport).toEqual(next.workspace.viewport);
        expect(canvas.remove).not.toHaveBeenCalledWith(frameObject);
        expect(canvas.remove).not.toHaveBeenCalledWith(shapeObject);
    });

    it("replaces only a stable-id element whose render shape changes and removes deleted/hidden objects", () => {
        const canvas = new FakeDesignCanvas({ width: 1000, height: 700 });
        const adapter = createAdapter(canvas);
        const document = twoShapeDocument();
        adapter.project(document, { kind: "elements", ids: ["shape-one"] });
        const first = canvas.getObjects()[0];
        const second = canvas.getObjects()[1];

        const changed = structuredClone(document);
        const firstElement = changed.elements.find((element) => element.id === "shape-one")!;
        if (firstElement.kind === "shape") firstElement.shape = "ellipse";
        changed.elements.find((element) => element.id === "shape-two")!.hidden = true;
        adapter.project(changed, { kind: "elements", ids: ["shape-one"] });

        expect(canvas.getObjects()).toHaveLength(1);
        expect(canvas.getObjects()[0]).not.toBe(first);
        expect(canvas.getObjects()).not.toContain(second);
        expect(canvas.getActiveObjects()).toEqual([canvas.getObjects()[0]]);
        expect(canvas.remove).toHaveBeenCalledWith(first);
        expect(canvas.remove).toHaveBeenCalledWith(second);
    });

    it("preserves projection identity across undo, redo and save acknowledgement documents", async () => {
        const canvas = new FakeDesignCanvas({ width: 1000, height: 700 });
        const adapter = createAdapter(canvas);
        const project = designProject(oneShapeDocument());
        let remote = structuredClone(project);
        const store = createDesignEditorStore(project.id, {
            applyRemote: async (_id, batch) => {
                const result = applyDesignOperationBatch(remote.document, batch, { now: () => "2026-08-12T08:00:00.000Z" });
                remote = { ...remote, revision: result.document.revision, document: result.document, updatedAt: result.document.metadata.updatedAt };
                return { project: remote, receipt: result.receipt };
            },
            createId: sequenceId(),
            now: () => "2026-08-12T08:00:00.000Z",
            autosaveDelayMs: 60_000,
        });
        store.getState().hydrate(project);
        store.getState().select({ kind: "elements", ids: ["shape-one"] });
        adapter.project(store.getState().project!.document, store.getState().selection);
        const shapeObject = canvas.getObjects()[0];
        const viewport = { x: 40, y: 50, zoom: 1.25 };

        const original = store.getState().project!.document.elements[0];
        expect(
            store.getState().dispatch("移动形状", [
                {
                    opId: "op-move-shape",
                    type: "update-transform",
                    elementId: original.id,
                    transform: { ...original.transform, x: 300 },
                },
            ]),
        ).toBe(true);
        expect(store.getState().dispatch("移动视口", [{ opId: "op-viewport", type: "update-workspace", patch: { viewport } }], { history: "ignore" })).toBe(true);
        adapter.project(store.getState().project!.document, store.getState().selection);
        expect(canvas.getObjects()[0]).toBe(shapeObject);
        expect(store.getState().undo()).toBe(true);
        adapter.project(store.getState().project!.document, store.getState().selection);
        expect(canvas.getObjects()[0]).toBe(shapeObject);
        expect(adapter.getViewportSnapshot().viewport).toEqual(viewport);
        expect(store.getState().redo()).toBe(true);
        adapter.project(store.getState().project!.document, store.getState().selection);
        expect(canvas.getObjects()[0]).toBe(shapeObject);

        await store.getState().flush();
        adapter.project(store.getState().project!.document, store.getState().selection);
        expect(canvas.getObjects()[0]).toBe(shapeObject);
        expect(canvas.getActiveObjects()).toEqual([shapeObject]);
        expect(store.getState()).toMatchObject({ status: "saved", pendingCount: 0 });
        store.getState().destroy();
    });

    it("reconciles 200 stable elements without clearing the canvas or replacing unchanged objects", () => {
        const canvas = new FakeDesignCanvas({ width: 1200, height: 800 });
        const adapter = createAdapter(canvas);
        const document = manyShapeDocument(200);
        adapter.project(document, { kind: "elements", ids: ["shape-0"] });
        const before = canvas.getObjects();
        canvas.remove.mockClear();
        canvas.add.mockClear();
        canvas.getObjects.mockClear();

        const next = structuredClone(document);
        next.revision += 1;
        const changed = next.elements[137];
        changed.transform = { ...changed.transform, x: changed.transform.x + 25 };
        adapter.project(next, { kind: "elements", ids: ["shape-0"] });

        const after = canvas.getObjects();
        expect(after).toHaveLength(200);
        expect(after.every((object, index) => object === before[index])).toBe(true);
        expect(after[137].left).toBe(next.elements[137].transform.x);
        expect(canvas.remove).not.toHaveBeenCalled();
        expect(canvas.add).not.toHaveBeenCalled();
        expect(canvas.getActiveObjects()).toEqual([before[0]]);
    });

    it("exposes immutable diagnostics without returning Fabric objects", () => {
        const canvas = new FakeDesignCanvas({ width: 800, height: 600 });
        const adapter = createAdapter(canvas);
        const document = twoShapeDocument();

        adapter.project(document, { kind: "elements", ids: ["shape-one", "shape-two"] });
        const diagnostics = adapter.getDiagnostics();

        expect(diagnostics.objectCount).toBe(2);
        expect(diagnostics.objects.map(({ key, id, instanceId, index }) => ({ key, id, instanceId, index }))).toEqual([
            { key: "element:shape-one", id: "shape-one", instanceId: 1, index: 0 },
            { key: "element:shape-two", id: "shape-two", instanceId: 2, index: 1 },
        ]);
        expect(diagnostics.active).toMatchObject({ kind: "active-selection", ids: ["shape-one", "shape-two"] });
        expect(diagnostics.counters).toMatchObject({ created: 2, replaced: 0, removed: 0 });
        expect(Object.isFrozen(diagnostics)).toBe(true);
        expect(Object.isFrozen(diagnostics.objects)).toBe(true);
        expect(Object.isFrozen(diagnostics.active)).toBe(true);
        expect(JSON.stringify(diagnostics)).not.toContain("canvas");
    });
});

function createAdapter(canvas: FakeDesignCanvas, dependencies: ConstructorParameters<typeof DesignFabricAdapter>[2] = {}) {
    return new DesignFabricAdapter(
        canvas as unknown as Canvas,
        {
            onViewportCommit: vi.fn(),
            onSelectionChange: vi.fn(),
            onTransformCommit: vi.fn(),
        },
        dependencies,
    );
}

function singleImageDocument(assetVersionId: "asset-product-v1" | "asset-product-v2") {
    const document = createDesignDocumentFixture();
    document.frames = document.frames.filter((frame) => frame.id === "frame-main");
    document.elements = document.elements.filter((element) => element.id === "element-product");
    const element = document.elements[0];
    if (element.kind === "image") element.assetVersionId = assetVersionId;
    document.layers = [
        { scope: "workspace", elementIds: [] },
        { scope: "frame", frameId: "frame-main", elementIds: ["element-product"] },
    ];
    document.annotations = document.annotations.filter((annotation) => annotation.target.kind !== "frame" || annotation.target.frameId === "frame-main");
    return document;
}

function singleShapeFrameDocument() {
    const document = createDesignDocumentFixture();
    document.frames = document.frames.filter((frame) => frame.id === "frame-main");
    const shapeElement = { ...shape("shape-one", 40, 60), frameId: "frame-main" };
    document.elements = [shapeElement];
    document.layers = [
        { scope: "workspace", elementIds: [] },
        { scope: "frame", frameId: "frame-main", elementIds: [shapeElement.id] },
    ];
    document.annotations = [];
    return document;
}

function imageSource(width: number, height: number) {
    return { width, height, naturalWidth: width, naturalHeight: height } as unknown as ImageSource;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function installFabricTextEnvironment() {
    const previousDocument = (globalThis as { document?: unknown }).document;
    const previousWindow = (globalThis as { window?: unknown }).window;
    const measureContext = {
        measureText: (value: string) => ({ width: value.length * 10 }),
        textBaseline: "alphabetic",
        font: "",
        direction: "ltr",
    } as unknown as CanvasRenderingContext2D;
    (globalThis as { document?: unknown }).document = { createElement: () => ({ getContext: () => measureContext }) };
    (globalThis as { window?: unknown }).window = { devicePixelRatio: 1 };
    return () => {
        if (previousDocument === undefined) delete (globalThis as { document?: unknown }).document;
        else (globalThis as { document?: unknown }).document = previousDocument;
        if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else (globalThis as { window?: unknown }).window = previousWindow;
    };
}

function richElementDocument() {
    const document = createDesignDocumentFixture();
    document.frames = [];
    document.guides = document.guides.filter((guide) => guide.frameId === null);
    document.elements = [
        {
            id: "text-one",
            frameId: null,
            name: "Text",
            transform: { x: 20, y: 30, width: 260, height: 120, rotation: 0, flipX: false, flipY: false },
            opacity: 1,
            blendMode: "normal",
            locked: false,
            hidden: false,
            kind: "text",
            text: "初始标题",
            fontFamily: "Inter, sans-serif",
            fontSize: 24,
            fontWeight: 700,
            fontStyle: "normal",
            lineHeight: 1.2,
            letterSpacing: 0,
            align: "center",
            verticalAlign: "middle",
            fill: "#111827",
            stroke: null,
            strokeWidth: 0,
        },
        {
            id: "image-one",
            frameId: null,
            name: "Image",
            transform: { x: 320, y: 30, width: 200, height: 140, rotation: 0, flipX: false, flipY: false },
            opacity: 1,
            blendMode: "normal",
            locked: false,
            hidden: false,
            kind: "image",
            assetVersionId: "asset-product-v2",
            crop: null,
            fit: "contain",
            cornerRadius: 4,
        },
        {
            id: "line-one",
            frameId: null,
            name: "Line",
            transform: { x: 20, y: 220, width: 300, height: 20, rotation: 0, flipX: false, flipY: false },
            opacity: 1,
            blendMode: "normal",
            locked: false,
            hidden: false,
            kind: "line",
            stroke: "#334155",
            strokeWidth: 3,
            dash: [],
            cap: "round",
        },
        {
            id: "arrow-one",
            frameId: null,
            name: "Arrow",
            transform: { x: 380, y: 220, width: 240, height: 140, rotation: 0, flipX: false, flipY: false },
            opacity: 1,
            blendMode: "normal",
            locked: false,
            hidden: false,
            kind: "arrow",
            stroke: "#0f172a",
            strokeWidth: 5,
            dash: [],
            startHead: "none",
            endHead: "arrow",
        },
    ];
    document.layers = [{ scope: "workspace", elementIds: document.elements.map((element) => element.id) }];
    document.annotations = [];
    return document;
}

function oneShapeDocument() {
    const document = createDesignDocumentFixture();
    document.frames = [];
    document.guides = document.guides.filter((guide) => guide.frameId === null);
    document.elements = [shape("shape-one", 40, 60)];
    document.annotations = [];
    document.layers = [{ scope: "workspace", elementIds: ["shape-one"] }];
    return document;
}

function twoShapeDocument() {
    const document = oneShapeDocument();
    document.elements.push(shape("shape-two", 200, 160));
    document.layers = [{ scope: "workspace", elementIds: ["shape-one", "shape-two"] }];
    return document;
}

function manyShapeDocument(count: number) {
    const document = createDesignDocumentFixture();
    document.frames = [];
    document.elements = Array.from({ length: count }, (_, index) => shape(`shape-${index}`, index * 12, index * 3));
    document.layers = [{ scope: "workspace", elementIds: document.elements.map((element) => element.id) }];
    return document;
}

function designProject(document: ReturnType<typeof createDesignDocumentFixture>) {
    return {
        id: document.id,
        title: document.metadata.title,
        status: "active" as const,
        revision: document.revision,
        document,
        createdAt: document.metadata.createdAt,
        updatedAt: document.metadata.updatedAt,
    };
}

function sequenceId() {
    let index = 0;
    return () => `projection-${++index}`;
}

function shape(id: string, x: number, y: number): ReturnType<typeof createDesignDocumentFixture>["elements"][number] {
    return {
        id,
        frameId: null,
        name: id,
        transform: { x, y, width: 100, height: 80, rotation: 0, flipX: false, flipY: false },
        opacity: 1,
        blendMode: "normal" as const,
        locked: false,
        hidden: false,
        kind: "shape" as const,
        shape: "rectangle" as const,
        fill: "#ffffff" as const,
        stroke: null,
        strokeWidth: 0,
        cornerRadius: 0,
    };
}

class FakeDesignCanvas {
    viewportTransform = [1, 0, 0, 1, 0, 0];
    backgroundColor: string | undefined;
    defaultCursor = "default";
    contextTop = {} as CanvasRenderingContext2D;
    upperCanvasEl: { getBoundingClientRect: () => { left: number; top: number } };
    readonly on = vi.fn((eventName: string, listener: (event: { target?: FabricObject }) => void) => {
        const listeners = this.listeners.get(eventName) ?? new Set();
        listeners.add(listener);
        this.listeners.set(eventName, listeners);
    });
    readonly off = vi.fn((eventName: string, listener: (event: { target?: FabricObject }) => void) => {
        this.listeners.get(eventName)?.delete(listener);
    });
    readonly requestRenderAll = vi.fn();
    readonly clearContext = vi.fn();
    readonly dispose = vi.fn();
    readonly fire = vi.fn();
    readonly toCanvasElement = vi.fn((multiplier: number, options: { filter?: (object: FabricObject) => boolean }) => {
        void multiplier;
        void options;
        return { toBlob: (callback: BlobCallback, mimeType?: string) => callback(new Blob(["frame"], { type: mimeType || "image/png" })) } as unknown as HTMLCanvasElement;
    });
    readonly getObjects = vi.fn(() => [...this.objects]);
    readonly moveObjectTo = vi.fn((object: FabricObject, index: number) => {
        const currentIndex = this.objects.indexOf(object);
        if (currentIndex === index || currentIndex < 0) return false;
        this.objects.splice(currentIndex, 1);
        this.objects.splice(index, 0, object);
        return true;
    });
    private width: number;
    private height: number;
    private left: number;
    private top: number;
    private objects: FabricObject[] = [];
    private activeObjects: FabricObject[] = [];
    private activeObject: FabricObject | null = null;
    private readonly listeners = new Map<string, Set<(event: { target?: FabricObject }) => void>>();

    constructor({ width, height, left = 0, top = 0 }: { width: number; height: number; left?: number; top?: number }) {
        this.width = width;
        this.height = height;
        this.left = left;
        this.top = top;
        this.upperCanvasEl = { getBoundingClientRect: () => ({ left: this.left, top: this.top }) };
    }

    getWidth() {
        return this.width;
    }

    getHeight() {
        return this.height;
    }

    setDimensions({ width, height }: { width: number; height: number }) {
        this.width = width;
        this.height = height;
    }

    setViewportTransform(transform: number[]) {
        this.viewportTransform = [...transform];
    }

    setOffset(left: number, top: number) {
        this.left = left;
        this.top = top;
    }

    readonly add = vi.fn((object: FabricObject) => {
        this.objects.push(object);
    });

    readonly remove = vi.fn((...objects: FabricObject[]) => {
        this.objects = this.objects.filter((object) => !objects.includes(object));
        this.activeObjects = this.activeObjects.filter((object) => !objects.includes(object));
        if (this.activeObject && objects.includes(this.activeObject)) this.activeObject = null;
    });

    setActiveObject(object: FabricObject) {
        this.activeObject = object;
        this.activeObjects = object instanceof ActiveSelection ? object.getObjects() : [object];
    }

    discardActiveObject() {
        this.activeObject = null;
        this.activeObjects = [];
    }

    getActiveObject() {
        return this.activeObject;
    }

    getActiveObjects() {
        return [...this.activeObjects];
    }

    getElement() {
        return this.upperCanvasEl;
    }

    emit(eventName: string, event: { target?: FabricObject } = {}) {
        for (const listener of this.listeners.get(eventName) ?? []) listener(event);
    }
}
