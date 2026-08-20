import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), resolve: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/design-resource-resolver", () => ({
    DesignResourceResolutionError: class DesignResourceResolutionError extends Error {
        constructor(
            message: string,
            readonly status: 400 | 404,
        ) {
            super(message);
            this.name = "DesignResourceResolutionError";
        }
    },
    resolveDesignResourceForUser: mocks.resolve,
}));

import { DesignResourceResolutionError } from "@/lib/server/design-resource-resolver";
import { POST } from "./route";

function request(body: unknown) {
    return new Request("http://localhost/api/design/resources/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("POST /api/design/resources/resolve", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one" });
        mocks.resolve.mockResolvedValue({ url: "/api/reference-assets/permanent/image.png", cacheKey: "storage-key:permanent/image.png", expiresAt: null });
    });

    it("requires authentication before parsing or resolving a resource", async () => {
        mocks.getCurrentUser.mockResolvedValue(null);

        const response = await POST(request({ locator: { kind: "storage-key", storageKey: "permanent/image.png" }, purpose: "editor" }));

        expect(response.status).toBe(401);
        expect(mocks.resolve).not.toHaveBeenCalled();
    });

    it("resolves through the current user boundary and returns runtime data", async () => {
        const locator = { kind: "storage-key", storageKey: "permanent/image.png" };

        const response = await POST(request({ locator, purpose: "thumbnail" }));

        expect(response.status).toBe(200);
        expect(mocks.resolve).toHaveBeenCalledWith("user-one", locator);
        expect(await response.json()).toEqual({
            code: 0,
            data: { url: "/api/reference-assets/permanent/image.png", cacheKey: "storage-key:permanent/image.png", expiresAt: null },
            msg: "OK",
        });
    });

    it("preserves known resolver status codes", async () => {
        mocks.resolve.mockRejectedValue(new DesignResourceResolutionError("画板图片资源不存在或无权访问", 404));

        const response = await POST(request({ locator: { kind: "library-asset", libraryAssetId: "asset-one" }, purpose: "export" }));

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ code: 404, data: null, msg: "画板图片资源不存在或无权访问" });
    });

    it("rejects malformed JSON", async () => {
        const response = await POST(
            new Request("http://localhost/api/design/resources/resolve", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{",
            }),
        );

        expect(response.status).toBe(400);
        expect(mocks.resolve).not.toHaveBeenCalled();
    });

    it.each([undefined, "preview", 1])("rejects an unsupported purpose: %s", async (purpose) => {
        const response = await POST(request({ locator: { kind: "storage-key", storageKey: "permanent/image.png" }, purpose }));

        expect(response.status).toBe(400);
        expect(mocks.resolve).not.toHaveBeenCalled();
    });

    it("rejects unknown request fields", async () => {
        const response = await POST(request({ locator: { kind: "storage-key", storageKey: "permanent/image.png" }, purpose: "editor", url: "https://example.test/leak" }));

        expect(response.status).toBe(400);
        expect(mocks.resolve).not.toHaveBeenCalled();
    });
});
