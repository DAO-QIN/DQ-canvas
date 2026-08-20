import { nanoid } from "nanoid";

import {
    applyDesignOperationBatch,
    migrateDesignDocument,
    type DesignDocument,
    type DesignOperationBatch,
    type DesignOperationReceipt,
    type DesignOperationReplay,
    type DesignProject,
    type DesignProjectStatus,
    type DesignProjectSummary,
    type DesignProjectSummaryPage,
    type DesignProjectVersion,
} from "@/lib/design";
import { readJsonDataFile, writeJsonDataFile } from "@/lib/server/data-adapter";
import { ensurePostgresSchema, getDatabaseProvider, postgresQuery, type QueryExecutor, withPostgresTransaction } from "@/lib/server/database";

type DesignProjectFileRecord = { userId: string; project: DesignProject };
type DesignProjectVersionFileRecord = DesignProjectVersion & { userId: string; snapshot: DesignDocument };
type DesignOperationReceiptFileRecord = { userId: string; projectId: string; createdAt: string; replay: DesignOperationReplay };
type DesignProjectFileDatabase = {
    version: 1;
    projects: DesignProjectFileRecord[];
    versions: DesignProjectVersionFileRecord[];
    receipts: DesignOperationReceiptFileRecord[];
};

type DesignProjectRow = {
    id: string;
    title: string;
    status: DesignProjectStatus;
    revision: string | number;
    document_json: DesignDocument | string;
    created_at: Date | string;
    updated_at: Date | string;
};

type DesignProjectVersionRow = {
    id: string;
    project_id: string;
    version: string | number;
    snapshot_revision: string | number;
    reason: string;
    snapshot_json?: DesignDocument | string;
    created_at: Date | string;
};

type DesignOperationReceiptRow = {
    batch_id: string;
    fingerprint: string;
    receipt_json: DesignOperationReceipt | string;
};

type DesignArchiveReceiptRow = DesignOperationReceiptRow & {
    project_id: string;
    created_at: Date | string;
};

export type DesignProjectArchiveVersion = DesignProjectVersion & { snapshot: DesignDocument };
export type DesignProjectArchiveReceipt = { projectId: string; createdAt: string; replay: DesignOperationReplay };
export type DesignProjectArchive = {
    version: 1;
    projects: DesignProject[];
    versions: DesignProjectArchiveVersion[];
    receipts: DesignProjectArchiveReceipt[];
};

const FILE_NAME = "design-projects.json";
const EMPTY_DATABASE: DesignProjectFileDatabase = { version: 1, projects: [], versions: [], receipts: [] };
let mutationQueue = Promise.resolve();

export class DesignProjectStoreError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: "NOT_FOUND" | "CONFLICT" | "ALREADY_EXISTS" = status === 404 ? "NOT_FOUND" : "CONFLICT",
    ) {
        super(message);
        this.name = "DesignProjectStoreError";
    }
}

export async function listDesignProjectSummaries(userId: string, input: { page?: number; pageSize?: number; status?: DesignProjectStatus } = {}): Promise<DesignProjectSummaryPage> {
    const page = positiveInteger(input.page, 1);
    const pageSize = Math.min(100, positiveInteger(input.pageSize, 20));
    const status = input.status;
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<Omit<DesignProjectRow, "document_json"> & { frame_count: string | number; element_count: string | number; asset_count: string | number; total_count: string | number }>(
            `SELECT id, title, status, revision,
                    CASE WHEN jsonb_typeof(document_json->'frames') = 'array' THEN jsonb_array_length(document_json->'frames') END AS frame_count,
                    CASE WHEN jsonb_typeof(document_json->'elements') = 'array' THEN jsonb_array_length(document_json->'elements') END AS element_count,
                    CASE WHEN jsonb_typeof(document_json->'assets') = 'array' THEN jsonb_array_length(document_json->'assets') END AS asset_count,
                    COUNT(*) OVER() AS total_count,
                    created_at, updated_at
             FROM design_projects
             WHERE user_id = $1 AND ($2::text IS NULL OR status = $2)
             ORDER BY updated_at DESC, id DESC
             LIMIT $3 OFFSET $4`,
            [userId, status ?? null, pageSize, (page - 1) * pageSize],
        );
        return {
            items: result.rows.map((row) => ({
                id: row.id,
                title: row.title,
                status: row.status,
                revision: requiredInteger(row.revision, "design_projects.revision"),
                frameCount: requiredInteger(row.frame_count, "design_projects.document_json.frames"),
                elementCount: requiredInteger(row.element_count, "design_projects.document_json.elements"),
                assetCount: requiredInteger(row.asset_count, "design_projects.document_json.assets"),
                createdAt: timestamp(row.created_at),
                updatedAt: timestamp(row.updated_at),
            })),
            total: integer(result.rows[0]?.total_count),
            page,
            pageSize,
        };
    }
    const summaries = (await readDatabase()).projects
        .filter((record) => record.userId === userId && (!status || record.project.status === status))
        .map(({ project }) => summarize(validateStoredProject(project)))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
    return { items: summaries.slice((page - 1) * pageSize, page * pageSize), total: summaries.length, page, pageSize };
}

