import { sha256Hex } from "@/lib/sha256";
import type { CanvasProject } from "@/lib/canvas-project-contract";

export const CANVAS_SAVE_RECEIPT_STATUSES = ["applied", "replayed", "conflict"] as const;
export type CanvasSaveReceiptStatus = (typeof CANVAS_SAVE_RECEIPT_STATUSES)[number];

export type CanvasSaveRequest = Readonly<{
    project: CanvasProject;
    expectedRevision: number;
    batchId: string;
    fingerprint: string;
}>;

export type CanvasSaveEnvelope = Readonly<
    Partial<CanvasProject> & {
        project?: CanvasProject;
        expectedRevision?: number;
        batchId?: string;
        fingerprint?: string;
    }
>;

export type CanvasSaveReceipt = Readonly<{
    projectId: string;
    batchId: string;
    fingerprint: string;
    status: CanvasSaveReceiptStatus;
    baseRevision: number;
    resultRevision: number;
    affectedIds?: readonly string[];
    originalStatus?: Exclude<CanvasSaveReceiptStatus, "replayed">;
    error?: Readonly<{ code: string; message: string; retryable: boolean }>;
}>;

export function canvasProjectRevision(project: Pick<CanvasProject, "revision">) {
    const revision = Number(project.revision);
    return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

export function canvasSaveFingerprint(project: CanvasProject, expectedRevision: number) {
    return `sha256:${sha256Hex(stableCanvasProjectSnapshot(project, expectedRevision))}`;
}

export function canvasSaveBatchId(projectId: string, localVersion: number, fingerprint?: string) {
    const suffix = fingerprint ? `:${sha256Hex(fingerprint).slice(0, 16)}` : "";
    return `canvas-save:${projectId}:${Math.max(0, Math.floor(localVersion))}${suffix}`;
}

export function stableCanvasProjectSnapshot(project: CanvasProject, expectedRevision: number) {
    return stableStringify({
        project: {
            id: project.id,
            sourceHandoffId: project.sourceHandoffId,
            creativeConversationId: project.creativeConversationId,
            title: project.title,
            createdAt: project.createdAt,
            nodes: project.nodes,
            connections: project.connections,
            chatSessions: project.chatSessions,
            activeChatId: project.activeChatId,
            backgroundMode: project.backgroundMode,
            showImageInfo: project.showImageInfo,
            viewport: project.viewport,
        },
        expectedRevision,
    });
}

export function isCanvasSaveFingerprint(value: unknown): value is string {
    return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? "null" : stableStringify(item))).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
            .filter(([, nested]) => nested !== undefined)
            .toSorted(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}
