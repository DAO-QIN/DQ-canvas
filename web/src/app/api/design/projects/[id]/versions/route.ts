import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { createDesignProjectVersionForUser, listDesignProjectVersionsForUser } from "@/lib/server/design-project-service";
import { designProjectErrorResponse, readDesignRequestJson, unauthenticatedDesignResponse } from "@/lib/server/design-project-route";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
    return handle(context, async (userId, id) => NextResponse.json({ code: 0, data: { versions: await listDesignProjectVersionsForUser(userId, id) }, msg: "OK" }));
}

export async function POST(request: Request, context: Context) {
    return handle(context, async (userId, id) => NextResponse.json({ code: 0, data: { version: await createDesignProjectVersionForUser(userId, id, await readDesignRequestJson(request)) }, msg: "画板版本已保存" }, { status: 201 }));
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
