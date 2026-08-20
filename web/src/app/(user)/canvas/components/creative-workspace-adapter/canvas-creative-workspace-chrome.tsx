"use client";

import {
    BoxSelect,
    Compass,
    FilePlus2,
    Focus,
    Gauge,
    Group,
    Hand,
    Image as ImageIcon,
    Images,
    Import,
    Keyboard,
    LayoutGrid,
    Menu,
    MessageSquareShare,
    PanelRightClose,
    Moon,
    Redo2,
    Trash2,
    Sun,
    Undo2,
    Ungroup,
    Upload,
    ZoomIn,
    ZoomOut,
} from "lucide-react";
import { forwardRef, useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { CreativeWorkspaceShell, WorkspaceRightRail, WorkspaceToolDock, WorkspaceTopBar, WorkspaceZoomDock, type WorkspaceToolDockEntry } from "@/components/creative-workspace";
import type { CanvasBackgroundMode, CanvasColorTheme } from "@/lib/canvas-theme";

import type { CanvasMediaPerformanceMode } from "../../types";
import styles from "./canvas-creative-workspace-chrome.module.css";
import { canvasWorkspaceTheme } from "./canvas-workspace-theme";

export type CanvasWorkspaceTool = "move" | "box-select";

export type CanvasWorkspaceCreationAction = {
    id: "text" | "image" | "panorama" | "drawing" | "video" | "audio" | "config";
    label: string;
    icon: ReactNode;
    onCreate: () => void;
    disabled?: boolean;
};

export type CanvasCreativeWorkspaceChromeProps = {
    colorTheme: CanvasColorTheme;
    surface: ReactNode;
    overlays?: ReactNode;
    generationComposer?: ReactNode;
    assistantPanel?: ReactNode;
    assistantOpen: boolean;
    title: string;
    titleDraft: string;
    isTitleEditing: boolean;
    onTitleDraftChange: (value: string) => void;
    onStartTitleEditing: () => void;
    onFinishTitleEditing: () => void;
    onCancelTitleEditing: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onUndo: () => void;
    onRedo: () => void;
    onWorkbench: () => void;
    onProjects: () => void;
    onCreateProject: () => void;
    onDeleteProject: () => void;
    onImportImage: () => void;
    performanceMode: CanvasMediaPerformanceMode;
    performanceReduced: boolean;
    onPerformanceModeChange: (mode: CanvasMediaPerformanceMode) => void;
    onToggleAgent: () => void;
    canvasTool: CanvasWorkspaceTool;
    onCanvasToolChange: (tool: CanvasWorkspaceTool) => void;
    onDeselect: () => void;
    selectedCount: number;
    onDeleteSelected: () => void;
    onClear: () => void;
    onGroup: () => void;
    canUngroup: boolean;
    onUngroup: () => void;
    onUpload: () => void;
    onOpenMyAssets: () => void;
    creationActions: readonly CanvasWorkspaceCreationAction[];
    scale: number;
    onScaleChange: (scale: number) => void;
    onResetViewport: () => void;
    isMiniMapOpen: boolean;
    onToggleMiniMap: () => void;
    shortcutsControl?: ReactNode;
    appearanceControl?: ReactNode;
    backgroundMode?: CanvasBackgroundMode;
    showImageInfo?: boolean;
    onColorThemeChange?: (theme: CanvasColorTheme) => void;
    onBackgroundModeChange?: (mode: CanvasBackgroundMode) => void;
    onShowImageInfoChange?: (show: boolean) => void;
    compactAgentStatus?: ReactNode;
    addComponentsControl?: ReactNode;
    accountControl?: ReactNode;
    handoffControl?: ReactNode;
};

/**
 * Canvas-domain chrome adapter. Node, connection, persistence, Agent and
 * generation state stay owned by the page controller and arrive as callbacks
 * or opaque React slots.
 */
export function CanvasCreativeWorkspaceChrome(props: CanvasCreativeWorkspaceChromeProps) {
    const theme = canvasWorkspaceTheme(props.colorTheme);
    const assistantRailId = useId();
    const titleRef = useRef<HTMLDivElement>(null);
    const { isTitleEditing, onFinishTitleEditing } = props;

    useEffect(() => {
        if (!isTitleEditing) return;
        const finishOnOutsidePress = (event: PointerEvent) => {
            if (!titleRef.current?.contains(event.target as Node)) onFinishTitleEditing();
        };
        document.addEventListener("pointerdown", finishOnOutsidePress, true);
        return () => document.removeEventListener("pointerdown", finishOnOutsidePress, true);
    }, [isTitleEditing, onFinishTitleEditing]);

    const toolItems = canvasWorkspaceToolEntries(props);
    const percent = Math.round(props.scale * 100);

    return (
        <div className={styles.workbench} data-testid="canvas-creative-workspace" data-canvas-creative-workspace>
            <CreativeWorkspaceShell
                theme={theme}
                canvasAriaLabel="Canvas 创作工作区"
                canvasClassName={styles.surface}
                topBar={
                    <WorkspaceTopBar
                        theme={theme}
                        descriptor={{
                            title: (
                                <CanvasWorkspaceTitle
                                    ref={titleRef}
                                    title={props.title}
                                    draft={props.titleDraft}
                                    editing={props.isTitleEditing}
                                    onDraftChange={props.onTitleDraftChange}
                                    onStart={props.onStartTitleEditing}
                                    onFinish={props.onFinishTitleEditing}
                                    onCancel={props.onCancelTitleEditing}
                                />
                            ),
                            subtitle: props.performanceReduced ? "已降低媒体预览开销" : "节点式 AI 创作画布",
                            status: props.performanceReduced ? { label: "性能优化中", tone: "warning", icon: <Gauge size={14} /> } : undefined,
                        }}
                        slots={{
                            leading: (
                                <div className={styles.topActions}>
                                    <ProjectNavigationMenu {...props} />
                                </div>
                            ),
                            center: (
                                <div className={`${styles.topActions} ${styles.wideOnly}`}>
                                    <ChromeButton label="撤销" icon={<Undo2 size={16} />} disabled={!props.canUndo} onClick={props.onUndo} />
                                    <ChromeButton label="重做" icon={<Redo2 size={16} />} disabled={!props.canRedo} onClick={props.onRedo} />
                                    <ChromeButton label="新建画布" icon={<FilePlus2 size={16} />} onClick={props.onCreateProject} />
                                    <ChromeButton label="导入素材" icon={<Import size={16} />} onClick={props.onImportImage} />
                                </div>
                            ),
                            actions: (
                                <div className={styles.topActions}>
                                    {props.compactAgentStatus}
                                    {props.handoffControl}
                                    {props.accountControl}
                                    <label className={styles.wideOnly}>
                                        <span className="sr-only">性能模式</span>
                                        <select className={styles.performanceSelect} aria-label="性能模式" value={props.performanceMode} onChange={(event) => props.onPerformanceModeChange(event.target.value as CanvasMediaPerformanceMode)}>
                                            <option value="auto">自动性能</option>
                                            <option value="quality">画质优先</option>
                                            <option value="performance">性能优先</option>
                                        </select>
                                    </label>
                                    <ChromeButton label="删除当前画布" icon={<Trash2 size={16} />} danger onClick={props.onDeleteProject} />
                                    <ChromeButton
                                        label="Agent 对话"
                                        icon={props.assistantOpen ? <PanelRightClose size={17} /> : <MessageSquareShare size={17} />}
                                        active={props.assistantOpen}
                                        controls={assistantRailId}
                                        expanded={props.assistantOpen}
                                        onClick={props.onToggleAgent}
                                    />
                                </div>
                            ),
                        }}
                        ariaLabel="Canvas 状态与操作"
                    />
                }
                overlays={
                    <>
                        {props.overlays}
                        {props.generationComposer}
                    </>
                }
                toolDock={
                    <WorkspaceToolDock
                        theme={theme}
                        items={toolItems}
                        leading={props.addComponentsControl || <CanvasCreateMenu actions={props.creationActions} />}
                        trailing={
                            props.appearanceControl ||
                            (hasAppearanceCapabilities(props) ? (
                                <CanvasAppearanceMenu
                                    colorTheme={props.colorTheme}
                                    backgroundMode={props.backgroundMode}
                                    showImageInfo={props.showImageInfo}
                                    onColorThemeChange={props.onColorThemeChange}
                                    onBackgroundModeChange={props.onBackgroundModeChange}
                                    onShowImageInfoChange={props.onShowImageInfoChange}
                                />
                            ) : null)
                        }
                        ariaLabel="Canvas 工具与创建动作"
                    />
                }
                zoomDock={
                    <WorkspaceZoomDock
                        theme={theme}
                        className={styles.canvasZoomDock}
                        descriptor={{
                            value: `${percent}%`,
                            valueLabel: `当前缩放比例 ${percent}%`,
                            zoomOut: { label: "缩小", icon: <ZoomOut size={15} />, disabled: props.scale <= 0.05, onPress: () => props.onScaleChange(clampScale(props.scale / 1.1)) },
                            zoomIn: { label: "放大", icon: <ZoomIn size={15} />, disabled: props.scale >= 5, onPress: () => props.onScaleChange(clampScale(props.scale * 1.1)) },
                            fit: { label: "重置视图", icon: <Focus size={15} />, onPress: props.onResetViewport },
                        }}
                        trailing={
                            <div className={styles.zoomTrailing}>
                                <input className={styles.zoomRange} type="range" min="5" max="500" step="1" value={percent} aria-label="放大/缩小画布" onChange={(event) => props.onScaleChange(Number(event.target.value) / 100)} />
                                <ChromeButton label={props.isMiniMapOpen ? "关闭小地图" : "打开小地图"} icon={<Compass size={15} />} active={props.isMiniMapOpen} onClick={props.onToggleMiniMap} />
                                {props.shortcutsControl || <CanvasShortcutsMenu />}
                            </div>
                        }
                    />
                }
                rightRail={
                    <WorkspaceRightRail
                        open={props.assistantOpen}
                        theme={theme}
                        descriptor={props.assistantPanel ? undefined : { title: "Agent", subtitle: "画布助手", closeLabel: "收起 Agent" }}
                        onClose={props.assistantPanel ? undefined : props.onToggleAgent}
                        closeIcon={<PanelRightClose size={16} />}
                        ariaLabel="Canvas Agent 面板"
                    >
                        <div id={assistantRailId} className={styles.railContent} data-canvas-assistant-host>
                            {props.assistantPanel}
                        </div>
                    </WorkspaceRightRail>
                }
            >
                {props.surface}
            </CreativeWorkspaceShell>
        </div>
    );
}

function canvasWorkspaceToolEntries(props: CanvasCreativeWorkspaceChromeProps): WorkspaceToolDockEntry[] {
    const entries: WorkspaceToolDockEntry[] = [
        {
            kind: "action",
            id: "move",
            label: "移动/选择",
            icon: <Hand />,
            active: props.canvasTool === "move",
            onPress: () => (props.canvasTool === "move" ? props.onDeselect() : props.onCanvasToolChange("move")),
        },
        {
            kind: "action",
            id: "box-select",
            label: "框选",
            icon: <BoxSelect />,
            active: props.canvasTool === "box-select",
            onPress: () => props.onCanvasToolChange(props.canvasTool === "box-select" ? "move" : "box-select"),
        },
        { kind: "action", id: "undo", label: "撤销", icon: <Undo2 />, keyShortcut: "Control+Z", disabled: !props.canUndo, onPress: props.onUndo },
        { kind: "action", id: "redo", label: "重做", icon: <Redo2 />, keyShortcut: "Control+Shift+Z", disabled: !props.canRedo, onPress: props.onRedo },
        { kind: "separator", id: "create" },
        ...props.creationActions.map<WorkspaceToolDockEntry>((action) => ({
            kind: "action",
            id: `create-${action.id}`,
            label: action.label,
            icon: action.icon,
            disabled: action.disabled,
            onPress: action.onCreate,
        })),
        { kind: "separator", id: "assets" },
        { kind: "action", id: "upload", label: "上传素材", icon: <Upload />, onPress: props.onUpload },
        { kind: "action", id: "assets", label: "我的素材", icon: <Images />, onPress: props.onOpenMyAssets },
    ];

    if (props.selectedCount > 1) {
        entries.push({ kind: "separator", id: "selection" });
        entries.push({ kind: "action", id: "group", label: "编组", icon: <Group />, onPress: props.onGroup });
    }
    if (props.canUngroup) entries.push({ kind: "action", id: "ungroup", label: "解除编组", icon: <Ungroup />, onPress: props.onUngroup });
    if (props.selectedCount > 0) entries.push({ kind: "action", id: "delete-selected", label: "删除选中", icon: <Trash2 />, danger: true, onPress: props.onDeleteSelected });
    entries.push({ kind: "action", id: "clear", label: "清空画布", icon: <Trash2 />, danger: true, onPress: props.onClear });
    return entries;
}

type CanvasWorkspaceTitleProps = {
    title: string;
    draft: string;
    editing: boolean;
    onDraftChange: (value: string) => void;
    onStart: () => void;
    onFinish: () => void;
    onCancel: () => void;
};

const CanvasWorkspaceTitle = forwardRef<HTMLDivElement, CanvasWorkspaceTitleProps>(function CanvasWorkspaceTitle({ title, draft, editing, onDraftChange, onStart, onFinish, onCancel }, ref) {
    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") onFinish();
        if (event.key === "Escape") onCancel();
    };
    const handleChange = (event: ChangeEvent<HTMLInputElement>) => onDraftChange(event.target.value);

    return (
        <div ref={ref} className={styles.titleEditor}>
            {editing ? (
                <input autoFocus value={draft} className={styles.titleInput} aria-label="画布名称" onChange={handleChange} onBlur={onFinish} onKeyDown={handleKeyDown} />
            ) : (
                <button type="button" className={styles.titleButton} title="双击修改画布名称" onDoubleClick={onStart}>
                    {title}
                </button>
            )}
        </div>
    );
});

