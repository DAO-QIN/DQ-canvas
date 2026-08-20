import { create } from "zustand";

import { createClientSessionEpoch, type ClientSessionStamp } from "@/lib/client-session-epoch";
import type { CanvasProject, CanvasProjectSummary, CanvasProjectSummaryPage } from "@/lib/canvas-project-contract";
import { canvasProjectRevision, canvasSaveBatchId, canvasSaveFingerprint, type CanvasSaveReceipt } from "@/lib/canvas-project-receipt";
import { summarizeCanvasProjectRecord } from "@/lib/canvas-project-summary";
import { createCanvasProject, deleteCanvasProjects as deleteCanvasProjectsRequest, getCanvasProject, listCanvasProjectSummaries, saveCanvasProject } from "@/services/api/canvas-projects";
import { useUserStore } from "@/stores/use-user-store";

export type { CanvasProject, CanvasProjectSummary } from "@/lib/canvas-project-contract";

type CanvasProjectPatch = Partial<Pick<CanvasProject, "creativeConversationId" | "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>;

type CanvasStore = {
    hydrated: boolean;
    hydratedUserId: string;
    syncError?: string;
    summaries: CanvasProjectSummary[];
    summaryTotal: number;
    summaryPage: number;
    summaryPageSize: number;
    summaryLoadingMore: boolean;
    projects: CanvasProject[];
    hydrate: (force?: boolean) => Promise<void>;
    loadMore: () => Promise<void>;
    loadProject: (id: string, force?: boolean) => Promise<CanvasProject>;
    createProject: (title?: string) => Promise<string>;
    importProject: (project: Partial<CanvasProject>, sourceHandoffId?: string) => Promise<string>;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => Promise<void>;
    updateProject: (id: string, patch: CanvasProjectPatch) => void;
    flushProject: (id: string) => Promise<CanvasSaveReceipt | undefined>;
    reset: () => void;
};

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const saveQueues = new Map<string, Promise<CanvasSaveReceipt | undefined>>();
const queuedProjectVersions = new Map<string, number>();
const localProjectVersions = new Map<string, number>();
const acknowledgedProjectVersions = new Map<string, number>();
const latestServerRevisions = new Map<string, number>();
const latestSaveReceipts = new Map<string, CanvasSaveReceipt>();
const latestProjectTimes = new Map<string, number>();
const projectRequests = new Map<string, Promise<CanvasProject>>();
const sessionEpoch = createClientSessionEpoch(() => useUserStore.getState().user?.id || "");
let hydrateRequestId = 0;
let hydrateRequest: (ClientSessionStamp & { requestId: number; promise: Promise<void> }) | null = null;
const SUMMARY_PAGE_SIZE = 12;

