import type { CanvasProject, CanvasProjectSummary, CanvasProjectSummaryPage } from "@/lib/canvas-project-contract";
import type { CanvasNodeData } from "@/app/(user)/canvas/types";
import { canvasProjectRevision, type CanvasSaveReceipt, type CanvasSaveRequest } from "@/lib/canvas-project-receipt";
import { summarizeCanvasProjectRecord } from "@/lib/canvas-project-summary";
import { summarizeCanvasProject, type CreateOverviewMedia, type CreateOverviewProject } from "@/lib/create-workbench-overview";
import { readJsonDataFile, writeJsonDataFile } from "@/lib/server/data-adapter";
import { ensurePostgresSchema, getDatabaseProvider, postgresQuery, type QueryExecutor, withPostgresTransaction } from "@/lib/server/database";

type CanvasProjectRecord = { userId: string; project: CanvasProject };
type CanvasProjectReceiptRecord = { userId: string; projectId: string; createdAt: string; receipt: CanvasSaveReceipt };
type CanvasProjectDatabase = { version: 1 | 2; projects: CanvasProjectRecord[]; receipts?: CanvasProjectReceiptRecord[] };

type CanvasProjectReceiptRow = {
    batch_id: string;
    fingerprint: string;
    base_revision: string | number;
    result_revision: string | number;
    receipt_json: CanvasSaveReceipt | string;
};

const FILE_NAME = "canvas-projects.json";
let mutationQueue = Promise.resolve();

export async function listCanvasProjects(userId: string) {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<{ project_json: CanvasProject }>("SELECT project_json FROM canvas_projects WHERE user_id = $1 ORDER BY updated_at DESC", [userId]);
        return result.rows.map((row) => row.project_json);
    }
    return (await readDatabase()).projects
        .filter((record) => record.userId === userId)
        .map((record) => record.project)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function listCanvasProjectSummaries(userId: string): Promise<CanvasProjectSummary[]>;
export function listCanvasProjectSummaries(userId: string, input: { page?: number; pageSize?: number }): Promise<CanvasProjectSummaryPage>;
export async function listCanvasProjectSummaries(userId: string, input?: { page?: number; pageSize?: number }): Promise<CanvasProjectSummary[] | CanvasProjectSummaryPage> {
    const paged = input !== undefined;
    const page = Math.max(1, Math.floor(Number(input?.page) || 1));
    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(input?.pageSize) || 20)));
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<Record<string, unknown>>(
            paged
                ? `SELECT id, title, created_at, updated_at,
                        COALESCE(NULLIF(project_json->>'revision', '')::bigint, 0) AS revision,
                        project_json->>'sourceHandoffId' AS source_handoff_id,
                        project_json->>'creativeConversationId' AS creative_conversation_id,
                        jsonb_array_length(CASE WHEN jsonb_typeof(project_json->'nodes') = 'array' THEN project_json->'nodes' ELSE '[]'::jsonb END) AS node_count,
                        jsonb_array_length(CASE WHEN jsonb_typeof(project_json->'connections') = 'array' THEN project_json->'connections' ELSE '[]'::jsonb END) AS connection_count,
                        preview.kind AS preview_kind,
                        preview.url AS preview_url,
                        COUNT(*) OVER() AS total_count
                 FROM canvas_projects
                 ${canvasProjectSummaryPreviewJoin()}
                 WHERE user_id = $1
                 ORDER BY updated_at DESC, id ASC
                 LIMIT $2 OFFSET $3`
                : `SELECT id, title, created_at, updated_at,
                        COALESCE(NULLIF(project_json->>'revision', '')::bigint, 0) AS revision,
                        project_json->>'sourceHandoffId' AS source_handoff_id,
                        project_json->>'creativeConversationId' AS creative_conversation_id,
                        jsonb_array_length(CASE WHEN jsonb_typeof(project_json->'nodes') = 'array' THEN project_json->'nodes' ELSE '[]'::jsonb END) AS node_count,
                        jsonb_array_length(CASE WHEN jsonb_typeof(project_json->'connections') = 'array' THEN project_json->'connections' ELSE '[]'::jsonb END) AS connection_count,
                        preview.kind AS preview_kind,
                        preview.url AS preview_url
                 FROM canvas_projects
                 ${canvasProjectSummaryPreviewJoin()}
                 WHERE user_id = $1
                 ORDER BY updated_at DESC, id ASC`,
            paged ? [userId, pageSize, (page - 1) * pageSize] : [userId],
        );
        if (!paged) return result.rows.map(mapProjectSummary);
        return { items: result.rows.map(mapProjectSummary), total: Number(result.rows[0]?.total_count) || 0, page, pageSize };
    }
    const summaries = (await listCanvasProjects(userId)).map(summarizeCanvasProjectRecord);
    if (!paged) return summaries;
    return { items: summaries.slice((page - 1) * pageSize, page * pageSize), total: summaries.length, page, pageSize };
}

