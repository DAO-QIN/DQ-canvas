import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { canvasProjectError, getCanvasProjectForUser, updateCanvasProjectForUser } from "@/lib/server/canvas-project-service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    try {
        const project = await getCanvasProjectForUser(user.id, (await context.params).id);
        return NextResponse.json({ code: 0, data: { project }, msg: "OK" });
    } catch (error) {
        const known = canvasProjectError(error);
        if (known) return NextResponse.json({ code: known.status, data: known.details ? { receipt: known.details } : null, msg: known.message }, { status: known.status });
        throw error;
    }
}

export async function PATCH(request: Request, context: Context) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    try {
        const result = await updateCanvasProjectForUser(user.id, (await context.params).id, await request.json().catch(() => ({})));
        return NextResponse.json({ code: 0, data: result, msg: "Canvas project saved" });
    } catch (error) {
        const known = canvasProjectError(error);
        if (known) return NextResponse.json({ code: known.status, data: known.details ? { receipt: known.details } : null, msg: known.message }, { status: known.status });
        throw error;
    }
}
