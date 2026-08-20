"use client";

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
    Circle,
    Crop,
    Download,
    Frame,
    Hand,
    Images,
    ImageUp,
    ImageUpscale,
    MessageSquareText,
    Minus,
    MousePointer2,
    PanelRight,
    RectangleHorizontal,
    Redo2,
    Save,
    Shapes,
    Slash,
    ScanLine,
    Sparkles,
    Trash2,
    Type,
    Undo2,
    WandSparkles,
    X,
    ZoomIn,
    ZoomOut,
} from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { CreativeWorkspaceShell, GenerationTaskTray, WorkspaceRightRail, WorkspaceToolDock, WorkspaceTopBar, WorkspaceZoomDock, type GenerationTaskAction, type WorkspaceToolDockEntry } from "@/components/creative-workspace";
import type { CanvasColorTheme } from "@/lib/canvas-theme";
import type { CreativeWorkspaceGenerationTask } from "@/lib/creative-workspace";
import type { DesignDocument, DesignProject } from "@/lib/design";

import styles from "./design-editor-creative-shell.module.css";
import { designSaveStatusDescriptor, designWorkspaceTheme } from "./design-editor-creative-shell-theme";
import type { DesignAlignment, DesignCreatableElementKind, DesignDistribution, DesignEditorSelection } from "../model/design-editor-commands";
import type { DesignEditorSaveStatus } from "../store/design-editor-store";

export type DesignEditorRailTab = "layers" | "inspector" | "agent";
export type DesignImageToolbarAction = "crop" | "annotation" | "mask" | "background-removal" | "upscale";

export type DesignImageToolbarActions = Readonly<{
    disabled?: boolean;
    busyAction?: DesignImageToolbarAction | null;
    onCrop: () => void;
    onAnnotation: () => void;
    onMask: () => void;
    onRemoveBackground: () => void;
    onUpscale: () => void;
}>;

export type DesignEditorCreativeShellProps = {
    project: DesignProject;
    document?: DesignDocument;
    selection: DesignEditorSelection;
    save: {
        status: DesignEditorSaveStatus;
        errorMessage?: string | null;
        pendingCount?: number;
        remoteRevision?: number | null;
    };
    colorTheme?: CanvasColorTheme;
    generationTasks?: readonly CreativeWorkspaceGenerationTask[];
    generationComposer?: ReactNode;
    getGenerationTaskActions?: (task: CreativeWorkspaceGenerationTask) => readonly GenerationTaskAction[];
    getGenerationTaskNotice?: (task: CreativeWorkspaceGenerationTask) => string | undefined;
    imageToolbarActions?: DesignImageToolbarActions;
    surface: ReactNode;
    layersPanel: ReactNode;
    inspectorPanel: ReactNode;
    agentPanel?: ReactNode;
    rightRailOpen: boolean;
    rightTab: DesignEditorRailTab;
    canUndo: boolean;
    canRedo: boolean;
    undoLabel?: string | null;
    redoLabel?: string | null;
    deleting?: boolean;
    importingImage?: boolean;
    onBack: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onFlush: () => void;
    onRetrySave: () => void;
    onReloadServerVersion: () => void;
    onDeleteProject: () => void;
    onOpenExport: () => void;
    onToggleRightRail: () => void;
    onRightTabChange: (tab: DesignEditorRailTab) => void;
    onCreateFrame: () => void;
    onCreateElement: (kind: DesignCreatableElementKind) => void;
    onUploadImage: () => void;
    onOpenAssetLibrary: () => void;
    onZoomOut: () => void;
    onZoomIn: () => void;
    onFit: () => void;
    onAlign: (alignment: DesignAlignment) => void;
    onDistribute: (distribution: DesignDistribution) => void;
    handoffControl?: ReactNode;
};

/**
 * Design-domain adapter for the shared creative workspace. The caller keeps
 * ownership of Fabric, editor commands, save coordination and destructive
 * confirmations; this component only presents those capabilities.
 */
