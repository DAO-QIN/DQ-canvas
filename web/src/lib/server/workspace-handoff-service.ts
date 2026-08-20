import { CanvasNodeType, type CanvasNodeData } from "@/app/(user)/canvas/types";
import type { CanvasProject } from "@/lib/canvas-project-contract";
import { canvasProjectRevision } from "@/lib/canvas-project-receipt";
import {
    parseWorkspaceHandoffRequest,
    workspaceHandoffRequestFingerprint,
    WorkspaceHandoffContractError,
    type WorkspaceHandoffReceipt,
    type WorkspaceHandoffRequest,
    type WorkspaceHandoffSource,
    type WorkspaceStableResourceLocator,
} from "@/lib/creative-workspace";
import { DESIGN_LIMITS, designOperationBatchFingerprint, type DesignAssetVersion, type DesignDocument, type DesignOperation, type DesignOperationBatch, type DesignOperationReceipt, type DesignProject } from "@/lib/design";
import { sha256Hex } from "@/lib/sha256";
import { applyCanvasProjectNodeImportBatch, getCanvasProject, getCanvasProjectSaveReceipt, type CanvasNodeImportRequest } from "@/lib/server/canvas-project-store";
import { applyDesignProjectOperationBatch, getDesignProject, getDesignProjectOperationReceipt } from "@/lib/server/design-project-store";
import { localMediaStorageKeyFromValue } from "@/lib/server/local-media-references";
import { claimWorkspaceHandoff, completeWorkspaceHandoff, prepareWorkspaceHandoffTarget, releaseWorkspaceHandoffClaim, type WorkspaceHandoffRecord } from "@/lib/server/workspace-handoff-store";
import { validateWorkspaceMediaResourceForUser, WorkspaceResourceResolutionError, type ValidatedWorkspaceMediaResource } from "@/lib/server/workspace-resource-resolver";

type TransferableImage = Readonly<{
    sourceId: string;
    name: string;
    locator: WorkspaceStableResourceLocator;
    storageKey: string;
    scope: ValidatedWorkspaceMediaResource["scope"];
    mimeType: DesignAssetVersion["mimeType"];
    width: number;
    height: number;
    bytes: number;
    createdAt: string;
}>;

export class WorkspaceHandoffServiceError extends Error {
    constructor(
        message: string,
        readonly status: 400 | 404 | 409 | 422,
        readonly details?: WorkspaceHandoffReceipt,
    ) {
        super(message);
        this.name = "WorkspaceHandoffServiceError";
    }
}

const handoffsInFlight = new Map<string, { fingerprint: string; promise: Promise<WorkspaceHandoffReceipt> }>();

export async function executeWorkspaceHandoffForUser(userId: string, value: unknown): Promise<WorkspaceHandoffReceipt> {
    const request = parseWorkspaceHandoffRequest(value);
    const fingerprint = workspaceHandoffRequestFingerprint(request);
    const inFlightKey = `${userId.length}:${userId}|${request.handoffId.length}:${request.handoffId}`;
    const active = handoffsInFlight.get(inFlightKey);
    if (active) return active.fingerprint === fingerprint ? active.promise : identityConflict(request, fingerprint);
    const promise = executeClaimedWorkspaceHandoff(userId, request, fingerprint).finally(() => {
        if (handoffsInFlight.get(inFlightKey)?.promise === promise) handoffsInFlight.delete(inFlightKey);
    });
    handoffsInFlight.set(inFlightKey, { fingerprint, promise });
    return promise;
}

