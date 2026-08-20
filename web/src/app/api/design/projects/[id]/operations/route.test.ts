import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), apply: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/design-project-service", () => ({
    applyDesignOperationsForUser: mocks.apply,
    designProjectError: (error: unknown) => error,
    invalidDesignJsonError: () => Object.assign(new Error("请求 JSON 无效"), { status: 400 }),
}));

import { POST } from "./route";

describe("/api/design/projects/:id/operations", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one" });
    });

    it.each([
        ["applied", 200, 0],
        ["partial", 200, 0],
        ["rejected", 422, 422],
        ["conflict", 409, 409],
    ])("maps %s receipts to HTTP %i", async (status, httpStatus, code) => {
        mocks.apply.mockResolvedValue({ project: { id: "design-one", revision: 1 }, receipt: { status } });
        const response = await POST(new Request("http://localhost/api/design/projects/design-one/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batchId: "batch-one" }) }), {
            params: Promise.resolve({ id: "design-one" }),
        });
        expect(response.status).toBe(httpStatus);
        await expect(response.json()).resolves.toMatchObject({ code, data: { receipt: { status } } });
        expect(mocks.apply).toHaveBeenCalledWith("user-one", "design-one", { batchId: "batch-one" });
    });

    it.each([
        ["applied", 200, 0],
        ["partial", 200, 0],
        ["rejected", 422, 422],
        ["conflict", 409, 409],
    ])("preserves the original %s HTTP semantics on replay", async (originalStatus, httpStatus, code) => {
        mocks.apply.mockResolvedValue({ project: { id: "design-one", revision: 1 }, receipt: { status: "replayed", originalStatus } });
        const response = await POST(new Request("http://localhost/api/design/projects/design-one/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batchId: "batch-one" }) }), {
            params: Promise.resolve({ id: "design-one" }),
        });
        expect(response.status).toBe(httpStatus);
        await expect(response.json()).resolves.toMatchObject({ code, data: { receipt: { status: "replayed", originalStatus } } });
    });
});
