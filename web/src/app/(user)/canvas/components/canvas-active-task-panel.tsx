"use client";

import { GenerationTaskCard, GenerationTaskTray } from "@/components/creative-workspace";
import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasGenerationTask } from "@/services/api/generation-tasks";
import { useThemeStore } from "@/stores/use-theme-store";

import { canvasWorkspaceTheme } from "./creative-workspace-adapter/canvas-workspace-theme";

export function CanvasActiveTaskPanel({ projectId, tasks }: { projectId: string; tasks: CanvasGenerationTask[] }) {
    const colorTheme = useThemeStore((state) => state.theme);
    return <GenerationTaskTray surface="canvas" projectId={projectId} tasks={tasks} theme={canvasWorkspaceTheme(colorTheme)} />;
}

/** Compatibility export for focused Canvas tests and feature-local consumers. */
export function ActiveTaskCard({ task, now, expanded, onToggle }: { task: CanvasGenerationTask; now: number; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; expanded: boolean; onToggle: () => void }) {
    return <GenerationTaskCard task={task} now={now} expanded={expanded} onToggle={onToggle} />;
}