export function DesignEditorCreativeShell({
    project,
    document = project.document,
    selection,
    save,
    colorTheme = "light",
    generationTasks = [],
    generationComposer,
    getGenerationTaskActions,
    getGenerationTaskNotice,
    imageToolbarActions,
    surface,
    layersPanel,
    inspectorPanel,
    agentPanel,
    rightRailOpen,
    rightTab,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    deleting = false,
    importingImage = false,
    onBack,
    onUndo,
    onRedo,
    onFlush,
    onRetrySave,
    onReloadServerVersion,
    onDeleteProject,
    onOpenExport,
    onToggleRightRail,
    onRightTabChange,
    onCreateFrame,
    onCreateElement,
    onUploadImage,
    onOpenAssetLibrary,
    onZoomOut,
    onZoomIn,
    onFit,
    onAlign,
    onDistribute,
    handoffControl,
}: DesignEditorCreativeShellProps) {
    const theme = designWorkspaceTheme(colorTheme);
    const railId = useId();
    const shapeMenuId = useId();
    const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
    const statusDescriptor = designSaveStatusDescriptor(save.status, save.errorMessage ?? null);
    const selectionCapabilities = designSelectionCapabilities(document, selection);
    const selectedImageToolbarActions = selectedToolbarImage(document, selection) ? imageToolbarActions : undefined;
    const zoomPercent = Math.round(document.workspace.viewport.zoom * 100);
    const editingDisabled = save.status === "error" || save.status === "conflict" || save.status === "loading" || save.status === "not-found";
    const canFlush = Boolean(save.pendingCount) && save.status !== "error" && save.status !== "conflict";

    const tools: WorkspaceToolDockEntry[] = [
        { kind: "action", id: "select", label: "选择", icon: <MousePointer2 />, active: true },
        { kind: "action", id: "hand", label: "抓手：按住 Alt 或鼠标中键拖动画板", icon: <Hand />, active: true },
        { kind: "separator", id: "design-create" },
        { kind: "action", id: "frame", label: "新建画框", icon: <Frame />, disabled: editingDisabled, onPress: onCreateFrame },
        { kind: "action", id: "text", label: "新建文字", icon: <Type />, disabled: editingDisabled, onPress: () => onCreateElement("text") },
        { kind: "action", id: "upload-image", label: importingImage ? "正在导入图片" : "上传图片", icon: <ImageUp />, disabled: editingDisabled || importingImage, onPress: onUploadImage },
        { kind: "action", id: "asset-library", label: "从素材库插入", icon: <Images />, disabled: editingDisabled || importingImage, onPress: onOpenAssetLibrary },
        {
            kind: "action",
            id: "agent",
            label: "打开 Agent",
            icon: <Sparkles />,
            active: rightRailOpen && rightTab === "agent",
            onPress: () => {
                onRightTabChange("agent");
                if (!rightRailOpen) onToggleRightRail();
            },
        },
    ];

    const topBar = (
        <WorkspaceTopBar
            theme={theme}
            descriptor={{
                title: project.title,
                subtitle: "图层 / 多选排版 / 吸附 / 持久化历史",
                revision: `r${project.revision}`,
                status: { ...statusDescriptor, icon: <Save size={14} /> },
            }}
            slots={{
                leading: <ChromeButton label="返回我的画板" icon={<ArrowLeft size={17} />} onClick={onBack} />,
                center: (
                    <div className={styles.topActions}>
                        <ChromeButton label={undoLabel ? `撤销：${undoLabel}` : "没有可撤销的操作"} icon={<Undo2 size={16} />} disabled={!canUndo || editingDisabled} onClick={onUndo} />
                        <ChromeButton label={redoLabel ? `重做：${redoLabel}` : "没有可重做的操作"} icon={<Redo2 size={16} />} disabled={!canRedo || editingDisabled} onClick={onRedo} />
                        {save.status === "error" ? (
                            <button type="button" className={`${styles.compactAction} ${styles.errorAction}`} onClick={onRetrySave}>
                                重试保存
                            </button>
                        ) : null}
                        {save.status === "conflict" ? (
                            <button type="button" className={`${styles.compactAction} ${styles.errorAction}`} onClick={onReloadServerVersion}>
                                载入服务端版本
                            </button>
                        ) : null}
                        <button type="button" className={styles.compactAction} disabled={!canFlush} onClick={onFlush}>
                            立即保存
                        </button>
                    </div>
                ),
                actions: (
                    <div className={styles.topActions}>
                        {handoffControl ? <span className={styles.handoffAction}>{handoffControl}</span> : null}
                        <span className={styles.exportAction}>
                            <ChromeButton label="导出画框" icon={<Download size={16} />} keyShortcut="Control+Shift+E Meta+Shift+E" disabled={!document.frames.length} onClick={onOpenExport} />
                        </span>
                        <ChromeButton label="删除当前画板" icon={<Trash2 size={16} />} danger busy={deleting} disabled={deleting || save.status !== "saved"} onClick={onDeleteProject} />
                        <span className={styles.railToggle}>
                            <ChromeButton label={rightRailOpen ? "收起辅助面板" : "展开辅助面板"} icon={<PanelRight size={17} />} controls={railId} expanded={rightRailOpen} onClick={onToggleRightRail} />
                        </span>
                    </div>
                ),
            }}
            ariaLabel="Design 画板状态与操作"
        />
    );

    const toolDock = (
        <WorkspaceToolDock
            theme={theme}
            items={tools}
            trailing={
                <div className={styles.shapeMenuWrap}>
                    <button
                        type="button"
                        className={styles.chromeButton}
                        aria-label="新建形状、线条或箭头"
                        aria-haspopup="menu"
                        aria-expanded={shapeMenuOpen}
                        aria-controls={shapeMenuId}
                        disabled={editingDisabled}
                        onClick={() => setShapeMenuOpen((open) => !open)}
                    >
                        <Shapes size={17} aria-hidden="true" />
                    </button>
                    {shapeMenuOpen ? (
                        <DesignShapeMenu
                            id={shapeMenuId}
                            onCreate={(kind) => {
                                setShapeMenuOpen(false);
                                onCreateElement(kind);
                            }}
                        />
                    ) : null}
                </div>
            }
            ariaLabel="Design 画板工具"
        />
    );

    const rightRail = (
        <WorkspaceRightRail
            open={rightRailOpen}
            theme={theme}
            descriptor={{ title: rightTab === "layers" ? "图层" : rightTab === "inspector" ? "属性" : "Agent", subtitle: rightTab === "agent" ? "Design Workspace" : "Design Document", closeLabel: "收起画板辅助面板" }}
            slots={{
                actions: (
                    <div className={styles.railTabs} role="tablist" aria-label="检查器视图">
                        <RailTab id={`${railId}-layers-tab`} panelId={`${railId}-layers-panel`} selected={rightTab === "layers"} onClick={() => onRightTabChange("layers")}>
                            图层
                        </RailTab>
                        <RailTab id={`${railId}-inspector-tab`} panelId={`${railId}-inspector-panel`} selected={rightTab === "inspector"} onClick={() => onRightTabChange("inspector")}>
                            属性
                        </RailTab>
                        <RailTab id={`${railId}-agent-tab`} panelId={`${railId}-agent-panel`} selected={rightTab === "agent"} onClick={() => onRightTabChange("agent")}>
                            Agent
                        </RailTab>
                    </div>
                ),
            }}
            onClose={onToggleRightRail}
            closeIcon={<X size={16} />}
            ariaLabel="画板检查器"
        >
            <div id={railId} className={styles.railBody}>
                <div id={`${railId}-${rightTab}-panel`} role="tabpanel" aria-labelledby={`${railId}-${rightTab}-tab`} className={styles.railBody}>
                    {rightTab === "layers" ? layersPanel : rightTab === "inspector" ? inspectorPanel : agentPanel || <p className={styles.unavailablePanel}>Agent 暂不可用</p>}
                </div>
            </div>
        </WorkspaceRightRail>
    );

    return (
        <div className={styles.workbench} data-testid="design-editor-workbench">
            <CreativeWorkspaceShell
                theme={theme}
                canvasAriaLabel="Design 画板工作区"
                canvasClassName={styles.surface}
                topBar={topBar}
                overlays={
                    <>
                        <DesignSaveAlert save={save} projectRevision={project.revision} onRetrySave={onRetrySave} onReloadServerVersion={onReloadServerVersion} />
                        <GenerationTaskTray surface="design" projectId={project.id} tasks={generationTasks} theme={theme} getTaskActions={getGenerationTaskActions} getTaskNotice={getGenerationTaskNotice} />
                        {generationComposer}
                        <DesignSelectionToolbar capabilities={selectionCapabilities} imageActions={selectedImageToolbarActions} displaced={save.status === "error" || save.status === "conflict"} onAlign={onAlign} onDistribute={onDistribute} />
                        {!document.frames.length && !document.elements.length ? <DesignEmptyState /> : null}
                    </>
                }
                toolDock={toolDock}
                zoomDock={
                    <WorkspaceZoomDock
                        theme={theme}
                        descriptor={{
                            value: `${zoomPercent}%`,
                            valueLabel: `当前缩放比例 ${zoomPercent}%`,
                            zoomOut: { label: "缩小", icon: <ZoomOut size={15} />, onPress: onZoomOut },
                            zoomIn: { label: "放大", icon: <ZoomIn size={15} />, onPress: onZoomIn },
                            fit: { label: "适应内容", onPress: onFit },
                        }}
                    />
                }
                rightRail={rightRail}
            >
                {surface}
            </CreativeWorkspaceShell>
        </div>
    );
}

