import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CreativeWorkspaceShell } from "./creative-workspace-shell";
import { WorkspaceRightRail } from "./workspace-right-rail";
import { WorkspaceToolDock, type WorkspaceToolDockEntry } from "./workspace-tool-dock";
import { WorkspaceTopBar } from "./workspace-top-bar";
import { WorkspaceZoomDock } from "./workspace-zoom-dock";
import type { WorkspaceThemeTokens } from "./workspace-theme";

const theme: WorkspaceThemeTokens = {
    canvasBackground: "#07080b",
    canvasBackdrop: "radial-gradient(circle, #111, #07080b)",
    panelBackground: "rgba(10,12,16,.96)",
    panelBorder: "#303642",
    foreground: "#f8fafc",
    mutedForeground: "#94a3b8",
    controlForeground: "#e5e7eb",
    controlHoverBackground: "#1f2937",
    activeBackground: "#f8fafc",
    activeForeground: "#0f172a",
    dangerForeground: "#f87171",
    focusRing: "#ffffff",
    successForeground: "#34d399",
    warningForeground: "#fbbf24",
    infoForeground: "#60a5fa",
};

describe("creative workspace shared UI", () => {
    it("composes canvas chrome and a desktop sibling rail through slots", () => {
        const markup = renderToStaticMarkup(
            <CreativeWorkspaceShell
                theme={theme}
                canvasAriaLabel="图片创作区"
                topBar={
                    <WorkspaceTopBar
                        theme={theme}
                        descriptor={{ title: "海报方案", subtitle: "自动保存", revision: "r12", status: { label: "已保存", tone: "success" } }}
                        slots={{ leading: <button type="button">返回</button>, actions: <button type="button">导出</button> }}
                    />
                }
                overlays={<div>浮层</div>}
                rightRail={
                    <WorkspaceRightRail open theme={theme} descriptor={{ title: "创作 Agent", subtitle: "使用当前选区" }} onClose={vi.fn()} slots={{ footer: <div>输入区</div> }}>
                        <div>会话内容</div>
                    </WorkspaceRightRail>
                }
            >
                <div>渲染表面</div>
            </CreativeWorkspaceShell>,
        );

        expect(markup).toContain("data-creative-workspace-shell");
        expect(markup).toContain('aria-label="图片创作区"');
        expect(markup).toContain("海报方案");
        expect(markup).toContain("r12");
        expect(markup).toContain('data-tone="success"');
        expect(markup).toContain("渲染表面");
        expect(markup).toContain("浮层");
        expect(markup).toContain('data-workspace-right-rail="true"');
        expect(markup).toContain('data-state="open"');
        expect(markup).toContain("会话内容");
        expect(markup).toContain("输入区");
        expect(markup).toContain("--creative-workspace-active:#f8fafc");
    });

    it("renders ordered tool descriptors with separators and complete aria state", () => {
        const entries: WorkspaceToolDockEntry[] = [
            { kind: "action", id: "select", label: "选择", icon: <span>S</span>, active: true, onPress: vi.fn() },
            { kind: "action", id: "hand", label: "移动画布", icon: <span>H</span>, active: false, keyShortcut: "H", onPress: vi.fn() },
            { kind: "separator", id: "creation" },
            { kind: "action", id: "image", label: "新建图片", icon: <span>I</span>, disabled: true },
            { kind: "action", id: "agent", label: "打开 Agent", icon: <span>A</span>, busy: true, expanded: false, controls: "agent-panel", popup: "dialog" },
            { kind: "action", id: "hidden", label: "隐藏能力", icon: <span>X</span>, hidden: true },
        ];
        const markup = renderToStaticMarkup(<WorkspaceToolDock theme={theme} items={entries} />);

        expect(markup).toContain('role="toolbar"');
        expect(markup).toContain('aria-orientation="horizontal"');
        expect(markup).toContain('data-workspace-tool-id="select"');
        expect(markup).toContain('aria-pressed="true"');
        expect(markup).toContain('data-workspace-tool-id="hand"');
        expect(markup).toContain('aria-keyshortcuts="H"');
        expect(markup).toContain('role="separator"');
        expect(markup).toContain('data-workspace-tool-id="image"');
        expect(markup).toContain("disabled");
        expect(markup).toContain('aria-busy="true"');
        expect(markup).toContain('aria-controls="agent-panel"');
        expect(markup).toContain('aria-haspopup="dialog"');
        expect(markup).not.toContain("隐藏能力");
        expect(markup.indexOf("选择")).toBeLessThan(markup.indexOf("移动画布"));
        expect(markup.indexOf("移动画布")).toBeLessThan(markup.indexOf("新建图片"));
    });

    it("keeps zoom controls generic and marks a closed rail as non-interactive", () => {
        const zoomMarkup = renderToStaticMarkup(
            <WorkspaceZoomDock
                theme={theme}
                descriptor={{
                    value: "125%",
                    valueLabel: "画面缩放 125%",
                    zoomOut: { label: "缩小", onPress: vi.fn() },
                    zoomIn: { label: "放大", onPress: vi.fn() },
                    fit: { label: "适应内容", onPress: vi.fn() },
                }}
            />,
        );
        const railMarkup = renderToStaticMarkup(
            <WorkspaceRightRail open={false} theme={theme} descriptor={{ title: "辅助面板" }}>
                不可交互内容
            </WorkspaceRightRail>,
        );

        expect(zoomMarkup).toContain('data-workspace-zoom-dock="true"');
        expect(zoomMarkup).toContain('aria-label="缩小"');
        expect(zoomMarkup).toContain('aria-label="画面缩放 125%"');
        expect(zoomMarkup).toContain("125%");
        expect(zoomMarkup).toContain('aria-label="适应内容"');
        expect(railMarkup).toContain('aria-hidden="true"');
        expect(railMarkup).toContain("inert");
        expect(railMarkup).toContain('data-state="closed"');
    });
});