export const useCanvasStore = create<CanvasStore>((set, get) => ({
    hydrated: false,
    hydratedUserId: "",
    summaries: [],
    summaryTotal: 0,
    summaryPage: 0,
    summaryPageSize: SUMMARY_PAGE_SIZE,
    summaryLoadingMore: false,
    projects: [],
    hydrate: async (force = false) => {
        const userId = useUserStore.getState().user?.id || "";
        if (!userId) {
            invalidateSession();
            set({ hydrated: true, hydratedUserId: "", summaries: [], summaryTotal: 0, summaryPage: 0, summaryPageSize: SUMMARY_PAGE_SIZE, summaryLoadingMore: false, projects: [], syncError: undefined });
            return;
        }
        if (!force && get().hydrated && get().hydratedUserId === userId) return;
        const session = sessionEpoch.capture();
        if (!force && hydrateRequest?.userId === session.userId && hydrateRequest.epoch === session.epoch) return hydrateRequest.promise;
        const requestId = ++hydrateRequestId;
        set((state) => ({
            hydrated: false,
            hydratedUserId: userId,
            summaries: state.hydratedUserId === userId ? state.summaries : [],
            summaryTotal: state.hydratedUserId === userId ? state.summaryTotal : 0,
            summaryPage: state.hydratedUserId === userId ? state.summaryPage : 0,
            summaryLoadingMore: false,
            projects: state.hydratedUserId === userId ? state.projects : [],
            syncError: undefined,
        }));
        const promise = listCanvasProjectSummaries({ page: 1, pageSize: SUMMARY_PAGE_SIZE })
            .then((result) => {
                if (!isActiveHydrate(session, requestId)) return;
                const pageResult = normalizeSummaryPage(result);
                set({ summaries: pageResult.items, summaryTotal: pageResult.total, summaryPage: pageResult.page, summaryPageSize: pageResult.pageSize, hydrated: true, hydratedUserId: userId });
            })
            .catch((error) => {
                if (isActiveHydrate(session, requestId)) set({ summaries: [], summaryTotal: 0, summaryPage: 0, hydrated: false, hydratedUserId: userId, syncError: error instanceof Error ? error.message : "画布项目加载失败" });
            })
            .finally(() => {
                if (hydrateRequest?.requestId === requestId) hydrateRequest = null;
            });
        hydrateRequest = { ...session, requestId, promise };
        return promise;
    },
    loadMore: async () => {
        const session = requireSession();
        const state = get();
        if (!state.hydrated || state.summaryLoadingMore || state.summaries.length >= state.summaryTotal) return;
        const page = state.summaryPage + 1;
        set({ summaryLoadingMore: true, syncError: undefined });
        try {
            const result = normalizeSummaryPage(await listCanvasProjectSummaries({ page, pageSize: state.summaryPageSize }));
            assertCurrent(session);
            set((current) => {
                const existing = new Set(current.summaries.map((item) => item.id));
                return {
                    summaries: [...current.summaries, ...result.items.filter((item) => !existing.has(item.id))],
                    summaryTotal: result.total,
                    summaryPage: result.page,
                    summaryPageSize: result.pageSize,
                    summaryLoadingMore: false,
                };
            });
        } catch (error) {
            if (sessionEpoch.isCurrent(session)) set({ summaryLoadingMore: false, syncError: error instanceof Error ? error.message : "更多画布加载失败" });
        }
    },
    loadProject: async (id, force = false) => {
        const session = requireSession();
        const current = get().projects.find((project) => project.id === id);
        if (!force && current) return current;
        const key = sessionEpoch.key(session, id);
        const pending = projectRequests.get(key);
        if (!force && pending) return pending;
        const request = getCanvasProject(id)
            .then((project) => {
                assertCurrent(session);
                markProjectLoaded(key, project);
                set((state) => ({ projects: [project, ...state.projects.filter((item) => item.id !== project.id)], summaries: upsertSummary(state.summaries, project), syncError: undefined }));
                return project;
            })
            .finally(() => {
                if (projectRequests.get(key) === request) projectRequests.delete(key);
            });
        projectRequests.set(key, request);
        return request;
    },
    createProject: async (title = "未命名画布") => {
        const session = requireSession();
        const project = await createCanvasProject({ title });
        assertCurrent(session);
        markProjectLoaded(sessionEpoch.key(session, project.id), project);
        set((state) => ({
            projects: [project, ...state.projects.filter((item) => item.id !== project.id)],
            summaries: upsertSummary(state.summaries, project),
            summaryTotal: state.summaries.some((item) => item.id === project.id) ? state.summaryTotal : state.summaryTotal + 1,
            syncError: undefined,
        }));
        return project.id;
    },
    importProject: async (project, sourceHandoffId) => {
        const session = requireSession();
        const created = await createCanvasProject({ title: project.title || "导入画布", sourceHandoffId, project });
        assertCurrent(session);
        markProjectLoaded(sessionEpoch.key(session, created.id), created);
        set((state) => ({
            projects: [created, ...state.projects.filter((item) => item.id !== created.id)],
            summaries: upsertSummary(state.summaries, created),
            summaryTotal: state.summaryTotal + (state.summaries.some((item) => item.id === created.id) ? 0 : 1),
            syncError: undefined,
        }));
        return created.id;
    },
    renameProject: (id, title) => {
        const nextTitle = title.trim();
        if (!nextTitle) return;
        if (get().projects.some((project) => project.id === id)) {
            mutateProject(id, (project) => ({ ...project, title: nextTitle }));
            return;
        }
        void get()
            .loadProject(id)
            .then(() => mutateProject(id, (project) => ({ ...project, title: nextTitle })))
            .catch((error) => set({ syncError: error instanceof Error ? error.message : "画布项目重命名失败" }));
    },
    deleteProjects: async (ids) => {
        const session = requireSession();
        const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
        if (!uniqueIds.length) return;
        uniqueIds.forEach((id) => clearProjectSave(session, id));
        await Promise.all(uniqueIds.map((id) => saveQueues.get(sessionEpoch.key(session, id))?.catch(() => undefined)));
        assertCurrent(session);
        await deleteCanvasProjectsRequest(uniqueIds);
        if (!sessionEpoch.isCurrent(session)) return;
        uniqueIds.forEach((id) => clearProjectTracking(sessionEpoch.key(session, id)));
        set((state) => ({
            projects: state.projects.filter((project) => !uniqueIds.includes(project.id)),
            summaries: state.summaries.filter((project) => !uniqueIds.includes(project.id)),
            summaryTotal: Math.max(0, state.summaryTotal - state.summaries.filter((project) => uniqueIds.includes(project.id)).length),
            syncError: undefined,
        }));
    },
    updateProject: (id, patch) => mutateProject(id, (project) => applyProjectPatch(project, patch)),
    flushProject: async (id) => {
        const session = requireSession();
        const key = sessionEpoch.key(session, id);
        let latestReceipt = latestSaveReceipts.get(key);
        while (sessionEpoch.isCurrent(session)) {
            clearProjectSave(session, id);
            const project = get().projects.find((item) => item.id === id);
            if (!project) throw new Error("画布项目不存在");
            const version = localProjectVersions.get(key) || 0;
            if ((acknowledgedProjectVersions.get(key) || 0) >= version && !saveQueues.has(key)) return latestReceipt;
            latestReceipt = (await enqueueSave(session, project, version)) || latestReceipt;
            assertCurrent(session);
            if (!get().projects.some((item) => item.id === id)) throw new Error("画布项目不存在");
        }
        assertCurrent(session);
        return latestReceipt;
    },
    reset: () => {
        invalidateSession();
        set({ hydrated: false, hydratedUserId: "", summaries: [], summaryTotal: 0, summaryPage: 0, summaryPageSize: SUMMARY_PAGE_SIZE, summaryLoadingMore: false, projects: [], syncError: undefined });
    },
}));

