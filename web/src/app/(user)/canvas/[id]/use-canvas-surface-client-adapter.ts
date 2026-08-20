"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

import { createCanvasSurfaceClientAdapter, type CanvasSurfaceChangeKind, type CanvasSurfaceClientAdapter, type CanvasSurfaceClientState } from "../components/creative-workspace-adapter";

import type { CanvasInteractions } from "./use-canvas-interactions";
import type { CanvasMediaActions } from "./use-canvas-media-actions";
import type { CanvasPageState } from "./use-canvas-page-state";

type CanvasSurfaceClientRuntime = Readonly<{
    state: CanvasPageState;
    interactions: CanvasInteractions;
    media: CanvasMediaActions;
}>;

/**
 * Owns exactly one Canvas surface adapter for a mounted controller. Adapter
 * reads always resolve through the latest runtime ref; effects only publish
 * classified changes for shared overlays and other subscribers.
 */
export function useCanvasSurfaceClientAdapter(runtime: CanvasSurfaceClientRuntime): CanvasSurfaceClientAdapter {
    const runtimeRef = useRef(runtime);
    runtimeRef.current = runtime;

    const adapterRef = useRef<CanvasSurfaceClientAdapter | null>(null);
    const destroyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingNodeChangeRef = useRef<CanvasSurfaceChangeKind | null>(null);
    if (!adapterRef.current) {
        adapterRef.current = createCanvasSurfaceClientAdapter({
            readState: () => readCanvasSurfaceState(runtimeRef.current.state),
            autoRefresh: false,
            handlers: {
                undo: () => runtimeRef.current.interactions.undoCanvas(),
                redo: () => runtimeRef.current.interactions.redoCanvas(),
                setViewport: (viewport) => runtimeRef.current.state.setViewport(viewport),
                setZoomScale: (scale) => runtimeRef.current.interactions.setZoomScale(scale),
                resetViewport: () => runtimeRef.current.interactions.resetViewport(),
                clearSelection: () => runtimeRef.current.interactions.deselectCanvas(),
                deleteNodes: (nodeIds) => runtimeRef.current.interactions.deleteNodes(nodeIds),
                deleteConnection: (connectionId) => runtimeRef.current.interactions.deleteConnection(connectionId),
                resizeNode: (nodeId, width, height, position) => {
                    pendingNodeChangeRef.current = "resize";
                    try {
                        runtimeRef.current.media.handleNodeResize(nodeId, width, height, position);
                    } catch (error) {
                        pendingNodeChangeRef.current = null;
                        throw error;
                    }
                },
                createNode: (nodeType, position) => runtimeRef.current.interactions.createNode(nodeType, position),
            },
        });
    }
    const adapter = adapterRef.current;

    useLayoutEffect(() => {
        adapter.refresh("history");
    }, [adapter, runtime.state.historyState.canRedo, runtime.state.historyState.canUndo]);
    useLayoutEffect(() => {
        adapter.refresh("viewport");
    }, [adapter, runtime.state.viewport]);
    useLayoutEffect(() => {
        adapter.refresh("selection");
    }, [adapter, runtime.state.selectedConnectionId, runtime.state.selectedNodeIds]);
    useLayoutEffect(() => {
        adapter.refresh("resize");
    }, [adapter, runtime.state.size]);
    useLayoutEffect(() => {
        const change = pendingNodeChangeRef.current ?? "document";
        pendingNodeChangeRef.current = null;
        adapter.refresh(change);
    }, [adapter, runtime.state.nodes]);

    useEffect(() => {
        if (destroyTimerRef.current) {
            clearTimeout(destroyTimerRef.current);
            destroyTimerRef.current = null;
        }
        return () => {
            destroyTimerRef.current = setTimeout(() => {
                adapter.destroy();
                if (adapterRef.current === adapter) adapterRef.current = null;
                destroyTimerRef.current = null;
            });
        };
    }, [adapter]);

    return adapter;
}

export function readCanvasSurfaceState(state: CanvasPageState): CanvasSurfaceClientState {
    const rect = state.containerRef.current?.getBoundingClientRect();
    return {
        projectId: state.projectId,
        nodes: state.nodesRef.current,
        selectedNodeIds: state.selectedNodeIdsRef.current,
        selectedConnectionId: state.selectedConnectionId,
        viewport: state.viewportRef.current,
        viewportSize: state.size,
        surfaceClientRect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : undefined,
        canUndo: state.historyState.canUndo,
        canRedo: state.historyState.canRedo,
    };
}

export const CANVAS_SURFACE_CHANGE_KINDS = Object.freeze(["history", "viewport", "selection", "resize", "document"] satisfies readonly CanvasSurfaceChangeKind[]);
