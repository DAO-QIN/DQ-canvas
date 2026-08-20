import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDesignDocumentFixture } from "@/lib/design/design.test-fixture";
import { initializePostgresSchema, postgresQuery } from "@/lib/server/database";
import {
    applyDesignOperationsForUser,
    createDesignProjectForUser,
    createDesignProjectVersionForUser,
    deleteDesignProjectForUser,
    getDesignProjectForUser,
    listDesignProjectVersionsForUser,
    restoreDesignProjectVersionForUser,
    updateDesignProjectForUser,
} from "@/lib/server/design-project-service";

const databaseUrl = process.env.DESIGN_POSTGRES_TEST_URL?.trim();
const USER_ONE = "phase3-pg-user-one";
const USER_TWO = "phase3-pg-user-two";

describe.runIf(Boolean(databaseUrl)).sequential("design project PostgreSQL integration", () => {
    beforeAll(async () => {
        process.env.DQ_DATABASE_PROVIDER = "postgres";
        process.env.DATABASE_URL = databaseUrl;
        await initializePostgresSchema();
        await postgresQuery(
            `INSERT INTO users (id, username, display_name, password_hash)
             VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)
             ON CONFLICT (id) DO NOTHING`,
            [USER_ONE, USER_ONE, "Phase 3 PG One", "test-only", USER_TWO, USER_TWO, "Phase 3 PG Two", "test-only"],
        );
    }, 60_000);

    afterAll(async () => {
        await postgresQuery("DELETE FROM users WHERE id = ANY($1::text[])", [[USER_ONE, USER_TWO]]);
        delete process.env.DATABASE_URL;
        delete process.env.DQ_DATABASE_PROVIDER;
    });

    it("executes DDL, concurrent writes, restore, replay and cascades against PostgreSQL", async () => {
        const source = createDesignDocumentFixture();
        source.revision = 0;
        const project = await createDesignProjectForUser(USER_ONE, { title: "PostgreSQL 画板", document: source });
        await expect(getDesignProjectForUser(USER_TWO, project.id)).rejects.toMatchObject({ status: 404 });

        const left = structuredClone(project.document);
        left.revision = 1;
        left.metadata.title = "PG 左侧";
        const right = structuredClone(project.document);
        right.revision = 1;
        right.metadata.title = "PG 右侧";
        const concurrent = await Promise.allSettled([updateDesignProjectForUser(USER_ONE, project.id, { expectedRevision: 0, document: left }), updateDesignProjectForUser(USER_ONE, project.id, { expectedRevision: 0, document: right })]);
        expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(concurrent.find((result) => result.status === "rejected")).toMatchObject({ status: "rejected", reason: { status: 409 } });

        const revisionOne = await getDesignProjectForUser(USER_ONE, project.id);
        const version = await createDesignProjectVersionForUser(USER_ONE, project.id, { expectedRevision: 1, reason: "PG 确认稿" });
        const revisionTwoDocument = structuredClone(revisionOne.document);
        revisionTwoDocument.revision = 2;
        revisionTwoDocument.metadata.title = "PG 临时改稿";
        await updateDesignProjectForUser(USER_ONE, project.id, { expectedRevision: 1, document: revisionTwoDocument });

        const restored = await restoreDesignProjectVersionForUser(USER_ONE, project.id, version.id, { expectedRevision: 2 });
        expect(restored).toMatchObject({ revision: 3, title: revisionOne.title });
        await expect(listDesignProjectVersionsForUser(USER_ONE, project.id)).resolves.toMatchObject([
            { version: 2, snapshotRevision: 2, reason: "恢复前自动快照" },
            { version: 1, snapshotRevision: 1, reason: "PG 确认稿" },
        ]);

        const batch = {
            batchId: "batch-pg-integration",
            expectedRevision: 3,
            mode: "atomic",
            source: "agent",
            label: "PG 更新 Frame",
            operations: [{ opId: "op-pg-integration", type: "update-frame", frameId: "frame-main", patch: { name: "PG 集成 Frame" } }],
        };
        const applied = await applyDesignOperationsForUser(USER_ONE, project.id, batch);
        expect(applied.receipt).toMatchObject({ status: "applied", resultRevision: 4 });
        await expect(applyDesignOperationsForUser(USER_ONE, project.id, batch)).resolves.toMatchObject({ receipt: { status: "replayed", originalStatus: "applied" }, project: { revision: 4 } });
        await expect(applyDesignOperationsForUser(USER_ONE, project.id, { ...batch, label: "PG 冲突内容" })).resolves.toMatchObject({ receipt: { status: "conflict" }, project: { revision: 4 } });

        const receiptCount = await postgresQuery<{ count: string }>("SELECT count(*)::text AS count FROM design_operation_receipts WHERE user_id = $1 AND project_id = $2", [USER_ONE, project.id]);
        expect(receiptCount.rows[0]?.count).toBe("1");
        const marker = await postgresQuery<{ present: boolean }>("SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '20260811_design_projects_v1') AS present");
        expect(marker.rows[0]?.present).toBe(true);

        await deleteDesignProjectForUser(USER_ONE, project.id, { expectedRevision: 4 });
        const cascaded = await postgresQuery<{ versions: string; receipts: string }>(
            `SELECT
                (SELECT count(*)::text FROM design_project_versions WHERE project_id = $1) AS versions,
                (SELECT count(*)::text FROM design_operation_receipts WHERE project_id = $1) AS receipts`,
            [project.id],
        );
        expect(cascaded.rows[0]).toEqual({ versions: "0", receipts: "0" });
    }, 60_000);
});
