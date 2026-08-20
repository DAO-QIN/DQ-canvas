"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef } from "react";

import { useCanvasStore } from "../stores/use-canvas-store";
import { clearHandledCanvasBackgroundRemovalTaskMetadataFromNodes, reconcileCanvasHistoryBackgroundRemovalTasks } from "../utils/canvas-active-task-binding";

const CanvasAssistantPanel = dynamic(() => import("../components/canvas-assistant-panel").then((mod) => mod.CanvasAssistantPanel), { ssr: false });
const loadAssetPickerModal = () => import("../components/asset-picker-modal").then((mod) => mod.AssetPickerModal);
const AssetPickerModal = dynamic(loadAssetPickerModal, { ssr: false, loading: () => null });

import { CanvasHistoryEntry } from "./canvas-page-elements";

import type { CanvasPageState } from "./use-canvas-page-state";

export function useCanvasNavigationActions({ state }: { state: CanvasPageState }) {
    const {
        message,
        router,
        projectId,
        historyRef,
        lastHistoryRef,
        historyCommitTimerRef,
        applyingHistoryRef,
        viewportSaveTimerRef,
        createProject,
        updateProject,
        flushProject,
        deleteProjects,
        nodes,
        setNodes,
        connections,
        setConnections,
        chatSessions,
        setChatSessions,
        activeChatId,
        setActiveChatId,
        setViewport,
        size,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setContextMenu,
        backgroundMode,
        setBackgroundMode,
        showImageInfo,
        setShowImageInfo,
        setHistoryState,
        nodesRef,
        connectionsRef,
        viewportRef,
        backgroundRemovalHandledTaskIdsRef,
    } = state;
    const navigationInFlightRef = useRef<Promise<boolean> | null>(null);

    const flushCurrentProject = useCallback(async () => {
        if (viewportSaveTimerRef.current) {
            clearTimeout(viewportSaveTimerRef.current);
            viewportSaveTimerRef.current = null;
        }
        updateProject(projectId, {
            nodes: clearHandledCanvasBackgroundRemovalTaskMetadataFromNodes(nodesRef.current),
            connections: connectionsRef.current,
            chatSessions,
            activeChatId,
            backgroundMode,
            showImageInfo,
            viewport: viewportRef.current,
        });
        await flushProject(projectId);
    }, [activeChatId, backgroundMode, chatSessions, connectionsRef, flushProject, nodesRef, projectId, showImageInfo, updateProject, viewportRef, viewportSaveTimerRef]);

    const navigateAfterFlush = useCallback(
        (navigate: () => void | Promise<void>, fallbackMessage = "画布保存失败，已留在当前页面") => {
            if (navigationInFlightRef.current) return navigationInFlightRef.current;
            const operation = (async () => {
                try {
                    await flushCurrentProject();
                    await navigate();
                    return true;
                } catch (error) {
                    message.error(error instanceof Error ? error.message : fallbackMessage);
                    return false;
                }
            })().finally(() => {
                navigationInFlightRef.current = null;
            });
            navigationInFlightRef.current = operation;
            return operation;
        },
        [flushCurrentProject, message],
    );

    const resetViewport = useCallback(() => {
        setViewport({ x: size.width / 2, y: size.height / 2, k: 1 });
        setContextMenu(null);
    }, [size.height, size.width]);

    const locateCanvasNode = useCallback(
        (nodeId: string) => {
            const node = nodesRef.current.find((item) => item.id === nodeId);
            if (!node) return;
            const k = Math.min(1, Math.max(0.45, viewportRef.current.k));
            setSelectedNodeIds(new Set([nodeId]));
            setViewport({ x: size.width / 2 - (node.position.x + node.width / 2) * k, y: size.height / 2 - (node.position.y + node.height / 2) * k, k });
        },
        [size.height, size.width],
    );

    const setZoomScale = useCallback(
        (scale: number) => {
            const nextScale = Math.min(Math.max(scale, 0.05), 5);
            setViewport((prev) => ({
                x: size.width / 2 - ((size.width / 2 - prev.x) / prev.k) * nextScale,
                y: size.height / 2 - ((size.height / 2 - prev.y) / prev.k) * nextScale,
                k: nextScale,
            }));
            setContextMenu(null);
        },
        [size.height, size.width],
    );

    const applyHistory = useCallback((entry: CanvasHistoryEntry) => {
        if (historyCommitTimerRef.current) {
            clearTimeout(historyCommitTimerRef.current);
            historyCommitTimerRef.current = null;
        }
        applyingHistoryRef.current = true;
        const restoredNodes = reconcileCanvasHistoryBackgroundRemovalTasks(entry.nodes, nodesRef.current, backgroundRemovalHandledTaskIdsRef.current);
        const restoredEntry = restoredNodes === entry.nodes ? entry : { ...entry, nodes: restoredNodes };
        setNodes(restoredNodes);
        setConnections(entry.connections);
        setChatSessions(entry.chatSessions);
        setActiveChatId(entry.activeChatId);
        setBackgroundMode(entry.backgroundMode);
        setShowImageInfo(entry.showImageInfo);
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setTimeout(() => {
            lastHistoryRef.current = restoredEntry;
            applyingHistoryRef.current = false;
            setHistoryState({ canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0 });
        });
    }, []);

    const undoCanvas = useCallback(() => {
        const previous = historyRef.current.past.pop();
        const current = lastHistoryRef.current;
        if (!previous || !current) return;
        historyRef.current.future.push(current);
        applyHistory(previous);
    }, [applyHistory]);

    const redoCanvas = useCallback(() => {
        const next = historyRef.current.future.pop();
        const current = lastHistoryRef.current;
        if (!next || !current) return;
        historyRef.current.past.push(current);
        applyHistory(next);
    }, [applyHistory]);

    const navigateToWorkbench = useCallback(() => navigateAfterFlush(() => router.push("/create")), [navigateAfterFlush, router]);

    const navigateToProjects = useCallback(() => navigateAfterFlush(() => router.push("/canvas")), [navigateAfterFlush, router]);

    const createAndOpenProject = useCallback(
        () =>
            navigateAfterFlush(async () => {
                const id = await createProject(`DQ-绘图 画布 ${useCanvasStore.getState().summaries.length + 1}`);
                router.push(`/canvas/${id}`);
            }, "画布创建失败"),
        [createProject, navigateAfterFlush, router],
    );

    const deleteCurrentProject = useCallback(async () => {
        try {
            await deleteProjects([projectId]);
            router.push("/canvas");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "画布删除失败");
        }
    }, [deleteProjects, message, projectId, router]);
    return {
        resetViewport,
        locateCanvasNode,
        setZoomScale,
        applyHistory,
        undoCanvas,
        redoCanvas,
        flushCurrentProject,
        navigateToWorkbench,
        navigateToProjects,
        createAndOpenProject,
        deleteCurrentProject,
    };
}

export type CanvasNavigationActions = ReturnType<typeof useCanvasNavigationActions>;
