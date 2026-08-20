import type { CreativeWorkspaceGenerationTask, DesignSurfaceBinding } from "@/lib/creative-workspace";
import { createDesignImageResultPlan, designDocumentHasImageResult, resolveDesignImagePlacement, type DesignDocument, type DesignImageResultPlan, type DesignPoint } from "@/lib/design";

import type { DesignEditorSelection } from "./design-editor-commands";

export type DesignImageTaskDecision =
    Readonly<{ kind: "ignore"; reason: string }> | Readonly<{ kind: "replayed"; affectedIds: readonly string[] }> | Readonly<{ kind: "pending-placement"; reason: string; canPlace?: boolean }> | Readonly<{ kind: "ready"; plan: DesignImageResultPlan }>;

export function designGenerationBinding(document: DesignDocument, selection: DesignEditorSelection, projectId: string): DesignSurfaceBinding {
    const source = selectedImage(document, selection);
    if (source) {
        return Object.freeze({
            surface: "design",
            projectId,
            baseRevision: document.revision,
            target: source.frameId ? Object.freeze({ scope: "frame" as const, frameId: source.frameId }) : Object.freeze({ scope: "workspace" as const }),
            elementId: source.id,
            assetVersionId: source.assetVersionId,
        });
    }
    if (selection?.kind === "frame" && document.frames.some((frame) => frame.id === selection.id)) {
        return Object.freeze({ surface: "design", projectId, baseRevision: document.revision, target: Object.freeze({ scope: "frame" as const, frameId: selection.id }) });
    }
    return Object.freeze({ surface: "design", projectId, baseRevision: document.revision, target: Object.freeze({ scope: "workspace" as const }) });
}

export function decideDesignImageTaskCommit(document: DesignDocument, task: CreativeWorkspaceGenerationTask, sceneCenter: DesignPoint, placementRevision?: number): DesignImageTaskDecision {
    if ((task.type !== "image" && task.type !== "image_process") || task.status !== "succeeded") return { kind: "ignore", reason: "任务尚未生成永久图片结果" };
    if (!task.imageResult) return { kind: "ignore", reason: "任务结果尚未登记为永久媒体" };
    const binding = task.binding;
    if (!binding || binding.surface !== "design" || binding.projectId !== document.id) return { kind: "ignore", reason: "任务不属于当前 Design 画板" };
    const existing = designDocumentHasImageResult(document, task.id);
    if (existing) return { kind: "replayed", affectedIds: [existing.assetId, existing.assetVersionId, ...(existing.elementId ? [existing.elementId] : [])] };
    if (binding.elementId && binding.assetVersionId) {
        const source = document.elements.find((element) => element.id === binding.elementId);
        if (!source || source.kind !== "image") return { kind: "pending-placement", reason: "任务源图片已删除，旧结果不能写回", canPlace: false };
        if (source.assetVersionId !== binding.assetVersionId) return { kind: "pending-placement", reason: "任务源图片版本已变化，旧结果不能写回", canPlace: false };
    }
    if (placementRevision === undefined && (binding.baseRevision === undefined || binding.baseRevision !== document.revision)) {
        return { kind: "pending-placement", reason: binding.baseRevision === undefined ? "任务缺少提交时的画板 revision，需要确认放置位置" : `画板已从 r${binding.baseRevision} 更新为 r${document.revision}，结果等待放置` };
    }

    try {
        const placement = resolveDesignImagePlacement(document, binding.target.scope === "frame" ? { kind: "frame", id: binding.target.frameId } : null, sceneCenter, { width: task.imageResult.width, height: task.imageResult.height });
        const requestId = placementRevision === undefined ? task.id : `${task.id}-placement-r${placementRevision}`;
        const plan = createDesignImageResultPlan(document, {
            requestId,
            generationTaskId: task.id,
            name: task.type === "image_process" ? "抠图结果" : task.kind === "edit" ? "AI 派生图" : "AI 生成图",
            locator: { kind: "storage-key", storageKey: task.imageResult.storageKey },
            mimeType: task.imageResult.mimeType,
            width: task.imageResult.width,
            height: task.imageResult.height,
            createdAt: new Date(task.updatedAt || task.createdAt).toISOString(),
            target: placement.target,
            position: placement.position,
            sourceElementId: binding.elementId,
            operation: task.type === "image_process" ? "background-removal" : task.kind === "edit" ? "edit" : "generate",
        });
        return { kind: "ready", plan };
    } catch (error) {
        return { kind: "pending-placement", reason: error instanceof Error && error.message ? error.message : "生成结果暂时无法放置", canPlace: false };
    }
}

export function selectedDesignReference(document: DesignDocument, selection: DesignEditorSelection) {
    const element = selectedImage(document, selection);
    if (!element) return null;
    const version = document.assetVersions.find((candidate) => candidate.id === element.assetVersionId);
    return version ? { element, version } : null;
}

function selectedImage(document: DesignDocument, selection: DesignEditorSelection) {
    if (selection?.kind !== "elements" || selection.ids.length !== 1) return null;
    const element = document.elements.find((candidate) => candidate.id === selection.ids[0]);
    return element?.kind === "image" ? element : null;
}
