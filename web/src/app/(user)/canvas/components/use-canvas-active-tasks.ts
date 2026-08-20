"use client";

import { useEffect } from "react";

import { useGenerationTaskTray } from "@/hooks/use-generation-task-tray";
import { CANVAS_GENERATION_TASK_CREATED_EVENT } from "../utils/canvas-generation-task-events";

export function useCanvasActiveTasks(projectId: string, enabled = true) {
    const query = useGenerationTaskTray({ surface: "canvas", projectId, enabled });
    const refetch = query.refetch;

    useEffect(() => {
        const handleCreated = (event: Event) => {
            const detail = (event as CustomEvent<{ projectId?: string }>).detail;
            if (!detail?.projectId || detail.projectId === projectId) void refetch();
        };
        window.addEventListener(CANVAS_GENERATION_TASK_CREATED_EVENT, handleCreated);
        window.addEventListener("canvas:task-created", handleCreated);
        return () => {
            window.removeEventListener(CANVAS_GENERATION_TASK_CREATED_EVENT, handleCreated);
            window.removeEventListener("canvas:task-created", handleCreated);
        };
    }, [projectId, refetch]);

    return {
        ...query,
    };
}
