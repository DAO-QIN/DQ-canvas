import type { WorkspaceHandoffReceipt, WorkspaceHandoffRequest } from "@/lib/creative-workspace";

type ApiEnvelope = { code?: number; data?: { receipt?: WorkspaceHandoffReceipt } | null; msg?: string };

export class WorkspaceHandoffRequestError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly receipt?: WorkspaceHandoffReceipt,
    ) {
        super(message);
        this.name = "WorkspaceHandoffRequestError";
    }
}

export async function executeWorkspaceHandoff(request: WorkspaceHandoffRequest) {
    let response: Response;
    try {
        response = await fetch("/api/workspace/handoffs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
        });
    } catch (error) {
        throw new WorkspaceHandoffRequestError(error instanceof Error ? error.message : "无法连接素材交接服务", 0);
    }
    const payload = (await response.json().catch(() => ({}))) as ApiEnvelope;
    const receipt = payload.data?.receipt;
    if (!response.ok || !receipt) throw new WorkspaceHandoffRequestError(payload.msg || "素材交接失败", response.status, receipt);
    return receipt;
}

export function workspaceHandoffReceiptFromError(error: unknown) {
    return error instanceof WorkspaceHandoffRequestError ? error.receipt : undefined;
}
