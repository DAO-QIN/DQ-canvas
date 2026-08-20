"use client";

import { ChevronDown, ChevronUp, Clock3, Coins, ListTodo, LoaderCircle, XCircle } from "lucide-react";
import { useEffect, useId, useState } from "react";

import type { CreativeWorkspaceGenerationTask } from "@/lib/creative-workspace";

import styles from "./generation-task-tray.module.css";
import { workspaceThemeStyle, type WorkspaceThemeTokens } from "./workspace-theme";

const statusLabel: Record<CreativeWorkspaceGenerationTask["status"], string> = {
    queued: "排队中",
    running: "生成中",
    paused: "已暂停",
    succeeded: "已完成",
    failed: "失败",
    cancelled: "已取消",
};

const typeLabel: Record<string, string> = {
    image: "图片生成",
    video: "视频生成",
    audio: "音频生成",
    text: "文本生成",
    agent: "Agent 任务",
    render: "渲染任务",
    image_process: "图片处理",
};

export type GenerationTaskTrayProps = Readonly<{
    surface: "canvas" | "design";
    projectId: string;
    tasks: readonly CreativeWorkspaceGenerationTask[];
    theme: WorkspaceThemeTokens;
    label?: string;
    getTaskActions?: (task: CreativeWorkspaceGenerationTask) => readonly GenerationTaskAction[];
    getTaskNotice?: (task: CreativeWorkspaceGenerationTask) => string | undefined;
}>;

export type GenerationTaskAction = Readonly<{
    id: string;
    label: string;
    onPress: () => void;
    disabled?: boolean;
    busy?: boolean;
    tone?: "default" | "danger";
}>;

export function GenerationTaskTray({ surface, projectId, tasks, theme, label, getTaskActions, getTaskNotice }: GenerationTaskTrayProps) {
    const listId = useId();
    const [now, setNow] = useState(() => Date.now());
    const [open, setOpen] = useState(false);
    const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
    const panelLabel = label || (surface === "canvas" ? "当前画布生成任务" : "当前画板生成任务");
    const activeCount = tasks.filter((task) => task.status === "queued" || task.status === "running" || task.status === "paused").length;

    useEffect(() => {
        if (!tasks.length) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1_000);
        return () => window.clearInterval(timer);
    }, [tasks.length]);

    useEffect(() => {
        if (expandedTaskId && !tasks.some((task) => task.id === expandedTaskId)) setExpandedTaskId(null);
    }, [expandedTaskId, tasks]);

    if (!tasks.length) return null;

    return (
        <section data-canvas-no-zoom data-generation-task-tray data-surface={surface} data-project-id={projectId} aria-label={panelLabel} className={styles.tray} style={workspaceThemeStyle(theme)}>
            <span className={styles.srOnly} aria-live="polite" aria-atomic="true">
                {tasks.map((task) => `${task.id} ${statusLabel[task.status]}${task.stage ? ` ${task.stage}` : ""}${typeof task.progress === "number" ? ` ${task.progress}%` : ""}`).join("，")}
            </span>
            <button type="button" className={styles.summary} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls={listId}>
                <span className={styles.summaryIdentity}>
                    <span className={styles.summaryIcon}>
                        <ListTodo size={16} />
                    </span>
                    <span className={styles.summaryCopy}>
                        <span className={styles.summaryTitle}>生成任务</span>
                        <span className={styles.summaryDetail}>
                            {panelLabel} · {activeCount ? `${activeCount} 个进行中` : `${tasks.length} 个待处理`}
                        </span>
                    </span>
                </span>
                <span className={styles.summaryState}>
                    <LoaderCircle className={styles.spinner} size={16} />
                    {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </span>
            </button>

            {open ? (
                <div id={listId} className={styles.taskList}>
                    {tasks.map((task) => (
                        <GenerationTaskCard
                            key={task.id}
                            task={task}
                            now={now}
                            expanded={expandedTaskId === task.id}
                            actions={getTaskActions?.(task)}
                            notice={getTaskNotice?.(task)}
                            onToggle={() => setExpandedTaskId((current) => (current === task.id ? null : task.id))}
                        />
                    ))}
                </div>
            ) : null}
        </section>
    );
}

