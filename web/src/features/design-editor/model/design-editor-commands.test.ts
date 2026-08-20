import { describe, expect, it } from "vitest";

import { applyDesignOperationBatch } from "@/lib/design";
import { createDesignDocumentFixture } from "@/lib/design/design.test-fixture";

import type { DesignOperation } from "@/lib/design";

import {
    alignDesignElements,
    createElementOperation,
    createFrameOperation,
    distributeDesignElements,
    moveDesignElementsToScope,
    reorderDesignElements,
    toggleDesignElementSelection,
    validDesignEditorSelection,
    visualDesignElementBounds,
} from "./design-editor-commands";

describe("Phase 6 editor commands", () => {
    it("creates a valid Frame and its required Frame layer", () => {
        const document = emptyDocument();
        const operation = createFrameOperation(document, "frame-new", "op-frame", { x: 800, y: 700 });
        const outcome = applyDesignOperationBatch(document, batch(document.revision, operation));

        expect(outcome.receipt.status).toBe("applied");
        expect(outcome.document.frames).toContainEqual(expect.objectContaining({ id: "frame-new", x: 200, y: 100, width: 1200, height: 1200, background: "#ffffff" }));
        expect(outcome.document.layers).toContainEqual({ scope: "frame", frameId: "frame-new", elementIds: [] });
    });

    it.each(["text", "rectangle", "ellipse", "line", "arrow"] as const)("creates a valid %s element in the selected Frame", (kind) => {
        const document = createDesignDocumentFixture();
        const id = `element-new-${kind}`;
        const operation = createElementOperation(document, { kind: "frame", id: "frame-main" }, kind, id, `op-${kind}`, { x: 0, y: 0 });
        const outcome = applyDesignOperationBatch(document, batch(document.revision, operation));

        expect(outcome.receipt.status).toBe("applied");
        expect(outcome.document.elements.find((element) => element.id === id)).toMatchObject({ frameId: "frame-main", locked: false, hidden: false, opacity: 1 });
        expect(outcome.document.layers.find((layer) => layer.scope === "frame" && layer.frameId === "frame-main")?.elementIds.at(-1)).toBe(id);
    });

    it("falls back to the Workspace when no unlocked Frame is available", () => {
        const document = emptyDocument();
        const operation = createElementOperation(document, null, "rectangle", "element-workspace", "op-workspace", { x: 500, y: 400 });
        const outcome = applyDesignOperationBatch(document, batch(document.revision, operation));

        expect(outcome.receipt.status).toBe("applied");
        expect(outcome.document.elements[0]).toMatchObject({ id: "element-workspace", frameId: null, transform: { x: 340, y: 290, width: 320, height: 220 } });
        expect(outcome.document.layers.find((layer) => layer.scope === "workspace")?.elementIds).toContain("element-workspace");
    });

    it("rejects dangling runtime selections after a reload or delete", () => {
        const document = createDesignDocumentFixture();
        expect(validDesignEditorSelection(document, { kind: "frame", id: "frame-main" })).toEqual({ kind: "frame", id: "frame-main" });
        expect(validDesignEditorSelection(document, { kind: "elements", ids: ["element-missing"] })).toBeNull();
    });

    it("keeps additive element selection inside one layer scope", () => {
        const document = createDesignDocumentFixture();
        const one = toggleDesignElementSelection(document, null, "element-product", false);
        expect(toggleDesignElementSelection(document, one, "element-title", true)).toEqual({ kind: "elements", ids: ["element-product", "element-title"] });
        expect(toggleDesignElementSelection(document, one, "element-social-product", true)).toEqual({ kind: "elements", ids: ["element-social-product"] });
    });

    it("computes rotated visual AABB and aligns elements using it", () => {
        const document = createDesignDocumentFixture();
        const product = document.elements.find((element) => element.id === "element-product")!;
        product.transform = { ...product.transform, x: 100, y: 100, width: 100, height: 50, rotation: 90 };
        expect(visualDesignElementBounds(product)).toEqual({ x: 50, y: 100, width: 50, height: 100 });
        const operations = alignDesignElements(document, ["element-product", "element-title"], "left", sequenceId());
        const outcome = applyDesignOperationBatch(document, batchMany(document.revision, operations));
        expect(outcome.receipt.status).toBe("applied");
        const [first, second] = ["element-product", "element-title"].map((id) => visualDesignElementBounds(outcome.document.elements.find((element) => element.id === id)!));
        expect(first.x).toBe(second.x);
    });

    it("distributes three elements with equal visual gaps", () => {
        const document = createDesignDocumentFixture();
        for (const [id, x] of [
            ["element-product", 0],
            ["element-line", 200],
            ["element-title", 700],
        ] as const) {
            const element = document.elements.find((candidate) => candidate.id === id)!;
            element.transform = { ...element.transform, x, y: 0, width: 100, height: 100, rotation: 0 };
        }
        const operations = distributeDesignElements(document, ["element-product", "element-line", "element-title"], "horizontal", sequenceId());
        const outcome = applyDesignOperationBatch(document, batchMany(document.revision, operations));
        const bounds = ["element-product", "element-line", "element-title"].map((id) => visualDesignElementBounds(outcome.document.elements.find((element) => element.id === id)!));
        expect(bounds[1].x - (bounds[0].x + bounds[0].width)).toBe(bounds[2].x - (bounds[1].x + bounds[1].width));
    });

    it("reorders unlocked elements around a locked fixed slot", () => {
        const document = createDesignDocumentFixture();
        document.elements.find((element) => element.id === "element-title")!.locked = true;
        const operation = reorderDesignElements(document, ["element-product"], "front", sequenceId());
        expect(operation?.elementIds[2]).toBe("element-title");
        const outcome = applyDesignOperationBatch(document, batch(document.revision, operation!));
        expect(outcome.receipt.status).toBe("applied");
        expect(outcome.document.layers.find((layer) => layer.scope === "frame" && layer.frameId === "frame-main")?.elementIds).toEqual(["element-line", "element-arrow", "element-title", "element-hidden-badge", "element-product"]);
    });

    it("moves elements across scopes while preserving their scene position", () => {
        const document = createDesignDocumentFixture();
        const before = document.elements.find((element) => element.id === "element-title")!;
        const sourceFrame = document.frames.find((frame) => frame.id === before.frameId)!;
        const operations = moveDesignElementsToScope(document, [before.id], { scope: "frame", frameId: "frame-social" }, sequenceId());
        const outcome = applyDesignOperationBatch(document, batchMany(document.revision, operations));
        const after = outcome.document.elements.find((element) => element.id === before.id)!;
        const targetFrame = outcome.document.frames.find((frame) => frame.id === after.frameId)!;
        expect({ x: after.transform.x + targetFrame.x, y: after.transform.y + targetFrame.y }).toEqual({ x: before.transform.x + sourceFrame.x, y: before.transform.y + sourceFrame.y });
    });
});

function emptyDocument() {
    const document = createDesignDocumentFixture();
    return { ...document, frames: [], elements: [], guides: [], annotations: [], layers: [{ scope: "workspace" as const, elementIds: [] }] };
}

function batch(revision: number, operation: DesignOperation) {
    return { batchId: `batch-${operation.opId}`, expectedRevision: revision, mode: "atomic" as const, source: "ui" as const, label: "创建", operations: [operation] };
}

function batchMany(revision: number, operations: DesignOperation[]) {
    return { batchId: `batch-many-${revision}`, expectedRevision: revision, mode: "atomic" as const, source: "ui" as const, label: "排版", operations };
}

function sequenceId() {
    let index = 0;
    return () => `layout-${++index}`;
}
