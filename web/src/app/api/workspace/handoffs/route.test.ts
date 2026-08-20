import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceHandoffReceipt } from "@/lib/creative-workspace";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), execute: vi.fn(), mapError: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/workspace-handoff-service", () => ({
    executeWorkspaceHandoffForUser: mocks.execute,
    workspaceHandoffError: mocks.mapError,
}));

import { POST } from "./route";

describe("POST /api/workspace/handoffs", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one" });
        mocks.mapError.mockReturnValue(null);
        mocks.execute.mockResolvedValue(receipt("applied"));
    });

    it("requires authentication before reading the request", async () => {
        mocks.getCurrentUser.mockResolvedValue(null);
        const response = await POST(jsonRequest({}));
        expect(response.status).toBe(401);
        expect(mocks.execute).not.toHaveBeenCalled();
    });

    it("rejects malformed JSON", async () => {
        const response = await POST(new Request("http://localhost/api/workspace/handoffs", { method: "POST", body: "{" }));
        expect(response.status).toBe(400);
        expect(mocks.execute).not.toHaveBeenCalled();
    });

    it("executes through the current-user service boundary", async () => {
        const body = { handoffId: "handoff-one" };
        const response = await POST(jsonRequest(body));
        expect(response.status).toBe(200);
        expect(mocks.execute).toHaveBeenCalledWith("user-one", body);
        await expect(response.json()).resolves.toMatchObject({ code: 0, data: { receipt: { status: "applied" } } });
    });

    it.each([
        ["conflict", undefined, 409],
        ["rejected", undefined, 422],
        ["replayed", "applied", 200],
        ["replayed", "conflict", 409],
        ["replayed", "rejected", 422],
    ] as const)("maps %s/%s to HTTP %s while retaining the receipt", async (status, originalStatus, expected) => {
        mocks.execute.mockResolvedValue(receipt(status, originalStatus));
        const response = await POST(jsonRequest({}));
        expect(response.status).toBe(expected);
        await expect(response.json()).resolves.toMatchObject({ data: { receipt: { status, ...(originalStatus ? { originalStatus } : {}) } } });
    });

    it("maps known service failures without exposing unknown internals", async () => {
        const failure = new Error("invalid request");
        mocks.execute.mockRejectedValue(failure);
        mocks.mapError.mockReturnValue({ status: 400, message: "handoffId 无效" });
        const response = await POST(jsonRequest({}));
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ code: 400, data: null, msg: "handoffId 无效" });
    });
});

function receipt(status: WorkspaceHandoffReceipt["status"], originalStatus?: WorkspaceHandoffReceipt["originalStatus"]): WorkspaceHandoffReceipt {
    return {
        handoffId: "handoff-one",
        fingerprint: `sha256:${"a".repeat(64)}`,
        status,
        ...(originalStatus ? { originalStatus } : {}),
        source: { surface: "canvas", projectId: "canvas-one", revision: 0, selectionIds: ["image-one"] },
        target: { surface: "design", projectId: "design-one", baseRevision: 0, resultRevision: status === "applied" ? 1 : 0 },
        targetBatchId: "target-batch",
        targetFingerprint: status === "applied" ? `sha256:${"b".repeat(64)}` : null,
        targetIds: status === "applied" ? ["element-one"] : [],
        ...(status === "conflict" || status === "rejected" ? { error: { code: "HANDOFF_RESULT", message: "未应用", retryable: false } } : {}),
    };
}

function jsonRequest(body: unknown) {
    return new Request("http://localhost/api/workspace/handoffs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