async function executeClaimedWorkspaceHandoff(userId: string, request: WorkspaceHandoffRequest, fingerprint: string): Promise<WorkspaceHandoffReceipt> {
    const now = new Date().toISOString();
    const claim = await claimWorkspaceHandoff(userId, request, fingerprint, now);
    if (claim.record.fingerprint !== fingerprint) return identityConflict(request, fingerprint);
    if (claim.record.status === "completed" && claim.record.receipt) return replayReceipt(claim.record.receipt);

    const recovered = await recoverTargetReceipt(userId, request, fingerprint, claim.record);
    if (recovered) return complete(userId, request, fingerprint, replayReceipt(recovered));
    if (!claim.claimed) return inProgressConflict(request, fingerprint);

    let sourceProject: CanvasProject | DesignProject;
    let targetProject: CanvasProject | DesignProject;
    let images: TransferableImage[];
    try {
        sourceProject = await ownedSourceProject(userId, request);
        targetProject = await ownedTargetProject(userId, request);
        const sourceRevision = request.source.surface === "canvas" ? canvasProjectRevision(sourceProject as CanvasProject) : (sourceProject as DesignProject).revision;
        const targetRevision = request.target.surface === "canvas" ? canvasProjectRevision(targetProject as CanvasProject) : (targetProject as DesignProject).revision;
        if (sourceRevision !== request.source.revision) {
            return complete(userId, request, fingerprint, revisionConflict(request, fingerprint, targetRevision, "HANDOFF_SOURCE_REVISION_CONFLICT", `源项目期望 revision ${request.source.revision}，当前为 ${sourceRevision}`));
        }
        if (targetRevision !== request.target.baseRevision) {
            return complete(userId, request, fingerprint, revisionConflict(request, fingerprint, targetRevision, "HANDOFF_TARGET_REVISION_CONFLICT", `目标项目期望 revision ${request.target.baseRevision}，当前为 ${targetRevision}`));
        }
        images = request.source.surface === "canvas" ? await canvasTransferableImages(userId, sourceProject as CanvasProject, request.source) : await designTransferableImages(userId, sourceProject as DesignProject, request.source);
    } catch (error) {
        await releaseWorkspaceHandoffClaim(userId, request.handoffId, fingerprint).catch(() => false);
        throw error;
    }
    const targetWrite = request.target.surface === "design" ? designTargetWrite(request, targetProject as DesignProject, images) : canvasTargetWrite(request, fingerprint, targetProject as CanvasProject, images, now);
    await prepareWorkspaceHandoffTarget(userId, request.handoffId, fingerprint, targetWrite.batchId, targetWrite.fingerprint, new Date().toISOString());
    const receipt =
        targetWrite.surface === "design"
            ? designHandoffReceipt(request, fingerprint, (await applyDesignProjectOperationBatch(userId, request.target.projectId, targetWrite.batch, now)).receipt)
            : canvasHandoffReceipt(request, fingerprint, (await applyCanvasProjectNodeImportBatch(userId, targetWrite.input)).receipt);
    return complete(userId, request, fingerprint, receipt);
}

export function workspaceHandoffError(error: unknown) {
    if (error instanceof WorkspaceHandoffServiceError) return error;
    if (error instanceof WorkspaceHandoffContractError) return new WorkspaceHandoffServiceError(error.message, 400);
    if (error instanceof WorkspaceResourceResolutionError) return new WorkspaceHandoffServiceError(error.message, error.status);
    return null;
}

async function complete(userId: string, request: WorkspaceHandoffRequest, fingerprint: string, receipt: WorkspaceHandoffReceipt) {
    const record = await completeWorkspaceHandoff(userId, request.handoffId, fingerprint, receipt, new Date().toISOString());
    if (!record.receipt) throw new Error("Workspace handoff completed without receipt");
    return record.receipt;
}

async function recoverTargetReceipt(userId: string, request: WorkspaceHandoffRequest, fingerprint: string, record: WorkspaceHandoffRecord) {
    const batchId = record.targetBatchId;
    const expectedFingerprint = record.targetFingerprint;
    if (!batchId || !expectedFingerprint || batchId !== targetBatchId(request, fingerprint)) return null;
    if (request.target.surface === "design") {
        const receipt = await getDesignProjectOperationReceipt(userId, request.target.projectId, batchId);
        return receipt?.fingerprint === expectedFingerprint ? designHandoffReceipt(request, fingerprint, receipt) : null;
    }
    const receipt = await getCanvasProjectSaveReceipt(userId, request.target.projectId, batchId);
    return receipt?.fingerprint === expectedFingerprint ? canvasHandoffReceipt(request, fingerprint, receipt) : null;
}

