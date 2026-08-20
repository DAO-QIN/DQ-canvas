"use client";

import { App, Button, Popconfirm, Tooltip } from "antd";
import {
    AlignHorizontalDistributeCenter,
    AlignHorizontalJustifyCenter,
    AlignHorizontalJustifyEnd,
    AlignHorizontalJustifyStart,
    AlignVerticalDistributeCenter,
    AlignVerticalJustifyCenter,
    AlignVerticalJustifyEnd,
    AlignVerticalJustifyStart,
    ArrowLeft,
    Download,
    Frame,
    Hand,
    ImagePlus,
    MousePointer2,
    PanelRightClose,
    Redo2,
    RefreshCw,
    Save,
    Shapes,
    Sparkles,
    Trash2,
    Type,
    Undo2,
    ZoomIn,
    ZoomOut,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useStore } from "zustand";

import {
    LibraryAssetPicker,
    WorkspaceAgentPanel,
    WorkspaceExportReview,
    WorkspaceGenerationComposer,
    WorkspaceHandoffDialog,
    WorkspaceImageAnnotationDialog,
    WorkspaceImageCropDialog,
    WorkspaceImageMaskEditDialog,
    WorkspaceImageUpscaleDialog,
    type GenerationTaskAction,
    type LibraryAssetSelection,
    type WorkspaceExportRequest,
    type WorkspaceExportReviewItem,
    type WorkspaceHandoffTargetOption,
} from "@/components/creative-workspace";
import { isCreativeWorkspaceEnabled } from "@/lib/creative-workspace/feature-flags";
import type { CreativeWorkspaceGenerationTask } from "@/lib/creative-workspace";
import { useGenerationTaskTray } from "@/hooks/use-generation-task-tray";
import { deleteDesignProject, isDesignProjectConflict } from "@/services/api/design-projects";
import { listCanvasProjectSummaries } from "@/services/api/canvas-projects";
import { uploadImage } from "@/services/image-storage";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ReferenceImage } from "@/types/image";

import { DesignEditorCreativeShell } from "./design-editor-creative-shell";
import { designWorkspaceTheme } from "./design-editor-creative-shell-theme";
import { DesignEditorInspector } from "./design-editor-inspector";
import { DesignEditorLayers } from "./design-editor-layers";
import { createDesignSaveNavigationCoordinator } from "../controller/design-save-navigation";
import { createDesignWorkspaceSnapshot, executeDesignWorkspaceActions } from "../adapter";
import { useDesignEditorController } from "../controller/use-design-editor-controller";
import { useDesignEditorShortcuts } from "../controller/use-design-editor-shortcuts";
import { useDesignEditorViewState } from "../controller/use-design-editor-view-state";
import { useDesignImageGeneration } from "../controller/use-design-image-generation";
import { isDesignMaskEditTask, useDesignImageTools } from "../controller/use-design-image-tools";
import { type DesignAlignment, type DesignCreatableElementKind, type DesignDistribution, type DesignEditorSelection } from "../model/design-editor-commands";
import { designImageMimeType } from "../model/design-image-input";
import { designHandoffSelectionIds } from "../model/design-handoff-selection";
import { createDesignFrameExportBundle } from "../model/design-frame-export";
import { createDesignEditorStore, type DesignEditorSaveStatus } from "../store/design-editor-store";

const DesignFabricSurface = dynamic(() => import("../fabric/design-fabric-surface").then((module) => module.DesignFabricSurface), { ssr: false });

