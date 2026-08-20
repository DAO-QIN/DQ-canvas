import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDesignDocumentFixture } from "@/lib/design/design.test-fixture";
import { applyDesignOperationBatch, type DesignProject } from "@/lib/design";

const mocks = vi.hoisted(() => ({ postgresQuery: vi.fn(), transaction: vi.fn(), clientQuery: vi.fn() }));

vi.mock("@/lib/server/database", () => ({
    ensurePostgresSchema: vi.fn(),
    getDatabaseProvider: vi.fn(() => "postgres"),
    postgresQuery: mocks.postgresQuery,
    withPostgresTransaction: mocks.transaction,
}));

import { applyDesignProjectOperationBatch, readDesignProjectArchive, restoreDesignProjectVersion, updateDesignProject } from "./design-project-store";

const NOW = "2026-08-11T10:00:00.000Z";

describe("design project PostgreSQL transaction contract", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.transaction.mockImplementation(async (handler: (client: { query: typeof mocks.clientQuery }) => Promise<unknown>) => handler({ query: mocks.clientQuery }));
    });

    it("uses owner plus expected revision and reports a zero-row conflict", async () => {
        const project = makeProject(2);
        mocks.postgresQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ revision: 3 }] });

        await expect(updateDesignProject("user-one", project, 2)).rejects.toMatchObject({ status: 409 });
        expect(mocks.postgresQuery.mock.calls[0]?.[0]).toMatch(/WHERE id = \$1 AND user_id = \$2 AND revision = \$8/);
        expect(mocks.postgresQuery.mock.calls[0]?.[1]?.at(-1)).toBe(2);
    });

    it("locks, snapshots and restores in one transaction without revision rollback", async () => {
        const current = makeProject(5, "当前版本");
        const snapshot = makeProject(2, "历史版本").document;
        const statements: string[] = [];
        mocks.clientQuery.mockImplementation(async (statement: string, params?: unknown[]) => {
            statements.push(statement);
            if (statement.includes("FOR UPDATE")) return { rows: [row(current)] };
            if (statement.includes("FROM design_project_versions WHERE id")) return { rows: [{ id: "version-one", project_id: current.id, version: 1, snapshot_revision: 2, reason: "初稿", snapshot_json: snapshot, created_at: NOW }] };
            if (statement.includes("COALESCE(MAX(version)")) return { rows: [{ version: 2 }] };
            if (statement.includes("INSERT INTO design_project_versions")) return { rows: [] };
            if (statement.includes("UPDATE design_projects")) {
                const document = JSON.parse(String(params?.[5]));
                return { rows: [row({ ...current, title: document.metadata.title, revision: document.revision, document, updatedAt: document.metadata.updatedAt })] };
            }
            throw new Error(`unexpected SQL: ${statement}`);
        });

        const restored = await restoreDesignProjectVersion("user-one", current.id, "version-one", 5, NOW, (project, target, now) => {
            const document = { ...target, id: project.id, revision: project.revision + 1, metadata: { ...target.metadata, createdAt: project.createdAt, updatedAt: now } };
            return { ...project, title: document.metadata.title, revision: document.revision, document, updatedAt: now };
        });

        expect(restored).toMatchObject({ revision: 6, title: "历史版本" });
        expect(statements[0]).toContain("FOR UPDATE");
        expect(statements.findIndex((statement) => statement.includes("INSERT INTO design_project_versions"))).toBeLessThan(statements.findIndex((statement) => statement.includes("UPDATE design_projects")));
        expect(statements.at(-1)).toMatch(/revision = \$8/);
    });

    it("writes the document and receipt in the same locked transaction", async () => {
        const current = makeProject(7);
        const statements: string[] = [];
        mocks.clientQuery.mockImplementation(async (statement: string, params?: unknown[]) => {
            statements.push(statement);
            if (statement.includes("FOR UPDATE")) return { rows: [row(current)] };
            if (statement.includes("FROM design_operation_receipts")) return { rows: [] };
            if (statement.includes("UPDATE design_projects")) {
                const document = JSON.parse(String(params?.[5]));
                return { rows: [row({ ...current, revision: document.revision, document, updatedAt: document.metadata.updatedAt })] };
            }
            if (statement.includes("INSERT INTO design_operation_receipts")) return { rows: [] };
            throw new Error(`unexpected SQL: ${statement}`);
        });

        const result = await applyDesignProjectOperationBatch(
            "user-one",
            current.id,
            {
                batchId: "batch-pg-one",
                expectedRevision: 7,
                mode: "atomic",
                source: "agent",
                label: "更新 Frame",
                operations: [{ opId: "op-pg-one", type: "update-frame", frameId: "frame-main", patch: { name: "PG Frame" } }],
            },
            NOW,
        );

        expect(result.receipt).toMatchObject({ status: "applied", resultRevision: 8 });
        expect(statements[0]).toContain("FOR UPDATE");
        expect(statements.findIndex((statement) => statement.includes("UPDATE design_projects"))).toBeLessThan(statements.findIndex((statement) => statement.includes("INSERT INTO design_operation_receipts")));
    });

    it("reads projects, version snapshots and receipts in one repeatable-read archive", async () => {
        const current = makeProject(7);
        const outcome = applyDesignOperationBatch(
            current.document,
            {
                batchId: "batch-archive",
                expectedRevision: 7,
                mode: "atomic",
                source: "system",
                label: "归档回执",
                operations: [{ opId: "op-archive", type: "update-frame", frameId: "frame-main", patch: { name: "归档 Frame" } }],
            },
            { now: () => NOW },
        );
        mocks.clientQuery.mockImplementation(async (statement: string) => {
            if (statement.includes("SET TRANSACTION ISOLATION")) return { rows: [] };
            if (statement.includes("FROM design_projects WHERE user_id")) return { rows: [row(current)] };
            if (statement.includes("FROM design_project_versions WHERE user_id")) {
                return { rows: [{ id: "version-one", project_id: current.id, version: 1, snapshot_revision: 7, reason: "确认稿", snapshot_json: current.document, created_at: NOW }] };
            }
            if (statement.includes("FROM design_operation_receipts WHERE user_id")) {
                return { rows: [{ project_id: current.id, batch_id: "batch-archive", fingerprint: outcome.receipt.fingerprint, receipt_json: outcome.receipt, created_at: NOW }] };
            }
            throw new Error(`unexpected SQL: ${statement}`);
        });

        const archive = await readDesignProjectArchive("user-one");

        expect(archive).toMatchObject({
            version: 1,
            projects: [{ id: current.id, revision: 7 }],
            versions: [{ id: "version-one", snapshotRevision: 7, snapshot: { id: current.id, revision: 7 } }],
            receipts: [{ projectId: current.id, replay: { batchId: "batch-archive" } }],
        });
        expect(mocks.clientQuery.mock.calls[0]?.[0]).toContain("REPEATABLE READ READ ONLY");
    });
});

function makeProject(revision: number, title = "画板"): DesignProject {
    const document = createDesignDocumentFixture();
    document.revision = revision;
    document.metadata.title = title;
    document.metadata.createdAt = NOW;
    document.metadata.updatedAt = NOW;
    return { id: document.id, title, status: "active", revision, document, createdAt: NOW, updatedAt: NOW };
}

function row(project: DesignProject) {
    return { id: project.id, title: project.title, status: project.status, revision: project.revision, document_json: project.document, created_at: project.createdAt, updated_at: project.updatedAt };
}
