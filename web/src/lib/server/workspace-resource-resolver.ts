import type { WorkspaceStableResourceLocator } from "@/lib/creative-workspace";
import { getLibraryAsset } from "@/lib/server/library-asset-store";
import { getLocalMediaRegistration, type LocalMediaRegistration } from "@/lib/server/local-media-registry";

export type WorkspaceMediaType = "image" | "video" | "audio";
export type ResolvedWorkspaceMediaResource = Readonly<{
    url: string;
    cacheKey: string;
    expiresAt: null;
    mediaType: WorkspaceMediaType;
}>;
export type ValidatedWorkspaceMediaResource = Readonly<{
    locator: WorkspaceStableResourceLocator;
    storageKey: string;
    scope: LocalMediaRegistration["scope"];
    mediaType: WorkspaceMediaType;
    mimeType: string;
    bytes: number;
    originalName?: string;
    createdAt: string;
}>;

export class WorkspaceResourceResolutionError extends Error {
    constructor(
        message: string,
        readonly status: 400 | 404,
    ) {
        super(message);
        this.name = "WorkspaceResourceResolutionError";
    }
}

export async function resolveWorkspaceMediaResourceForUser(userId: string, input: unknown, allowedTypes: readonly WorkspaceMediaType[]): Promise<ResolvedWorkspaceMediaResource> {
    const validated = await validateWorkspaceMediaResourceForUser(userId, input, allowedTypes);
    const prefix = validated.scope === "generation" ? "/api/generation-log-assets/" : "/api/reference-assets/";
    return Object.freeze({
        url: `${prefix}${validated.storageKey.split("/").map(encodeURIComponent).join("/")}`,
        cacheKey: validated.locator.kind === "storage-key" ? `storage-key:${validated.locator.storageKey}` : `library-asset:${validated.locator.libraryAssetId}`,
        expiresAt: null,
        mediaType: validated.mediaType,
    });
}

export async function validateWorkspaceMediaResourceForUser(userId: string, input: unknown, allowedTypes: readonly WorkspaceMediaType[]): Promise<ValidatedWorkspaceMediaResource> {
    const locator = parseWorkspaceResourceLocator(input);
    const allowed = new Set(allowedTypes);
    if (!allowed.size) throw invalid("资源类型约束不能为空");
    const libraryMedia = locator.kind === "library-asset" ? await libraryMediaForUser(userId, locator.libraryAssetId, allowed) : undefined;
    const storageKey = locator.kind === "storage-key" ? locator.storageKey : libraryMedia!.storageKey;
    const registration = await getLocalMediaRegistration(storageKey);
    if (!isAccessibleRegistration(registration, userId, storageKey, allowed)) throw notFound();
    if (libraryMedia && libraryMedia.type !== registration.type) throw notFound();
    const resource = Object.freeze({
        locator,
        storageKey: registration.storageKey,
        scope: registration.scope,
        mediaType: registration.type,
        mimeType: registration.mimeType,
        bytes: registration.bytes,
        ...(registration.originalName ? { originalName: registration.originalName } : {}),
        createdAt: registration.createdAt,
    });
    return resource;
}

async function libraryMediaForUser(userId: string, libraryAssetId: string, allowedTypes: ReadonlySet<WorkspaceMediaType>) {
    const asset = await getLibraryAsset(userId, libraryAssetId);
    if (!asset || asset.kind === "text" || !allowedTypes.has(asset.kind)) throw notFound();
    const storageKey = asset.data.storageKey;
    if (!isSafeWorkspaceStorageKey(storageKey)) throw notFound();
    return { storageKey, type: asset.kind } as const;
}

export function parseWorkspaceResourceLocator(value: unknown): WorkspaceStableResourceLocator {
    const input = strictRecord(value, "资源 locator", ["kind", "storageKey", "libraryAssetId"]);
    if (input.kind === "storage-key") {
        assertExactKeys(input, "资源 locator", ["kind", "storageKey"]);
        if (!isSafeWorkspaceStorageKey(input.storageKey)) throw invalid("storageKey 必须是安全、稳定的资源标识");
        return Object.freeze({ kind: "storage-key", storageKey: input.storageKey });
    }
    if (input.kind === "library-asset") {
        assertExactKeys(input, "资源 locator", ["kind", "libraryAssetId"]);
        if (typeof input.libraryAssetId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(input.libraryAssetId)) throw invalid("libraryAssetId 无效");
        return Object.freeze({ kind: "library-asset", libraryAssetId: input.libraryAssetId });
    }
    throw invalid("资源 locator 类型无效");
}

export function isSafeWorkspaceStorageKey(value: unknown): value is string {
    if (typeof value !== "string" || !value || value.length > 1_024 || value.trim() !== value) return false;
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/i.test(value) || value.startsWith("/") || /^temporary\//i.test(value) || /[\\\0-\x1f?#]/.test(value) || value.includes("..")) return false;
    const segments = value.split("/");
    return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isAccessibleRegistration(registration: LocalMediaRegistration | null, userId: string, storageKey: string, allowedTypes: ReadonlySet<WorkspaceMediaType>): registration is LocalMediaRegistration & { type: WorkspaceMediaType } {
    return Boolean(
        registration &&
        registration.storageKey === storageKey &&
        registration.ownerUserId === userId &&
        registration.storageClass === "permanent" &&
        allowedTypes.has(registration.type) &&
        (registration.scope === "generation" || registration.scope === "reference") &&
        isSafeWorkspaceStorageKey(registration.storageKey),
    );
}

function strictRecord(value: unknown, label: string, allowedKeys: readonly string[]) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(`${label} 必须是对象`);
    const input = value as Record<string, unknown>;
    const unknownKey = Object.keys(input).find((key) => !allowedKeys.includes(key));
    if (unknownKey) throw invalid(`${label} 包含不支持的字段：${unknownKey}`);
    return input;
}

function assertExactKeys(input: Record<string, unknown>, label: string, allowedKeys: readonly string[]) {
    const unknownKey = Object.keys(input).find((key) => !allowedKeys.includes(key));
    if (unknownKey) throw invalid(`${label} 包含不支持的字段：${unknownKey}`);
}

function invalid(message: string) {
    return new WorkspaceResourceResolutionError(message, 400);
}

function notFound() {
    return new WorkspaceResourceResolutionError("工作台媒体资源不存在或无权访问", 404);
}