function ChromeButton({ label, icon, disabled, danger, active, controls, expanded, onClick }: { label: string; icon: ReactNode; disabled?: boolean; danger?: boolean; active?: boolean; controls?: string; expanded?: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            className={`${styles.chromeButton} ${active ? styles.chromeButtonActive : ""} ${danger ? styles.dangerButton : ""}`}
            aria-label={label}
            aria-pressed={typeof active === "boolean" ? active : undefined}
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

function clampScale(scale: number) {
    return Math.min(5, Math.max(0.05, scale));
}

function ProjectNavigationMenu(props: Pick<CanvasCreativeWorkspaceChromeProps, "onWorkbench" | "onProjects" | "onCreateProject" | "onDeleteProject" | "onImportImage">) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const close = (event: PointerEvent) => {
            if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [open]);

    const run = (action: () => void) => {
        setOpen(false);
        action();
    };

    return (
        <div ref={wrapRef} className={styles.menuWrap}>
            <ChromeButton label="打开画布菜单" icon={<Menu size={17} />} active={open} expanded={open} controls="canvas-project-menu" onClick={() => setOpen((value) => !value)} />
            {open ? (
                <div id="canvas-project-menu" className={styles.projectMenu} role="menu" aria-label="画布项目菜单" onKeyDown={(event) => event.key === "Escape" && setOpen(false)}>
                    <MenuAction label="工作台" icon={<LayoutGrid />} onClick={() => run(props.onWorkbench)} />
                    <MenuAction label="我的画布" icon={<Images />} onClick={() => run(props.onProjects)} />
                    <MenuAction label="新建画布" icon={<FilePlus2 />} onClick={() => run(props.onCreateProject)} />
                    <MenuAction label="导入素材" icon={<Import />} onClick={() => run(props.onImportImage)} />
                    <MenuAction label="删除当前画布" icon={<Trash2 />} danger onClick={() => run(props.onDeleteProject)} />
                </div>
            ) : null}
        </div>
    );
}

function CanvasCreateMenu({ actions }: { actions: readonly CanvasWorkspaceCreationAction[] }) {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [panelStyle, setPanelStyle] = useState<React.CSSProperties | null>(null);

    const syncPanelPosition = useCallback(() => {
        const trigger = triggerRef.current?.getBoundingClientRect();
        if (!trigger) return;
        const margin = 12;
        const gap = 10;
        const width = Math.min(224, window.innerWidth - margin * 2);
        setPanelStyle({
            position: "fixed",
            zIndex: 1200,
            width,
            left: Math.max(margin, Math.min(window.innerWidth - width - margin, trigger.left)),
            top: "auto",
            bottom: Math.max(margin, window.innerHeight - trigger.top + gap),
            maxHeight: Math.max(80, trigger.top - gap - margin),
            overflowY: "auto",
        });
    }, []);

    useEffect(() => {
        if (!open) return;
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node) || triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            setOpen(false);
        };
        const closeOnEscape = (event: globalThis.KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setOpen(false);
            triggerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
        };
        syncPanelPosition();
        const frame = window.requestAnimationFrame(() => panelRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus());
        window.addEventListener("resize", syncPanelPosition);
        window.addEventListener("scroll", syncPanelPosition, true);
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        window.addEventListener("keydown", closeOnEscape);
        return () => {
            window.cancelAnimationFrame(frame);
            window.removeEventListener("resize", syncPanelPosition);
            window.removeEventListener("scroll", syncPanelPosition, true);
            window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
            window.removeEventListener("keydown", closeOnEscape);
        };
    }, [open, syncPanelPosition]);

    return (
        <div ref={triggerRef} className={`${styles.menuWrap} ${styles.compactOnly}`}>
            <ChromeButton label="添加组件" icon={<ImageIcon size={17} />} active={open} expanded={open} controls="canvas-create-menu" onClick={() => setOpen((value) => !value)} />
            {open && panelStyle
                ? createPortal(
                      <div ref={panelRef} id="canvas-create-menu" className={styles.createMenu} style={panelStyle} role="menu" aria-label="添加组件" onKeyDown={(event) => handleMenuKeys(event, () => setOpen(false))}>
                          {actions.map((action) => (
                              <button
                                  key={action.id}
                                  type="button"
                                  role="menuitem"
                                  disabled={action.disabled}
                                  onClick={() => {
                                      setOpen(false);
                                      action.onCreate();
                                  }}
                              >
                                  {action.icon}
                                  <span>{action.label}</span>
                              </button>
                          ))}
                      </div>,
                      document.body,
                  )
                : null}
        </div>
    );
}

