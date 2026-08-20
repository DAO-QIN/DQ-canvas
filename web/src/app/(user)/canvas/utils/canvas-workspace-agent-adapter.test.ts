import { describe, expect, it, vi } from "vitest";

import { confirmWorkspaceActionRequest, type WorkspaceActionRequest } from "@/lib/creative-workspace";

import { CanvasNodeType } from "../types";
import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "./canvas-agent-ops";
import { canvasWorkspaceActionsToOps, createCanvasWorkspaceSnapshot, executeCanvasWorkspaceActions, type CanvasWorkspaceAgentState } from "./canvas-workspace-agent-adapter";

const canvasSnapshot: CanvasAgentSnapshot = {
    projectId: "canvas-one",
    title: "商品视觉",
    nodes: [
        {
            id: "image-one",
            type: CanvasNodeType.Image,
            title: "商品图",
            position: { x: 20, y: 30 },
            width: 640,
            height: 640,
            metadata: { content: "https://signed.example/product.png?token=secret", remoteUrl: "https://provider.example/product.png", serverUrl: "/api/reference-assets/product.png", storageKey: "permanent/product.png", locked: false },
        },
        {
            id: "text-one",
            type: CanvasNodeType.Text,
            title: "文案",
            position: { x: 720, y: 30 },
            width: 400,
            height: 240,
            metadata: { composerContent: "夏日上新", locked: true },
        },
    ],
    connections: [{ id: "edge-one", fromNodeId: "image-one", toNodeId: "text-one" }],
    selectedNodeIds: ["image-one"],
    viewport: { x: 0, y: 0, k: 1 },
};

const state: CanvasWorkspaceAgentState = { snapshot: canvasSnapshot, revision: 4 };

function request(action: WorkspaceActionRequest["actions"][number], overrides: Partial<WorkspaceActionRequest> = {}): WorkspaceActionRequest {
    return { surface: "canvas", projectId: "canvas-one", baseRevision: 4, batchId: `batch-${action.actionId}`, actions: [action], ...overrides };
}

