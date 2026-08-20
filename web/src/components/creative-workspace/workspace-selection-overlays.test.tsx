import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceSelectionPrompt, WorkspaceSelectionSizeBar } from "./workspace-selection-overlays";

const viewport = { x: 0, y: 0, width: 1_000, height: 700 };

describe("workspace selection overlays", () => {
    it("renders an editable Asui-style size bar above the selection", () => {
        const markup = renderToStaticMarkup(
            <WorkspaceSelectionSizeBar selectionBounds={{ x: 300, y: 260, width: 240, height: 180 }} viewportBounds={viewport} dimensions={{ width: 1200, height: 900, editable: true }} onCommit={vi.fn()} actions={<button type="button">抠图</button>} />,
        );

        expect(markup).toContain("data-workspace-selection-size-bar");
        expect(markup).toContain('data-side="top"');
        expect(markup).toContain('aria-label="选区宽度"');
        expect(markup).toContain('value="1200"');
        expect(markup).toContain('pattern="[0-9]*"');
        expect(markup).toContain("抠图");
    });

    it("renders the prompt below the selection and fails closed while busy", () => {
        const markup = renderToStaticMarkup(<WorkspaceSelectionPrompt selectionBounds={{ x: 200, y: 160, width: 300, height: 200 }} viewportBounds={viewport} value="保留主体，改成夜景" onChange={vi.fn()} onSubmit={vi.fn()} busy />);

        expect(markup).toContain("data-workspace-selection-prompt");
        expect(markup).toContain('data-side="bottom"');
        expect(markup).toContain("保留主体，改成夜景");
        expect(markup).toContain("disabled");
        expect(markup).toContain("Enter 发送");
    });

    it("renders nothing without a stable selection anchor", () => {
        expect(renderToStaticMarkup(<WorkspaceSelectionSizeBar selectionBounds={null} viewportBounds={viewport} dimensions={{ width: 1, height: 1 }} />)).toBe("");
    });
});
