import type { CSSProperties, ReactNode } from "react";

import styles from "./creative-workspace.module.css";
import { workspaceThemeStyle, type WorkspaceThemeTokens } from "./workspace-theme";

export type CreativeWorkspaceShellProps = {
    children: ReactNode;
    theme: WorkspaceThemeTokens;
    topBar?: ReactNode;
    overlays?: ReactNode;
    toolDock?: ReactNode;
    zoomDock?: ReactNode;
    rightRail?: ReactNode;
    canvasAriaLabel?: string;
    className?: string;
    canvasClassName?: string;
    style?: CSSProperties;
};

/**
 * Shared full-screen layout only. Feature controllers remain responsible for
 * editor state, commands, persistence and the contents of every slot.
 */
export function CreativeWorkspaceShell({ children, theme, topBar, overlays, toolDock, zoomDock, rightRail, canvasAriaLabel = "创作工作区", className, canvasClassName, style }: CreativeWorkspaceShellProps) {
    return (
        <div className={classNames(styles.workspaceShell, className)} style={workspaceThemeStyle(theme, style)} data-creative-workspace-shell>
            <main className={classNames(styles.canvasPane, canvasClassName)} aria-label={canvasAriaLabel}>
                <div className={styles.canvasBackdrop} aria-hidden="true" />
                <div className={styles.canvasContent}>{children}</div>
                {overlays ? <div className={styles.overlaySlot}>{overlays}</div> : null}
                {topBar ? <div className={styles.topBarSlot}>{topBar}</div> : null}
                {zoomDock ? <div className={styles.zoomDockSlot}>{zoomDock}</div> : null}
                {toolDock ? <div className={styles.toolDockSlot}>{toolDock}</div> : null}
            </main>
            {rightRail}
        </div>
    );
}

function classNames(...values: Array<string | undefined>) {
    return values.filter(Boolean).join(" ");
}
