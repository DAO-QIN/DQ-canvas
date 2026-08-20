import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), getProject: vi.fn(), updateProject: vi.fn(), canvasProjectError: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/canvas-project-service", () => ({
    canvasProjectError: mocks.canvasProjectError,
    getCanvasProjectForUser: mocks.getProject,
    updateCanvasProjectForUser: mocks.updateProject,
}));

import { GET, PATCH } from "./route";

describe("canvas project detail route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one" });
        mocks.getProject.mockResolvedValue({ id: "canvas-one", nodes: [], connections: [] });
    });

    it("loads one owned project detail", async () => {
        const response = await GET(new Request("http://localhost/api/canvas/projects/canvas-one"), { params: Promise.resolve({ id: "canvas-one" }) });

        expect(mocks.getProject).toHaveBeenCalledWith("user-one", "canvas-one");
        expect(await response.json()).toEqual({ code: 0, data: { project: { id: "canvas-one", nodes: [], connections: [] } }, msg: "OK" });
    });

    it("returns a structured receipt when a save conflicts", async () => {
        const receipt = { projectId: "canvas-one", batchId: "batch-one", fingerprint: "sha256:abc", status: "conflict", baseRevision: 0, resultRevision: 2, error: { code: "CANVAS_REVISION_CONFLICT", message: "revision conflict", retryable: false } };
        const error = Object.assign(new Error("revision conflict"), { status: 409, details: receipt });
        mocks.updateProject.mockRejectedValue(error);
        mocks.canvasProjectError.mockReturnValue(error);

        const response = await PATCH(new Request("http://localhost/api/canvas/projects/canvas-one", { method: "PATCH", body: "{}" }), { params: Promise.resolve({ id: "canvas-one" }) });

        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ code: 409, data: { receipt }, msg: "revision conflict" });
    });
});
