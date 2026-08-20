"use client";

import { AlertTriangle, Check, CheckCircle2, LoaderCircle, RefreshCw, X } from "lucide-react";

import type { WorkspaceAgentActionState } from "@/lib/creative-workspace";

import styles from "./workspace-agent-action-card.module.css";

export type WorkspaceAgentActionCardProps = Readonly<{
    state: WorkspaceAgentActionState;
    onConfirm: () => void;
    onReject: () => void;
    onRetry: () => void;
}>;

export function WorkspaceAgentActionCard({ state, onConfirm, onReject, onRetry }: WorkspaceAgentActionCardProps) {
    if (state.status === "idle") return null;
    const pending = state.status === "pending-confirmation";
    const busy = state.status === "confirming" || state.status === "executing" || state.status === "submitting" || state.status === "rejecting";
    const error = state.status === "conflict" || state.status === "error" || state.status === "rejected";
    const title = actionStateTitle(state);

    return (
        <section className={styles.card} data-workspace-action-card data-status={state.status} aria-live="polite" aria-busy={busy || undefined}>
            <header className={styles.header}>
                <span className={styles.statusIcon} data-tone={error ? "danger" : pending ? "warning" : state.status === "applied" ? "success" : "info"}>
                    {busy ? <LoaderCircle aria-hidden className={styles.spinner} /> : error ? <AlertTriangle aria-hidden /> : state.status === "applied" ? <CheckCircle2 aria-hidden /> : <Check aria-hidden />}
                </span>
                <div className={styles.heading}>
                    <strong>{title}</strong>
                    <span>
                        r{state.request.baseRevision} · {state.request.actions.length} 项
                    </span>
                </div>
            </header>

            <ul className={styles.actions} aria-label="工作区操作摘要">
                {state.request.actions.map((action) => (
                    <li key={action.actionId}>
                        <span>{action.label}</span>
                        <small>{action.targetIds.length ? `${action.targetIds.length} 个目标` : action.effect === "read" ? "只读" : "工作区"}</small>
                    </li>
                ))}
            </ul>

            {"message" in state && state.message ? <p className={styles.message}>{state.message}</p> : null}
            {state.status === "applied" ? (
                <p className={styles.receipt}>
                    服务端回执 r{state.receipt.resultRevision}
                    {state.replayed ? " · 已重放" : ""}
                </p>
            ) : null}

            {pending || state.status === "error" ? (
                <div className={styles.controls}>
                    <button type="button" className={styles.secondaryButton} onClick={onReject}>
                        <X aria-hidden />
                        拒绝
                    </button>
                    {pending ? (
                        <button type="button" className={styles.primaryButton} onClick={onConfirm}>
                            <Check aria-hidden />
                            确认
                        </button>
                    ) : state.retryable ? (
                        <button type="button" className={styles.primaryButton} onClick={onRetry}>
                            <RefreshCw aria-hidden />
                            重试
                        </button>
                    ) : null}
                </div>
            ) : null}
        </section>
    );
}

function actionStateTitle(state: Exclude<WorkspaceAgentActionState, Readonly<{ status: "idle" }>>) {
    if (state.status === "pending-confirmation") return "确认工作区操作";
    if (state.status === "confirming") return "正在确认操作";
    if (state.status === "executing") return "正在应用操作";
    if (state.status === "submitting") return "正在提交回执";
    if (state.status === "rejecting") return "正在拒绝操作";
    if (state.status === "applied") return state.replayed ? "操作回执已恢复" : "操作已应用";
    if (state.status === "conflict") return "工作区版本冲突";
    if (state.status === "rejected") return "操作未执行";
    return "操作同步失败";
}
