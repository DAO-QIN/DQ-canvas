"use client";

import type { CSSProperties, ReactNode } from "react";

import styles from "./creative-workspace.module.css";
import { workspaceThemeStyle, type WorkspaceThemeTokens } from "./workspace-theme";

export type WorkspaceRightRailDescriptor = {
    title: ReactNode;
    subtitle?: ReactNode;
    closeLabel?: string;
};

export type WorkspaceRightRailSlots = {
    titlePrefix?: ReactNode;
    actions?: ReactNode;
    footer?: ReactNode;
};

export type WorkspaceRightRailProps = {
    open: boolean;
    theme: WorkspaceThemeTokens;
    children: ReactNode;
    descriptor?: WorkspaceRightRailDescriptor;
    slots?: WorkspaceRightRailSlots;
    onClose?: () => void;
    closeIcon?: ReactNode;
    ariaLabel?: string;
    className?: string;
    bodyClassName?: string;
    style?: CSSProperties;
};

export function WorkspaceRightRail({ open, theme, children, descriptor, slots = {}, onClose, closeIcon, ariaLabel = "工作区辅助面板", className, bodyClassName, style }: WorkspaceRightRailProps) {
    const showHeader = Boolean(descriptor || slots.titlePrefix || slots.actions || onClose);
    return (
        <aside
            className={classNames(styles.rightRail, open ? styles.rightRailOpen : undefined, className)}
            style={workspaceThemeStyle(theme, style)}
            aria-label={ariaLabel}
            aria-hidden={!open}
            inert={!open}
            data-state={open ? "open" : "closed"}
            data-workspace-right-rail
            onPointerDown={(event) => event.stopPropagation()}
        >
            {showHeader ? (
                <header className={styles.rightRailHeader}>
                    <div className={styles.rightRailHeading}>
                        {slots.titlePrefix}
                        {descriptor ? (
                            <div className={styles.rightRailTitleBlock}>
                                <h2>{descriptor.title}</h2>
                                {descriptor.subtitle ? <p>{descriptor.subtitle}</p> : null}
                            </div>
                        ) : null}
                    </div>
                    <div className={styles.rightRailActions}>
                        {slots.actions}
                        {onClose ? (
                            <button type="button" className={styles.rightRailClose} aria-label={descriptor?.closeLabel || "关闭辅助面板"} title={descriptor?.closeLabel || "关闭辅助面板"} onClick={onClose}>
                                <span aria-hidden="true">{closeIcon || "×"}</span>
                            </button>
                        ) : null}
                    </div>
                </header>
            ) : null}
            <div className={classNames(styles.rightRailBody, bodyClassName)}>{children}</div>
            {slots.footer ? <footer className={styles.rightRailFooter}>{slots.footer}</footer> : null}
        </aside>
    );
}

function classNames(...values: Array<string | undefined>) {
    return values.filter(Boolean).join(" ");
}
