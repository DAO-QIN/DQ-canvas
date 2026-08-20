import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import type { WorkspaceHandoffReceipt } from "@/lib/creative-workspace";
import { executeWorkspaceHandoffForUser, workspaceHandoffError } from "@/lib/server/workspace-handoff-service";

export async function POST(request: Request) {
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ code: 400, data: null, msg: "请求 JSON 无效" }, { status: 400 });
    }

    try {
        const receipt = await executeWorkspaceHandoffForUser(user.id, body);
        const status = receiptStatus(receipt);
        return NextResponse.json(
            {
                code: status === 200 ? 0 : status,
                data: { receipt },
                msg: receiptMessage(receipt),
            },
            { status },
        );
    } catch (error) {
        const known = workspaceHandoffError(error);
        if (known) return NextResponse.json({ code: known.status, data: known.details ? { receipt: known.details } : null, msg: known.message }, { status: known.status });
        throw error;
    }
}

function receiptStatus(receipt: WorkspaceHandoffReceipt) {
    const effective = receipt.status === "replayed" ? receipt.originalStatus || "applied" : receipt.status;
    return effective === "applied" ? 200 : effective === "conflict" ? 409 : 422;
}

function receiptMessage(receipt: WorkspaceHandoffReceipt) {
    if (receipt.status === "replayed") {
        if (receipt.originalStatus === "conflict") return receipt.error?.message || "素材交接冲突已重放";
        if (receipt.originalStatus === "rejected") return receipt.error?.message || "素材交接失败已重放";
        return "素材已交接，此次请求为安全重放";
    }
    if (receipt.status === "conflict") return receipt.error?.message || "素材交接发生冲突";
    if (receipt.status === "rejected") return receipt.error?.message || "素材交接未应用";
    return "素材已交接";
}