function mutateProject(projectId: string, updater: (project: CanvasProject) => CanvasProject) {
    const session = sessionEpoch.capture();
    if (!session.userId) return;
    let nextProject: CanvasProject | undefined;
    useCanvasStore.setState((state) => {
        const projects = state.projects.map((project) => {
            if (project.id !== projectId) return project;
            const updated = updater(project);
            if (updated === project) return project;
            nextProject = { ...updated, updatedAt: nextUpdatedAt(session, project) };
            return nextProject;
        });
        return { projects, summaries: nextProject ? upsertSummary(state.summaries, nextProject) : state.summaries };
    });
    if (nextProject) queueSave(session, nextProject);
}

function queueSave(session: ClientSessionStamp, project: CanvasProject) {
    const key = sessionEpoch.key(session, project.id);
    const version = (localProjectVersions.get(key) || 0) + 1;
    localProjectVersions.set(key, version);
    clearProjectSave(session, project.id);
    saveTimers.set(
        key,
        setTimeout(() => {
            saveTimers.delete(key);
            if (!sessionEpoch.isCurrent(session)) return;
            void enqueueSave(session, project, version).catch(() => undefined);
        }, 250),
    );
}

function enqueueSave(session: ClientSessionStamp, project: CanvasProject, version: number) {
    const key = sessionEpoch.key(session, project.id);
    if ((acknowledgedProjectVersions.get(key) || 0) >= version) return Promise.resolve(latestSaveReceipts.get(key));
    if ((queuedProjectVersions.get(key) || 0) >= version) return saveQueues.get(key) || Promise.resolve(latestSaveReceipts.get(key));
    queuedProjectVersions.set(key, version);
    const previous = saveQueues.get(key) || Promise.resolve();
    const operation = previous
        .catch(() => undefined)
        .then(async () => {
            assertCurrent(session);
            try {
                const expectedRevision = latestServerRevisions.get(key) ?? canvasProjectRevision(project);
                const fingerprint = canvasSaveFingerprint(project, expectedRevision);
                const batchId = canvasSaveBatchId(project.id, version, fingerprint);
                const response = await saveCanvasProject(project, { expectedRevision, batchId, fingerprint });
                const saved = response.project;
                if (response.receipt.status === "conflict") throw new Error(response.receipt.error?.message || "画布项目保存冲突");
                assertCurrent(session);
                acknowledgedProjectVersions.set(key, Math.max(acknowledgedProjectVersions.get(key) || 0, version));
                latestServerRevisions.set(key, Math.max(latestServerRevisions.get(key) || 0, response.receipt.resultRevision));
                latestSaveReceipts.set(key, response.receipt);
                latestProjectTimes.set(key, Math.max(latestProjectTimes.get(key) || 0, Date.parse(saved.updatedAt) || 0));
                useCanvasStore.setState((state) => ({
                    projects: state.projects.map((item) => (item.id === saved.id && item.updatedAt === project.updatedAt ? saved : item)),
                    summaries: upsertSummary(state.summaries, saved),
                    syncError: undefined,
                }));
                return response.receipt;
            } catch (error) {
                if (sessionEpoch.isCurrent(session)) {
                    const latest = useCanvasStore.getState().projects.find((item) => item.id === project.id);
                    if (latest?.updatedAt === project.updatedAt) useCanvasStore.setState({ syncError: error instanceof Error ? error.message : "画布项目保存失败" });
                }
                throw error;
            }
        });
    saveQueues.set(key, operation);
    operation.then(
        () => {
            if (saveQueues.get(key) === operation) clearQueuedSave(key);
        },
        () => {
            if (saveQueues.get(key) === operation) clearQueuedSave(key);
        },
    );
    return operation;
}

