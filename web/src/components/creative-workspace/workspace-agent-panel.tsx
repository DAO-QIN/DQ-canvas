"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History, LoaderCircle, Pause, Play, Plus, RotateCcw, Send, Square, Sparkles } from "lucide-react";
import { Button, Tooltip } from "antd";
import { nanoid } from "nanoid";

import { AgentMarkdown } from "@/components/agent/agent-markdown";
import { AgentMessageActions } from "@/components/agent/agent-message-actions";
import { friendlyAgentError } from "@/components/agent/agent-message-format";
import { CreativeAgentControls, CreativeAgentSkillCard, type CreativeAgentModelOption } from "@/components/agent/creative-agent-controls";
import { useCreativeAgentOptions } from "@/hooks/use-creative-agent-options";
import type { CreativeConversation, CreativeMessage, CreativeRunRequest } from "@/lib/creative-runtime-contract";
import {
    createWorkspaceAgentActionController,
    createWorkspaceAgentRunController,
    watchWorkspaceAgentRun,
    type WorkspaceActionReceipt,
    type WorkspaceActionRequest,
    type WorkspaceAgentActionController,
    type WorkspaceAgentActionState,
    type WorkspaceAgentAssistantDetail,
    type WorkspaceAgentRunStage,
    type WorkspaceAgentSurface,
} from "@/lib/creative-workspace";
import { listCreativeMessages, listProjectCreativeConversations } from "@/services/api/creative";
import { refreshUserPointsIfSystem } from "@/services/api/points";

import { WorkspaceAgentActionCard } from "./workspace-agent-action-card";
import type { WorkspaceThemeTokens } from "./workspace-theme";
import styles from "./workspace-agent-panel.module.css";

export type WorkspaceAgentPanelProps = Readonly<{
    surface: WorkspaceAgentSurface;
    projectId: string;
    theme: WorkspaceThemeTokens;
    getSnapshot: () => unknown;
    prepareRun: () => Promise<void>;
    executeWorkspaceActions: (request: WorkspaceActionRequest) => Promise<WorkspaceActionReceipt>;
    disabled?: boolean;
    selectionLabel?: string;
}>;

type PanelMessage = Readonly<{
    id: string;
    role: "user" | "assistant" | "warning" | "error";
    text: string;
}>;

type RunFailure = Readonly<{ runId: string; taskId?: string; message: string }>;
const runController = createWorkspaceAgentRunController();

