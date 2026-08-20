import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceHandoffRequest } from "@/lib/creative-workspace";

import { executeWorkspaceHandoff, WorkspaceHandoffRequestError, workspaceHandoffReceiptFromError } from "./workspace-handoffs";

const request: WorkspaceHandoffRequest = {
    handoffId: "handoff-one",
    source: { surface: "canvas", projectId: "canvas-one", revision: 0, selectionIds: ["image-one"] },
    target: { surface: "design", projectId: "design-one", baseRevision: 0 },
};

describe("workspace handoff API client", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("returns an applied receipt", async () => {
        const receipt = { handoffId: "handoff-one", status: "applied" };
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { receipt } }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        await expect(executeWorkspaceHandoff(request)).resolves.toEqual(receipt);
        expect(fetchMock).toHaveBeenCalledWith("/api/workspace/handoffs", expect.objectContaining({ method: "POST", body: JSON.stringify(request) }));
    });

    it("retains a conflict receipt on HTTP errors", async () => {
        const receipt = { handoffId: "handoff-one", status: "conflict", error: { code: "HANDOFF_TARGET_REVISION_CONFLICT", message: "目标已变化", retryable: false } };
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 409, data: { receipt }, msg: "目标已变化" }), { status: 409 })));
        const failure = await executeWorkspaceHandoff(request).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(WorkspaceHandoffRequestError);
        expect(failure).toMatchObject({ status: 409, message: "目标已变化", receipt });
        expect(workspaceHandoffReceiptFromError(failure)).toEqual(receipt);
    });

    it("reports transport failures without inventing a receipt", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
        await expect(executeWorkspaceHandoff(request)).rejects.toMatchObject({ status: 0, message: "offline", receipt: undefined });
    });
});
