import { describe, expect, it } from "vitest";

import { resolveWorkspaceFloatingPlacement } from "./workspace-floating-placement";

const viewport = { x: 100, y: 50, width: 800, height: 600 };

describe("resolveWorkspaceFloatingPlacement", () => {
    it("keeps the preferred bottom side when it fits", () => {
        expect(resolveWorkspaceFloatingPlacement({ anchor: { x: 350, y: 200, width: 200, height: 100 }, viewport, floatingSize: { width: 400, height: 120 }, preferredSide: "bottom" })).toMatchObject({ x: 250, y: 312, side: "bottom" });
    });

    it("flips above a selection when the preferred bottom side collides", () => {
        expect(resolveWorkspaceFloatingPlacement({ anchor: { x: 350, y: 560, width: 200, height: 60 }, viewport, floatingSize: { width: 420, height: 140 }, preferredSide: "bottom", gap: 10 })).toMatchObject({ x: 240, y: 410, side: "top" });
    });

    it("flips below a selection when the preferred top side collides", () => {
        expect(resolveWorkspaceFloatingPlacement({ anchor: { x: 120, y: 62, width: 80, height: 50 }, viewport, floatingSize: { width: 360, height: 46 }, preferredSide: "top", gap: 10 })).toMatchObject({ x: 112, y: 122, side: "bottom" });
    });

    it("clamps oversized and edge-adjacent panels inside an offset viewport", () => {
        const placement = resolveWorkspaceFloatingPlacement({
            anchor: { x: 890, y: 320, width: 20, height: 20 },
            viewport,
            floatingSize: { width: 2_000, height: 900 },
            preferredSide: "bottom",
            margin: 16,
        });

        expect(placement).toEqual({ x: 116, y: 66, side: "bottom", availableWidth: 768, availableHeight: 282 });
    });
});