export async function getLatestCanvasProjectOverview(userId: string): Promise<CreateOverviewProject | undefined> {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<Record<string, unknown>>(
            `
            SELECT
                id,
                title,
                updated_at,
                jsonb_array_length(CASE WHEN jsonb_typeof(project_json->'nodes') = 'array' THEN project_json->'nodes' ELSE '[]'::jsonb END) AS node_count,
                jsonb_array_length(CASE WHEN jsonb_typeof(project_json->'connections') = 'array' THEN project_json->'connections' ELSE '[]'::jsonb END) AS connection_count,
                COALESCE((
                    SELECT jsonb_agg(jsonb_build_object('kind', preview.kind, 'url', preview.url) ORDER BY preview.status_order, preview.kind_order, preview.node_order, preview.url_order)
                    FROM (
                        SELECT
                            CASE WHEN node->>'type' = 'video' THEN 'video' ELSE 'image' END AS kind,
                            media.url,
                            CASE WHEN node->'metadata'->>'status' = 'success' THEN 0 ELSE 1 END AS status_order,
                            CASE WHEN node->>'type' IN ('image', 'panorama') THEN 0 ELSE 1 END AS kind_order,
                            node_order,
                            media.url_order
                        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(project_json->'nodes') = 'array' THEN project_json->'nodes' ELSE '[]'::jsonb END) WITH ORDINALITY AS project_node(node, node_order)
                        CROSS JOIN LATERAL (
                            VALUES
                                (node->'metadata'->>'serverUrl', 1),
                                (node->'metadata'->>'remoteUrl', 2),
                                (node->'metadata'->>'content', 3)
                        ) AS media(url, url_order)
                        WHERE node->>'type' IN ('image', 'panorama', 'video')
                          AND COALESCE(node->'metadata'->>'status', '') <> 'error'
                          AND COALESCE(btrim(media.url), '') <> ''
                          AND media.url !~* '^(data|blob):'
                        ORDER BY status_order, kind_order, node_order, media.url_order
                        LIMIT 18
                    ) preview
                ), '[]'::jsonb) AS previews
            FROM canvas_projects
            WHERE user_id = $1
            ORDER BY updated_at DESC
            LIMIT 1
            `,
            [userId],
        );
        return result.rows[0] ? mapPostgresOverview(result.rows[0]) : undefined;
    }
    const project = (await listCanvasProjects(userId))[0];
    return project ? summarizeCanvasProject(project) : undefined;
}

export async function getCanvasProject(id: string, userId: string) {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<{ project_json: CanvasProject }>("SELECT project_json FROM canvas_projects WHERE id = $1 AND user_id = $2", [id, userId]);
        return result.rows[0]?.project_json || null;
    }
    return (await readDatabase()).projects.find((record) => record.userId === userId && record.project.id === id)?.project || null;
}

export async function getCanvasProjectSaveReceipt(userId: string, projectId: string, batchId: string) {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<CanvasProjectReceiptRow>("SELECT batch_id, fingerprint, base_revision, result_revision, receipt_json FROM canvas_project_save_receipts WHERE user_id = $1 AND project_id = $2 AND batch_id = $3", [
            userId,
            projectId,
            batchId,
        ]);
        return result.rows[0] ? receiptFromRow(projectId, result.rows[0]) : null;
    }
    const record = (await readDatabase()).receipts?.find((item) => item.userId === userId && item.projectId === projectId && item.receipt.batchId === batchId);
    return record ? structuredClone(record.receipt) : null;
}

export type CanvasNodeImportRequest = Readonly<{
    projectId: string;
    expectedRevision: number;
    batchId: string;
    fingerprint: string;
    nodes: readonly CanvasNodeData[];
    updatedAt: string;
}>;

