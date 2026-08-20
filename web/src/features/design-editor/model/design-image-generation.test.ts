import { describe, expect, it } from "vitest";

import type { CreativeWorkspaceGenerationTask } from "@/lib/creative-workspace";
import { applyDesignOperationBatch } from "@/lib/design";
import { createDesignDocumentFixture } from "@/lib/design/design.test-fixture";

import { decideDesignImageTaskCommit, designGenerationBinding, selectedDesignReference } from "./design-image-generation";

const task = (patch: Partial<CreativeWorkspaceGenerationTask> = {}): CreativeWorkspaceGenerationTask => ({
    id: "task-one",
    type: "image",
    status: "succeeded",
    kind: "generation",
    binding: { surface: "design", projectId: "design-product-campaign", baseRevision: 7, target: { scope: "workspace" } },
    imageResult: { storageKey: "permanent/result.png", mimeType: "image/png", width: 1024, height: 768 },
    createdAt: Date.parse("2026-08-13T08:00:00.000Z"),
    updatedAt: Date.parse("2026-08-13T08:01:00.000Z"),
    ...patch,
});

describe("Design image generation decisions", () => {
    it("binds an exact single image as an edit source and otherwise uses the selected Frame or workspace", () => {
        const document = createDesignDocumentFixture();
        expect(designGenerationBinding(document, { kind: "elements", ids: ["element-product"] }, document.id)).toEqual({
            surface: "design",
            projectId: document.id,
            baseRevision: 7,
            target: { scope: "frame", frameId: "frame-main" },
            elementId: "element-product",
            assetVersionId: "asset-product-v2",
        });
        expect(designGenerationBinding(document, { kind: "frame", id: "frame-social" }, document.id)).toMatchObject({ target: { scope: "frame", frameId: "frame-social" } });
        expect(designGenerationBinding(document, null, document.id)).toMatchObject({ target: { scope: "workspace" } });
        expect(selectedDesignReference(document, { kind: "elements", ids: ["element-product"] })?.version.id).toBe("asset-product-v2");
    });

    it("plans a stable automatic commit only at the submission revision", () => {
        const document = createDesignDocumentFixture();
        const decision = decideDesignImageTaskCommit(document, task(), { x: 900, y: 700 });

        expect(decision.kind).toBe("ready");
        if (decision.kind !== "ready") throw new Error("expected ready plan");
        expect(decision.plan.batch.expectedRevision).toBe(7);
        expect(decision.plan.batch.batchId).toContain("batch-image-result-");
    });

    it("moves a late result into pending placement and can explicitly replan it at the current revision", () => {
        const document = { ...createDesignDocumentFixture(), revision: 8 };
        expect(decideDesignImageTaskCommit(document, task(), { x: 0, y: 0 })).toMatchObject({ kind: "pending-placement", reason: expect.stringContaining("r7") });
        const explicit = decideDesignImageTaskCommit(document, task(), { x: 0, y: 0 }, 8);
        expect(explicit.kind).toBe("ready");
        if (explicit.kind === "ready") expect(explicit.plan.batch.expectedRevision).toBe(8);
    });

    it("recognizes an already persisted task result as a replay", () => {
        const document = createDesignDocumentFixture();
        const decision = decideDesignImageTaskCommit(document, task(), { x: 0, y: 0 });
        if (decision.kind !== "ready") throw new Error("expected ready plan");
        const applied = applyDesignOperationBatch(document, decision.plan.batch, { now: () => "2026-08-13T08:01:00.000Z" });

        expect(decideDesignImageTaskCommit(applied.document, task(), { x: 0, y: 0 })).toMatchObject({ kind: "replayed", affectedIds: expect.arrayContaining([decision.plan.elementId]) });
    });

    it("commits a background-removal task as an immutable derived version", () => {
        const document = createDesignDocumentFixture();
        const decision = decideDesignImageTaskCommit(
            document,
            task({
                id: "task-rembg-two",
                type: "image_process",
                kind: undefined,
                binding: { surface: "design", projectId: "design-product-campaign", baseRevision: 7, target: { scope: "frame", frameId: "frame-main" }, elementId: "element-product" },
                imageResult: { storageKey: "permanent/cutout.png", mimeType: "image/png", width: 1200, height: 800 },
            }),
            { x: 0, y: 0 },
        );

        expect(decision.kind).toBe("ready");
        if (decision.kind !== "ready") throw new Error("expected ready plan");
        const outcome = applyDesignOperationBatch(document, decision.plan.batch, { now: () => "2026-08-13T08:01:00.000Z" });
        expect(outcome.document.assetVersions.at(-1)).toMatchObject({
            parentVersionId: "asset-product-v2",
            provenance: { operation: "background-removal", sourceElementId: "element-product", generationTaskId: "task-rembg-two" },
        });
    });

    it("never attaches a late result to a replaced source version", () => {
        const document = createDesignDocumentFixture();
        const changed = {
            ...document,
            revision: 8,
            elements: document.elements.map((element) => (element.id === "element-product" && element.kind === "image" ? { ...element, assetVersionId: "asset-product-v1" } : element)),
        };

        expect(
            decideDesignImageTaskCommit(
                changed,
                task({ binding: { surface: "design", projectId: document.id, baseRevision: 7, target: { scope: "frame", frameId: "frame-main" }, elementId: "element-product", assetVersionId: "asset-product-v2" } }),
                { x: 0, y: 0 },
                8,
            ),
        ).toEqual({
            kind: "pending-placement",
            reason: "任务源图片版本已变化，旧结果不能写回",
            canPlace: false,
        });
    });

    it("does not resurrect a generated element that the user deleted", () => {
        const document = createDesignDocumentFixture();
        const decision = decideDesignImageTaskCommit(document, task(), { x: 0, y: 0 });
        if (decision.kind !== "ready") throw new Error("expected ready plan");
        const generated = applyDesignOperationBatch(document, decision.plan.batch, { now: () => "2026-08-13T08:01:00.000Z" }).document;
        const deleted = applyDesignOperationBatch(generated, {
            batchId: "batch-delete-result",
            expectedRevision: generated.revision,
            mode: "atomic",
            source: "ui",
            label: "删除生成元素",
            operations: [{ opId: "op-delete-result", type: "delete-elements", elementIds: [decision.plan.elementId] }],
        }).document;

        expect(decideDesignImageTaskCommit(deleted, task(), { x: 0, y: 0 })).toEqual({ kind: "replayed", affectedIds: [decision.plan.assetId, decision.plan.assetVersionId] });
    });
});
