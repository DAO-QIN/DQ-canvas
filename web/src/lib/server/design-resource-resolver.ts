import type { ResolvedDesignResource } from "@/lib/design";
import { resolveWorkspaceMediaResourceForUser, WorkspaceResourceResolutionError } from "@/lib/server/workspace-resource-resolver";

export class DesignResourceResolutionError extends Error {
    constructor(
        message: string,
        readonly status: 400 | 404,
    ) {
        super(message);
        this.name = "DesignResourceResolutionError";
    }
}

export async function resolveDesignResourceForUser(userId: string, input: unknown): Promise<ResolvedDesignResource> {
    try {
        const resolved = await resolveWorkspaceMediaResourceForUser(userId, input, ["image"]);
        return { url: resolved.url, cacheKey: resolved.cacheKey, expiresAt: resolved.expiresAt };
    } catch (error) {
        if (error instanceof WorkspaceResourceResolutionError) throw new DesignResourceResolutionError(error.status === 404 ? "画板图片资源不存在或无权访问" : error.message, error.status);
        throw error;
    }
}
