import { migrateDesignDocument, type DesignDocument, type DesignStableResourceLocator } from "@/lib/design";
import { readJsonDataFile } from "@/lib/server/data-adapter";
import { ensurePostgresSchema, getDatabaseProvider, postgresQuery } from "@/lib/server/database";

export type DesignDocumentResourceReference = Readonly<{
    locator: DesignStableResourceLocator;
    assetVersionIds: readonly string[];
    elementIds: readonly string[];
}>;

export type DesignLibraryAssetReference = Readonly<{
    entityType: "project" | "version";
    entityId: string;
    projectId: string;
    projectTitle?: string;
    version?: number;
    snapshotRevision: number;
    assetVersionIds: readonly string[];
    elementIds: readonly string[];
}>;

type DesignDocumentEntity = {
    entityType: "project" | "version";
    entityId: string;
    projectId: string;
    projectTitle?: string;
    version?: number;
    snapshotRevision: number;
    document: DesignDocument;
};

type DesignReferenceFileDatabase = {
    version: 1;
    projects: Array<{ userId: string; project: { id: string; title: string; revision: number; document: unknown } }>;
    versions: Array<{ userId: string; id: string; projectId: string; version: number; snapshotRevision: number; snapshot: unknown }>;
    receipts: unknown[];
};

type DesignReferenceRow = {
    entity_type: "project" | "version";
    entity_id: string;
    project_id: string;
    project_title?: string | null;
    version?: number | string | null;
    snapshot_revision: number | string;
    document_json: unknown;
};

const EMPTY_FILE_DATABASE: DesignReferenceFileDatabase = { version: 1, projects: [], versions: [], receipts: [] };

export function collectDesignDocumentResourceReferences(document: DesignDocument): DesignDocumentResourceReference[] {
    const elementIdsByVersion = new Map<string, string[]>();
    for (const element of document.elements) {
        if (element.kind !== "image") continue;
        const ids = elementIdsByVersion.get(element.assetVersionId) || [];
        ids.push(element.id);
        elementIdsByVersion.set(element.assetVersionId, ids);
    }

    const grouped = new Map<string, { locator: DesignStableResourceLocator; assetVersionIds: string[]; elementIds: string[] }>();
    for (const version of document.assetVersions) {
        const key = locatorKey(version.locator);
        const current = grouped.get(key) || { locator: version.locator, assetVersionIds: [], elementIds: [] };
        current.assetVersionIds.push(version.id);
        current.elementIds.push(...(elementIdsByVersion.get(version.id) || []));
        grouped.set(key, current);
    }

    return Array.from(grouped.values(), (reference) =>
        Object.freeze({
            locator: Object.freeze({ ...reference.locator }),
            assetVersionIds: Object.freeze(Array.from(new Set(reference.assetVersionIds))),
            elementIds: Object.freeze(Array.from(new Set(reference.elementIds))),
        }),
    );
}

export async function findDesignLibraryAssetReferences(userId: string, libraryAssetId: string): Promise<DesignLibraryAssetReference[]> {
    const normalizedUserId = requiredText(userId, "userId");
    const normalizedAssetId = requiredText(libraryAssetId, "libraryAssetId");
    const entities = getDatabaseProvider() === "postgres" ? await readPostgresLibraryReferenceEntities(normalizedUserId, normalizedAssetId) : await readFileLibraryReferenceEntities(normalizedUserId, normalizedAssetId);

    return entities.flatMap((entity) => {
        const reference = collectDesignDocumentResourceReferences(entity.document).find((item) => item.locator.kind === "library-asset" && item.locator.libraryAssetId === normalizedAssetId);
        if (!reference) return [];
        return [
            Object.freeze({
                entityType: entity.entityType,
                entityId: entity.entityId,
                projectId: entity.projectId,
                ...(entity.projectTitle ? { projectTitle: entity.projectTitle } : {}),
                ...(entity.version ? { version: entity.version } : {}),
                snapshotRevision: entity.snapshotRevision,
                assetVersionIds: reference.assetVersionIds,
                elementIds: reference.elementIds,
            }),
        ];
    });
}

export async function countDesignStorageKeyReferences(storageKeys: readonly string[]) {
    const keys = Array.from(new Set(storageKeys.map(normalizeStorageKey).filter(Boolean)));
    const counts = new Map(keys.map((key) => [key, 0]));
    if (!keys.length) return counts;

    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<{ storage_key: string; total: number | string }>(
            `WITH requested AS (
                SELECT unnest($1::text[]) AS storage_key
            ), entities AS (
                SELECT 'project'::text AS entity_type, id AS entity_id, document_json
                FROM design_projects
                UNION ALL
                SELECT 'version'::text AS entity_type, id AS entity_id, snapshot_json AS document_json
                FROM design_project_versions
            ), matched AS (
                SELECT DISTINCT r.storage_key, e.entity_type, e.entity_id
                FROM requested r
                JOIN entities e ON EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(
                        CASE WHEN jsonb_typeof(e.document_json->'assetVersions') = 'array'
                             THEN e.document_json->'assetVersions' ELSE '[]'::jsonb END
                    ) AS asset_version
                    WHERE asset_version->'locator'->>'kind' = 'storage-key'
                      AND asset_version->'locator'->>'storageKey' = r.storage_key
                )
            )
            SELECT r.storage_key, count(m.entity_id)::int AS total
            FROM requested r
            LEFT JOIN matched m ON m.storage_key = r.storage_key
            GROUP BY r.storage_key`,
            [keys],
        );
        for (const row of result.rows) counts.set(normalizeStorageKey(row.storage_key), Number(row.total) || 0);
        return counts;
    }

    const entities = await readAllFileEntities();
    for (const entity of entities) {
        const referenced = new Set(collectDesignDocumentResourceReferences(entity.document).flatMap((reference) => (reference.locator.kind === "storage-key" ? [normalizeStorageKey(reference.locator.storageKey)] : [])));
        for (const key of keys) if (referenced.has(key)) counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
}

