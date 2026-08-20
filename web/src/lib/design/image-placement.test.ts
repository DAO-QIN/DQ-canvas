import { describe, expect, it } from "vitest";

import { createDesignDocumentFixture } from "./design.test-fixture";
import { fitImageSize, resolveDesignImagePlacement } from "./image-placement";

describe("Design image placement", () => {
    it("places an unscoped image at the visible workspace center and fits large images", () => {
        const placement = resolveDesignImagePlacement(createDesignDocumentFixture(), null, { x: 900, y: 700 }, { width: 4000, height: 2000 });

        expect(placement).toEqual({ target: { scope: "workspace" }, position: { x: 580, y: 540 }, displaySize: { width: 640, height: 320 } });
    });

    it("centers an image inside an explicitly selected Frame using Frame-local coordinates", () => {
        const document = createDesignDocumentFixture();
        const frame = document.frames.find((candidate) => candidate.id === "frame-main")!;
        const placement = resolveDesignImagePlacement(document, { kind: "frame", id: frame.id }, { x: -999, y: -999 }, { width: 1200, height: 800 });

        expect(placement.target).toEqual({ scope: "frame", frameId: frame.id });
        expect(placement.displaySize.width).toBeLessThanOrEqual(640);
        expect(placement.position).toEqual({ x: Math.round((frame.width / 2 - placement.displaySize.width / 2) * 1000) / 1000, y: Math.round((frame.height / 2 - placement.displaySize.height / 2) * 1000) / 1000 });
    });

    it("uses a shared Frame for an element selection but falls back to workspace across scopes", () => {
        const document = createDesignDocumentFixture();
        const framed = document.elements.filter((element) => element.frameId === "frame-main").map((element) => element.id);
        expect(resolveDesignImagePlacement(document, { kind: "elements", ids: framed }, { x: 0, y: 0 }, { width: 100, height: 200 }).target).toEqual({ scope: "frame", frameId: "frame-main" });
        expect(resolveDesignImagePlacement(document, { kind: "elements", ids: [framed[0], "element-workspace-guide"] }, { x: 0, y: 0 }, { width: 100, height: 200 }).target).toEqual({ scope: "workspace" });
    });

    it("never upscales imported images and validates dimensions", () => {
        expect(fitImageSize(120, 80)).toEqual({ width: 120, height: 80 });
        expect(() => fitImageSize(0, 80)).toThrow("width 必须是正数");
    });
});
