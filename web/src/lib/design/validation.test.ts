import { describe, expect, it } from "vitest";

import { DESIGN_LIMITS } from "./limits";
import { migrateDesignDocument, serializeDesignDocument } from "./migration";
import { createDesignDocumentFixture } from "./design.test-fixture";
import { DesignDocumentValidationError, parseDesignDocumentV1, safeParseDesignDocumentV1 } from "./validation";

describe("Design Document validation and migration", () => {
    it("strictly normalizes the current schema and round-trips it", () => {
        const document = createDesignDocumentFixture();
        expect(document.workspace.viewport.x).toBe(10);
        expect(document.elements.find((item) => item.id === "element-product")?.transform.x).toBe(200);
        expect(migrateDesignDocument(JSON.parse(serializeDesignDocument(document)))).toEqual({ document, sourceVersion: 1, targetVersion: 1, steps: [] });
    });

    it.each([
        ["unknown root field", (document: Record<string, unknown>) => Object.assign(document, { fabricObjects: [] }), "UNKNOWN_FIELD", "$.fabricObjects"],
        ["future version", (document: Record<string, unknown>) => Object.assign(document, { schemaVersion: 2 }), "UNSUPPORTED_VERSION", "$.schemaVersion"],
        [
            "runtime resource URL",
            (document: Record<string, unknown>) => {
                ((document.assetVersions as Array<Record<string, unknown>>)[0].locator as Record<string, unknown>).storageKey = "https://cdn.example.com/a.png?expires=1&signature=x";
            },
            "UNSAFE_RESOURCE",
            "$.assetVersions[0].locator.storageKey",
        ],
        ["unknown nested element field", (document: Record<string, unknown>) => Object.assign((document.elements as Array<Record<string, unknown>>)[0], { cacheKey: "fabric-runtime" }), "UNKNOWN_FIELD", "$.elements[0].cacheKey"],
        ["invalid crop", (document: Record<string, unknown>) => Object.assign((document.elements as Array<Record<string, unknown>>)[1].crop as Record<string, unknown>, { x: 0.8, width: 0.5 }), "INVALID_VALUE", "$.elements[1].crop"],
        ["dangling frame", (document: Record<string, unknown>) => Object.assign((document.elements as Array<Record<string, unknown>>)[1], { frameId: "frame-missing" }), "MISSING_REFERENCE", "$.elements[1].frameId"],
        [
            "missing layer entry",
            (document: Record<string, unknown>) => {
                ((document.layers as Array<Record<string, unknown>>)[1].elementIds as string[]).shift();
            },
            "INVALID_LAYER",
            "$.layers",
        ],
    ])("rejects %s", (_label, mutate, code, path) => {
        const value = structuredClone(createDesignDocumentFixture()) as unknown as Record<string, unknown>;
        mutate(value);
        const result = safeParseDesignDocumentV1(value);
        expect(result).toEqual({ success: false, issues: [expect.objectContaining({ code, path })] });
    });

    it("rejects duplicate ids and cyclic asset ancestry", () => {
        const duplicate = structuredClone(createDesignDocumentFixture());
        duplicate.elements[1].id = duplicate.elements[0].id;
        expect(() => parseDesignDocumentV1(duplicate)).toThrow("元素 ID 重复");

        const cyclic = structuredClone(createDesignDocumentFixture());
        cyclic.assetVersions[0].parentVersionId = "asset-product-v2";
        expect(() => parseDesignDocumentV1(cyclic)).toThrow("父链存在循环");
    });

    it("keeps immutable asset provenance readable after its source element is deleted", () => {
        const document = structuredClone(createDesignDocumentFixture());
        document.elements = document.elements.filter((item) => item.id !== "element-product");
        const mainLayer = document.layers.find((item) => item.scope === "frame" && item.frameId === "frame-main");
        if (mainLayer) mainLayer.elementIds = mainLayer.elementIds.filter((id) => id !== "element-product");
        document.annotations = document.annotations.filter((item) => item.target.kind !== "element" || item.target.elementId !== "element-product");
        expect(parseDesignDocumentV1(document).assetVersions[1].provenance.sourceElementId).toBe("element-product");
    });

    it("rejects ambiguous asset roots, unsafe storage keys, non-UTC dates, and transparent JPEG defaults", () => {
        const extraRoot = structuredClone(createDesignDocumentFixture());
        extraRoot.assetVersions[1].parentVersionId = null;
        expect(() => parseDesignDocumentV1(extraRoot)).toThrow("只能有一个根版本");

        const unsafe = structuredClone(createDesignDocumentFixture());
        const locator = unsafe.assetVersions[0].locator;
        if (locator.kind === "storage-key") locator.storageKey = "/absolute/product.png";
        expect(() => parseDesignDocumentV1(unsafe)).toThrow("不能保存 URL");

        const localDate = structuredClone(createDesignDocumentFixture());
        localDate.metadata.updatedAt = "2026-08-11T17:00:00+08:00";
        expect(() => parseDesignDocumentV1(localDate)).toThrow("UTC ISO");

        const transparentJpeg = structuredClone(createDesignDocumentFixture());
        transparentJpeg.frames[0].export = { format: "jpeg", scale: 1, quality: 0.9, background: "transparent" };
        expect(() => parseDesignDocumentV1(transparentJpeg)).toThrow("JPEG 导出不支持透明背景");

        const transparentWebp = structuredClone(createDesignDocumentFixture());
        transparentWebp.frames[0].export = { format: "webp", scale: 1, quality: 0.85, background: "transparent" };
        expect(parseDesignDocumentV1(transparentWebp).frames[0].export).toEqual(transparentWebp.frames[0].export);
    });

    it("rejects the document-size and collection limits", () => {
        const tooMany = structuredClone(createDesignDocumentFixture()) as unknown as Record<string, unknown>;
        tooMany.frames = Array.from({ length: DESIGN_LIMITS.maxFrames + 1 }, (_, index) => ({ id: `frame-${index}`, name: "x" }));
        expect(() => parseDesignDocumentV1(tooMany)).toThrow(DesignDocumentValidationError);
        expect(() => parseDesignDocumentV1(tooMany)).toThrow("数组长度");

        const tooLarge = structuredClone(createDesignDocumentFixture()) as unknown as Record<string, unknown>;
        (tooLarge.metadata as Record<string, unknown>).description = "a".repeat(DESIGN_LIMITS.maxDocumentBytes + 1);
        expect(() => parseDesignDocumentV1(tooLarge)).toThrow("文档不得超过");
    });

    it("round-trips the maximum supported element count without changing semantics", () => {
        const document = structuredClone(createDesignDocumentFixture());
        const seed = document.elements.find((item) => item.kind === "shape" && item.frameId === null);
        if (!seed || seed.kind !== "shape") throw new Error("夹具缺少 Workspace 图形种子");
        document.elements = Array.from({ length: DESIGN_LIMITS.maxElements }, (_, index) => ({
            ...structuredClone(seed),
            id: `element-stress-${String(index).padStart(4, "0")}`,
            name: `Stress ${index}`,
            transform: { ...seed.transform, x: index % 100, y: Math.floor(index / 100) },
        }));
        document.layers = [{ scope: "workspace", elementIds: document.elements.map((item) => item.id) }, ...document.frames.map((item) => ({ scope: "frame" as const, frameId: item.id, elementIds: [] }))];
        document.annotations = [];
        const parsed = parseDesignDocumentV1(document);
        expect(parsed.elements).toHaveLength(DESIGN_LIMITS.maxElements);
        expect(parseDesignDocumentV1(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    });
});
