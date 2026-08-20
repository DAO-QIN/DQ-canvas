import { createStore, type StoreApi } from "zustand/vanilla";

import { applyDesignOperationBatch, type DesignOperation, type DesignOperationBatch, type DesignOperationReceipt, type DesignProject } from "@/lib/design";
import { applyDesignOperations, DesignProjectRequestError, getDesignProject, isDesignProjectConflict } from "@/services/api/design-projects";

import { type DesignEditorSelection, validDesignEditorSelection } from "../model/design-editor-commands";
import { compileDesignHistoryTransition } from "../model/design-history-compiler";

export type DesignEditorSaveStatus = "loading" | "saved" | "dirty" | "saving" | "error" | "conflict" | "not-found";
export type DesignEditorDispatchOptions = { history?: "record" | "ignore" };
export type DesignEditorBatchCommit = Readonly<{ project: DesignProject; receipt: DesignOperationReceipt }>;
type DesignEditorHistoryEntry = { before: DesignProject["document"]; after: DesignProject["document"]; label: string };
type BatchAcknowledgement = {
    promise: Promise<DesignEditorBatchCommit>;
    resolve: (value: DesignEditorBatchCommit) => void;
    reject: (reason: unknown) => void;
};

export type DesignEditorState = {
    project: DesignProject | null;
    status: DesignEditorSaveStatus;
    errorMessage: string | null;
    confirmedRevision: number | null;
    pendingCount: number;
    remoteProject: DesignProject | null;
    selection: DesignEditorSelection;
    canUndo: boolean;
    canRedo: boolean;
    undoLabel: string | null;
    redoLabel: string | null;
    load: () => Promise<void>;
    hydrate: (project: DesignProject) => void;
    select: (selection: DesignEditorSelection) => void;
    dispatch: (label: string, operations: DesignOperation[], options?: DesignEditorDispatchOptions) => boolean;
    dispatchBatch: (batch: DesignOperationBatch, options?: DesignEditorDispatchOptions) => boolean;
    dispatchBatchAndWait: (batch: DesignOperationBatch, options?: DesignEditorDispatchOptions) => Promise<DesignEditorBatchCommit>;
    undo: () => boolean;
    redo: () => boolean;
    flush: () => Promise<void>;
    retrySave: () => Promise<void>;
    reloadServerVersion: () => Promise<void>;
    destroy: () => void;
};

export type DesignEditorDependencies = {
    applyRemote?: (projectId: string, batch: DesignOperationBatch) => ReturnType<typeof applyDesignOperations>;
    loadRemote?: (projectId: string) => Promise<DesignProject>;
    now?: () => string;
    createId?: () => string;
    autosaveDelayMs?: number;
};

export type DesignEditorStore = StoreApi<DesignEditorState>;

