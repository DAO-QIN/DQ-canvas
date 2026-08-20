"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import { upscaleWorkspaceImage, type WorkspaceImageAnnotationInput, type WorkspaceImageCropRect, type WorkspaceImageMaskEditPayload, type WorkspaceImageUpscaleParams } from "@/components/creative-workspace";
import { captureWorkspaceDialogTrigger, restoreWorkspaceDialogTrigger } from "@/components/creative-workspace/workspace-dialog-focus";
import { notifyGenerationTaskCreated } from "@/hooks/use-generation-task-tray";
import { DEFAULT_BACKGROUND_REMOVAL_OPTIONS } from "@/lib/background-removal-options";
import type { CreativeWorkspaceGenerationTask, DesignSurfaceBinding } from "@/lib/creative-workspace";
import type { DesignDocument, DesignPoint, DesignStableResourceLocator } from "@/lib/design";
import { cancelBackgroundRemovalTask, createBackgroundRemovalTask } from "@/services/api/background-removal";
import { cancelImageGenerationTask, createImageGenerationTask, isImageGenerationTaskDeferredError, waitForImageGenerationTask } from "@/services/api/image";
import { resolveDesignResource } from "@/services/api/design-resources";
import { imageToDataUrl, uploadImage } from "@/services/image-storage";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

import { appendDesignImageAnnotationsToPrompt, createDesignDerivedImagePlan, createDesignImageAnnotationOperation, createDesignImageCropOperation, sameDesignImageSource, selectedDesignImage } from "../model/design-image-tools";
import type { DesignEditorSelection } from "../model/design-editor-commands";
import type { DesignEditorStore } from "../store/design-editor-store";

export type DesignImageToolDialog = "crop" | "annotation" | "mask" | "upscale";
export type DesignImageToolAction = DesignImageToolDialog | "background-removal";

export type DesignImageToolSnapshot = Readonly<{
    elementId: string;
    assetVersionId: string;
    name: string;
    frameId: string | null;
    locked: boolean;
    locator: DesignStableResourceLocator;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
    width: number;
    height: number;
    crop: WorkspaceImageCropRect | null;
}>;

type DesignImageToolNotifier = {
    success: (content: string) => unknown;
    error: (content: string) => unknown;
    warning: (content: string) => unknown;
    info: (content: string) => unknown;
};

