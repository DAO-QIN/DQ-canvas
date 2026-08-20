import { describe, expect, it } from "vitest";

import { canonicalDesignPocDocument, designPocDocumentsEqual, normalizeDesignPocDocument } from "./document";
import { createDesignPocFixture, createPerformanceDesignPocFixture, createVisualProbeDesignPocFixture, DESIGN_POC_INVALID_OPERATIONS, DESIGN_POC_OPERATION_SEQUENCE } from "./fixture";
import { applyDesignPocOperations } from "./operations";

describe("Design engine PoC contract", () => {
    it("creates the same four product frames and stable resource references", () => {
        const fixture = createDesignPocFixture();
        expect(fixture.frames.map((frame) => [frame.id, frame.width, frame.height])).toEqual([
            ["frame-amazon-main", 2000, 2000],
            ["frame-amazon-aplus", 1464, 600],
            ["frame-social-feed", 1080, 1350],
            ["frame-social-story", 1080, 1920],
        ]);
        expect(fixture.elements).toHaveLength(28);
        expect(fixture.assets.every((asset) => asset.src.startsWith("/design-poc/") && !asset.src.startsWith("data:"))).toBe(true);
        expect(normalizeDesignPocDocument(fixture)).toEqual(fixture);
    });

    it("applies the seven common operations without changing source asset references", () => {
        const fixture = createDesignPocFixture();
        const outcome = applyDesignPocOperations(fixture, DESIGN_POC_OPERATION_SEQUENCE);
        expect(outcome.receipt.status).toBe("applied");
        expect(outcome.receipt.appliedOperationIds).toHaveLength(7);
        expect(outcome.receipt.createdElementIds).toEqual(["element-feed-product-copy", "element-feed-title-copy"]);
        expect(outcome.document.assets).toEqual(fixture.assets);
        expect(outcome.document.elements).toHaveLength(30);
        const background = outcome.document.elements.find((element) => element.id === "element-main-background");
        expect(background?.kind).toBe("image");
        expect(background?.kind === "image" ? background.crop : undefined).toEqual({ x: 0.125, y: 0.1, width: 0.75, height: 0.8 });
    });

    it("rejects unknown ids and type mismatches without mutating the document", () => {
        const fixture = createDesignPocFixture();
        const outcome = applyDesignPocOperations(fixture, DESIGN_POC_INVALID_OPERATIONS);
        expect(outcome.receipt.status).toBe("rejected");
        expect(outcome.receipt.errors.map((error) => error.code)).toEqual(["ELEMENT_NOT_FOUND", "TYPE_MISMATCH", "FRAME_NOT_FOUND"]);
        expect(designPocDocumentsEqual(outcome.document, fixture)).toBe(true);
    });

    it("canonicalizes list order but keeps semantic geometry strict", () => {
        const fixture = createDesignPocFixture();
        const reordered = { ...fixture, frames: fixture.frames.toReversed(), assets: fixture.assets.toReversed(), elements: fixture.elements.toReversed() };
        expect(canonicalDesignPocDocument(reordered)).toEqual(canonicalDesignPocDocument(fixture));
        expect(designPocDocumentsEqual(reordered, fixture)).toBe(true);
        reordered.elements[0] = { ...reordered.elements[0], x: reordered.elements[0].x + 1 };
        expect(designPocDocumentsEqual(reordered, fixture)).toBe(false);
    });

    it("removes sub-millipixel floating-point noise without hiding visible geometry changes", () => {
        const fixture = createDesignPocFixture();
        const noisy = structuredClone(fixture);
        noisy.elements[0].x += 0.1 + 0.2 - 0.3;
        expect(designPocDocumentsEqual(noisy, fixture)).toBe(true);

        noisy.elements[0].x += 0.001;
        expect(designPocDocumentsEqual(noisy, fixture)).toBe(false);
    });

    it("builds an exact 200-element performance fixture", () => {
        const fixture = createPerformanceDesignPocFixture();
        expect(fixture.elements).toHaveLength(200);
        expect(new Set(fixture.elements.map((element) => element.id)).size).toBe(200);
    });

    it("builds a deterministic crop and frame-clipping visual probe", () => {
        const probe = createVisualProbeDesignPocFixture();
        expect(probe.frames).toHaveLength(1);
        expect(probe.elements).toHaveLength(2);
        expect(probe.elements[0]).toMatchObject({ kind: "image", crop: { x: 0.125, y: 0.1, width: 0.75, height: 0.8 } });
        expect(probe.elements[1]).toMatchObject({ kind: "image", x: 1700, width: 600, crop: null });
    });
});
