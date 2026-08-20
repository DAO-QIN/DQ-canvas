import type { DesignHistoryTransaction } from "./history";
import type { DesignAnnotation, DesignAsset, DesignAssetVersion, DesignDocument, DesignElement, DesignFrame, DesignLayerScope } from "./schema";
import { cloneDesignDocument, DesignDocumentValidationError, parseDesignDocumentV1 } from "./validation";
import { designOperationBatchFingerprint, parseDesignOperationBatch, type DesignOperation, type DesignOperationBatch, type DesignOperationError, type DesignOperationReceipt, type DesignOperationReplay, type DesignOperationResult } from "./operations";

export type ApplyDesignOperationBatchOptions = {
    replay?: DesignOperationReplay | null;
    now?: () => string;
    createTransactionId?: () => string;
};

export type ApplyDesignOperationBatchOutcome = {
    document: DesignDocument;
    receipt: DesignOperationReceipt;
};

type StepOutcome = { document: DesignDocument; affectedIds: string[] } | { error: DesignOperationError };

export function applyDesignOperationBatch(documentValue: unknown, batchValue: unknown, options: ApplyDesignOperationBatchOptions = {}): ApplyDesignOperationBatchOutcome {
    const document = parseDesignDocumentV1(documentValue);
    const batch = parseDesignOperationBatch(batchValue);
    const fingerprint = designOperationBatchFingerprint(batch);
    const replay = options.replay;
    if (replay?.batchId === batch.batchId) {
        if (replay.documentId !== document.id) return conflictReceipt(document, batch, fingerprint, "BATCH_ID_CONFLICT", "批次回执不属于当前 Design Document");
        if (replay.fingerprint !== fingerprint) return conflictReceipt(document, batch, fingerprint, "BATCH_ID_CONFLICT", "相同 batchId 对应了不同操作内容");
        if (document.revision < replay.receipt.resultRevision) return conflictReceipt(document, batch, fingerprint, "BATCH_ID_CONFLICT", "批次回执 revision 超前于当前文档");
        return {
            document,
            receipt: { ...structuredClone(replay.receipt), status: "replayed", originalStatus: replay.receipt.originalStatus ?? (replay.receipt.status === "replayed" ? null : replay.receipt.status) },
        };
    }
    if (batch.expectedRevision !== document.revision) return conflictReceipt(document, batch, fingerprint, "REVISION_CONFLICT", `期望 revision ${batch.expectedRevision}，当前为 ${document.revision}`);

    let working = cloneDesignDocument(document);
    const results: DesignOperationResult[] = [];
    for (let index = 0; index < batch.operations.length; index += 1) {
        const operation = batch.operations[index];
        let step: StepOutcome;
        try {
            step = applyOperation(working, operation);
        } catch (error) {
            step = { error: validationError(error) };
        }
        if ("error" in step) {
            results.push(result(operation, "rejected", [], step.error));
            if (batch.mode === "atomic") {
                const rolledBack = results.map((item) => (item.status === "applied" ? { ...item, status: "rolled-back" as const } : item));
                rolledBack.push(...batch.operations.slice(index + 1).map((item) => result(item, "skipped", [], { code: "INVALID_OPERATION", message: "atomic 批次已回滚，后续操作未执行" })));
                return { document, receipt: receipt(batch, fingerprint, "rejected", document.revision, document.revision, rolledBack, null) };
            }
            continue;
        }
        try {
            working = parseDesignDocumentV1(step.document);
            results.push(result(operation, "applied", step.affectedIds, null));
        } catch (error) {
            const operationError = validationError(error);
            results.push(result(operation, "rejected", [], operationError));
            if (batch.mode === "atomic") {
                const rolledBack = results.map((item) => (item.status === "applied" ? { ...item, status: "rolled-back" as const } : item));
                rolledBack.push(...batch.operations.slice(index + 1).map((item) => result(item, "skipped", [], { code: "INVALID_OPERATION", message: "atomic 批次已回滚，后续操作未执行" })));
                return { document, receipt: receipt(batch, fingerprint, "rejected", document.revision, document.revision, rolledBack, null) };
            }
        }
    }

    const applied = results.filter((item) => item.status === "applied");
    if (!applied.length) return { document, receipt: receipt(batch, fingerprint, "rejected", document.revision, document.revision, results, null) };
    working = parseDesignDocumentV1({ ...working, revision: document.revision + 1, metadata: { ...working.metadata, updatedAt: options.now?.() ?? new Date().toISOString() } });
    const transaction: DesignHistoryTransaction = {
        id: options.createTransactionId?.() ?? `history-${batch.batchId}`,
        label: batch.label,
        source: batch.source,
        baseRevision: document.revision,
        resultRevision: working.revision,
        operationIds: applied.map((item) => item.opId),
        createdAt: options.now?.() ?? new Date().toISOString(),
    };
    const status = applied.length === batch.operations.length ? "applied" : "partial";
    return { document: working, receipt: receipt(batch, fingerprint, status, document.revision, working.revision, results, transaction) };
}