export function WorkspaceAgentPanel({ surface, projectId, theme, getSnapshot, prepareRun, executeWorkspaceActions, disabled = false, selectionLabel }: WorkspaceAgentPanelProps) {
    const { skills, skillsLoading, models } = useCreativeAgentOptions(surface);
    const [view, setView] = useState<"chat" | "history">("chat");
    const [conversations, setConversations] = useState<CreativeConversation[]>([]);
    const [conversationId, setConversationId] = useState<string>();
    const [messages, setMessages] = useState<CreativeMessage[]>([]);
    const [historyLoading, setHistoryLoading] = useState(true);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [selectedSkillId, setSelectedSkillId] = useState<string>();
    const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
    const [selectedAgentModelId, setSelectedAgentModelId] = useState("");
    const [smartPlanning, setSmartPlanning] = useState(true);
    const [activeRunId, setActiveRunId] = useState("");
    const [runStage, setRunStage] = useState<WorkspaceAgentRunStage>();
    const [runPaused, setRunPaused] = useState(false);
    const [liveMessage, setLiveMessage] = useState<PanelMessage>();
    const [failure, setFailure] = useState<RunFailure>();
    const [actionState, setActionState] = useState<WorkspaceAgentActionState>({ status: "idle" });
    const actionControllerRef = useRef<WorkspaceAgentActionController | null>(null);
    const executeRef = useRef(executeWorkspaceActions);
    const snapshotRef = useRef(getSnapshot);
    const prepareRef = useRef(prepareRun);
    const conversationIdRef = useRef(conversationId);
    const watchingRef = useRef(new Set<string>());
    const watchAbortRef = useRef<AbortController | null>(null);
    const restoredRunRef = useRef("");

    useEffect(() => {
        executeRef.current = executeWorkspaceActions;
        snapshotRef.current = getSnapshot;
        prepareRef.current = prepareRun;
    }, [executeWorkspaceActions, getSnapshot, prepareRun]);

    useEffect(() => {
        conversationIdRef.current = conversationId;
    }, [conversationId]);

    const loadMessages = useCallback(async (id: string | undefined) => {
        if (!id) {
            setMessages([]);
            return;
        }
        setMessagesLoading(true);
        try {
            setMessages(await listCreativeMessages(id, undefined, 100));
        } finally {
            setMessagesLoading(false);
        }
    }, []);

    const loadConversations = useCallback(
        async (preferredId?: string) => {
            setHistoryLoading(true);
            try {
                const page = await listProjectCreativeConversations({ surface, projectId, limit: 100 });
                setConversations(page.conversations);
                const nextId = preferredId || page.conversations[0]?.id;
                setConversationId(nextId);
                await loadMessages(nextId);
            } finally {
                setHistoryLoading(false);
            }
        },
        [loadMessages, projectId, surface],
    );

    const watchRun = useCallback(
        async (runId: string, runConversationId?: string) => {
            if (watchingRef.current.has(runId)) return;
            watchingRef.current.add(runId);
            watchAbortRef.current?.abort();
            const abort = new AbortController();
            watchAbortRef.current = abort;
            setActiveRunId(runId);
            setFailure(undefined);
            const actionController = createWorkspaceAgentActionController({
                runId,
                execute: (request) => executeRef.current(request),
                onStateChange: setActionState,
            });
            actionControllerRef.current = actionController;
            setActionState({ status: "idle" });
            try {
                await watchWorkspaceAgentRun(
                    runId,
                    {
                        onAssistant: (text, detail) => {
                            const next = assistantPanelMessage(runId, text, detail);
                            setLiveMessage(next.message);
                            if (next.failure) setFailure(next.failure);
                        },
                        onStage: setRunStage,
                        onPaused: setRunPaused,
                        onWorkspaceActionRequest: (event) => void actionController.receive(event.request),
                        onWorkspaceActionConfirmed: (request) => void actionController.receive(request),
                        onWorkspaceActionRejected: (event) => actionController.receiveRejected(event),
                        onWorkspaceActionReceipt: (event) => actionController.receiveReceipt(event.request, event.receipt, event.message),
                    },
                    abort.signal,
                );
            } catch (error) {
                if (!abort.signal.aborted) {
                    const message = friendlyAgentError(error, "Agent 任务连接失败，请稍后重试。");
                    setLiveMessage({ id: `connection-${runId}`, role: "error", text: message });
                    setFailure({ runId, message });
                }
            } finally {
                watchingRef.current.delete(runId);
                if (!abort.signal.aborted) {
                    const currentConversationId = runConversationId || conversationIdRef.current;
                    await Promise.all([loadConversations(currentConversationId), refreshUserPointsIfSystem("system")]);
                    setActiveRunId("");
                    setRunPaused(false);
                    setRunStage(undefined);
                    setLiveMessage(undefined);
                }
                if (actionControllerRef.current === actionController) actionControllerRef.current = null;
            }
        },
        [loadConversations],
    );

    useEffect(() => {
        let cancelled = false;
        void Promise.all([loadConversations(), runController.restore({ surface, projectId })])
            .then(([, run]) => {
                if (cancelled || !run || restoredRunRef.current === run.id) return;
                restoredRunRef.current = run.id;
                if (run.conversationId) setConversationId(run.conversationId);
                setRunPaused(run.status === "paused");
                setLiveMessage({ id: `restore-${run.id}`, role: "assistant", text: run.status === "awaiting_confirmation" ? "已恢复待确认的工作区操作。" : "已恢复仍在执行的 Agent 任务。" });
                void watchRun(run.id, run.conversationId);
            })
            .catch((error) => {
                if (!cancelled) setLiveMessage({ id: "history-error", role: "error", text: friendlyAgentError(error, "Agent 历史加载失败。") });
            });
        return () => {
            cancelled = true;
            watchAbortRef.current?.abort();
        };
    }, [loadConversations, projectId, surface, watchRun]);

    const send = async () => {
        const text = prompt.trim();
        if (!text || activeRunId || disabled) return;
        const optimisticId = `optimistic-${nanoid()}`;
        setPrompt("");
        setView("chat");
        setFailure(undefined);
        setLiveMessage({ id: optimisticId, role: "assistant", text: "正在理解当前需求和工作区。" });
        try {
            const created = await runController.create(
                () =>
                    ({
                        clientRequestId: nanoid(),
                        surface,
                        conversationId,
                        projectId,
                        prompt: text,
                        snapshot: snapshotRef.current(),
                        assetIds: [],
                        skillIds: selectedSkillId ? [selectedSkillId] : [],
                        modelIds: smartPlanning ? [] : selectedModelIds,
                        agentModelId: selectedAgentModelId || undefined,
                    }) satisfies CreativeRunRequest,
                () => prepareRef.current(),
            );
            const nextConversationId = created.run.conversationId || created.conversation?.id;
            if (nextConversationId) {
                setConversationId(nextConversationId);
                await loadConversations(nextConversationId);
            }
            restoredRunRef.current = created.run.id;
            setSelectedSkillId(undefined);
            await watchRun(created.run.id, nextConversationId);
        } catch (error) {
            const message = friendlyAgentError(error);
            setLiveMessage({ id: optimisticId, role: "error", text: message });
            setFailure(undefined);
            setActiveRunId("");
        }
    };

    const controlRun = async (action: "pause" | "resume" | "cancel") => {
        if (!activeRunId) return;
        try {
            await runController.control(activeRunId, action);
            setRunPaused(action === "pause");
        } catch (error) {
            setLiveMessage({ id: `control-${activeRunId}`, role: "error", text: friendlyAgentError(error, "Agent 任务控制失败，请稍后重试。") });
        }
    };

    const retry = async () => {
        if (!failure || activeRunId) return;
        setLiveMessage({ id: `retry-${failure.runId}`, role: "assistant", text: "正在重新执行失败任务。" });
        try {
            await runController.retry(failure.runId, failure.taskId);
            await watchRun(failure.runId, conversationId);
        } catch (error) {
            setLiveMessage({ id: `retry-${failure.runId}`, role: "error", text: friendlyAgentError(error, "任务重试失败，请稍后再试。") });
        }
    };

    const selectedSkill = skills.find((skill) => skill.id === selectedSkillId);
    const selectedModels = models.filter((model) => selectedModelIds.includes(model.id));
    const panelMessages = useMemo(() => [...messages.map(creativeMessageToWorkspacePanelMessage), ...(liveMessage ? [liveMessage] : [])], [liveMessage, messages]);
    const controlTheme = { panel: theme.panelBackground, border: theme.panelBorder, text: theme.foreground, muted: theme.mutedForeground, activeBackground: theme.activeBackground, activeText: theme.activeForeground };

    return (
        <section className={styles.panel} data-workspace-agent-panel data-surface={surface}>
            <div className={styles.tabs} role="tablist" aria-label="Agent 面板">
                <button type="button" role="tab" aria-selected={view === "chat"} className={view === "chat" ? styles.activeTab : undefined} onClick={() => setView("chat")}>
                    对话
                </button>
                <button type="button" role="tab" aria-selected={view === "history"} className={view === "history" ? styles.activeTab : undefined} onClick={() => setView("history")}>
                    <History aria-hidden />
                    历史 {conversations.length || ""}
                </button>
                <Tooltip title="新对话">
                    <Button
                        type="text"
                        shape="circle"
                        className={styles.iconButton}
                        icon={<Plus aria-hidden />}
                        disabled={Boolean(activeRunId) || (!conversationId && !messages.length)}
                        onClick={() => {
                            setConversationId(undefined);
                            setMessages([]);
                            setLiveMessage(undefined);
                            setView("chat");
                        }}
                        aria-label="新建 Agent 对话"
                    />
                </Tooltip>
            </div>

            {view === "history" ? (
                <div className={styles.history} aria-label="Agent 历史会话">
                    {historyLoading ? <PanelLoading label="正在加载历史" /> : null}
                    {!historyLoading && !conversations.length ? <PanelEmpty label="暂无历史会话" /> : null}
                    {conversations.map((conversation) => (
                        <button
                            key={conversation.id}
                            type="button"
                            className={conversation.id === conversationId ? styles.activeHistoryItem : styles.historyItem}
                            onClick={() => {
                                setConversationId(conversation.id);
                                setView("chat");
                                setLiveMessage(undefined);
                                void loadMessages(conversation.id);
                            }}
                        >
                            <strong>{conversation.title || "新对话"}</strong>
                            <span>{formatConversationTime(conversation.updatedAt)}</span>
                        </button>
                    ))}
                </div>
            ) : (
                <>
                    <div className={styles.messages} aria-live="polite">
                        {messagesLoading ? <PanelLoading label="正在加载消息" /> : null}
                        {!messagesLoading && !panelMessages.length ? <PanelEmpty label="从当前工作区开始" /> : null}
                        {panelMessages.map((item) => (
                            <WorkspaceAgentMessage key={item.id} message={item} />
                        ))}
                        {runStage ? <RunStage stage={runStage} paused={runPaused} /> : null}
                        <WorkspaceAgentActionCard state={actionState} onConfirm={() => void actionControllerRef.current?.confirm()} onReject={() => void actionControllerRef.current?.reject()} onRetry={() => void actionControllerRef.current?.retry()} />
                    </div>

                    {activeRunId || failure ? (
                        <div className={styles.runControls} role="toolbar" aria-label="Agent 任务控制">
                            {activeRunId ? (
                                <Button type="text" size="small" icon={runPaused ? <Play aria-hidden /> : <Pause aria-hidden />} onClick={() => void controlRun(runPaused ? "resume" : "pause")}>
                                    {runPaused ? "继续" : "暂停"}
                                </Button>
                            ) : null}
                            {activeRunId ? (
                                <Button danger type="text" size="small" icon={<Square aria-hidden />} onClick={() => void controlRun("cancel")}>
                                    取消
                                </Button>
                            ) : null}
                            {!activeRunId && failure ? (
                                <Button type="text" size="small" icon={<RotateCcw aria-hidden />} onClick={() => void retry()}>
                                    重试
                                </Button>
                            ) : null}
                        </div>
                    ) : null}

                    <div className={styles.composer}>
                        {selectedSkill ? <CreativeAgentSkillCard skill={selectedSkill} onRemove={() => setSelectedSkillId(undefined)} theme={controlTheme} /> : null}
                        {selectionLabel ? <span className={styles.selectionLabel}>{selectionLabel}</span> : null}
                        <textarea
                            value={prompt}
                            disabled={disabled || Boolean(activeRunId)}
                            placeholder={surface === "design" ? "描述要读取、生成或调整的画板内容" : "描述要处理的工作区内容"}
                            onChange={(event) => setPrompt(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey) return;
                                event.preventDefault();
                                void send();
                            }}
                        />
                        <div className={styles.composerToolbar}>
                            <CreativeAgentControls
                                compact
                                className={styles.agentControls}
                                skills={skills}
                                skillsLoading={skillsLoading}
                                selectedSkill={selectedSkill}
                                models={models}
                                selectedModels={selectedModels}
                                smartPlanning={smartPlanning}
                                onSelectSkill={(skill) => setSelectedSkillId(skill.id)}
                                onToggleModel={(model: CreativeAgentModelOption) => {
                                    setSmartPlanning(false);
                                    setSelectedModelIds((current) => (current.includes(model.id) ? current.filter((id) => id !== model.id) : [...current, model.id].slice(-6)));
                                }}
                                onClearModels={() => {
                                    setSelectedModelIds([]);
                                    setSmartPlanning(true);
                                }}
                                onSmartPlanningChange={(enabled) => {
                                    setSmartPlanning(enabled);
                                    if (enabled) setSelectedModelIds([]);
                                }}
                                agentModelId={selectedAgentModelId}
                                onAgentModelChange={setSelectedAgentModelId}
                                theme={controlTheme}
                            />
                            <Tooltip title="发送">
                                <Button
                                    type="primary"
                                    shape="circle"
                                    className={styles.sendButton}
                                    icon={activeRunId ? <LoaderCircle className={styles.spinner} aria-hidden /> : <Send aria-hidden />}
                                    disabled={disabled || Boolean(activeRunId) || !prompt.trim()}
                                    onClick={() => void send()}
                                    aria-label="发送给 Agent"
                                />
                            </Tooltip>
                        </div>
                    </div>
                </>
            )}
        </section>
    );
}