async function ownedSourceProject(userId: string, request: WorkspaceHandoffRequest) {
    const project = request.source.surface === "canvas" ? await getCanvasProject(request.source.projectId, userId) : await getDesignProject(userId, request.source.projectId);
    if (!project) throw new WorkspaceHandoffServiceError("源项目不存在或无权访问", 404);
    return project;
}

async function ownedTargetProject(userId: string, request: WorkspaceHandoffRequest) {
    const project = request.target.surface === "canvas" ? await getCanvasProject(request.target.projectId, userId) : await getDesignProject(userId, request.target.projectId);
    if (!project) throw new WorkspaceHandoffServiceError("目标项目不存在或无权访问", 404);
    return project;
}

async function canvasTransferableImages(userId: string, project: CanvasProject, source: WorkspaceHandoffSource): Promise<TransferableImage[]> {
    const byId = new Map(project.nodes.map((node) => [node.id, node]));
    const selected = source.selectionIds.map((id) => byId.get(id));
    if (selected.some((node) => !node)) throw new WorkspaceHandoffServiceError("源画布选区包含不存在的节点", 400);
    const candidates = selected.filter((node): node is CanvasNodeData => Boolean(node && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Panorama || node.type === CanvasNodeType.Drawing)));
    if (!candidates.length) throw new WorkspaceHandoffServiceError("请选择至少一个已永久保存的图片节点", 422);
    const images = await Promise.all(
        candidates.map(async (node) => {
            const metadata = node.metadata;
            const drawing = metadata?.drawingPreview;
            const storageKey = firstStorageKey(drawing?.storageKey, metadata?.storageKey, drawing?.serverUrl, metadata?.serverUrl, metadata?.content);
            if (!storageKey) throw new WorkspaceHandoffServiceError(`节点“${cleanName(node.title)}”没有稳定图片资源`, 422);
            const validated = await validateWorkspaceMediaResourceForUser(userId, { kind: "storage-key", storageKey }, ["image"]);
            return imageDescriptor({
                sourceId: node.id,
                name: cleanName(node.title),
                locator: { kind: "storage-key", storageKey: validated.storageKey },
                validated,
                width: positiveImageEdge(drawing?.width ?? metadata?.naturalWidth ?? node.width, "Canvas 图片宽度"),
                height: positiveImageEdge(drawing?.height ?? metadata?.naturalHeight ?? node.height, "Canvas 图片高度"),
            });
        }),
    );
    return uniqueSourceImages(images);
}

async function designTransferableImages(userId: string, project: DesignProject, source: WorkspaceHandoffSource): Promise<TransferableImage[]> {
    const document = project.document;
    const elementById = new Map(document.elements.map((element) => [element.id, element]));
    const frameIds = new Set(document.frames.map((frame) => frame.id));
    const selectedIds = new Set<string>();
    for (const id of source.selectionIds) {
        const element = elementById.get(id);
        if (element) {
            if (element.kind === "image") selectedIds.add(element.id);
            continue;
        }
        if (!frameIds.has(id)) throw new WorkspaceHandoffServiceError("源画板选区包含不存在的元素", 400);
        document.layers
            .find((layer) => layer.scope === "frame" && layer.frameId === id)
            ?.elementIds.forEach((elementId) => {
                if (elementById.get(elementId)?.kind === "image") selectedIds.add(elementId);
            });
    }
    const elements = document.elements.filter((element): element is Extract<(typeof document.elements)[number], { kind: "image" }> => selectedIds.has(element.id) && element.kind === "image");
    if (!elements.length) throw new WorkspaceHandoffServiceError("请选择至少一个图片元素或包含图片的画框", 422);
    const versions = new Map(document.assetVersions.map((version) => [version.id, version]));
    const images = await Promise.all(
        elements.map(async (element) => {
            const version = versions.get(element.assetVersionId);
            if (!version) throw new WorkspaceHandoffServiceError(`图片元素“${cleanName(element.name)}”缺少资源版本`, 422);
            const validated = await validateWorkspaceMediaResourceForUser(userId, version.locator, ["image"]);
            return imageDescriptor({ sourceId: element.id, name: cleanName(element.name), locator: version.locator, validated, width: version.width, height: version.height });
        }),
    );
    return uniqueSourceImages(images);
}

