import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { CreativeRuntimeServiceError, referenceExistingAssetForUser } from "@/lib/server/creative-runtime-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    try {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
        const id = typeof body.id === "string" ? body.id.trim() : "";
        const type = body.type === "image" || body.type === "video" || body.type === "audio" ? body.type : "";
        const url = typeof body.url === "string" ? body.url.trim() : "";
        const mimeType = typeof body.mimeType === "string" ? body.mimeType.trim() : undefined;
        const title = typeof body.title === "string" ? body.title.trim() : undefined;
        if (!conversationId || !id || !type || !url) throw new CreativeRuntimeServiceError("引用素材参数不完整", 400);
        const asset = await referenceExistingAssetForUser(user.id, user.role, conversationId, { id, type, url, mimeType, title });
        return NextResponse.json({ code: 0, data: { asset }, msg: "素材已引用" });
    } catch (error) {
        if (error instanceof CreativeRuntimeServiceError) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        throw error;
    }
}