function applyOperation(document: DesignDocument, operation: DesignOperation): StepOutcome {
    switch (operation.type) {
        case "update-workspace":
            return success({ ...document, workspace: { ...document.workspace, ...operation.patch } }, []);
        case "create-frame":
            return createFrame(document, operation.frame, operation.index);
        case "update-frame":
            return updateFrame(document, operation.frameId, operation.patch);
        case "delete-frame":
            return deleteFrame(document, operation.frameId, operation.deleteElements);
        case "create-guide":
            return createGuide(document, operation.guide);
        case "update-guide":
            return updateGuide(document, operation.guideId, operation.patch);
        case "delete-guide":
            return deleteGuide(document, operation.guideId);
        case "create-element":
            return createElement(document, operation.element, operation.index);
        case "update-transform":
            return updateElement(document, operation.elementId, (item) => ({ ...item, transform: operation.transform }));
        case "update-element":
            return updateElementProperties(document, operation.elementId, operation.patch);
        case "update-text":
            return updateText(document, operation.elementId, operation.patch);
        case "update-shape":
            return updateElementKind(document, operation.elementId, "shape", operation.patch);
        case "update-line":
            return updateElementKind(document, operation.elementId, "line", operation.patch);
        case "update-arrow":
            return updateElementKind(document, operation.elementId, "arrow", operation.patch);
        case "set-image-crop":
            return setImageCrop(document, operation.elementId, operation.crop);
        case "set-image-asset-version":
            return setImageAssetVersion(document, operation.elementId, operation.assetVersionId);
        case "delete-elements":
            return deleteElements(document, operation.elementIds);
        case "move-elements":
            return moveElements(document, operation.elementIds, operation.target, operation.index);
        case "reorder-elements":
            return reorderElements(document, operation.target, operation.elementIds);
        case "add-asset":
            return addAsset(document, operation.asset, operation.initialVersion);
        case "add-asset-version":
            return addAssetVersion(document, operation.assetVersion, operation.setCurrent);
        case "set-current-asset-version":
            return setCurrentAssetVersion(document, operation.assetId, operation.assetVersionId);
        case "add-annotation":
            return addAnnotation(document, operation.annotation);
        case "resolve-annotation":
            return resolveAnnotation(document, operation.annotationId, operation.resolved, operation.updatedAt);
        case "delete-annotation":
            return deleteAnnotation(document, operation.annotationId);
    }
}

function createFrame(document: DesignDocument, frame: DesignFrame, index: number): StepOutcome {
    if (document.frames.some((item) => item.id === frame.id)) return failure("ID_CONFLICT", `Frame ID 已存在：${frame.id}`);
    const frames = insert(document.frames, frame, index);
    const layers = [...document.layers, { scope: "frame" as const, frameId: frame.id, elementIds: [] }];
    return success({ ...document, frames, layers }, [frame.id]);
}

function updateFrame(document: DesignDocument, frameId: string, patch: Partial<Omit<DesignFrame, "id">>): StepOutcome {
    const index = document.frames.findIndex((item) => item.id === frameId);
    if (index < 0) return failure("FRAME_NOT_FOUND", `Frame 不存在：${frameId}`);
    if (document.frames[index].locked && !isUnlockOnlyPatch(patch)) return failure("LOCKED", `Frame 已锁定：${frameId}`);
    const frames = document.frames.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item));
    return success({ ...document, frames }, [frameId]);
}

