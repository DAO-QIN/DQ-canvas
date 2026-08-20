import { NextResponse } from "next/server";

import { normalizeBackgroundRemovalOptions } from "@/lib/background-removal-options";
import { backgroundRemovalProgressSnapshot, resolveBackgroundRemovalProgressStage } from "@/lib/background-removal-progress";
import { getCurrentUser } from "@/lib/auth/session";
import { parseSurfaceBinding, type SurfaceBinding } from "@/lib/creative-workspace/surface-binding";
import { listStoredGenerationTaskRecords, type StoredGenerationTaskRecord } from "@/lib/server/generation-task-store";
import { getLocalMediaRegistrations, type LocalMediaRegistration } from "@/lib/server/local-media-registry";
import { localMediaStorageKeyFromValue } from "@/lib/server/local-media-references";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = ["pending", "running", "paused"] as const;

/**
 * Returns the current user's generation tasks in the public shape used by the
 * creative workspace task indicator. The storage record itself is never exposed: payloads
 * can contain provider details and internal prompts.
 */
export async function GET(request: Request) {
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });

    const params = new URL(request.url).searchParams;
    const projectId = clean(params.get("projectId"), 160);
    const surface = normalizeTaskSurface(params.get("surface"));
    if (!surface) return NextResponse.json({ code: 400, data: null, msg: "创作入口不正确" }, { status: 400 });

    const requestedLimit = Number(params.get("limit"));
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.floor(requestedLimit))) : 50;
    const activeOnly = params.get("activeOnly") !== "false";
    const result = await listStoredGenerationTaskRecords({
        page: 1,
        pageSize: limit,
        surface,
        projectId: projectId || undefined,
        userId: user.id,
        statuses: activeOnly ? [...ACTIVE_STATUSES] : undefined,
        includeAll: false,
    });
    const registrations = await imageResultRegistrations(result.items);
    const tasks = result.items.map((record) => normalizeCreativeWorkspaceTask(record, registrations));
    return NextResponse.json({ code: 0, data: { tasks, total: result.total }, msg: "OK" });
}

export type CreativeWorkspaceGenerationTask = ReturnType<typeof normalizeCreativeWorkspaceTask>;
export type CanvasGenerationTask = CreativeWorkspaceGenerationTask;

