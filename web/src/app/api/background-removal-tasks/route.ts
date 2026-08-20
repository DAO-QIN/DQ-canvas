import { createHash, randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/auth/request";
import { isAuthInputError } from "@/lib/auth/store";
import { getCurrentUser } from "@/lib/auth/session";
import { BackgroundRemovalOptionsValidationError, normalizeBackgroundRemovalOptions, serializeBackgroundRemovalOptions } from "@/lib/background-removal-options";
import type { DesignSurfaceBinding } from "@/lib/creative-workspace";
import { getCanvasProjectForUser } from "@/lib/server/canvas-project-service";
import { getDesignProjectForUser } from "@/lib/server/design-project-service";
import { createBackgroundRemovalTaskWithResult, publicBackgroundRemovalTask, type BackgroundRemovalTask } from "@/lib/server/background-removal-task-store";
import {
    getActiveStoredGenerationTaskBySourceIdentity,
    getActiveStoredGenerationTaskBySourceNode,
    getLatestStoredGenerationTaskBySourceIdentity,
    getLatestStoredGenerationTaskBySourceNode,
    getStoredGenerationTaskByRequest,
} from "@/lib/server/generation-task-store";
import { isBackgroundRemovalProviderEnabled } from "@/lib/server/background-removal-provider";
import { readRegisteredImageBytes, RegisteredMediaReadError } from "@/lib/server/registered-media-reader";
import { validateWorkspaceMediaResourceForUser } from "@/lib/server/workspace-resource-resolver";
import { checkGenerationRateLimit, rateLimitHeaders } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BackgroundRemovalRequestBody = {
    sourceStorageKey?: unknown;
    options?: unknown;
    context?: { surface?: unknown; projectId?: unknown; sourceNodeId?: unknown; sourceElementId?: unknown; sourceAssetVersionId?: unknown; sourceLocator?: unknown; clientRequestId?: unknown };
};

export async function POST(request: Request) {
    const user = await getCurrentUser(request);
    if (!user) return jsonError(401, "请先登录");

    let body: BackgroundRemovalRequestBody;
    try {
        body = await readJsonBody<BackgroundRemovalRequestBody>(request, 1 * 1024 * 1024);
    } catch (error) {
        if (isAuthInputError(error)) return jsonError(error.status, error.message);
        throw error;
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "抠图请求必须是对象");
    const requestedSourceStorageKey = text(body.sourceStorageKey, 700);
    const context = body.context && typeof body.context === "object" ? body.context : {};
    const surface = context.surface === "design" ? "design" : "canvas";
    const projectId = text(context.projectId, 160);
    const sourceNodeId = text(context.sourceNodeId, 160);
    const sourceElementId = text(context.sourceElementId, 160);
    const sourceAssetVersionId = text(context.sourceAssetVersionId, 160);
    if (surface === "canvas" && !requestedSourceStorageKey) return jsonError(400, "缺少图片素材标识");
    if (!projectId) return jsonError(400, surface === "design" ? "抠图必须提供画板项目" : "抠图必须提供画布项目和源节点");
    if (surface === "canvas" && !sourceNodeId) return jsonError(400, "抠图必须提供画布项目和源节点");
    if (surface === "design" && (!sourceElementId || !sourceAssetVersionId)) return jsonError(400, "抠图必须提供源图片元素和版本");

    let options;
    try {
        options = normalizeBackgroundRemovalOptions(body.options);
    } catch (error) {
        if (error instanceof BackgroundRemovalOptionsValidationError) return jsonError(400, error.message);
        throw error;
    }
    if (options.outputMode !== "transparent") return jsonError(400, "抠图仅支持透明 PNG 输出");
    const optionsHash = createHash("sha256").update(serializeBackgroundRemovalOptions(options)).digest("hex");

    let sourceStorageKey = requestedSourceStorageKey;
    let sourceIdentity = "";
    let sourceLocator: unknown = context.sourceLocator;
    let designBinding: DesignSurfaceBinding | undefined;
    if (surface === "canvas") {
        let project: Awaited<ReturnType<typeof getCanvasProjectForUser>>;
        try {
            project = await getCanvasProjectForUser(user.id, projectId);
        } catch (error) {
            const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) || 404 : 404;
            return jsonError(status === 404 ? 404 : 400, "画布项目不存在");
        }
        const sourceNode = project.nodes.find((node) => node.id === sourceNodeId);
        if (!sourceNode || sourceNode.metadata?.storageKey !== sourceStorageKey) return jsonError(404, "图片素材不属于当前画布");
        sourceIdentity = `canvas-node:${projectId}:${sourceNodeId}:${sourceStorageKey}`;
    } else {
        let project: Awaited<ReturnType<typeof getDesignProjectForUser>>;
        try {
            project = await getDesignProjectForUser(user.id, projectId);
        } catch (error) {
            const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) || 404 : 404;
            return jsonError(status === 404 ? 404 : 400, "画板项目不存在");
        }
        const element = project.document.elements.find((candidate) => candidate.id === sourceElementId);
        if (!element || element.kind !== "image" || element.assetVersionId !== sourceAssetVersionId) return jsonError(404, "图片元素或版本不属于当前画板");
        const version = project.document.assetVersions.find((candidate) => candidate.id === sourceAssetVersionId);
        if (!version) return jsonError(404, "图片版本不存在");
        try {
            const resolved = await validateWorkspaceMediaResourceForUser(user.id, version.locator, ["image"]);
            if (requestedSourceStorageKey && resolved.storageKey !== requestedSourceStorageKey) return jsonError(404, "图片素材与画板版本不一致");
            sourceStorageKey = resolved.storageKey;
            sourceLocator = version.locator;
        } catch (error) {
            const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) || 404 : 404;
            return jsonError(status === 400 ? 400 : 404, "画板图片资源不存在或无权访问");
        }
        sourceIdentity = `design-element:${projectId}:${sourceElementId}:${sourceAssetVersionId}`;
        designBinding = {
            surface: "design",
            projectId,
            baseRevision: project.document.revision,
            target: element.frameId ? { scope: "frame", frameId: element.frameId } : { scope: "workspace" },
            elementId: sourceElementId,
            assetVersionId: sourceAssetVersionId,
        };
    }

    const clientRequestId = scopedClientRequestId(text(context.clientRequestId, 160) || `${surface}-background-removal`, projectId, sourceIdentity, sourceStorageKey, optionsHash);
    const existing = await getStoredGenerationTaskByRequest<BackgroundRemovalTask>("image_process", user.id, clientRequestId);
    const existingMatchesSourceContext = Boolean(existing && existing.projectId === projectId && taskMatchesSource(existing, surface, sourceIdentity, sourceNodeId));
    if (existingMatchesSourceContext && existing && isReusableTask(existing, sourceStorageKey, optionsHash)) return jsonTask(existing);
    const activeBySource =
        surface === "design"
            ? await getActiveStoredGenerationTaskBySourceIdentity<BackgroundRemovalTask>("image_process", user.id, sourceIdentity, projectId)
            : await getActiveStoredGenerationTaskBySourceNode<BackgroundRemovalTask>("image_process", user.id, sourceNodeId, projectId);
    if (activeBySource) {
        if (isReusableTask(activeBySource, sourceStorageKey, optionsHash)) return jsonTask(activeBySource);
        return jsonError(409, surface === "design" ? "该源图片已有其他抠图任务，请等待当前任务完成" : "该源节点已有其他抠图任务，请等待当前任务完成");
    }
    const latestBySource =
        surface === "design"
            ? await getLatestStoredGenerationTaskBySourceIdentity<BackgroundRemovalTask>("image_process", user.id, sourceIdentity, projectId)
            : await getLatestStoredGenerationTaskBySourceNode<BackgroundRemovalTask>("image_process", user.id, sourceNodeId, projectId);
    if (latestBySource && isReusableTask(latestBySource, sourceStorageKey, optionsHash)) return jsonTask(latestBySource);

    const rate = await checkGenerationRateLimit(user.id, request, "image_process");
    if (!rate.allowed) return NextResponse.json({ code: 429, data: null, msg: "抠图请求过于频繁，请稍后重试" }, { status: 429, headers: rateLimitHeaders(rate) });
    if (!isBackgroundRemovalProviderEnabled()) return jsonError(503, "抠图服务未启用");

    let source: Awaited<ReturnType<typeof readRegisteredImageBytes>>;
    try {
        source = await readRegisteredImageBytes({ storageKey: sourceStorageKey, ownerUserId: user.id });
    } catch (error) {
        if (error instanceof RegisteredMediaReadError) return jsonError(error.status, error.message);
        throw error;
    }
    if (surface === "canvas" && source.registration.projectId && source.registration.projectId !== projectId) return jsonError(404, "图片素材不属于当前画布");

    const inserted = await createBackgroundRemovalTaskWithResult({
        operation: "remove-background",
        sourceStorageKey,
        ...(surface === "canvas" ? { sourceNodeId } : {}),
        sourceIdentity,
        ...(surface === "design" ? { sourceElementId, sourceAssetVersionId, sourceLocator } : {}),
        sourceMimeType: source.mimeType,
        sourceBytes: source.bytes.length,
        sourceWidth: source.width,
        sourceHeight: source.height,
        options,
        optionsHash,
        model: options.model,
        providerAttempt: 0,
        userId: user.id,
        surface,
        projectId,
        ...(designBinding ? { binding: designBinding } : {}),
        clientRequestId: existing ? retryClientRequestId(clientRequestId) : clientRequestId,
    });
    if (!inserted.created) {
        // A deduplication race can return a task created by the previous source
        // for this node. Never hand that result to a request for the new source,
        // regardless of whether the raced task has already reached a terminal state.
        if (inserted.task.sourceStorageKey !== sourceStorageKey || inserted.task.optionsHash !== optionsHash) {
            return jsonError(409, surface === "design" ? "该源图片已有其他抠图任务，请等待当前任务完成" : "该源节点已有其他抠图任务，请等待当前任务完成");
        }
        return jsonTask(inserted.task);
    }
    const task = inserted.task;
    return jsonTask(task, "抠图任务已创建");
}

