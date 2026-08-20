import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    after: vi.fn(),
    getCurrentUser: vi.fn(),
    getAuthSettings: vi.fn(),
    confirm: vi.fn(),
    reject: vi.fn(),
    submitReceipt: vi.fn(),
    recover: vi.fn(),
    schedule: vi.fn(),
    withConcurrency: vi.fn(),
    getRun: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: mocks.after }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: mocks.getAuthSettings }));
vi.mock("@/lib/server/agent-run-workspace-actions", () => ({
    AgentWorkspaceActionTransitionError: class AgentWorkspaceActionTransitionError extends Error {
        constructor(
            message: string,
            readonly status = 409,
        ) {
            super(message);
        }
    },
    confirmAgentWorkspaceActions: mocks.confirm,
    rejectAgentWorkspaceActions: mocks.reject,
    submitAgentWorkspaceActionReceipt: mocks.submitReceipt,
}));
vi.mock("@/lib/server/generation-task-recovery-service", () => ({ runGenerationTaskRecoveryBatch: mocks.recover }));
vi.mock("@/lib/server/generation-task-scheduler", () => ({ scheduleGenerationTask: mocks.schedule }));
vi.mock("@/lib/server/generation-task-store", () => ({ withGenerationConcurrencyLimit: mocks.withConcurrency }));
vi.mock("@/lib/server/agent-run-store", () => ({ getAgentRun: mocks.getRun }));
vi.mock("@/lib/server/internal-origin", () => ({ resolveInternalOrigin: vi.fn(() => "http://localhost") }));

import { POST } from "./route";

describe("Agent workspace action route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one" });
        mocks.getAuthSettings.mockResolvedValue({ generationConcurrency: { agent: 2 } });
        mocks.withConcurrency.mockImplementation(async (_userId, _type, _staleMs, _limit, handler) => handler());
        mocks.schedule.mockResolvedValue({});
    });

    it("requires authentication", async () => {
        mocks.getCurrentUser.mockResolvedValue(null);
        const response = await call("confirm", { fingerprint: fingerprint() });
        expect(response.status).toBe(401);
        expect(mocks.confirm).not.toHaveBeenCalled();
    });

    it("confirms the exact pending fingerprint without scheduling generation", async () => {
        const run = { id: "run-one", userId: "user-one", status: "awaiting_confirmation", workspaceActionRequest: { batchId: "batch-one" } };
        mocks.confirm.mockResolvedValue(run);

        const response = await call("confirm", { fingerprint: fingerprint() });

        expect(response.status).toBe(200);
        expect(mocks.confirm).toHaveBeenCalledWith({ runId: "run-one", userId: "user-one", fingerprint: fingerprint() });
        expect(mocks.schedule).not.toHaveBeenCalled();
        expect(await response.json()).toMatchObject({ data: { run: { status: "awaiting_confirmation" } } });
    });

    it("rejects atomically and closes the scheduler lease", async () => {
        const run = { id: "run-one", userId: "user-one", status: "cancelled" };
        mocks.reject.mockResolvedValue(run);

        const response = await call("reject", { fingerprint: fingerprint() });

        expect(response.status).toBe(200);
        expect(mocks.schedule).toHaveBeenCalledWith("agent", "run-one", { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "workspace_rejected" });
        expect(mocks.recover).not.toHaveBeenCalled();
    });

    it("uses an Agent concurrency slot only when an applied receipt starts generation", async () => {
        const waiting = { id: "run-one", userId: "user-one", status: "awaiting_confirmation", tasks: [{ id: "task-one" }] };
        const running = { ...waiting, status: "running", workspaceActionReceipt: { status: "applied" } };
        mocks.getRun.mockResolvedValue(waiting);
        mocks.submitReceipt.mockResolvedValue({ run: running, replayed: false });

        const response = await call("receipt", { receipt: { status: "applied" } });

        expect(response.status).toBe(200);
        expect(mocks.withConcurrency).toHaveBeenCalledWith("user-one", "agent", 10 * 60 * 1000, 2, expect.any(Function));
        expect(mocks.schedule).toHaveBeenCalledWith("agent", "run-one", expect.objectContaining({ executionPhase: "created", nextPollAt: expect.any(Number), lastUpstreamStatus: "workspace_receipt_applied" }));
        expect(mocks.after).toHaveBeenCalledWith(expect.any(Function));
    });

    it("persists a conflict receipt without requiring or scheduling generation capacity", async () => {
        const waiting = { id: "run-one", userId: "user-one", status: "awaiting_confirmation", tasks: [{ id: "task-one" }] };
        const failed = { ...waiting, status: "failed", workspaceActionReceipt: { status: "conflict" } };
        mocks.getRun.mockResolvedValue(waiting);
        mocks.submitReceipt.mockResolvedValue({ run: failed, replayed: false });

        const response = await call("receipt", { receipt: { status: "conflict" } });

        expect(response.status).toBe(200);
        expect(mocks.getAuthSettings).not.toHaveBeenCalled();
        expect(mocks.withConcurrency).not.toHaveBeenCalled();
        expect(mocks.schedule).toHaveBeenCalledWith("agent", "run-one", { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "failed" });
        expect(mocks.after).not.toHaveBeenCalled();
    });

    it("does not reschedule an idempotently replayed receipt", async () => {
        const run = { id: "run-one", userId: "user-one", status: "running", tasks: [{ id: "task-one" }], workspaceActionReceipt: { status: "applied" } };
        mocks.getRun.mockResolvedValue(run);
        mocks.submitReceipt.mockResolvedValue({ run, replayed: true });

        const response = await call("receipt", { receipt: { status: "applied" } });

        expect(response.status).toBe(200);
        expect(mocks.getAuthSettings).not.toHaveBeenCalled();
        expect(mocks.schedule).not.toHaveBeenCalled();
        expect(await response.json()).toMatchObject({ data: { replayed: true } });
    });

    it("returns a bounded transition error instead of throwing", async () => {
        const TransitionError = (await import("@/lib/server/agent-run-workspace-actions")).AgentWorkspaceActionTransitionError;
        mocks.confirm.mockRejectedValue(new TransitionError("工作台操作已变化", 409));
        const response = await call("confirm", { fingerprint: fingerprint() });
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ msg: "工作台操作已变化" });
    });
});

function call(action: string, body: unknown) {
    return POST(new Request(`http://localhost/api/agent/runs/run-one/workspace/${action}`, { method: "POST", headers: { "content-type": "application/json", cookie: "session=test" }, body: JSON.stringify(body) }), {
        params: Promise.resolve({ id: "run-one", action }),
    });
}

function fingerprint() {
    return `sha256:${"a".repeat(64)}`;
}
