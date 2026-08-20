import { describe, expect, it } from "vitest";

import { applyDesignOperationBatch } from "@/lib/design";
import { createDesignDocumentFixture } from "@/lib/design/design.test-fixture";

import { appendDesignImageAnnotationsToPrompt, createDesignDerivedImagePlan, createDesignImageAnnotationOperation, createDesignImageCropOperation, sameDesignImageSource, selectedDesignImage } from "./design-image-tools";

describe("Design image tools", () => {
    it("selects exactly one image with its immutable asset version", () => {
        const document = createDesignDocumentFixture();
        expect(selectedDesignImage(document, { kind: "elements", ids: ["element-product"] })?.version.id).toBe("asset-product-v2");
        expect(selectedDesignImage(document, { kind: "elements", ids: ["element-product", "element-title"] })).toBeNull();
        expect(selectedDesignImage(document, { kind: "elements", ids: ["element-title"] })).toBeNull();
    });

    it("normalizes crop and annotation regions before dispatch", () => {
        expect(createDesignImageCropOperation("element-product", { x: -1, y: 0.9999, width: 5, height: 2 })).toMatchObject({
            type: "set-image-crop",
            crop: { x: 0, y: 0.999, width: 1, height: 0.001 },
        });
        expect(createDesignImageAnnotationOperation("element-product", { text: "  替换瓶盖  ", region: { x: 0.12345, y: 0.2, width: 0.3, height: 0.4 } }, "2026-08-14T00:00:00.000Z")).toMatchObject({
            type: "add-annotation",
            annotation: { text: "替换瓶盖", target: { kind: "element", elementId: "element-product", region: { x: 0.123, y: 0.2, width: 0.3, height: 0.4 } } },
        });
    });

    it("appends all unresolved image annotations to an edit prompt", () => {
        const document = createDesignDocumentFixture();
        const prompt = appendDesignImageAnnotationsToPrompt(document, "element-product", "改成夜景");
        expect(prompt).toContain("改成夜景");
        expect(prompt).toContain("保持瓶身商标清晰");
        expect(prompt).toContain("区域 x=25%");
        expect(prompt).not.toContain("检查安全区");
    });

    it("creates a local upscale sibling with null task provenance and rejects a changed source", () => {
        const document = createDesignDocumentFixture();
        const plan = createDesignDerivedImagePlan({
            document,
            sourceElementId: "element-product",
            requestId: "upscale-element-product-v2-2x",
            generationTaskId: null,
            image: { storageKey: "permanent/upscale.png", mimeType: "image/png", width: 2400, height: 1600 },
            operation: "upscale",
            name: "放大结果",
            sceneCenter: { x: 0, y: 0 },
            createdAt: "2026-08-14T00:00:00.000Z",
        });
        const outcome = applyDesignOperationBatch(document, plan.batch);
        expect(outcome.document.assetVersions.at(-1)).toMatchObject({ parentVersionId: "asset-product-v2", provenance: { generationTaskId: null, operation: "upscale" } });
        expect(sameDesignImageSource(document, "element-product", "asset-product-v2")).toBe(true);
        expect(sameDesignImageSource(document, "element-product", "asset-product-v1")).toBe(false);
    });
});
