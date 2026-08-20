import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { deleteDesignProjectForUser, getDesignProjectForUser, updateDesignProjectForUser } from "@/lib/server/design-project-service";
import { designProjectErrorResponse, readDesignRequestJson, unauthenticatedDesignResponse } from "@/lib/server/design-project-route";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
    return handle(context, async (userId, id) => NextResponse.json({ code: 0, data: { project: await getDesignProjectForUser(userId, id) }, msg: "OK" }));
}

export async function PATCH(request: Request, context: Context) {
    return handle(context, async (userId, id) => NextResponse.json({ code: 0, data: { project: await updateDesignProjectForUser(userId, id, await readDesignRequestJson(request)) }, msg: "画板项目已保存" }));
}

export async function DELETE(request: Request, context: Context) {
    return handle(context, async (userId, id) => NextResponse.json({ code: 0, data: { deleted: await deleteDesignProjectForUser(userId, id, await readDesignRequestJson(request)) }, msg: "画板项目已删除" }));
}

async function handle(context: Context, action: (userId: string, id: string) => Promise<NextResponse>) {
    const user = await getCurrentUser();
    if (!user) return unauthenticatedDesignResponse();
    try {
        return await action(user.id, (await context.params).id);
    } catch (error) {
        const response = designProjectErrorResponse(error);
        if (response) return response;
        throw error;
    }
}
