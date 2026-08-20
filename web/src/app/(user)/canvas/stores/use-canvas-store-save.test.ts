import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CanvasProject } from "@/lib/canvas-project-contract";

const mocks = vi.hoisted(() => ({
    saveCanvasProject: vi.fn(),
}));

vi.mock("@/services/api/canvas-projects", () => ({
    listCanvasProjectSummaries: vi.fn(),
    getCanvasProject: vi.fn(),
    createCanvasProject: vi.fn(),
    saveCanvasProject: mocks.saveCanvasProject,
    deleteCanvasProjects: vi.fn(),
}));

import { useCanvasStore } from "./use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";

describe("Canvas project save queue", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useUserStore.getState().setUser(null);
        useCanvasStore.getState().reset();
        useUserStore.getState().setUser(user("canvas-user"));
        const project = canvasProject("canvas-one");
        useCanvasStore.setState({ projects: [project], summaries: [], hydrated: true, hydratedUserId: "canvas-user", syncError: undefined });
        mocks.saveCanvasProject.mockImplementation(async (projectInput: CanvasProject) => ({
            project: projectInput,
            receipt: { projectId: projectInput.id, batchId: "batch", fingerprint: "sha256:test", status: "applied", baseRevision: projectInput.revision || 0, resultRevision: (projectInput.revision || 0) + 1 },
        }));
    });

    afterEach(() => {
        vi.useRealTimers();
        useCanvasStore.getState().reset();
        useUserStore.getState().setUser(null);
    });

    it("flushes the pending debounce immediately and does not save it twice", async () => {
        vi.useFakeTimers();
        useCanvasStore.getState().updateProject("canvas-one", { viewport: { x: 12, y: 18, k: 1.25 } });

        const receipt = await useCanvasStore.getState().flushProject("canvas-one");
        await vi.advanceTimersByTimeAsync(300);

        expect(mocks.saveCanvasProject).toHaveBeenCalledOnce();
        expect(receipt).toMatchObject({ status: "applied", resultRevision: 1 });
        expect(mocks.saveCanvasProject).toHaveBeenCalledWith(expect.objectContaining({ viewport: { x: 12, y: 18, k: 1.25 } }), expect.objectContaining({ expectedRevision: 0 }));
    });

    it("continues flushing when a newer snapshot arrives during an in-flight save", async () => {
        vi.useFakeTimers();
        const firstSave = deferred<{ project: CanvasProject; receipt: { projectId: string; batchId: string; fingerprint: string; status: "applied"; baseRevision: number; resultRevision: number } }>();
        mocks.saveCanvasProject.mockReturnValueOnce(firstSave.promise).mockImplementation(async (projectInput: CanvasProject) => ({
            project: projectInput,
            receipt: { projectId: projectInput.id, batchId: "batch", fingerprint: "sha256:test", status: "applied", baseRevision: projectInput.revision || 0, resultRevision: (projectInput.revision || 0) + 1 },
        }));
        useCanvasStore.getState().updateProject("canvas-one", { viewport: { x: 10, y: 10, k: 1 } });

        const flushing = useCanvasStore.getState().flushProject("canvas-one");
        await vi.advanceTimersByTimeAsync(0);
        useCanvasStore.getState().updateProject("canvas-one", { viewport: { x: 40, y: 50, k: 2 } });
        const firstProject = mocks.saveCanvasProject.mock.calls[0]?.[0] as CanvasProject;
        firstSave.resolve({ project: firstProject, receipt: { projectId: firstProject.id, batchId: "batch", fingerprint: "sha256:test", status: "applied", baseRevision: firstProject.revision || 0, resultRevision: (firstProject.revision || 0) + 1 } });
        await flushing;

        expect(mocks.saveCanvasProject).toHaveBeenCalledTimes(2);
        expect(mocks.saveCanvasProject).toHaveBeenLastCalledWith(expect.objectContaining({ viewport: { x: 40, y: 50, k: 2 } }), expect.objectContaining({ expectedRevision: 1 }));
    });

    it("coalesces high-frequency updates into the latest snapshot when leaving", async () => {
        vi.useFakeTimers();
        mocks.saveCanvasProject.mockImplementationOnce(async (projectInput: CanvasProject) => ({
            project: { ...projectInput, updatedAt: new Date(Date.parse(projectInput.updatedAt) + 1_000).toISOString(), revision: (projectInput.revision || 0) + 1 },
            receipt: { projectId: projectInput.id, batchId: "batch", fingerprint: "sha256:test", status: "applied", baseRevision: projectInput.revision || 0, resultRevision: (projectInput.revision || 0) + 1 },
        }));
        for (let index = 0; index < 40; index += 1) {
            useCanvasStore.getState().updateProject("canvas-one", { viewport: { x: index * 9, y: index * 4, k: 1 + index / 100 } });
        }

        await useCanvasStore.getState().flushProject("canvas-one");
        await vi.advanceTimersByTimeAsync(300);

        expect(mocks.saveCanvasProject).toHaveBeenCalledOnce();
        const saved = mocks.saveCanvasProject.mock.calls[0]?.[0] as CanvasProject;
        expect(saved.viewport).toMatchObject({ x: 351, y: 156 });
        expect(saved.viewport.k).toBeCloseTo(1.39, 8);
    });

    it("rejects a failed flush and exposes the synchronization error", async () => {
        const failure = new Error("provider unavailable");
        mocks.saveCanvasProject.mockRejectedValueOnce(failure);
        useCanvasStore.getState().updateProject("canvas-one", { viewport: { x: 5, y: 6, k: 0.8 } });

        await expect(useCanvasStore.getState().flushProject("canvas-one")).rejects.toThrow("provider unavailable");
        expect(useCanvasStore.getState().syncError).toBe("provider unavailable");
    });

    it("does not enqueue the same project references twice", async () => {
        const project = useCanvasStore.getState().projects[0]!;

        useCanvasStore.getState().updateProject("canvas-one", { nodes: project.nodes, connections: project.connections, viewport: project.viewport });
        const receipt = await useCanvasStore.getState().flushProject("canvas-one");

        expect(receipt).toBeUndefined();
        expect(mocks.saveCanvasProject).not.toHaveBeenCalled();
    });
});

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((promiseResolve) => {
        resolve = promiseResolve;
    });
    return { promise, resolve };
}

function canvasProject(id: string): CanvasProject {
    const now = new Date().toISOString();
    return {
        id,
        title: "待保存画布",
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        createdAt: now,
        updatedAt: now,
    };
}

function user(id: string) {
    return {
        id,
        accountId: "0001",
        username: id,
        email: `${id}@example.test`,
        displayName: id,
        bio: "",
        role: "user" as const,
        status: "active" as const,
        planId: "free",
        planName: "免费",
        hasActivePlan: false,
        pointsBalance: 0,
    };
}