function designTargetWrite(request: WorkspaceHandoffRequest, target: DesignProject, images: readonly TransferableImage[]) {
    const { batch } = designImportBatch(request, target.document, images);
    return { surface: "design" as const, batchId: batch.batchId, fingerprint: designOperationBatchFingerprint(batch), batch };
}

function canvasTargetWrite(request: WorkspaceHandoffRequest, fingerprint: string, target: CanvasProject, images: readonly TransferableImage[], now: string) {
    const nodes = canvasImportNodes(request, target, images);
    const input: CanvasNodeImportRequest = {
        projectId: target.id,
        expectedRevision: request.target.baseRevision,
        batchId: targetBatchId(request, fingerprint),
        fingerprint: `sha256:${sha256Hex(stableStringify({ handoffFingerprint: fingerprint, nodes }))}`,
        nodes,
        updatedAt: now,
    };
    return { surface: "canvas" as const, batchId: input.batchId, fingerprint: input.fingerprint, input };
}

function designImportBatch(request: WorkspaceHandoffRequest, document: DesignDocument, images: readonly TransferableImage[]) {
    const layer = document.layers.find((candidate) => candidate.scope === "workspace");
    if (!layer) throw new WorkspaceHandoffServiceError("目标画板缺少 Workspace 图层", 422);
    const origin = designImportOrigin(document);
    const operations: DesignOperation[] = [];
    const elementIds: string[] = [];
    images.forEach((image, index) => {
        const suffix = sha256Hex(`${document.id}\0${request.handoffId}\0${image.sourceId}`).slice(0, 32);
        const assetId = `asset-${suffix}`;
        const versionId = `version-${suffix}`;
        const elementId = `element-${suffix}`;
        const size = fitImage(image.width, image.height, 480, 480);
        const column = index % 3;
        const row = Math.floor(index / 3);
        const initialVersion: DesignAssetVersion = {
            id: versionId,
            assetId,
            parentVersionId: null,
            source: image.locator.kind === "library-asset" ? "library" : "upload",
            locator: image.locator,
            mimeType: image.mimeType,
            width: image.width,
            height: image.height,
            createdAt: image.createdAt,
            provenance: { operation: "import", sourceElementId: null, generationTaskId: null },
        };
        operations.push({
            opId: `op-add-${suffix}`,
            type: "add-asset",
            asset: { id: assetId, kind: "image", name: image.name, currentVersionId: versionId, versionIds: [versionId] },
            initialVersion,
        });
        operations.push({
            opId: `op-place-${suffix}`,
            type: "create-element",
            element: {
                id: elementId,
                frameId: null,
                name: image.name,
                transform: { x: origin.x + column * 520, y: origin.y + row * 520, width: size.width, height: size.height, rotation: 0, flipX: false, flipY: false },
                opacity: 1,
                blendMode: "normal",
                locked: false,
                hidden: false,
                kind: "image",
                assetVersionId: versionId,
                crop: null,
                fit: "contain",
                cornerRadius: 0,
            },
            index: layer.elementIds.length + index,
        });
        elementIds.push(elementId);
    });
    const batch: DesignOperationBatch = {
        batchId: targetBatchId(request, workspaceHandoffRequestFingerprint(request)),
        expectedRevision: request.target.baseRevision,
        mode: "atomic",
        source: "system",
        label: request.source.surface === "canvas" ? "从画布导入素材" : "导入工作台素材",
        operations,
    };
    return { batch, elementIds };
}

function canvasImportNodes(request: WorkspaceHandoffRequest, target: CanvasProject, images: readonly TransferableImage[]): CanvasNodeData[] {
    const origin = canvasImportOrigin(target);
    return images.map((image, index) => {
        const suffix = sha256Hex(`${target.id}\0${request.handoffId}\0${image.sourceId}`).slice(0, 32);
        const size = fitImage(image.width, image.height, 480, 480);
        const column = index % 3;
        const row = Math.floor(index / 3);
        const serverUrl = internalMediaUrl(image.scope, image.storageKey);
        return {
            id: `image-${suffix}`,
            type: CanvasNodeType.Image,
            title: image.name,
            position: { x: origin.x + column * 520, y: origin.y + row * 520 },
            width: size.width,
            height: size.height,
            metadata: {
                content: serverUrl,
                serverUrl,
                storageKey: image.storageKey,
                status: "success",
                naturalWidth: image.width,
                naturalHeight: image.height,
                bytes: image.bytes,
                mimeType: image.mimeType,
            },
        };
    });
}