export async function getDesignProject(userId: string, projectId: string): Promise<DesignProject | null> {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<DesignProjectRow>("SELECT id, title, status, revision, document_json, created_at, updated_at FROM design_projects WHERE id = $1 AND user_id = $2", [projectId, userId]);
        return result.rows[0] ? projectFromRow(result.rows[0]) : null;
    }
    const project = (await readDatabase()).projects.find((record) => record.userId === userId && record.project.id === projectId)?.project;
    return project ? structuredClone(validateStoredProject(project)) : null;
}

export async function getDesignProjectOperationReceipt(userId: string, projectId: string, batchId: string): Promise<DesignOperationReceipt | null> {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<DesignOperationReceiptRow>("SELECT batch_id, fingerprint, receipt_json FROM design_operation_receipts WHERE user_id = $1 AND project_id = $2 AND batch_id = $3", [userId, projectId, batchId]);
        return result.rows[0] ? replayFromRow(projectId, result.rows[0]).receipt : null;
    }
    const record = (await readDatabase()).receipts.find((item) => item.userId === userId && item.projectId === projectId && item.replay.batchId === batchId);
    return record ? structuredClone(validateReplay(record.replay, projectId).receipt) : null;
}

export async function readDesignProjectArchive(userId: string): Promise<DesignProjectArchive> {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        return withPostgresTransaction(async (client) => {
            await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
            const [projects, versions, receipts] = await Promise.all([
                client.query<DesignProjectRow>("SELECT id, title, status, revision, document_json, created_at, updated_at FROM design_projects WHERE user_id = $1 ORDER BY updated_at DESC, id DESC", [userId]),
                client.query<DesignProjectVersionRow>("SELECT id, project_id, version, snapshot_revision, reason, snapshot_json, created_at FROM design_project_versions WHERE user_id = $1 ORDER BY project_id, version DESC", [userId]),
                client.query<DesignArchiveReceiptRow>("SELECT project_id, batch_id, fingerprint, receipt_json, created_at FROM design_operation_receipts WHERE user_id = $1 ORDER BY created_at DESC, project_id, batch_id", [userId]),
            ]);
            return {
                version: 1,
                projects: projects.rows.map(projectFromRow),
                versions: versions.rows.map(archiveVersionFromRow),
                receipts: receipts.rows.map(archiveReceiptFromRow),
            };
        });
    }

    const database = await readDatabase();
    return {
        version: 1,
        projects: database.projects.filter((record) => record.userId === userId).map((record) => structuredClone(validateStoredProject(record.project))),
        versions: database.versions
            .filter((record) => record.userId === userId)
            .sort((left, right) => left.projectId.localeCompare(right.projectId) || right.version - left.version)
            .map((record) => ({ ...publicVersion(record), snapshot: validateArchiveSnapshot(record.projectId, record.snapshotRevision, record.snapshot) })),
        receipts: database.receipts
            .filter((record) => record.userId === userId)
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.projectId.localeCompare(right.projectId))
            .map((record) => ({ projectId: record.projectId, createdAt: record.createdAt, replay: validateReplay(record.replay, record.projectId) })),
    };
}