function DesignSaveAlert({ save, projectRevision, onRetrySave, onReloadServerVersion }: { save: DesignEditorCreativeShellProps["save"]; projectRevision: number; onRetrySave: () => void; onReloadServerVersion: () => void }) {
    if (save.status !== "error" && save.status !== "conflict") return null;
    const conflict = save.status === "conflict";
    return (
        <section className={styles.saveAlert} role="alert" data-testid={conflict ? "design-conflict-banner" : "design-save-error"}>
            <div>
                <strong>{conflict ? "版本冲突" : "保存失败"}</strong>
                <span>{conflict ? `本地草稿 r${projectRevision} 已保留，服务端当前 r${save.remoteRevision ?? "?"}，不会自动覆盖。` : save.errorMessage || "本地草稿仍然保留，请重试保存。"}</span>
            </div>
            <button type="button" className={`${styles.compactAction} ${styles.errorAction}`} onClick={conflict ? onReloadServerVersion : onRetrySave}>
                {conflict ? "放弃本地草稿并载入服务端版本" : "重试保存"}
            </button>
        </section>
    );
}

function ChromeButton({
    label,
    icon,
    disabled,
    danger,
    busy,
    keyShortcut,
    controls,
    expanded,
    onClick,
}: {
    label: string;
    icon: ReactNode;
    disabled?: boolean;
    danger?: boolean;
    busy?: boolean;
    keyShortcut?: string;
    controls?: string;
    expanded?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            className={`${styles.chromeButton} ${danger ? styles.dangerButton : ""}`}
            aria-label={label}
            aria-busy={busy || undefined}
            aria-keyshortcuts={keyShortcut}
            aria-controls={controls}
            aria-expanded={controls ? expanded : undefined}
            title={label}
            disabled={disabled}
            onClick={onClick}
        >
            {icon}
        </button>
    );
}

