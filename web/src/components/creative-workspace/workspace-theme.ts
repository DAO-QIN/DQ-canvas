import type { CSSProperties } from "react";

/**
 * Domain-neutral visual tokens for full-screen creative workspaces.
 *
 * Feature code owns the mapping from its active theme to these tokens. Shared
 * workspace components intentionally do not read an application or feature
 * store, so they can be reused by any editor surface.
 */
export type WorkspaceThemeTokens = {
    canvasBackground: string;
    canvasBackdrop?: string;
    panelBackground: string;
    panelBorder: string;
    railBackground?: string;
    foreground: string;
    mutedForeground: string;
    controlForeground: string;
    controlHoverBackground: string;
    activeBackground: string;
    activeForeground: string;
    dangerForeground: string;
    focusRing: string;
    successForeground?: string;
    warningForeground?: string;
    infoForeground?: string;
    panelShadow?: string;
};

type WorkspaceCustomProperties = {
    "--creative-workspace-canvas": string;
    "--creative-workspace-backdrop": string;
    "--creative-workspace-panel": string;
    "--creative-workspace-panel-border": string;
    "--creative-workspace-rail": string;
    "--creative-workspace-foreground": string;
    "--creative-workspace-muted": string;
    "--creative-workspace-control": string;
    "--creative-workspace-control-hover": string;
    "--creative-workspace-active": string;
    "--creative-workspace-active-foreground": string;
    "--creative-workspace-danger": string;
    "--creative-workspace-focus": string;
    "--creative-workspace-success": string;
    "--creative-workspace-warning": string;
    "--creative-workspace-info": string;
    "--creative-workspace-panel-shadow": string;
};

export function workspaceThemeStyle(theme: WorkspaceThemeTokens, style?: CSSProperties): CSSProperties {
    const properties: WorkspaceCustomProperties = {
        "--creative-workspace-canvas": theme.canvasBackground,
        "--creative-workspace-backdrop": theme.canvasBackdrop || "none",
        "--creative-workspace-panel": theme.panelBackground,
        "--creative-workspace-panel-border": theme.panelBorder,
        "--creative-workspace-rail": theme.railBackground || theme.panelBackground,
        "--creative-workspace-foreground": theme.foreground,
        "--creative-workspace-muted": theme.mutedForeground,
        "--creative-workspace-control": theme.controlForeground,
        "--creative-workspace-control-hover": theme.controlHoverBackground,
        "--creative-workspace-active": theme.activeBackground,
        "--creative-workspace-active-foreground": theme.activeForeground,
        "--creative-workspace-danger": theme.dangerForeground,
        "--creative-workspace-focus": theme.focusRing,
        "--creative-workspace-success": theme.successForeground || theme.foreground,
        "--creative-workspace-warning": theme.warningForeground || theme.foreground,
        "--creative-workspace-info": theme.infoForeground || theme.foreground,
        "--creative-workspace-panel-shadow": theme.panelShadow || "0 12px 36px rgb(0 0 0 / 34%)",
    };

    return { ...properties, ...style } as CSSProperties;
}
