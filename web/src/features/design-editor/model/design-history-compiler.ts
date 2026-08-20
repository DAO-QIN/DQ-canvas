import { DESIGN_LIMITS, type DesignAnnotation, type DesignDocument, type DesignElement, type DesignFrame, type DesignGuide, type DesignOperation, type DesignOperationScope } from "@/lib/design";

export class DesignHistoryCompileError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DesignHistoryCompileError";
    }
}

type DesignOperationWithoutId = DesignOperation extends infer Operation ? (Operation extends DesignOperation ? Omit<Operation, "opId"> : never) : never;

/**
 * Compiles a semantic document transition back into the public typed operation
 * protocol. Revisions, timestamps and array storage order are deliberately not
 * restored: a history action is a new persisted transaction, not time travel.
 */
export function compileDesignHistoryTransition(current: DesignDocument, target: DesignDocument, createId: () => string): DesignOperation[] {
    if (current.id !== target.id || current.schemaVersion !== target.schemaVersion) throw new DesignHistoryCompileError("历史目标不属于当前 Design Document");

    const operations: DesignOperation[] = [];
    const op = (value: DesignOperationWithoutId) => operations.push({ opId: `op-${createId()}`, ...value } as DesignOperation);
    const currentFrames = byId(current.frames);
    const targetFrames = byId(target.frames);
    const currentGuides = byId(current.guides);
    const targetGuides = byId(target.guides);
    const currentElements = byId(current.elements);
    const targetElements = byId(target.elements);
    const unlockedFrames = new Set<string>();
    const unlockedGuides = new Set<string>();
    const unlockedElements = new Set<string>();

    compileAssets(current, target, op);

    if (!same(current.workspace, target.workspace)) op({ type: "update-workspace", patch: clone(target.workspace) });

    // Unlock changed entities first. A valid historical transition may have
    // unlocked, edited and re-locked an entity inside one atomic batch.
    for (const frame of current.frames)
        if (frame.locked && frameNeedsMutation(frame, targetFrames.get(frame.id))) {
            unlockedFrames.add(frame.id);
            op({ type: "update-frame", frameId: frame.id, patch: { locked: false } });
        }
    for (const guide of current.guides)
        if (guide.locked && guideNeedsMutation(guide, targetGuides.get(guide.id))) {
            unlockedGuides.add(guide.id);
            op({ type: "update-guide", guideId: guide.id, patch: { locked: false } });
        }
    for (const element of current.elements)
        if (element.locked && elementNeedsMutation(current, element, target, targetElements.get(element.id))) {
            unlockedElements.add(element.id);
            op({ type: "update-element", elementId: element.id, patch: { locked: false } });
        }

    compileAnnotationDeletes(current.annotations, target.annotations, op);
    for (const guide of current.guides) if (!targetGuides.has(guide.id)) op({ type: "delete-guide", guideId: guide.id });
    const deletedElementIds = current.elements.filter((element) => !targetElements.has(element.id)).map((element) => element.id);
    if (deletedElementIds.length) op({ type: "delete-elements", elementIds: deletedElementIds });
    for (const frame of current.frames) if (!targetFrames.has(frame.id)) op({ type: "delete-frame", frameId: frame.id, deleteElements: false });

    target.frames.forEach((frame, index) => {
        const previous = currentFrames.get(frame.id);
        if (!previous) op({ type: "create-frame", frame: { ...clone(frame), locked: false }, index });
        else {
            const patch = changedPick(previous, frame, ["name", "x", "y", "width", "height", "background", "export"] as const);
            if (Object.keys(patch).length) op({ type: "update-frame", frameId: frame.id, patch });
        }
    });

    for (const guide of target.guides) {
        const previous = currentGuides.get(guide.id);
        if (!previous) op({ type: "create-guide", guide: { ...clone(guide), locked: false } });
        else {
            const patch = changedPick(previous, guide, ["axis", "position", "frameId"] as const);
            if (Object.keys(patch).length) op({ type: "update-guide", guideId: guide.id, patch });
        }
    }

    for (const element of target.elements) {
        const previous = currentElements.get(element.id);
        if (!previous) op({ type: "create-element", element: { ...clone(element), locked: false }, index: 0 });
        else compileElementUpdates(previous, element, op);
    }

    const movedByScope = new Map<string, { target: DesignOperationScope; ids: string[] }>();
    for (const element of target.elements) {
        const previous = currentElements.get(element.id);
        if (!previous || previous.frameId === element.frameId) continue;
        const targetScope = scopeFor(element.frameId);
        const key = scopeKey(targetScope);
        const group = movedByScope.get(key) ?? { target: targetScope, ids: [] };
        group.ids.push(element.id);
        movedByScope.set(key, group);
    }
    for (const group of movedByScope.values()) op({ type: "move-elements", elementIds: group.ids, target: group.target, index: 0 });

    for (const layer of target.layers) {
        const scope = layer.scope === "workspace" ? ({ scope: "workspace" } as const) : ({ scope: "frame", frameId: layer.frameId } as const);
        const previous = current.layers.find((candidate) => scopeKey(candidate) === scopeKey(scope));
        if (!previous || !same(previous.elementIds, layer.elementIds)) op({ type: "reorder-elements", target: scope, elementIds: [...layer.elementIds] });
    }

    compileAnnotationCreatesAndUpdates(current.annotations, target.annotations, op);

    // Locks are applied last so all semantic restoration operations can run.
    for (const frame of target.frames) if (frame.locked && (currentFrames.get(frame.id)?.locked !== true || unlockedFrames.has(frame.id))) op({ type: "update-frame", frameId: frame.id, patch: { locked: true } });
    for (const guide of target.guides) if (guide.locked && (currentGuides.get(guide.id)?.locked !== true || unlockedGuides.has(guide.id))) op({ type: "update-guide", guideId: guide.id, patch: { locked: true } });
    for (const element of target.elements) if (element.locked && (currentElements.get(element.id)?.locked !== true || unlockedElements.has(element.id))) op({ type: "update-element", elementId: element.id, patch: { locked: true } });

    if (!operations.length) throw new DesignHistoryCompileError("历史目标与当前文档没有可恢复的语义差异");
    if (operations.length > DESIGN_LIMITS.maxOperationsPerBatch) throw new DesignHistoryCompileError(`历史恢复需要 ${operations.length} 个操作，超过单批次上限 ${DESIGN_LIMITS.maxOperationsPerBatch}`);
    return operations;
}

