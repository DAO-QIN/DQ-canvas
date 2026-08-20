import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), deleteLibraryAssetForUser: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/library-asset-service", () => ({
    LibraryAssetServiceError: class LibraryAssetServiceError extends Error {
        constructor(
            message: string,
            readonly status: number,
        ) {
            super(message);
        }
    },
    deleteLibraryAssetForUser: mocks.deleteLibraryAssetForUser,
    updateLibraryAssetForUser: vi.fn(),
}));

import { DELETE } from "./route";

describe("DELETE /api/library-assets/[id]", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one" });
    });

    it("preserves the 409 reference conflict returned by the deletion service", async () => {
        const { LibraryAssetServiceError } = await import("@/lib/server/library-asset-service");
        mocks.deleteLibraryAssetForUser.mockRejectedValue(new LibraryAssetServiceError("素材仍被 1 个画板或历史版本引用", 409));

        const response = await DELETE(new Request("http://localhost/api/library-assets/asset-one", { method: "DELETE" }), {
            params: Promise.resolve({ id: "asset-one" }),
        });

        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ code: 409, data: null, msg: "素材仍被 1 个画板或历史版本引用" });
    });

    it("requires authentication before touching storage", async () => {
        mocks.getCurrentUser.mockResolvedValue(null);

        const response = await DELETE(new Request("http://localhost/api/library-assets/asset-one", { method: "DELETE" }), {
            params: Promise.resolve({ id: "asset-one" }),
        });

        expect(response.status).toBe(401);
        expect(mocks.deleteLibraryAssetForUser).not.toHaveBeenCalled();
    });
});
