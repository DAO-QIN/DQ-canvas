import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getLibraryAsset: vi.fn(), getLocalMediaRegistration: vi.fn() }));

vi.mock("@/lib/server/library-asset-store", () => ({ getLibraryAsset: mocks.getLibraryAsset }));
vi.mock("@/lib/server/local-media-registry", () => ({ getLocalMediaRegistration: mocks.getLocalMediaRegistration }));

import { DesignResourceResolutionError, resolveDesignResourceForUser } from "./design-resource-resolver";

const referenceRegistration = {
    storageKey: "permanent/user one/product hero.png",
    scope: "reference" as const,
    storageClass: "permanent" as const,
    type: "image" as const,
    ownerUserId: "user-one",
    source: "upload",
    mimeType: "image/png",
    bytes: 128,
    createdAt: "2026-08-12T00:00:00.000Z",
};

describe("Design resource resolver", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getLibraryAsset.mockResolvedValue(null);
        mocks.getLocalMediaRegistration.mockResolvedValue(referenceRegistration);
    });

    it("resolves an owned permanent reference image to a runtime-only URL", async () => {
        const locator = { kind: "storage-key" as const, storageKey: referenceRegistration.storageKey };

        const result = await resolveDesignResourceForUser("user-one", locator);

        expect(result).toEqual({
            url: "/api/reference-assets/permanent/user%20one/product%20hero.png",
            cacheKey: `storage-key:${referenceRegistration.storageKey}`,
            expiresAt: null,
        });
        expect(Object.keys(result).sort()).toEqual(["cacheKey", "expiresAt", "url"]);
        expect(result).not.toHaveProperty("storageKey");
    });

    it("uses the authenticated generation asset route for generation images", async () => {
        mocks.getLocalMediaRegistration.mockResolvedValue({ ...referenceRegistration, storageKey: "permanent/result.png", scope: "generation" });

        await expect(resolveDesignResourceForUser("user-one", { kind: "storage-key", storageKey: "permanent/result.png" })).resolves.toEqual({
            url: "/api/generation-log-assets/permanent/result.png",
            cacheKey: "storage-key:permanent/result.png",
            expiresAt: null,
        });
    });

    it.each([
        ["foreign owner", { ownerUserId: "user-two" }],
        ["temporary image", { storageClass: "temporary" }],
        ["video", { type: "video" }],
        ["audio", { type: "audio" }],
    ])("hides an inaccessible %s registration behind 404", async (_label, patch) => {
        mocks.getLocalMediaRegistration.mockResolvedValue({ ...referenceRegistration, ...patch });

        const error = await resolveDesignResourceForUser("user-one", { kind: "storage-key", storageKey: referenceRegistration.storageKey }).catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(DesignResourceResolutionError);
        expect(error).toMatchObject({ status: 404 });
    });

    it("resolves an owned image library asset through its permanent registration", async () => {
        mocks.getLibraryAsset.mockResolvedValue({ id: "asset-one", kind: "image", data: { storageKey: referenceRegistration.storageKey } });

        const result = await resolveDesignResourceForUser("user-one", { kind: "library-asset", libraryAssetId: "asset-one" });

        expect(mocks.getLibraryAsset).toHaveBeenCalledWith("user-one", "asset-one");
        expect(mocks.getLocalMediaRegistration).toHaveBeenCalledWith(referenceRegistration.storageKey);
        expect(result).toEqual({
            url: "/api/reference-assets/permanent/user%20one/product%20hero.png",
            cacheKey: "library-asset:asset-one",
            expiresAt: null,
        });
        expect(result).not.toHaveProperty("asset");
    });

    it.each([
        ["missing or foreign asset", null],
        ["non-image asset", { id: "asset-one", kind: "video", data: { storageKey: referenceRegistration.storageKey } }],
        ["image without storageKey", { id: "asset-one", kind: "image", data: { dataUrl: "blob:runtime" } }],
        ["image with an unsafe storageKey", { id: "asset-one", kind: "image", data: { storageKey: "../private.png" } }],
    ])("hides a %s behind 404", async (_label, asset) => {
        mocks.getLibraryAsset.mockResolvedValue(asset);

        const error = await resolveDesignResourceForUser("user-one", { kind: "library-asset", libraryAssetId: "asset-one" }).catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(DesignResourceResolutionError);
        expect(error).toMatchObject({ status: 404 });
    });

    it.each([
        null,
        { kind: "storage-key", storageKey: "" },
        { kind: "storage-key", storageKey: "https://example.test/image.png" },
        { kind: "storage-key", storageKey: "data:image/png;base64,AAAA" },
        { kind: "storage-key", storageKey: "blob:runtime" },
        { kind: "storage-key", storageKey: "permanent/../private.png" },
        { kind: "storage-key", storageKey: "permanent/image.png", url: "/leak" },
        { kind: "library-asset", libraryAssetId: "bad/id" },
        { kind: "library-asset", libraryAssetId: "asset-one", storageKey: "permanent/image.png" },
        { kind: "remote", url: "https://example.test/image.png" },
    ])("rejects an invalid locator with 400", async (locator) => {
        const error = await resolveDesignResourceForUser("user-one", locator).catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(DesignResourceResolutionError);
        expect(error).toMatchObject({ status: 400 });
        expect(mocks.getLocalMediaRegistration).not.toHaveBeenCalled();
    });
});
