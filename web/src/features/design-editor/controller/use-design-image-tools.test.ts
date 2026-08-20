import { describe, expect, it } from "vitest";

import type { CreativeWorkspaceGenerationTask } from "@/lib/creative-workspace";
import { createDesignDocumentFixture } from "@/lib/design/design.test-fixture";

import { imageToolBinding, isDesignMaskEditTask, selectedImageSnapshot } from "./use-design-image-tools";

describe("Design image tool source boundary", () => {
    it("captures the selected element and immutable asset version", () => {
        const document = createDesignDocumentFixture();

        const snapshot = selectedImageSnapshot(document, { kind: "elements", ids: ["element-product"] });

        expect(snapshot).toMatchObject({
            elementId: "element-product",
            assetVersionId: "asset-product-v2",
            locator: { kind: "library-asset", libraryAssetId: "library-product-cutout" },
            crop: { x: 0.125, y: 0.1, width: 0.75, height: 0.8 },
        });
        expect(selectedImageSnapshot(document, { kind: "elements", ids: ["element-product", "element-title"] })).toBeNull();
        expect(selectedImageSnapshot(document, { kind: "elements", ids: ["element-title"] })).toBeNull();
    });

    it("binds AI work to element and asset version and rejects a stale snapshot", () => {
        const document = createDesignDocumentFixture();
        const snapshot = selectedImageSnapshot(document, { kind: "elements", ids: ["element-product"] })!;

        expect(imageToolBinding(document, snapshot, "design-one")).toEqual({
            surface: "design",
            projectId: "design-one",
            baseRevision: 7,
            target: { scope: "frame", frameId: "frame-main" },
            elementId: "element-product",
            assetVersionId: "asset-product-v2",
        });

        const changed = structuredClone(document);
        const element = changed.elements.find((candidate) => candidate.id === "element-product");
        if (element?.kind === "image") element.assetVersionId = "asset-product-v1";
        expect(() => imageToolBinding(changed, snapshot, "design-one")).toThrow("源图片已删除或版本已变化");
    });

    it("identifies mask tasks by their stable client request namespace", () => {
        const task = (clientRequestId?: string): CreativeWorkspaceGenerationTask => ({
            id: "task-one",
            type: "image",
            status: "failed",
            clientRequestId,
            createdAt: 1,
            updatedAt: 2,
        });

        expect(isDesignMaskEditTask(task("design-mask-request-one"))).toBe(true);
        expect(isDesignMaskEditTask(task("design-image-request-one"))).toBe(false);
        expect(isDesignMaskEditTask({ ...task("design-mask-request-one"), type: "image_process" })).toBe(false);
    });
});
