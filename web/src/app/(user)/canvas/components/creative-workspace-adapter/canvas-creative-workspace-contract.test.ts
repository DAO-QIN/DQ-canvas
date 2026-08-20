import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adapterFiles = ["./canvas-creative-workspace-chrome.tsx", "./canvas-selection-size-overlay.tsx", "./canvas-surface-client-adapter.ts", "./canvas-workspace-theme.ts", "./index.ts"] as const;

describe("Canvas creative workspace adapter boundary", () => {
    it("does not import Canvas node, connection, Agent operation, persistence or generation models", () => {
        for (const file of adapterFiles.filter((file) => !["./canvas-selection-size-overlay.tsx", "./canvas-surface-client-adapter.ts"].includes(file))) {
            const source = readFileSync(new URL(file, import.meta.url), "utf8");
            expect(source, file).not.toMatch(/CanvasNodeData|CanvasConnection|CanvasAgentOp|CanvasAgentSnapshot|CanvasProject|CanvasGeneration/);
            expect(source, file).not.toMatch(/useCanvasStore|useCanvasPageController|canvas-agent-ops|canvas-generation/);
            expect(source, file).not.toMatch(/\.\.\/\.\.\/(?:stores|utils)\//);
        }
    });

    it("uses the shared size bar without enabling or rendering the shared Prompt overlay", () => {
        const overlay = readFileSync(new URL("./canvas-selection-size-overlay.tsx", import.meta.url), "utf8");
        const clientAdapter = readFileSync(new URL("./canvas-surface-client-adapter.ts", import.meta.url), "utf8");

        expect(overlay).toContain("WorkspaceSelectionSizeBar");
        expect(overlay).not.toContain("WorkspaceSelectionPrompt");
        expect(clientAdapter).not.toMatch(/selection\.prompt/);
    });

    it("keeps Canvas domain models on the feature side of the surface contract", () => {
        const clientAdapter = readFileSync(new URL("./canvas-surface-client-adapter.ts", import.meta.url), "utf8");
        const sharedFiles = ["index.ts", "surface-contract.ts", "surface-registry.ts"].map((file) => readFileSync(new URL(`../../../../../lib/creative-workspace/${file}`, import.meta.url), "utf8"));

        expect(clientAdapter).toContain('from "../../types"');
        expect(clientAdapter).toContain("CanvasNodeData");
        expect(clientAdapter).not.toMatch(/@\/lib\/creative-workspace\/(?:canvas|design)/);
        for (const sharedSource of sharedFiles) {
            expect(sharedSource).not.toMatch(/CanvasNodeData|CanvasSurfaceCommand|CanvasSurfaceClient/);
            expect(sharedSource).not.toMatch(/app\/\(user\)\/canvas|features\/design-editor/);
        }
    });

    it("keeps all feature state in Canvas and never pushes Canvas types into the shared package", () => {
        const sharedIndex = readFileSync(new URL("../../../../../components/creative-workspace/index.ts", import.meta.url), "utf8");
        const adapter = readFileSync(new URL("./canvas-creative-workspace-chrome.tsx", import.meta.url), "utf8");

        expect(sharedIndex).not.toMatch(/Canvas(?:Node|Connection|Agent|Project|Media)/);
        expect(adapter).toContain('from "@/components/creative-workspace"');
        expect(adapter).toContain("surface: ReactNode");
        expect(adapter).toContain("overlays?: ReactNode");
        expect(adapter).toContain("generationComposer?: ReactNode");
        expect(adapter).toContain("assistantPanel?: ReactNode");
    });

    it("defines the shared mobile rail as the only responsive Agent container", () => {
        const adapterCss = readFileSync(new URL("./canvas-creative-workspace-chrome.module.css", import.meta.url), "utf8");
        const sharedCss = readFileSync(new URL("../../../../../components/creative-workspace/creative-workspace.module.css", import.meta.url), "utf8");

        expect(sharedCss).toContain("@media (max-width: 860px)");
        expect(sharedCss).toContain("height: min(680px, calc(100dvh - 74px))");
        expect(adapterCss).toMatch(/\.railContent\s*>\s*\*\s*\{[\s\S]*width:\s*100%\s*!important;[\s\S]*height:\s*100%\s*!important;/);
        expect(adapterCss).toMatch(/\.railContent\s*>\s*\*\s*\{[\s\S]*border:\s*0\s*!important;[\s\S]*box-shadow:\s*none\s*!important;/);
    });
});