export function creativeMessageToWorkspacePanelMessage(message: CreativeMessage): PanelMessage {
    return {
        id: message.id,
        role: message.role === "user" ? "user" : message.status === "failed" ? "error" : message.status === "cancelled" ? "warning" : "assistant",
        text: message.content,
    };
}

function assistantPanelMessage(runId: string, text: string, detail?: WorkspaceAgentAssistantDetail) {
    const failed = Boolean(detail?.runId);
    const message: PanelMessage = { id: `live-${runId}-${detail?.taskId || "run"}`, role: failed ? "error" : "assistant", text };
    return { message, ...(failed ? { failure: { runId, taskId: detail?.taskId, message: text } satisfies RunFailure } : {}) };
}

function WorkspaceAgentMessage({ message }: { message: PanelMessage }) {
    return (
        <div className={message.role === "user" ? styles.userMessageRow : styles.agentMessageRow}>
            {message.role !== "user" ? (
                <span className={styles.agentMark} aria-hidden>
                    <Sparkles />
                </span>
            ) : null}
            <div className={`${styles.messageContent} ${styles[`${message.role}Message`]}`}>
                {message.role === "assistant" ? <AgentMarkdown>{message.text}</AgentMarkdown> : <p>{message.text}</p>}
                <AgentMessageActions text={message.text} align={message.role === "user" ? "end" : "start"} />
            </div>
        </div>
    );
}

function RunStage({ stage, paused }: { stage: WorkspaceAgentRunStage; paused: boolean }) {
    return (
        <div className={styles.stage} role="status">
            {paused || stage.key === "paused" ? <Pause aria-hidden /> : <LoaderCircle className={styles.spinner} aria-hidden />}
            <span>{stage.text}</span>
        </div>
    );
}

function PanelLoading({ label }: { label: string }) {
    return (
        <div className={styles.panelState}>
            <LoaderCircle className={styles.spinner} aria-hidden />
            <span>{label}</span>
        </div>
    );
}

function PanelEmpty({ label }: { label: string }) {
    return (
        <div className={styles.panelState}>
            <Sparkles aria-hidden />
            <span>{label}</span>
        </div>
    );
}

function formatConversationTime(value: number) {
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