export async function applyCanvasProjectNodeImportBatch(userId: string, request: CanvasNodeImportRequest): Promise<{ project: CanvasProject; receipt: CanvasSaveReceipt }> {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        return withPostgresTransaction(async (client) => {
            const current = await lockPostgresProject(client, userId, request.projectId);
            const existing = await client.query<CanvasProjectReceiptRow>("SELECT batch_id, fingerprint, base_revision, result_revision, receipt_json FROM canvas_project_save_receipts WHERE user_id = $1 AND project_id = $2 AND batch_id = $3", [
                userId,
                request.projectId,
                request.batchId,
            ]);
            const outcome = canvasNodeImportOutcome(current, request, existing.rows[0] ? receiptFromRow(request.projectId, existing.rows[0]) : undefined);
            if (outcome.project === current) return outcome;
            const result = await client.query(
                `UPDATE canvas_projects SET title = $3, project_json = $4::jsonb, updated_at = $5
                 WHERE id = $1 AND user_id = $2 RETURNING id`,
                [outcome.project.id, userId, outcome.project.title, JSON.stringify(outcome.project), new Date(outcome.project.updatedAt)],
            );
            if (!result.rows[0]) throw new CanvasProjectStoreError("画布项目不存在", 404);
            await client.query(
                `INSERT INTO canvas_project_save_receipts (project_id, user_id, batch_id, fingerprint, base_revision, result_revision, receipt_json, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
                [request.projectId, userId, outcome.receipt.batchId, outcome.receipt.fingerprint, outcome.receipt.baseRevision, outcome.receipt.resultRevision, JSON.stringify(outcome.receipt), new Date(outcome.project.updatedAt)],
            );
            return outcome;
        });
    }
    return mutateDatabaseResult((database) => {
        const record = database.projects.find((item) => item.userId === userId && item.project.id === request.projectId);
        if (!record) throw new CanvasProjectStoreError("画布项目不存在", 404);
        const existing = (database.receipts || []).find((item) => item.userId === userId && item.projectId === request.projectId && item.receipt.batchId === request.batchId);
        const outcome = canvasNodeImportOutcome(record.project, request, existing?.receipt);
        if (outcome.project === record.project) return { database, result: outcome };
        const projects = database.projects.map((item) => (item === record ? { ...item, project: structuredClone(outcome.project) } : item));
        const receiptRecord: CanvasProjectReceiptRecord = { userId, projectId: request.projectId, createdAt: outcome.project.updatedAt, receipt: outcome.receipt };
        return { database: { ...database, version: 2, projects, receipts: [receiptRecord, ...(database.receipts || [])] }, result: { project: structuredClone(outcome.project), receipt: structuredClone(outcome.receipt) } };
    });
}

export async function createCanvasProject(userId: string, project: CanvasProject) {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        await postgresQuery(
            `INSERT INTO canvas_projects (id, user_id, title, project_json, created_at, updated_at)
             VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
            [project.id, userId, project.title, JSON.stringify(project), new Date(project.createdAt), new Date(project.updatedAt)],
        );
        return project;
    }
    await mutateDatabase((db) => {
        if (db.projects.some((record) => record.project.id === project.id)) throw new CanvasProjectStoreError("画布项目已存在", 409);
        return { ...db, projects: [{ userId, project }, ...db.projects] };
    });
    return project;
}

export async function updateCanvasProject(userId: string, project: CanvasProject) {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery(
            `UPDATE canvas_projects SET title = $3, project_json = $4::jsonb, updated_at = $5
             WHERE id = $1 AND user_id = $2 RETURNING id`,
            [project.id, userId, project.title, JSON.stringify(project), new Date(project.updatedAt)],
        );
        if (!result.rows[0]) throw new CanvasProjectStoreError("画布项目不存在", 404);
        return project;
    }
    let found = false;
    await mutateDatabase((db) => ({
        ...db,
        projects: db.projects.map((record) => {
            if (record.userId !== userId || record.project.id !== project.id) return record;
            found = true;
            return { ...record, project };
        }),
    }));
    if (!found) throw new CanvasProjectStoreError("画布项目不存在", 404);
    return project;
}