function RailTab({ id, panelId, selected, onClick, children }: { id: string; panelId: string; selected: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <button id={id} type="button" role="tab" aria-selected={selected} aria-controls={panelId} tabIndex={selected ? 0 : -1} className={`${styles.tabButton} ${selected ? styles.tabButtonActive : ""}`} onClick={onClick}>
            {children}
        </button>
    );
}

function DesignShapeMenu({ id, onCreate }: { id: string; onCreate: (kind: Exclude<DesignCreatableElementKind, "text">) => void }) {
    const entries = [
        { kind: "rectangle", label: "矩形", icon: <RectangleHorizontal size={15} /> },
        { kind: "ellipse", label: "椭圆", icon: <Circle size={15} /> },
        { kind: "line", label: "线条", icon: <Minus size={15} /> },
        { kind: "arrow", label: "箭头", icon: <Slash size={15} /> },
    ] as const;
    return (
        <div id={id} role="menu" aria-label="基础形状菜单" className={styles.shapeMenu}>
            {entries.map((entry) => (
                <button key={entry.kind} type="button" role="menuitem" className={styles.shapeMenuButton} onClick={() => onCreate(entry.kind)}>
                    {entry.icon}
                    <span>{entry.label}</span>
                </button>
            ))}
        </div>
    );
}

type SelectionCapabilities = { visible: boolean; disabled: boolean; canDistribute: boolean };

export function designSelectionCapabilities(document: DesignDocument, selection: DesignEditorSelection): SelectionCapabilities {
    if (selection?.kind !== "elements") return { visible: false, disabled: true, canDistribute: false };
    const ids = new Set(selection.ids);
    const elements = document.elements.filter((element) => ids.has(element.id));
    const disabled = elements.length !== selection.ids.length || !elements.length || elements.some((element) => element.locked);
    return { visible: true, disabled, canDistribute: elements.length >= 3 && !disabled };
}