export async function createDesignProject(userId: string, project: DesignProject): Promise<DesignProject> {
    project = validateStoredProject(project);
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        try {
            await postgresQuery(
                `INSERT INTO design_projects (id, user_id, title, status, revision, document_json, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
                [project.id, userId, project.title, project.status, project.revision, JSON.stringify(project.document), new Date(project.createdAt), new Date(project.updatedAt)],
            );
        } catch (error) {
            if (postgresErrorCode(error) === "23505") throw new DesignProjectStoreError("画板项目已存在", 409, "ALREADY_EXISTS");
            throw error;
        }
        return structuredClone(project);
    }
    return mutateDatabase((database) => {
        if (database.projects.some((record) => record.project.id === project.id)) throw new DesignProjectStoreError("画板项目已存在", 409, "ALREADY_EXISTS");
        const saved = structuredClone(project);
        return { database: { ...database, projects: [{ userId, project: saved }, ...database.projects] }, result: structuredClone(saved) };
    });
}

export async function updateDesignProject(userId: string, project: DesignProject, expectedRevision: number): Promise<DesignProject> {
    project = validateStoredProject(project);
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<DesignProjectRow>(
            `UPDATE design_projects
             SET title = $3, status = $4, revision = $5, document_json = $6::jsonb, updated_at = $7
             WHERE id = $1 AND user_id = $2 AND revision = $8
             RETURNING id, title, status, revision, document_json, created_at, updated_at`,
            [project.id, userId, project.title, project.status, project.revision, JSON.stringify(project.document), new Date(project.updatedAt), expectedRevision],
        );
        if (result.rows[0]) return projectFromRow(result.rows[0]);
        await throwMissingOrConflict(userId, project.id);
    }
    return mutateDatabase((database) => {
        const index = database.projects.findIndex((record) => record.userId === userId && record.project.id === project.id);
        if (index < 0) throw notFound();
        if (database.projects[index].project.revision !== expectedRevision) throw revisionConflict(expectedRevision, database.projects[index].project.revision);
        const saved = structuredClone(project);
        const projects = database.projects.toSpliced(index, 1, { userId, project: saved });
        return { database: { ...database, projects }, result: structuredClone(saved) };
    });
    throw new Error("unreachable");
}

export async function deleteDesignProject(userId: string, projectId: string, expectedRevision: number): Promise<void> {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery("DELETE FROM design_projects WHERE id = $1 AND user_id = $2 AND revision = $3 RETURNING id", [projectId, userId, expectedRevision]);
        if (result.rows[0]) return;
        await throwMissingOrConflict(userId, projectId);
    }
    await mutateDatabase((database) => {
        const index = database.projects.findIndex((record) => record.userId === userId && record.project.id === projectId);
        if (index < 0) throw notFound();
        const current = validateStoredProject(database.projects[index].project);
        if (current.revision !== expectedRevision) throw revisionConflict(expectedRevision, current.revision);
        return {
            database: {
                ...database,
                projects: database.projects.filter((_record, recordIndex) => recordIndex !== index),
                versions: database.versions.filter((record) => record.userId !== userId || record.projectId !== projectId),
                receipts: database.receipts.filter((record) => record.userId !== userId || record.projectId !== projectId),
            },
            result: undefined,
        };
    });
}

export async function listDesignProjectVersions(userId: string, projectId: string): Promise<DesignProjectVersion[]> {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const project = await getDesignProject(userId, projectId);
        if (!project) throw notFound();
        const result = await postgresQuery<DesignProjectVersionRow>("SELECT id, project_id, version, snapshot_revision, reason, created_at FROM design_project_versions WHERE user_id = $1 AND project_id = $2 ORDER BY version DESC", [userId, projectId]);
        return result.rows.map(versionFromRow);
    }
    const database = await readDatabase();
    const project = database.projects.find((record) => record.userId === userId && record.project.id === projectId)?.project;
    if (!project) throw notFound();
    validateStoredProject(project);
    return database.versions
        .filter((record) => record.userId === userId && record.projectId === projectId)
        .sort((left, right) => right.version - left.version)
        .map(({ userId: _userId, snapshot: _snapshot, ...version }) => structuredClone(version));
}

export async function createCurrentDesignProjectVersion(userId: string, projectId: string, expectedRevision: number, reason: string, now: string): Promise<DesignProjectVersion> {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        return withPostgresTransaction(async (client) => {
            const project = await lockProject(client, userId, projectId);
            assertRevision(project.revision, expectedRevision);
            return insertPostgresVersion(client, userId, project, reason, now);
        });
    }
    return mutateDatabase((database) => {
        const record = database.projects.find((item) => item.userId === userId && item.project.id === projectId);
        if (!record) throw notFound();
        const project = validateStoredProject(record.project);
        assertRevision(project.revision, expectedRevision);
        const saved = createFileVersion(database, userId, project, reason, now);
        return { database: { ...database, versions: [saved, ...database.versions] }, result: publicVersion(saved) };
    });
}

export async function restoreDesignProjectVersion(
    userId: string,
    projectId: string,
    versionId: string,
    expectedRevision: number,
    now: string,
    restore: (current: DesignProject, snapshot: DesignDocument, now: string) => DesignProject,
): Promise<DesignProject> {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        return withPostgresTransaction(async (client) => {
            const current = await lockProject(client, userId, projectId);
            assertRevision(current.revision, expectedRevision);
            const target = await client.query<DesignProjectVersionRow>("SELECT id, project_id, version, snapshot_revision, reason, snapshot_json, created_at FROM design_project_versions WHERE id = $1 AND user_id = $2 AND project_id = $3", [
                versionId,
                userId,
                projectId,
            ]);
            const row = target.rows[0];
            if (!row?.snapshot_json) throw new DesignProjectStoreError("画板版本不存在", 404, "NOT_FOUND");
            await insertPostgresVersion(client, userId, current, "恢复前自动快照", now);
            const restored = restore(current, jsonObject<DesignDocument>(row.snapshot_json), now);
            const updated = await updateLockedPostgresProject(client, userId, restored, expectedRevision);
            return updated;
        });
    }
    return mutateDatabase((database) => {
        const record = database.projects.find((item) => item.userId === userId && item.project.id === projectId);
        if (!record) throw notFound();
        const current = validateStoredProject(record.project);
        assertRevision(current.revision, expectedRevision);
        const target = database.versions.find((item) => item.id === versionId && item.userId === userId && item.projectId === projectId);
        if (!target) throw new DesignProjectStoreError("画板版本不存在", 404, "NOT_FOUND");
        const beforeRestore = createFileVersion(database, userId, current, "恢复前自动快照", now);
        const restored = validateStoredProject(restore(structuredClone(current), structuredClone(target.snapshot), now));
        const projects = database.projects.map((item) => (item === record ? { userId, project: structuredClone(restored) } : item));
        return { database: { ...database, projects, versions: [beforeRestore, ...database.versions] }, result: structuredClone(restored) };
    });
}

export async function applyDesignProjectOperationBatch(userId: string, projectId: string, batch: DesignOperationBatch, now: string): Promise<{ project: DesignProject; receipt: DesignOperationReceipt }> {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        return withPostgresTransaction(async (client) => {
            const current = await lockProject(client, userId, projectId);
            const existing = await client.query<DesignOperationReceiptRow>("SELECT batch_id, fingerprint, receipt_json FROM design_operation_receipts WHERE user_id = $1 AND project_id = $2 AND batch_id = $3", [userId, projectId, batch.batchId]);
            const replay = existing.rows[0] ? replayFromRow(projectId, existing.rows[0]) : null;
            const outcome = applyDesignOperationBatch(current.document, batch, { replay, now: () => now });
            const project = outcome.document.revision === current.revision ? current : projectWithDocument(current, outcome.document);
            if (project !== current) await updateLockedPostgresProject(client, userId, project, current.revision);
            if (!existing.rows[0]) await insertPostgresReceipt(client, userId, projectId, outcome.receipt, now);
            return { project, receipt: outcome.receipt };
        });
    }
    return mutateDatabase((database) => {
        const index = database.projects.findIndex((item) => item.userId === userId && item.project.id === projectId);
        if (index < 0) throw notFound();
        const current = validateStoredProject(database.projects[index].project);
        const existing = database.receipts.find((item) => item.userId === userId && item.projectId === projectId && item.replay.batchId === batch.batchId);
        const outcome = applyDesignOperationBatch(current.document, batch, { replay: existing ? validateReplay(existing.replay, projectId) : null, now: () => now });
        const project = outcome.document.revision === current.revision ? current : projectWithDocument(current, outcome.document);
        const projects = project === current ? database.projects : database.projects.toSpliced(index, 1, { userId, project: structuredClone(project) });
        const receiptRecord: DesignOperationReceiptFileRecord = {
            userId,
            projectId,
            createdAt: now,
            replay: { documentId: projectId, batchId: batch.batchId, fingerprint: outcome.receipt.fingerprint, receipt: structuredClone(outcome.receipt) },
        };
        return {
            database: { ...database, projects, receipts: existing ? database.receipts : [receiptRecord, ...database.receipts] },
            result: { project: structuredClone(project), receipt: structuredClone(outcome.receipt) },
        };
    });
}

async function readDatabase(): Promise<DesignProjectFileDatabase> {
    const value = await readJsonDataFile<DesignProjectFileDatabase>(FILE_NAME, EMPTY_DATABASE);
    if (value?.version !== 1 || !Array.isArray(value.projects) || !Array.isArray(value.versions) || !Array.isArray(value.receipts)) throw new Error("design-projects.json 格式无效");
    return value;
}

function mutateDatabase<T>(mutator: (database: DesignProjectFileDatabase) => { database: DesignProjectFileDatabase; result: T }): Promise<T> {
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

async function lockProject(client: QueryExecutor, userId: string, projectId: string): Promise<DesignProject> {
    const result = await client.query<DesignProjectRow>("SELECT id, title, status, revision, document_json, created_at, updated_at FROM design_projects WHERE id = $1 AND user_id = $2 FOR UPDATE", [projectId, userId]);
    if (!result.rows[0]) throw notFound();
    return projectFromRow(result.rows[0]);
}

async function updateLockedPostgresProject(client: QueryExecutor, userId: string, project: DesignProject, expectedRevision: number): Promise<DesignProject> {
    const result = await client.query<DesignProjectRow>(
        `UPDATE design_projects
         SET title = $3, status = $4, revision = $5, document_json = $6::jsonb, updated_at = $7
         WHERE id = $1 AND user_id = $2 AND revision = $8
         RETURNING id, title, status, revision, document_json, created_at, updated_at`,
        [project.id, userId, project.title, project.status, project.revision, JSON.stringify(project.document), new Date(project.updatedAt), expectedRevision],
    );
    if (!result.rows[0]) throw revisionConflict(expectedRevision);
    return projectFromRow(result.rows[0]);
}

async function insertPostgresVersion(client: QueryExecutor, userId: string, project: DesignProject, reason: string, now: string): Promise<DesignProjectVersion> {
    const next = await client.query<{ version: string | number }>("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM design_project_versions WHERE user_id = $1 AND project_id = $2", [userId, project.id]);
    const version: DesignProjectVersion = {
        id: `design-version-${nanoid()}`,
        projectId: project.id,
        version: integer(next.rows[0]?.version) || 1,
        snapshotRevision: project.revision,
        reason,
        createdAt: now,
    };
    await client.query(
        `INSERT INTO design_project_versions (id, project_id, user_id, version, snapshot_revision, reason, snapshot_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
        [version.id, project.id, userId, version.version, version.snapshotRevision, version.reason, JSON.stringify(project.document), new Date(now)],
    );
    return version;
}

async function insertPostgresReceipt(client: QueryExecutor, userId: string, projectId: string, receipt: DesignOperationReceipt, now: string) {
    await client.query(
        `INSERT INTO design_operation_receipts (project_id, user_id, batch_id, fingerprint, base_revision, result_revision, receipt_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
        [projectId, userId, receipt.batchId, receipt.fingerprint, receipt.baseRevision, receipt.resultRevision, JSON.stringify(receipt), new Date(now)],
    );
}

function createFileVersion(database: DesignProjectFileDatabase, userId: string, project: DesignProject, reason: string, now: string): DesignProjectVersionFileRecord {
    const version = Math.max(0, ...database.versions.filter((item) => item.userId === userId && item.projectId === project.id).map((item) => item.version)) + 1;
    return { id: `design-version-${nanoid()}`, projectId: project.id, userId, version, snapshotRevision: project.revision, reason, snapshot: structuredClone(project.document), createdAt: now };
}

function projectWithDocument(current: DesignProject, document: DesignDocument): DesignProject {
    return { ...current, title: document.metadata.title, revision: document.revision, document: structuredClone(document), updatedAt: document.metadata.updatedAt };
}

function projectFromRow(row: DesignProjectRow): DesignProject {
    const document = jsonObject<DesignDocument>(row.document_json);
    return validateStoredProject({
        id: row.id,
        title: row.title,
        status: row.status,
        revision: requiredInteger(row.revision, "design_projects.revision"),
        document,
        createdAt: timestamp(row.created_at),
        updatedAt: timestamp(row.updated_at),
    });
}

function versionFromRow(row: DesignProjectVersionRow): DesignProjectVersion {
    return {
        id: row.id,
        projectId: row.project_id,
        version: requiredInteger(row.version, "design_project_versions.version", 1),
        snapshotRevision: requiredInteger(row.snapshot_revision, "design_project_versions.snapshot_revision"),
        reason: row.reason,
        createdAt: timestamp(row.created_at),
    };
}

function archiveVersionFromRow(row: DesignProjectVersionRow): DesignProjectArchiveVersion {
    if (row.snapshot_json === undefined) throw new Error("Design Project 版本快照缺失");
    const version = versionFromRow(row);
    return { ...version, snapshot: validateArchiveSnapshot(version.projectId, version.snapshotRevision, jsonObject<DesignDocument>(row.snapshot_json)) };
}

function archiveReceiptFromRow(row: DesignArchiveReceiptRow): DesignProjectArchiveReceipt {
    return {
        projectId: row.project_id,
        createdAt: timestamp(row.created_at),
        replay: replayFromRow(row.project_id, row),
    };
}

function replayFromRow(projectId: string, row: DesignOperationReceiptRow): DesignOperationReplay {
    return validateReplay({ documentId: projectId, batchId: row.batch_id, fingerprint: row.fingerprint, receipt: jsonObject<DesignOperationReceipt>(row.receipt_json) }, projectId);
}

function publicVersion(record: DesignProjectVersionFileRecord): DesignProjectVersion {
    const { userId: _userId, snapshot: _snapshot, ...version } = record;
    return structuredClone(version);
}

function summarize(project: DesignProject): DesignProjectSummary {
    return {
        id: project.id,
        title: project.title,
        status: project.status,
        revision: project.revision,
        frameCount: project.document.frames.length,
        elementCount: project.document.elements.length,
        assetCount: project.document.assets.length,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
    };
}

function validateStoredProject(project: DesignProject): DesignProject {
    const document = migrateDesignDocument(project.document).document;
    if (project.status !== "active" && project.status !== "archived") throw new Error("Design Project status 无效");
    if (document.id !== project.id || document.revision !== project.revision || document.metadata.title !== project.title) throw new Error("Design Project 索引字段与文档不一致");
    if (document.metadata.createdAt !== project.createdAt || document.metadata.updatedAt !== project.updatedAt) throw new Error("Design Project 时间字段与文档不一致");
    return { ...project, document };
}

function validateArchiveSnapshot(projectId: string, snapshotRevision: number, value: DesignDocument) {
    const snapshot = migrateDesignDocument(value).document;
    if (snapshot.id !== projectId || snapshot.revision !== snapshotRevision) throw new Error("Design Project 版本索引与快照不一致");
    return structuredClone(snapshot);
}

function validateReplay(replay: DesignOperationReplay, projectId: string): DesignOperationReplay {
    const receipt = replay.receipt;
    const validStatus = receipt && ["applied", "partial", "rejected", "conflict"].includes(receipt.status);
    if (
        replay.documentId !== projectId ||
        replay.batchId !== receipt?.batchId ||
        replay.fingerprint !== receipt?.fingerprint ||
        !/^sha256:[0-9a-f]{64}$/.test(replay.fingerprint) ||
        !validStatus ||
        receipt.originalStatus !== null ||
        !Number.isSafeInteger(receipt.baseRevision) ||
        receipt.baseRevision < 0 ||
        !Number.isSafeInteger(receipt.resultRevision) ||
        receipt.resultRevision < receipt.baseRevision ||
        !Array.isArray(receipt.results)
    )
        throw new Error("Design Operation replay 回执无效");
    return structuredClone(replay);
}

async function throwMissingOrConflict(userId: string, projectId: string): Promise<never> {
    const existing = await postgresQuery<{ revision: string | number }>("SELECT revision FROM design_projects WHERE id = $1 AND user_id = $2", [projectId, userId]);
    if (!existing.rows[0]) throw notFound();
    throw revisionConflict(undefined, integer(existing.rows[0].revision));
}

function assertRevision(actual: number, expected: number) {
    if (actual !== expected) throw revisionConflict(expected, actual);
}

function notFound() {
    return new DesignProjectStoreError("画板项目不存在", 404, "NOT_FOUND");
}

function revisionConflict(expected?: number, actual?: number) {
    const detail = expected === undefined || actual === undefined ? "" : `：期望 ${expected}，当前 ${actual}`;
    return new DesignProjectStoreError(`画板项目 revision 冲突${detail}`, 409, "CONFLICT");
}

function positiveInteger(value: unknown, fallback: number) {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function integer(value: unknown) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function requiredInteger(value: unknown, label: string, minimum = 0) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`${label} 无效`);
    return parsed;
}

function timestamp(value: Date | string) {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function jsonObject<T>(value: T | string): T {
    return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function postgresErrorCode(error: unknown) {
    return error && typeof error === "object" && "code" in error ? String(error.code) : "";
}