export function useDesignImageTools(input: { projectId: string; store: DesignEditorStore; enabled: boolean; notify: DesignImageToolNotifier; sceneCenter: () => DesignPoint; refetchTasks: () => Promise<unknown> }) {
    const { projectId, store, enabled, notify, sceneCenter, refetchTasks } = input;
    const config = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const documentRevision = useStore(store, (state) => state.project?.document.revision ?? -1);
    const selectionKey = useStore(store, (state) => designImageSelectionKey(state.project?.document, state.selection));
    const selectedImage = useMemo(() => selectedImageSnapshot(store.getState().project?.document, store.getState().selection), [documentRevision, selectionKey, store]);
    const [dialog, setDialog] = useState<DesignImageToolDialog | null>(null);
    const [dialogImage, setDialogImage] = useState<DesignImageToolSnapshot | null>(null);
    const [runtimeUrl, setRuntimeUrl] = useState("");
    const [loading, setLoading] = useState(false);
    const [busyAction, setBusyAction] = useState<DesignImageToolAction | null>(null);
    const loadSequence = useRef(0);
    const dialogTrigger = useRef<HTMLElement | null>(null);
    const mounted = useRef(true);
    const pollControllers = useRef(new Map<string, AbortController>());

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            loadSequence.current += 1;
            for (const controller of pollControllers.current.values()) controller.abort();
            pollControllers.current.clear();
        };
    }, []);

    const closeDialog = useCallback(() => {
        if (busyAction) return;
        loadSequence.current += 1;
        setDialog(null);
        setDialogImage(null);
        setRuntimeUrl("");
        setLoading(false);
    }, [busyAction]);

    const restoreDialogFocus = useCallback(() => {
        const trigger = dialogTrigger.current;
        dialogTrigger.current = null;
        restoreWorkspaceDialogTrigger(trigger);
    }, []);

    const openSnapshot = useCallback(
        (nextDialog: DesignImageToolDialog, snapshot: DesignImageToolSnapshot) => {
            if (!enabled) return false;
            try {
                assertImageToolAvailable(store, snapshot);
            } catch (error) {
                notify.warning(errorMessage(error, "当前图片暂时不能编辑"));
                return false;
            }
            const sequence = ++loadSequence.current;
            dialogTrigger.current = captureWorkspaceDialogTrigger();
            setDialog(nextDialog);
            setDialogImage(snapshot);
            setRuntimeUrl("");
            setLoading(true);
            void resolveDesignResource(snapshot.locator, { purpose: "editor" })
                .then((resource) => {
                    if (!mounted.current || sequence !== loadSequence.current) return;
                    assertImageToolAvailable(store, snapshot);
                    setRuntimeUrl(resource.url);
                })
                .catch((error) => {
                    if (!mounted.current || sequence !== loadSequence.current) return;
                    setDialog(null);
                    setDialogImage(null);
                    setRuntimeUrl("");
                    notify.error(errorMessage(error, "画板图片读取失败"));
                })
                .finally(() => {
                    if (mounted.current && sequence === loadSequence.current) setLoading(false);
                });
            return true;
        },
        [enabled, notify, store],
    );

    const openSelected = useCallback(
        (nextDialog: DesignImageToolDialog) => {
            const snapshot = selectedImageSnapshot(store.getState().project?.document, store.getState().selection);
            if (!snapshot) {
                notify.info("请先单选一张图片");
                return false;
            }
            return openSnapshot(nextDialog, snapshot);
        },
        [notify, openSnapshot, store],
    );

    const openCrop = useCallback(() => openSelected("crop"), [openSelected]);
    const openAnnotation = useCallback(() => openSelected("annotation"), [openSelected]);
    const openMask = useCallback(() => openSelected("mask"), [openSelected]);
    const openUpscale = useCallback(() => openSelected("upscale"), [openSelected]);

    const confirmCrop = useCallback(
        (crop: WorkspaceImageCropRect) => {
            if (!dialogImage || dialog !== "crop" || busyAction) return false;
            try {
                assertImageToolAvailable(store, dialogImage);
                if (!store.getState().dispatch("裁剪图片", [createDesignImageCropOperation(dialogImage.elementId, crop)])) throw new Error("裁剪操作未通过画板校验");
                setDialog(null);
                setDialogImage(null);
                setRuntimeUrl("");
                notify.success("图片裁剪已应用");
                return true;
            } catch (error) {
                notify.error(errorMessage(error, "图片裁剪失败"));
                return false;
            }
        },
        [busyAction, dialog, dialogImage, notify, store],
    );

    const confirmAnnotation = useCallback(
        (annotation: WorkspaceImageAnnotationInput) => {
            if (!dialogImage || dialog !== "annotation" || busyAction) return false;
            try {
                assertImageToolAvailable(store, dialogImage);
                if (!store.getState().dispatch("添加图片批注", [createDesignImageAnnotationOperation(dialogImage.elementId, annotation)])) throw new Error("批注操作未通过画板校验");
                setDialog(null);
                setDialogImage(null);
                setRuntimeUrl("");
                notify.success("图片批注已添加");
                return true;
            } catch (error) {
                notify.error(errorMessage(error, "图片批注失败"));
                return false;
            }
        },
        [busyAction, dialog, dialogImage, notify, store],
    );

    const monitorImageTask = useCallback(
        (task: Awaited<ReturnType<typeof createImageGenerationTask>>, taskConfig: typeof config) => {
            const controller = new AbortController();
            pollControllers.current.get(task.id)?.abort();
            pollControllers.current.set(task.id, controller);
            void waitForImageGenerationTask(taskConfig, task, { signal: controller.signal })
                .catch((error) => {
                    if (mounted.current && !isImageGenerationTaskDeferredError(error) && !isAbortError(error)) notify.error(errorMessage(error, "局部编辑失败，请重新打开蒙版编辑"));
                })
                .finally(() => {
                    if (pollControllers.current.get(task.id) === controller) pollControllers.current.delete(task.id);
                    if (mounted.current) void refetchTasks();
                });
        },
        [notify, refetchTasks],
    );

    const confirmMask = useCallback(
        async (payload: WorkspaceImageMaskEditPayload) => {
            if (!dialogImage || dialog !== "mask" || busyAction || !runtimeUrl) return false;
            if (!isAiConfigReady(config, config.imageModel)) {
                openConfigDialog(true, "image");
                return false;
            }
            const snapshot = dialogImage;
            setBusyAction("mask");
            try {
                const { document } = await persistedImageSource(store, snapshot);
                const taskConfig = { ...config, model: config.imageModel };
                const binding = imageToolBinding(document, snapshot, projectId);
                const prompt = appendDesignImageAnnotationsToPrompt(document, snapshot.elementId, payload.prompt);
                const reference = imageReference(snapshot, runtimeUrl);
                const mask: ReferenceImage = { id: `${snapshot.elementId}-mask`, name: "mask.png", type: "image/png", dataUrl: payload.maskDataUrl };
                const task = await createImageGenerationTask(taskConfig, prompt, [reference], mask, {
                    logSource: "image-workbench",
                    logTitle: prompt.slice(0, 80),
                    surface: "design",
                    projectId,
                    clientRequestId: `design-mask-${clientId()}`,
                    attemptNo: 1,
                    binding,
                    validateBeforeSubmit: () => assertImageToolAvailable(store, snapshot),
                });
                notifyGenerationTaskCreated("design", projectId);
                void refetchTasks();
                try {
                    assertImageToolAvailable(store, snapshot);
                } catch {
                    try {
                        await cancelImageGenerationTask(task);
                        if (mounted.current) notify.warning("源图片已变化，局部编辑任务已取消");
                    } catch {
                        monitorImageTask(task, taskConfig);
                        if (mounted.current) notify.warning("源图片已变化，任务结果不会写回旧版本；可在任务面板取消任务");
                    }
                    if (mounted.current) {
                        setDialog(null);
                        setDialogImage(null);
                        setRuntimeUrl("");
                        void refetchTasks();
                    }
                    return false;
                }
                monitorImageTask(task, taskConfig);
                if (mounted.current) {
                    setDialog(null);
                    setDialogImage(null);
                    setRuntimeUrl("");
                    notify.success("局部编辑任务已创建");
                }
                return true;
            } catch (error) {
                if (mounted.current) notify.error(errorMessage(error, "局部编辑任务创建失败，蒙版仍保留在编辑器中"));
                return false;
            } finally {
                if (mounted.current) setBusyAction(null);
            }
        },
        [busyAction, config, dialog, dialogImage, isAiConfigReady, monitorImageTask, notify, openConfigDialog, projectId, refetchTasks, runtimeUrl, store],
    );

    const confirmUpscale = useCallback(
        async (params: WorkspaceImageUpscaleParams) => {
            if (!dialogImage || dialog !== "upscale" || busyAction || !runtimeUrl) return false;
            const snapshot = dialogImage;
            setBusyAction("upscale");
            try {
                assertImageToolAvailable(store, snapshot);
                const sourceDataUrl = await imageToDataUrl({ url: runtimeUrl, serverUrl: runtimeUrl });
                if (!sourceDataUrl.startsWith("data:image/")) throw new Error("原始图片读取失败，未生成放大图");
                const dataUrl = await upscaleWorkspaceImage(sourceDataUrl, params);
                assertImageToolAvailable(store, snapshot);
                const uploaded = await uploadImage(dataUrl);
                const { document } = assertImageToolAvailable(store, snapshot);
                const plan = createDesignDerivedImagePlan({
                    document,
                    sourceElementId: snapshot.elementId,
                    requestId: `design-upscale-${clientId()}`,
                    generationTaskId: null,
                    image: uploaded,
                    operation: "upscale",
                    name: `${snapshot.name} 放大`,
                    sceneCenter: sceneCenter(),
                });
                await store.getState().dispatchBatchAndWait(plan.batch);
                store.getState().select({ kind: "elements", ids: [plan.elementId] });
                if (mounted.current) {
                    setDialog(null);
                    setDialogImage(null);
                    setRuntimeUrl("");
                    notify.success("放大图已作为兄弟版本插入画板");
                }
                return true;
            } catch (error) {
                if (mounted.current) notify.error(errorMessage(error, "图片放大失败"));
                return false;
            } finally {
                if (mounted.current) setBusyAction(null);
            }
        },
        [busyAction, dialog, dialogImage, notify, runtimeUrl, sceneCenter, store],
    );

    const removeBackgroundFromSnapshot = useCallback(
        async (snapshot: DesignImageToolSnapshot) => {
            if (!enabled || busyAction) return false;
            setBusyAction("background-removal");
            try {
                await persistedImageSource(store, snapshot);
                await createBackgroundRemovalTask({
                    ...(snapshot.locator.kind === "storage-key" ? { sourceStorageKey: snapshot.locator.storageKey } : {}),
                    projectId,
                    surface: "design",
                    sourceElementId: snapshot.elementId,
                    sourceAssetVersionId: snapshot.assetVersionId,
                    sourceLocator: snapshot.locator,
                    options: DEFAULT_BACKGROUND_REMOVAL_OPTIONS,
                    onTaskCreated: () => notifyGenerationTaskCreated("design", projectId),
                });
                await refetchTasks();
                if (mounted.current) notify.success("抠图任务已创建");
                return true;
            } catch (error) {
                if (mounted.current) notify.error(errorMessage(error, "抠图任务创建失败"));
                return false;
            } finally {
                if (mounted.current) setBusyAction(null);
            }
        },
        [busyAction, enabled, notify, projectId, refetchTasks, store],
    );

    const removeBackground = useCallback(() => {
        const snapshot = selectedImageSnapshot(store.getState().project?.document, store.getState().selection);
        if (!snapshot) {
            notify.info("请先单选一张图片");
            return Promise.resolve(false);
        }
        return removeBackgroundFromSnapshot(snapshot);
    }, [notify, removeBackgroundFromSnapshot, store]);

    const retryBackgroundRemoval = useCallback(
        (task: CreativeWorkspaceGenerationTask) => {
            const binding = task.binding;
            if (!binding || binding.surface !== "design" || !binding.elementId || !binding.assetVersionId) {
                notify.warning("任务缺少源图片上下文，无法重新发起抠图");
                return Promise.resolve(false);
            }
            const document = store.getState().project?.document;
            if (!document || !sameDesignImageSource(document, binding.elementId, binding.assetVersionId)) {
                notify.warning("源图片已删除或版本已变化，无法重新发起旧抠图任务");
                return Promise.resolve(false);
            }
            store.getState().select({ kind: "elements", ids: [binding.elementId] });
            const snapshot = selectedImageSnapshot(document, { kind: "elements", ids: [binding.elementId] });
            return snapshot ? removeBackgroundFromSnapshot(snapshot) : Promise.resolve(false);
        },
        [notify, removeBackgroundFromSnapshot, store],
    );

    const cancelBackgroundRemoval = useCallback(
        async (task: CreativeWorkspaceGenerationTask) => {
            if (task.type !== "image_process") return false;
            try {
                await cancelBackgroundRemovalTask(task.id);
                await refetchTasks();
                notify.success("抠图任务已取消");
                return true;
            } catch (error) {
                notify.error(errorMessage(error, "抠图任务取消失败"));
                return false;
            }
        },
        [notify, refetchTasks],
    );

    const reopenMaskTask = useCallback(
        (task: CreativeWorkspaceGenerationTask) => {
            const binding = task.binding;
            if (!binding || binding.surface !== "design" || !binding.elementId || !binding.assetVersionId) {
                notify.warning("任务缺少源图片上下文，无法重新打开蒙版编辑");
                return false;
            }
            const document = store.getState().project?.document;
            if (!document || !sameDesignImageSource(document, binding.elementId, binding.assetVersionId)) {
                notify.warning("源图片已删除或版本已变化，无法重新编辑旧蒙版任务");
                return false;
            }
            store.getState().select({ kind: "elements", ids: [binding.elementId] });
            const snapshot = selectedImageSnapshot(document, { kind: "elements", ids: [binding.elementId] });
            return snapshot ? openSnapshot("mask", snapshot) : false;
        },
        [notify, openSnapshot, store],
    );

    return {
        selectedImage,
        dialogImage,
        runtimeUrl,
        loading,
        busyAction,
        dialog,
        openCrop,
        openAnnotation,
        openMask,
        openUpscale,
        removeBackground,
        closeDialog,
        restoreDialogFocus,
        confirmCrop,
        confirmAnnotation,
        confirmMask,
        confirmUpscale,
        cancelBackgroundRemoval,
        retryBackgroundRemoval,
        reopenMaskTask,
    };
}

