import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createDesignDocumentFixture } from "@/lib/design/design.test-fixture";

import { DesignEditorCreativeShell, designSelectionCapabilities, type DesignEditorCreativeShellProps } from "./design-editor-creative-shell";
import { designSaveStatusDescriptor, designWorkspaceTheme } from "./design-editor-creative-shell-theme";

function props(overrides: Partial<DesignEditorCreativeShellProps> = {}): DesignEditorCreativeShellProps {
    const document = createDesignDocumentFixture();
    return {
        project: { id: "design-one", title: "商品主图", status: "active", revision: 7, document, createdAt: "2026-08-11T08:00:00.000Z", updatedAt: "2026-08-11T08:00:00.000Z" },
        selection: { kind: "elements", ids: ["element-product", "element-title", "element-line"] },
        save: { status: "dirty", pendingCount: 2 },
        colorTheme: "light",
        surface: <div>Fabric Surface</div>,
        layersPanel: <div>Layer Content</div>,
        inspectorPanel: <div>Inspector Content</div>,
        agentPanel: <div>Agent Content</div>,
        rightRailOpen: true,
        rightTab: "layers",
        canUndo: true,
        canRedo: false,
        undoLabel: "移动元素",
        onBack: vi.fn(),
        onUndo: vi.fn(),
        onRedo: vi.fn(),
        onFlush: vi.fn(),
        onRetrySave: vi.fn(),
        onReloadServerVersion: vi.fn(),
        onDeleteProject: vi.fn(),
        onOpenExport: vi.fn(),
        onToggleRightRail: vi.fn(),
        onRightTabChange: vi.fn(),
        onCreateFrame: vi.fn(),
        onCreateElement: vi.fn(),
        onUploadImage: vi.fn(),
        onOpenAssetLibrary: vi.fn(),
        onZoomOut: vi.fn(),
        onZoomIn: vi.fn(),
        onFit: vi.fn(),
        onAlign: vi.fn(),
        onDistribute: vi.fn(),
        ...overrides,
    };
}

