import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceExportReview, normalizeWorkspaceExportSettings } from "./workspace-export-review";
import type { WorkspaceThemeTokens } from "./workspace-theme";

const theme: WorkspaceThemeTokens = {
    canvasBackground: "#eceff3",
    panelBackground: "#ffffff",
    panelBorder: "#d8dde5",
    foreground: "#111827",
    mutedForeground: "#64748b",
    controlForeground: "#334155",
    controlHoverBackground: "#eef2f7",
    activeBackground: "#111827",
    activeForeground: "#ffffff",
    dangerForeground: "#b91c1c",
    focusRing: "#2563eb",
};

describe("WorkspaceExportReview", () => {
    it("normalizes transparent JPEG to an explicit opaque background", () => {
        expect(normalizeWorkspaceExportSettings({ format: "jpeg", scale: 2, quality: 2, background: "transparent" })).toEqual({ format: "jpeg", scale: 2, quality: 1, background: "white" });
    });

    it("renders domain-neutral selectable items and complete export controls", () => {
        const markup = renderToStaticMarkup(
            <WorkspaceExportReview
                open
                title="导出画框"
                items={[
                    { id: "one", name: "主图", width: 1200, height: 1200, selectedByDefault: true },
                    { id: "two", name: "详情", width: 1080, height: 1440, selectedByDefault: true },
                ]}
                initialSettings={{ format: "png", scale: 1, quality: 1, background: "original" }}
                theme={theme}
                onExport={vi.fn()}
                onClose={vi.fn()}
            />,
        );

        expect(markup).toContain("data-workspace-export-review");
        expect(markup).toContain('aria-modal="true"');
        expect(markup).toContain('aria-label="导出格式"');
        expect(markup).toContain('aria-label="导出倍率"');
        expect(markup).toContain('aria-label="背景模式"');
        expect(markup).toContain('aria-label="导出质量"');
        expect(markup).toContain("WebP");
        expect(markup).toContain("透明");
        expect(markup).toContain("批量导出");
    });

    it("does not import either Surface domain or Fabric", () => {
        const source = readFileSync(new URL("./workspace-export-review.tsx", import.meta.url), "utf8");
        expect(source).not.toMatch(/@\/lib\/design|@\/app\/\(user\)\/canvas|from ["']fabric["']/);
    });
});
