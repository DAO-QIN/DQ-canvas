import { describe, expect, it } from "vitest";

import { applyDesignOperationBatch, type DesignDocument } from "@/lib/design";
import { createDesignDocumentFixture } from "@/lib/design/design.test-fixture";

import { compileDesignHistoryTransition, DesignHistoryCompileError } from "./design-history-compiler";

describe("Phase 7 typed history compiler", () => {
    it("restores deleted elements, their layer order and annotations without replacing the document", () => {
        const target = createDesignDocumentFixture();
        const current = structuredClone(target);
        current.revision += 1;
        current.elements = current.elements.filter((element) => element.id !== "element-product");
        current.layers = current.layers.map((layer) => ({ ...layer, elementIds: layer.elementIds.filter((id) => id !== "element-product") }));
        current.annotations = current.annotations.filter((annotation) => annotation.target.kind !== "element" || annotation.target.elementId !== "element-product");

        const outcome = apply(current, target);

        expect(outcome.receipt.status).toBe("applied");
        expectSemanticDocument(outcome.document, target);
        expect(outcome.receipt.results.map((result) => result.type)).toEqual(expect.arrayContaining(["create-element", "reorder-elements", "add-annotation"]));
    });

    it("restores transforms, styles and scope moves as existing typed operations", () => {
        const target = createDesignDocumentFixture();
        const current = structuredClone(target);
        current.revision += 1;
        const title = current.elements.find((element) => element.id === "element-title");
        if (!title || title.kind !== "text") throw new Error("fixture missing title");
        title.frameId = "frame-social";
        title.transform = { ...title.transform, x: 40, y: 60, rotation: 25 };
        title.fill = "#ff0000";
        current.layers.find((layer) => layer.scope === "frame" && layer.frameId === "frame-main")!.elementIds = current.layers.find((layer) => layer.scope === "frame" && layer.frameId === "frame-main")!.elementIds.filter((id) => id !== title.id);
        current.layers.find((layer) => layer.scope === "frame" && layer.frameId === "frame-social")!.elementIds.push(title.id);

        const outcome = apply(current, target);

        expect(outcome.receipt.status).toBe("applied");
        expectSemanticDocument(outcome.document, target);
        expect(outcome.receipt.results.map((result) => result.type)).toEqual(expect.arrayContaining(["move-elements", "update-transform", "update-text", "reorder-elements"]));
    });

    it("temporarily unlocks a locked element, restores order, then re-locks it", () => {
        const target = createDesignDocumentFixture();
        const title = target.elements.find((element) => element.id === "element-title");
        if (!title) throw new Error("fixture missing title");
        title.locked = true;
        const current = structuredClone(target);
        current.revision += 1;
        current.layers.find((layer) => layer.scope === "frame" && layer.frameId === "frame-main")!.elementIds = ["element-title", "element-product", "element-line", "element-arrow", "element-hidden-badge"];

        const operations = compileDesignHistoryTransition(current, target, sequenceId());
        const outcome = applyDesignOperationBatch(current, batch(current.revision, operations));

        expect(outcome.receipt.status).toBe("applied");
        expectSemanticDocument(outcome.document, target);
        expect(operations[0]).toMatchObject({ type: "update-element", elementId: "element-title", patch: { locked: false } });
        expect(operations.at(-1)).toMatchObject({ type: "update-element", elementId: "element-title", patch: { locked: true } });
    });

    it("refuses a transition that the typed operation protocol cannot represent", () => {
        const current = createDesignDocumentFixture();
        const target = structuredClone(current);
        target.assets = [];
        target.assetVersions = [];
        target.elements = target.elements.filter((element) => element.kind !== "image");
        target.layers = target.layers.map((layer) => ({ ...layer, elementIds: layer.elementIds.filter((id) => target.elements.some((element) => element.id === id)) }));
        target.annotations = target.annotations.filter((annotation) => {
            const annotationTarget = annotation.target;
            return annotationTarget.kind !== "element" || target.elements.some((element) => element.id === annotationTarget.elementId);
        });

        expect(() => compileDesignHistoryTransition(current, target, sequenceId())).toThrowError(new DesignHistoryCompileError("typed operation 不支持删除资源：asset-product"));
    });
});

function apply(current: DesignDocument, target: DesignDocument) {
    const operations = compileDesignHistoryTransition(current, target, sequenceId());
    return applyDesignOperationBatch(current, batch(current.revision, operations), { now: () => "2026-08-11T12:00:00.000Z" });
}

function batch(revision: number, operations: ReturnType<typeof compileDesignHistoryTransition>) {
    return { batchId: `batch-history-${revision}`, expectedRevision: revision, mode: "atomic" as const, source: "ui" as const, label: "撤销", operations };
}

function expectSemanticDocument(actual: DesignDocument, expected: DesignDocument) {
    expect(normalizeSemanticDocument(actual)).toEqual(normalizeSemanticDocument(expected));
}

function normalizeSemanticDocument(document: DesignDocument) {
    return {
        ...document,
        revision: 0,
        metadata: { ...document.metadata, updatedAt: "ignored" },
        elements: [...document.elements].toSorted((left, right) => left.id.localeCompare(right.id)),
        annotations: [...document.annotations].toSorted((left, right) => left.id.localeCompare(right.id)),
    };
}

function sequenceId() {
    let index = 0;
    return () => `history-${++index}`;
}
