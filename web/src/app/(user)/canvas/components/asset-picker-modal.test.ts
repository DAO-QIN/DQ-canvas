import { describe, expect, it } from "vitest";

import type { LibraryAssetSelection } from "@/components/creative-workspace";
import type { Asset } from "@/lib/library-asset-contract";

import { canvasInsertPayload } from "./asset-picker-modal";

describe("Canvas library asset adapter", () => {
    it("preserves the existing image node payload while selection uses a stable locator", () => {
        const asset = {
            id: "asset-one",
            kind: "image",
            title: "Image",
            coverUrl: "",
            tags: [],
            createdAt: "2026-08-12T00:00:00.000Z",
            updatedAt: "2026-08-12T00:00:00.000Z",
            data: { dataUrl: "/api/reference-assets/source.png", storageKey: "permanent/source.png", width: 640, height: 480, bytes: 1, mimeType: "image/png" },
        } satisfies Asset;
        const selection = { locator: { kind: "library-asset", libraryAssetId: asset.id }, asset } satisfies LibraryAssetSelection;

        expect(canvasInsertPayload(selection)).toEqual({ kind: "image", dataUrl: "/api/reference-assets/source.png", storageKey: "permanent/source.png", remoteUrl: undefined, serverUrl: undefined, title: "Image" });
    });
});
