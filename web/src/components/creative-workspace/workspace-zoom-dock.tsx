"use client";

import type { CSSProperties, MouseEvent, ReactNode } from "react";

import styles from "./creative-workspace.module.css";
import { workspaceThemeStyle, type WorkspaceThemeTokens } from "./workspace-theme";

export type WorkspaceZoomActionDescriptor = {
    label: string;
    onPress?: (event: MouseEvent<HTMLButtonElement>) => void;
    icon?: ReactNode;
    disabled?: boolean;
};

export type WorkspaceZoomDockDescriptor = {
    value: ReactNode;
    valueLabel?: string;
    zoomOut: WorkspaceZoomActionDescriptor;
    zoomIn: WorkspaceZoomActionDescriptor;
    fit?: WorkspaceZoomActionDescriptor;
};

export type WorkspaceZoomDockProps = {
    theme: WorkspaceThemeTokens;
    descriptor: WorkspaceZoomDockDescriptor;
    leading?: ReactNode;
    trailing?: ReactNode;
    ariaLabel?: string;
    className?: string;
    style?: CSSProperties;
};

export function WorkspaceZoomDock({ theme, descriptor, leading, trailing, ariaLabel = "缩放控制", className, style }: WorkspaceZoomDockProps) {
    return (
        <div
            className={classNames(styles.zoomDock, className)}
            style={workspaceThemeStyle(theme, style)}
            role="toolbar"
            aria-label={ariaLabel}
            aria-orientation="horizontal"
            data-workspace-zoom-dock
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            {leading}
            <ZoomButton action={descriptor.zoomOut} fallbackIcon="−" />
            <output className={styles.zoomValue} aria-label={descriptor.valueLabel || "当前缩放比例"} aria-live="polite">
                {descriptor.value}
            </output>
            <ZoomButton action={descriptor.zoomIn} fallbackIcon="+" />
            {descriptor.fit ? (
                <>
                    <span className={styles.zoomSeparator} role="separator" aria-orientation="vertical" />
                    <ZoomButton action={descriptor.fit} fallbackIcon="适应" wide />
                </>
            ) : null}
            {trailing}
        </div>
    );
}

function ZoomButton({ action, fallbackIcon, wide = false }: { action: WorkspaceZoomActionDescriptor; fallbackIcon: ReactNode; wide?: boolean }) {
    return (
        <button type="button" className={classNames(styles.zoomButton, wide ? styles.zoomButtonWide : undefined)} aria-label={action.label} title={action.label} disabled={action.disabled} onClick={action.onPress}>
            <span aria-hidden="true">{action.icon || fallbackIcon}</span>
        </button>
    );
}

function classNames(...values: Array<string | undefined>) {
    return values.filter(Boolean).join(" ");
}