function deleteFrame(document: DesignDocument, frameId: string, deleteChildren: boolean): StepOutcome {
    const frame = document.frames.find((item) => item.id === frameId);
    if (!frame) return failure("FRAME_NOT_FOUND", `Frame 不存在：${frameId}`);
    if (frame.locked) return failure("LOCKED", `Frame 已锁定：${frameId}`);
    const children = document.elements.filter((item) => item.frameId === frameId);
    if (children.length && !deleteChildren) return failure("INVALID_OPERATION", "Frame 内仍有元素；必须显式确认删除子元素");
    const childIds = new Set(children.map((item) => item.id));
    return success(
        {
            ...document,
            frames: document.frames.filter((item) => item.id !== frameId),
            guides: document.guides.filter((item) => item.frameId !== frameId),
            elements: document.elements.filter((item) => !childIds.has(item.id)),
            layers: document.layers.filter((item) => !(item.scope === "frame" && item.frameId === frameId)),
            annotations: document.annotations.filter((item) => !(item.target.kind === "frame" && item.target.frameId === frameId) && !(item.target.kind === "element" && childIds.has(item.target.elementId))),
        },
        [frameId, ...childIds],
    );
}

function createGuide(document: DesignDocument, guide: DesignDocument["guides"][number]): StepOutcome {
    if (document.guides.some((item) => item.id === guide.id)) return failure("ID_CONFLICT", `辅助线 ID 已存在：${guide.id}`);
    return success({ ...document, guides: [...document.guides, guide] }, [guide.id]);
}

function updateGuide(document: DesignDocument, guideId: string, patch: Partial<DesignDocument["guides"][number]>): StepOutcome {
    const guide = document.guides.find((item) => item.id === guideId);
    if (!guide) return failure("INVALID_OPERATION", `辅助线不存在：${guideId}`);
    if (guide.locked && !isUnlockOnlyPatch(patch)) return failure("LOCKED", `辅助线已锁定：${guideId}`);
    return success({ ...document, guides: document.guides.map((item) => (item.id === guideId ? { ...item, ...patch, id: guideId } : item)) }, [guideId]);
}

function deleteGuide(document: DesignDocument, guideId: string): StepOutcome {
    const guide = document.guides.find((item) => item.id === guideId);
    if (!guide) return failure("INVALID_OPERATION", `辅助线不存在：${guideId}`);
    if (guide.locked) return failure("LOCKED", `辅助线已锁定：${guideId}`);
    return success({ ...document, guides: document.guides.filter((item) => item.id !== guideId) }, [guideId]);
}

function createElement(document: DesignDocument, element: DesignElement, index: number): StepOutcome {
    if (document.elements.some((item) => item.id === element.id)) return failure("ID_CONFLICT", `元素 ID 已存在：${element.id}`);
    const layerIndex = findLayerIndex(document.layers, element.frameId === null ? { scope: "workspace" } : { scope: "frame", frameId: element.frameId });
    if (layerIndex < 0) return failure("FRAME_NOT_FOUND", element.frameId ? `Frame 不存在：${element.frameId}` : "Workspace 图层不存在");
    const layers = document.layers.map((layer, itemIndex) => (itemIndex === layerIndex ? { ...layer, elementIds: insert(layer.elementIds, element.id, index) } : layer)) as DesignLayerScope[];
    return success({ ...document, elements: [...document.elements, element], layers }, [element.id]);
}

function updateElement(document: DesignDocument, elementId: string, update: (element: DesignElement) => DesignElement): StepOutcome {
    const target = document.elements.find((item) => item.id === elementId);
    if (!target) return failure("ELEMENT_NOT_FOUND", `元素不存在：${elementId}`);
    if (target.locked) return failure("LOCKED", `元素已锁定：${elementId}`);
    return success({ ...document, elements: document.elements.map((item) => (item.id === elementId ? update(item) : item)) }, [elementId]);
}