export async function saveCanvasProject(userId: string, request: CanvasSaveRequest): Promise<{ project: CanvasProject; receipt: CanvasSaveReceipt }> {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        return withPostgresTransaction(async (client) => {
            const current = await lockPostgresProject(client, userId, request.project.id);
            const existing = await client.query<CanvasProjectReceiptRow>("SELECT batch_id, fingerprint, base_revision, result_revision, receipt_json FROM canvas_project_save_receipts WHERE user_id = $1 AND project_id = $2 AND batch_id = $3", [
                userId,
                request.project.id,
                request.batchId,
            ]);
            const replay = resolveReplay(current, request, existing.rows[0] ? receiptFromRow(request.project.id, existing.rows[0]) : undefined);
            if (replay.receipt.status !== "applied") return replay;
            const saved = { ...request.project, revision: canvasProjectRevision(current) + 1 };
            const result = await client.query(
                `UPDATE canvas_projects SET title = $3, project_json = $4::jsonb, updated_at = $5
                 WHERE id = $1 AND user_id = $2 RETURNING id`,
                [saved.id, userId, saved.title, JSON.stringify(saved), new Date(saved.updatedAt)],
            );
            if (!result.rows[0]) throw new CanvasProjectStoreError("画布项目不存在", 404);
            const receipt = appliedReceipt(saved, request, canvasProjectRevision(current));
            await client.query(
                `INSERT INTO canvas_project_save_receipts (project_id, user_id, batch_id, fingerprint, base_revision, result_revision, receipt_json, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
                [saved.id, userId, receipt.batchId, receipt.fingerprint, receipt.baseRevision, receipt.resultRevision, JSON.stringify(receipt), new Date(saved.updatedAt)],
            );
            return { project: saved, receipt };
        });
    }
    return mutateDatabaseResult((database) => {
        const currentRecord = database.projects.find((record) => record.userId === userId && record.project.id === request.project.id);
        if (!currentRecord) throw new CanvasProjectStoreError("画布项目不存在", 404);
        const current = currentRecord.project;
        const existing = (database.receipts || []).find((record) => record.userId === userId && record.projectId === request.project.id && record.receipt.batchId === request.batchId);
        const replay = resolveReplay(current, request, existing?.receipt);
        if (replay.receipt.status !== "applied") return { database, result: replay };
        const saved = { ...request.project, revision: canvasProjectRevision(current) + 1 };
        const projects = database.projects.map((record) => (record === currentRecord ? { ...record, project: structuredClone(saved) } : record));
        const receipt = appliedReceipt(saved, request, canvasProjectRevision(current));
        const receipts = [{ userId, projectId: request.project.id, createdAt: saved.updatedAt, receipt }, ...(database.receipts || [])];
        return { database: { ...database, version: 2, projects, receipts }, result: { project: structuredClone(saved), receipt: structuredClone(receipt) } };
    });
}

export async function deleteCanvasProjects(userId: string, ids: string[]) {
    const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
    if (!uniqueIds.length) return 0;
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery("DELETE FROM canvas_projects WHERE user_id = $1 AND id = ANY($2::text[]) RETURNING id", [userId, uniqueIds]);
        return result.rows.length;
    }
    let deleted = 0;
    await mutateDatabase((db) => ({
        ...db,
        projects: db.projects.filter((record) => {
            if (record.userId === userId && uniqueIds.includes(record.project.id)) {
                deleted += 1;
                return false;
            }
            return true;
        }),
        receipts: (db.receipts || []).filter((record) => !(record.userId === userId && uniqueIds.includes(record.projectId))),
    }));
    return deleted;
}

function readDatabase() {
    return readJsonDataFile<CanvasProjectDatabase>(FILE_NAME, { version: 2, projects: [], receipts: [] });
}

function mutateDatabase(mutator: (database: CanvasProjectDatabase) => CanvasProjectDatabase) {
    const operation = mutationQueue.then(async () => writeJsonDataFile(FILE_NAME, mutator(await readDatabase())));
    mutationQueue = operation.catch(() => undefined);
    return operation;
}

function mutateDatabaseResult<T>(mutator: (database: CanvasProjectDatabase) => { database: CanvasProjectDatabase; result: T }): Promise<T> {
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

async function lockPostgresProject(client: QueryExecutor, userId: string, projectId: string) {
    const result = await client.query<{ project_json: CanvasProject }>("SELECT project_json FROM canvas_projects WHERE id = $1 AND user_id = $2 FOR UPDATE", [projectId, userId]);
    if (!result.rows[0]) throw new CanvasProjectStoreError("画布项目不存在", 404);
    return result.rows[0].project_json;
}

function resolveReplay(current: CanvasProject, request: CanvasSaveRequest, existing?: CanvasSaveReceipt) {
    if (existing) {
        if (existing.fingerprint !== request.fingerprint) {
            return { project: current, receipt: conflictReceipt(request, canvasProjectRevision(current), "CANVAS_BATCH_ID_CONFLICT", "相同 batchId 对应了不同画布内容") };
        }
        return { project: current, receipt: { ...existing, status: "replayed" as const, originalStatus: existing.originalStatus || "applied" } };
    }
    const currentRevision = canvasProjectRevision(current);
    if (currentRevision !== request.expectedRevision) {
        return { project: current, receipt: conflictReceipt(request, currentRevision, "CANVAS_REVISION_CONFLICT", `期望 revision ${request.expectedRevision}，当前为 ${currentRevision}`) };
    }
    return { project: current, receipt: appliedReceipt(request.project, request, currentRevision) };
}

function canvasNodeImportOutcome(current: CanvasProject, request: CanvasNodeImportRequest, existing?: CanvasSaveReceipt): { project: CanvasProject; receipt: CanvasSaveReceipt } {
    if (existing) {
        if (existing.fingerprint !== request.fingerprint) return { project: current, receipt: canvasNodeImportConflict(request, canvasProjectRevision(current), "CANVAS_BATCH_ID_CONFLICT", "相同 batchId 对应了不同节点导入内容") };
        return { project: current, receipt: { ...existing, status: "replayed", originalStatus: existing.originalStatus || (existing.status === "replayed" ? "applied" : existing.status) } };
    }
    const currentRevision = canvasProjectRevision(current);
    if (currentRevision !== request.expectedRevision) {
        return { project: current, receipt: canvasNodeImportConflict(request, currentRevision, "CANVAS_REVISION_CONFLICT", `期望 revision ${request.expectedRevision}，当前为 ${currentRevision}`) };
    }
    const nodes = request.nodes.map((node) => structuredClone(node));
    const incomingIds = new Set(nodes.map((node) => node.id));
    if (!nodes.length || incomingIds.size !== nodes.length || current.nodes.some((node) => incomingIds.has(node.id))) {
        return { project: current, receipt: canvasNodeImportConflict(request, currentRevision, "CANVAS_NODE_ID_CONFLICT", "节点导入 ID 为空、重复或已存在") };
    }
    if (current.nodes.length + nodes.length > 2_000) return { project: current, receipt: canvasNodeImportConflict(request, currentRevision, "CANVAS_NODE_LIMIT", "画布节点数量超过 2000 上限") };
    const parsedTime = Date.parse(request.updatedAt);
    const previousTime = Date.parse(current.updatedAt);
    const updatedAt = new Date(Math.max(Number.isFinite(parsedTime) ? parsedTime : Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : Date.now())).toISOString();
    const project: CanvasProject = { ...current, revision: currentRevision + 1, nodes: [...current.nodes, ...nodes], updatedAt };
    const receipt: CanvasSaveReceipt = {
        projectId: current.id,
        batchId: request.batchId,
        fingerprint: request.fingerprint,
        status: "applied",
        baseRevision: currentRevision,
        resultRevision: currentRevision + 1,
        affectedIds: Object.freeze(nodes.map((node) => node.id)),
    };
    return { project, receipt };
}

function canvasNodeImportConflict(request: CanvasNodeImportRequest, currentRevision: number, code: string, message: string): CanvasSaveReceipt {
    return {
        projectId: request.projectId,
        batchId: request.batchId,
        fingerprint: request.fingerprint,
        status: "conflict",
        baseRevision: request.expectedRevision,
        resultRevision: currentRevision,
        affectedIds: [],
        error: { code, message, retryable: false },
    };
}

function appliedReceipt(project: CanvasProject, request: CanvasSaveRequest, baseRevision: number): CanvasSaveReceipt {
    return { projectId: project.id, batchId: request.batchId, fingerprint: request.fingerprint, status: "applied", baseRevision, resultRevision: baseRevision + 1 };
}

function conflictReceipt(request: CanvasSaveRequest, currentRevision: number, code: string, message: string): CanvasSaveReceipt {
    return {
        projectId: request.project.id,
        batchId: request.batchId,
        fingerprint: request.fingerprint,
        status: "conflict",
        baseRevision: request.expectedRevision,
        resultRevision: currentRevision,
        error: { code, message, retryable: false },
    };
}

function receiptFromRow(projectId: string, row: CanvasProjectReceiptRow): CanvasSaveReceipt {
    const receipt = typeof row.receipt_json === "string" ? (JSON.parse(row.receipt_json) as CanvasSaveReceipt) : row.receipt_json;
    return { ...receipt, projectId, batchId: row.batch_id, fingerprint: row.fingerprint, baseRevision: Number(row.base_revision), resultRevision: Number(row.result_revision) };
}

function mapPostgresOverview(row: Record<string, unknown>): CreateOverviewProject {
    const previews = jsonArray(row.previews);
    const seen = new Set<string>();
    return {
        id: String(row.id || ""),
        title: String(row.title || ""),
        updatedAt: isoDate(row.updated_at),
        nodeCount: Math.max(0, Number(row.node_count) || 0),
        connectionCount: Math.max(0, Number(row.connection_count) || 0),
        previews: previews
            .flatMap((item): CreateOverviewMedia[] => {
                const source = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
                const kind = source.kind === "video" ? "video" : source.kind === "image" ? "image" : undefined;
                const url = typeof source.url === "string" ? source.url.trim() : "";
                if (!kind || !url || /^(data|blob):/i.test(url) || seen.has(url)) return [];
                seen.add(url);
                return [{ kind, url }];
            })
            .slice(0, 6),
    };
}

function mapProjectSummary(row: Record<string, unknown>): CanvasProjectSummary {
    const sourceHandoffId = String(row.source_handoff_id || "").trim();
    const creativeConversationId = String(row.creative_conversation_id || "").trim();
    const previewKind = row.preview_kind === "video" ? "video" : row.preview_kind === "image" ? "image" : undefined;
    const previewUrl = String(row.preview_url || "").trim();
    return {
        id: String(row.id || ""),
        revision: Math.max(0, Number(row.revision) || 0),
        ...(sourceHandoffId ? { sourceHandoffId } : {}),
        ...(creativeConversationId ? { creativeConversationId } : {}),
        title: String(row.title || ""),
        nodeCount: Math.max(0, Number(row.node_count) || 0),
        connectionCount: Math.max(0, Number(row.connection_count) || 0),
        ...(previewKind && previewUrl && !/^(data|blob):/i.test(previewUrl) ? { preview: { kind: previewKind, url: previewUrl } } : {}),
        createdAt: isoDate(row.created_at),
        updatedAt: isoDate(row.updated_at),
    };
}

function canvasProjectSummaryPreviewJoin() {
    return `LEFT JOIN LATERAL (
                SELECT
                    CASE WHEN node->>'type' = 'video' THEN 'video' ELSE 'image' END AS kind,
                    btrim(media.url) AS url
                FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(canvas_projects.project_json->'nodes') = 'array' THEN canvas_projects.project_json->'nodes' ELSE '[]'::jsonb END
                ) WITH ORDINALITY AS project_node(node, node_order)
                CROSS JOIN LATERAL (
                    VALUES
                        (node->'metadata'->>'serverUrl', 1),
                        (node->'metadata'->>'remoteUrl', 2),
                        (node->'metadata'->'drawingPreview'->>'serverUrl', 3),
                        (node->'metadata'->>'content', 4)
                ) AS media(url, url_order)
                WHERE node->>'type' IN ('image', 'panorama', 'drawing', 'video')
                  AND COALESCE(node->'metadata'->>'status', '') <> 'error'
                  AND COALESCE(btrim(media.url), '') <> ''
                  AND media.url !~* '^(data|blob):'
                ORDER BY
                    CASE WHEN node->'metadata'->>'status' = 'success' THEN 0 ELSE 1 END,
                    CASE WHEN node->>'type' IN ('image', 'panorama', 'drawing') THEN 0 ELSE 1 END,
                    node_order,
                    url_order
                LIMIT 1
            ) AS preview ON true`;
}

function jsonArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string") return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function isoDate(value: unknown) {
    const date = value instanceof Date ? value : new Date(String(value || ""));
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

export class CanvasProjectStoreError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
    }
}