function nextUpdatedAt(session: ClientSessionStamp, project: CanvasProject) {
    const key = sessionEpoch.key(session, project.id);
    const previous = Math.max(Date.parse(project.updatedAt) || 0, latestProjectTimes.get(key) || 0);
    const next = Math.max(Date.now(), previous + 1);
    latestProjectTimes.set(key, next);
    return new Date(next).toISOString();
}

function clearProjectSave(session: ClientSessionStamp, projectId: string) {
    const key = sessionEpoch.key(session, projectId);
    const timer = saveTimers.get(key);
    if (timer) clearTimeout(timer);
    saveTimers.delete(key);
}

function isActiveHydrate(session: ClientSessionStamp, requestId: number) {
    return sessionEpoch.isCurrent(session) && hydrateRequest?.requestId === requestId;
}

function requireSession() {
    const session = sessionEpoch.capture();
    if (!session.userId) throw new Error("请先登录");
    return session;
}

function assertCurrent(session: ClientSessionStamp) {
    if (!sessionEpoch.isCurrent(session)) throw new Error("登录会话已变更，请重试");
}

function invalidateSession() {
    sessionEpoch.invalidate();
    hydrateRequest = null;
    saveTimers.forEach((timer) => clearTimeout(timer));
    saveTimers.clear();
    saveQueues.clear();
    queuedProjectVersions.clear();
    localProjectVersions.clear();
    acknowledgedProjectVersions.clear();
    latestServerRevisions.clear();
    latestSaveReceipts.clear();
    latestProjectTimes.clear();
    projectRequests.clear();
}

function markProjectLoaded(key: string, project: CanvasProject) {
    latestProjectTimes.set(key, Date.parse(project.updatedAt) || Date.now());
    latestServerRevisions.set(key, canvasProjectRevision(project));
    latestSaveReceipts.delete(key);
    localProjectVersions.set(key, 0);
    acknowledgedProjectVersions.set(key, 0);
    queuedProjectVersions.delete(key);
}

function clearQueuedSave(key: string) {
    saveQueues.delete(key);
    queuedProjectVersions.delete(key);
}

function clearProjectTracking(key: string) {
    latestProjectTimes.delete(key);
    latestServerRevisions.delete(key);
    latestSaveReceipts.delete(key);
    localProjectVersions.delete(key);
    acknowledgedProjectVersions.delete(key);
    queuedProjectVersions.delete(key);
    saveQueues.delete(key);
}

function upsertSummary(summaries: CanvasProjectSummary[], project: CanvasProject) {
    const summary = summarizeCanvasProjectRecord(project);
    return [summary, ...summaries.filter((item) => item.id !== project.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

function normalizeSummaryPage(result: CanvasProjectSummaryPage | CanvasProjectSummary[]): CanvasProjectSummaryPage {
    if (Array.isArray(result)) return { items: result, total: result.length, page: 1, pageSize: Math.max(result.length, SUMMARY_PAGE_SIZE) };
    return result;
}

function applyProjectPatch(project: CanvasProject, patch: CanvasProjectPatch) {
    const keys = Object.keys(patch) as (keyof CanvasProjectPatch)[];
    if (keys.every((key) => Object.is(project[key], patch[key]))) return project;
    return { ...project, ...patch };
}
