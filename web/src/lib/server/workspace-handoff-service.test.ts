import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CanvasNodeType } from "@/app/(user)/canvas/types";
import type { CanvasProject } from "@/lib/canvas-project-contract";
import { canvasSaveFingerprint } from "@/lib/canvas-project-receipt";
import { workspaceHandoffRequestFingerprint } from "@/lib/creative-workspace";
import type { DesignDocument } from "@/lib/design";
import { sha256Hex } from "@/lib/sha256";
import { applyCanvasProjectNodeImportBatch, createCanvasProject, getCanvasProject, saveCanvasProject } from "@/lib/server/canvas-project-store";
import { createDesignProjectForUser } from "@/lib/server/design-project-service";
import { getDesignProject } from "@/lib/server/design-project-store";
import { registerLocalMediaAsset } from "@/lib/server/local-media-registry";
import { claimWorkspaceHandoff, prepareWorkspaceHandoffTarget } from "@/lib/server/workspace-handoff-store";

import { executeWorkspaceHandoffForUser } from "./workspace-handoff-service";

const NOW = "2026-08-13T12:00:00.000Z";
let dataDir = "";

describe.sequential("Workspace handoff service file integration", () => {
    beforeAll(async () => {
        dataDir = await mkdtemp(join(tmpdir(), "dq-workspace-handoff-"));
        process.env.DQ_DATABASE_PROVIDER = "file";
        process.env.DQ_DATA_DIR = dataDir;
    });

    afterAll(async () => {
        delete process.env.DQ_DATA_DIR;
        delete process.env.DQ_DATABASE_PROVIDER;
        await rm(dataDir, { recursive: true, force: true });
    });

    it("moves selected permanent Canvas images into Design and replays after the source changes", async () => {
        const source = canvasProject("canvas-source", [canvasImage("canvas-image-one", "permanent/source-one.png", 1200, 800)]);
        await createCanvasProject("user-one", source);
        await registerImage("user-one", "permanent/source-one.png", "reference");
        const target = await createDesignProjectForUser("user-one", { title: "Design target" });
        const request = {
            handoffId: "canvas-to-design-one",
            source: { surface: "canvas" as const, projectId: source.id, revision: 0, selectionIds: ["canvas-image-one"] },
            target: { surface: "design" as const, projectId: target.id, baseRevision: 0 },
        };

        const applied = await executeWorkspaceHandoffForUser("user-one", request);
        expect(applied).toMatchObject({ status: "applied", target: { resultRevision: 1 }, targetIds: [expect.stringMatching(/^element-/)] });
        const savedTarget = await getDesignProject("user-one", target.id);
        expect(savedTarget).toMatchObject({ revision: 1, document: { assets: [{ currentVersionId: expect.stringMatching(/^version-/) }], elements: [{ kind: "image" }] } });
        expect(savedTarget?.document.assetVersions[0]).toMatchObject({ locator: { kind: "storage-key", storageKey: "permanent/source-one.png" }, width: 1200, height: 800 });

        const changedSource = { ...source, title: "Changed after handoff" };
        const sourceSave = { project: changedSource, expectedRevision: 0, batchId: "source-change", fingerprint: canvasSaveFingerprint(changedSource, 0) };
        await saveCanvasProject("user-one", sourceSave);
        const replayed = await executeWorkspaceHandoffForUser("user-one", request);
        expect(replayed).toMatchObject({ status: "replayed", originalStatus: "applied", targetIds: applied.targetIds });
        expect((await getDesignProject("user-one", target.id))?.document.elements).toHaveLength(1);
    });

    it("moves selected Design images into Canvas through a real Canvas save receipt", async () => {
        await registerImage("user-one", "permanent/design-source.png", "generation");
        const source = await createDesignProjectForUser("user-one", { title: "Design source", document: designDocument("placeholder", "permanent/design-source.png") });
        const target = canvasProject("canvas-target", []);
        await createCanvasProject("user-one", target);
        const request = {
            handoffId: "design-to-canvas-one",
            source: { surface: "design" as const, projectId: source.id, revision: 0, selectionIds: ["element-source"] },
            target: { surface: "canvas" as const, projectId: target.id, baseRevision: 0 },
        };

        const [first, concurrent] = await Promise.all([executeWorkspaceHandoffForUser("user-one", request), executeWorkspaceHandoffForUser("user-one", structuredClone(request))]);
        expect(first).toMatchObject({ status: "applied", target: { resultRevision: 1 }, targetIds: [expect.stringMatching(/^image-/)] });
        expect(concurrent).toEqual(first);
        const saved = await getCanvasProject(target.id, "user-one");
        expect(saved).toMatchObject({ revision: 1, nodes: [{ type: "image", metadata: { storageKey: "permanent/design-source.png", content: "/api/generation-log-assets/permanent/design-source.png" } }] });

        const replayed = await executeWorkspaceHandoffForUser("user-one", request);
        expect(replayed).toMatchObject({ status: "replayed", originalStatus: "applied", targetIds: first.targetIds });
        expect((await getCanvasProject(target.id, "user-one"))?.nodes).toHaveLength(1);
    });

    it("fails closed for revision conflicts and handoff identity reuse", async () => {
        const source = canvasProject("canvas-conflict-source", [canvasImage("conflict-image", "permanent/conflict.png", 100, 100)]);
        await createCanvasProject("user-one", source);
        await registerImage("user-one", "permanent/conflict.png", "reference");
        const target = await createDesignProjectForUser("user-one", { title: "Conflict target" });
        const stale = {
            handoffId: "revision-conflict",
            source: { surface: "canvas" as const, projectId: source.id, revision: 9, selectionIds: ["conflict-image"] },
            target: { surface: "design" as const, projectId: target.id, baseRevision: 0 },
        };

        await expect(executeWorkspaceHandoffForUser("user-one", stale)).resolves.toMatchObject({ status: "conflict", error: { code: "HANDOFF_SOURCE_REVISION_CONFLICT" } });
        await expect(executeWorkspaceHandoffForUser("user-one", { ...stale, source: { ...stale.source, revision: 0 } })).resolves.toMatchObject({ status: "conflict", error: { code: "HANDOFF_ID_CONFLICT" } });
        expect((await getDesignProject("user-one", target.id))?.revision).toBe(0);
    });

    it("rejects temporary or foreign media and releases the claim for a corrected retry", async () => {
        const source = canvasProject("canvas-invalid-source", [canvasImage("invalid-image", "temporary/invalid.png", 100, 100)]);
        await createCanvasProject("user-one", source);
        await registerImage("user-one", "temporary/invalid.png", "reference", "temporary");
        const target = await createDesignProjectForUser("user-one", { title: "Validation target" });
        const request = {
            handoffId: "validation-retry",
            source: { surface: "canvas" as const, projectId: source.id, revision: 0, selectionIds: ["invalid-image"] },
            target: { surface: "design" as const, projectId: target.id, baseRevision: 0 },
        };

        await expect(executeWorkspaceHandoffForUser("user-one", request)).rejects.toMatchObject({ status: 400 });
        const database = JSON.parse(await readFile(join(dataDir, "workspace-handoffs.json"), "utf8")) as { records: unknown[] };
        expect(database.records).not.toContainEqual(expect.objectContaining({ handoffId: request.handoffId }));

        await registerImage("user-two", "permanent/foreign.png", "reference");
        const foreign = canvasProject("canvas-foreign-source", [canvasImage("foreign-image", "permanent/foreign.png", 100, 100)]);
        await createCanvasProject("user-one", foreign);
        await expect(
            executeWorkspaceHandoffForUser("user-one", {
                handoffId: "foreign-media",
                source: { surface: "canvas", projectId: foreign.id, revision: 0, selectionIds: ["foreign-image"] },
                target: { surface: "design", projectId: target.id, baseRevision: 0 },
            }),
        ).rejects.toMatchObject({ status: 404 });
    });

    it("does not recover a target receipt whose fingerprint differs from the prepared handoff write", async () => {
        await registerImage("user-one", "permanent/recovery-source.png", "generation");
        const source = await createDesignProjectForUser("user-one", { title: "Recovery source", document: designDocument("placeholder", "permanent/recovery-source.png") });
        const target = canvasProject("canvas-recovery-target", []);
        await createCanvasProject("user-one", target);
        const request = {
            handoffId: "target-receipt-mismatch",
            source: { surface: "design" as const, projectId: source.id, revision: 0, selectionIds: ["element-source"] },
            target: { surface: "canvas" as const, projectId: target.id, baseRevision: 0 },
        };
        const fingerprint = workspaceHandoffRequestFingerprint(request);
        const batchId = `handoff-${request.handoffId}-${sha256Hex(fingerprint).slice(0, 16)}`;
        const expectedTargetFingerprint = `sha256:${"a".repeat(64)}`;
        const unrelatedTargetFingerprint = `sha256:${"b".repeat(64)}`;
        const staleAt = "2000-01-01T00:00:00.000Z";

        await claimWorkspaceHandoff("user-one", request, fingerprint, staleAt);
        await prepareWorkspaceHandoffTarget("user-one", request.handoffId, fingerprint, batchId, expectedTargetFingerprint, staleAt);
        await applyCanvasProjectNodeImportBatch("user-one", {
            projectId: target.id,
            expectedRevision: 0,
            batchId,
            fingerprint: unrelatedTargetFingerprint,
            nodes: [canvasImage("unrelated-node", "permanent/unrelated.png", 64, 64)],
            updatedAt: NOW,
        });

        const result = await executeWorkspaceHandoffForUser("user-one", request);
        expect(result).toMatchObject({ status: "conflict", error: { code: "HANDOFF_TARGET_REVISION_CONFLICT" }, targetIds: [] });
        expect((await getCanvasProject(target.id, "user-one"))?.nodes.map((node) => node.id)).toEqual(["unrelated-node"]);
    });

    it("does not persist URLs, inline data, or provider payloads in its coordination log", async () => {
        const database = JSON.parse(await readFile(join(dataDir, "workspace-handoffs.json"), "utf8")) as unknown;
        expect(JSON.stringify(database)).not.toMatch(/(?:data|blob|https?):|providerPayload|authorization|apiKey/i);
    });
});

