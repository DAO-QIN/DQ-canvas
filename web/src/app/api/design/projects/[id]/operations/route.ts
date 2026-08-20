import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { applyDesignOperationsForUser } from "@/lib/server/design-project-service";
import { designProjectErrorResponse, readDesignRequestJson, unauthenticatedDesignResponse } from "@/lib/server/design-project-route";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
    const user = await getCurrentUser();
    if (!user) return unauthenticatedDesignResponse();
    try {
        const result = await applyDesignOperationsForUser(user.id, (await context.params).id, await readDesignRequestJson(request));
        const effectiveStatus = result.receipt.status === "replayed" ? result.receipt.originalStatus : result.receipt.status;
        const status = effectiveStatus === "conflict" ? 409 : effectiveStatus === "rejected" ? 422 : 200;
        return NextResponse.json({ code: status === 200 ? 0 : status, data: result, msg: status === 409 ? "Design Ops 冲突" : status === 422 ? "Design Ops 未应用" : "Design Ops 已处理" }, { status });
    } catch (error) {
        const response = designProjectErrorResponse(error);
        if (response) return response;
        throw error;
    }
}
