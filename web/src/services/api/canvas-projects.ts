import type { CanvasProject, CanvasProjectSummary, CreateCanvasProjectInput } from "@/lib/canvas-project-contract";
import { canvasProjectRevision, canvasSaveBatchId, canvasSaveFingerprint, type CanvasSaveReceipt } from "@/lib/canvas-project-receipt";

export function listCanvasProjectSummaries(input: { page?: number; pageSize?: number } = {}) {
    const query = new URLSearchParams({ page: String(input.page || 1), pageSize: String(input.pageSize || 12) });
    return request<{ projects: CanvasProjectSummary[]; total: number; page: number; pageSize: number }>(`/api/canvas/projects?${query}`, { cache: "no-store" }).then((data) => ({
        items: data.projects,
        total: data.total,
        page: data.page,
        pageSize: data.pageSize,
    }));
}

export function getCanvasProject(id: string) {
    return request<{ project: CanvasProject }>(`/api/canvas/projects/${encodeURIComponent(id)}`, { cache: "no-store" }).then((data) => data.project);
}

export function createCanvasProject(input: CreateCanvasProjectInput) {
    return request<{ project: CanvasProject }>("/api/canvas/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }).then((data) => data.project);
}

export function saveCanvasProject(project: CanvasProject, input: { expectedRevision?: number; batchId?: string; fingerprint?: string } = {}) {
    const expectedRevision = input.expectedRevision ?? canvasProjectRevision(project);
    const fingerprint = input.fingerprint || canvasSaveFingerprint(project, expectedRevision);
    const batchId = input.batchId || canvasSaveBatchId(project.id, expectedRevision + 1, fingerprint);
    return request<{ project: CanvasProject; receipt: CanvasSaveReceipt }>(`/api/canvas/projects/${encodeURIComponent(project.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, expectedRevision, batchId, fingerprint }),
    });
}

export function deleteCanvasProjects(ids: string[]) {
    return request<{ deleted: number }>("/api/canvas/projects", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
}

async function request<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const payload = (await response.json().catch(() => ({}))) as { data?: T; msg?: string; error?: string; code?: number };
    if (!response.ok || !payload.data) {
        const error = new Error(payload.msg || payload.error || "画布项目请求失败") as Error & { status?: number; data?: unknown };
        error.status = response.status;
        error.data = payload.data;
        throw error;
    }
    return payload.data;
}
