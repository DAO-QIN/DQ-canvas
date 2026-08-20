import { describe, expect, it } from "vitest";

import type { Asset } from "@/lib/library-asset-contract";

import { libraryAssetSelection } from "./library-asset-picker";

describe("LibraryAssetPicker contract", () => {
    it("returns a stable library locator while keeping preview data runtime-only", () => {
        const asset = {
            id: "asset-one",
            kind: "image",
            title: "Source",
            coverUrl: "data:image/png;base64,preview",
            tags: [],
            createdAt: "2026-08-12T00:00:00.000Z",
            updatedAt: "2026-08-12T00:00:00.000Z",
            data: { dataUrl: "blob:runtime-only", storageKey: "permanent/source.png", width: 64, height: 32, bytes: 10, mimeType: "image/png" },
        } satisfies Asset;

        const selection = libraryAssetSelection(asset);

        expect(selection.locator).toEqual({ kind: "library-asset", libraryAssetId: "asset-one" });
        expect(selection.locator).not.toHaveProperty("url");
        expect(selection.locator).not.toHaveProperty("dataUrl");
        expect(selection.asset).toBe(asset);
        expect(Object.isFrozen(selection)).toBe(true);
        expect(Object.isFrozen(selection.locator)).toBe(true);
    });
});
