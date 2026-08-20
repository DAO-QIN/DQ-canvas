import { afterEach, describe, expect, it, vi } from "vitest";

import { confirmWorkspaceActionRequest, defineWorkspaceActionReceipt, workspaceActionRequestFingerprint, type WorkspaceActionRequest } from "./agent-contract";
import { createWorkspaceAgentRunController, restorableWorkspaceAgentRun, retryWorkspaceAgentRun, watchWorkspaceAgentRun } from "./workspace-agent-run-client";

class FakeEventSource extends EventTarget {
    static instance: FakeEventSource;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly url: string) {
        super();
        FakeEventSource.instance = this;
    }
    close() {}
    emit(type: string, data: unknown) {
        this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
    }
}

describe("workspace Agent run client", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("deduplicates action events and restores awaiting confirmation snapshots", async () => {
        vi.stubGlobal("EventSource", FakeEventSource);
        const requests: unknown[] = [];
        const stages: unknown[] = [];
        const promise = watchWorkspaceAgentRun("run one", {
            onAssistant: vi.fn(),
            onStage: (stage) => stages.push(stage),
            onPaused: vi.fn(),
            onWorkspaceActionRequest: (event) => requests.push(event),
        });
        const request = actionRequest();

        FakeEventSource.instance.emit("workspace.actions", { data: { request, requiresConfirmation: true, reply: "需要移动节点" } });
        FakeEventSource.instance.emit("run.snapshot", { id: "run-one", status: "awaiting_confirmation", workspaceActionRequest: request });
        expect(FakeEventSource.instance.url).toBe("/api/agent/runs/run%20one/events");
        expect(requests).toHaveLength(1);
        expect(stages).toContainEqual({ key: "confirmation", text: "等待确认工作台操作" });

        FakeEventSource.instance.emit("run.cancelled", {});
        await promise;
    });

    it("restores a terminal receipt without re-emitting its action request", async () => {
        vi.stubGlobal("EventSource", FakeEventSource);
        const requests: unknown[] = [];
        const receipts: unknown[] = [];
        const promise = watchWorkspaceAgentRun("run-one", {
            onAssistant: vi.fn(),
            onStage: vi.fn(),
            onPaused: vi.fn(),
            onWorkspaceActionRequest: (event) => requests.push(event),
            onWorkspaceActionReceipt: (event) => receipts.push(event),
        });
        const request = confirmWorkspaceActionRequest(actionRequest(), "2026-08-13T12:00:00.000Z");
        const receipt = defineWorkspaceActionReceipt(request, {
            surface: "canvas",
            projectId: "canvas-one",
            batchId: request.batchId,
            fingerprint: workspaceActionRequestFingerprint(request),
            status: "applied",
            baseRevision: 4,
            resultRevision: 5,
            affectedIds: ["node-one"],
            results: [{ actionId: request.actions[0].actionId, status: "applied", affectedIds: ["node-one"] }],
        });

        FakeEventSource.instance.emit("run.snapshot", { id: "run-one", status: "completed", workspaceActionRequest: request, workspaceActionReceipt: receipt });
        await promise;

        expect(requests).toEqual([]);
        expect(receipts).toEqual([expect.objectContaining({ receipt, source: "snapshot" })]);
    });

    it("prepares the Surface before creating a run and restores only active states", async () => {
        const calls: string[] = [];
        const api = {
            create: vi.fn(async () => {
                calls.push("create");
                return { run: run("planning"), created: true };
            }),
            list: vi.fn(async () => [run("completed", "old"), run("awaiting_confirmation", "waiting")]),
            control: vi.fn(async (_runId: string, _action: "pause" | "resume" | "cancel") => run("paused")),
            retry: vi.fn(async (_runId: string, _taskId?: string) => run("running")),
        };
        const controller = createWorkspaceAgentRunController(api);
        const request = {
            clientRequestId: "request-one",
            surface: "design" as const,
            projectId: "design-one",
            prompt: "整理版式",
            assetIds: [],
            skillIds: [],
            modelIds: [],
        };

        await controller.create(
            () => ({ ...request, snapshot: { revision: calls.length } }),
            async () => {
                calls.push("prepare");
            },
        );
        await expect(controller.restore({ surface: "design", projectId: "design-one" })).resolves.toMatchObject({ id: "waiting", status: "awaiting_confirmation" });
        await controller.control("waiting", "pause");
        await controller.retry("waiting", "task-one");

        expect(calls).toEqual(["prepare", "create"]);
        expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ snapshot: { revision: 1 } }));
        expect(api.list).toHaveBeenCalledWith({ surface: "design", projectId: "design-one" });
        expect(api.control).toHaveBeenCalledWith("waiting", "pause");
        expect(api.retry).toHaveBeenCalledWith("waiting", "task-one");
    });

    it("encodes child task retry URLs and preserves API errors", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 409, data: null, msg: "版本已变化" }), { status: 409, headers: { "Content-Type": "application/json" } }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(retryWorkspaceAgentRun("run one", "task/one")).rejects.toMatchObject({ message: "版本已变化", status: 409 });
        expect(fetchMock).toHaveBeenCalledWith("/api/agent/runs/run%20one/tasks/task%2Fone/retry", { method: "POST" });
    });

    it("does not restore terminal runs", () => {
        expect(restorableWorkspaceAgentRun([run("completed"), run("failed", "failed"), run("cancelled", "cancelled")])).toBeNull();
    });
});

function run(status: "planning" | "running" | "awaiting_confirmation" | "paused" | "completed" | "failed" | "cancelled", id = `run-${status}`) {
    return { id, status } as const;
}

function actionRequest(): WorkspaceActionRequest {
    return {
        surface: "canvas",
        projectId: "canvas-one",
        baseRevision: 4,
        batchId: "batch-one",
        actions: [{ actionId: "action-one", kind: "update", effect: "write", command: "content.update", label: "移动节点", targetIds: ["node-one"], parameters: { position: { x: 10, y: 20 } } }],
    };
}
