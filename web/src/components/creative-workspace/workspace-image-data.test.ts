import { describe, expect, it } from "vitest";

import { resolveWorkspaceImageDimensions, resolveWorkspaceUpscaleSize } from "./workspace-image-data";

describe("workspace image dimensions", () => {
    it("prefers immutable source dimensions over a decoded preview variant", () => {
        expect(resolveWorkspaceImageDimensions({ width: 1600, height: 870 }, { width: 2335, height: 1270 })).toEqual({ width: 2335, height: 1270 });
    });

    it("uses decoded dimensions when no authoritative metadata is available", () => {
        expect(resolveWorkspaceImageDimensions({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
        expect(resolveWorkspaceImageDimensions(null, { width: 0, height: 600 })).toBeNull();
    });

    it("preserves aspect ratio when selecting the next available upscale target", () => {
        expect(resolveWorkspaceUpscaleSize(2335, 1270, 4096)).toEqual({ width: 4096, height: 2228 });
    });
});