function canvasProject(id: string, nodes: CanvasProject["nodes"]): CanvasProject {
    return {
        id,
        revision: 0,
        title: id,
        createdAt: NOW,
        updatedAt: NOW,
        nodes,
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
    };
}

function canvasImage(id: string, storageKey: string, width: number, height: number): CanvasProject["nodes"][number] {
    return {
        id,
        type: CanvasNodeType.Image,
        title: id,
        position: { x: 0, y: 0 },
        width: Math.min(width, 480),
        height: Math.min(height, 480),
        metadata: { storageKey, serverUrl: `/api/reference-assets/${storageKey}`, naturalWidth: width, naturalHeight: height, mimeType: "image/png", status: "success" },
    };
}

function designDocument(id: string, storageKey: string): DesignDocument {
    return {
        schemaVersion: 1,
        id,
        revision: 0,
        metadata: { title: "Design source", description: "", createdAt: NOW, updatedAt: NOW },
        workspace: { background: "#e5e7eb", viewport: { x: 0, y: 0, zoom: 1 } },
        guides: [],
        frames: [],
        assets: [{ id: "asset-source", kind: "image", name: "Source", currentVersionId: "version-source", versionIds: ["version-source"] }],
        assetVersions: [
            {
                id: "version-source",
                assetId: "asset-source",
                parentVersionId: null,
                source: "upload",
                locator: { kind: "storage-key", storageKey },
                mimeType: "image/png",
                width: 1600,
                height: 900,
                createdAt: NOW,
                provenance: { operation: "upload", sourceElementId: null, generationTaskId: null },
            },
        ],
        elements: [
            {
                id: "element-source",
                frameId: null,
                name: "Design image",
                transform: { x: 0, y: 0, width: 640, height: 360, rotation: 0, flipX: false, flipY: false },
                opacity: 1,
                blendMode: "normal",
                locked: false,
                hidden: false,
                kind: "image",
                assetVersionId: "version-source",
                crop: null,
                fit: "contain",
                cornerRadius: 0,
            },
        ],
        layers: [{ scope: "workspace", elementIds: ["element-source"] }],
        annotations: [],
    };
}

function registerImage(ownerUserId: string, storageKey: string, scope: "generation" | "reference", storageClass: "permanent" | "temporary" = "permanent") {
    return registerLocalMediaAsset({
        storageKey,
        scope,
        storageClass,
        type: "image",
        ownerUserId,
        source: "test",
        mimeType: "image/png",
        bytes: 128,
        createdAt: NOW,
        ...(storageClass === "temporary" ? { expiresAt: "2026-08-14T12:00:00.000Z" } : {}),
    });
}
