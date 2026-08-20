import type { DesignAssetVersion, DesignStableResourceLocator } from "./schema";

/** Runtime-only result. Its URL must never be merged back into Design Document JSON. */
export type ResolvedDesignResource = {
    url: string;
    expiresAt: string | null;
    cacheKey: string;
};

export type DesignResourceResolver = (locator: DesignStableResourceLocator, options: { purpose: "editor" | "thumbnail" | "export" }) => Promise<ResolvedDesignResource>;

export async function resolveDesignAssetVersion(version: DesignAssetVersion, resolver: DesignResourceResolver, purpose: "editor" | "thumbnail" | "export") {
    const resolved = await resolver(structuredClone(version.locator), { purpose });
    if (!resolved || typeof resolved.url !== "string" || !resolved.url.trim()) throw new Error(`资源解析失败：${version.id}`);
    return resolved;
}

export function designResourceCacheKey(locator: DesignStableResourceLocator) {
    return locator.kind === "storage-key" ? `storage-key:${locator.storageKey}` : `library-asset:${locator.libraryAssetId}`;
}