function normalizeCreativeWorkspaceTask(record: StoredGenerationTaskRecord, registrations: ReadonlyMap<string, LocalMediaRegistration>) {
    const payload = record.payload || {};
    const config = object(payload.config);
    const upstream = object(payload.upstream);
    const billing = object(payload.billing);
    const sourceNodeId = firstText(payload.sourceNodeId, payload.nodeId);
    const sourceElementId = firstText(payload.sourceElementId);
    const sourceAssetVersionId = firstText(payload.sourceAssetVersionId);
    // A source node can fan out to several result nodes. Keep the result
    // target separate so task recovery never writes progress to the source.
    const targetNodeId = firstText(payload.targetNodeId, payload.nodeId, payload.sourceNodeId);
    const backgroundRemovalProgress = record.type === "image_process" ? backgroundRemovalProgressSnapshot(resolveBackgroundRemovalProgressStage(payload.progressStage, record.status), payload.progress) : undefined;
    const progress = backgroundRemovalProgress?.progress ?? normalizeProgress(payload.progress, object(payload.metadata).progress, upstream.progress, payload.taskProgress);
    const stage = backgroundRemovalProgress?.label || firstText(payload.stage, payload.taskStage, upstream.stage, record.lastUpstreamStatus, record.executionPhase);
    const prompt = firstText(payload.prompt, payload.title, payload.name);
    const model = firstText(payload.model, payload.logicalModelId, config.model, config.imageModel, config.videoModel, config.audioModel, upstream.model);
    const kind = payload.kind === "edit" || payload.kind === "generation" ? payload.kind : undefined;
    const provider = upstream.provider === "openai" || upstream.provider === "seedance" || upstream.provider === "generation" ? upstream.provider : record.type === "video" ? "generation" : undefined;
    const pointsCost = billingPointsCost(payload, billing, upstream);
    const backgroundRemovalOptions = record.type === "image_process" ? safeBackgroundRemovalOptions(payload.options) : undefined;
    const binding = safeTaskBinding(record, payload.binding);
    const imageResult = safeImageResult(record, registrations);
    return {
        id: record.id,
        type: record.type,
        status: normalizeStatus(record.status),
        progress,
        stage: stage || undefined,
        prompt: prompt.slice(0, 240) || undefined,
        model: model || undefined,
        kind,
        provider,
        pollPath: record.type === "video" ? (provider === "generation" ? "server" : firstText(upstream.pollPath) || undefined) : undefined,
        serverTaskId: record.type === "video" && provider === "generation" ? record.id : undefined,
        durationSeconds: positiveNumber(payload.durationSeconds, upstream.durationSeconds),
        sourceStorageKey: record.type === "image_process" ? firstText(payload.sourceStorageKey) || undefined : undefined,
        options: backgroundRemovalOptions,
        optionsHash: record.type === "image_process" ? firstText(payload.optionsHash) || undefined : undefined,
        progressStage: backgroundRemovalProgress?.stage,
        projectId: record.projectId,
        sourceNodeId: sourceNodeId || undefined,
        sourceElementId: sourceElementId || undefined,
        sourceAssetVersionId: sourceAssetVersionId || undefined,
        targetNodeId: targetNodeId || undefined,
        clientRequestId: record.clientRequestId,
        attemptNo: record.attemptNo,
        quality: cleanTaskText(config.quality),
        size: cleanTaskText(config.size),
        binding,
        imageResult,
        executionPhase: record.executionPhase,
        lastUpstreamStatus: record.lastUpstreamStatus,
        error: firstText(payload.error, object(payload.result).error) || undefined,
        billing: pointsCost === undefined ? undefined : { pointsCost, refunded: Boolean(billing.refunded) },
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

async function imageResultRegistrations(records: readonly StoredGenerationTaskRecord[]) {
    const keys = Array.from(new Set(records.map(imageResultStorageKey).filter(Boolean)));
    if (!keys.length) return new Map<string, LocalMediaRegistration>();
    const registrations = await getLocalMediaRegistrations(keys);
    return new Map(registrations.map((registration) => [registration.storageKey, registration]));
}

function safeImageResult(record: StoredGenerationTaskRecord, registrations: ReadonlyMap<string, LocalMediaRegistration>) {
    if ((record.type !== "image" && record.type !== "image_process") || record.status !== "success") return undefined;
    const result = object(record.payload.result);
    const storageKey = imageResultStorageKey(record);
    const registration = registrations.get(storageKey);
    const mimeType = registration?.mimeType;
    const width = positiveInteger(result.width);
    const height = positiveInteger(result.height);
    if (
        !storageKey ||
        !registration ||
        registration.ownerUserId !== record.userId ||
        registration.storageClass !== "permanent" ||
        registration.type !== "image" ||
        (mimeType !== "image/png" && mimeType !== "image/jpeg" && mimeType !== "image/webp") ||
        !width ||
        !height
    )
        return undefined;
    const bytes = positiveInteger(registration.bytes || result.bytes);
    return { storageKey, mimeType, width, height, ...(bytes ? { bytes } : {}) };
}

function imageResultStorageKey(record: StoredGenerationTaskRecord) {
    if ((record.type !== "image" && record.type !== "image_process") || record.status !== "success") return "";
    const result = object(record.payload.result);
    if (record.type === "image_process" && typeof result.storageKey === "string") return result.storageKey.trim();
    for (const value of [result.serverUrl, result.dataUrl, result.remoteUrl]) {
        if (typeof value !== "string") continue;
        const storageKey = localMediaStorageKeyFromValue(value);
        if (storageKey) return storageKey;
    }
    return "";
}

function safeTaskBinding(record: StoredGenerationTaskRecord, value: unknown): SurfaceBinding | undefined {
    const candidate = record.binding || value;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
    try {
        const binding = parseSurfaceBinding(candidate);
        if (binding.surface !== record.surface || binding.projectId !== record.projectId) return undefined;
        return binding;
    } catch {
        return undefined;
    }
}

function safeBackgroundRemovalOptions(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    try {
        return normalizeBackgroundRemovalOptions(value);
    } catch {
        return undefined;
    }
}

function billingPointsCost(payload: Record<string, unknown>, billing: Record<string, unknown>, upstream: Record<string, unknown>) {
    const hasBillingRecord = Boolean(firstText(billing.pointsRecordId, upstream.pointsRecordId, payload.pointsRecordId));
    if (!hasBillingRecord) return undefined;
    for (const value of [billing.pointsCost, upstream.pointsCost, payload.pointsCost]) {
        const points = Number(value);
        if (Number.isFinite(points) && points >= 0) return points;
    }
    return undefined;
}

function normalizeStatus(status: StoredGenerationTaskRecord["status"]): "queued" | "running" | "paused" | "succeeded" | "failed" | "cancelled" {
    if (status === "pending") return "queued";
    if (status === "running") return "running";
    if (status === "paused") return "paused";
    if (status === "success") return "succeeded";
    if (status === "cancelled") return "cancelled";
    return "failed";
}

function normalizeProgress(...values: unknown[]) {
    for (const value of values) {
        const number = Number(value);
        if (!Number.isFinite(number) || number < 0) continue;
        if (number <= 1) return Math.round(number * 100);
        if (number <= 100) return Math.round(number);
    }
    return undefined;
}

function object(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function firstText(...values: unknown[]) {
    return values.map((value) => (typeof value === "string" ? value.trim() : "")).find(Boolean) || "";
}

function positiveNumber(...values: unknown[]) {
    for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number) && number > 0) return number;
    }
    return undefined;
}

function positiveInteger(value: unknown) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function cleanTaskText(value: unknown) {
    return typeof value === "string" ? value.trim().slice(0, 160) || undefined : undefined;
}

function clean(value: string | null, max: number) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeTaskSurface(value: string | null): "canvas" | "design" | null {
    const surface = clean(value, 40) || "canvas";
    return surface === "canvas" || surface === "design" ? surface : null;
}
