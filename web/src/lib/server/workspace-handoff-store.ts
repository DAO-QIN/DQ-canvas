import type { WorkspaceHandoffReceipt, WorkspaceHandoffRequest } from "@/lib/creative-workspace";
import { readJsonDataFile, writeJsonDataFile } from "@/lib/server/data-adapter";
import { ensurePostgresSchema, getDatabaseProvider, postgresQuery } from "@/lib/server/database";

export type WorkspaceHandoffRecord = Readonly<{
    userId: string;
    handoffId: string;
    fingerprint: string;
    status: "pending" | "completed";
    request: WorkspaceHandoffRequest;
    targetBatchId?: string;
    targetFingerprint?: string;
    receipt?: WorkspaceHandoffReceipt;
    createdAt: string;
    updatedAt: string;
}>;

type WorkspaceHandoffDatabase = { version: 1; records: WorkspaceHandoffRecord[] };
type WorkspaceHandoffRow = {
    user_id: string;
    handoff_id: string;
    fingerprint: string;
    status: "pending" | "completed";
    request_json: WorkspaceHandoffRequest | string;
    target_batch_id: string | null;
    target_fingerprint: string | null;
    receipt_json: WorkspaceHandoffReceipt | string | null;
    created_at: Date | string;
    updated_at: Date | string;
};

const FILE_NAME = "workspace-handoffs.json";
const CLAIM_LEASE_MS = 30_000;
let mutationQueue = Promise.resolve();

export async function getWorkspaceHandoffRecord(userId: string, handoffId: string): Promise<WorkspaceHandoffRecord | null> {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<WorkspaceHandoffRow>("SELECT * FROM workspace_handoffs WHERE user_id = $1 AND handoff_id = $2", [userId, handoffId]);
        return result.rows[0] ? recordFromRow(result.rows[0]) : null;
    }
    const record = (await readDatabase()).records.find((item) => item.userId === userId && item.handoffId === handoffId);
    return record ? structuredClone(record) : null;
}

export async function claimWorkspaceHandoff(userId: string, request: WorkspaceHandoffRequest, fingerprint: string, now: string): Promise<{ record: WorkspaceHandoffRecord; claimed: boolean }> {
    const staleBefore = new Date(Date.parse(now) - CLAIM_LEASE_MS).toISOString();
    const proposed: WorkspaceHandoffRecord = {
        userId,
        handoffId: request.handoffId,
        fingerprint,
        status: "pending",
        request: structuredClone(request),
        createdAt: now,
        updatedAt: now,
    };
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const inserted = await postgresQuery<WorkspaceHandoffRow>(
            `INSERT INTO workspace_handoffs (user_id, handoff_id, fingerprint, status, request_json, receipt_json, created_at, updated_at)
             VALUES ($1, $2, $3, 'pending', $4::jsonb, NULL, $5, $5)
             ON CONFLICT (user_id, handoff_id) DO NOTHING
             RETURNING *`,
            [userId, request.handoffId, fingerprint, JSON.stringify(request), new Date(now)],
        );
        if (inserted.rows[0]) return { record: recordFromRow(inserted.rows[0]), claimed: true };
        const reclaimed = await postgresQuery<WorkspaceHandoffRow>(
            `UPDATE workspace_handoffs
             SET updated_at = $4
             WHERE user_id = $1 AND handoff_id = $2 AND fingerprint = $3 AND status = 'pending' AND updated_at <= $5
             RETURNING *`,
            [userId, request.handoffId, fingerprint, new Date(now), new Date(staleBefore)],
        );
        if (reclaimed.rows[0]) return { record: recordFromRow(reclaimed.rows[0]), claimed: true };
        const existing = await getWorkspaceHandoffRecord(userId, request.handoffId);
        if (!existing) throw new Error("Workspace handoff claim disappeared");
        return { record: existing, claimed: false };
    }
    return mutateDatabase<{ record: WorkspaceHandoffRecord; claimed: boolean }>((database) => {
        const existing = database.records.find((item) => item.userId === userId && item.handoffId === request.handoffId);
        if (existing) {
            if (existing.fingerprint === fingerprint && existing.status === "pending" && existing.updatedAt <= staleBefore) {
                const reclaimed: WorkspaceHandoffRecord = { ...existing, updatedAt: now };
                const index = database.records.indexOf(existing);
                return { database: { ...database, records: database.records.toSpliced(index, 1, reclaimed) }, result: { record: structuredClone(reclaimed), claimed: true } };
            }
            return { database, result: { record: structuredClone(existing), claimed: false } };
        }
        return { database: { ...database, records: [proposed, ...database.records] }, result: { record: structuredClone(proposed), claimed: true } };
    });
}

