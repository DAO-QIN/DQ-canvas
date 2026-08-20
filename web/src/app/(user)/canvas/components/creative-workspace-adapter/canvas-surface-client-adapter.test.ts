import { describe, expect, it, vi } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../../types";
import { createCanvasSurfaceClientAdapter, type CanvasSurfaceClientState } from "./canvas-surface-client-adapter";

function node(id: string, x: number, y: number, width: number, height: number, locked = false): CanvasNodeData {
    return { id, type: CanvasNodeType.Image, title: id, position: { x, y }, width, height, metadata: locked ? { locked: true } : undefined };
}

function state(overrides: Partial<CanvasSurfaceClientState> = {}): CanvasSurfaceClientState {
    return {
        projectId: "canvas-project-1",
        nodes: [node("a", 10, 20, 100, 80), node("b", 180, 100, 120, 90)],
        selectedNodeIds: new Set(["a", "b"]),
        selectedConnectionId: null,
        viewport: { x: 40, y: 30, k: 2 },
        viewportSize: { width: 1200, height: 720 },
        surfaceClientRect: { left: 100, top: 50, width: 1200, height: 720 },
        canUndo: true,
        canRedo: false,
        ...overrides,
    };
}

describe("Canvas surface client adapter", () => {
    it("takes a deeply immutable selection and viewport snapshot", () => {
        const nodes = [node("a", 10, 20, 100, 80), node("b", 180, 100, 120, 90)];
        const selectedNodeIds = new Set(["a", "b"]);
        let current = state({ nodes, selectedNodeIds });
        const adapter = createCanvasSurfaceClientAdapter({ readState: () => current });
        const snapshot = adapter.getSnapshot();

        nodes[0] = node("a", 999, 999, 1, 1);
        selectedNodeIds.clear();
        current = state({ nodes: [], selectedNodeIds: new Set() });

        expect(snapshot.selection.nodeIds).toEqual(["a", "b"]);
        expect(snapshot.selection.bounds).toEqual({ x: 10, y: 20, width: 290, height: 170 });
        expect(snapshot.selection.clientBounds).toEqual({ x: 160, y: 120, width: 580, height: 340 });
        expect(snapshot.viewport).toEqual({ x: 40, y: 30, scale: 2 });
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot.selection)).toBe(true);
        expect(Object.isFrozen(snapshot.selection.nodeIds)).toBe(true);
        expect(Object.isFrozen(snapshot.selection.bounds)).toBe(true);
        expect(Object.isFrozen(snapshot.selection.clientBounds)).toBe(true);
    });

    it("round-trips scene/client coordinates including the host rect offset", () => {
        const adapter = createCanvasSurfaceClientAdapter({ readState: () => state() });

        expect(adapter.sceneToClient({ x: 25, y: 40 })).toEqual({ x: 190, y: 160 });
        expect(adapter.clientToScene({ x: 190, y: 160 })).toEqual({ x: 25, y: 40 });
        expect(adapter.sceneRectToClient({ x: 10, y: 20, width: 100, height: 80 })).toEqual({ x: 160, y: 120, width: 200, height: 160 });
    });

    it("subscribes by change kind, supports idempotent unsubscribe and stops after destroy", () => {
        let current = state();
        const adapter = createCanvasSurfaceClientAdapter({ readState: () => current });
        const first = vi.fn();
        const second = vi.fn();
        const unsubscribeFirst = adapter.subscribe(first);
        adapter.subscribe(second);

        current = state({ viewport: { x: 80, y: 60, k: 1 } });
        const refreshed = adapter.refresh("viewport");
        expect(refreshed.revision).toBe(1);
        expect(first).toHaveBeenCalledWith(refreshed, "viewport");
        expect(second).toHaveBeenCalledWith(refreshed, "viewport");

        unsubscribeFirst();
        unsubscribeFirst();
        adapter.refresh("selection");
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(2);

        adapter.destroy();
        adapter.refresh("resize");
        expect(second).toHaveBeenCalledTimes(2);
        const lateListener = vi.fn();
        adapter.subscribe(lateListener);
        adapter.refresh();
        expect(lateListener).not.toHaveBeenCalled();
    });

    it("gates descriptor capabilities from real injected handlers", () => {
        const adapter = createCanvasSurfaceClientAdapter({
            readState: () => state(),
            handlers: { undo: vi.fn(), setZoomScale: vi.fn(), clearSelection: vi.fn(), createNode: vi.fn() },
        });

        expect(adapter.descriptor.capabilities).toMatchObject({
            "history.undo": true,
            "viewport.zoom": true,
            "selection.read": true,
            "selection.bounds": true,
            "content.create": true,
            "extension:canvas.selection.clear": true,
        });
        expect(adapter.descriptor.capabilities["history.redo"]).toBeUndefined();
        expect(adapter.descriptor.capabilities["selection.align"]).toBeUndefined();
        expect(adapter.descriptor.capabilities["selection.distribute"]).toBeUndefined();
        expect(adapter.descriptor.capabilities["selection.prompt"]).toBeUndefined();
        expect(Object.isFrozen(adapter.descriptor)).toBe(true);
    });

    it("executes typed commands through Canvas handlers and refreshes snapshots", async () => {
        let current = state({ selectedNodeIds: new Set(["a"]) });
        const undo = vi.fn(() => {
            current = state({ ...current, canUndo: false, selectedNodeIds: new Set(["a"]) });
        });
        const setViewport = vi.fn((viewport) => {
            current = state({ ...current, viewport, selectedNodeIds: new Set(["a"]) });
        });
        const setZoomScale = vi.fn((scale) => {
            current = state({ ...current, viewport: { ...current.viewport, k: scale }, selectedNodeIds: new Set(["a"]) });
        });
        const resizeNode = vi.fn();
        const createNode = vi.fn();
        const adapter = createCanvasSurfaceClientAdapter({ readState: () => current, handlers: { undo, setViewport, setZoomScale, resizeNode, createNode } });

        const undoResult = await adapter.execute({ id: "history.undo" });
        expect(undoResult.ok).toBe(true);
        expect(undo).toHaveBeenCalledOnce();
        expect(undoResult.snapshot.history.canUndo).toBe(false);

        await adapter.execute({ id: "viewport.pan", deltaX: 10, deltaY: -5 });
        expect(setViewport).toHaveBeenCalledWith({ x: 50, y: 25, k: 2 });

        await adapter.execute({ id: "viewport.zoom", scale: 9 });
        expect(setZoomScale).toHaveBeenCalledWith(5);

        await adapter.execute({ id: "selection.resize", width: 100, height: 90, position: { x: 4, y: 6 } });
        expect(resizeNode).toHaveBeenCalledWith("a", 220, 160, { x: 4, y: 6 });

        await adapter.execute({ id: "create.node", nodeType: CanvasNodeType.Text, position: { x: 8, y: 9 } });
        expect(createNode).toHaveBeenCalledWith(CanvasNodeType.Text, { x: 8, y: 9 });
    });

    it("can defer command refresh until a React owner publishes committed state", async () => {
        let current = state({ selectedNodeIds: new Set(["a"]), viewport: { x: 40, y: 30, k: 2 } });
        const subscriber = vi.fn();
        const adapter = createCanvasSurfaceClientAdapter({
            readState: () => current,
            autoRefresh: false,
            handlers: {
                setZoomScale: (scale) => {
                    current = state({ ...current, selectedNodeIds: new Set(["a"]), viewport: { ...current.viewport, k: scale } });
                },
            },
        });
        adapter.subscribe(subscriber);

        const result = await adapter.execute({ id: "viewport.zoom", scale: 3 });
        expect(result.snapshot).toBe(adapter.getSnapshot());
        expect(result.snapshot.viewport.scale).toBe(2);
        expect(subscriber).not.toHaveBeenCalled();

        const committed = adapter.refresh("viewport");
        expect(committed.viewport.scale).toBe(3);
        expect(subscriber).toHaveBeenCalledOnce();
        expect(subscriber).toHaveBeenCalledWith(committed, "viewport");
    });

    it("fails closed for unknown, unsupported, disabled and malformed commands", async () => {
        const adapter = createCanvasSurfaceClientAdapter({
            readState: () => state({ selectedNodeIds: new Set(["a"]), canUndo: false }),
            handlers: { undo: vi.fn(), setZoomScale: vi.fn(), resizeNode: vi.fn(), createNode: vi.fn() },
        });

        await expect(adapter.execute({ id: "surface.magic" })).resolves.toMatchObject({ ok: false, reason: "unknown-command" });
        await expect(adapter.execute({ id: "viewport.pan", deltaX: 1, deltaY: 1 })).resolves.toMatchObject({ ok: false, reason: "unsupported-command" });
        await expect(adapter.execute({ id: "history.undo" })).resolves.toMatchObject({ ok: false, reason: "disabled-command" });
        await expect(adapter.execute({ id: "viewport.zoom", scale: Number.NaN })).resolves.toMatchObject({ ok: false, reason: "invalid-command" });
        await expect(adapter.execute({ id: "selection.resize", width: -1, height: 20 })).resolves.toMatchObject({ ok: false, reason: "invalid-command" });
        await expect(adapter.execute({ id: "create.node", nodeType: CanvasNodeType.Task })).resolves.toMatchObject({ ok: false, reason: "invalid-command" });
    });

    it("disables locked or multi-node resize and routes deletion to the selected domain truth", async () => {
        const deleteNodes = vi.fn();
        const deleteConnection = vi.fn();
        let current = state({ nodes: [node("a", 0, 0, 240, 180, true)], selectedNodeIds: new Set(["a"]) });
        const adapter = createCanvasSurfaceClientAdapter({ readState: () => current, handlers: { resizeNode: vi.fn(), deleteNodes, deleteConnection } });

        expect(adapter.commandEnabled("selection.resize")).toBe(false);
        expect(adapter.getSnapshot().selection).toMatchObject({ containsLockedNode: true, resizable: false });

        current = state({ selectedNodeIds: new Set(["a", "b"]) });
        adapter.refresh("selection");
        expect(adapter.commandEnabled("selection.resize")).toBe(false);
        await adapter.execute({ id: "selection.delete" });
        expect(deleteNodes).toHaveBeenCalledWith(new Set(["a", "b"]));

        current = state({ selectedNodeIds: new Set(), selectedConnectionId: "edge-1" });
        adapter.refresh("selection");
        await adapter.execute({ id: "selection.delete" });
        expect(deleteConnection).toHaveBeenCalledWith("edge-1");
    });

    it("returns handler failures without throwing or claiming success", async () => {
        const adapter = createCanvasSurfaceClientAdapter({
            readState: () => state(),
            handlers: {
                undo: () => {
                    throw new Error("history store failed");
                },
            },
        });

        await expect(adapter.execute({ id: "history.undo" })).resolves.toMatchObject({ ok: false, reason: "handler-error", message: "history store failed" });
    });
});
