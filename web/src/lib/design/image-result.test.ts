import { describe, expect, it } from "vitest";

import { applyDesignOperationBatch } from "./operation-executor";
import { createDesignDocumentFixture } from "./design.test-fixture";
import { createDesignImageResultPlan, designDocumentHasImageResult } from "./image-result";

const NOW = "2026-08-13T08:00:00.000Z";

describe("Design image result planner", () => {
    it("creates a generated root asset and a deterministic sibling element", () => {
        const document = createDesignDocumentFixture();
        const plan = createDesignImageResultPlan(document, {
            requestId: "request-generate-one",
            generationTaskId: "task-generate-one",
            name: "生成结果",
            locator: { kind: "storage-key", storageKey: "permanent/result.png" },
            mimeType: "image/png",
            width: 1024,
            height: 1024,
            createdAt: NOW,
            target: { scope: "workspace" },
            position: { x: 300, y: 400 },
            operation: "generate",
        });

        const outcome = applyDesignOperationBatch(document, plan.batch, { now: () => NOW });
        expect(outcome.receipt.status).toBe("applied");
        expect(outcome.document.assetVersions.at(-1)).toMatchObject({ id: plan.assetVersionId, parentVersionId: null, source: "generated", provenance: { generationTaskId: "task-generate-one", sourceElementId: null } });
        expect(outcome.document.elements.at(-1)).toMatchObject({ id: plan.elementId, frameId: null, transform: { x: 300, y: 400, width: 640, height: 640 } });
        expect(designDocumentHasImageResult(outcome.document, "task-generate-one")).toEqual({ assetId: plan.assetId, assetVersionId: plan.assetVersionId, elementId: plan.elementId });
    });

    it("adds an immutable version to the source asset and leaves the source element unchanged", () => {
        const document = createDesignDocumentFixture();
        const sourceBefore = structuredClone(document.elements.find((element) => element.id === "element-product"));
        const plan = createDesignImageResultPlan(document, {
            requestId: "request-edit-one",
            generationTaskId: "task-edit-one",
            name: "派生结果",
            locator: { kind: "storage-key", storageKey: "permanent/edit.webp" },
            mimeType: "image/webp",
            width: 2048,
            height: 1024,
            createdAt: NOW,
            target: { scope: "workspace" },
            position: { x: 0, y: 0 },
            sourceElementId: "element-product",
            operation: "edit",
        });

        const outcome = applyDesignOperationBatch(document, plan.batch, { now: () => NOW });
        expect(outcome.receipt.status).toBe("applied");
        expect(outcome.document.elements.find((element) => element.id === "element-product")).toEqual(sourceBefore);
        expect(outcome.document.assetVersions.at(-1)).toMatchObject({
            assetId: "asset-product",
            parentVersionId: "asset-product-v2",
            source: "derived",
            provenance: { operation: "edit", sourceElementId: "element-product", generationTaskId: "task-edit-one" },
        });
        expect(outcome.document.assets.find((asset) => asset.id === "asset-product")).toMatchObject({ currentVersionId: plan.assetVersionId, versionIds: ["asset-product-v1", "asset-product-v2", plan.assetVersionId] });
        expect(outcome.document.elements.at(-1)).toMatchObject({ id: plan.elementId, frameId: "frame-main", assetVersionId: plan.assetVersionId });
    });

    it("records a local deterministic derivative without inventing a generation task", () => {
        const document = createDesignDocumentFixture();
        const plan = createDesignImageResultPlan(document, {
            requestId: "local-upscale-element-product-v2-2x",
            generationTaskId: null,
            name: "本地放大结果",
            locator: { kind: "storage-key", storageKey: "permanent/upscaled.png" },
            mimeType: "image/png",
            width: 2400,
            height: 1600,
            createdAt: NOW,
            target: { scope: "workspace" },
            position: { x: 0, y: 0 },
            sourceElementId: "element-product",
            operation: "upscale",
        });

        const outcome = applyDesignOperationBatch(document, plan.batch, { now: () => NOW });
        expect(outcome.document.assetVersions.at(-1)).toMatchObject({
            parentVersionId: "asset-product-v2",
            provenance: { operation: "upscale", sourceElementId: "element-product", generationTaskId: null },
        });
        expect(outcome.document.elements.find((element) => element.id === "element-product")).toMatchObject({ kind: "image", assetVersionId: "asset-product-v2" });
        expect(designDocumentHasImageResult(outcome.document, "")).toBeNull();
    });

    it("keeps ids stable across reconstruction and rejects a missing source", () => {
        const document = createDesignDocumentFixture();
        const input = {
            requestId: "stable-result",
            generationTaskId: "stable-task",
            name: "Stable",
            locator: { kind: "storage-key" as const, storageKey: "permanent/stable.png" },
            mimeType: "image/png" as const,
            width: 10,
            height: 20,
            createdAt: NOW,
            target: { scope: "workspace" as const },
            position: { x: 0, y: 0 },
            operation: "generate" as const,
        };
        expect(createDesignImageResultPlan(document, input)).toEqual(createDesignImageResultPlan(document, input));
        expect(() => createDesignImageResultPlan(document, { ...input, sourceElementId: "missing" })).toThrow("源元素不存在：missing");
    });

    it("keeps the task provenance as a replay marker after its placed element is deleted", () => {
        const document = createDesignDocumentFixture();
        const plan = createDesignImageResultPlan(document, {
            requestId: "request-deleted-result",
            generationTaskId: "task-deleted-result",
            name: "生成后删除",
            locator: { kind: "storage-key", storageKey: "permanent/deleted-result.png" },
            mimeType: "image/png",
            width: 1024,
            height: 1024,
            createdAt: NOW,
            target: { scope: "workspace" },
            position: { x: 0, y: 0 },
            operation: "generate",
        });
        const generated = applyDesignOperationBatch(document, plan.batch, { now: () => NOW }).document;
        const deleted = applyDesignOperationBatch(
            generated,
            {
                batchId: "batch-delete-generated-element",
                expectedRevision: generated.revision,
                mode: "atomic",
                source: "ui",
                label: "删除生成元素",
                operations: [{ opId: "op-delete-generated-element", type: "delete-elements", elementIds: [plan.elementId] }],
            },
            { now: () => NOW },
        ).document;

        expect(designDocumentHasImageResult(deleted, "task-deleted-result")).toEqual({ assetId: plan.assetId, assetVersionId: plan.assetVersionId, elementId: null });
    });
});
