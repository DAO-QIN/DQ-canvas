import type { WorkspaceThemeTokens } from "@/components/creative-workspace";
import { canvasThemes, type CanvasColorTheme } from "@/lib/canvas-theme";

/** Maps the active DQ canvas palette to the domain-neutral workspace chrome. */
export function canvasWorkspaceTheme(colorTheme: CanvasColorTheme): WorkspaceThemeTokens {
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
