import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Asset } from "@/lib/library-asset-contract";

const mocks = vi.hoisted(() => ({ getLibraryAsset: vi.fn(), deleteLibraryAsset: vi.fn(), findDesignLibraryAssetReferences: vi.fn(), deleteUserLocalMediaAssets: vi.fn() }));

vi.mock("@/lib/server/library-asset-store", () => ({
    createLibraryAsset: vi.fn(),
    deleteLibraryAsset: mocks.deleteLibraryAsset,
    getLibraryAsset: mocks.getLibraryAsset,
    listLibraryAssetPage: vi.fn(),
    listLibraryAssets: vi.fn(),
    updateLibraryAsset: vi.fn(),
}));
vi.mock("@/lib/server/design-resource-references", () => ({ findDesignLibraryAssetReferences: mocks.findDesignLibraryAssetReferences }));
vi.mock("@/lib/server/local-media-storage", () => ({ deleteUserLocalMediaAssets: mocks.deleteUserLocalMediaAssets }));

import { deleteLibraryAssetForUser } from "./library-asset-service";

describe("library asset deletion", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getLibraryAsset.mockResolvedValue(imageAsset());
        mocks.findDesignLibraryAssetReferences.mockResolvedValue([]);
        mocks.deleteLibraryAsset.mockResolvedValue(true);
        mocks.deleteUserLocalMediaAssets.mockResolvedValue({ deletedFiles: 1, deletedBytes: 10, blocked: [] });
    });

    it("fails closed before deleting the record or media when Design references the asset", async () => {
        mocks.findDesignLibraryAssetReferences.mockResolvedValue([{ entityType: "version", entityId: "version-one", projectId: "design-one", snapshotRevision: 1, assetVersionIds: ["asset-v1"], elementIds: ["element-one"] }]);

        await expect(deleteLibraryAssetForUser("user-one", "asset-one")).rejects.toMatchObject({ status: 409, message: "素材仍被 1 个画板或历史版本引用" });
        expect(mocks.deleteLibraryAsset).not.toHaveBeenCalled();
        expect(mocks.deleteUserLocalMediaAssets).not.toHaveBeenCalled();
    });

    it("deletes the owned record before attempting storage reclamation", async () => {
        await deleteLibraryAssetForUser("user-one", " asset-one ");

        expect(mocks.getLibraryAsset).toHaveBeenCalledWith("user-one", "asset-one");
        expect(mocks.findDesignLibraryAssetReferences).toHaveBeenCalledWith("user-one", "asset-one");
        expect(mocks.deleteLibraryAsset).toHaveBeenCalledWith("user-one", "asset-one");
        expect(mocks.deleteUserLocalMediaAssets).toHaveBeenCalledWith("user-one", ["permanent/source.png"]);
        expect(mocks.deleteLibraryAsset.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteUserLocalMediaAssets.mock.invocationCallOrder[0]);
    });

    it("does not touch storage when ownership disappeared before the record delete", async () => {
        mocks.deleteLibraryAsset.mockResolvedValue(false);

        await expect(deleteLibraryAssetForUser("user-one", "asset-one")).rejects.toMatchObject({ status: 404 });
        expect(mocks.deleteUserLocalMediaAssets).not.toHaveBeenCalled();
    });
});

function imageAsset(): Asset {
    return {
        id: "asset-one",
        kind: "image",
        title: "素材",
        coverUrl: "",
        tags: [],
        data: {
            dataUrl: "/api/reference-assets/permanent/source.png",
            serverUrl: "/api/reference-assets/permanent/source.png",
            storageKey: "permanent/source.png",
            width: 10,
            height: 10,
            bytes: 10,
            mimeType: "image/png",
        },
        createdAt: "2026-08-12T00:00:00.000Z",
        updatedAt: "2026-08-12T00:00:00.000Z",
    };
}
