import { describe, expect, it, vi } from "vitest";

import { confirmWorkspaceActionRequest, defineWorkspaceActionReceipt, workspaceActionRequestFingerprint, type WorkspaceActionRequest } from "./agent-contract";
import { createWorkspaceAgentActionController, type WorkspaceAgentActionApi, type WorkspaceAgentActionState } from "./workspace-agent-action-controller";

describe("workspace Agent action controller", () => {
    it("automatically executes reads and submits their real receipt once", async () => {
        const request = actionRequest("read", "read");
        const receipt = appliedReceipt(request, 4);
        const execute = vi.fn().mockResolvedValue(receipt);
        const submitReceipt = vi.fn().mockResolvedValue({ run: { id: "run-one", status: "completed", workspaceActionReceipt: receipt }, replayed: false });
        const states: WorkspaceAgentActionState[] = [];
        const controller = createWorkspaceAgentActionController({ runId: "run-one", execute, onStateChange: (state) => states.push(state), api: api({ submitReceipt }) });

        await Promise.all([controller.receive(request), controller.receive(request)]);

        expect(execute).toHaveBeenCalledOnce();
        expect(submitReceipt).toHaveBeenCalledOnce();
        expect(states.map((state) => state.status)).toEqual(["executing", "submitting", "applied"]);
    });

    it("does not execute a write before the server returns the signed request", async () => {
        const request = actionRequest("write", "write");
        const confirmed = confirmWorkspaceActionRequest(request, "2026-08-13T12:00:00.000Z");
        const receipt = appliedReceipt(confirmed, 5);
        const execute = vi.fn().mockResolvedValue(receipt);
        const confirm = vi.fn().mockResolvedValue({ run: { id: "run-one", status: "awaiting_confirmation" }, request: confirmed });
        const submitReceipt = vi.fn().mockResolvedValue({ run: { id: "run-one", status: "completed", workspaceActionReceipt: receipt }, replayed: false });
        const states: WorkspaceAgentActionState[] = [];
        const controller = createWorkspaceAgentActionController({ runId: "run-one", execute, onStateChange: (state) => states.push(state), api: api({ confirm, submitReceipt }) });

        await controller.receive(request);
        expect(controller.getState().status).toBe("pending-confirmation");
        expect(execute).not.toHaveBeenCalled();

        await Promise.all([controller.confirm(), controller.confirm()]);
        expect(confirm).toHaveBeenCalledOnce();
        expect(execute).toHaveBeenCalledOnce();
        expect(submitReceipt).toHaveBeenCalledOnce();
        expect(states.map((state) => state.status)).toEqual(["pending-confirmation", "confirming", "executing", "submitting", "applied"]);
    });

    it("rejects without invoking the Surface adapter", async () => {
        const request = actionRequest("write", "write");
        const execute = vi.fn();
        const reject = vi.fn().mockResolvedValue({ run: { id: "run-one", status: "cancelled" } });
        const controller = createWorkspaceAgentActionController({ runId: "run-one", execute, onStateChange: vi.fn(), api: api({ reject }) });

        await controller.receive(request);
        await controller.reject();

        expect(reject).toHaveBeenCalledWith("run-one", workspaceActionRequestFingerprint(request));
        expect(execute).not.toHaveBeenCalled();
        expect(controller.getState()).toMatchObject({ status: "rejected", message: "已拒绝这组工作区操作" });
    });

    it("restores a terminal receipt without executing the action again", () => {
        const request = confirmWorkspaceActionRequest(actionRequest("write", "write"), "2026-08-13T12:00:00.000Z");
        const receipt = appliedReceipt(request, 5);
        const execute = vi.fn();
        const controller = createWorkspaceAgentActionController({ runId: "run-one", execute, onStateChange: vi.fn(), api: api() });

        controller.receiveReceipt(request, receipt, "已恢复回执");

        expect(execute).not.toHaveBeenCalled();
        expect(controller.getState()).toMatchObject({ status: "applied", message: "已恢复回执" });
    });

    it("retries only receipt submission after the Surface already committed", async () => {
        const request = confirmWorkspaceActionRequest(actionRequest("write", "write"), "2026-08-13T12:00:00.000Z");
        const receipt = appliedReceipt(request, 5);
        const execute = vi.fn().mockResolvedValue(receipt);
        const submitReceipt = vi
            .fn()
            .mockRejectedValueOnce(Object.assign(new Error("gateway timeout"), { status: 503 }))
            .mockResolvedValueOnce({ run: { id: "run-one", status: "completed", workspaceActionReceipt: receipt }, replayed: false });
        const controller = createWorkspaceAgentActionController({ runId: "run-one", execute, onStateChange: vi.fn(), api: api({ submitReceipt }) });

        await controller.receive(request);
        expect(controller.getState()).toMatchObject({ status: "error", receipt, retryable: true });

        await controller.retry();
        expect(execute).toHaveBeenCalledOnce();
        expect(submitReceipt).toHaveBeenCalledTimes(2);
        expect(controller.getState()).toMatchObject({ status: "applied", receipt });
    });
});

function actionRequest(id: string, effect: "read" | "write"): WorkspaceActionRequest {
    return {
        surface: "canvas",
        projectId: "canvas-one",
        baseRevision: 4,
        batchId: `batch-${id}`,
        actions: [
            {
                actionId: `action-${id}`,
                kind: effect === "read" ? "inspect" : "update",
                effect,
                command: effect === "read" ? "workspace.read" : "content.update",
                label: effect === "read" ? "读取画布" : "移动节点",
                targetIds: effect === "read" ? [] : ["node-one"],
                parameters: effect === "read" ? {} : { position: { x: 10, y: 20 } },
            },
        ],
    };
}

function appliedReceipt(request: WorkspaceActionRequest, resultRevision: number) {
    return defineWorkspaceActionReceipt(request, {
        surface: request.surface,
        projectId: request.projectId,
        batchId: request.batchId,
        fingerprint: workspaceActionRequestFingerprint(request),
        status: "applied",
        baseRevision: request.baseRevision,
        resultRevision,
        affectedIds: ["node-one"],
        results: [{ actionId: request.actions[0].actionId, status: "applied", affectedIds: ["node-one"] }],
    });
}

function api(overrides: Partial<WorkspaceAgentActionApi> = {}): WorkspaceAgentActionApi {
    return {
        confirm: vi.fn(),
        reject: vi.fn(),
        submitReceipt: vi.fn(),
        ...overrides,
    };
}
