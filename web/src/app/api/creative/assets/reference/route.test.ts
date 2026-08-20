import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    referenceExistingAssetForUser: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/creative-runtime-service", () => ({
    CreativeRuntimeServiceError: class CreativeRuntimeServiceError extends Error {
        constructor(
            message: string,
            readonly status: number,
        ) {
            super(message);
        }
    },
    referenceExistingAssetForUser: mocks.referenceExistingAssetForUser,
}));

import { POST } from "./route";

describe("POST /api/creative/assets/reference", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one", role: "user" });
        mocks.referenceExistingAssetForUser.mockResolvedValue({ id: "asset-one", type: "image", serverUrl: "/api/generation-log-assets/result.png" });
    });

    it("requires authentication", async () => {
        mocks.getCurrentUser.mockResolvedValue(null);
        const response = await POST(request());

        expect(response.status).toBe(401);
        expect(mocks.referenceExistingAssetForUser).not.toHaveBeenCalled();
    });

    it("references the existing generated URL without an upload", async () => {
        const response = await POST(request());

        expect(response.status).toBe(200);
        expect(mocks.referenceExistingAssetForUser).toHaveBeenCalledWith("user-one", "user", "conversation-one", {
            id: "generation-one-0",
            type: "image",
            url: "/api/generation-log-assets/result.png",
            mimeType: "image/png",
            title: "生成结果",
        });
        expect(await response.json()).toMatchObject({ code: 0, data: { asset: { id: "asset-one" } } });
    });

    it("rejects incomplete reference data", async () => {
        const response = await POST(request({ id: "" }));

        expect(response.status).toBe(400);
        expect(mocks.referenceExistingAssetForUser).not.toHaveBeenCalled();
    });
});

function request(overrides: Record<string, unknown> = {}) {
    return new Request("http://localhost/api/creative/assets/reference", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            conversationId: "conversation-one",
            id: "generation-one-0",
            type: "image",
            url: "/api/generation-log-assets/result.png",
            mimeType: "image/png",
            title: "生成结果",
            ...overrides,
        }),
    });
}
