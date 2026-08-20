import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Phase 6 Fabric intent boundary", () => {
    it("projects Design Documents and emits single-object intents without a reverse persistence path", () => {
        const source = readFileSync(new URL("./design-fabric-adapter.ts", import.meta.url), "utf8");
        expect(source).toContain("project(document: DesignDocument, selection:");
        expect(source).toContain("previewViewport(viewport: DesignViewport)");
        expect(source).toContain("onViewportCommit");
        expect(source).toContain("onTransformCommit");
        expect(source).toContain('canvas.on("object:modified"');
        expect(source).not.toContain("exportDocument");
        expect(source).not.toContain("toJSON");
        expect(source).not.toContain("fetch(");
        expect(source).not.toContain("PATCH");
    });

    it("keeps objects interactive while resolving images through the runtime-only resource boundary", () => {
        const source = readFileSync(new URL("./design-fabric-adapter.ts", import.meta.url), "utf8");
        expect(source).toContain("selectable: true");
        expect(source).toContain("lockMovementX: locked");
        expect(source).toContain("lockScalingFlip: true");
        expect(source).toContain('new Textbox("图片素材"');
        expect(source).toContain("FabricImage");
        expect(source).toContain("resolveDesignAssetVersion");
        expect(source).toContain("projectionGeneration");
        expect(source).not.toContain("fromURL");
        expect(source).not.toContain("fetch(");
        expect(source).not.toContain("storageKey =");
    });
});

describe("Phase 7 Fabric interaction boundary", () => {
    it("keeps multi-selection and snapping in runtime while committing typed transforms", () => {
        const source = readFileSync(new URL("./design-fabric-adapter.ts", import.meta.url), "utf8");
        expect(source).toContain("new ActiveSelection");
        expect(source).toContain("SNAP_THRESHOLD_PX = 8");
        expect(source).toContain("SNAP_RELEASE_THRESHOLD_PX = 12");
        expect(source).toContain("this.snapIndex = buildDesignSnapIndex(document)");
        expect(source).toContain("this.frameChildren.get(meta.id)");
        expect(source).toContain("objectCaching: true");
        expect(source).toContain('kind: "elements"; transforms:');
        expect(source).toContain("const wasProjecting = this.projecting");
        expect(source).not.toContain("snapCandidates(this.document");
        expect(source).not.toContain("canvas.getObjects().filter");
        expect(source).not.toContain("toObject(");
    });
});

describe("Phase 8 Fabric observation boundary", () => {
    it("exposes read-only snapshots and coordinate conversion without adding a persistence path", () => {
        const source = readFileSync(new URL("./design-fabric-adapter.ts", import.meta.url), "utf8");

        expect(source).toContain("getSelectionSnapshot()");
        expect(source).toContain("getViewportSnapshot()");
        expect(source).toContain("getResizeSnapshot()");
        expect(source).toContain("getSelectionBounds()");
        expect(source).toContain("sceneToScreen(point:");
        expect(source).toContain("screenToScene(point:");
        expect(source).toContain("subscribeSelection(listener:");
        expect(source).toContain("subscribeViewport(listener:");
        expect(source).toContain("subscribeResize(listener:");
        expect(source).not.toContain("resizeSelection(");
        expect(source).not.toContain("persistSnapshot(");
    });

    it("derives selection observations from active objects rather than scanning the full scene", () => {
        const source = readFileSync(new URL("./design-fabric-adapter.ts", import.meta.url), "utf8");
        const selectionSnapshotStart = source.indexOf("function createDesignFabricSelectionSnapshot");
        const selectionSnapshotEnd = source.indexOf("function freezeDesignFabricRect", selectionSnapshotStart);
        const selectionSnapshotSource = source.slice(selectionSnapshotStart, selectionSnapshotEnd);

        expect(selectionSnapshotSource).toContain("canvas.getActiveObjects()");
        expect(selectionSnapshotSource).not.toContain("canvas.getObjects()");
        expect(selectionSnapshotSource).not.toContain("DesignDocument");
    });
});
