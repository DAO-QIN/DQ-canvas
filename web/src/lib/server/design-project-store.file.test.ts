import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDesignDocumentFixture } from "@/lib/design/design.test-fixture";
import {
    applyDesignOperationsForUser,
    createDesignProjectForUser,
    createDesignProjectVersionForUser,
    deleteDesignProjectForUser,
    getDesignProjectForUser,
    listDesignProjectsForUser,
    listDesignProjectVersionsForUser,
    restoreDesignProjectVersionForUser,
    updateDesignProjectForUser,
} from "@/lib/server/design-project-service";
import { readDesignProjectArchive } from "@/lib/server/design-project-store";

let dataDir = "";

describe.sequential("design project file provider integration", () => {
    beforeAll(async () => {
        dataDir = await mkdtemp(join(tmpdir(), "dq-design-projects-"));
        process.env.DQ_DATABASE_PROVIDER = "file";
        process.env.DQ_DATA_DIR = dataDir;
    });

    afterAll(async () => {
        delete process.env.DQ_DATA_DIR;
        delete process.env.DQ_DATABASE_PROVIDER;
        await rm(dataDir, { recursive: true, force: true });
    });

    it("keeps CRUD, versions, restore and Ops consistent and isolated", async () => {
        const source = createDesignDocumentFixture();
        source.revision = 0;
        const first = await createDesignProjectForUser("user-one", { title: "商品主图", document: source });
        const second = await createDesignProjectForUser("user-two", { title: "其他用户", document: source });

        expect(first.id).not.toBe(second.id);
        await expect(getDesignProjectForUser("user-two", first.id)).rejects.toMatchObject({ status: 404 });
        await expect(listDesignProjectsForUser("user-one")).resolves.toMatchObject({ total: 1, items: [{ id: first.id, revision: 0, frameCount: 2 }] });

        const revisionOne = structuredClone(first.document);
        revisionOne.revision = 1;
        revisionOne.metadata.title = "商品主图 v1";
        const savedOne = await updateDesignProjectForUser("user-one", first.id, { expectedRevision: 0, document: revisionOne });
        expect(savedOne).toMatchObject({ revision: 1, title: "商品主图 v1" });
        await expect(updateDesignProjectForUser("user-one", first.id, { expectedRevision: 0, document: revisionOne })).rejects.toMatchObject({ status: 409 });

        const version = await createDesignProjectVersionForUser("user-one", first.id, { expectedRevision: 1, reason: "确认稿" });
        expect(version).toMatchObject({ version: 1, snapshotRevision: 1, reason: "确认稿" });

        const revisionTwo = structuredClone(savedOne.document);
        revisionTwo.revision = 2;
        revisionTwo.metadata.title = "临时改稿";
        await updateDesignProjectForUser("user-one", first.id, { expectedRevision: 1, document: revisionTwo });
        const restored = await restoreDesignProjectVersionForUser("user-one", first.id, version.id, { expectedRevision: 2 });
        expect(restored).toMatchObject({ revision: 3, title: "商品主图 v1" });
        await expect(listDesignProjectVersionsForUser("user-one", first.id)).resolves.toMatchObject([
            { version: 2, snapshotRevision: 2, reason: "恢复前自动快照" },
            { version: 1, snapshotRevision: 1, reason: "确认稿" },
        ]);

        const batch = {
            batchId: "batch-file-one",
            expectedRevision: 3,
            mode: "atomic",
            source: "ui",
            label: "重命名 Frame",
            operations: [{ opId: "op-file-one", type: "update-frame", frameId: "frame-main", patch: { name: "新版主图" } }],
        };
        const applied = await applyDesignOperationsForUser("user-one", first.id, batch);
        expect(applied.receipt).toMatchObject({ status: "applied", baseRevision: 3, resultRevision: 4 });
        expect(applied.project.document.frames[0].name).toBe("新版主图");

        const replayed = await applyDesignOperationsForUser("user-one", first.id, batch);
        expect(replayed.receipt).toMatchObject({ status: "replayed", originalStatus: "applied", resultRevision: 4 });
        expect(replayed.project.revision).toBe(4);

        const conflictingBatch = { ...batch, label: "不同内容" };
        const conflict = await applyDesignOperationsForUser("user-one", first.id, conflictingBatch);
        expect(conflict.receipt).toMatchObject({ status: "conflict", resultRevision: 4 });
        expect(conflict.project.revision).toBe(4);

        const archive = await readDesignProjectArchive("user-one");
        expect(archive.projects).toEqual([expect.objectContaining({ id: first.id, revision: 4 })]);
        expect(archive.versions).toEqual([
            expect.objectContaining({ projectId: first.id, version: 2, snapshotRevision: 2, snapshot: expect.objectContaining({ id: first.id, revision: 2 }) }),
            expect.objectContaining({ projectId: first.id, version: 1, snapshotRevision: 1, snapshot: expect.objectContaining({ id: first.id, revision: 1 }) }),
        ]);
        expect(archive.receipts).toEqual([expect.objectContaining({ projectId: first.id, replay: expect.objectContaining({ batchId: "batch-file-one" }) })]);

        await expect(deleteDesignProjectForUser("user-one", first.id, { expectedRevision: 3 })).rejects.toMatchObject({ status: 409 });
        await expect(deleteDesignProjectForUser("user-one", first.id, { expectedRevision: 4 })).resolves.toBe(true);
        await expect(getDesignProjectForUser("user-one", first.id)).rejects.toMatchObject({ status: 404 });
        await expect(getDesignProjectForUser("user-two", second.id)).resolves.toMatchObject({ id: second.id });

        const persisted = JSON.parse(await readFile(join(dataDir, "design-projects.json"), "utf8")) as { projects: unknown[]; versions: unknown[]; receipts: unknown[] };
        expect(persisted).toMatchObject({ projects: [{ userId: "user-two" }], versions: [], receipts: [] });
        await expect(readFile(join(dataDir, "canvas-projects.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("does not accept client snapshots when creating a manual version", async () => {
        const project = await createDesignProjectForUser("user-one", { title: "版本边界" });
        await expect(createDesignProjectVersionForUser("user-one", project.id, { expectedRevision: 0, snapshot: project.document })).rejects.toMatchObject({ status: 400 });
    });

    it("serializes concurrent file mutations so only one stale writer wins", async () => {
        const project = await createDesignProjectForUser("user-one", { title: "并发测试" });
        const left = structuredClone(project.document);
        left.revision = 1;
        left.metadata.title = "左侧";
        const right = structuredClone(project.document);
        right.revision = 1;
        right.metadata.title = "右侧";

        const outcomes = await Promise.allSettled([updateDesignProjectForUser("user-one", project.id, { expectedRevision: 0, document: left }), updateDesignProjectForUser("user-one", project.id, { expectedRevision: 0, document: right })]);

        expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
        const rejected = outcomes.find((outcome) => outcome.status === "rejected");
        expect(rejected).toMatchObject({ status: "rejected", reason: { status: 409 } });
        await expect(getDesignProjectForUser("user-one", project.id)).resolves.toMatchObject({ revision: 1 });
    });
});