describe("Canvas workspace Agent adapter", () => {
    it("projects a compact snapshot with stable ids and no transient URLs", () => {
        const snapshot = createCanvasWorkspaceSnapshot(state);

        expect(snapshot).toMatchObject({ surface: "canvas", projectId: "canvas-one", revision: 4, selectionIds: ["image-one"], truncated: false });
        expect(snapshot.entities).toEqual([
            expect.objectContaining({ id: "image-one", kind: "image", resource: { kind: "storage-key", storageKey: "permanent/product.png" } }),
            expect.objectContaining({ id: "text-one", kind: "text", text: "夏日上新", locked: true }),
        ]);
        expect(JSON.stringify(snapshot)).not.toMatch(/signed\.example|provider\.example|serverUrl|token=secret/);
        expect(snapshot.relations).toEqual([{ id: "edge-one", fromId: "image-one", toId: "text-one", kind: "connection" }]);
    });

    it("migrates an owned-route candidate to a stable locator without retaining its signed query", () => {
        const snapshot = createCanvasWorkspaceSnapshot({
            revision: 5,
            snapshot: {
                ...canvasSnapshot,
                nodes: [
                    {
                        ...canvasSnapshot.nodes[0],
                        metadata: { serverUrl: "/api/reference-assets/permanent/legacy%20image.png?expires=1&signature=secret" },
                    },
                ],
                connections: [],
                selectedNodeIds: ["image-one"],
            },
        });

        expect(snapshot.entities[0]).toMatchObject({ resource: { kind: "storage-key", storageKey: "permanent/legacy image.png" } });
        expect(JSON.stringify(snapshot)).not.toMatch(/expires|signature|reference-assets/);
    });

    it("lets reads execute without confirmation and does not dispatch domain ops", async () => {
        const applyOps = vi.fn();
        const receipt = await executeCanvasWorkspaceActions({
            request: request({ actionId: "read-selection", kind: "inspect", effect: "read", command: "selection.read", label: "读取选区", targetIds: [], parameters: {} }),
            state,
            applyOps,
        });

        expect(receipt).toMatchObject({ status: "applied", baseRevision: 4, resultRevision: 4, affectedIds: ["image-one"] });
        expect(applyOps).not.toHaveBeenCalled();
    });

    it("requires confirmation before mapping or applying a write", async () => {
        const pending = request({ actionId: "move-image", kind: "update", effect: "write", command: "content.update", label: "移动商品图", targetIds: ["image-one"], parameters: { position: { x: 100, y: 120 } } });
        const applyOps = vi.fn();

        const pendingReceipt = await executeCanvasWorkspaceActions({ request: pending, state, applyOps });
        expect(pendingReceipt.status).toBe("confirmation-required");
        expect(applyOps).not.toHaveBeenCalled();

        const confirmed = confirmWorkspaceActionRequest(pending, "2026-08-13T12:00:00.000Z");
        const appliedReceipt = await executeCanvasWorkspaceActions({
            request: confirmed,
            state,
            applyOps: (ops) => applyCanvasAgentOps(canvasSnapshot, [...ops]),
            persist: async () => canvasSaveReceipt({ baseRevision: 4, resultRevision: 7 }),
        });
        expect(appliedReceipt).toMatchObject({ status: "applied", baseRevision: 4, resultRevision: 7, affectedIds: ["image-one"] });
        expect(canvasWorkspaceActionsToOps(confirmed, state)).toEqual([{ type: "update_node", id: "image-one", patch: { position: { x: 100, y: 120 } }, metadata: {} }]);
    });

    it("fails closed when persistence fails or returns a revision conflict", async () => {
        const confirmed = confirmWorkspaceActionRequest(
            request({ actionId: "move-image", kind: "update", effect: "write", command: "content.update", label: "移动商品图", targetIds: ["image-one"], parameters: { position: { x: 100, y: 120 } } }),
            "2026-08-13T12:00:00.000Z",
        );
        const applyOps = (ops: readonly CanvasAgentOp[]) => applyCanvasAgentOps(canvasSnapshot, [...ops]);

        const failed = await executeCanvasWorkspaceActions({ request: confirmed, state, applyOps, persist: async () => Promise.reject(new Error("provider unavailable")) });
        expect(failed).toMatchObject({ status: "rejected", resultRevision: 4, error: { code: "PERSISTENCE_FAILED", retryable: true } });

        const conflict = await executeCanvasWorkspaceActions({
            request: confirmed,
            state,
            applyOps,
            persist: async () => canvasSaveReceipt({ status: "conflict", baseRevision: 4, resultRevision: 5, error: { code: "CANVAS_REVISION_CONFLICT", message: "revision 冲突", retryable: true } }),
        });
        expect(conflict).toMatchObject({ status: "conflict", resultRevision: 4, error: { code: "REVISION_CONFLICT", retryable: true } });
    });

    it("fails closed for locked nodes, stale revisions and falsified effect declarations", async () => {
        const locked = confirmWorkspaceActionRequest(request({ actionId: "delete-text", kind: "delete", effect: "write", command: "content.delete", label: "删除文案", targetIds: ["text-one"], parameters: {} }), "2026-08-13T12:00:00.000Z");
        const lockedReceipt = await executeCanvasWorkspaceActions({ request: locked, state, applyOps: vi.fn() });
        expect(lockedReceipt).toMatchObject({ status: "rejected", error: { code: "LOCKED" } });

        const stale = request({ actionId: "read", kind: "inspect", effect: "read", command: "workspace.read", label: "读取画布", targetIds: [], parameters: {} }, { baseRevision: 3 });
        const staleReceipt = await executeCanvasWorkspaceActions({ request: stale, state, applyOps: vi.fn() });
        expect(staleReceipt).toMatchObject({ status: "conflict", error: { code: "REVISION_CONFLICT" } });

        const disguisedWrite = request({ actionId: "delete", kind: "delete", effect: "read", command: "content.delete", label: "删除商品图", targetIds: ["image-one"], parameters: {} });
        const disguisedReceipt = await executeCanvasWorkspaceActions({ request: disguisedWrite, state, applyOps: vi.fn() });
        expect(disguisedReceipt).toMatchObject({ status: "rejected", error: { code: "INVALID_ACTION" } });
    });

    it("maps stable media creation and rejects unresolved library locators", () => {
        const create = confirmWorkspaceActionRequest(
            request({
                actionId: "create-result",
                kind: "create",
                effect: "write",
                command: "content.create",
                label: "插入生成图",
                targetIds: ["result-one"],
                parameters: { nodeType: "image", title: "生成结果", bounds: { x: 1200, y: 30, width: 512, height: 512 }, resource: { kind: "storage-key", storageKey: "permanent/result.png" } },
            }),
            "2026-08-13T12:00:00.000Z",
        );
        expect(canvasWorkspaceActionsToOps(create, state)).toEqual([
            {
                type: "add_node",
                id: "result-one",
                nodeType: CanvasNodeType.Image,
                title: "生成结果",
                position: { x: 1200, y: 30 },
                width: 512,
                height: 512,
                metadata: { storageKey: "permanent/result.png" },
            },
        ]);

        const unresolved = confirmWorkspaceActionRequest(
            request({
                actionId: "create-library",
                kind: "create",
                effect: "write",
                command: "content.create",
                label: "插入素材",
                targetIds: ["result-two"],
                parameters: { nodeType: "image", resource: { kind: "library-asset", libraryAssetId: "asset-one" } },
            }),
            "2026-08-13T12:00:00.000Z",
        );
        expect(() => canvasWorkspaceActionsToOps(unresolved, state)).toThrow("先把素材库资源解析为稳定 storageKey");
    });
});

function canvasSaveReceipt(overrides: Partial<import("@/lib/canvas-project-receipt").CanvasSaveReceipt> = {}): import("@/lib/canvas-project-receipt").CanvasSaveReceipt {
    return {
        projectId: "canvas-one",
        batchId: "canvas-save:canvas-one:1",
        fingerprint: "sha256:test",
        status: "applied",
        baseRevision: 4,
        resultRevision: 5,
        ...overrides,
    };
}
