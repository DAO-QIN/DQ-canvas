import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmWorkspaceActionRequest, defineWorkspaceActionReceipt, workspaceActionRequestFingerprint, type WorkspaceActionRequest } from "@/lib/creative-workspace";
import type { AgentRun } from "./agent-run-store";

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), getRun: vi.fn(), getCanvasProject: vi.fn(), getDesignProject: vi.fn() }));

vi.mock("./creative-runtime-store", () => ({ mutateCreativeRun: mocks.mutate }));
vi.mock("./agent-run-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("./agent-run-store")>()), getAgentRun: mocks.getRun }));
vi.mock("./canvas-project-service", () => ({ getCanvasProjectForUser: mocks.getCanvasProject }));
vi.mock("./design-project-service", () => ({ getDesignProjectForUser: mocks.getDesignProject }));

import { confirmAgentWorkspaceActions, rejectAgentWorkspaceActions, submitAgentWorkspaceActionReceipt } from "./agent-run-workspace-actions";

describe("Agent workspace action transitions", () => {
    let current: AgentRun;
    const events: Array<{ type: string; data?: unknown }> = [];

    beforeEach(() => {
        vi.clearAllMocks();
        events.length = 0;
        current = waitingRun();
        mocks.getRun.mockImplementation(async () => current);
        mocks.getCanvasProject.mockResolvedValue({ id: "canvas-one", revision: 3 });
        mocks.getDesignProject.mockResolvedValue({ id: "design-one", revision: 3 });
        mocks.mutate.mockImplementation(async (_id, _ttl, mutate, allowedStatuses) => {
            if (allowedStatuses && !allowedStatuses.includes(current.status)) return null;
            const mutation = mutate(current);
            if (!mutation) return null;
            current = { ...mutation.run, updatedAt: current.updatedAt + 1 };
            if (mutation.event) events.push(mutation.event);
            return current;
        });
    });

    it("binds confirmation to the persisted request fingerprint", async () => {
        const fingerprint = workspaceActionRequestFingerprint(current.workspaceActionRequest!);
        const confirmed = await confirmAgentWorkspaceActions({ runId: current.id, userId: current.userId, fingerprint, confirmedAt: "2026-08-13T12:00:00.000Z" });

        expect(confirmed?.workspaceActionRequest?.confirmation).toEqual({ batchId: "batch-one", fingerprint, confirmedAt: "2026-08-13T12:00:00.000Z" });
        expect(events).toEqual([expect.objectContaining({ type: "workspace.actions.confirmed" })]);
        await expect(confirmAgentWorkspaceActions({ runId: current.id, userId: current.userId, fingerprint: "sha256:" + "0".repeat(64) })).rejects.toThrow("已变化");
    });

    it("rejects atomically without starting planned generation tasks", async () => {
        const fingerprint = workspaceActionRequestFingerprint(current.workspaceActionRequest!);
        const rejected = await rejectAgentWorkspaceActions({ runId: current.id, userId: current.userId, fingerprint });

        expect(rejected).toMatchObject({ status: "cancelled", executionId: undefined, tasks: [{ status: "cancelled", error: "工作台操作未获授权" }] });
        expect(events).toEqual([{ type: "workspace.actions.rejected", data: { batchId: "batch-one", fingerprint } }]);
    });

    it("resumes generation only after an authorized coherent receipt", async () => {
        const confirmed = confirmWorkspaceActionRequest(current.workspaceActionRequest!, "2026-08-13T12:00:00.000Z");
        current = { ...current, workspaceActionRequest: confirmed };
        const receipt = appliedReceipt(confirmed, 3);

        const transition = await submitAgentWorkspaceActionReceipt({ runId: current.id, userId: current.userId, receipt });

        expect(transition).toMatchObject({ replayed: false, run: { status: "running", workspaceActionReceipt: { status: "applied" }, tasks: [{ status: "ready" }] } });
        expect(events).toEqual([expect.objectContaining({ type: "workspace.actions.receipt", data: expect.objectContaining({ ops: expect.any(Array) }) })]);

        const replay = await submitAgentWorkspaceActionReceipt({ runId: current.id, userId: current.userId, receipt });
        expect(replay).toMatchObject({ replayed: true, run: { status: "running" } });
        expect(events).toHaveLength(1);
    });

    it("keeps the run waiting when the current project revision changed", async () => {
        const confirmed = confirmWorkspaceActionRequest(current.workspaceActionRequest!, "2026-08-13T12:00:00.000Z");
        current = { ...current, workspaceActionRequest: confirmed };
        mocks.getCanvasProject.mockResolvedValue({ id: "canvas-one", revision: 4 });

        await expect(submitAgentWorkspaceActionReceipt({ runId: current.id, userId: current.userId, receipt: appliedReceipt(confirmed, 3) })).rejects.toThrow("revision 已变化");
        expect(current.status).toBe("awaiting_confirmation");
        expect(events).toEqual([]);
    });

    it("persists a rejected receipt as terminal failure and cancels generation", async () => {
        const confirmed = confirmWorkspaceActionRequest(current.workspaceActionRequest!, "2026-08-13T12:00:00.000Z");
        current = { ...current, workspaceActionRequest: confirmed };
        const error = { code: "REVISION_CONFLICT", message: "revision 冲突", retryable: true };
        const receipt = defineWorkspaceActionReceipt(confirmed, {
            surface: "canvas",
            projectId: "canvas-one",
            batchId: "batch-one",
            fingerprint: workspaceActionRequestFingerprint(confirmed),
            status: "conflict",
            baseRevision: 3,
            resultRevision: 3,
            affectedIds: [],
            results: [{ actionId: "authorize", status: "rejected", affectedIds: [], error }],
            error,
        });

        const transition = await submitAgentWorkspaceActionReceipt({ runId: current.id, userId: current.userId, receipt });
        expect(transition).toMatchObject({ replayed: false, run: { status: "failed", tasks: [{ status: "cancelled" }], workspaceActionReceipt: { status: "conflict" } } });
    });

    it("rejects a write receipt whose persisted project revision does not match", async () => {
        const request: WorkspaceActionRequest = {
            surface: "design",
            projectId: "design-one",
            baseRevision: 3,
            batchId: "design-batch",
            actions: [{ actionId: "move", kind: "update", effect: "write", command: "content.update", label: "移动", targetIds: ["element-one"], parameters: { position: { x: 1, y: 2 } } }],
        };
        const confirmed = confirmWorkspaceActionRequest(request, "2026-08-13T12:00:00.000Z");
        current = { ...waitingRun(), surface: "design", projectId: "design-one", workspaceActionRequest: confirmed, tasks: [] };
        mocks.getDesignProject.mockResolvedValue({ id: "design-one", revision: 3 });
        const receipt = appliedReceipt(confirmed, 4);

        await expect(submitAgentWorkspaceActionReceipt({ runId: current.id, userId: current.userId, receipt })).rejects.toThrow("与当前项目 3 不一致");
    });
});

function waitingRun(): AgentRun {
    return {
        id: "agent-one",
        userId: "user-one",
        conversationId: "conversation-one",
        clientRequestId: "request-one",
        surface: "canvas",
        projectId: "canvas-one",
        inputMessageId: "input-one",
        assistantMessageId: "assistant-one",
        prompt: "生成主图",
        snapshot: { projectId: "canvas-one", title: "画布", nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } },
        referencedAssetIds: [],
        assetIds: [],
        status: "awaiting_confirmation",
        tasks: [{ id: "task-one", title: "主图", type: "image", prompt: "主图", count: 1, dependencies: [], status: "ready", attempts: 0 }],
        workspaceActionRequest: {
            surface: "canvas",
            projectId: "canvas-one",
            baseRevision: 3,
            batchId: "batch-one",
            actions: [{ actionId: "authorize", kind: "generate", effect: "write", command: "generation.authorize", label: "生成主图", targetIds: [], parameters: { taskIds: ["task-one"], taskTypes: ["image"] } }],
        },
        foundation: { complexity: "simple", brief: { objective: "主图" }, direction: { summary: "简洁" } },
        reviewed: false,
        timings: { requestAcceptedAt: 1, planningCompletedAt: 2 },
        createdAt: 1,
        updatedAt: 2,
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
        affectedIds: request.actions.flatMap((action) => action.targetIds),
        results: request.actions.map((action) => ({ actionId: action.actionId, status: "applied", affectedIds: [...action.targetIds] })),
    });
}
