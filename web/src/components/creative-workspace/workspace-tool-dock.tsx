"use client";

import type { AriaAttributes, CSSProperties, MouseEvent, ReactNode } from "react";

import styles from "./creative-workspace.module.css";
import { workspaceThemeStyle, type WorkspaceThemeTokens } from "./workspace-theme";

export type WorkspaceToolActionDescriptor = {
    kind: "action";
    id: string;
    label: string;
    icon: ReactNode;
    onPress?: (event: MouseEvent<HTMLButtonElement>) => void;
    active?: boolean;
    disabled?: boolean;
    busy?: boolean;
    danger?: boolean;
    hidden?: boolean;
    keyShortcut?: string;
    controls?: string;
    expanded?: boolean;
    popup?: AriaAttributes["aria-haspopup"];
};

export type WorkspaceToolSeparatorDescriptor = {
    kind: "separator";
    id?: string;
};

export type WorkspaceToolDockEntry = WorkspaceToolActionDescriptor | WorkspaceToolSeparatorDescriptor;

export type WorkspaceToolDockProps = {
    theme: WorkspaceThemeTokens;
    items: WorkspaceToolDockEntry[];
    leading?: ReactNode;
    trailing?: ReactNode;
    ariaLabel?: string;
    className?: string;
    style?: CSSProperties;
};

export function WorkspaceToolDock({ theme, items, leading, trailing, ariaLabel = "创作工具", className, style }: WorkspaceToolDockProps) {
    return (
        <div className={styles.toolDockViewport} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
            <div className={classNames(styles.toolDock, className)} style={workspaceThemeStyle(theme, style)} role="toolbar" aria-label={ariaLabel} aria-orientation="horizontal" data-workspace-tool-dock>
                {leading ? <div className={styles.toolDockSlotContent}>{leading}</div> : null}
                {items.map((entry, index) => {
                    if (entry.kind === "separator") {
                        return <span key={entry.id || `separator-${index}`} className={styles.toolSeparator} role="separator" aria-orientation="vertical" />;
                    }
                    if (entry.hidden) return null;
                    const title = entry.keyShortcut ? `${entry.label} (${entry.keyShortcut})` : entry.label;
                    return (
                        <button
                            key={entry.id}
                            type="button"
                            className={classNames(styles.toolButton, entry.active ? styles.toolButtonActive : undefined, entry.danger ? styles.toolButtonDanger : undefined)}
                            aria-label={entry.label}
                            aria-pressed={typeof entry.active === "boolean" ? entry.active : undefined}
                            aria-busy={entry.busy || undefined}
                            aria-keyshortcuts={entry.keyShortcut}
                            aria-controls={entry.controls}
                            aria-expanded={entry.expanded}
                            aria-haspopup={entry.popup}
                            title={title}
                            disabled={entry.disabled}
                            data-workspace-tool-id={entry.id}
                            data-busy={entry.busy ? "true" : undefined}
                            onClick={entry.onPress}
                        >
                            <span className={classNames(styles.toolIcon, entry.busy ? styles.busyIcon : undefined)} aria-hidden="true">
                                {entry.icon}
                            </span>
                        </button>
                    );
                })}
                {trailing ? <div className={styles.toolDockSlotContent}>{trailing}</div> : null}
            </div>
        </div>
    );
}

function classNames(...values: Array<string | undefined>) {
    return values.filter(Boolean).join(" ");
}
