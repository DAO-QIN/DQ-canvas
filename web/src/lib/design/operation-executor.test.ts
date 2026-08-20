import { describe, expect, it } from "vitest";

import { createDesignDocumentFixture } from "./design.test-fixture";
import { applyDesignOperationBatch } from "./operation-executor";
import { designOperationBatchFingerprint, parseDesignOperationBatch, type DesignOperationBatch } from "./operations";

const NOW = "2026-08-11T09:00:00.000Z";

describe("Design Ops executor", () => {
    it("updates the persisted workspace viewport as one typed revision", () => {
        const outcome = applyDesignOperationBatch(createDesignDocumentFixture(), {
            batchId: "batch-workspace-viewport",
            expectedRevision: 7,
            mode: "atomic",
            source: "ui",
            label: "调整工作区视图",
            operations: [{ opId: "op-workspace-viewport", type: "update-workspace", patch: { viewport: { x: 180, y: 96, zoom: 0.72 } } }],
        });
        expect(outcome.receipt).toMatchObject({ status: "applied", baseRevision: 7, resultRevision: 8 });
        expect(outcome.document.workspace.viewport).toEqual({ x: 180, y: 96, zoom: 0.72 });
    });

    it("strictly validates workspace patches before persistence", () => {
        const base = {
            batchId: "batch-workspace-invalid",
            expectedRevision: 7,
            mode: "atomic",
            source: "ui",
            label: "非法工作区操作",
        };
        expect(() => parseDesignOperationBatch({ ...base, operations: [{ opId: "op-empty", type: "update-workspace", patch: {} }] })).toThrow("patch 不能为空");
        expect(() => parseDesignOperationBatch({ ...base, operations: [{ opId: "op-unknown", type: "update-workspace", patch: { fabricViewport: [1, 0, 0, 1, 0, 0] } }] })).toThrow("patch 包含未知字段 fabricViewport");

        const invalidViewport = applyDesignOperationBatch(createDesignDocumentFixture(), {
            ...base,
            operations: [{ opId: "op-invalid-zoom", type: "update-workspace", patch: { viewport: { x: 0, y: 0, zoom: 0 } } }],
        });
        expect(invalidViewport.receipt).toMatchObject({ status: "rejected", resultRevision: 7, results: [{ error: { code: "DOCUMENT_INVALID" } }] });
        expect(invalidViewport.document.workspace.viewport.zoom).toBe(0.25);
    });

    it("applies a typed atomic batch as one revision and history transaction", () => {
        const batch: DesignOperationBatch = {
            batchId: "batch-transform-title",
            expectedRevision: 7,
            mode: "atomic",
            source: "ui",
            label: "调整标题与裁剪",
            operations: [
                { opId: "op-transform-title", type: "update-transform", elementId: "element-title", transform: { x: 320, y: 1480, width: 1360, height: 260, rotation: 0, flipX: false, flipY: false } },
                { opId: "op-update-title", type: "update-text", elementId: "element-title", patch: { fontSize: 104, text: "DQ Bottle / 今日轻盈" } },
                { opId: "op-crop-product", type: "set-image-crop", elementId: "element-product", crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } },
            ],
        };
        const outcome = applyDesignOperationBatch(createDesignDocumentFixture(), batch, { now: () => NOW, createTransactionId: () => "history-one" });
        expect(outcome.receipt).toMatchObject({
            status: "applied",
            baseRevision: 7,
            resultRevision: 8,
            results: [{ status: "applied" }, { status: "applied" }, { status: "applied" }],
            transaction: { id: "history-one", operationIds: ["op-transform-title", "op-update-title", "op-crop-product"] },
        });
        expect(outcome.document.revision).toBe(8);
        expect(outcome.document.metadata.updatedAt).toBe(NOW);
        expect(outcome.document.elements.find((item) => item.id === "element-title")).toMatchObject({ kind: "text", text: "DQ Bottle / 今日轻盈", fontSize: 104 });
    });

    it("rolls back an atomic batch and marks later operations skipped", () => {
        const batch: DesignOperationBatch = {
            batchId: "batch-atomic-rollback",
            expectedRevision: 7,
            mode: "atomic",
            source: "agent",
            label: "原子修改",
            operations: [
                { opId: "op-first", type: "update-element", elementId: "element-title", patch: { opacity: 0.5 } },
                { opId: "op-invalid", type: "set-image-crop", elementId: "element-title", crop: null },
                { opId: "op-never", type: "delete-annotation", annotationId: "annotation-product" },
            ],
        };
        const original = createDesignDocumentFixture();
        const outcome = applyDesignOperationBatch(original, batch);
        expect(outcome.receipt).toMatchObject({ status: "rejected", resultRevision: 7, results: [{ status: "rolled-back" }, { status: "rejected", error: { code: "TYPE_MISMATCH" } }, { status: "skipped" }], transaction: null });
        expect(outcome.document).toEqual(original);
    });

    it("keeps valid operations in partial mode and returns per-operation errors", () => {
        const batch: DesignOperationBatch = {
            batchId: "batch-partial",
            expectedRevision: 7,
            mode: "partial",
            source: "agent",
            label: "部分修改",
            operations: [
                { opId: "op-valid", type: "update-element", elementId: "element-title", patch: { opacity: 0.75 } },
                { opId: "op-missing", type: "update-element", elementId: "element-missing", patch: { hidden: true } },
                { opId: "op-invalid-opacity", type: "update-element", elementId: "element-arrow", patch: { opacity: 5 } },
            ],
        };
        const outcome = applyDesignOperationBatch(createDesignDocumentFixture(), batch, { now: () => NOW });
        expect(outcome.receipt).toMatchObject({
            status: "partial",
            resultRevision: 8,
            results: [{ status: "applied" }, { status: "rejected", error: { code: "ELEMENT_NOT_FOUND" } }, { status: "rejected", error: { code: "DOCUMENT_INVALID", path: expect.stringContaining("opacity") } }],
        });
        expect(outcome.document.elements.find((item) => item.id === "element-title")?.opacity).toBe(0.75);
        expect(outcome.document.elements.find((item) => item.id === "element-arrow")?.opacity).toBe(1);
    });

    it("rejects a stale revision without applying anything", () => {
        const batch = baseDeleteBatch();
        batch.expectedRevision = 6;
        const outcome = applyDesignOperationBatch(createDesignDocumentFixture(), batch);
        expect(outcome.receipt).toMatchObject({ status: "conflict", baseRevision: 7, resultRevision: 7, results: [{ status: "skipped", error: { code: "REVISION_CONFLICT" } }] });
    });

    it("replays an identical persisted receipt and rejects batch id reuse with different content", () => {
        const original = createDesignDocumentFixture();
        const batch = baseDeleteBatch();
        const first = applyDesignOperationBatch(original, batch, { now: () => NOW });
        const replay = { documentId: original.id, batchId: batch.batchId, fingerprint: first.receipt.fingerprint, receipt: first.receipt };
        const repeated = applyDesignOperationBatch(first.document, batch, { replay });
        expect(repeated.document).toEqual(first.document);
        expect(repeated.receipt).toMatchObject({ status: "replayed", originalStatus: "applied", resultRevision: 8 });

        const altered = structuredClone(batch);
        altered.operations[0] = { opId: "op-delete", type: "delete-annotation", annotationId: "annotation-social" };
        const conflict = applyDesignOperationBatch(first.document, altered, { replay });
        expect(conflict.receipt).toMatchObject({ status: "conflict", results: [{ error: { code: "BATCH_ID_CONFLICT" } }] });
    });

    it("strictly rejects unknown fields and duplicate op ids before execution", () => {
        const unknown = { ...baseDeleteBatch(), jsonPatch: [{ op: "replace" }] };
        expect(() => parseDesignOperationBatch(unknown)).toThrow("未知字段 jsonPatch");
        const duplicate = baseDeleteBatch();
        duplicate.operations.push({ ...duplicate.operations[0] });
        expect(() => parseDesignOperationBatch(duplicate)).toThrow("opId 重复");
    });

    it("uses a stable content fingerprint independent of object key insertion order", () => {
        const batch = baseDeleteBatch();
        const reordered = { operations: batch.operations, label: batch.label, source: batch.source, mode: batch.mode, expectedRevision: batch.expectedRevision, batchId: batch.batchId };
        expect(designOperationBatchFingerprint(batch)).toBe(designOperationBatchFingerprint(parseDesignOperationBatch(reordered)));
        expect(designOperationBatchFingerprint(batch)).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it("rejects unknown nested patch fields instead of merging them into the document", () => {
        const batch = baseDeleteBatch() as unknown as Record<string, unknown>;
        batch.operations = [{ opId: "op-unsafe", type: "update-element", elementId: "element-title", patch: { opacity: 0.5, fabricCache: true } }];
        expect(() => parseDesignOperationBatch(batch)).toThrow("patch 包含未知字段 fabricCache");
    });

    it("supports persisted guides and switching an image to another immutable asset version", () => {
        const batch: DesignOperationBatch = {
            batchId: "batch-guide-and-version",
            expectedRevision: 7,
            mode: "atomic",
            source: "ui",
            label: "辅助线与图片版本",
            operations: [
                { opId: "op-guide", type: "create-guide", guide: { id: "guide-main-center", axis: "vertical", position: 1000, frameId: "frame-main", locked: false } },
                { opId: "op-version", type: "set-image-asset-version", elementId: "element-product", assetVersionId: "asset-product-v1" },
            ],
        };
        const outcome = applyDesignOperationBatch(createDesignDocumentFixture(), batch, { now: () => NOW });
        expect(outcome.receipt.status).toBe("applied");
        expect(outcome.document.guides).toContainEqual({ id: "guide-main-center", axis: "vertical", position: 1000, frameId: "frame-main", locked: false });
        expect(outcome.document.elements.find((item) => item.id === "element-product")).toMatchObject({ kind: "image", assetVersionId: "asset-product-v1" });
        expect(outcome.document.assetVersions).toHaveLength(2);
    });

    it("allows an explicit unlock and unlocked reordering that preserves locked indices", () => {
        const document = createDesignDocumentFixture();
        const title = document.elements.find((item) => item.id === "element-title");
        if (title) title.locked = true;
        const rejected = applyDesignOperationBatch(document, {
            batchId: "batch-locked-reorder",
            expectedRevision: 7,
            mode: "atomic",
            source: "ui",
            label: "重排锁定元素",
            operations: [{ opId: "op-reorder", type: "reorder-elements", target: { scope: "frame", frameId: "frame-main" }, elementIds: ["element-title", "element-product", "element-line", "element-arrow", "element-hidden-badge"] }],
        });
        expect(rejected.receipt).toMatchObject({ status: "rejected", results: [{ error: { code: "LOCKED" } }] });

        const preservesLockedIndex = applyDesignOperationBatch(document, {
            batchId: "batch-preserve-locked-index",
            expectedRevision: 7,
            mode: "atomic",
            source: "ui",
            label: "重排未锁定元素",
            operations: [{ opId: "op-preserve", type: "reorder-elements", target: { scope: "frame", frameId: "frame-main" }, elementIds: ["element-product", "element-line", "element-title", "element-hidden-badge", "element-arrow"] }],
        });
        expect(preservesLockedIndex.receipt.status).toBe("applied");
        expect(preservesLockedIndex.document.layers.find((layer) => layer.scope === "frame" && layer.frameId === "frame-main")?.elementIds[2]).toBe("element-title");

        const unlocked = applyDesignOperationBatch(document, {
            batchId: "batch-unlock",
            expectedRevision: 7,
            mode: "atomic",
            source: "ui",
            label: "解锁标题",
            operations: [{ opId: "op-unlock", type: "update-element", elementId: "element-title", patch: { locked: false } }],
        });
        expect(unlocked.receipt.status).toBe("applied");
        expect(unlocked.document.elements.find((item) => item.id === "element-title")?.locked).toBe(false);
    });

    it("updates shape, line and arrow styles through dedicated typed operations", () => {
        const outcome = applyDesignOperationBatch(createDesignDocumentFixture(), {
            batchId: "batch-basic-styles",
            expectedRevision: 7,
            mode: "atomic",
            source: "ui",
            label: "编辑基础样式",
            operations: [
                { opId: "op-shape", type: "update-shape", elementId: "element-hidden-badge", patch: { fill: "#22c55e", strokeWidth: 6 } },
                { opId: "op-line", type: "update-line", elementId: "element-line", patch: { stroke: "#2563eb", cap: "square" } },
                { opId: "op-arrow", type: "update-arrow", elementId: "element-arrow", patch: { strokeWidth: 10, startHead: "circle" } },
            ],
        });
        expect(outcome.receipt.status).toBe("applied");
        expect(outcome.document.elements.find((item) => item.id === "element-hidden-badge")).toMatchObject({ fill: "#22c55e", strokeWidth: 6 });
        expect(outcome.document.elements.find((item) => item.id === "element-line")).toMatchObject({ stroke: "#2563eb", cap: "square" });
        expect(outcome.document.elements.find((item) => item.id === "element-arrow")).toMatchObject({ strokeWidth: 10, startHead: "circle" });

        const mismatch = applyDesignOperationBatch(createDesignDocumentFixture(), {
            batchId: "batch-style-mismatch",
            expectedRevision: 7,
            mode: "atomic",
            source: "ui",
            label: "错误样式类型",
            operations: [{ opId: "op-wrong", type: "update-shape", elementId: "element-title", patch: { fill: "#ffffff" } }],
        });
        expect(mismatch.receipt).toMatchObject({ status: "rejected", results: [{ error: { code: "TYPE_MISMATCH" } }] });
    });
});

function baseDeleteBatch(): DesignOperationBatch {
    return { batchId: "batch-delete-annotation", expectedRevision: 7, mode: "atomic", source: "ui", label: "删除标注", operations: [{ opId: "op-delete", type: "delete-annotation", annotationId: "annotation-product" }] };
}
