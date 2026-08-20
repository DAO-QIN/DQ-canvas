import type { DesignOperationBatch, DesignOperationReceipt, DesignProject, DesignProjectSummary, DesignProjectSummaryPage } from "@/lib/design";

type ApiEnvelope<T> = { code?: number; data?: T | null; msg?: string };

export class DesignProjectRequestError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly details?: unknown,
    ) {
        super(message);
        this.name = "DesignProjectRequestError";
    }
}

export function listDesignProjects(input: { page?: number; pageSize?: number; status?: "active" | "archived" } = {}): Promise<DesignProjectSummaryPage> {
    const query = new URLSearchParams({ page: String(input.page || 1), pageSize: String(input.pageSize || 12) });
    if (input.status) query.set("status", input.status);
    return request<{ projects: DesignProjectSummary[]; total: number; page: number; pageSize: number }>(`/api/design/projects?${query}`, { cache: "no-store" }).then((data) => ({
        items: data.projects,
        total: data.total,
        page: data.page,
        pageSize: data.pageSize,
    }));
}

export function getDesignProject(id: string) {
    return request<{ project: DesignProject }>(`/api/design/projects/${encodeURIComponent(id)}`, { cache: "no-store" }).then((data) => data.project);
}

export function createDesignProject(input: { title: string; description?: string }) {
    return request<{ project: DesignProject }>("/api/design/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    }).then((data) => data.project);
}

export function deleteDesignProject(id: string, expectedRevision: number) {
    return request<{ deleted: boolean }>(`/api/design/projects/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision }),
    }).then((data) => data.deleted);
}

export function applyDesignOperations(id: string, batch: DesignOperationBatch) {
    return request<{ project: DesignProject; receipt: DesignOperationReceipt }>(`/api/design/projects/${encodeURIComponent(id)}/operations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch),
    });
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
        response = await fetch(url, init);
    } catch (error) {
        throw new DesignProjectRequestError(error instanceof Error ? error.message : "无法连接画板项目服务", 0);
    }
    const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
    if (!response.ok || payload.data == null) throw new DesignProjectRequestError(payload.msg || "画板项目请求失败", response.status, payload.data);
    return payload.data;
}

export function isDesignProjectConflict(error: unknown): error is DesignProjectRequestError {
    return error instanceof DesignProjectRequestError && error.status === 409;
}