function designHandoffReceipt(request: WorkspaceHandoffRequest, fingerprint: string, target: DesignOperationReceipt): WorkspaceHandoffReceipt {
    const original = target.status === "replayed" ? target.originalStatus : target.status;
    const status = target.status === "replayed" ? "replayed" : target.status === "applied" ? "applied" : target.status === "conflict" ? "conflict" : "rejected";
    const targetIds = target.results.filter((result) => result.type === "create-element" && result.status === "applied").flatMap((result) => result.affectedIds);
    const firstError = target.results.find((result) => result.error)?.error;
    return Object.freeze({
        handoffId: request.handoffId,
        fingerprint,
        status,
        ...(status === "replayed" && original ? { originalStatus: original === "applied" ? "applied" : original === "conflict" ? "conflict" : "rejected" } : {}),
        source: request.source,
        target: { ...request.target, resultRevision: target.resultRevision },
        targetBatchId: target.batchId,
        targetFingerprint: target.fingerprint,
        targetIds: Object.freeze(targetIds),
        ...(status === "conflict" || status === "rejected"
            ? { error: { code: firstError?.code || (status === "conflict" ? "HANDOFF_TARGET_CONFLICT" : "HANDOFF_TARGET_REJECTED"), message: firstError?.message || "目标画板未应用交接素材", retryable: false } }
            : {}),
    });
}

function canvasHandoffReceipt(request: WorkspaceHandoffRequest, fingerprint: string, target: Awaited<ReturnType<typeof getCanvasProjectSaveReceipt>> & {}): WorkspaceHandoffReceipt {
    if (!target) throw new Error("Canvas handoff receipt missing");
    const status = target.status;
    return Object.freeze({
        handoffId: request.handoffId,
        fingerprint,
        status,
        ...(status === "replayed" ? { originalStatus: target.originalStatus || "applied" } : {}),
        source: request.source,
        target: { ...request.target, resultRevision: target.resultRevision },
        targetBatchId: target.batchId,
        targetFingerprint: target.fingerprint,
        targetIds: Object.freeze([...(target.affectedIds || [])]),
        ...(target.error ? { error: target.error } : {}),
    });
}

function identityConflict(request: WorkspaceHandoffRequest, fingerprint: string): WorkspaceHandoffReceipt {
    return Object.freeze({
        handoffId: request.handoffId,
        fingerprint,
        status: "conflict",
        source: request.source,
        target: { ...request.target, resultRevision: request.target.baseRevision },
        targetBatchId: targetBatchId(request, fingerprint),
        targetFingerprint: null,
        targetIds: Object.freeze([]),
        error: { code: "HANDOFF_ID_CONFLICT", message: "相同 handoffId 对应了不同交接请求", retryable: false },
    });
}

function inProgressConflict(request: WorkspaceHandoffRequest, fingerprint: string): WorkspaceHandoffReceipt {
    return Object.freeze({
        handoffId: request.handoffId,
        fingerprint,
        status: "conflict",
        source: request.source,
        target: { ...request.target, resultRevision: request.target.baseRevision },
        targetBatchId: targetBatchId(request, fingerprint),
        targetFingerprint: null,
        targetIds: Object.freeze([]),
        error: { code: "HANDOFF_IN_PROGRESS", message: "相同素材交接正在处理中", retryable: true },
    });
}

function revisionConflict(request: WorkspaceHandoffRequest, fingerprint: string, resultRevision: number, code: string, message: string): WorkspaceHandoffReceipt {
    return Object.freeze({
        handoffId: request.handoffId,
        fingerprint,
        status: "conflict",
        source: request.source,
        target: { ...request.target, resultRevision },
        targetBatchId: targetBatchId(request, fingerprint),
        targetFingerprint: null,
        targetIds: Object.freeze([]),
        error: { code, message, retryable: false },
    });
}