function DesignSelectionToolbar({
    capabilities,
    imageActions,
    displaced,
    onAlign,
    onDistribute,
}: {
    capabilities: SelectionCapabilities;
    imageActions?: DesignImageToolbarActions;
    displaced: boolean;
    onAlign: (alignment: DesignAlignment) => void;
    onDistribute: (distribution: DesignDistribution) => void;
}) {
    if (!capabilities.visible) return null;
    const layoutActions: Array<{ id: string; label: string; icon: ReactNode; disabled: boolean; action: () => void; separator?: boolean }> = [
        { id: "align-left", label: "左对齐", icon: <AlignHorizontalJustifyStart size={16} />, disabled: capabilities.disabled, action: () => onAlign("left"), separator: Boolean(imageActions) },
        { id: "align-horizontal-center", label: "水平居中", icon: <AlignHorizontalJustifyCenter size={16} />, disabled: capabilities.disabled, action: () => onAlign("horizontal-center") },
        { id: "align-right", label: "右对齐", icon: <AlignHorizontalJustifyEnd size={16} />, disabled: capabilities.disabled, action: () => onAlign("right") },
        { id: "align-top", label: "顶对齐", icon: <AlignVerticalJustifyStart size={16} />, disabled: capabilities.disabled, action: () => onAlign("top"), separator: true },
        { id: "align-vertical-center", label: "垂直居中", icon: <AlignVerticalJustifyCenter size={16} />, disabled: capabilities.disabled, action: () => onAlign("vertical-center") },
        { id: "align-bottom", label: "底对齐", icon: <AlignVerticalJustifyEnd size={16} />, disabled: capabilities.disabled, action: () => onAlign("bottom") },
        { id: "distribute-horizontal", label: "水平等距分布", icon: <AlignHorizontalDistributeCenter size={16} />, disabled: !capabilities.canDistribute, action: () => onDistribute("horizontal"), separator: true },
        { id: "distribute-vertical", label: "垂直等距分布", icon: <AlignVerticalDistributeCenter size={16} />, disabled: !capabilities.canDistribute, action: () => onDistribute("vertical") },
    ];
    const imageBusy = Boolean(imageActions?.busyAction);
    const imageDisabled = Boolean(imageActions?.disabled || imageBusy || capabilities.disabled);
    const imageToolActions: typeof layoutActions = imageActions
        ? [
              { id: "image-crop", label: "裁剪图片", icon: <Crop size={16} />, disabled: imageDisabled, action: imageActions.onCrop },
              { id: "image-annotation", label: "添加批注", icon: <MessageSquareText size={16} />, disabled: imageDisabled, action: imageActions.onAnnotation },
              { id: "image-mask", label: "蒙版编辑", icon: <WandSparkles size={16} />, disabled: imageDisabled, action: imageActions.onMask },
              { id: "image-background-removal", label: "移除背景", icon: <ScanLine size={16} />, disabled: imageDisabled, action: imageActions.onRemoveBackground },
              { id: "image-upscale", label: "放大图片", icon: <ImageUpscale size={16} />, disabled: imageDisabled, action: imageActions.onUpscale },
          ]
        : [];
    const actions = [...imageToolActions, ...layoutActions];
    return (
        <div className={`${styles.selectionToolbar} ${displaced ? styles.selectionToolbarDisplaced : ""}`} role="toolbar" aria-label="选区排版" data-testid="design-layout-toolbar">
            {actions.map((entry) => (
                <span key={entry.id}>
                    {entry.separator ? <span className={styles.overlaySeparator} role="separator" aria-orientation="vertical" /> : null}
                    <button type="button" className={styles.overlayButton} aria-label={entry.label} aria-busy={imageActions?.busyAction === entry.id.replace("image-", "") || undefined} title={entry.label} disabled={entry.disabled} onClick={entry.action}>
                        {entry.icon}
                    </button>
                </span>
            ))}
        </div>
    );
}

function selectedToolbarImage(document: DesignDocument, selection: DesignEditorSelection) {
    if (selection?.kind !== "elements" || selection.ids.length !== 1) return null;
    const element = document.elements.find((candidate) => candidate.id === selection.ids[0]);
    return element?.kind === "image" ? element : null;
}

function DesignEmptyState() {
    return (
        <div className={styles.emptyState}>
            <section className={styles.emptyCard} aria-label="空白画板提示">
                <Frame size={25} aria-hidden="true" />
                <h2>空白 Design Workspace</h2>
                <p>从底部工具栏创建画框、文字或基础形状；滚轮缩放，Alt / 中键平移。</p>
            </section>
        </div>
    );
}
