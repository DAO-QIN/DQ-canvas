import { describe, expect, it } from "vitest";

import { createDesignDocumentFixture } from "@/lib/design/design.test-fixture";

import { createDesignFrameExportPreferenceOperations, designViewportAfterZoom, sameDesignViewport } from "./use-design-editor-controller";

describe("Design editor viewport controller", () => {
    it("compares all persisted viewport coordinates", () => {
        const viewport = { x: 10, y: -20, zoom: 1.25 };
        expect(sameDesignViewport(viewport, { ...viewport })).toBe(true);
        expect(sameDesignViewport(viewport, { ...viewport, x: 11 })).toBe(false);
        expect(sameDesignViewport(viewport, { ...viewport, y: -19 })).toBe(false);
        expect(sameDesignViewport(viewport, { ...viewport, zoom: 1.5 })).toBe(false);
    });

    it("preserves pan, rounds zoom and enforces the Fabric viewport bounds", () => {
        const viewport = { x: 10, y: -20, zoom: 1.23456 };
        expect(designViewportAfterZoom(viewport, 1.2)).toEqual({ x: 10, y: -20, zoom: 1.481 });
        expect(designViewportAfterZoom(viewport, 100).zoom).toBe(8);
        expect(designViewportAfterZoom(viewport, 0).zoom).toBe(0.05);
    });

    it("persists export preferences only for editable Frames", () => {
        const document = createDesignDocumentFixture();
        document.frames[0].locked = true;

        expect(createDesignFrameExportPreferenceOperations(document, ["frame-main", "frame-social"], { format: "webp", scale: 3, background: "transparent", quality: 0.8 }, () => "preference")).toEqual([
            {
                opId: "op-preference",
                type: "update-frame",
                frameId: "frame-social",
                patch: { export: { format: "webp", scale: 3, background: "transparent", quality: 0.8 } },
            },
        ]);
    });
});