async function readPostgresLibraryReferenceEntities(userId: string, libraryAssetId: string) {
    await ensurePostgresSchema();
    const result = await postgresQuery<DesignReferenceRow>(
        `WITH entities AS (
            SELECT 'project'::text AS entity_type, p.id AS entity_id, p.id AS project_id,
                   p.title AS project_title, NULL::bigint AS version, p.revision AS snapshot_revision,
                   p.document_json
            FROM design_projects p
            WHERE p.user_id = $1
            UNION ALL
            SELECT 'version'::text AS entity_type, v.id AS entity_id, v.project_id,
                   p.title AS project_title, v.version, v.snapshot_revision, v.snapshot_json AS document_json
            FROM design_project_versions v
            JOIN design_projects p ON p.user_id = v.user_id AND p.id = v.project_id
            WHERE v.user_id = $1
        )
        SELECT entity_type, entity_id, project_id, project_title, version, snapshot_revision, document_json
        FROM entities e
        WHERE EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(e.document_json->'assetVersions') = 'array'
                     THEN e.document_json->'assetVersions' ELSE '[]'::jsonb END
            ) AS asset_version
            WHERE asset_version->'locator'->>'kind' = 'library-asset'
              AND asset_version->'locator'->>'libraryAssetId' = $2
        )
        ORDER BY entity_type, project_id, entity_id`,
        [userId, libraryAssetId],
    );
    return result.rows.map(entityFromRow);
}

async function readFileLibraryReferenceEntities(userId: string, libraryAssetId: string) {
    return (await readAllFileEntities(userId)).filter((entity) => collectDesignDocumentResourceReferences(entity.document).some((reference) => reference.locator.kind === "library-asset" && reference.locator.libraryAssetId === libraryAssetId));
}

async function readAllFileEntities(userId?: string): Promise<DesignDocumentEntity[]> {
    const database = await readJsonDataFile<DesignReferenceFileDatabase>("design-projects.json", EMPTY_FILE_DATABASE);
    if (database?.version !== 1 || !Array.isArray(database.projects) || !Array.isArray(database.versions) || !Array.isArray(database.receipts)) {
        throw new Error("design-projects.json 格式无效");
    }
    const titles = new Map(database.projects.filter((record) => !userId || record.userId === userId).map((record) => [record.project.id, record.project.title]));
    return [
        ...database.projects
            .filter((record) => !userId || record.userId === userId)
            .map((record) => ({
                entityType: "project" as const,
                entityId: record.project.id,
                projectId: record.project.id,
                projectTitle: record.project.title,
                snapshotRevision: nonNegativeInteger(record.project.revision, "revision"),
                document: storedDocument(record.project.document),
            })),
        ...database.versions
            .filter((record) => !userId || record.userId === userId)
            .map((record) => ({
                entityType: "version" as const,
                entityId: record.id,
                projectId: record.projectId,
                projectTitle: titles.get(record.projectId),
                version: positiveInteger(record.version, "version"),
                snapshotRevision: nonNegativeInteger(record.snapshotRevision, "snapshotRevision"),
                document: storedDocument(record.snapshot),
            })),
    ];
}

function entityFromRow(row: DesignReferenceRow): DesignDocumentEntity {
    return {
        entityType: row.entity_type,
        entityId: requiredText(row.entity_id, "entityId"),
        projectId: requiredText(row.project_id, "projectId"),
        ...(row.project_title ? { projectTitle: String(row.project_title) } : {}),
        ...(row.entity_type === "version" ? { version: positiveInteger(row.version, "version") } : {}),
        snapshotRevision: nonNegativeInteger(row.snapshot_revision, "snapshotRevision"),
        document: storedDocument(row.document_json),
    };
}

function storedDocument(value: unknown) {
    return migrateDesignDocument(typeof value === "string" ? JSON.parse(value) : value).document;
}

function locatorKey(locator: DesignStableResourceLocator) {
    return locator.kind === "storage-key" ? `storage:${locator.storageKey.length}:${locator.storageKey}` : `library:${locator.libraryAssetId.length}:${locator.libraryAssetId}`;
}

function normalizeStorageKey(value: unknown) {
    return typeof value === "string" ? value.trim().replace(/\\/g, "/").replace(/^\/+/, "") : "";
}

function requiredText(value: unknown, field: string) {
    if (typeof value !== "string" || !value.trim()) throw new Error(`Design reference ${field} 无效`);
    return value.trim();
}

function nonNegativeInteger(value: unknown, field: string) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) throw new Error(`Design reference ${field} 无效`);
    return number;
}

function positiveInteger(value: unknown, field: string) {
    const number = nonNegativeInteger(value, field);
    if (!number) throw new Error(`Design reference ${field} 无效`);
    return number;
}
