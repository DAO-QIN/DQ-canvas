import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    connect: vi.fn(),
    pool: vi.fn(),
}));

vi.mock("pg", () => ({
    Pool: mocks.pool,
}));

import { ensurePostgresSchema, initializePostgresSchema, withPostgresTransaction } from "./postgres";

describe("PostgreSQL schema lifecycle", () => {
    beforeEach(() => {
        delete (globalThis as Record<string, unknown>).__dqPostgresPool;
        delete (globalThis as Record<string, unknown>).__dqPostgresSchemaReady;
        process.env.DATABASE_URL = "postgres://dq:test@localhost:5432/dq";
        mocks.query.mockReset();
        mocks.connect.mockReset();
        mocks.pool.mockReset().mockImplementation(function PoolMock() {
            return { query: mocks.query, connect: mocks.connect };
        });
        mocks.connect.mockResolvedValue({ query: mocks.query, release: vi.fn() });
    });

    it("serializes concurrent repository queries on one transaction client", async () => {
        let active = false;
        const statements: string[] = [];
        const release = vi.fn();
        const clientQuery = vi.fn(async (statement: string) => {
            statements.push(statement);
            if (statement === "BEGIN" || statement === "COMMIT" || statement === "ROLLBACK") return { rows: [], rowCount: 0 };
            if (active) throw new Error("transaction client received concurrent queries");
            active = true;
            await new Promise((resolve) => setTimeout(resolve, 0));
            active = false;
            return { rows: [], rowCount: 0 };
        });
        mocks.connect.mockResolvedValue({ query: clientQuery, release });

        await withPostgresTransaction(async (client) => {
            await Promise.all([client.query("SELECT 1"), client.query("SELECT 2"), client.query("SELECT 3")]);
        });

        expect(statements).toEqual(["BEGIN", "SELECT 1", "SELECT 2", "SELECT 3", "COMMIT"]);
        expect(release).toHaveBeenCalledOnce();
    });

    it("does not execute schema DDL when an ordinary caller reaches an empty database", async () => {
        mocks.query.mockResolvedValueOnce({ rows: [{ table_name: null }] });

        await expect(ensurePostgresSchema()).rejects.toThrow("PostgreSQL schema has not been initialized");

        expect(mocks.query).toHaveBeenCalledTimes(1);
        expect(mocks.query.mock.calls[0]?.[0]).toContain("to_regclass");
        expect(mocks.query.mock.calls[0]?.[0]).not.toContain("CREATE TABLE");
    });

    it("executes schema DDL only through explicit initialization", async () => {
        mocks.query.mockResolvedValue({ rows: [] });

        await initializePostgresSchema();

        expect(mocks.query).toHaveBeenCalledTimes(4);
        const statements = mocks.query.mock.calls.map(([statement]) => String(statement));
        expect(statements[0]).toBe("BEGIN");
        expect(statements[1]).toContain("pg_advisory_xact_lock");
        expect(statements[3]).toBe("COMMIT");
        const ddl = statements[2];
        expect(ddl).toContain("CREATE TABLE IF NOT EXISTS dq_schema_migrations");
        expect(ddl).toContain("CREATE TABLE IF NOT EXISTS dq_generation_worker_heartbeats");
        expect(ddl).toContain("CREATE TABLE IF NOT EXISTS dq_design_projects");
        expect(ddl).toContain("CREATE TABLE IF NOT EXISTS dq_design_project_versions");
        expect(ddl).toContain("CREATE TABLE IF NOT EXISTS dq_design_operation_receipts");
        expect(ddl).toContain("CREATE TABLE IF NOT EXISTS dq_canvas_project_save_receipts");
        expect(ddl).toContain("CREATE TABLE IF NOT EXISTS dq_workspace_handoffs");
        expect(ddl).toContain("ALTER TABLE dq_workspace_handoffs ADD COLUMN IF NOT EXISTS target_batch_id text");
        expect(ddl).toContain("ALTER TABLE dq_workspace_handoffs ADD COLUMN IF NOT EXISTS target_fingerprint text");
        expect(ddl).toContain("CREATE UNIQUE INDEX IF NOT EXISTS dq_canvas_projects_user_id_id_idx");
        expect(ddl).toContain("REFERENCES dq_design_projects(user_id, id) ON DELETE CASCADE");
        expect(ddl).toContain("CREATE INDEX IF NOT EXISTS dq_design_projects_user_status_updated_idx");
        expect(ddl).toContain("CHECK (fingerprint ~ '^sha256:[0-9a-f]{64}$')");
        expect(ddl).toContain("CREATE TABLE IF NOT EXISTS dq_billing_refund_jobs");
        expect(ddl).toContain("CREATE UNIQUE INDEX IF NOT EXISTS dq_payment_transactions_provider_payment_idx");
        expect(ddl).toContain("CREATE UNIQUE INDEX IF NOT EXISTS dq_billing_refund_jobs_provider_refund_idx");
        expect(ddl).toContain("CREATE SEQUENCE IF NOT EXISTS dq_user_account_id_seq");
        expect(ddl).toContain("account_id bigint NOT NULL DEFAULT nextval('dq_user_account_id_seq')");
        expect(ddl).toContain("CREATE UNIQUE INDEX IF NOT EXISTS dq_users_account_id_idx ON dq_users (account_id)");
        expect(ddl).toContain("user_id text NOT NULL REFERENCES dq_users(id) ON DELETE CASCADE");
        expect(ddl).toContain("CREATE TABLE IF NOT EXISTS dq_account_deletion_requests");
        expect(ddl).toContain("'review_pending', 'reviewing', 'review_unavailable'");
        expect(ddl).toContain("'awaiting_confirmation'");
        expect(ddl).toContain("task_type = 'agent' AND status = 'success' AND execution_phase IN ('review_pending', 'reviewing')");
        expect(ddl).toContain("creative_conversations_surface CHECK (surface IN ('chat', 'canvas', 'design', 'drama'))");
        expect(ddl).toContain("creative_conversations_source CHECK (source IN ('agent', 'image-workbench', 'video-workbench', 'canvas', 'design', 'drama'))");
        expect(ddl).toContain("ALTER TABLE dq_creative_conversations DROP CONSTRAINT IF EXISTS creative_conversations_surface");
        expect(ddl).toContain("UPDATE dq_creative_conversations SET source = surface WHERE surface IN ('canvas', 'design', 'drama') AND source = 'agent'");
        expect(ddl).toContain("'legacy-canvas-node:' || (payload->>'sourceNodeId')");
        expect(ddl).not.toMatch(/\|\|\s*payload->>/);

        const tableNames = [...ddl.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-z][a-z0-9_]*)/gi)].map((match) => match[1]).sort();
        expect(tableNames).toHaveLength(64);
        expect(tableNames.every((name) => name.startsWith("dq_"))).toBe(true);
        expect(tableNames).not.toContain("dq_check_ins");
        expect(ddl).toContain("DROP TABLE IF EXISTS dq_check_ins");
        expect(ddl).not.toContain("20260731_generation_task_recovery");

        const indexNames = [...ddl.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-z][a-z0-9_]*)/gi)].map((match) => match[1]);
        expect(indexNames.length).toBeGreaterThan(0);
        expect(indexNames.every((name) => name.startsWith("dq_"))).toBe(true);

        const uniqueConstraintNames = [...ddl.matchAll(/CONSTRAINT\s+([a-z][a-z0-9_]*)\s+UNIQUE\b/gi)].map((match) => match[1]);
        expect(uniqueConstraintNames.length).toBeGreaterThan(0);
        expect(uniqueConstraintNames.every((name) => name.startsWith("dq_"))).toBe(true);
    });

    it("continues applying additive schema updates after the sentinel table exists", async () => {
        mocks.query.mockResolvedValueOnce({ rows: [{ table_name: "dq_users" }] }).mockResolvedValue({ rows: [] });

        await ensurePostgresSchema();

        expect(mocks.query).toHaveBeenCalledTimes(5);
        expect(mocks.query.mock.calls[0]?.[0]).toContain("to_regclass");
        expect(mocks.query.mock.calls[2]?.[0]).toContain("pg_advisory_xact_lock");
        expect(mocks.query.mock.calls[3]?.[0]).toContain("CREATE TABLE IF NOT EXISTS dq_schema_migrations");
    });
});