function updateElementProperties(document: DesignDocument, elementId: string, patch: Extract<DesignOperation, { type: "update-element" }>["patch"]): StepOutcome {
    const target = document.elements.find((item) => item.id === elementId);
    if (!target) return failure("ELEMENT_NOT_FOUND", `元素不存在：${elementId}`);
    if (target.locked && !isUnlockOnlyPatch(patch)) return failure("LOCKED", `元素已锁定：${elementId}`);
    return success({ ...document, elements: document.elements.map((item) => (item.id === elementId ? { ...item, ...patch } : item)) }, [elementId]);
}

function updateText(document: DesignDocument, elementId: string, patch: Record<string, unknown>): StepOutcome {
    return updateElementKind(document, elementId, "text", patch);
}

function updateElementKind(document: DesignDocument, elementId: string, kind: DesignElement["kind"], patch: Record<string, unknown>): StepOutcome {
    const target = document.elements.find((item) => item.id === elementId);
    if (!target) return failure("ELEMENT_NOT_FOUND", `元素不存在：${elementId}`);
    if (target.kind !== kind) return failure("TYPE_MISMATCH", `元素类型不是 ${kind}：${elementId}`);
    return updateElement(document, elementId, (item) => ({ ...item, ...patch }) as DesignElement);
}

function setImageCrop(document: DesignDocument, elementId: string, crop: Extract<DesignOperation, { type: "set-image-crop" }>["crop"]): StepOutcome {
    const target = document.elements.find((item) => item.id === elementId);
    if (!target) return failure("ELEMENT_NOT_FOUND", `元素不存在：${elementId}`);
    if (target.kind !== "image") return failure("TYPE_MISMATCH", `元素不是图片：${elementId}`);
    return updateElement(document, elementId, (item) => ({ ...item, crop }) as DesignElement);
}

function setImageAssetVersion(document: DesignDocument, elementId: string, assetVersionId: string): StepOutcome {
    const target = document.elements.find((item) => item.id === elementId);
    if (!target) return failure("ELEMENT_NOT_FOUND", `元素不存在：${elementId}`);
    if (target.kind !== "image") return failure("TYPE_MISMATCH", `元素不是图片：${elementId}`);
    if (!document.assetVersions.some((item) => item.id === assetVersionId)) return failure("ASSET_VERSION_NOT_FOUND", `资源版本不存在：${assetVersionId}`);
    return updateElement(document, elementId, (item) => ({ ...item, assetVersionId }) as DesignElement);
}

function deleteElements(document: DesignDocument, ids: string[]): StepOutcome {
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length || !ids.length) return failure("INVALID_OPERATION", "删除元素 ID 必须非空且唯一");
    const targets = ids.map((id) => document.elements.find((item) => item.id === id));
    const missing = targets.findIndex((item) => !item);
    if (missing >= 0) return failure("ELEMENT_NOT_FOUND", `元素不存在：${ids[missing]}`);
    const locked = targets.find((item) => item?.locked);
    if (locked) return failure("LOCKED", `元素已锁定：${locked.id}`);
    return success(
        {
            ...document,
            elements: document.elements.filter((item) => !uniqueIds.has(item.id)),
            layers: document.layers.map((layer) => ({ ...layer, elementIds: layer.elementIds.filter((id) => !uniqueIds.has(id)) })) as DesignLayerScope[],
            annotations: document.annotations.filter((item) => item.target.kind !== "element" || !uniqueIds.has(item.target.elementId)),
        },
        ids,
    );
}

