import { Circle, FileImage, Globe2, Music2, Pencil, Settings2, Type, Video } from "lucide-react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CanvasCreativeWorkspaceChrome, type CanvasCreativeWorkspaceChromeProps, type CanvasWorkspaceCreationAction } from "./canvas-creative-workspace-chrome";

function props(overrides: Partial<CanvasCreativeWorkspaceChromeProps> = {}): CanvasCreativeWorkspaceChromeProps {
    const creationActions: CanvasWorkspaceCreationAction[] = [
        { id: "text", label: "新建文本", icon: <Type />, onCreate: vi.fn() },
        { id: "image", label: "新建图片", icon: <FileImage />, onCreate: vi.fn() },
        { id: "panorama", label: "新建全景图", icon: <Globe2 />, onCreate: vi.fn() },
        { id: "drawing", label: "新建绘图", icon: <Pencil />, onCreate: vi.fn() },
        { id: "video", label: "新建视频", icon: <Video />, onCreate: vi.fn() },
        { id: "audio", label: "新建音频", icon: <Music2 />, onCreate: vi.fn() },
        { id: "config", label: "新建生成配置", icon: <Settings2 />, onCreate: vi.fn() },
    ];

    return {
        colorTheme: "dark",
        surface: <div data-testid="canvas-surface">surface</div>,
        overlays: <div data-testid="canvas-overlays">overlays</div>,
        generationComposer: <div data-testid="canvas-composer">composer</div>,
        assistantPanel: <div data-testid="canvas-agent">agent body</div>,
        assistantOpen: true,
        title: "分镜画布",
        titleDraft: "分镜画布",
        isTitleEditing: false,
        onTitleDraftChange: vi.fn(),
        onStartTitleEditing: vi.fn(),
        onFinishTitleEditing: vi.fn(),
        onCancelTitleEditing: vi.fn(),
        canUndo: true,
        canRedo: false,
        onUndo: vi.fn(),
        onRedo: vi.fn(),
        onWorkbench: vi.fn(),
        onProjects: vi.fn(),
        onCreateProject: vi.fn(),
        onDeleteProject: vi.fn(),
        onImportImage: vi.fn(),
        performanceMode: "auto",
        performanceReduced: false,
        onPerformanceModeChange: vi.fn(),
        onToggleAgent: vi.fn(),
        canvasTool: "move",
        onCanvasToolChange: vi.fn(),
        onDeselect: vi.fn(),
        selectedCount: 2,
        onDeleteSelected: vi.fn(),
        onClear: vi.fn(),
        onGroup: vi.fn(),
        canUngroup: true,
        onUngroup: vi.fn(),
        onUpload: vi.fn(),
        onOpenMyAssets: vi.fn(),
        creationActions,
        scale: 1.25,
        onScaleChange: vi.fn(),
        onResetViewport: vi.fn(),
        isMiniMapOpen: true,
        onToggleMiniMap: vi.fn(),
        shortcutsControl: (
            <button type="button" aria-label="打开画布快捷键">
                <Circle />
            </button>
        ),
        appearanceControl: (
            <button type="button" aria-label="画布外观">
                <Circle />
            </button>
        ),
        addComponentsControl: (
            <button type="button" aria-label="添加组件">
                <Circle />
            </button>
        ),
        ...overrides,
    };
}

describe("CanvasCreativeWorkspaceChrome", () => {
    it("server-renders shared chrome around opaque Canvas domain slots", () => {
        const markup = renderToStaticMarkup(<CanvasCreativeWorkspaceChrome {...props()} />);

        expect(markup).toContain('data-testid="canvas-creative-workspace"');
        expect(markup).toContain("data-creative-workspace-shell");
        expect(markup).toContain("data-workspace-top-bar");
        expect(markup).toContain("data-workspace-tool-dock");
        expect(markup).toContain("data-workspace-zoom-dock");
        expect(markup).toContain("data-workspace-right-rail");
        expect(markup).toContain('data-testid="canvas-surface"');
        expect(markup).toContain('data-testid="canvas-overlays"');
        expect(markup).toContain('data-testid="canvas-composer"');
        expect(markup).toContain('data-testid="canvas-agent"');
        expect(markup).toContain('data-canvas-assistant-host="true"');
        expect(markup).toContain('aria-label="打开画布菜单"');
        expect(markup).toContain('aria-label="添加组件"');
        expect(markup).toContain('aria-label="打开画布快捷键"');
        expect(markup).toContain('aria-label="Agent 对话"');
        expect(markup).toContain("125%");
        expect(markup).toContain('aria-label="关闭小地图"');
        expect(markup).toContain('aria-label="放大/缩小画布"');
        expect(markup).toContain('min="5"');
        expect(markup).toContain('max="500"');
        expect(readFileSync(new URL("./canvas-creative-workspace-chrome.tsx", import.meta.url), "utf8")).toContain("createPortal(");
    });

    it("keeps the wide Canvas zoom dock above the tool dock until the compact breakpoint takes over", () => {
        const markup = renderToStaticMarkup(<CanvasCreativeWorkspaceChrome {...props()} />);
        const css = readFileSync(new URL("./canvas-creative-workspace-chrome.module.css", import.meta.url), "utf8");

        expect(markup).toContain("canvasZoomDock");
        expect(css).toContain("@media (min-width: 521px) and (max-width: 1500px)");
        expect(css).toContain("--workspace-generation-composer-bottom: 128px");
        expect(css).toMatch(/\.canvasZoomDock\s*\{\s*transform:\s*translateY\(-64px\)/);
        expect(css).toMatch(/\.menuWrap:focus-within\s*\{\s*z-index:\s*1200/);
    });

    it("exposes only caller-confirmed creation capabilities and selection actions", () => {
        const markup = renderToStaticMarkup(
            <CanvasCreativeWorkspaceChrome
                {...props({
                    selectedCount: 0,
                    canUngroup: false,
                    creationActions: [{ id: "text", label: "新建文本", icon: <Type />, onCreate: vi.fn() }],
                })}
            />,
        );

        expect(markup).toContain('data-workspace-tool-id="create-text"');
        expect(markup).not.toContain('data-workspace-tool-id="create-image"');
        expect(markup).not.toContain('data-workspace-tool-id="group"');
        expect(markup).not.toContain('data-workspace-tool-id="ungroup"');
        expect(markup).not.toContain('data-workspace-tool-id="delete-selected"');
        expect(markup).toContain('data-workspace-tool-id="clear"');
    });

    it("does not create a second Agent header when the existing panel is hosted", () => {
        const markup = renderToStaticMarkup(<CanvasCreativeWorkspaceChrome {...props()} />);

        expect(markup).toContain("agent body");
        expect(markup).not.toContain("画布助手");
        expect(markup).not.toContain("rightRailHeader");
    });
});