export async function completeWorkspaceHandoff(userId: string, handoffId: string, fingerprint: string, receipt: WorkspaceHandoffReceipt, now: string): Promise<WorkspaceHandoffRecord> {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<WorkspaceHandoffRow>(
            `UPDATE workspace_handoffs
             SET status = 'completed', receipt_json = $4::jsonb, updated_at = $5
             WHERE user_id = $1 AND handoff_id = $2 AND fingerprint = $3 AND status = 'pending'
             RETURNING *`,
            [userId, handoffId, fingerprint, JSON.stringify(receipt), new Date(now)],
        );
        if (!result.rows[0]) {
            const existing = await getWorkspaceHandoffRecord(userId, handoffId);
            if (existing?.fingerprint === fingerprint && existing.status === "completed") return existing;
            throw new Error("Workspace handoff claim does not match completion");
        }
        return recordFromRow(result.rows[0]);
    }
    return mutateDatabase((database) => {
        const index = database.records.findIndex((item) => item.userId === userId && item.handoffId === handoffId && item.fingerprint === fingerprint);
        if (index < 0) throw new Error("Workspace handoff claim does not match completion");
        if (database.records[index].status === "completed") return { database, result: structuredClone(database.records[index]) };
        const record: WorkspaceHandoffRecord = { ...database.records[index], status: "completed", receipt: structuredClone(receipt), updatedAt: now };
        return { database: { ...database, records: database.records.toSpliced(index, 1, record) }, result: structuredClone(record) };
    });
}

export async function prepareWorkspaceHandoffTarget(userId: string, handoffId: string, fingerprint: string, targetBatchId: string, targetFingerprint: string, now: string): Promise<WorkspaceHandoffRecord> {
    if (!targetBatchId || !/^sha256:[0-9a-f]{64}$/.test(targetFingerprint)) throw new Error("Workspace handoff target identity is invalid");
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<WorkspaceHandoffRow>(
            `UPDATE workspace_handoffs
             SET target_batch_id = $4, target_fingerprint = $5, updated_at = $6
             WHERE user_id = $1 AND handoff_id = $2 AND fingerprint = $3 AND status = 'pending'
               AND (target_batch_id IS NULL OR (target_batch_id = $4 AND target_fingerprint = $5))
             RETURNING *`,
            [userId, handoffId, fingerprint, targetBatchId, targetFingerprint, new Date(now)],
        );
        if (result.rows[0]) return recordFromRow(result.rows[0]);
        const existing = await getWorkspaceHandoffRecord(userId, handoffId);
        if (existing?.fingerprint === fingerprint && existing.status === "pending") throw new Error("Workspace handoff target identity changed");
        throw new Error("Workspace handoff claim does not match target preparation");
    }
    return mutateDatabase((database) => {
        const index = database.records.findIndex((item) => item.userId === userId && item.handoffId === handoffId && item.fingerprint === fingerprint);
        if (index < 0 || database.records[index].status !== "pending") throw new Error("Workspace handoff claim does not match target preparation");
        const existing = database.records[index];
        if (existing.targetBatchId && (existing.targetBatchId !== targetBatchId || existing.targetFingerprint !== targetFingerprint)) {
            throw new Error("Workspace handoff target identity changed");
        }
        const record: WorkspaceHandoffRecord = { ...existing, targetBatchId, targetFingerprint, updatedAt: now };
        return { database: { ...database, records: database.records.toSpliced(index, 1, record) }, result: structuredClone(record) };
    });
}

export async function releaseWorkspaceHandoffClaim(userId: string, handoffId: string, fingerprint: string) {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery("DELETE FROM workspace_handoffs WHERE user_id = $1 AND handoff_id = $2 AND fingerprint = $3 AND status = 'pending' RETURNING handoff_id", [userId, handoffId, fingerprint]);
        return Boolean(result.rows[0]);
    }
    return mutateDatabase((database) => {
        const records = database.records.filter((item) => !(item.userId === userId && item.handoffId === handoffId && item.fingerprint === fingerprint && item.status === "pending"));
        return { database: records.length === database.records.length ? database : { ...database, records }, result: records.length !== database.records.length };
    });
}

function readDatabase() {
    return readJsonDataFile<WorkspaceHandoffDatabase>(FILE_NAME, { version: 1, records: [] });
}

function mutateDatabase<T>(mutator: (database: WorkspaceHandoffDatabase) => { database: WorkspaceHandoffDatabase; result: T }): Promise<T> {
    const operation = mutationQueue.then(async () => {
        const mutation = mutator(await readDatabase());
        await writeJsonDataFile(FILE_NAME, mutation.database);
        return mutation.result;
    });
    mutationQueue = operation.then(
        () => undefined,
        () => undefined,
    );
    return operation;
}

function recordFromRow(row: WorkspaceHandoffRow): WorkspaceHandoffRecord {
    const request = json<WorkspaceHandoffRequest>(row.request_json);
    const receipt = row.receipt_json == null ? undefined : json<WorkspaceHandoffReceipt>(row.receipt_json);
    return {
        userId: row.user_id,
        handoffId: row.handoff_id,
        fingerprint: row.fingerprint,
        status: row.status,
        request,
        ...(row.target_batch_id ? { targetBatchId: row.target_batch_id } : {}),
        ...(row.target_fingerprint ? { targetFingerprint: row.target_fingerprint } : {}),
        ...(receipt ? { receipt } : {}),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
    };
}

function json<T>(value: T | string) {
    return structuredClone(typeof value === "string" ? (JSON.parse(value) as T) : value);
}

function iso(value: Date | string) {
    return (value instanceof Date ? value : new Date(value)).toISOString();
}