function moveElements(document: DesignDocument, ids: string[], target: Extract<DesignOperation, { type: "move-elements" }>["target"], index: number): StepOutcome {
    const uniqueIds = new Set(ids);
    if (!ids.length || uniqueIds.size !== ids.length) return failure("INVALID_OPERATION", "移动元素 ID 必须非空且唯一");
    const elements = ids.map((id) => document.elements.find((item) => item.id === id));
    const missing = elements.findIndex((item) => !item);
    if (missing >= 0) return failure("ELEMENT_NOT_FOUND", `元素不存在：${ids[missing]}`);
    const locked = elements.find((item) => item?.locked);
    if (locked) return failure("LOCKED", `元素已锁定：${locked.id}`);
    const targetLayerIndex = findLayerIndex(document.layers, target);
    if (targetLayerIndex < 0) return failure("FRAME_NOT_FOUND", target.scope === "frame" ? `Frame 不存在：${target.frameId}` : "Workspace 图层不存在");
    const frameId = target.scope === "frame" ? target.frameId : null;
    const stripped = document.layers.map((layer) => ({ ...layer, elementIds: layer.elementIds.filter((id) => !uniqueIds.has(id)) })) as DesignLayerScope[];
    const layers = stripped.map((layer, layerIndex) => (layerIndex === targetLayerIndex ? { ...layer, elementIds: insertMany(layer.elementIds, ids, index) } : layer)) as DesignLayerScope[];
    return success({ ...document, elements: document.elements.map((item) => (uniqueIds.has(item.id) ? { ...item, frameId } : item)), layers }, ids);
}

function reorderElements(document: DesignDocument, target: Extract<DesignOperation, { type: "reorder-elements" }>["target"], ids: string[]): StepOutcome {
    const layerIndex = findLayerIndex(document.layers, target);
    if (layerIndex < 0) return failure("FRAME_NOT_FOUND", target.scope === "frame" ? `Frame 不存在：${target.frameId}` : "Workspace 图层不存在");
    const current = document.layers[layerIndex].elementIds;
    if (ids.length !== current.length || new Set(ids).size !== ids.length || ids.some((id) => !current.includes(id))) return failure("INVALID_OPERATION", "重排必须精确包含该作用域全部元素 ID");
    const elements = new Map(document.elements.map((item) => [item.id, item]));
    const movedLocked = current.find((id, index) => elements.get(id)?.locked && ids[index] !== id);
    if (movedLocked) return failure("LOCKED", `锁定元素必须保持原图层位置：${movedLocked}`);
    const layers = document.layers.map((layer, index) => (index === layerIndex ? { ...layer, elementIds: [...ids] } : layer)) as DesignLayerScope[];
    return success({ ...document, layers }, ids);
}

function addAsset(document: DesignDocument, asset: DesignAsset, version: DesignAssetVersion): StepOutcome {
    if (document.assets.some((item) => item.id === asset.id) || document.assetVersions.some((item) => item.id === version.id)) return failure("ID_CONFLICT", "资源或资源版本 ID 已存在");
    if (version.assetId !== asset.id || asset.currentVersionId !== version.id || asset.versionIds.length !== 1 || asset.versionIds[0] !== version.id || version.parentVersionId !== null) return failure("INVALID_OPERATION", "初始资源与初始版本关系无效");
    return success({ ...document, assets: [...document.assets, asset], assetVersions: [...document.assetVersions, version] }, [asset.id, version.id]);
}

function addAssetVersion(document: DesignDocument, version: DesignAssetVersion, setCurrent: boolean): StepOutcome {
    const assetIndex = document.assets.findIndex((item) => item.id === version.assetId);
    if (assetIndex < 0) return failure("ASSET_NOT_FOUND", `资源不存在：${version.assetId}`);
    if (document.assetVersions.some((item) => item.id === version.id)) return failure("ID_CONFLICT", `资源版本 ID 已存在：${version.id}`);
    if (version.parentVersionId && !document.assetVersions.some((item) => item.id === version.parentVersionId && item.assetId === version.assetId)) return failure("ASSET_VERSION_NOT_FOUND", `父资源版本不存在：${String(version.parentVersionId)}`);
    const assets = document.assets.map((item, index) => (index === assetIndex ? { ...item, currentVersionId: setCurrent ? version.id : item.currentVersionId, versionIds: [...item.versionIds, version.id] } : item));
    return success({ ...document, assets, assetVersions: [...document.assetVersions, version] }, [version.id]);
}

