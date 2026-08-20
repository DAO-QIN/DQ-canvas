import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { restoreDesignProjectVersionForUser } from "@/lib/server/design-project-service";
import { designProjectErrorResponse, readDesignRequestJson, unauthenticatedDesignResponse } from "@/lib/server/design-project-route";

type Context = { params: Promise<{ id: string; versionId: string }> };

export async function POST(request: Request, context: Context) {
    const user = await getCurrentUser();
    if (!user) return unauthenticatedDesignResponse();
    try {
        const { id, versionId } = await context.params;
        const project = await restoreDesignProjectVersionForUser(user.id, id, versionId, await readDesignRequestJson(request));
        return NextResponse.json({ code: 0, data: { project }, msg: "画板版本已恢复" });
    } catch (error) {
        const response = designProjectErrorResponse(error);
        if (response) return response;
        throw error;
    }
}
