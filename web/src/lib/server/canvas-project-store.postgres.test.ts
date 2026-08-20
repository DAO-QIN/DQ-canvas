import { beforeEach, describe, expect, it, vi } from "vitest";

import { canvasSaveFingerprint } from "@/lib/canvas-project-receipt";
import type { CanvasProject } from "@/lib/canvas-project-contract";

const mocks = vi.hoisted(() => ({ postgresQuery: vi.fn(), transaction: vi.fn(), clientQuery: vi.fn() }));

vi.mock("@/lib/server/database", () => ({
    ensurePostgresSchema: vi.fn(),
    getDatabaseProvider: vi.fn(() => "postgres"),
    postgresQuery: mocks.postgresQuery,
    withPostgresTransaction: mocks.transaction,
}));

import { saveCanvasProject } from "./canvas-project-store";

describe("canvas project PostgreSQL receipt contract", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.transaction.mockImplementation(async (handler: (client: { query: typeof mocks.clientQuery }) => Promise<unknown>) => handler({ query: mocks.clientQuery }));
    });

    it("locks, writes the project, and inserts one receipt in the same transaction", async () => {
        const current = project(0, "Current");
        const request = { project: { ...current, title: "Saved" }, expectedRevision: 0, batchId: "batch-pg-one", fingerprint: canvasSaveFingerprint({ ...current, title: "Saved" }, 0) };
        const statements: string[] = [];
        mocks.clientQuery.mockImplementation(async (statement: string, params?: unknown[]) => {
            statements.push(statement);
            if (statement.includes("FOR UPDATE")) return { rows: [{ project_json: current }] };
            if (statement.includes("canvas_project_save_receipts")) return { rows: [] };
            if (statement.includes("UPDATE canvas_projects")) return { rows: [{ id: current.id }] };
            if (statement.includes("INSERT INTO canvas_project_save_receipts")) return { rows: [] };
            throw new Error(`unexpected SQL: ${statement} ${JSON.stringify(params)}`);
        });

        const result = await saveCanvasProject("user-one", request);

        expect(result).toMatchObject({ project: { revision: 1, title: "Saved" }, receipt: { status: "applied", resultRevision: 1 } });
        expect(statements[0]).toContain("FOR UPDATE");
        expect(statements.findIndex((statement) => statement.includes("UPDATE canvas_projects"))).toBeLessThan(statements.findIndex((statement) => statement.includes("INSERT INTO canvas_project_save_receipts")));
    });

    it("returns a persisted replay without updating the project", async () => {
        const current = project(1, "Saved");
        const request = { project: { ...current, title: "Saved" }, expectedRevision: 0, batchId: "batch-pg-replay", fingerprint: canvasSaveFingerprint({ ...current, title: "Saved" }, 0) };
        mocks.clientQuery.mockImplementation(async (statement: string) => {
            if (statement.includes("FOR UPDATE")) return { rows: [{ project_json: current }] };
            if (statement.includes("canvas_project_save_receipts"))
                return {
                    rows: [
                        {
                            batch_id: request.batchId,
                            fingerprint: request.fingerprint,
                            base_revision: 0,
                            result_revision: 1,
                            receipt_json: { projectId: current.id, batchId: request.batchId, fingerprint: request.fingerprint, status: "applied", baseRevision: 0, resultRevision: 1 },
                        },
                    ],
                };
            throw new Error(`unexpected SQL: ${statement}`);
        });

        const result = await saveCanvasProject("user-one", request);

        expect(result).toMatchObject({ project: current, receipt: { status: "replayed", originalStatus: "applied" } });
        expect(mocks.clientQuery).toHaveBeenCalledTimes(2);
    });
});

function project(revision: number, title: string): CanvasProject {
    const now = "2026-08-13T00:00:00.000Z";
    return { id: "canvas-pg", title, revision, createdAt: now, updatedAt: now, nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } };
}