export function DesignEditorWorkbench({ projectId }: { projectId: string }) {
    const router = useRouter();
    const { message, modal } = App.useApp();
    const colorTheme = useThemeStore((themeState) => themeState.theme);
    const creativeWorkspaceEnabled = isCreativeWorkspaceEnabled("design");
    const generationTaskTray = useGenerationTaskTray({ surface: "design", projectId, enabled: creativeWorkspaceEnabled });
    const store = useMemo(() => createDesignEditorStore(projectId), [projectId]);
    const state = useStore(store);
    const [deleting, setDeleting] = useState(false);
    const [importingImage, setImportingImage] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [generationPrompt, setGenerationPrompt] = useState("");
    const [generationReferences, setGenerationReferences] = useState<ReferenceImage[]>([]);
    const [exportOpen, setExportOpen] = useState(false);
    const imageInputRef = useRef<HTMLInputElement | null>(null);
    const { rightPanelOpen, rightTab, shapeMenuOpen, toggleRightPanel, setRightTab, toggleShapeMenu, closeShapeMenu } = useDesignEditorViewState();
    const controller = useDesignEditorController({ store, notify: message });
    const imageGeneration = useDesignImageGeneration({
        projectId,
        store,
        recoveryTasks: generationTaskTray.recoveryTasks,
        enabled: creativeWorkspaceEnabled,
        notify: message,
        sceneCenter: controller.sceneCenter,
        refetchTasks: generationTaskTray.refetch,
    });
    const imageTools = useDesignImageTools({
        projectId,
        store,
        enabled: creativeWorkspaceEnabled,
        notify: message,
        sceneCenter: controller.sceneCenter,
        refetchTasks: generationTaskTray.refetch,
    });
    const visibleGenerationTasks = useMemo(
        () =>
            mergeDesignGenerationTasks(
                generationTaskTray.tasks,
                generationTaskTray.recoveryTasks,
                imageGeneration.pendingPlacements.map((item) => item.task),
                projectId,
            ),
        [generationTaskTray.recoveryTasks, generationTaskTray.tasks, imageGeneration.pendingPlacements, projectId],
    );
    const pendingPlacementByTaskId = useMemo(() => new Map(imageGeneration.pendingPlacements.map((item) => [item.task.id, item])), [imageGeneration.pendingPlacements]);
    const selectedReference = imageGeneration.selectedReference;
    const composerReferences = useMemo(() => (selectedReference ? [selectedReference, ...generationReferences.filter((reference) => reference.id !== selectedReference.id)] : generationReferences), [generationReferences, selectedReference]);
    const handleComposerReferences = useCallback((references: ReferenceImage[]) => setGenerationReferences(selectedReference ? references.filter((reference) => reference.id !== selectedReference.id) : references), [selectedReference]);
    const handleGenerate = useCallback(() => {
        void imageGeneration.submit(generationPrompt, generationReferences).then((submitted) => {
            if (!submitted) return;
            setGenerationPrompt("");
            setGenerationReferences([]);
        });
    }, [generationPrompt, generationReferences, imageGeneration]);
    const getAgentSnapshot = useCallback(() => {
        const current = store.getState();
        if (!current.project) throw new Error("Design 项目尚未载入");
        return createDesignWorkspaceSnapshot(current.project.document, designSelectionIds(current.selection));
    }, [store]);
    const prepareAgentRun = useCallback(async () => {
        await store.getState().flush();
        const current = store.getState();
        if (!current.project) throw new Error("Design 项目尚未载入");
        if (current.status !== "saved" || current.pendingCount) throw new Error(current.errorMessage || "Design 保存尚未完成，暂不能创建 Agent 任务");
    }, [store]);
    const executeAgentActions = useCallback(
        async (request: Parameters<typeof executeDesignWorkspaceActions>[0]["request"]) => {
            const current = store.getState();
            if (!current.project) throw new Error("Design 项目尚未载入");
            return executeDesignWorkspaceActions({
                request,
                document: current.project.document,
                commitBatch: async (batch) => {
                    const committed = await store.getState().dispatchBatchAndWait(batch);
                    return { receipt: committed.receipt };
                },
            });
        },
        [store],
    );
    const getGenerationTaskActions = useCallback(
        (task: CreativeWorkspaceGenerationTask): readonly GenerationTaskAction[] => {
            if ((task.status === "queued" || task.status === "running" || task.status === "paused") && (task.type === "image" || task.type === "image_process")) {
                return [
                    {
                        id: "cancel",
                        label: "取消任务",
                        tone: "danger",
                        onPress: () => void (task.type === "image_process" ? imageTools.cancelBackgroundRemoval(task) : imageGeneration.cancel(task)),
                    },
                ];
            }
            if (task.status === "failed" && task.type === "image" && task.prompt) {
                if (isDesignMaskEditTask(task)) return [{ id: "reopen-mask", label: "重新打开蒙版编辑", onPress: () => void imageTools.reopenMaskTask(task) }];
                return [{ id: "retry", label: "重试", onPress: () => void imageGeneration.retry(task) }];
            }
            if (task.status === "failed" && task.type === "image_process") {
                return [{ id: "retry-background-removal", label: "重新发起抠图", onPress: () => void imageTools.retryBackgroundRemoval(task) }];
            }
            const pending = pendingPlacementByTaskId.get(task.id);
            if (!pending) return [];
            return [
                {
                    id: "place",
                    label: imageGeneration.committingTaskIds.includes(task.id) ? "正在放置" : "放置到当前画板",
                    disabled: !pending.canPlace,
                    busy: imageGeneration.committingTaskIds.includes(task.id),
                    onPress: () => void imageGeneration.place(task),
                },
            ];
        },
        [imageGeneration, imageTools, pendingPlacementByTaskId],
    );
    const getGenerationTaskNotice = useCallback(
        (task: CreativeWorkspaceGenerationTask) => pendingPlacementByTaskId.get(task.id)?.reason || (task.status === "failed" && isDesignMaskEditTask(task) ? "蒙版不会写入任务记录；请重新打开编辑器绘制后再发起。" : undefined),
        [pendingPlacementByTaskId],
    );
    const handleCreateElement = useCallback(
        (kind: DesignCreatableElementKind) => {
            closeShapeMenu();
            controller.createElement(kind);
        },
        [closeShapeMenu, controller],
    );
    const backNavigation = useMemo(
        () =>
            createDesignSaveNavigationCoordinator({
                getStatus: () => store.getState().status,
                flush: () => store.getState().flush(),
                navigate: () => router.push("/design"),
                onFailure: ({ status, error }) => {
                    if (status === "conflict") {
                        message.warning("画板存在版本冲突，请先处理后再返回");
                        return;
                    }
                    if (status === "error" || error) {
                        message.error(store.getState().errorMessage || errorMessage(error, "画板保存失败，仍停留在当前画板"));
                        return;
                    }
                    message.warning("画板尚未保存，请稍后重试");
                },
            }),
        [message, router, store],
    );

    const handleBackToProjects = useCallback(() => {
        void backNavigation.navigate();
    }, [backNavigation]);

    useEffect(() => {
        void store.getState().load();
        return () => store.getState().destroy();
    }, [store]);

    useEffect(() => {
        if (!requiresLeaveProtection(state.status)) return;
        const protect = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", protect);
        return () => window.removeEventListener("beforeunload", protect);
    }, [state.status]);

    useDesignEditorShortcuts({
        store,
        notify: message,
        removeSelection: controller.removeSelection,
        openExport: () => {
            if (!store.getState().project?.document.frames.length) {
                message.info("请先创建画框");
                return;
            }
            setExportOpen(true);
        },
    });

    const remove = async () => {
        const project = store.getState().project;
        if (!project || deleting || state.status !== "saved") return;
        setDeleting(true);
        try {
            await deleteDesignProject(project.id, project.revision);
            message.success("画板已删除");
            router.replace("/design");
        } catch (error) {
            if (isDesignProjectConflict(error)) {
                message.warning("画板已在其他位置更新，请载入服务端版本后再删除");
                await store.getState().load();
            } else message.error(errorMessage(error, "画板删除失败"));
        } finally {
            setDeleting(false);
        }
    };

    const confirmRemove = () => {
        const current = store.getState();
        if (!current.project || current.status !== "saved" || deleting) return;
        modal.confirm({
            title: "删除当前画板？",
            content: "共享素材不会随项目删除。",
            okText: "删除",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: remove,
        });
    };

    const handleImageUpload = useCallback(
        async (event: ChangeEvent<HTMLInputElement>) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file || importingImage) return;
            setImportingImage(true);
            try {
                const mimeType = designImageMimeType(file.type);
                const uploaded = await uploadImage(file);
                const imported = controller.importImage({
                    requestId: `upload-${clientId()}`,
                    name: file.name.trim() || "上传图片",
                    locator: { kind: "storage-key", storageKey: uploaded.storageKey },
                    mimeType: designImageMimeType(uploaded.mimeType || mimeType),
                    width: uploaded.width,
                    height: uploaded.height,
                    createdAt: new Date().toISOString(),
                    source: "upload",
                    operation: "upload",
                });
                if (imported) message.success("图片已插入画板");
            } catch (error) {
                message.error(errorMessage(error, "图片上传失败"));
            } finally {
                setImportingImage(false);
            }
        },
        [controller, importingImage, message],
    );

    const handleLibraryAsset = useCallback(
        (selection: LibraryAssetSelection) => {
            if (selection.asset.kind !== "image") {
                message.warning("当前画板只能插入图片素材");
                return;
            }
            try {
                const imported = controller.importImage({
                    requestId: `library-${clientId()}`,
                    name: selection.asset.title,
                    locator: selection.locator,
                    mimeType: designImageMimeType(selection.asset.data.mimeType),
                    width: selection.asset.data.width,
                    height: selection.asset.data.height,
                    createdAt: new Date().toISOString(),
                    source: "library",
                    operation: "import",
                });
                if (imported) {
                    setAssetPickerOpen(false);
                    message.success("素材已插入画板");
                }
            } catch (error) {
                message.error(errorMessage(error, "素材插入失败"));
            }
        },
        [controller, message],
    );

    const exportItems = useMemo<WorkspaceExportReviewItem[]>(
        () =>
            state.project?.document.frames.map((frame) => ({
                id: frame.id,
                name: frame.name,
                width: frame.width,
                height: frame.height,
                detail: `${frame.export.format.toUpperCase()} · ${frame.export.scale}x`,
                selectedByDefault: state.selection?.kind === "frame" ? state.selection.id === frame.id : true,
            })) ?? [],
        [state.project?.document.frames, state.selection],
    );
    const initialExportSettings = useMemo(() => {
        const selectedFrameId = state.selection?.kind === "frame" ? state.selection.id : null;
        const frame = state.project?.document.frames.find((candidate) => candidate.id === selectedFrameId) ?? state.project?.document.frames[0];
        return {
            format: frame?.export.format ?? "png",
            scale: frame?.export.scale ?? 1,
            quality: frame?.export.quality ?? 1,
            background: frame?.export.background === "frame" ? "original" : (frame?.export.background ?? "original"),
        } as const;
    }, [state.project?.document.frames, state.selection]);
    const loadExportPreview = useCallback(
        (frameId: string, settings: Pick<WorkspaceExportRequest["settings"], "format" | "background">) => controller.previewFrame(frameId, { format: settings.format, background: settings.background === "original" ? "frame" : settings.background }),
        [controller],
    );
    const handleExport = useCallback(
        async (request: WorkspaceExportRequest) => {
            const current = store.getState().project?.document;
            if (!current) throw new Error("Design 项目尚未载入");
            const options = { ...request.settings, background: request.settings.background === "original" ? "frame" : request.settings.background } as const;
            const bundle = await createDesignFrameExportBundle({ document: current, frameIds: request.itemIds, options, exportFrame: controller.exportFrame, reportProgress: request.reportProgress });
            downloadBlob(bundle.blob, bundle.fileName);
            controller.persistFrameExportSettings(request.itemIds, options);
            message.success(bundle.results.length > 1 ? `已导出 ${bundle.results.length} 个画框` : `已导出 ${bundle.results[0].fileName}`);
        },
        [controller, message, store],
    );

    if (state.status === "loading") return <DesignShellState title="正在打开画板" description="正在读取服务端 Design Document…" spinning />;
    if (state.status === "not-found")
        return (
            <DesignShellState
                title="画板不存在"
                description="项目可能已被删除，或当前账号没有访问权限。"
                action={
                    <Button type="primary" onClick={() => router.replace("/design")}>
                        返回我的画板
                    </Button>
                }
            />
        );
    if (!state.project)
        return (
            <DesignShellState
                title="画板暂时无法打开"
                description={state.errorMessage || "服务端没有返回项目数据"}
                action={
                    <>
                        <Button onClick={() => router.replace("/design")}>返回项目库</Button>
                        <Button type="primary" icon={<RefreshCw className="size-4" />} onClick={() => void store.getState().load()}>
                            重试
                        </Button>
                    </>
                }
            />
        );

    const project = state.project;
    const document = project.document;
    const handoffSelectionIds = designHandoffSelectionIds(document, state.selection);
    const handoffControl = creativeWorkspaceEnabled ? (
        <WorkspaceHandoffDialog
            sourceSurface="design"
            sourceProjectId={projectId}
            sourceRevision={project.revision}
            selectionIds={handoffSelectionIds}
            selectionLabel={handoffSelectionIds.length ? "已选图片素材" : undefined}
            disabled={state.status !== "saved" || deleting || handoffSelectionIds.length === 0}
            loadTargets={async () => {
                const result = await listCanvasProjectSummaries({ page: 1, pageSize: 100 });
                return result.items.map<WorkspaceHandoffTargetOption>((item) => ({ id: item.id, title: item.title, revision: item.revision, surface: "canvas" }));
            }}
            flushSource={async () => {
                await store.getState().flush();
                const current = store.getState();
                if (current.status !== "saved" || current.pendingCount) throw new Error(current.errorMessage || "Design 保存尚未完成");
            }}
            getCurrentRevision={() => store.getState().confirmedRevision ?? store.getState().project?.revision ?? 0}
            onOpenTarget={(target) => router.push(`/canvas/${target.id}`)}
        />
    ) : null;
    const workspaceZoom = Math.round(document.workspace.viewport.zoom * 100);
    const savePresentation = saveStatus(state.status, state.errorMessage);

    if (creativeWorkspaceEnabled) {
        return (
            <>
                <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="选择要上传的图片" onChange={handleImageUpload} />
                <DesignEditorCreativeShell
                    project={project}
                    document={document}
                    selection={state.selection}
                    save={{
                        status: state.status,
                        errorMessage: state.errorMessage,
                        pendingCount: state.pendingCount,
                        remoteRevision: state.remoteProject?.revision,
                    }}
                    colorTheme={colorTheme}
                    generationTasks={visibleGenerationTasks}
                    generationComposer={
                        <WorkspaceGenerationComposer
                            config={imageGeneration.config}
                            colorTheme={colorTheme}
                            prompt={generationPrompt}
                            references={composerReferences}
                            lockedReferenceIds={selectedReference ? [selectedReference.id] : []}
                            busy={imageGeneration.submitting}
                            disabled={state.status === "error" || state.status === "conflict" || deleting}
                            statusText={imageGeneration.selectedReferenceLoading ? "正在读取所选图片" : selectedReference ? "所选图片将作为改图参考" : undefined}
                            onPromptChange={setGenerationPrompt}
                            onReferencesChange={handleComposerReferences}
                            onModelChange={(model) => imageGeneration.updateConfig("imageModel", model)}
                            onConfigChange={(key, value) => imageGeneration.updateConfig(key, value)}
                            onSubmit={handleGenerate}
                            onMissingConfig={imageGeneration.openImageConfig}
                        />
                    }
                    getGenerationTaskActions={getGenerationTaskActions}
                    getGenerationTaskNotice={getGenerationTaskNotice}
                    imageToolbarActions={{
                        disabled: state.status === "error" || state.status === "conflict" || deleting || imageTools.loading,
                        busyAction: imageTools.busyAction,
                        onCrop: imageTools.openCrop,
                        onAnnotation: imageTools.openAnnotation,
                        onMask: imageTools.openMask,
                        onRemoveBackground: () => void imageTools.removeBackground(),
                        onUpscale: imageTools.openUpscale,
                    }}
                    surface={
                        <DesignFabricSurface
                            document={document}
                            selection={state.selection}
                            onReady={controller.handleAdapterReady}
                            onViewportCommit={controller.handleViewportCommit}
                            onSelectionChange={controller.handleSelectionChange}
                            onTransformCommit={controller.handleTransformCommit}
                        />
                    }
                    layersPanel={
                        <DesignEditorLayers
                            document={document}
                            selection={state.selection}
                            onSelect={controller.handleSelectionChange}
                            onReorder={controller.reorderSelection}
                            onElementPatch={controller.patchElementById}
                            onMoveScope={controller.moveSelectionScope}
                        />
                    }
                    inspectorPanel={
                        <DesignEditorInspector
                            document={document}
                            selection={state.selection}
                            onFramePatch={controller.patchFrame}
                            onTransformPatch={controller.patchTransform}
                            onElementPatch={controller.patchElement}
                            onTextPatch={controller.patchText}
                            onShapePatch={controller.patchShape}
                            onLinePatch={controller.patchLine}
                            onArrowPatch={controller.patchArrow}
                            onDelete={controller.removeSelection}
                        />
                    }
                    agentPanel={
                        <WorkspaceAgentPanel
                            surface="design"
                            projectId={project.id}
                            theme={designWorkspaceTheme(colorTheme)}
                            getSnapshot={getAgentSnapshot}
                            prepareRun={prepareAgentRun}
                            executeWorkspaceActions={executeAgentActions}
                            disabled={state.status === "error" || state.status === "conflict" || deleting}
                            selectionLabel={designAgentSelectionLabel(state.selection)}
                        />
                    }
                    rightRailOpen={rightPanelOpen}
                    rightTab={rightTab}
                    canUndo={state.canUndo}
                    canRedo={state.canRedo}
                    undoLabel={state.undoLabel}
                    redoLabel={state.redoLabel}
                    deleting={deleting}
                    importingImage={importingImage}
                    onBack={handleBackToProjects}
                    onUndo={() => void store.getState().undo()}
                    onRedo={() => void store.getState().redo()}
                    onFlush={() => void store.getState().flush()}
                    onRetrySave={() => void store.getState().retrySave()}
                    onReloadServerVersion={() => void store.getState().reloadServerVersion()}
                    onDeleteProject={confirmRemove}
                    onOpenExport={() => setExportOpen(true)}
                    onToggleRightRail={toggleRightPanel}
                    onRightTabChange={setRightTab}
                    onCreateFrame={controller.createFrame}
                    onCreateElement={handleCreateElement}
                    onUploadImage={() => imageInputRef.current?.click()}
                    onOpenAssetLibrary={() => setAssetPickerOpen(true)}
                    onZoomOut={() => controller.zoomBy(1 / 1.2)}
                    onZoomIn={() => controller.zoomBy(1.2)}
                    onFit={controller.fit}
                    onAlign={controller.alignSelection}
                    onDistribute={controller.distributeSelection}
                    handoffControl={handoffControl}
                />
                <LibraryAssetPicker open={assetPickerOpen} allowedKinds={["image"]} title="插入图片素材" onSelect={handleLibraryAsset} onClose={() => setAssetPickerOpen(false)} />
                <WorkspaceImageCropDialog
                    dataUrl={imageTools.runtimeUrl}
                    open={imageTools.dialog === "crop"}
                    initialCrop={imageTools.dialogImage?.crop}
                    sourceDimensions={imageTools.dialogImage}
                    onClose={imageTools.closeDialog}
                    onConfirm={imageTools.confirmCrop}
                    afterClose={imageTools.restoreDialogFocus}
                />
                <WorkspaceImageAnnotationDialog dataUrl={imageTools.runtimeUrl} open={imageTools.dialog === "annotation"} onClose={imageTools.closeDialog} onConfirm={imageTools.confirmAnnotation} afterClose={imageTools.restoreDialogFocus} />
                <WorkspaceImageMaskEditDialog
                    dataUrl={imageTools.runtimeUrl}
                    open={imageTools.dialog === "mask"}
                    sourceDimensions={imageTools.dialogImage}
                    onClose={imageTools.closeDialog}
                    onConfirm={(payload) => void imageTools.confirmMask(payload)}
                    afterClose={imageTools.restoreDialogFocus}
                />
                <WorkspaceImageUpscaleDialog
                    dataUrl={imageTools.runtimeUrl}
                    open={imageTools.dialog === "upscale"}
                    sourceDimensions={imageTools.dialogImage}
                    onClose={imageTools.closeDialog}
                    onConfirm={(params) => void imageTools.confirmUpscale(params)}
                    afterClose={imageTools.restoreDialogFocus}
                />
                <WorkspaceExportReview
                    open={exportOpen}
                    title="导出画框"
                    items={exportItems}
                    initialSettings={initialExportSettings}
                    theme={designWorkspaceTheme(colorTheme)}
                    loadPreview={loadExportPreview}
                    onExport={handleExport}
                    onClose={() => setExportOpen(false)}
                />
            </>
        );
    }

    return (
        <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[#e8ebf0] text-[#202633] dark:bg-[#0d0f12] dark:text-[#edf1f5]" data-testid="design-editor-workbench">
            <header className="z-20 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-[#dfe3e9] bg-white px-2.5 shadow-sm sm:px-4 dark:border-[#292e35] dark:bg-[#15181d]">
                <div className="flex min-w-0 items-center gap-2">
                    <Tooltip title="返回我的画板">
                        <Button type="text" shape="circle" icon={<ArrowLeft className="size-4" />} onClick={handleBackToProjects} aria-label="返回我的画板" />
                    </Tooltip>
                    <div className="hidden h-6 w-px bg-[#e3e6eb] sm:block dark:bg-[#30353d]" />
                    <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                            <h1 className="max-w-[34vw] truncate text-sm font-semibold sm:max-w-md">{project.title}</h1>
                            <span className="hidden rounded-md bg-[#eef2f7] px-1.5 py-0.5 text-[10px] font-medium text-[#667084] sm:inline dark:bg-[#242932] dark:text-[#aab2bd]">r{project.revision}</span>
                        </div>
                        <p className="mt-0.5 hidden text-[10px] text-[#8490a0] sm:block">图层 / 多选排版 / 吸附 / 持久化历史 · 阶段 7</p>
                    </div>
                </div>

                <div className="hidden items-center gap-1 md:flex">
                    <HistoryIconButton
                        label={state.undoLabel ? `撤销：${state.undoLabel}` : "没有可撤销的操作"}
                        disabled={!state.canUndo || state.status === "error" || state.status === "conflict"}
                        icon={<Undo2 className="size-4" />}
                        onClick={() => store.getState().undo()}
                    />
                    <HistoryIconButton
                        label={state.redoLabel ? `重做：${state.redoLabel}` : "没有可重做的操作"}
                        disabled={!state.canRedo || state.status === "error" || state.status === "conflict"}
                        icon={<Redo2 className="size-4" />}
                        onClick={() => store.getState().redo()}
                    />
                    <span className="mx-1 h-5 w-px bg-[#e4e7eb] dark:bg-[#30353c]" />
                    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs ${savePresentation.className}`} role="status" data-testid="design-save-status">
                        <Save className="size-3.5" /> {savePresentation.label}
                    </span>
                    {state.status === "error" ? (
                        <Button size="small" icon={<RefreshCw className="size-3.5" />} onClick={() => void store.getState().retrySave()}>
                            重试
                        </Button>
                    ) : null}
                    {state.status === "conflict" ? (
                        <Button size="small" danger onClick={() => void store.getState().reloadServerVersion()}>
                            载入服务端版本
                        </Button>
                    ) : null}
                    <Button size="small" disabled={!state.pendingCount || state.status === "conflict" || state.status === "error"} onClick={() => void store.getState().flush()}>
                        立即保存
                    </Button>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                    <Popconfirm
                        title="删除当前画板？"
                        description={state.status === "saved" ? "共享素材不会随项目删除。" : "请先完成或处理当前保存。"}
                        disabled={state.status !== "saved"}
                        okText="删除"
                        cancelText="取消"
                        okButtonProps={{ danger: true, loading: deleting }}
                        onConfirm={remove}
                    >
                        <Button type="text" danger shape="circle" disabled={state.status !== "saved"} icon={<Trash2 className="size-4" />} loading={deleting} aria-label="删除当前画板" />
                    </Popconfirm>
                    <Tooltip title="导出将在后续阶段启用">
                        <Button disabled icon={<Download className="size-4" />}>
                            导出
                        </Button>
                    </Tooltip>
                    <Tooltip title={rightPanelOpen ? "收起检查器" : "展开检查器"}>
                        <Button type="text" shape="circle" icon={<PanelRightClose className={`size-4 transition ${rightPanelOpen ? "" : "rotate-180"}`} />} onClick={toggleRightPanel} aria-label="切换检查器" />
                    </Tooltip>
                </div>
            </header>

            {state.status === "conflict" ? (
                <section className="z-20 flex shrink-0 flex-wrap items-center justify-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-950" data-testid="design-conflict-banner">
                    <strong>版本冲突：</strong>
                    <span>
                        本地草稿 r{project.revision} 已保留，服务端当前 r{state.remoteProject?.revision ?? "?"}，不会自动覆盖或合并。
                    </span>
                    <Button size="small" danger onClick={() => void store.getState().reloadServerVersion()}>
                        放弃本地草稿并载入服务端版本
                    </Button>
                </section>
            ) : state.status === "error" ? (
                <section className="z-20 flex shrink-0 items-center justify-center gap-2 border-b border-red-300 bg-red-50 px-4 py-2 text-xs text-red-900" data-testid="design-save-error">
                    <span>{state.errorMessage || "保存失败，本地草稿仍然保留"}</span>
                    <Button size="small" danger onClick={() => void store.getState().retrySave()}>
                        重试保存
                    </Button>
                </section>
            ) : null}

            <div className="flex min-h-0 flex-1">
                <aside className="z-10 flex w-14 shrink-0 flex-col items-center gap-1 border-r border-[#dfe3e9] bg-white py-3 dark:border-[#292e35] dark:bg-[#15181d]" aria-label="画板工具栏">
                    <ToolButton label="选择" active icon={<MousePointer2 className="size-[17px]" />} />
                    <ToolButton label="抓手：按住 Alt 或鼠标中键拖动画板" active icon={<Hand className="size-[17px]" />} />
                    <ToolDivider />
                    <ToolButton label="新建画框" active icon={<Frame className="size-[17px]" />} onClick={controller.createFrame} />
                    <ToolButton label="图片将在后续阶段启用" icon={<ImagePlus className="size-[17px]" />} />
                    <ToolButton label="新建文字" active icon={<Type className="size-[17px]" />} onClick={() => handleCreateElement("text")} />
                    <div className="relative">
                        <ToolButton label="新建形状、线条或箭头" active icon={<Shapes className="size-[17px]" />} onClick={toggleShapeMenu} />
                        {shapeMenuOpen ? (
                            <div className="absolute left-11 top-0 z-30 w-28 rounded-lg border border-[#dce1e8] bg-white p-1 shadow-xl dark:border-[#343a44] dark:bg-[#1b1f25]" role="menu" aria-label="基础形状菜单">
                                {(
                                    [
                                        ["rectangle", "矩形"],
                                        ["ellipse", "椭圆"],
                                        ["line", "线条"],
                                        ["arrow", "箭头"],
                                    ] as const
                                ).map(([kind, label]) => (
                                    <button key={kind} type="button" role="menuitem" className="block w-full rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-[#edf2ff] dark:hover:bg-[#263454]" onClick={() => handleCreateElement(kind)}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </div>
                    <ToolDivider />
                    <ToolButton label="AI 改图将在后续阶段启用" icon={<Sparkles className="size-[17px]" />} />
                    <div className="flex-1" />
                    <span className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-[#9aa3af] [writing-mode:vertical-rl]">Fabric</span>
                </aside>

                <section className="relative min-w-0 flex-1 overflow-hidden bg-[#dfe3e9] dark:bg-[#101318]" aria-label="画板工作区">
                    <DesignFabricSurface
                        document={document}
                        selection={state.selection}
                        onReady={controller.handleAdapterReady}
                        onViewportCommit={controller.handleViewportCommit}
                        onSelectionChange={controller.handleSelectionChange}
                        onTransformCommit={controller.handleTransformCommit}
                    />
                    <LayoutToolbar selection={state.selection} document={document} onAlign={controller.alignSelection} onDistribute={controller.distributeSelection} />
                    {!document.frames.length && !document.elements.length ? (
                        <div className="pointer-events-none absolute inset-0 grid place-items-center">
                            <div className="rounded-xl border border-white/70 bg-white/85 px-6 py-5 text-center shadow-lg backdrop-blur dark:border-[#343a45] dark:bg-[#191d23]/90">
                                <Frame className="mx-auto size-6 text-[#7182a5]" />
                                <h2 className="mt-2 text-sm font-semibold">空白 Design Workspace</h2>
                                <p className="mt-1 text-xs text-[#7a8492]">从左侧创建画框或基础元素；滚轮缩放，Alt / 中键平移</p>
                            </div>
                        </div>
                    ) : null}
                    <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-[#d5dae2] bg-white/95 p-1 shadow-md backdrop-blur dark:border-[#303641] dark:bg-[#191d23]/95">
                        <ActionIconButton label="缩小" icon={<ZoomOut className="size-4" />} onClick={() => controller.zoomBy(1 / 1.2)} />
                        <span className="min-w-14 px-1 text-center text-xs font-medium" data-testid="design-zoom-value">
                            {workspaceZoom}%
                        </span>
                        <ActionIconButton label="放大" icon={<ZoomIn className="size-4" />} onClick={() => controller.zoomBy(1.2)} />
                        <span className="mx-1 h-5 w-px bg-[#e4e7eb] dark:bg-[#30353c]" />
                        <Button type="text" size="small" onClick={controller.fit}>
                            适应
                        </Button>
                    </div>
                </section>

                {rightPanelOpen ? (
                    <aside className="z-10 hidden w-72 shrink-0 flex-col border-l border-[#dfe3e9] bg-white lg:flex dark:border-[#292e35] dark:bg-[#15181d]" aria-label="画板检查器">
                        <div className="grid grid-cols-2 border-b border-[#e7e9ed] p-1 dark:border-[#292e35]">
                            <button type="button" className={`rounded-md px-2 py-1.5 text-xs ${rightTab === "layers" ? "bg-[#e8eefb] font-medium text-[#4968ad] dark:bg-[#263454]" : "text-[#788292]"}`} onClick={() => setRightTab("layers")}>
                                图层
                            </button>
                            <button type="button" className={`rounded-md px-2 py-1.5 text-xs ${rightTab === "inspector" ? "bg-[#e8eefb] font-medium text-[#4968ad] dark:bg-[#263454]" : "text-[#788292]"}`} onClick={() => setRightTab("inspector")}>
                                属性
                            </button>
                        </div>
                        {rightTab === "layers" ? (
                            <DesignEditorLayers
                                document={document}
                                selection={state.selection}
                                onSelect={controller.handleSelectionChange}
                                onReorder={controller.reorderSelection}
                                onElementPatch={controller.patchElementById}
                                onMoveScope={controller.moveSelectionScope}
                            />
                        ) : (
                            <DesignEditorInspector
                                document={document}
                                selection={state.selection}
                                onFramePatch={controller.patchFrame}
                                onTransformPatch={controller.patchTransform}
                                onElementPatch={controller.patchElement}
                                onTextPatch={controller.patchText}
                                onShapePatch={controller.patchShape}
                                onLinePatch={controller.patchLine}
                                onArrowPatch={controller.patchArrow}
                                onDelete={controller.removeSelection}
                            />
                        )}
                    </aside>
                ) : null}
            </div>
        </main>
    );
}

export function designSelectionIds(selection: DesignEditorSelection) {
    if (!selection) return [];
    return selection.kind === "frame" ? [selection.id] : [...selection.ids];
}

export function designAgentSelectionLabel(selection: DesignEditorSelection) {
    const ids = designSelectionIds(selection);
    if (!ids.length) return undefined;
    return selection?.kind === "frame" ? "当前上下文：1 个画框" : `当前上下文：${ids.length} 个元素`;
}

function DesignShellState({ title, description, action, spinning = false }: { title: string; description: string; action?: ReactNode; spinning?: boolean }) {
    return (
        <main className="grid h-dvh place-items-center bg-[#e8ebf0] px-5 dark:bg-[#0d0f12]">
            <section className="w-full max-w-md rounded-2xl border border-[#dce1e8] bg-white p-8 text-center shadow-xl dark:border-[#292e35] dark:bg-[#15181d]">
                <span className={`mx-auto grid size-12 place-items-center rounded-xl bg-[#eaf0fd] text-[#5d77b4] dark:bg-[#223052] dark:text-[#a7bff7] ${spinning ? "animate-pulse" : ""}`}>
                    <Frame className="size-5" />
                </span>
                <h1 className="mt-4 text-lg font-semibold">{title}</h1>
                <p className="mt-2 text-sm leading-6 text-[#737e8e] dark:text-[#a2abb7]">{description}</p>
                {action ? <div className="mt-5 flex justify-center gap-2">{action}</div> : null}
            </section>
        </main>
    );
}

function HistoryIconButton({ label, icon, disabled, onClick }: { label: string; icon: ReactNode; disabled: boolean; onClick: () => void }) {
    return (
        <Tooltip title={label}>
            <Button type="text" shape="circle" size="small" disabled={disabled} icon={icon} aria-label={label} onClick={onClick} />
        </Tooltip>
    );
}

function LayoutToolbar({
    selection,
    document,
    onAlign,
    onDistribute,
}: {
    selection: DesignEditorSelection;
    document: import("@/lib/design").DesignDocument;
    onAlign: (alignment: DesignAlignment) => void;
    onDistribute: (distribution: DesignDistribution) => void;
}) {
    if (selection?.kind !== "elements") return null;
    const elements = document.elements.filter((element) => selection.ids.includes(element.id));
    const disabled = !elements.length || elements.some((element) => element.locked);
    const canDistribute = elements.length >= 3 && !disabled;
    const actions: Array<[string, ReactNode, () => void, boolean]> = [
        ["左对齐", <AlignHorizontalJustifyStart className="size-4" key="left" />, () => onAlign("left"), disabled],
        ["水平居中", <AlignHorizontalJustifyCenter className="size-4" key="hc" />, () => onAlign("horizontal-center"), disabled],
        ["右对齐", <AlignHorizontalJustifyEnd className="size-4" key="right" />, () => onAlign("right"), disabled],
        ["顶对齐", <AlignVerticalJustifyStart className="size-4" key="top" />, () => onAlign("top"), disabled],
        ["垂直居中", <AlignVerticalJustifyCenter className="size-4" key="vc" />, () => onAlign("vertical-center"), disabled],
        ["底对齐", <AlignVerticalJustifyEnd className="size-4" key="bottom" />, () => onAlign("bottom"), disabled],
        ["水平等距分布", <AlignHorizontalDistributeCenter className="size-4" key="hd" />, () => onDistribute("horizontal"), !canDistribute],
        ["垂直等距分布", <AlignVerticalDistributeCenter className="size-4" key="vd" />, () => onDistribute("vertical"), !canDistribute],
    ];
    return (
        <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-[#d5dae2] bg-white/95 p-1 shadow-md backdrop-blur dark:border-[#303641] dark:bg-[#191d23]/95" data-testid="design-layout-toolbar">
            {actions.map(([label, icon, action, actionDisabled]) => (
                <Tooltip key={label} title={label}>
                    <Button type="text" size="small" shape="circle" disabled={actionDisabled} icon={icon} aria-label={label} onClick={action} />
                </Tooltip>
            ))}
        </div>
    );
}
function ActionIconButton({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
    return (
        <Tooltip title={label}>
            <Button type="text" shape="circle" size="small" icon={icon} aria-label={label} onClick={onClick} />
        </Tooltip>
    );
}
function ToolButton({ label, icon, active = false, onClick }: { label: string; icon: ReactNode; active?: boolean; onClick?: () => void }) {
    return (
        <Tooltip placement="right" title={label}>
            <button
                type="button"
                disabled={!active}
                className={`grid size-9 place-items-center rounded-lg transition ${active ? "bg-[#e8eefb] text-[#5270b5] dark:bg-[#263454] dark:text-[#aac0f3]" : "cursor-not-allowed text-[#9ba3ae] dark:text-[#69717d]"}`}
                aria-label={label}
                onClick={onClick}
            >
                {icon}
            </button>
        </Tooltip>
    );
}
function ToolDivider() {
    return <div className="my-1 h-px w-7 bg-[#e5e8ed] dark:bg-[#2d323a]" />;
}
function saveStatus(status: DesignEditorSaveStatus, detail: string | null) {
    if (status === "saved") return { label: "已保存", className: "text-emerald-700" };
    if (status === "saving") return { label: "保存中…", className: "text-blue-700" };
    if (status === "dirty") return { label: "未保存", className: "text-amber-700" };
    if (status === "conflict") return { label: "版本冲突", className: "text-red-700" };
    if (status === "error") return { label: detail || "保存失败", className: "text-red-700" };
    return { label: "正在载入", className: "text-slate-600" };
}

function requiresLeaveProtection(status: DesignEditorSaveStatus) {
    return status === "dirty" || status === "saving" || status === "error" || status === "conflict";
}
function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

function clientId() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function mergeDesignGenerationTasks(activeTasks: readonly CreativeWorkspaceGenerationTask[], recoveryTasks: readonly CreativeWorkspaceGenerationTask[], pendingTasks: readonly CreativeWorkspaceGenerationTask[], projectId: string) {
    const tasks = new Map<string, CreativeWorkspaceGenerationTask>();
    for (const task of activeTasks) tasks.set(task.id, task);
    for (const task of recoveryTasks) {
        const failedImage = task.type === "image" && task.status === "failed" && Boolean(task.prompt);
        const failedImageProcess = task.type === "image_process" && task.status === "failed";
        if ((failedImage || failedImageProcess) && task.binding?.surface === "design" && task.binding.projectId === projectId) tasks.set(task.id, task);
    }
    for (const task of pendingTasks) tasks.set(task.id, task);
    return [...tasks.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}
