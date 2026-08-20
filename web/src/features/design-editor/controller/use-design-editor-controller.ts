"use client";

import { useCallback, useRef } from "react";

import {
    createDesignFrameExportPlan,
    createDesignImageImportBatch,
    resolveDesignImagePlacement,
    type DesignImageImportInput,
    type DesignDocument,
    type DesignFrameExportOptions,
    type DesignFrameExportPlan,
    type DesignOperation,
    type DesignOperationScope,
    type DesignTransform,
    type DesignViewport,
} from "@/lib/design";

import type { DesignFabricAdapter, DesignFabricTransformIntent } from "../fabric/design-fabric-adapter";
import {
    alignDesignElements,
    createElementOperation,
    createFrameOperation,
    distributeDesignElements,
    moveDesignElementsToScope,
    reorderDesignElements,
    type DesignAlignment,
    type DesignCreatableElementKind,
    type DesignDistribution,
    type DesignEditorSelection,
    type DesignLayerReorder,
} from "../model/design-editor-commands";
import type { DesignEditorStore } from "../store/design-editor-store";

type DesignEditorNotifier = {
    info: (content: string) => unknown;
    warning: (content: string) => unknown;
};

type UseDesignEditorControllerOptions = {
    store: DesignEditorStore;
    notify: DesignEditorNotifier;
};

type UpdateFramePatch = Extract<DesignOperation, { type: "update-frame" }>["patch"];
type UpdateElementPatch = Extract<DesignOperation, { type: "update-element" }>["patch"];
type UpdateTextPatch = Extract<DesignOperation, { type: "update-text" }>["patch"];
type UpdateShapePatch = Extract<DesignOperation, { type: "update-shape" }>["patch"];
type UpdateLinePatch = Extract<DesignOperation, { type: "update-line" }>["patch"];
type UpdateArrowPatch = Extract<DesignOperation, { type: "update-arrow" }>["patch"];
type SelectedElementOperationType = "update-element" | "update-text" | "update-shape" | "update-line" | "update-arrow";
export type DesignEditorImageImportInput = Omit<DesignImageImportInput, "target" | "position" | "displaySize">;

/**
 * Coordinates Design-domain commands while leaving document ownership,
 * optimistic revisions, history and persistence inside DesignEditorStore.
 */
