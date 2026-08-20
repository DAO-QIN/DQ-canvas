import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { CanvasSurfaceClientAdapter, CanvasSurfaceClientSnapshot } from "./canvas-surface-client-adapter";
import { CanvasSelectionSizeOverlay, canvasSelectionSizeOverlayModel } from "./canvas-selection-size-overlay";

function snapshot(overrides: Partial<CanvasSurfaceClientSnapshot["selection"]> = {}): CanvasSurfaceClientSnapshot {
    return Object.freeze({
        surfaceId: "canvas",
        projectId: "project-1",
        revision: 1,
        viewport: Object.freeze({ x: 40, y: 30, scale: 2 }),
        viewportSize: Object.freeze({ width: 1_000, height: 700 }),
        surfaceClientRect: Object.freeze({ left: 100, top: 50, width: 1_000, height: 700 }),
        history: Object.freeze({ canUndo: true, canRedo: false }),
        selection: Object.freeze({
            nodeIds: Object.freeze(["node-1"]),
            connectionId: null,
            bounds: Object.freeze({ x: 20, y: 30, width: 320, height: 180 }),
            clientBounds: Object.freeze({ x: 180, y: 140, width: 640, height: 360 }),
            containsLockedNode: false,
            resizable: true,
            ...overrides,
        }),
    });
}

function adapter(current: CanvasSurfaceClientSnapshot, resizeEnabled = true): CanvasSurfaceClientAdapter {
    return {
        descriptor: {} as CanvasSurfaceClientAdapter["descriptor"],
        getSnapshot: () => current,
        refresh: () => current,
        subscribe: () => () => undefined,
        execute: vi.fn(async (command) => ({ ok: true as const, commandId: command.id as "selection.resize", snapshot: current })),
        commandEnabled: (commandId) => commandId === "selection.resize" && resizeEnabled,
        sceneToClient: vi.fn(),
        clientToScene: vi.fn(),
        sceneRectToClient: vi.fn(),
        destroy: vi.fn(),
    };
}

describe("Canvas selection size overlay", () => {
    it("maps browser-space selection bounds against the Canvas host viewport", () => {
        const model = canvasSelectionSizeOverlayModel(snapshot(), true);

        expect(model).toEqual({
            selectionBounds: { x: 180, y: 140, width: 640, height: 360 },
            viewportBounds: { x: 100, y: 50, width: 1_000, height: 700 },
            dimensions: { width: 320, height: 180, editable: true, locked: false, minWidth: 220, minHeight: 160 },
            visible: true,
            editable: true,
        });
        expect(Object.isFrozen(model)).toBe(true);
        expect(Object.isFrozen(model.viewportBounds)).toBe(true);
        expect(Object.isFrozen(model.dimensions)).toBe(true);
    });

    it("renders a shared editable size bar for one unlocked Canvas node", () => {
        const markup = renderToStaticMarkup(<CanvasSelectionSizeOverlay adapter={adapter(snapshot())} />);

        expect(markup).toContain("data-workspace-selection-size-bar");
        expect(markup).toContain('aria-label="Canvas 选区尺寸"');
        expect(markup).toContain('aria-label="选区宽度"');
        expect(markup).toContain('value="320"');
        expect(markup).toContain('value="180"');
        expect(markup).not.toContain("disabled");
        expect(markup).not.toContain("data-workspace-selection-prompt");
    });

    it("keeps multi-selection visible but read-only", () => {
        const multi = snapshot({ nodeIds: Object.freeze(["node-1", "node-2"]), resizable: false });
        const model = canvasSelectionSizeOverlayModel(multi, false);
        const markup = renderToStaticMarkup(<CanvasSelectionSizeOverlay adapter={adapter(multi, false)} />);

        expect(model).toMatchObject({ visible: true, editable: false });
        expect(markup).toContain("data-workspace-selection-size-bar");
        expect(markup).toContain("disabled");
    });

    it("keeps a locked selection visible, labeled and read-only", () => {
        const locked = snapshot({ containsLockedNode: true, resizable: false });
        const model = canvasSelectionSizeOverlayModel(locked, false);
        const markup = renderToStaticMarkup(<CanvasSelectionSizeOverlay adapter={adapter(locked, false)} />);

        expect(model.dimensions).toMatchObject({ editable: false, locked: true });
        expect(markup).toContain("disabled");
        expect(markup).toContain("已锁定");
    });

    it("renders nothing for connection-only or empty selection", () => {
        const connectionOnly = snapshot({ nodeIds: Object.freeze([]), connectionId: "edge-1", bounds: null, clientBounds: null, resizable: false });
        const empty = snapshot({ nodeIds: Object.freeze([]), bounds: null, clientBounds: null, resizable: false });

        expect(renderToStaticMarkup(<CanvasSelectionSizeOverlay adapter={adapter(connectionOnly, false)} />)).toBe("");
        expect(renderToStaticMarkup(<CanvasSelectionSizeOverlay adapter={adapter(empty, false)} />)).toBe("");
    });
});
