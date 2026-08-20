import { nanoid } from "nanoid";

import {
    DesignDocumentValidationError,
    DesignOperationBatchValidationError,
    migrateDesignDocument,
    parseDesignDocumentV1,
    parseDesignOperationBatch,
    type DesignDocument,
    type DesignOperationReceipt,
    type DesignProject,
    type DesignProjectStatus,
} from "@/lib/design";
import {
    applyDesignProjectOperationBatch,
    createCurrentDesignProjectVersion,
    createDesignProject,
    deleteDesignProject,
    DesignProjectStoreError,
    getDesignProject,
    listDesignProjectSummaries,
    listDesignProjectVersions,
    restoreDesignProjectVersion,
    updateDesignProject,
} from "@/lib/server/design-project-store";

export class DesignProjectServiceError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly details?: unknown,
    ) {
        super(message);
        this.name = "DesignProjectServiceError";
    }
}

export function listDesignProjectsForUser(userId: string, input: { page?: number; pageSize?: number; status?: unknown } = {}) {
    return listDesignProjectSummaries(userId, {
        page: input.page,
        pageSize: input.pageSize,
        status: input.status === undefined ? undefined : projectStatus(input.status),
    });
}

export async function getDesignProjectForUser(userId: string, projectId: string) {
    const project = await getDesignProject(userId, pathId(projectId));
    if (!project) throw notFound();
    return validateStoredProject(project);
}

export async function createDesignProjectForUser(userId: string, value: unknown) {
    const input = strictObject(value, ["title", "description", "document"], "创建画板请求");
    const now = new Date().toISOString();
    const supplied = input.document === undefined ? null : migrateDesignDocument(input.document).document;
    if (supplied && supplied.revision !== 0) throw new DesignProjectServiceError("新画板文档 revision 必须为 0", 400);
    const title = cleanText(input.title, 200) || supplied?.metadata.title || "未命名画板";
    const projectId = `design-${nanoid()}`;
    const document = supplied ? parseDesignDocumentV1({ ...supplied, id: projectId, metadata: { ...supplied.metadata, title, createdAt: now, updatedAt: now } }) : blankDocument(projectId, title, cleanText(input.description, 4_000), now);
    const project: DesignProject = {
        id: document.id,
        title: document.metadata.title,
        status: "active",
        revision: document.revision,
        document,
        createdAt: document.metadata.createdAt,
        updatedAt: document.metadata.updatedAt,
    };
    return createDesignProject(userId, validateStoredProject(project));
}

export async function updateDesignProjectForUser(userId: string, projectId: string, value: unknown) {
    const id = pathId(projectId);
    const input = strictObject(value, ["expectedRevision", "document", "status"], "保存画板请求");
    const expectedRevision = revision(input.expectedRevision);
    if (input.document === undefined) throw new DesignProjectServiceError("document 不能为空", 400);
    const current = await getDesignProjectForUser(userId, id);
    if (current.revision !== expectedRevision) throw revisionConflict(expectedRevision, current.revision);
    const incoming = migrateDesignDocument(input.document).document;
    if (incoming.id !== current.id) throw new DesignProjectServiceError("document.id 不能修改", 400);
    if (incoming.metadata.createdAt !== current.document.metadata.createdAt) throw new DesignProjectServiceError("document.metadata.createdAt 不能修改", 400);
    if (incoming.revision <= expectedRevision) throw new DesignProjectServiceError("保存后的 document.revision 必须大于 expectedRevision", 400);
    const now = nextTimestamp(current.updatedAt);
    const document = parseDesignDocumentV1({ ...incoming, metadata: { ...incoming.metadata, updatedAt: now } });
    const project: DesignProject = {
        ...current,
        title: document.metadata.title,
        status: input.status === undefined ? current.status : projectStatus(input.status),
        revision: document.revision,
        document,
        updatedAt: now,
    };
    return updateDesignProject(userId, validateStoredProject(project), expectedRevision);
}

export async function deleteDesignProjectForUser(userId: string, projectId: string, value: unknown) {
    const input = strictObject(value, ["expectedRevision"], "删除画板请求");
    await deleteDesignProject(userId, pathId(projectId), revision(input.expectedRevision));
    return true;
}

export async function listDesignProjectVersionsForUser(userId: string, projectId: string) {
    return listDesignProjectVersions(userId, pathId(projectId));
}

export async function createDesignProjectVersionForUser(userId: string, projectId: string, value: unknown) {
    const input = strictObject(value, ["expectedRevision", "reason"], "保存画板版本请求");
    const id = pathId(projectId);
    const expectedRevision = revision(input.expectedRevision);
    const current = await getDesignProjectForUser(userId, id);
    if (current.revision !== expectedRevision) throw revisionConflict(expectedRevision, current.revision);
    return createCurrentDesignProjectVersion(userId, id, expectedRevision, cleanText(input.reason, 200) || "手动保存版本", new Date().toISOString());
}

