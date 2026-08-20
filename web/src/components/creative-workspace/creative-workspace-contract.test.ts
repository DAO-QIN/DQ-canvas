import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const componentFiles = ["./creative-workspace-shell.tsx", "./workspace-top-bar.tsx", "./workspace-tool-dock.tsx", "./workspace-zoom-dock.tsx", "./workspace-right-rail.tsx", "./workspace-theme.ts", "./workspace-generation-composer.tsx"] as const;

describe("creative workspace shared boundary", () => {
    it("does not import feature models or application stores", () => {
        for (const file of componentFiles) {
            const source = readFileSync(new URL(file, import.meta.url), "utf8");
            expect(source, file).not.toMatch(/from\s+["'][^"']*\/(?:canvas|design)(?:\/|["'])/i);
            expect(source, file).not.toContain("@/stores/");
            expect(source, file).not.toMatch(/import\s+(?:type\s+)?\{[^}]*(?:CanvasNodeData|DesignDocument|DesignOperation)[^}]*\}/s);
        }
    });

    it("keeps the Asui dock and responsive rail geometry in the shared stylesheet", () => {
        const css = readFileSync(new URL("./creative-workspace.module.css", import.meta.url), "utf8");

        expect(css).toMatch(/\.toolDock\s*\{[^}]*height:\s*56px/s);
        expect(css).toMatch(/\.toolButton\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/s);
        expect(css).toMatch(/\.toolSeparator\s*\{[^}]*height:\s*28px/s);
        expect(css).toContain("width: clamp(400px, 28vw, 460px)");
        expect(css).toContain("height: calc(100dvh - 24px)");
        expect(css).toContain("border-radius: 22px");
        expect(css).toContain("@media (max-width: 860px)");
        expect(css).toContain("height: min(680px, calc(100dvh - 74px))");
        expect(css).toContain("transform: translateX(calc(100% + 24px))");
        expect(css).toMatch(/transition:\s*transform 200ms ease,\s*visibility 0s linear 200ms/s);
        expect(css).toMatch(/\.rightRail\s*\{[^}]*visibility:\s*hidden/s);
        expect(css).toMatch(/\.rightRailOpen\s*\{[^}]*visibility:\s*visible/s);
        expect(css).toContain("@media (max-width: 520px)");
        expect(css).toMatch(/@media \(max-width: 520px\)[\s\S]*\.toolDock\s*\{[^}]*height:\s*44px/s);
        expect(css).toMatch(/@media \(max-width: 520px\)[\s\S]*\.toolButton\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px/s);
        expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    });

    it("keeps the Asui composer geometry and domain-neutral controls in the shared layer", () => {
        const source = readFileSync(new URL("./workspace-generation-composer.tsx", import.meta.url), "utf8");
        const css = readFileSync(new URL("./workspace-generation-composer.module.css", import.meta.url), "utf8");

        expect(css).toContain("width: min(683px, calc(100% - 32px))");
        expect(css).toContain("border-radius: 30px");
        expect(css).toContain("bottom: var(--workspace-generation-composer-bottom, 88px)");
        expect(source).toContain("<ModelPicker");
        expect(source).toContain("<ImageSettingsPanel");
        expect(source).toContain('referenceUploadKinds = ["image"]');
        expect(source).toContain('kind === "video" ? ["video/mp4", "video/webm", "video/quicktime"]');
        expect(source).toContain("`参考图 ${index + 1}`");
        expect(source).not.toContain("DesignDocument");
        expect(source).not.toContain("CanvasNodeData");
    });
});
