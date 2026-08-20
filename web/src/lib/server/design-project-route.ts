import { NextResponse } from "next/server";

import { designProjectError, invalidDesignJsonError } from "@/lib/server/design-project-service";

export async function readDesignRequestJson(request: Request) {
    try {
        return await request.json();
    } catch {
        throw invalidDesignJsonError();
    }
}

export function designProjectErrorResponse(error: unknown) {
    const known = designProjectError(error);
    if (!known) return null;
    return NextResponse.json({ code: known.status, data: known.details ? { issues: known.details } : null, msg: known.message }, { status: known.status });
}

export function unauthenticatedDesignResponse() {
    return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
}