export function GenerationTaskCard({ task, now, expanded, actions = [], notice, onToggle }: { task: CreativeWorkspaceGenerationTask; now: number; expanded: boolean; actions?: readonly GenerationTaskAction[]; notice?: string; onToggle: () => void }) {
    const progress = typeof task.progress === "number" ? Math.max(0, Math.min(100, task.progress)) : undefined;
    const elapsedMs = Math.max(0, now - task.createdAt);
    const isTerminal = task.status === "succeeded" || task.status === "failed" || task.status === "cancelled";
    const statusTone = task.status === "failed" ? "var(--creative-workspace-danger)" : task.status === "succeeded" ? "var(--creative-workspace-success)" : "var(--creative-workspace-active-foreground)";
    const durationLabel = `${task.status === "queued" ? "已等待" : isTerminal ? "耗时" : "已运行"} ${formatDuration(elapsedMs)}`;
    const billingLabel = task.billing ? (task.billing.refunded ? "已退还" : `${task.billing.pointsCost} 积分`) : "未计费";
    const backgroundRemovalStages = task.type === "image_process" ? ["queued", "reading_source", "inference", "saving", "completed"] : [];
    const activeBackgroundRemovalStage = task.progressStage === "failed" || task.progressStage === "cancelled" ? -1 : backgroundRemovalStages.indexOf(task.progressStage || "queued");

    return (
        <article className={styles.taskCard}>
            <button type="button" className={styles.taskButton} onClick={onToggle} aria-expanded={expanded}>
                <span className={styles.taskHeading}>
                    <span className={styles.taskIcon} style={{ color: statusTone }}>
                        {task.status === "failed" ? <XCircle size={14} /> : <ListTodo size={14} />}
                    </span>
                    <span className={styles.taskCopy}>
                        <span className={styles.taskTitle} title={task.prompt || typeLabel[task.type]}>
                            {typeLabel[task.type] || "生成任务"}
                        </span>
                        <span className={styles.taskStage} title={task.stage || statusLabel[task.status]}>
                            {task.stage || statusLabel[task.status]}
                        </span>
                    </span>
                    <span className={styles.statusBadge} style={{ color: statusTone }}>
                        {statusLabel[task.status]}
                    </span>
                    {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </span>

                <span className={styles.progressTrack} aria-label={progress === undefined ? "进度未知" : `进度 ${progress}%`}>
                    {progress === undefined ? (
                        <span className={`${styles.progressValue} ${styles.progressIndeterminate}`} style={{ background: statusTone }} />
                    ) : (
                        <span className={styles.progressValue} style={{ width: `${progress}%`, background: statusTone }}>
                            {task.status === "running" ? <span className={styles.progressShimmer} /> : null}
                        </span>
                    )}
                </span>
                <span className={styles.progressLabel}>{progress === undefined ? "进度未知" : `进度 ${progress}%`}</span>

                {backgroundRemovalStages.length ? (
                    <ol className={styles.milestones} aria-label="抠图处理阶段">
                        {["排队", "读取", "推理", "保存", "完成"].map((stage, index) => (
                            <li key={stage} aria-current={index === activeBackgroundRemovalStage ? "step" : undefined} style={{ color: index <= activeBackgroundRemovalStage ? statusTone : undefined }}>
                                {stage}
                            </li>
                        ))}
                    </ol>
                ) : null}

                <span className={styles.metrics}>
                    <span title={durationLabel}>
                        <Clock3 size={12} /> {durationLabel}
                    </span>
                    <span title={billingLabel}>
                        <Coins size={12} /> {billingLabel}
                    </span>
                </span>
            </button>

            {expanded ? (
                <div className={styles.details}>
                    {task.prompt ? <p className={styles.prompt}>{task.prompt}</p> : null}
                    <Detail label="任务阶段" value={task.stage || statusLabel[task.status]} />
                    {task.model ? <Detail label="模型" value={task.model} /> : null}
                    {task.error ? <p className={styles.error}>{task.error}</p> : null}
                    {notice ? <p className={styles.notice}>{notice}</p> : null}
                    {actions.length ? (
                        <div className={styles.actions} aria-label="任务操作">
                            {actions.map((action) => (
                                <button
                                    key={action.id}
                                    type="button"
                                    className={`${styles.actionButton} ${action.tone === "danger" ? styles.actionDanger : ""}`}
                                    disabled={action.disabled || action.busy}
                                    aria-busy={action.busy || undefined}
                                    onClick={action.onPress}
                                >
                                    {action.busy ? <LoaderCircle size={12} className={styles.spinner} /> : null}
                                    {action.label}
                                </button>
                            ))}
                        </div>
                    ) : null}
                    <p className={styles.taskId}>任务 ID：{task.id}</p>
                </div>
            ) : null}
        </article>
    );
}

function Detail({ label, value }: { label: string; value: string }) {
    return (
        <div className={styles.detailRow}>
            <span>{label}</span>
            <span title={value}>{value}</span>
        </div>
    );
}

function formatDuration(value: number) {
    const totalSeconds = Math.floor(value / 1_000);
    const hours = Math.floor(totalSeconds / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
