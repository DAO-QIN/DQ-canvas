import { describe, expect, it, vi } from "vitest";

import { applyDesignOperationBatch, createDesignImageImportBatch, type DesignOperationBatch, type DesignProject } from "@/lib/design";
import { createDesignDocumentFixture } from "@/lib/design/design.test-fixture";
import { DesignProjectRequestError } from "@/services/api/design-projects";

import { createDesignEditorStore } from "./design-editor-store";

const NOW = "2026-08-11T10:00:00.000Z";

describe("design editor store", () => {
    it("keeps the Design Document in one project store and applies typed operations optimistically", () => {
        const project = createProject();
        const store = createDesignEditorStore(project.id, { createId: sequenceId(), now: () => NOW, autosaveDelayMs: 60_000 });
        store.getState().hydrate(project);

        expect(store.getState().dispatch("缩放画板", [workspaceOperation("op-one", 1.25, 18, 24)])).toBe(true);
        expect(store.getState()).toMatchObject({ status: "dirty", pendingCount: 1, confirmedRevision: 7, project: { revision: 8, document: { revision: 8, workspace: { viewport: { x: 18, y: 24, zoom: 1.25 } } } } });
        expect(project.document).toMatchObject({ revision: 7, workspace: { viewport: { zoom: 0.25 } } });
        store.getState().destroy();
    });

    it("preserves a stable image import batch through optimistic apply and remote persistence", async () => {
        const project = createProject();
        const batch = createDesignImageImportBatch(project.document, {
            requestId: "upload-stable-one",
            name: "产品图",
            locator: { kind: "storage-key", storageKey: "permanent/images/product.png" },
            mimeType: "image/png",
            width: 1200,
            height: 800,
            createdAt: NOW,
            target: { scope: "workspace" },
            position: { x: 40, y: 80 },
            source: "upload",
            operation: "upload",
        });
        const applyRemote = vi.fn().mockImplementation(async (_id: string, savedBatch: DesignOperationBatch) => remoteResult(project, savedBatch));
        const store = createDesignEditorStore(project.id, { applyRemote, now: () => NOW, autosaveDelayMs: 60_000 });
        store.getState().hydrate(project);

        expect(store.getState().dispatchBatch(batch)).toBe(true);
        expect(store.getState()).toMatchObject({ status: "dirty", pendingCount: 1, project: { revision: 8, document: { assets: [{}, { id: batch.operations[0].type === "add-asset" ? batch.operations[0].asset.id : "" }] } } });
        await store.getState().flush();

        expect(applyRemote).toHaveBeenCalledTimes(1);
        expect(applyRemote.mock.calls[0][1]).toEqual(batch);
        expect(store.getState()).toMatchObject({ status: "saved", pendingCount: 0, confirmedRevision: 8 });
    });

    it("returns the real persistent receipt without creating a second save path", async () => {
        const project = createProject();
        const applyRemote = vi.fn().mockImplementation(async (_id: string, savedBatch: DesignOperationBatch) => {
            const result = remoteResult(project, savedBatch);
            return { ...result, receipt: { ...result.receipt, status: "replayed" as const, originalStatus: "applied" as const } };
        });
        const store = createDesignEditorStore(project.id, { applyRemote, now: () => NOW, autosaveDelayMs: 60_000 });
        store.getState().hydrate(project);
        const batch: DesignOperationBatch = { batchId: "batch-awaited", expectedRevision: 7, mode: "atomic", source: "system", label: "结果写回", operations: [workspaceOperation("op-awaited", 1, 30, 40)] };

        const committed = store.getState().dispatchBatchAndWait(batch);
        expect(store.getState()).toMatchObject({ status: "dirty", pendingCount: 1, project: { revision: 8 } });
        const flushing = store.getState().flush();

        await expect(committed).resolves.toMatchObject({ project: { revision: 8 }, receipt: { batchId: "batch-awaited", status: "replayed", originalStatus: "applied" } });
        await flushing;
        expect(applyRemote).toHaveBeenCalledTimes(1);
        expect(applyRemote).toHaveBeenCalledWith(project.id, batch);
    });

    it("rejects an awaited result commit when the server revision conflicts and preserves the local draft", async () => {
        const project = createProject();
        const store = createDesignEditorStore(project.id, {
            applyRemote: vi.fn().mockRejectedValue(new DesignProjectRequestError("revision conflict", 409)),
            loadRemote: vi.fn().mockResolvedValue(project),
            now: () => NOW,
            autosaveDelayMs: 60_000,
        });
        store.getState().hydrate(project);
        const batch: DesignOperationBatch = { batchId: "batch-conflict-awaited", expectedRevision: 7, mode: "atomic", source: "system", label: "结果写回", operations: [workspaceOperation("op-awaited-conflict", 1, 30, 40)] };

        const committed = store.getState().dispatchBatchAndWait(batch);
        await store.getState().flush();

        await expect(committed).rejects.toThrow("revision conflict");
        expect(store.getState()).toMatchObject({ status: "conflict", pendingCount: 1, project: { revision: 8 } });
    });

    it("rejects a stale explicit batch without changing the project or queue", () => {
        const project = createProject();
        const store = createDesignEditorStore(project.id, { now: () => NOW, autosaveDelayMs: 60_000 });
        store.getState().hydrate(project);
        const staleBatch: DesignOperationBatch = {
            batchId: "batch-stale",
            expectedRevision: project.revision - 1,
            mode: "atomic",
            source: "ui",
            label: "过期操作",
            operations: [workspaceOperation("op-stale", 1, 0, 0)],
        };

        expect(store.getState().dispatchBatch(staleBatch)).toBe(false);
        expect(store.getState()).toMatchObject({ status: "saved", pendingCount: 0, project: { revision: 7 } });
        store.getState().destroy();
    });

    it("keeps a same-scope runtime selection in the Store and clears it when all selected objects are deleted or reloaded away", () => {
        const project = createProject();
        const store = createDesignEditorStore(project.id, { createId: sequenceId(), now: () => NOW, autosaveDelayMs: 60_000 });
        store.getState().hydrate(project);
        store.getState().select({ kind: "elements", ids: ["element-title"] });
        expect(store.getState().selection).toEqual({ kind: "elements", ids: ["element-title"] });

        expect(store.getState().dispatch("删除标题", [{ opId: "op-delete-title", type: "delete-elements", elementIds: ["element-title"] }])).toBe(true);
        expect(store.getState().selection).toBeNull();
        store.getState().select({ kind: "frame", id: "frame-main" });
        const withoutFrame = structuredClone(project);
        withoutFrame.document.frames = withoutFrame.document.frames.filter((frame) => frame.id !== "frame-main");
        withoutFrame.document.elements = withoutFrame.document.elements.filter((element) => element.frameId !== "frame-main");
        withoutFrame.document.layers = withoutFrame.document.layers.filter((layer) => layer.scope !== "frame" || layer.frameId !== "frame-main");
        withoutFrame.document.annotations = withoutFrame.document.annotations.filter((annotation) => annotation.target.kind !== "frame" || annotation.target.frameId !== "frame-main");
        store.getState().hydrate(withoutFrame);
        expect(store.getState().selection).toBeNull();
        store.getState().destroy();
    });

    it("persists undo and redo as new typed FIFO batches", async () => {
        const project = createProject();
        let remote = structuredClone(project);
        const applyRemote = vi.fn().mockImplementation(async (_id: string, batch: DesignOperationBatch) => {
            const result = remoteResult(remote, batch);
            remote = result.project;
            return result;
        });
        const store = createDesignEditorStore(project.id, { applyRemote, createId: sequenceId(), now: () => NOW, autosaveDelayMs: 60_000 });
        store.getState().hydrate(project);

        expect(store.getState().dispatch("移动标题", [{ opId: "op-move", type: "update-transform", elementId: "element-title", transform: { ...project.document.elements.find((element) => element.id === "element-title")!.transform, x: 900 } }])).toBe(
            true,
        );
        expect(store.getState()).toMatchObject({ canUndo: true, canRedo: false, undoLabel: "移动标题" });
        expect(store.getState().undo()).toBe(true);
        expect(store.getState().project?.document.elements.find((element) => element.id === "element-title")?.transform.x).toBe(300);
        expect(store.getState()).toMatchObject({ canUndo: false, canRedo: true, redoLabel: "移动标题", pendingCount: 2 });
        expect(store.getState().redo()).toBe(true);
        expect(store.getState().project?.document.elements.find((element) => element.id === "element-title")?.transform.x).toBe(900);
        expect(store.getState()).toMatchObject({ canUndo: true, canRedo: false, pendingCount: 3 });

        await store.getState().flush();
        expect(applyRemote).toHaveBeenCalledTimes(3);
        expect(applyRemote.mock.calls.map((call) => call[1].label)).toEqual(["移动标题", "撤销：移动标题", "重做：移动标题"]);
        expect(store.getState()).toMatchObject({ status: "saved", confirmedRevision: 10 });
    });

    it("ignores viewport history and clears semantic history on hydrate", () => {
        const project = createProject();
        const store = createDesignEditorStore(project.id, { createId: sequenceId(), now: () => NOW, autosaveDelayMs: 60_000 });
        store.getState().hydrate(project);
        store.getState().dispatch("缩放", [workspaceOperation("op-viewport", 1, 10, 20)], { history: "ignore" });
        expect(store.getState()).toMatchObject({ canUndo: false, canRedo: false });
        store.getState().dispatch("重命名", [{ opId: "op-name", type: "update-element", elementId: "element-title", patch: { name: "新标题" } }]);
        expect(store.getState().canUndo).toBe(true);
        store.getState().hydrate(project);
        expect(store.getState()).toMatchObject({ canUndo: false, canRedo: false, undoLabel: null, redoLabel: null });
        store.getState().destroy();
    });

    it("preserves later viewport changes when undoing and redoing semantic history", () => {
        const project = createProject();
        const store = createDesignEditorStore(project.id, { createId: sequenceId(), now: () => NOW, autosaveDelayMs: 60_000 });
        store.getState().hydrate(project);
        store.getState().dispatch("重命名", [{ opId: "op-name", type: "update-element", elementId: "element-title", patch: { name: "历史标题" } }]);
        store.getState().dispatch("移动视口", [workspaceOperation("op-viewport", 1.5, 80, 90)], { history: "ignore" });

        expect(store.getState().undo()).toBe(true);
        expect(store.getState().project?.document.workspace.viewport).toEqual({ x: 80, y: 90, zoom: 1.5 });
        expect(store.getState().project?.document.elements.find((element) => element.id === "element-title")?.name).toBe("中英文标题");
        expect(store.getState().redo()).toBe(true);
        expect(store.getState().project?.document.workspace.viewport).toEqual({ x: 80, y: 90, zoom: 1.5 });
        expect(store.getState().project?.document.elements.find((element) => element.id === "element-title")?.name).toBe("历史标题");
        store.getState().destroy();
    });

    it("serializes consecutive operation batches and does not let an old response overwrite a newer draft", async () => {
        const project = createProject();
        const first = deferred<RemoteResult>();
        const second = deferred<RemoteResult>();
        const applyRemote = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const store = createDesignEditorStore(project.id, { applyRemote, createId: sequenceId(), now: () => NOW, autosaveDelayMs: 60_000 });
        store.getState().hydrate(project);
        store.getState().dispatch("第一次缩放", [workspaceOperation("op-one", 0.5, 10, 20)]);
        store.getState().dispatch("第二次缩放", [workspaceOperation("op-two", 1, 30, 40)]);

        const flushing = store.getState().flush();
        expect(applyRemote).toHaveBeenCalledTimes(1);
        const firstBatch = applyRemote.mock.calls[0][1] as DesignOperationBatch;
        first.resolve(remoteResult(project, firstBatch));
        await vi.waitFor(() => expect(applyRemote).toHaveBeenCalledTimes(2));
        expect(store.getState().project?.document.workspace.viewport).toEqual({ x: 30, y: 40, zoom: 1 });
        expect(store.getState().project?.revision).toBe(9);

        const firstSaved = remoteResult(project, firstBatch).project;
        const secondBatch = applyRemote.mock.calls[1][1] as DesignOperationBatch;
        second.resolve(remoteResult(firstSaved, secondBatch));
        await flushing;
        expect(store.getState()).toMatchObject({ status: "saved", pendingCount: 0, confirmedRevision: 9, project: { revision: 9 } });
    });

    it("retries the exact same batch id after a network failure and accepts a replay receipt", async () => {
        const project = createProject();
        const applyRemote = vi
            .fn()
            .mockRejectedValueOnce(new Error("connection reset"))
            .mockImplementationOnce(async (_id: string, batch: DesignOperationBatch) => {
                const result = remoteResult(project, batch);
                return { ...result, receipt: { ...result.receipt, status: "replayed" as const, originalStatus: "applied" as const } };
            });
        const store = createDesignEditorStore(project.id, { applyRemote, createId: sequenceId(), now: () => NOW, autosaveDelayMs: 60_000 });
        store.getState().hydrate(project);
        store.getState().dispatch("缩放", [workspaceOperation("op-retry", 1.5, 0, 0)]);

        await store.getState().flush();
        expect(store.getState()).toMatchObject({ status: "error", pendingCount: 1, project: { revision: 8 } });
        await store.getState().retrySave();
        expect(applyRemote.mock.calls[0][1].batchId).toBe(applyRemote.mock.calls[1][1].batchId);
        expect(store.getState()).toMatchObject({ status: "saved", pendingCount: 0, confirmedRevision: 8, project: { revision: 8 } });
    });

    it("does not acknowledge a mismatched remote receipt", async () => {
        const project = createProject();
        const applyRemote = vi.fn().mockImplementation(async (_id: string, batch: DesignOperationBatch) => {
            const result = remoteResult(project, batch);
            return { ...result, receipt: { ...result.receipt, batchId: "batch-other" } };
        });
        const store = createDesignEditorStore(project.id, { applyRemote, createId: sequenceId(), now: () => NOW, autosaveDelayMs: 60_000 });
        store.getState().hydrate(project);
        const batch: DesignOperationBatch = { batchId: "batch-one", expectedRevision: 7, mode: "atomic", source: "system", label: "缩放", operations: [workspaceOperation("op-one", 1.25, 0, 0)] };
        const committed = store.getState().dispatchBatchAndWait(batch);

        await store.getState().flush();
        await expect(committed).rejects.toThrow("回执与本地保存批次不一致");
        expect(store.getState()).toMatchObject({ status: "error", pendingCount: 1, confirmedRevision: 7, project: { revision: 8 } });
        expect(store.getState().errorMessage).toContain("回执与本地保存批次不一致");
    });

    it("enters conflict without discarding the local draft and explicitly reloads the remote project", async () => {
        const project = createProject();
        const remoteBatch: DesignOperationBatch = { batchId: "batch-remote", expectedRevision: 7, mode: "atomic", source: "ui", label: "另一标签缩放", operations: [workspaceOperation("op-remote", 2, 90, 100)] };
        const remoteProject = remoteResult(project, remoteBatch).project;
        const loadRemote = vi.fn().mockResolvedValue(remoteProject);
        const store = createDesignEditorStore(project.id, {
            applyRemote: vi.fn().mockRejectedValue(new DesignProjectRequestError("revision conflict", 409)),
            loadRemote,
            createId: sequenceId(),
            now: () => NOW,
            autosaveDelayMs: 60_000,
        });
        store.getState().hydrate(project);
        store.getState().dispatch("本地缩放", [workspaceOperation("op-local", 0.75, 15, 25)]);
        await store.getState().flush();

        expect(store.getState()).toMatchObject({
            status: "conflict",
            pendingCount: 1,
            confirmedRevision: 7,
            project: { revision: 8, document: { workspace: { viewport: { x: 15, y: 25, zoom: 0.75 } } } },
            remoteProject: { revision: 8, document: { workspace: { viewport: { x: 90, y: 100, zoom: 2 } } } },
        });
        expect(store.getState().dispatch("冲突时禁止继续", [workspaceOperation("op-blocked", 1, 0, 0)])).toBe(false);

        await store.getState().reloadServerVersion();
        expect(store.getState()).toMatchObject({ status: "saved", pendingCount: 0, confirmedRevision: 8, remoteProject: null, project: { document: { workspace: { viewport: { x: 90, y: 100, zoom: 2 } } } } });
    });

    it("ignores an in-flight response after the store is destroyed", async () => {
        const project = createProject();
        const pending = deferred<RemoteResult>();
        const store = createDesignEditorStore(project.id, { applyRemote: vi.fn().mockReturnValue(pending.promise), createId: sequenceId(), now: () => NOW, autosaveDelayMs: 60_000 });
        store.getState().hydrate(project);
        store.getState().dispatch("缩放", [workspaceOperation("op-one", 1.25, 0, 0)]);
        const flushing = store.getState().flush();
        const beforeDestroy = store.getState();
        store.getState().destroy();
        pending.resolve(remoteResult(project, { batchId: "batch-id-1", expectedRevision: 7, mode: "atomic", source: "ui", label: "缩放", operations: [workspaceOperation("op-one", 1.25, 0, 0)] }));
        await flushing;
        expect(store.getState()).toEqual(beforeDestroy);
        expect(store.getState().dispatch("销毁后操作", [workspaceOperation("op-after-destroy", 2, 0, 0)])).toBe(false);
    });
});

type RemoteResult = ReturnType<typeof remoteResult>;

function createProject(): DesignProject {
    const document = createDesignDocumentFixture();
    return { id: document.id, title: document.metadata.title, status: "active", revision: document.revision, document, createdAt: document.metadata.createdAt, updatedAt: document.metadata.updatedAt };
}

function workspaceOperation(opId: string, zoom: number, x: number, y: number) {
    return { opId, type: "update-workspace" as const, patch: { viewport: { x, y, zoom } } };
}

function remoteResult(project: DesignProject, batch: DesignOperationBatch) {
    const outcome = applyDesignOperationBatch(project.document, batch, { now: () => NOW });
    return { project: { ...project, revision: outcome.document.revision, document: outcome.document, updatedAt: outcome.document.metadata.updatedAt }, receipt: outcome.receipt };
}

function sequenceId() {
    let index = 0;
    return () => `id-${++index}`;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}
