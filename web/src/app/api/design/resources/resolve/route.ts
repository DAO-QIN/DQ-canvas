import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { DesignResourceResolutionError, resolveDesignResourceForUser } from "@/lib/server/design-resource-resolver";
import { unauthenticatedDesignResponse } from "@/lib/server/design-project-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PURPOSES = new Set(["editor", "thumbnail", "export"]);

export async function POST(request: Request) {
    const user = await getCurrentUser();
    if (!user) return unauthenticatedDesignResponse();

    try {
        const input = await readInput(request);
        const resource = await resolveDesignResourceForUser(user.id, input.locator);
        return NextResponse.json({ code: 0, data: resource, msg: "OK" });
    } catch (error) {
        if (error instanceof DesignResourceResolutionError) {
            return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        }
        throw error;
    }
}

async function readInput(request: Request) {
    let value: unknown;
    try {
        value = await request.json();
    } catch {
        throw invalidRequest("请求 JSON 无效");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidRequest("请求体必须是对象");
    const input = value as Record<string, unknown>;
    const unknownKey = Object.keys(input).find((key) => key !== "locator" && key !== "purpose");
    if (unknownKey) throw invalidRequest(`请求包含不支持的字段：${unknownKey}`);
    if (typeof input.purpose !== "string" || !PURPOSES.has(input.purpose)) throw invalidRequest("purpose 必须是 editor、thumbnail 或 export");
    return { locator: input.locator, purpose: input.purpose };
}

function invalidRequest(message: string) {
    return new DesignResourceResolutionError(message, 400);
}