function replayReceipt(receipt: WorkspaceHandoffReceipt): WorkspaceHandoffReceipt {
    return Object.freeze({ ...receipt, status: "replayed", originalStatus: receipt.originalStatus || (receipt.status === "replayed" ? "applied" : receipt.status) });
}

function imageDescriptor(input: { sourceId: string; name: string; locator: WorkspaceStableResourceLocator; validated: ValidatedWorkspaceMediaResource; width: number; height: number }): TransferableImage {
    const mimeType = designMimeType(input.validated.mimeType);
    return Object.freeze({
        sourceId: input.sourceId,
        name: input.name,
        locator: input.locator,
        storageKey: input.validated.storageKey,
        scope: input.validated.scope,
        mimeType,
        width: input.width,
        height: input.height,
        bytes: input.validated.bytes,
        createdAt: new Date(input.validated.createdAt).toISOString(),
    });
}

function uniqueSourceImages(images: readonly TransferableImage[]) {
    const seen = new Set<string>();
    return images.filter((image) => !seen.has(image.sourceId) && Boolean(seen.add(image.sourceId)));
}

function targetBatchId(request: WorkspaceHandoffRequest, fingerprint: string) {
    return `handoff-${request.handoffId}-${sha256Hex(fingerprint).slice(0, 16)}`;
}

function firstStorageKey(...values: unknown[]) {
    for (const value of values) {
        const text = typeof value === "string" ? value.trim() : "";
        const key = text ? localMediaStorageKeyFromValue(text) : "";
        if (key) return key;
    }
    return "";
}

function designMimeType(value: string): DesignAssetVersion["mimeType"] {
    const mimeType = value.split(";", 1)[0].trim().toLowerCase();
    if (mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/webp") return mimeType;
    throw new WorkspaceHandoffServiceError("交接图片必须是 PNG、JPEG 或 WebP", 422);
}

function positiveImageEdge(value: unknown, label: string) {
    const edge = Number(value);
    if (!Number.isFinite(edge) || edge <= 0 || edge > DESIGN_LIMITS.maxExportEdge) throw new WorkspaceHandoffServiceError(`${label}无效`, 422);
    return Math.max(1, Math.min(DESIGN_LIMITS.maxExportEdge, Math.round(edge)));
}

function cleanName(value: unknown) {
    const name = typeof value === "string" ? value.trim().slice(0, DESIGN_LIMITS.maxNameLength) : "";
    return name || "交接图片";
}

function fitImage(width: number, height: number, maxWidth: number, maxHeight: number) {
    const scale = Math.min(1, maxWidth / width, maxHeight / height);
    return { width: round(width * scale), height: round(height * scale) };
}

function designImportOrigin(document: DesignDocument) {
    let right = -96;
    let top = 0;
    let found = false;
    for (const frame of document.frames) {
        right = Math.max(right, frame.x + frame.width);
        top = found ? Math.min(top, frame.y) : frame.y;
        found = true;
    }
    for (const element of document.elements.filter((item) => item.frameId === null)) {
        right = Math.max(right, element.transform.x + element.transform.width);
        top = found ? Math.min(top, element.transform.y) : element.transform.y;
        found = true;
    }
    return { x: round(right + 96), y: round(found ? top : 0) };
}

function canvasImportOrigin(project: CanvasProject) {
    if (!project.nodes.length) return { x: 0, y: 0 };
    return {
        x: round(Math.max(...project.nodes.map((node) => node.position.x + node.width)) + 96),
        y: round(Math.min(...project.nodes.map((node) => node.position.y))),
    };
}

function internalMediaUrl(scope: ValidatedWorkspaceMediaResource["scope"], storageKey: string) {
    const prefix = scope === "generation" ? "/api/generation-log-assets/" : "/api/reference-assets/";
    return `${prefix}${storageKey.split("/").map(encodeURIComponent).join("/")}`;
}

function round(value: number) {
    return Math.round(value * 1_000) / 1_000;
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
            .filter(([, nested]) => nested !== undefined)
            .toSorted(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}
