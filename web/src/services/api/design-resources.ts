import type { DesignResourceResolver, ResolvedDesignResource } from "@/lib/design";

type ApiEnvelope = { code?: number; data?: unknown; msg?: string };

export class DesignResourceRequestError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly details?: unknown,
    ) {
        super(message);
        this.name = "DesignResourceRequestError";
    }
}

export const resolveDesignResource: DesignResourceResolver = async (locator, options) => {
    let response: Response;
    try {
        response = await fetch("/api/design/resources/resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ locator, purpose: options.purpose }),
            cache: "no-store",
        });
    } catch (error) {
        throw new DesignResourceRequestError(error instanceof Error ? error.message : "无法连接画板资源服务", 0);
    }

    const payload = (await response.json().catch(() => ({}))) as ApiEnvelope;
    if (!response.ok) throw new DesignResourceRequestError(payload.msg || "画板资源解析失败", response.status, payload.data);
    const resource = runtimeResource(payload.data);
    if (!resource) throw new DesignResourceRequestError(payload.msg || "画板资源响应无效", response.status, payload.data);
    return resource;
};

function runtimeResource(value: unknown): ResolvedDesignResource | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const input = value as Record<string, unknown>;
    if (typeof input.url !== "string" || !input.url.trim() || typeof input.cacheKey !== "string" || !input.cacheKey.trim()) return null;
    if (input.expiresAt !== null && typeof input.expiresAt !== "string") return null;
    return { url: input.url, cacheKey: input.cacheKey, expiresAt: input.expiresAt };
}