export async function restoreDesignProjectVersionForUser(userId: string, projectId: string, versionId: string, value: unknown) {
    const input = strictObject(value, ["expectedRevision"], "恢复画板版本请求");
    return restoreDesignProjectVersion(userId, pathId(projectId), pathId(versionId), revision(input.expectedRevision), new Date().toISOString(), (current, snapshot, now) => {
        const migrated = migrateDesignDocument(snapshot).document;
        const updatedAt = nextTimestamp(current.updatedAt, now);
        const document = parseDesignDocumentV1({
            ...migrated,
            id: current.id,
            revision: current.revision + 1,
            metadata: { ...migrated.metadata, createdAt: current.document.metadata.createdAt, updatedAt },
        });
        return validateStoredProject({ ...current, title: document.metadata.title, revision: document.revision, document, updatedAt });
    });
}

export async function applyDesignOperationsForUser(userId: string, projectId: string, value: unknown): Promise<{ project: DesignProject; receipt: DesignOperationReceipt }> {
    const batch = parseDesignOperationBatch(value);
    const result = await applyDesignProjectOperationBatch(userId, pathId(projectId), batch, new Date().toISOString());
    return { ...result, project: validateStoredProject(result.project) };
}

export function designProjectError(error: unknown): DesignProjectServiceError | null {
    if (error instanceof DesignProjectServiceError) return error;
    if (error instanceof DesignProjectStoreError) return new DesignProjectServiceError(error.message, error.status);
    if (error instanceof DesignDocumentValidationError) {
        const status = error.issues.some((issue) => issue.code === "LIMIT_EXCEEDED") ? 413 : 400;
        return new DesignProjectServiceError(status === 413 ? "画板文档超过容量限制" : "画板文档无效", status, error.issues);
    }
    if (error instanceof DesignOperationBatchValidationError) return new DesignProjectServiceError(error.message, 400);
    return null;
}

export function invalidDesignJsonError() {
    return new DesignProjectServiceError("请求 JSON 无效", 400);
}

function blankDocument(id: string, title: string, description: string, now: string): DesignDocument {
    return parseDesignDocumentV1({
        schemaVersion: 1,
        id,
        revision: 0,
        metadata: { title, description, createdAt: now, updatedAt: now },
        workspace: { background: "#e5e7eb", viewport: { x: 0, y: 0, zoom: 1 } },
        guides: [],
        frames: [],
        elements: [],
        layers: [{ scope: "workspace", elementIds: [] }],
        assets: [],
        assetVersions: [],
        annotations: [],
    });
}

function validateStoredProject(project: DesignProject): DesignProject {
    const document = migrateDesignDocument(project.document).document;
    if (document.id !== project.id || document.revision !== project.revision || document.metadata.title !== project.title) throw new Error("Design Project 索引字段与文档不一致");
    if (document.metadata.createdAt !== project.createdAt || document.metadata.updatedAt !== project.updatedAt) throw new Error("Design Project 时间字段与文档不一致");
    return { ...project, document };
}

function strictObject(value: unknown, allowedKeys: readonly string[], label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new DesignProjectServiceError(`${label}必须是对象`, 400);
    const input = value as Record<string, unknown>;
    const unknown = Object.keys(input).find((key) => !allowedKeys.includes(key));
    if (unknown) throw new DesignProjectServiceError(`${label}不支持字段 ${unknown}`, 400);
    return input;
}

function projectStatus(value: unknown): DesignProjectStatus {
    if (value === "active" || value === "archived") return value;
    throw new DesignProjectServiceError("status 必须是 active 或 archived", 400);
}

function revision(value: unknown) {
    if (!Number.isSafeInteger(value) || Number(value) < 0) throw new DesignProjectServiceError("expectedRevision 必须是非负安全整数", 400);
    return Number(value);
}

function pathId(value: unknown) {
    if (typeof value !== "string" || value.length < 1 || value.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) throw notFound();
    return value;
}

function cleanText(value: unknown, maximum: number) {
    return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function nextTimestamp(previous: string, candidate = new Date().toISOString()) {
    return new Date(Math.max(Date.parse(candidate), Date.parse(previous) + 1)).toISOString();
}

function notFound() {
    return new DesignProjectServiceError("画板项目不存在", 404);
}

function revisionConflict(expected: number, actual: number) {
    return new DesignProjectServiceError(`画板项目 revision 冲突：期望 ${expected}，当前 ${actual}`, 409);
}
