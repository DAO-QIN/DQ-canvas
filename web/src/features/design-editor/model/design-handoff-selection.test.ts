import { describe, expect, it } from "vitest";

import { createDesignDocumentFixture } from "@/lib/design/design.test-fixture";

import { designHandoffSelectionIds } from "./design-handoff-selection";

describe("Design Handoff selection projection", () => {
    const document = createDesignDocumentFixture();

    it("keeps image elements and drops non-image elements", () => {
        expect(designHandoffSelectionIds(document, { kind: "elements", ids: ["element-title", "element-product", "element-line"] })).toEqual(["element-product"]);
        expect(designHandoffSelectionIds(document, { kind: "elements", ids: ["element-title", "element-line"] })).toEqual([]);
    });

    it("keeps a frame only when its frame layer contains an image", () => {
        expect(designHandoffSelectionIds(document, { kind: "frame", id: "frame-social" })).toEqual(["frame-social"]);
        expect(designHandoffSelectionIds(document, { kind: "frame", id: "frame-main" })).toEqual(["frame-main"]);
        expect(designHandoffSelectionIds(document, { kind: "frame", id: "missing-frame" })).toEqual([]);
    });
});
