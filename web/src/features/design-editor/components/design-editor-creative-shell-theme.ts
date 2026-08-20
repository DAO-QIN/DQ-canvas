import type { WorkspaceStatusDescriptor, WorkspaceThemeTokens } from "@/components/creative-workspace";
import { canvasThemes, type CanvasColorTheme } from "@/lib/canvas-theme";

import type { DesignEditorSaveStatus } from "../store/design-editor-store";

export function designWorkspaceTheme(colorTheme: CanvasColorTheme): WorkspaceThemeTokens {
    const theme = canvasThemes[colorTheme];
    return {
        canvasBackground: theme.canvas.background,
        canvasBackdrop: theme.canvas.backdrop,
        panelBackground: theme.toolbar.panel,
        panelBorder: theme.toolbar.border,
        railBackground: theme.node.panel,
        foreground: theme.node.text,
        mutedForeground: theme.node.muted,
        controlForeground: theme.toolbar.item,
        controlHoverBackground: theme.toolbar.itemHover,
        activeBackground: theme.toolbar.activeBg,
        activeForeground: theme.toolbar.activeText,
        dangerForeground: theme.node.danger,
        focusRing: theme.canvas.selectionStroke,
        successForeground: colorTheme === "dark" ? "#34d399" : "#047857",
        warningForeground: colorTheme === "dark" ? "#fbbf24" : "#a16207",
        infoForeground: colorTheme === "dark" ? "#93c5fd" : "#2563eb",
        panelShadow: colorTheme === "dark" ? "0 16px 50px rgb(0 0 0 / 42%)" : "0 16px 48px rgb(30 41 59 / 18%)",
    };
}

export function designSaveStatusDescriptor(status: DesignEditorSaveStatus, detail: string | null = null): WorkspaceStatusDescriptor {
    if (status === "saved") return { label: "已保存", detail: detail || undefined, tone: "success" };
    if (status === "dirty") return { label: "待保存", detail: detail || undefined, tone: "warning" };
    if (status === "saving") return { label: "保存中", detail: detail || undefined, tone: "info", busy: true };
    if (status === "conflict") return { label: "版本冲突", detail: detail || undefined, tone: "danger", role: "alert" };
    if (status === "error") return { label: "保存失败", detail: detail || undefined, tone: "danger", role: "alert" };
    if (status === "not-found") return { label: "项目不存在", detail: detail || undefined, tone: "danger", role: "alert" };
    return { label: "载入中", detail: detail || undefined, tone: "info", busy: true };
}