function setCurrentAssetVersion(document: DesignDocument, assetId: string, versionId: string): StepOutcome {
    const asset = document.assets.find((item) => item.id === assetId);
    if (!asset) return failure("ASSET_NOT_FOUND", `资源不存在：${assetId}`);
    if (!asset.versionIds.includes(versionId)) return failure("ASSET_VERSION_NOT_FOUND", `资源版本不属于该资源：${versionId}`);
    return success({ ...document, assets: document.assets.map((item) => (item.id === assetId ? { ...item, currentVersionId: versionId } : item)) }, [assetId, versionId]);
}

function addAnnotation(document: DesignDocument, annotation: DesignAnnotation): StepOutcome {
    if (document.annotations.some((item) => item.id === annotation.id)) return failure("ID_CONFLICT", `标注 ID 已存在：${annotation.id}`);
    return success({ ...document, annotations: [...document.annotations, annotation] }, [annotation.id]);
}

function resolveAnnotation(document: DesignDocument, annotationId: string, resolved: boolean, updatedAt: string): StepOutcome {
    if (!document.annotations.some((item) => item.id === annotationId)) return failure("ANNOTATION_NOT_FOUND", `标注不存在：${annotationId}`);
    return success({ ...document, annotations: document.annotations.map((item) => (item.id === annotationId ? { ...item, resolved, updatedAt } : item)) }, [annotationId]);
}

function deleteAnnotation(document: DesignDocument, annotationId: string): StepOutcome {
    if (!document.annotations.some((item) => item.id === annotationId)) return failure("ANNOTATION_NOT_FOUND", `标注不存在：${annotationId}`);
    return success({ ...document, annotations: document.annotations.filter((item) => item.id !== annotationId) }, [annotationId]);
}

function findLayerIndex(layers: DesignLayerScope[], target: { scope: "workspace" } | { scope: "frame"; frameId: string }) {
    return layers.findIndex((layer) => (target.scope === "workspace" ? layer.scope === "workspace" : layer.scope === "frame" && layer.frameId === target.frameId));
}

function insert<T>(items: T[], item: T, index: number) {
    return insertMany(items, [item], index);
}

function insertMany<T>(items: T[], additions: T[], index: number) {
    if (!Number.isSafeInteger(index) || index < 0 || index > items.length) throw new DesignDocumentValidationError({ code: "INVALID_VALUE", path: "operation.index", message: "插入位置越界" });
    return [...items.slice(0, index), ...additions, ...items.slice(index)];
}

function isUnlockOnlyPatch(patch: object) {
    const entries = Object.entries(patch);
    return entries.length === 1 && entries[0][0] === "locked" && entries[0][1] === false;
}

function success(document: DesignDocument, affectedIds: Iterable<string>): StepOutcome {
    return { document, affectedIds: [...affectedIds] };
}

function failure(code: DesignOperationError["code"], message: string): StepOutcome {
    return { error: { code, message } };
}

function validationError(error: unknown): DesignOperationError {
    if (error instanceof DesignDocumentValidationError) return { code: "DOCUMENT_INVALID", message: error.message, path: error.issues[0]?.path };
    return { code: "INVALID_OPERATION", message: error instanceof Error ? error.message : "操作无效" };
}

function result(operation: DesignOperation, status: DesignOperationResult["status"], affectedIds: string[], error: DesignOperationError | null): DesignOperationResult {
    return { opId: operation.opId, type: operation.type, status, affectedIds, error };
}

function receipt(
    batch: DesignOperationBatch,
    fingerprint: string,
    status: DesignOperationReceipt["status"],
    baseRevision: number,
    resultRevision: number,
    results: DesignOperationResult[],
    transaction: DesignHistoryTransaction | null,
): DesignOperationReceipt {
    return { batchId: batch.batchId, fingerprint, status, originalStatus: null, baseRevision, resultRevision, results, transaction };
}

function conflictReceipt(document: DesignDocument, batch: DesignOperationBatch, fingerprint: string, code: "REVISION_CONFLICT" | "BATCH_ID_CONFLICT", message: string): ApplyDesignOperationBatchOutcome {
    const results = batch.operations.map((operation) => result(operation, "skipped", [], { code, message }));
    return { document, receipt: receipt(batch, fingerprint, "conflict", document.revision, document.revision, results, null) };
}
