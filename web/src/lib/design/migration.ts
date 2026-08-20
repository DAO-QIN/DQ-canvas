import { DESIGN_SCHEMA_VERSION } from "./limits";
import type { DesignDocument } from "./schema";
import { DesignDocumentValidationError, parseDesignDocumentV1 } from "./validation";

export type DesignDocumentMigrationResult = {
    document: DesignDocument;
    sourceVersion: number;
    targetVersion: typeof DESIGN_SCHEMA_VERSION;
    steps: string[];
};

/** Read entrypoint. New legacy migrations must be explicit cases in this registry. */
export function migrateDesignDocument(value: unknown): DesignDocumentMigrationResult {
    if (!value || typeof value !== "object" || Array.isArray(value)) return { document: parseDesignDocumentV1(value), sourceVersion: DESIGN_SCHEMA_VERSION, targetVersion: DESIGN_SCHEMA_VERSION, steps: [] };
    const version = (value as Record<string, unknown>).schemaVersion;
    if (!Number.isSafeInteger(version)) throw new DesignDocumentValidationError({ code: "UNSUPPORTED_VERSION", path: "$.schemaVersion", message: "Design Document 缺少有效版本号" });
    if (version !== DESIGN_SCHEMA_VERSION) throw new DesignDocumentValidationError({ code: "UNSUPPORTED_VERSION", path: "$.schemaVersion", message: `不支持 Design Document v${String(version)}；当前版本为 v${DESIGN_SCHEMA_VERSION}` });
    return { document: parseDesignDocumentV1(value), sourceVersion: version, targetVersion: DESIGN_SCHEMA_VERSION, steps: [] };
}

export function serializeDesignDocument(document: DesignDocument) {
    return JSON.stringify(parseDesignDocumentV1(document));
}