export function createDesignEditorStore(projectId: string, dependencies: DesignEditorDependencies = {}): DesignEditorStore {
    const applyRemote = dependencies.applyRemote ?? applyDesignOperations;
    const loadRemote = dependencies.loadRemote ?? getDesignProject;
    const now = dependencies.now ?? (() => new Date().toISOString());
    const createId = dependencies.createId ?? defaultId;
    const autosaveDelayMs = dependencies.autosaveDelayMs ?? 450;
    let queue: DesignOperationBatch[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight: Promise<void> | null = null;
    let alive = true;
    let lifecycle = 0;
    let undoStack: DesignEditorHistoryEntry[] = [];
    let redoStack: DesignEditorHistoryEntry[] = [];
    const acknowledgements = new Map<string, BatchAcknowledgement>();

    const historyState = () => ({
        canUndo: undoStack.length > 0,
        canRedo: redoStack.length > 0,
        undoLabel: undoStack.at(-1)?.label ?? null,
        redoLabel: redoStack.at(-1)?.label ?? null,
    });

    const clearHistory = () => {
        undoStack = [];
        redoStack = [];
    };

    const clearTimer = () => {
        if (timer) clearTimeout(timer);
        timer = null;
    };

    const schedule = () => {
        clearTimer();
        timer = setTimeout(() => void pump(), Math.max(0, autosaveDelayMs));
    };

    const setIfAlive = (next: Partial<DesignEditorState>) => {
        if (alive) store.setState(next);
    };

    const drain = async () => {
        clearTimer();
        while (alive && queue.length) {
            const batch = queue[0];
            const requestLifecycle = lifecycle;
            setIfAlive({ status: "saving", errorMessage: null, pendingCount: queue.length });
            try {
                const response = await applyRemote(projectId, batch);
                if (!alive || requestLifecycle !== lifecycle) return;
                const effectiveStatus = response.receipt.status === "replayed" ? response.receipt.originalStatus : response.receipt.status;
                const expectedResultRevision = batch.expectedRevision + 1;
                if (
                    effectiveStatus !== "applied" ||
                    response.receipt.batchId !== batch.batchId ||
                    response.receipt.baseRevision !== batch.expectedRevision ||
                    response.receipt.resultRevision !== expectedResultRevision ||
                    response.project.id !== projectId ||
                    response.project.revision !== expectedResultRevision ||
                    response.project.document.revision !== expectedResultRevision
                ) {
                    const acknowledgement = acknowledgements.get(batch.batchId);
                    acknowledgements.delete(batch.batchId);
                    acknowledgement?.reject(new Error("服务端回执与本地保存批次不一致，请重试或刷新"));
                    setIfAlive({ status: "error", errorMessage: "服务端回执与本地保存批次不一致，请重试或刷新", pendingCount: queue.length });
                    return;
                }

                queue.shift();
                const acknowledgement = acknowledgements.get(batch.batchId);
                acknowledgements.delete(batch.batchId);
                const current = store.getState().project;
                const hasNewerDraft = Boolean(current && current.document.revision > response.project.document.revision);
                const nextProject = hasNewerDraft ? current : structuredClone(response.project);
                setIfAlive({
                    project: nextProject,
                    selection: nextProject ? validDesignEditorSelection(nextProject.document, store.getState().selection) : null,
                    confirmedRevision: response.project.revision,
                    pendingCount: queue.length,
                    status: queue.length ? "saving" : "saved",
                    errorMessage: null,
                });
                acknowledgement?.resolve(response);
            } catch (error) {
                if (!alive || requestLifecycle !== lifecycle) return;
                const acknowledgement = acknowledgements.get(batch.batchId);
                acknowledgements.delete(batch.batchId);
                acknowledgement?.reject(error);
                if (isDesignProjectConflict(error)) {
                    let remoteProject: DesignProject | null = null;
                    let conflictMessage = errorMessage(error, "画板已在其他位置更新");
                    try {
                        remoteProject = await loadRemote(projectId);
                    } catch (loadError) {
                        conflictMessage = `${conflictMessage}；最新服务端版本读取失败：${errorMessage(loadError, "未知错误")}`;
                    }
                    if (!alive || requestLifecycle !== lifecycle) return;
                    setIfAlive({ status: "conflict", errorMessage: conflictMessage, remoteProject, pendingCount: queue.length });
                    return;
                }
                setIfAlive({ status: "error", errorMessage: errorMessage(error, "画板保存失败"), pendingCount: queue.length });
                return;
            }
        }
    };

    const pump = () => {
        if (!alive) return Promise.resolve();
        if (inFlight) return inFlight;
        inFlight = drain().finally(() => {
            inFlight = null;
            const status = store.getState().status;
            if (alive && queue.length && status !== "error" && status !== "conflict") schedule();
        });
        return inFlight;
    };

    const commitBatch = (batchValue: DesignOperationBatch, options: DesignEditorDispatchOptions = {}) => {
        if (!alive) return false;
        const state = store.getState();
        if (!state.project || !batchValue.operations.length || state.status === "loading" || state.status === "not-found" || state.status === "conflict") return false;
        const batch = structuredClone(batchValue);
        const optimistic = applyDesignOperationBatch(state.project.document, batch, { now, createTransactionId: () => `history-${batch.batchId}` });
        if (optimistic.receipt.status !== "applied") return false;
        if (options.history !== "ignore") {
            undoStack = [...undoStack, { before: structuredClone(state.project.document), after: structuredClone(optimistic.document), label: batch.label }].slice(-50);
            redoStack = [];
        }
        queue.push(batch);
        const wasError = state.status === "error";
        store.setState({
            project: {
                ...state.project,
                revision: optimistic.document.revision,
                document: optimistic.document,
                title: optimistic.document.metadata.title,
                updatedAt: optimistic.document.metadata.updatedAt,
            },
            selection: validDesignEditorSelection(optimistic.document, state.selection),
            status: wasError ? "error" : "dirty",
            pendingCount: queue.length,
            errorMessage: wasError ? state.errorMessage : null,
            ...historyState(),
        });
        if (!wasError) schedule();
        return true;
    };

    const rejectAcknowledgements = (reason: Error) => {
        for (const acknowledgement of acknowledgements.values()) acknowledgement.reject(reason);
        acknowledgements.clear();
    };

    const store = createStore<DesignEditorState>()((set, get) => ({
        project: null,
        status: "loading",
        errorMessage: null,
        confirmedRevision: null,
        pendingCount: 0,
        remoteProject: null,
        selection: null,
        canUndo: false,
        canRedo: false,
        undoLabel: null,
        redoLabel: null,
        load: async () => {
            if (!alive) return;
            const loadLifecycle = ++lifecycle;
            clearTimer();
            queue = [];
            clearHistory();
            set({ status: "loading", errorMessage: null, pendingCount: 0, remoteProject: null, ...historyState() });
            try {
                const project = await loadRemote(projectId);
                if (alive && loadLifecycle === lifecycle) get().hydrate(project);
            } catch (error) {
                if (!alive || loadLifecycle !== lifecycle) return;
                set({ project: null, selection: null, status: error instanceof DesignProjectRequestError && error.status === 404 ? "not-found" : "error", errorMessage: errorMessage(error, "画板项目加载失败"), confirmedRevision: null, ...historyState() });
            }
        },
        hydrate: (project) => {
            if (!alive) return;
            clearTimer();
            queue = [];
            clearHistory();
            set({
                project: structuredClone(project),
                selection: validDesignEditorSelection(project.document, get().selection),
                status: "saved",
                errorMessage: null,
                confirmedRevision: project.revision,
                pendingCount: 0,
                remoteProject: null,
                ...historyState(),
            });
        },
        select: (selection) => {
            const document = get().project?.document;
            set({ selection: document ? validDesignEditorSelection(document, selection) : null });
        },
        dispatch: (label, operations, options = {}) => {
            const state = get();
            if (!state.project) return false;
            const batch: DesignOperationBatch = {
                batchId: `batch-${createId()}`,
                expectedRevision: state.project.document.revision,
                mode: "atomic",
                source: "ui",
                label,
                operations,
            };
            return commitBatch(batch, options);
        },
        dispatchBatch: (batch, options = {}) => commitBatch(batch, options),
        dispatchBatchAndWait: (batch, options = {}) => {
            if (acknowledgements.has(batch.batchId)) return acknowledgements.get(batch.batchId)!.promise;
            let resolve!: BatchAcknowledgement["resolve"];
            let reject!: BatchAcknowledgement["reject"];
            const promise = new Promise<DesignEditorBatchCommit>((resolvePromise, rejectPromise) => {
                resolve = resolvePromise;
                reject = rejectPromise;
            });
            acknowledgements.set(batch.batchId, { promise, resolve, reject });
            if (!commitBatch(batch, options)) {
                acknowledgements.delete(batch.batchId);
                reject(new Error("当前批次未通过文档校验或暂时不能提交"));
            }
            return promise;
        },
        undo: () => {
            const state = get();
            const entry = undoStack.at(-1);
            if (!entry || !historyAllowed(state)) return false;
            try {
                const target = withCurrentViewport(entry.before, state.project!.document);
                const operations = compileDesignHistoryTransition(state.project!.document, target, createId);
                if (!get().dispatch(`撤销：${entry.label}`, operations, { history: "ignore" })) return false;
                undoStack = undoStack.slice(0, -1);
                redoStack = [...redoStack, entry].slice(-50);
                set(historyState());
                return true;
            } catch (error) {
                set({ errorMessage: errorMessage(error, "无法撤销该操作") });
                return false;
            }
        },
        redo: () => {
            const state = get();
            const entry = redoStack.at(-1);
            if (!entry || !historyAllowed(state)) return false;
            try {
                const target = withCurrentViewport(entry.after, state.project!.document);
                const operations = compileDesignHistoryTransition(state.project!.document, target, createId);
                if (!get().dispatch(`重做：${entry.label}`, operations, { history: "ignore" })) return false;
                redoStack = redoStack.slice(0, -1);
                undoStack = [...undoStack, entry].slice(-50);
                set(historyState());
                return true;
            } catch (error) {
                set({ errorMessage: errorMessage(error, "无法重做该操作") });
                return false;
            }
        },
        flush: () => pump(),
        retrySave: async () => {
            if (!queue.length) return;
            set({ status: "dirty", errorMessage: null });
            await pump();
        },
        reloadServerVersion: async () => {
            if (!alive) return;
            clearTimer();
            const reloadLifecycle = lifecycle;
            try {
                const project = await loadRemote(projectId);
                if (!alive || reloadLifecycle !== lifecycle) return;
                queue = [];
                get().hydrate(project);
            } catch (error) {
                setIfAlive({ status: "conflict", errorMessage: errorMessage(error, "载入服务端版本失败") });
            }
        },
        destroy: () => {
            alive = false;
            lifecycle += 1;
            clearTimer();
            queue = [];
            rejectAcknowledgements(new Error("Design Editor 已关闭"));
            clearHistory();
        },
    }));

    return store;
}

function historyAllowed(state: DesignEditorState) {
    return Boolean(state.project && state.status !== "loading" && state.status !== "not-found" && state.status !== "error" && state.status !== "conflict");
}

function withCurrentViewport(target: DesignProject["document"], current: DesignProject["document"]) {
    const document = structuredClone(target);
    document.workspace.viewport = structuredClone(current.workspace.viewport);
    return document;
}

function defaultId() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}