describe("DesignEditorCreativeShell", () => {
    it("SSR 组合 Design 快照、共享工作台与领域面板", () => {
        const markup = renderToStaticMarkup(<DesignEditorCreativeShell {...props()} />);

        expect(markup).toContain("data-creative-workspace-shell");
        expect(markup).toContain("data-workspace-top-bar");
        expect(markup).toContain("data-workspace-tool-dock");
        expect(markup).toContain("data-workspace-zoom-dock");
        expect(markup).toContain("data-workspace-right-rail");
        expect(markup).toContain("商品主图");
        expect(markup).toContain("r7");
        expect(markup).toContain("待保存");
        expect(markup).toContain("Fabric Surface");
        expect(markup).toContain("Layer Content");
        expect(markup).not.toContain("Inspector Content");
        expect(markup).toContain("25%");
        expect(markup).toContain('aria-label="选区排版"');
        expect(markup).toContain('aria-label="水平等距分布"');
        expect(markup).toContain('data-testid="design-editor-workbench"');
    });

    it("展示已实现的图片输入和导出能力，但不渲染尚未接通的 AI 改图按钮", () => {
        const markup = renderToStaticMarkup(<DesignEditorCreativeShell {...props()} />);

        expect(markup).toContain('data-workspace-tool-id="frame"');
        expect(markup).toContain('data-workspace-tool-id="text"');
        expect(markup).toContain("新建形状、线条或箭头");
        expect(markup).toContain('data-workspace-tool-id="upload-image"');
        expect(markup).toContain('data-workspace-tool-id="asset-library"');
        expect(markup).toContain("上传图片");
        expect(markup).toContain("从素材库插入");
        expect(markup).not.toContain("AI 改图");
        expect(markup).toContain('aria-label="导出画框"');
        expect(markup).toContain('aria-keyshortcuts="Control+Shift+E Meta+Shift+E"');
    });

    it("仅在单选图片时展示五个图片工具入口", () => {
        const actions = {
            onCrop: vi.fn(),
            onAnnotation: vi.fn(),
            onMask: vi.fn(),
            onRemoveBackground: vi.fn(),
            onUpscale: vi.fn(),
        };
        const imageMarkup = renderToStaticMarkup(<DesignEditorCreativeShell {...props({ selection: { kind: "elements", ids: ["element-product"] }, imageToolbarActions: actions })} />);
        const textMarkup = renderToStaticMarkup(<DesignEditorCreativeShell {...props({ selection: { kind: "elements", ids: ["element-title"] }, imageToolbarActions: actions })} />);

        for (const label of ["裁剪图片", "添加批注", "蒙版编辑", "移除背景", "放大图片"]) expect(imageMarkup).toContain(`aria-label="${label}"`);
        expect(imageMarkup).toContain('aria-label="左对齐"');
        expect(textMarkup).not.toContain('aria-label="裁剪图片"');
        expect(textMarkup).not.toContain('aria-label="蒙版编辑"');
    });

    it("关闭 rail 时仍保留可访问的重新打开入口", () => {
        const markup = renderToStaticMarkup(<DesignEditorCreativeShell {...props({ rightRailOpen: false })} />);

        expect(markup).toContain('data-state="closed"');
        expect(markup).toContain('aria-hidden="true"');
        expect(markup).toContain('aria-label="展开辅助面板"');
        expect(markup).toContain('aria-expanded="false"');
    });

    it("renders the shared Agent entry and accessible rail tab", () => {
        const markup = renderToStaticMarkup(<DesignEditorCreativeShell {...props({ rightTab: "agent" })} />);

        expect(markup).toContain('data-workspace-tool-id="agent"');
        expect(markup).toContain('role="tablist" aria-label="检查器视图"');
        expect(markup).toMatch(/role="tab" aria-selected="true"[^>]*>Agent<\/button>/);
        expect(markup).toContain('role="tabpanel"');
        expect(markup).toContain("Agent Content");
        expect(markup).not.toContain("Layer Content");
        expect(markup).not.toContain("Inspector Content");
    });

    it("在所有断点都提供保存失败与冲突恢复入口", () => {
        const failed = renderToStaticMarkup(<DesignEditorCreativeShell {...props({ save: { status: "error", errorMessage: "网络错误", pendingCount: 1 } })} />);
        const conflict = renderToStaticMarkup(<DesignEditorCreativeShell {...props({ save: { status: "conflict", remoteRevision: 9, pendingCount: 1 } })} />);

        expect(failed).toContain('data-testid="design-save-error"');
        expect(failed).toContain("网络错误");
        expect(failed).toContain("重试保存");
        expect(conflict).toContain('data-testid="design-conflict-banner"');
        expect(conflict).toContain("服务端当前 r9");
        expect(conflict).toContain("放弃本地草稿并载入服务端版本");
    });
});

describe("Design creative shell pure contracts", () => {
    it("maps the existing DQ canvas palette into shared theme tokens", () => {
        expect(designWorkspaceTheme("light")).toMatchObject({ canvasBackground: "#f8fbff", activeForeground: "#0f172a" });
        expect(designWorkspaceTheme("dark")).toMatchObject({ canvasBackground: "#07080b", dangerForeground: "#f87171" });
    });

    it("maps save failures and conflicts to assertive danger state", () => {
        expect(designSaveStatusDescriptor("saving")).toMatchObject({ label: "保存中", tone: "info", busy: true });
        expect(designSaveStatusDescriptor("error", "网络错误")).toMatchObject({ label: "保存失败", tone: "danger", role: "alert", detail: "网络错误" });
        expect(designSaveStatusDescriptor("conflict")).toMatchObject({ label: "版本冲突", tone: "danger", role: "alert" });
    });

    it("requires three unlocked elements before enabling distribution", () => {
        const document = createDesignDocumentFixture();
        expect(designSelectionCapabilities(document, { kind: "elements", ids: ["element-product", "element-title"] })).toMatchObject({ visible: true, disabled: false, canDistribute: false });
        expect(designSelectionCapabilities(document, { kind: "elements", ids: ["element-product", "element-title", "element-line"] })).toMatchObject({ visible: true, disabled: false, canDistribute: true });
        expect(designSelectionCapabilities(document, null)).toEqual({ visible: false, disabled: true, canDistribute: false });
    });
});
