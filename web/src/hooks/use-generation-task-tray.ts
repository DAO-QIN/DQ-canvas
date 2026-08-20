"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import type { CreativeWorkspaceGenerationTask } from "@/lib/creative-workspace";
import { listCreativeWorkspaceGenerationTasks } from "@/services/api/generation-tasks";

export const CREATIVE_WORKSPACE_GENERATION_TASK_CREATED_EVENT = "creative-workspace:generation-task-created";

export type GenerationTaskSurface = "canvas" | "design";

export function useGenerationTaskTray(input: { surface: GenerationTaskSurface; projectId: string; enabled?: boolean }) {
    const enabled = input.enabled !== false;
    const query = useQuery<CreativeWorkspaceGenerationTask[]>({
        queryKey: ["creative-workspace-generation-tasks", input.surface, input.projectId],
        queryFn: ({ signal }) => listCreativeWorkspaceGenerationTasks(input.surface, input.projectId, { activeOnly: false, limit: 50, signal }),
        enabled: enabled && Boolean(input.projectId),
        refetchInterval: (current) => taskRefetchInterval(current.state.data || []),
        refetchOnWindowFocus: true,
        staleTime: 1_000,
    });

    const refetch = query.refetch;
    useEffect(() => {
        const handleCreated = (event: Event) => {
            const detail = (event as CustomEvent<{ surface?: GenerationTaskSurface; projectId?: string }>).detail;
            if ((!detail?.surface || detail.surface === input.surface) && (!detail?.projectId || detail.projectId === input.projectId)) void refetch();
        };
        window.addEventListener(CREATIVE_WORKSPACE_GENERATION_TASK_CREATED_EVENT, handleCreated);
        return () => window.removeEventListener(CREATIVE_WORKSPACE_GENERATION_TASK_CREATED_EVENT, handleCreated);
    }, [input.projectId, input.surface, refetch]);

    return {
        tasks: activeGenerationTasks(query.data || []),
        recoveryTasks: query.data || [],
        loading: query.isLoading,
        refreshing: query.isFetching,
        error: query.error instanceof Error ? query.error : null,
        refetch: query.refetch,
    };
}

export function activeGenerationTasks(tasks: readonly CreativeWorkspaceGenerationTask[]) {
    return tasks.filter((task) => task.status === "queued" || task.status === "running" || task.status === "paused");
}

export function taskRefetchInterval(tasks: readonly CreativeWorkspaceGenerationTask[]) {
    if (tasks.some((task) => task.type === "image_process" && (task.status === "queued" || task.status === "running"))) return 1_000;
    return activeGenerationTasks(tasks).length ? 2_000 : 4_000;
}

export function notifyGenerationTaskCreated(surface: GenerationTaskSurface, projectId: string) {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(CREATIVE_WORKSPACE_GENERATION_TASK_CREATED_EVENT, { detail: { surface, projectId } }));
}