function jsonTask(task: BackgroundRemovalTask, msg = "OK") {
    return NextResponse.json({ code: 0, data: { task: publicBackgroundRemovalTask(task) }, msg });
}

function text(value: unknown, max: number) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isReusableTask(task: BackgroundRemovalTask, sourceStorageKey: string, optionsHash: string) {
    if (sourceStorageKey && task.sourceStorageKey !== sourceStorageKey) return false;
    if (task.optionsHash !== optionsHash) return false;
    return task.status === "pending" || task.status === "running" || task.status === "success";
}

function taskMatchesSource(task: BackgroundRemovalTask, surface: "canvas" | "design", sourceIdentity: string, sourceNodeId: string) {
    if (task.sourceIdentity) return task.sourceIdentity === sourceIdentity;
    return surface === "canvas" && task.sourceNodeId === sourceNodeId;
}

function retryClientRequestId(base: string) {
    const suffix = `:retry:${randomUUID()}`;
    return `${base.slice(0, Math.max(1, 160 - suffix.length))}${suffix}`;
}

function scopedClientRequestId(base: string, projectId: string, sourceIdentity: string, sourceStorageKey: string, optionsHash: string) {
    const contextHash = createHash("sha256")
        .update(JSON.stringify([projectId, sourceIdentity, sourceStorageKey]))
        .digest("hex")
        .slice(0, 24);
    const suffix = `:options:${optionsHash}:context:${contextHash}`;
    return `${base.slice(0, Math.max(1, 160 - suffix.length))}${suffix}`;
}

function jsonError(status: number, msg: string) {
    return NextResponse.json({ code: status, data: null, msg }, { status });
}
