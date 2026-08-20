"use client";

import { useCallback, useSyncExternalStore } from "react";

import { WorkspaceSelectionSizeBar, type WorkspaceRect, type WorkspaceSelectionDimensions } from "@/components/creative-workspace";

import type { CanvasSurfaceClientAdapter, CanvasSurfaceClientSnapshot, CanvasSurfaceCommandResult } from "./canvas-surface-client-adapter";

export type CanvasSelectionSizeOverlayProps = Readonly<{
    adapter: CanvasSurfaceClientAdapter;
    onCommandResult?: (result: CanvasSurfaceCommandResult) => void;
}>;

export type CanvasSelectionSizeOverlayModel = Readonly<{
    selectionBounds: WorkspaceRect | null;
    viewportBounds: WorkspaceRect;
    dimensions: WorkspaceSelectionDimensions;
    visible: boolean;
    editable: boolean;
}>;

/**
 * Canvas feature bridge for the shared selection size bar. It intentionally
 * exposes no Prompt UI: Canvas keeps its existing node prompt panels and does
 * not claim the shared selection.prompt capability.
 */
export function CanvasSelectionSizeOverlay({ adapter, onCommandResult }: CanvasSelectionSizeOverlayProps) {
    const subscribe = useCallback((notify: () => void) => adapter.subscribe(() => notify()), [adapter]);
    const snapshot = useSyncExternalStore(subscribe, adapter.getSnapshot, adapter.getSnapshot);
    const model = canvasSelectionSizeOverlayModel(snapshot, adapter.commandEnabled("selection.resize"));

    const commit = useCallback(
        async ({ width, height }: Readonly<{ width: number; height: number }>) => {
            const result = await adapter.execute({ id: "selection.resize", width, height });
            onCommandResult?.(result);
        },
        [adapter, onCommandResult],
    );

    if (!model.visible) return null;
    return <WorkspaceSelectionSizeBar selectionBounds={model.selectionBounds} viewportBounds={model.viewportBounds} dimensions={model.dimensions} onCommit={model.editable ? commit : undefined} ariaLabel="Canvas 选区尺寸" />;
}

export function canvasSelectionSizeOverlayModel(snapshot: CanvasSurfaceClientSnapshot, resizeCommandEnabled: boolean): CanvasSelectionSizeOverlayModel {
    const bounds = snapshot.selection.bounds;
    const clientBounds = snapshot.selection.clientBounds;
    const visible = Boolean(bounds && clientBounds && snapshot.selection.nodeIds.length);
    const editable = visible && snapshot.selection.nodeIds.length === 1 && snapshot.selection.resizable && resizeCommandEnabled;

    return Object.freeze({
        selectionBounds: clientBounds,
        viewportBounds: Object.freeze({
            x: snapshot.surfaceClientRect.left,
            y: snapshot.surfaceClientRect.top,
            width: snapshot.viewportSize.width,
            height: snapshot.viewportSize.height,
        }),
        dimensions: Object.freeze({
            width: bounds?.width ?? 0,
            height: bounds?.height ?? 0,
            editable,
            locked: snapshot.selection.containsLockedNode,
            minWidth: 220,
            minHeight: 160,
        }),
        visible,
        editable,
    });
}
