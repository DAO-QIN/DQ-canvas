import type { CSSProperties, ReactNode } from "react";

import styles from "./creative-workspace.module.css";
import { workspaceThemeStyle, type WorkspaceThemeTokens } from "./workspace-theme";

export type WorkspaceStatusTone = "neutral" | "success" | "warning" | "danger" | "info";

export type WorkspaceStatusDescriptor = {
    label: ReactNode;
    detail?: string;
    icon?: ReactNode;
    tone?: WorkspaceStatusTone;
    busy?: boolean;
    role?: "status" | "alert";
};

export type WorkspaceTopBarDescriptor = {
    title: ReactNode;
    subtitle?: ReactNode;
    revision?: ReactNode;
    status?: WorkspaceStatusDescriptor;
};

export type WorkspaceTopBarSlots = {
    leading?: ReactNode;
    titlePrefix?: ReactNode;
    titleSuffix?: ReactNode;
    center?: ReactNode;
    actions?: ReactNode;
};

export type WorkspaceTopBarProps = {
    theme: WorkspaceThemeTokens;
    descriptor?: WorkspaceTopBarDescriptor;
    slots?: WorkspaceTopBarSlots;
    ariaLabel?: string;
    className?: string;
    style?: CSSProperties;
};

export function WorkspaceTopBar({ theme, descriptor, slots = {}, ariaLabel = "工作区状态与操作", className, style }: WorkspaceTopBarProps) {
    const status = descriptor?.status;
    return (
        <header className={classNames(styles.topBar, className)} style={workspaceThemeStyle(theme, style)} aria-label={ariaLabel} data-workspace-top-bar>
            <div className={styles.topBarIdentity}>
                {slots.leading ? <div className={styles.topBarLeading}>{slots.leading}</div> : null}
                {descriptor ? (
                    <div className={styles.topBarTitleBlock}>
                        <div className={styles.topBarTitleRow}>
                            {slots.titlePrefix}
                            <h1 className={styles.topBarTitle}>{descriptor.title}</h1>
                            {descriptor.revision ? <span className={styles.revisionBadge}>{descriptor.revision}</span> : null}
                            {slots.titleSuffix}
                        </div>
                        {descriptor.subtitle ? <p className={styles.topBarSubtitle}>{descriptor.subtitle}</p> : null}
                    </div>
                ) : null}
            </div>
            {slots.center ? <div className={styles.topBarCenter}>{slots.center}</div> : null}
            <div className={styles.topBarActions}>
                {status ? <WorkspaceStatus status={status} /> : null}
                {slots.actions}
            </div>
        </header>
    );
}

function WorkspaceStatus({ status }: { status: WorkspaceStatusDescriptor }) {
    const tone = status.tone || "neutral";
    return (
        <span
            className={classNames(styles.workspaceStatus, statusToneClass[tone], status.busy ? styles.workspaceStatusBusy : undefined)}
            role={status.role || "status"}
            aria-live={status.role === "alert" ? "assertive" : "polite"}
            aria-busy={status.busy || undefined}
            title={status.detail}
            data-tone={tone}
        >
            {status.icon ? <span className={styles.statusIcon}>{status.icon}</span> : null}
            <span>{status.label}</span>
        </span>
    );
}

const statusToneClass: Record<WorkspaceStatusTone, string> = {
    neutral: styles.statusNeutral,
    success: styles.statusSuccess,
    warning: styles.statusWarning,
    danger: styles.statusDanger,
    info: styles.statusInfo,
};

function classNames(...values: Array<string | undefined>) {
    return values.filter(Boolean).join(" ");
}