export function selectedImageSnapshot(document: DesignDocument | undefined, selection: DesignEditorSelection): DesignImageToolSnapshot | null {
    if (!document) return null;
    const source = selectedDesignImage(document, selection);
    if (!source) return null;
    return Object.freeze({
        elementId: source.element.id,
        assetVersionId: source.version.id,
        name: source.element.name,
        frameId: source.element.frameId,
        locked: source.element.locked,
        locator: structuredClone(source.version.locator),
        mimeType: source.version.mimeType,
        width: source.version.width,
        height: source.version.height,
        crop: source.element.crop ? { ...source.element.crop } : null,
    });
}

export function imageToolBinding(document: DesignDocument, snapshot: DesignImageToolSnapshot, projectId: string): DesignSurfaceBinding {
    const { source } = assertImageSource(document, snapshot);
    return Object.freeze({
        surface: "design",
        projectId,
        baseRevision: document.revision,
        target: source.element.frameId ? Object.freeze({ scope: "frame" as const, frameId: source.element.frameId }) : Object.freeze({ scope: "workspace" as const }),
        elementId: snapshot.elementId,
        assetVersionId: snapshot.assetVersionId,
    });
}

export function isDesignMaskEditTask(task: CreativeWorkspaceGenerationTask) {
    return task.type === "image" && Boolean(task.clientRequestId?.startsWith("design-mask-"));
}

