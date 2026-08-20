import { describe, expect, it, vi } from "vitest";

import { confirmWorkspaceActionRequest, type WorkspaceActionRequest } from "@/lib/creative-workspace";
import { applyDesignOperationBatch, type DesignDocument, type DesignOperationBatch } from "@/lib/design";
import { createDesignDocumentFixture } from "@/lib/design/design.test-fixture";

import { createDesignWorkspaceSnapshot, designWorkspaceActionsToBatch, executeDesignWorkspaceActions } from "./design-workspace-agent-adapter";

function request(action: WorkspaceActionRequest["actions"][number], document: DesignDocument, overrides: Partial<WorkspaceActionRequest> = {}): WorkspaceActionRequest {
    return { surface: "design", projectId: document.id, baseRevision: document.revision, batchId: `batch-${action.actionId}`, actions: [action], ...overrides };
}

describe("Design workspace Agent adapter", () => {
    it("projects frame, element and immutable stable resource semantics without domain leakage", () => {
        const document = createDesignDocumentFixture();
        const snapshot = createDesignWorkspaceSnapshot(document, ["element-product"]);

        expect(snapshot).toMatchObject({ surface: "design", projectId: document.id, revision: 7, selectionIds: ["element-product"], truncated: false });
        expect(snapshot.entities.find((entity) => entity.id === "element-product")).toEqual(expect.objectContaining({ kind: "image", parentId: "frame-main", resource: { kind: "library-asset", libraryAssetId: "library-product-cutout" } }));
        expect(snapshot.entities.find((entity) => entity.id === "element-title")).toEqual(expect.objectContaining({ kind: "text", text: "DQ Bottle / 轻盈一整天" }));
        expect(JSON.stringify(snapshot)).not.toMatch(/generationTaskId|assetVersionId|DesignDocument|https?:|blob:/);
    });

    it("executes reads without a batch commit", async () => {
        const document = createDesignDocumentFixture();
        const commitBatch = vi.fn();
        const receipt = await executeDesignWorkspaceActions({
            request: request({ actionId: "read-selection", kind: "inspect", effect: "read", command: "selection.read", label: "读取选区", targetIds: ["element-product"], parameters: {} }, document),
            document,
            commitBatch,
        });

        expect(receipt).toMatchObject({ status: "applied", baseRevision: 7, resultRevision: 7, affectedIds: ["element-product"] });
        expect(commitBatch).not.toHaveBeenCalled();
    });

    it("requires confirmation and compiles writes into one atomic Agent batch", async () => {
        const document = createDesignDocumentFixture();
        const pending = request({ actionId: "update-title", kind: "update", effect: "write", command: "content.update", label: "修改标题", targetIds: ["element-title"], parameters: { text: "夏日轻盈，一整天" } }, document);
        const commitBatch = vi.fn();

        expect((await executeDesignWorkspaceActions({ request: pending, document, commitBatch })).status).toBe("confirmation-required");
        expect(commitBatch).not.toHaveBeenCalled();

        const confirmed = confirmWorkspaceActionRequest(pending, "2026-08-13T12:00:00.000Z");
        const batch = designWorkspaceActionsToBatch(confirmed, document);
        expect(batch).toMatchObject({ batchId: pending.batchId, expectedRevision: 7, mode: "atomic", source: "agent", label: "修改标题" });
        expect(batch.operations).toEqual([{ opId: "op-update-title-2", type: "update-text", elementId: "element-title", patch: { text: "夏日轻盈，一整天" } }]);

        const commit = vi.fn(async (savedBatch: DesignOperationBatch) => {
            const outcome = applyDesignOperationBatch(document, savedBatch, { now: () => "2026-08-13T12:00:01.000Z" });
            return { receipt: outcome.receipt };
        });
        const receipt = await executeDesignWorkspaceActions({ request: confirmed, document, commitBatch: commit });
        expect(receipt).toMatchObject({ status: "applied", baseRevision: 7, resultRevision: 8, affectedIds: ["element-title"] });
        expect(commit).toHaveBeenCalledWith(expect.objectContaining({ source: "agent", mode: "atomic" }));
    });

    it("fails closed before commit for locked elements, stale revisions and disguised writes", async () => {
        const document = createDesignDocumentFixture();
        const lockedDocument = { ...document, elements: document.elements.map((element) => (element.id === "element-title" ? { ...element, locked: true } : element)) } as DesignDocument;
        const lockedRequest = confirmWorkspaceActionRequest(
            request({ actionId: "delete-title", kind: "delete", effect: "write", command: "content.delete", label: "删除标题", targetIds: ["element-title"], parameters: {} }, lockedDocument),
            "2026-08-13T12:00:00.000Z",
        );
        const commitBatch = vi.fn();
        expect(await executeDesignWorkspaceActions({ request: lockedRequest, document: lockedDocument, commitBatch })).toMatchObject({ status: "rejected", error: { code: "LOCKED" } });
        expect(commitBatch).not.toHaveBeenCalled();

        const stale = request({ actionId: "read", kind: "inspect", effect: "read", command: "workspace.read", label: "读取画板", targetIds: [], parameters: {} }, document, { baseRevision: 6 });
        expect(await executeDesignWorkspaceActions({ request: stale, document, commitBatch })).toMatchObject({ status: "conflict", error: { code: "REVISION_CONFLICT" } });

        const disguised = request({ actionId: "delete", kind: "delete", effect: "read", command: "content.delete", label: "删除", targetIds: ["element-title"], parameters: {} }, document);
        expect(await executeDesignWorkspaceActions({ request: disguised, document, commitBatch })).toMatchObject({ status: "rejected", error: { code: "INVALID_ACTION" } });
        expect(commitBatch).not.toHaveBeenCalled();
    });

    it("validates stable image locators and maps insertion to add-asset plus create-element", () => {
        const document = createDesignDocumentFixture();
        const confirmed = confirmWorkspaceActionRequest(
            request(
                {
                    actionId: "insert-image",
                    kind: "create",
                    effect: "write",
                    command: "asset.insert-image",
                    label: "插入图片",
                    targetIds: [],
                    parameters: {
                        name: "商品派生图",
                        resource: { kind: "storage-key", storageKey: "permanent/derived.png" },
                        mimeType: "image/png",
                        width: 1200,
                        height: 900,
                        position: { x: 200, y: 300 },
                    },
                },
                document,
            ),
            "2026-08-13T12:00:00.000Z",
        );
        const batch = designWorkspaceActionsToBatch(confirmed, document);
        expect(batch.operations.map((operation) => operation.type)).toEqual(["add-asset", "create-element"]);
        expect(batch.operations[0]).toEqual(expect.objectContaining({ opId: "op-insert-image-0", type: "add-asset" }));
        expect(batch.operations[1]).toEqual(expect.objectContaining({ opId: "op-insert-image-1", type: "create-element" }));
    });

    it("rejects an invalid remote receipt instead of reporting success", async () => {
        const document = createDesignDocumentFixture();
        const confirmed = confirmWorkspaceActionRequest(
            request({ actionId: "hide-title", kind: "update", effect: "write", command: "content.update", label: "隐藏标题", targetIds: ["element-title"], parameters: { hidden: true } }, document),
            "2026-08-13T12:00:00.000Z",
        );
        const receipt = await executeDesignWorkspaceActions({
            request: confirmed,
            document,
            commitBatch: async (batch) => {
                const outcome = applyDesignOperationBatch(document, batch);
                return { receipt: { ...outcome.receipt, fingerprint: "sha256:" + "0".repeat(64) } };
            },
        });

        expect(receipt).toMatchObject({ status: "rejected", error: { code: "INVALID_ACTION" } });
    });

    it("keeps persistence failures retryable instead of reporting an optimistic terminal receipt", async () => {
        const document = createDesignDocumentFixture();
        const confirmed = confirmWorkspaceActionRequest(
            request({ actionId: "hide-title", kind: "update", effect: "write", command: "content.update", label: "隐藏标题", targetIds: ["element-title"], parameters: { hidden: true } }, document),
            "2026-08-13T12:00:00.000Z",
        );

        await expect(
            executeDesignWorkspaceActions({
                request: confirmed,
                document,
                commitBatch: async () => {
                    throw new Error("database unavailable");
                },
            }),
        ).rejects.toThrow("database unavailable");
    });

    it("preserves real revision conflicts and replayed receipts from the Design store", async () => {
        const document = createDesignDocumentFixture();
        const confirmed = confirmWorkspaceActionRequest(
            request({ actionId: "hide-title", kind: "update", effect: "write", command: "content.update", label: "隐藏标题", targetIds: ["element-title"], parameters: { hidden: true } }, document),
            "2026-08-13T12:00:00.000Z",
        );

        const conflict = await executeDesignWorkspaceActions({
            request: confirmed,
            document,
            commitBatch: async () => {
                throw Object.assign(new Error("revision conflict"), { status: 409 });
            },
        });
        expect(conflict).toMatchObject({ status: "conflict", baseRevision: 7, resultRevision: 7, error: { code: "REVISION_CONFLICT", retryable: true } });

        const first = applyDesignOperationBatch(document, designWorkspaceActionsToBatch(confirmed, document), { now: () => "2026-08-13T12:00:01.000Z" });
        const replayed = await executeDesignWorkspaceActions({
            request: confirmed,
            document,
            commitBatch: async () => ({ receipt: { ...first.receipt, status: "replayed", originalStatus: "applied" } }),
        });
        expect(replayed).toMatchObject({ status: "replayed", baseRevision: 7, resultRevision: 8, affectedIds: ["element-title"] });
    });
});