function CanvasAppearanceMenu({
    colorTheme,
    backgroundMode,
    showImageInfo,
    onColorThemeChange,
    onBackgroundModeChange,
    onShowImageInfoChange,
}: Pick<CanvasCreativeWorkspaceChromeProps, "colorTheme" | "backgroundMode" | "showImageInfo" | "onColorThemeChange" | "onBackgroundModeChange" | "onShowImageInfoChange">) {
    const [open, setOpen] = useState(false);
    return (
        <div className={styles.menuWrap}>
            <ChromeButton label="画布外观" icon={<LayoutGrid size={17} />} active={open} expanded={open} controls="canvas-appearance-menu" onClick={() => setOpen((value) => !value)} />
            {open ? (
                <div id="canvas-appearance-menu" className={styles.appearanceMenu} role="group" aria-label="画布外观设置">
                    {onColorThemeChange ? (
                        <fieldset>
                            <legend>主题</legend>
                            <button type="button" aria-pressed={colorTheme === "light"} onClick={() => onColorThemeChange("light")}>
                                <Sun />
                                浅色
                            </button>
                            <button type="button" aria-pressed={colorTheme === "dark"} onClick={() => onColorThemeChange("dark")}>
                                <Moon />
                                深色
                            </button>
                        </fieldset>
                    ) : null}
                    {backgroundMode && onBackgroundModeChange ? (
                        <label>
                            背景
                            <select value={backgroundMode} onChange={(event) => onBackgroundModeChange(event.target.value as CanvasBackgroundMode)}>
                                <option value="dots">点阵</option>
                                <option value="lines">网格</option>
                                <option value="blank">空白</option>
                            </select>
                        </label>
                    ) : null}
                    {typeof showImageInfo === "boolean" && onShowImageInfoChange ? (
                        <label>
                            <input type="checkbox" checked={showImageInfo} onChange={(event) => onShowImageInfoChange(event.target.checked)} />
                            显示图片信息
                        </label>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

function CanvasShortcutsMenu() {
    const [open, setOpen] = useState(false);
    const shortcuts = [
        ["拖动空白处", "平移画布"],
        ["Space + 拖动", "临时平移"],
        ["滚轮 / 触控板", "缩放画布"],
        ["Ctrl / Cmd + A", "全选节点"],
        ["Ctrl / Cmd + C / V", "复制 / 粘贴"],
        ["Ctrl / Cmd + Z", "撤销"],
        ["Delete / Backspace", "删除选中"],
        ["Esc", "取消选择或关闭浮层"],
    ] as const;
    return (
        <div className={styles.menuWrap}>
            <ChromeButton label="打开画布快捷键" icon={<Keyboard size={15} />} active={open} expanded={open} controls="canvas-shortcuts-menu" onClick={() => setOpen((value) => !value)} />
            {open ? (
                <div id="canvas-shortcuts-menu" className={styles.shortcutsMenu} role="dialog" aria-label="画布快捷键">
                    <strong>画布快捷键</strong>
                    {shortcuts.map(([keys, action]) => (
                        <div key={keys}>
                            <kbd>{keys}</kbd>
                            <span>{action}</span>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function MenuAction({ label, icon, danger, onClick }: { label: string; icon: ReactNode; danger?: boolean; onClick: () => void }) {
    return (
        <button type="button" role="menuitem" className={danger ? styles.menuDanger : undefined} onClick={onClick}>
            {icon}
            <span>{label}</span>
        </button>
    );
}

function handleMenuKeys(event: KeyboardEvent<HTMLDivElement>, close: () => void) {
    if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
    }
    if (!new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]).has(event.key)) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)"));
    if (!items.length) return;
    event.preventDefault();
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
    const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + delta + items.length) % items.length;
    items[next]?.focus();
}

function hasAppearanceCapabilities(props: CanvasCreativeWorkspaceChromeProps) {
    return Boolean(props.onColorThemeChange || (props.backgroundMode && props.onBackgroundModeChange) || (typeof props.showImageInfo === "boolean" && props.onShowImageInfoChange));
}