function compileElementUpdates(current: DesignElement, target: DesignElement, op: (operation: DesignOperationWithoutId) => void) {
    if (current.kind !== target.kind) throw new DesignHistoryCompileError(`元素类型不可变：${current.id}`);
    if (current.frameId !== target.frameId) {
        // frameId is restored by move-elements; transform remains local to the target scope.
    }
    if (!same(current.transform, target.transform)) op({ type: "update-transform", elementId: target.id, transform: clone(target.transform) });
    const common = changedPick(current, target, ["name", "opacity", "hidden"] as const);
    if (Object.keys(common).length) op({ type: "update-element", elementId: target.id, patch: common });
    if (target.kind === "text" && current.kind === "text") {
        const patch = changedPick(current, target, ["text", "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "align", "verticalAlign", "fill", "stroke", "strokeWidth"] as const);
        if (Object.keys(patch).length) op({ type: "update-text", elementId: target.id, patch });
    } else if (target.kind === "shape" && current.kind === "shape") {
        if (current.shape !== target.shape) throw new DesignHistoryCompileError(`形状类型不可变：${current.id}`);
        const patch = changedPick(current, target, ["fill", "stroke", "strokeWidth", "cornerRadius"] as const);
        if (Object.keys(patch).length) op({ type: "update-shape", elementId: target.id, patch });
    } else if (target.kind === "line" && current.kind === "line") {
        const patch = changedPick(current, target, ["stroke", "strokeWidth", "dash", "cap"] as const);
        if (Object.keys(patch).length) op({ type: "update-line", elementId: target.id, patch });
    } else if (target.kind === "arrow" && current.kind === "arrow") {
        const patch = changedPick(current, target, ["stroke", "strokeWidth", "dash", "startHead", "endHead"] as const);
        if (Object.keys(patch).length) op({ type: "update-arrow", elementId: target.id, patch });
    } else if (target.kind === "image" && current.kind === "image") {
        if (current.assetVersionId !== target.assetVersionId) op({ type: "set-image-asset-version", elementId: target.id, assetVersionId: target.assetVersionId });
        if (!same(current.crop, target.crop)) op({ type: "set-image-crop", elementId: target.id, crop: clone(target.crop) });
        if (current.fit !== target.fit || current.cornerRadius !== target.cornerRadius) throw new DesignHistoryCompileError(`图片 fit/cornerRadius 尚无 typed operation：${current.id}`);
    }
}

function compileAnnotationDeletes(current: DesignAnnotation[], target: DesignAnnotation[], op: (operation: DesignOperationWithoutId) => void) {
    const targets = byId(target);
    for (const annotation of current) {
        const next = targets.get(annotation.id);
        if (!next || annotationShapeChanged(annotation, next)) op({ type: "delete-annotation", annotationId: annotation.id });
    }
}

function compileAnnotationCreatesAndUpdates(current: DesignAnnotation[], target: DesignAnnotation[], op: (operation: DesignOperationWithoutId) => void) {
    const previous = byId(current);
    for (const annotation of target) {
        const before = previous.get(annotation.id);
        if (!before || annotationShapeChanged(before, annotation)) op({ type: "add-annotation", annotation: clone(annotation) });
        else if (before.resolved !== annotation.resolved || before.updatedAt !== annotation.updatedAt) op({ type: "resolve-annotation", annotationId: annotation.id, resolved: annotation.resolved, updatedAt: annotation.updatedAt });
    }
}

function compileAssets(current: DesignDocument, target: DesignDocument, op: (operation: DesignOperationWithoutId) => void) {
    const currentAssets = byId(current.assets);
    const targetVersions = byId(target.assetVersions);
    const currentVersions = byId(current.assetVersions);
    for (const asset of current.assets) if (!target.assets.some((candidate) => candidate.id === asset.id)) throw new DesignHistoryCompileError(`typed operation 不支持删除资源：${asset.id}`);
    for (const version of current.assetVersions) if (!targetVersions.has(version.id)) throw new DesignHistoryCompileError(`typed operation 不支持删除资源版本：${version.id}`);
    for (const asset of target.assets) {
        const before = currentAssets.get(asset.id);
        if (!before) {
            const firstId = asset.versionIds[0];
            const initialVersion = firstId ? targetVersions.get(firstId) : null;
            if (!initialVersion) throw new DesignHistoryCompileError(`资源缺少初始版本：${asset.id}`);
            op({ type: "add-asset", asset: { ...clone(asset), currentVersionId: firstId, versionIds: [firstId] }, initialVersion: clone(initialVersion) });
            for (const versionId of asset.versionIds.slice(1)) {
                const version = targetVersions.get(versionId);
                if (!version) throw new DesignHistoryCompileError(`资源版本不存在：${versionId}`);
                op({ type: "add-asset-version", assetVersion: clone(version), setCurrent: false });
            }
            if (asset.currentVersionId !== firstId) op({ type: "set-current-asset-version", assetId: asset.id, assetVersionId: asset.currentVersionId });
            continue;
        }
        if (before.name !== asset.name || before.kind !== asset.kind) throw new DesignHistoryCompileError(`资源不可变字段发生变化：${asset.id}`);
        for (const versionId of before.versionIds) if (!asset.versionIds.includes(versionId)) throw new DesignHistoryCompileError(`typed operation 不支持移除资源版本：${versionId}`);
        for (const versionId of asset.versionIds) {
            if (currentVersions.has(versionId)) continue;
            const version = targetVersions.get(versionId);
            if (!version) throw new DesignHistoryCompileError(`资源版本不存在：${versionId}`);
            op({ type: "add-asset-version", assetVersion: clone(version), setCurrent: false });
        }
        if (before.currentVersionId !== asset.currentVersionId) op({ type: "set-current-asset-version", assetId: asset.id, assetVersionId: asset.currentVersionId });
    }
}

function frameNeedsMutation(current: DesignFrame, target: DesignFrame | undefined) {
    return !target || !same(current, target);
}

function guideNeedsMutation(current: DesignGuide, target: DesignGuide | undefined) {
    return !target || !same(current, target);
}

function elementNeedsMutation(currentDocument: DesignDocument, current: DesignElement, targetDocument: DesignDocument, target: DesignElement | undefined) {
    if (!target || !same(current, target)) return true;
    return scopeIndex(currentDocument, current.id) !== scopeIndex(targetDocument, current.id);
}

function scopeIndex(document: DesignDocument, elementId: string) {
    const layer = document.layers.find((candidate) => candidate.elementIds.includes(elementId));
    return layer ? `${scopeKey(layer)}:${layer.elementIds.indexOf(elementId)}` : "missing";
}

function annotationShapeChanged(left: DesignAnnotation, right: DesignAnnotation) {
    return left.text !== right.text || left.createdAt !== right.createdAt || !same(left.target, right.target);
}

function layerFor(document: DesignDocument, frameId: string | null) {
    const layer = document.layers.find((candidate) => (frameId === null ? candidate.scope === "workspace" : candidate.scope === "frame" && candidate.frameId === frameId));
    if (!layer) throw new DesignHistoryCompileError(frameId ? `Frame 图层不存在：${frameId}` : "Workspace 图层不存在");
    return layer;
}

function scopeFor(frameId: string | null): DesignOperationScope {
    return frameId === null ? { scope: "workspace" } : { scope: "frame", frameId };
}

function scopeKey(scope: { scope: "workspace" } | { scope: "frame"; frameId: string }) {
    return scope.scope === "workspace" ? "workspace" : `frame:${scope.frameId}`;
}

function byId<T extends { id: string }>(items: T[]) {
    return new Map(items.map((item) => [item.id, item]));
}

function changedPick<T extends object, K extends keyof T>(current: T, target: T, keys: readonly K[]): Partial<Pick<T, K>> {
    const patch: Partial<Pick<T, K>> = {};
    for (const key of keys) if (!same(current[key], target[key])) patch[key] = clone(target[key]);
    return patch;
}

function same(left: unknown, right: unknown) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function clone<T>(value: T): T {
    return structuredClone(value);
}