function assertImageToolAvailable(store: DesignEditorStore, snapshot: DesignImageToolSnapshot) {
    const state = store.getState();
    if (!state.project || state.status === "loading" || state.status === "not-found" || state.status === "error" || state.status === "conflict") throw new Error("画板当前不可编辑");
    return { state, ...assertImageSource(state.project.document, snapshot), document: state.project.document };
}

function assertImageSource(document: DesignDocument, snapshot: DesignImageToolSnapshot) {
    const source = selectedDesignImage(document, { kind: "elements", ids: [snapshot.elementId] });
    if (!source || source.version.id !== snapshot.assetVersionId) throw new Error("源图片已删除或版本已变化，请重新选择图片");
    if (source.element.locked) throw new Error("源图片已锁定，无法编辑");
    return { source };
}

async function persistedImageSource(store: DesignEditorStore, snapshot: DesignImageToolSnapshot) {
    assertImageToolAvailable(store, snapshot);
    await store.getState().flush();
    const result = assertImageToolAvailable(store, snapshot);
    if (result.state.status !== "saved" || result.state.pendingCount) throw new Error(result.state.errorMessage || "请等待画板保存完成后重试");
    return result;
}

function imageReference(snapshot: DesignImageToolSnapshot, runtimeUrl: string): ReferenceImage {
    return {
        id: snapshot.elementId,
        name: snapshot.name,
        type: snapshot.mimeType,
        dataUrl: runtimeUrl,
        previewUrl: runtimeUrl,
        url: runtimeUrl,
        width: snapshot.width,
        height: snapshot.height,
        ...(snapshot.locator.kind === "storage-key" ? { storageKey: snapshot.locator.storageKey } : {}),
    };
}

function designImageSelectionKey(document: DesignDocument | undefined, selection: DesignEditorSelection) {
    const snapshot = selectedImageSnapshot(document, selection);
    return snapshot ? `${snapshot.elementId}\0${snapshot.assetVersionId}\0${document?.revision ?? -1}` : "";
}

function isAbortError(error: unknown) {
    return error instanceof DOMException && error.name === "AbortError";
}

function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

function clientId() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
