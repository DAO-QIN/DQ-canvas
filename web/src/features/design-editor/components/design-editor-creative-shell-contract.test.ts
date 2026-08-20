import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Design creative workspace adapter boundary", () => {
    it("does not own Fabric, stores, persistence, routing or API calls", () => {
        const source = readFileSync(new URL("./design-editor-creative-shell.tsx", import.meta.url), "utf8");

        expect(source).not.toContain("DesignFabricSurface");
        expect(source).not.toContain("useStore(");
        expect(source).not.toContain("createDesignEditorStore");
        expect(source).not.toContain("useRouter(");
        expect(source).not.toMatch(/@\/services\/api/);
        expect(source).not.toMatch(/\.flush\s*\(/);
    });

    it("keeps responsive overlay geometry and shape menu in the Design adapter", () => {
        const source = readFileSync(new URL("./design-editor-creative-shell.tsx", import.meta.url), "utf8");
        const css = readFileSync(new URL("./design-editor-creative-shell.module.css", import.meta.url), "utf8");

        expect(source).toContain("styles.handoffAction");
        expect(css).toContain("width: 176px");
        expect(css).toContain("border-radius: 14px");
        expect(css).toContain("pointer-events: auto");
        expect(css).toContain("@media (max-width: 860px)");
        expect(css).toContain("@media (max-width: 520px)");
        expect(css).toContain(".selectionToolbarDisplaced");
        expect(css).toContain(".saveAlert");
        expect(css).toMatch(/@media \(max-width: 680px\)[\s\S]*\.topActions\s*>\s*:not\(\.handoffAction\):not\(\.exportAction\):not\(\.railToggle\)/s);
        expect(css).toMatch(/@media \(max-width: 520px\)[\s\S]*\.shapeMenuWrap \.chromeButton\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px/s);
    });
});
