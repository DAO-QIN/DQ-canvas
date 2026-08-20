import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { createDesignProjectForUser, listDesignProjectsForUser } from "@/lib/server/design-project-service";
import { designProjectErrorResponse, readDesignRequestJson, unauthenticatedDesignResponse } from "@/lib/server/design-project-route";

export async function GET(request: Request) {
    const user = await getCurrentUser();
    if (!user) return unauthenticatedDesignResponse();
    try {
        const params = new URL(request.url).searchParams;
        const result = await listDesignProjectsForUser(user.id, {
            page: Math.max(1, Number(params.get("page")) || 1),
            pageSize: Math.max(1, Math.min(100, Number(params.get("pageSize")) || 20)),
            status: params.get("status") || undefined,
        });
        return NextResponse.json({ code: 0, data: { projects: result.items, total: result.total, page: result.page, pageSize: result.pageSize }, msg: "OK" });
    } catch (error) {
        const response = designProjectErrorResponse(error);
        if (response) return response;
        throw error;
    }
}

export async function POST(request: Request) {
    const user = await getCurrentUser();
    if (!user) return unauthenticatedDesignResponse();
    try {
        const project = await createDesignProjectForUser(user.id, await readDesignRequestJson(request));
        return NextResponse.json({ code: 0, data: { project }, msg: "画板项目已创建" }, { status: 201 });
    } catch (error) {
        const response = designProjectErrorResponse(error);
        if (response) return response;
        throw error;
    }
}
