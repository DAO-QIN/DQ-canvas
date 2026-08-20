import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getLibraryAsset: vi.fn(), getLocalMediaRegistration: vi.fn() }));

vi.mock("@/lib/server/library-asset-store", () => ({ getLibraryAsset: mocks.getLibraryAsset }));
vi.mock("@/lib/server/local-media-registry", () => ({ getLocalMediaRegistration: mocks.getLocalMediaRegistration }));

import { resolveWorkspaceMediaResourceForUser, validateWorkspaceMediaResourceForUser, WorkspaceResourceResolutionError } from "./workspace-resource-resolver";

const registration = {
    storageKey: "permanent/user one/source.png",
    scope: "reference" as const,
    storageClass: "permanent" as const,
    type: "image" as const,
    ownerUserId: "user-one",
    source: "upload",
    mimeType: "image/png",
    bytes: 128,
    createdAt: "2026-08-13T00:00:00.000Z",
};

describe("Workspace media resource resolver", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getLibraryAsset.mockResolvedValue(null);
        mocks.getLocalMediaRegistration.mockResolvedValue(registration);
    });

    it("resolves an owned permanent locator to a runtime-only internal URL", async () => {
        const result = await resolveWorkspaceMediaResourceForUser("user-one", { kind: "storage-key", storageKey: registration.storageKey }, ["image"]);

        expect(result).toEqual({
            url: "/api/reference-assets/permanent/user%20one/source.png",
            cacheKey: `storage-key:${registration.storageKey}`,
            expiresAt: null,
            mediaType: "image",
        });
        expect(JSON.stringify(result)).not.toMatch(/ownerUserId|storageClass|signature/);
    });

    it("returns validated stable media metadata without a runtime URL", async () => {
        const result = await validateWorkspaceMediaResourceForUser("user-one", { kind: "storage-key", storageKey: registration.storageKey }, ["image"]);

        expect(result).toEqual({
            locator: { kind: "storage-key", storageKey: registration.storageKey },
            storageKey: registration.storageKey,
            scope: "reference",
            mediaType: "image",
            mimeType: "image/png",
            bytes: 128,
            createdAt: "2026-08-13T00:00:00.000Z",
        });
        expect(JSON.stringify(result)).not.toMatch(/(?:data|blob|https?):|url|ownerUserId|storageClass/i);
    });

    it("resolves a current-user library locator only through its permanent registration", async () => {
        mocks.getLibraryAsset.mockResolvedValue({ id: "asset-one", kind: "video", data: { storageKey: "permanent/source.mp4" } });
        mocks.getLocalMediaRegistration.mockResolvedValue({ ...registration, storageKey: "permanent/source.mp4", type: "video", mimeType: "video/mp4" });

        await expect(resolveWorkspaceMediaResourceForUser("user-one", { kind: "library-asset", libraryAssetId: "asset-one" }, ["image", "video"])).resolves.toMatchObject({
            url: "/api/reference-assets/permanent/source.mp4",
            cacheKey: "library-asset:asset-one",
            mediaType: "video",
        });
    });

    it.each([
        ["foreign owner", { ownerUserId: "user-two" }],
        ["temporary storage", { storageClass: "temporary" }],
        ["disallowed media type", { type: "video", mimeType: "video/mp4" }],
        ["mismatched key", { storageKey: "permanent/other.png" }],
    ])("hides %s behind 404", async (_label, patch) => {
        mocks.getLocalMediaRegistration.mockResolvedValue({ ...registration, ...patch });

        const error = await resolveWorkspaceMediaResourceForUser("user-one", { kind: "storage-key", storageKey: registration.storageKey }, ["image"]).catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(WorkspaceResourceResolutionError);
        expect(error).toMatchObject({ status: 404 });
    });

    it.each([
        { kind: "storage-key", storageKey: "temporary/source.png" },
        { kind: "storage-key", storageKey: "https://example.test/source.png" },
        { kind: "storage-key", storageKey: "data:image/png;base64,AAAA" },
        { kind: "storage-key", storageKey: "blob:runtime" },
        { kind: "storage-key", storageKey: "permanent/../private.png" },
        { kind: "library-asset", libraryAssetId: "bad/id" },
        { kind: "remote", url: "https://example.test/source.png" },
    ])("rejects an unstable locator before registry access", async (locator) => {
        const error = await resolveWorkspaceMediaResourceForUser("user-one", locator, ["image"]).catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(WorkspaceResourceResolutionError);
        expect(error).toMatchObject({ status: 400 });
        expect(mocks.getLocalMediaRegistration).not.toHaveBeenCalled();
    });
});
