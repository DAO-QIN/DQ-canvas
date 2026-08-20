import { describe, expect, it, vi } from "vitest";

import { buildDesignContext } from "./context";
import { createDesignDocumentFixture } from "./design.test-fixture";
import { createDesignFrameExportBatchPlan, createDesignFrameExportPlan, designExportFileName } from "./export";
import { designResourceCacheKey, resolveDesignAssetVersion } from "./resources";

describe("Design read boundaries", () => {
    it("builds a frame-only export plan in layer order", () => {
        const plan = createDesignFrameExportPlan(createDesignDocumentFixture(), "frame-main");
        expect(plan).toMatchObject({ documentId: "design-product-campaign", documentRevision: 7, format: "png", mimeType: "image/png", fileName: "Amazon 主图.png", scale: 2, quality: 1, pixelWidth: 4000, pixelHeight: 4000 });
        expect(plan.elements.map((item) => item.id)).toEqual(["element-product", "element-line", "element-title", "element-arrow"]);
        expect(plan.assetVersions.map((item) => item.id)).toEqual(["asset-product-v2"]);
        expect(plan.elements.some((item) => item.frameId === null || item.frameId === "frame-social" || item.hidden)).toBe(false);
    });

    it("plans WebP and collision-safe batch exports without changing frame order", () => {
        const document = createDesignDocumentFixture();
        document.frames[1].name = document.frames[0].name;
        const plans = createDesignFrameExportBatchPlan(document, [
            { frameId: "frame-main", options: { format: "webp", scale: 1, background: "transparent", quality: 0.8 } },
            { frameId: "frame-social", options: { format: "webp", scale: 2, background: "white", quality: 0.7 } },
        ]);

        expect(plans.map((plan) => ({ id: plan.frame.id, fileName: plan.fileName, mimeType: plan.mimeType, pixelWidth: plan.pixelWidth }))).toEqual([
            { id: "frame-main", fileName: "Amazon 主图.webp", mimeType: "image/webp", pixelWidth: 2000 },
            { id: "frame-social", fileName: "Amazon 主图-2.webp", mimeType: "image/webp", pixelWidth: 2160 },
        ]);
    });

    it("rejects empty, duplicate and invalid export requests and sanitizes file names", () => {
        const document = createDesignDocumentFixture();
        expect(() => createDesignFrameExportBatchPlan(document, [])).toThrow("至少选择一个 Frame");
        expect(() => createDesignFrameExportBatchPlan(document, [{ frameId: "frame-main" }, { frameId: "frame-main" }])).toThrow("Frame 重复");
        expect(() => createDesignFrameExportPlan(document, "frame-main", { format: "jpeg", background: "transparent" })).toThrow("JPEG 导出不支持透明背景");
        expect(designExportFileName("  ../商品:主图?.  ", "png")).toBe("-商品-主图-.png");
    });

    it("prioritizes selected and viewport elements under a context budget", () => {
        const context = buildDesignContext(createDesignDocumentFixture(), {
            selectedElementIds: ["element-social-product", "element-missing"],
            activeFrameId: "frame-main",
            viewport: { x: 90, y: 190, width: 2100, height: 2100, zoom: 0.25 },
            maxElements: 3,
            maxTextCharacters: 100,
        });
        expect(context.selectedElementIds).toEqual(["element-social-product"]);
        expect(context.elements.map((item) => item.id)).toEqual(["element-social-product", "element-product", "element-title"]);
        expect(context).toMatchObject({ truncated: true, omittedElementCount: 3, textCharacters: 17 });
        expect(context.assetVersions.map((item) => item.id)).toEqual(["asset-product-v1", "asset-product-v2"]);
        expect(context.annotations.map((item) => item.id)).toEqual(["annotation-product"]);
    });

    it("retains a selected text element while truncating its text to the context budget", () => {
        const context = buildDesignContext(createDesignDocumentFixture(), { selectedElementIds: ["element-title"], activeFrameId: "frame-main", viewport: { x: 0, y: 0, width: 10, height: 10, zoom: 1 }, maxElements: 1, maxTextCharacters: 5 });
        expect(context.elements).toMatchObject([{ id: "element-title", kind: "text", text: "DQ Bo" }]);
        expect(context).toMatchObject({ textCharacters: 5, truncated: true, truncatedTextElementIds: ["element-title"] });
    });

    it("keeps resolved URLs in the runtime resolver result only", async () => {
        const document = createDesignDocumentFixture();
        const version = document.assetVersions[0];
        const resolver = vi.fn(async () => ({ url: "/api/reference-assets/users/user-one/design/product-original.png?expires=123&signature=runtime", expiresAt: "2026-08-11T10:00:00.000Z", cacheKey: "runtime-cache" }));
        const resolved = await resolveDesignAssetVersion(version, resolver, "export");
        expect(resolved.url).toContain("signature=runtime");
        expect(resolver).toHaveBeenCalledWith(version.locator, { purpose: "export" });
        expect(JSON.stringify(document)).not.toContain("signature=runtime");
        expect(designResourceCacheKey(version.locator)).toBe("storage-key:users/user-one/design/product-original.png");
    });
});