export function useDesignEditorController({ store, notify }: UseDesignEditorControllerOptions) {
    const adapterRef = useRef<DesignFabricAdapter | null>(null);

    const handleAdapterReady = useCallback((adapter: DesignFabricAdapter | null) => {
        adapterRef.current = adapter;
    }, []);

    const sceneCenter = useCallback(() => {
        const document = store.getState().project?.document;
        return document ? (adapterRef.current?.workspaceCenter(document.workspace.viewport) ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
    }, [store]);

    const dispatchOne = useCallback(
        (label: string, operation: DesignOperation) => {
            const applied = store.getState().dispatch(label, [operation]);
            if (!applied) notify.warning("当前操作未通过文档校验或暂时不能执行");
            return applied;
        },
        [notify, store],
    );

    const dispatchMany = useCallback(
        (label: string, operations: DesignOperation[]) => {
            if (!operations.length) {
                notify.info("当前选择没有可执行的变化");
                return false;
            }
            const applied = store.getState().dispatch(label, operations);
            if (!applied) notify.warning("当前操作未通过文档校验或暂时不能执行");
            return applied;
        },
        [notify, store],
    );

    const updateViewport = useCallback(
        (viewport: DesignViewport, label: string) => {
            const current = store.getState().project?.document.workspace.viewport;
            if (!current || sameDesignViewport(current, viewport)) return;
            store.getState().dispatch(label, [{ opId: `op-${clientId()}`, type: "update-workspace", patch: { viewport } }], { history: "ignore" });
        },
        [store],
    );

    const handleViewportCommit = useCallback((viewport: DesignViewport) => updateViewport(viewport, "调整画板视口"), [updateViewport]);

    const handleSelectionChange = useCallback((selection: DesignEditorSelection) => store.getState().select(selection), [store]);

    const handleTransformCommit = useCallback(
        (intent: DesignFabricTransformIntent) => {
            if (intent.kind === "frame") {
                dispatchOne("变换画框", { opId: `op-${clientId()}`, type: "update-frame", frameId: intent.id, patch: intent.patch });
                return;
            }
            if (intent.kind === "elements") {
                const operations: DesignOperation[] = intent.transforms.map(({ id, transform }) => ({ opId: `op-${clientId()}`, type: "update-transform", elementId: id, transform }));
                if (!store.getState().dispatch("移动多个元素", operations)) notify.warning("多选移动未通过文档校验或包含锁定元素");
                return;
            }
            dispatchOne("变换元素", { opId: `op-${clientId()}`, type: "update-transform", elementId: intent.id, transform: intent.transform });
        },
        [dispatchOne, notify, store],
    );

    const createFrame = useCallback(() => {
        const document = store.getState().project?.document;
        if (!document) return;
        const center = adapterRef.current?.workspaceCenter(document.workspace.viewport) ?? { x: 0, y: 0 };
        const id = `frame-${clientId()}`;
        if (dispatchOne("创建画框", createFrameOperation(document, id, `op-${clientId()}`, center))) store.getState().select({ kind: "frame", id });
    }, [dispatchOne, store]);

    const createElement = useCallback(
        (kind: DesignCreatableElementKind) => {
            const current = store.getState();
            const document = current.project?.document;
            if (!document) return;
            const center = adapterRef.current?.workspaceCenter(document.workspace.viewport) ?? { x: 0, y: 0 };
            const id = `element-${clientId()}`;
            if (dispatchOne("创建基础元素", createElementOperation(document, current.selection, kind, id, `op-${clientId()}`, center))) current.select({ kind: "elements", ids: [id] });
        },
        [dispatchOne, store],
    );

    const importImage = useCallback(
        (input: DesignEditorImageImportInput) => {
            const current = store.getState();
            const document = current.project?.document;
            if (!document) return false;
            const center = adapterRef.current?.workspaceCenter(document.workspace.viewport) ?? { x: 0, y: 0 };
            try {
                const placement = resolveDesignImagePlacement(document, current.selection, center, { width: input.width, height: input.height });
                const batch = createDesignImageImportBatch(document, { ...input, ...placement });
                if (!current.dispatchBatch(batch)) {
                    notify.warning("图片未通过文档校验或当前暂时不能导入");
                    return false;
                }
                const createElement = batch.operations.find((operation) => operation.type === "create-element");
                if (createElement?.type === "create-element") current.select({ kind: "elements", ids: [createElement.element.id] });
                return true;
            } catch (error) {
                notify.warning(error instanceof Error && error.message ? error.message : "图片导入失败");
                return false;
            }
        },
        [notify, store],
    );

    const removeSelection = useCallback(() => {
        const current = store.getState();
        const selection = current.selection;
        const document = current.project?.document;
        if (!selection || !document) return;
        if (selection.kind === "elements") {
            const elements = selection.ids.map((id) => document.elements.find((candidate) => candidate.id === id));
            if (elements.some((element) => !element || element.locked)) {
                notify.warning("锁定元素需先解锁");
                return;
            }
            if (dispatchOne(selection.ids.length > 1 ? "删除多个元素" : "删除元素", { opId: `op-${clientId()}`, type: "delete-elements", elementIds: selection.ids })) current.select(null);
            return;
        }
        const frame = document.frames.find((candidate) => candidate.id === selection.id);
        if (!frame || frame.locked) {
            notify.warning("锁定画框需先解锁");
            return;
        }
        if (document.elements.some((element) => element.frameId === selection.id)) {
            notify.warning("画框中仍有元素，本阶段不会级联删除");
            return;
        }
        if (dispatchOne("删除空画框", { opId: `op-${clientId()}`, type: "delete-frame", frameId: selection.id, deleteElements: false })) current.select(null);
    }, [dispatchOne, notify, store]);

    const patchFrame = useCallback(
        (patch: UpdateFramePatch) => {
            const selection = store.getState().selection;
            if (selection?.kind === "frame") dispatchOne("编辑画框属性", { opId: `op-${clientId()}`, type: "update-frame", frameId: selection.id, patch });
        },
        [dispatchOne, store],
    );

    const patchTransform = useCallback(
        (patch: Partial<DesignTransform>) => {
            const current = store.getState();
            if (current.selection?.kind !== "elements" || current.selection.ids.length !== 1) return;
            const elementId = current.selection.ids[0];
            const element = current.project?.document.elements.find((candidate) => candidate.id === elementId);
            if (element) dispatchOne("编辑元素变换", { opId: `op-${clientId()}`, type: "update-transform", elementId: element.id, transform: { ...element.transform, ...patch } });
        },
        [dispatchOne, store],
    );

    const dispatchSelectedElement = useCallback(
        (label: string, type: SelectedElementOperationType, patch: Record<string, unknown>) => {
            const selection = store.getState().selection;
            if (selection?.kind === "elements" && selection.ids.length === 1) dispatchOne(label, { opId: `op-${clientId()}`, type, elementId: selection.ids[0], patch } as DesignOperation);
        },
        [dispatchOne, store],
    );

    const patchElement = useCallback((patch: UpdateElementPatch) => dispatchSelectedElement("编辑元素属性", "update-element", patch), [dispatchSelectedElement]);
    const patchText = useCallback((patch: UpdateTextPatch) => dispatchSelectedElement("编辑文字样式", "update-text", patch), [dispatchSelectedElement]);
    const patchShape = useCallback((patch: UpdateShapePatch) => dispatchSelectedElement("编辑形状样式", "update-shape", patch), [dispatchSelectedElement]);
    const patchLine = useCallback((patch: UpdateLinePatch) => dispatchSelectedElement("编辑线条样式", "update-line", patch), [dispatchSelectedElement]);
    const patchArrow = useCallback((patch: UpdateArrowPatch) => dispatchSelectedElement("编辑箭头样式", "update-arrow", patch), [dispatchSelectedElement]);

    const selectedElementIds = useCallback(() => {
        const selection = store.getState().selection;
        return selection?.kind === "elements" ? selection.ids : [];
    }, [store]);

    const alignSelection = useCallback(
        (alignment: DesignAlignment) => {
            const document = store.getState().project?.document;
            if (document) dispatchMany("对齐元素", alignDesignElements(document, selectedElementIds(), alignment, clientId));
        },
        [dispatchMany, selectedElementIds, store],
    );

    const distributeSelection = useCallback(
        (distribution: DesignDistribution) => {
            const document = store.getState().project?.document;
            if (document) dispatchMany("分布元素", distributeDesignElements(document, selectedElementIds(), distribution, clientId));
        },
        [dispatchMany, selectedElementIds, store],
    );

    const reorderSelection = useCallback(
        (direction: DesignLayerReorder) => {
            const document = store.getState().project?.document;
            if (!document) return;
            const operation = reorderDesignElements(document, selectedElementIds(), direction, clientId);
            if (operation) dispatchOne("调整图层顺序", operation);
            else notify.info("已到达图层边界，或选择中包含锁定元素");
        },
        [dispatchOne, notify, selectedElementIds, store],
    );

    const moveSelectionScope = useCallback(
        (target: DesignOperationScope) => {
            const document = store.getState().project?.document;
            if (document) dispatchMany("移动元素作用域", moveDesignElementsToScope(document, selectedElementIds(), target, clientId));
        },
        [dispatchMany, selectedElementIds, store],
    );

    const patchElementById = useCallback((elementId: string, patch: UpdateElementPatch) => dispatchOne("编辑图层状态", { opId: `op-${clientId()}`, type: "update-element", elementId, patch }), [dispatchOne]);

    const zoomBy = useCallback(
        (factor: number) => {
            const document = store.getState().project?.document;
            if (!document) return;
            const viewport = designViewportAfterZoom(document.workspace.viewport, factor);
            updateViewport(viewport, factor > 1 ? "放大画板" : "缩小画板");
        },
        [store, updateViewport],
    );

    const fit = useCallback(() => {
        const document = store.getState().project?.document;
        const adapter = adapterRef.current;
        if (document && adapter) updateViewport(adapter.fitViewport(document), "适应画板内容");
    }, [store, updateViewport]);

    const createFrameExportPlan = useCallback(
        (frameId: string, options: DesignFrameExportOptions): DesignFrameExportPlan => {
            const document = store.getState().project?.document;
            if (!document) throw new Error("Design 项目尚未载入");
            return createDesignFrameExportPlan(document, frameId, options);
        },
        [store],
    );

    const exportFrame = useCallback(async (plan: DesignFrameExportPlan) => {
        const adapter = adapterRef.current;
        if (!adapter) throw new Error("Design 画布尚未准备好");
        return adapter.exportFrame(plan);
    }, []);

    const previewFrame = useCallback(async (frameId: string, options: Pick<DesignFrameExportPlan, "format" | "background">) => {
        const adapter = adapterRef.current;
        if (!adapter) throw new Error("Design 画布尚未准备好");
        return adapter.previewFrame(frameId, options);
    }, []);

    const persistFrameExportSettings = useCallback(
        (frameIds: readonly string[], options: DesignFrameExportOptions) => {
            const document = store.getState().project?.document;
            if (!document) return false;
            const operations = createDesignFrameExportPreferenceOperations(document, frameIds, options);
            return operations.length ? dispatchMany("更新导出设置", operations) : true;
        },
        [dispatchMany, store],
    );

    return {
        handleAdapterReady,
        sceneCenter,
        handleViewportCommit,
        handleSelectionChange,
        handleTransformCommit,
        createFrame,
        createElement,
        importImage,
        removeSelection,
        patchFrame,
        patchTransform,
        patchElement,
        patchText,
        patchShape,
        patchLine,
        patchArrow,
        alignSelection,
        distributeSelection,
        reorderSelection,
        moveSelectionScope,
        patchElementById,
        zoomBy,
        fit,
        createFrameExportPlan,
        exportFrame,
        previewFrame,
        persistFrameExportSettings,
    };
}

export function sameDesignViewport(left: DesignViewport, right: DesignViewport) {
    return left.x === right.x && left.y === right.y && left.zoom === right.zoom;
}

export function designViewportAfterZoom(viewport: DesignViewport, factor: number): DesignViewport {
    const nextZoom = Math.min(8, Math.max(0.05, viewport.zoom * factor));
    return { ...viewport, zoom: Math.round(nextZoom * 1000) / 1000 };
}

export function createDesignFrameExportPreferenceOperations(document: DesignDocument, frameIds: readonly string[], options: DesignFrameExportOptions, createId: () => string = clientId) {
    return frameIds.flatMap((frameId) => {
        const frame = document.frames.find((candidate) => candidate.id === frameId);
        if (!frame || frame.locked) return [];
        const next = { ...frame.export, ...options };
        if (next.format === frame.export.format && next.scale === frame.export.scale && next.quality === frame.export.quality && next.background === frame.export.background) return [];
        return [{ opId: `op-${createId()}`, type: "update-frame" as const, frameId, patch: { export: next } }];
    });
}

function clientId() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
