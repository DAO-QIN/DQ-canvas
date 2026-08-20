import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./canvas-node-prompt-panel.tsx", import.meta.url), "utf8");

describe("CanvasNodePromptPanel composition", () => {
    it("uses the compact composer structure without an inline media replacement action", () => {
        expect(source).toContain("<GenerationModeIcon");
        expect(source).toContain("<CanvasPromptLibrary");
        expect(source).toContain("<ReferenceThumbnail");
        expect(source).toContain("h-[42px]");
        expect(source).toContain("composerHeight");
        expect(source).not.toContain("onReplaceMedia");
        expect(source).not.toContain("canReplaceMedia");
        expect(source).not.toContain("<Upload");
    });

    it("adapts the same Canvas generation semantics into the shared workspace composer", () => {
        expect(source).toContain('variant?: "node" | "workspace"');
        expect(source).toContain("<WorkspaceGenerationComposer");
        expect(source).toContain("capability={mode}");
        expect(source).toContain("onGenerate(node.id, mode, text)");
        expect(source).toContain("onStop={() => onStop(node.id)}");
        expect(source).toContain("<CanvasResourceMentionTextarea");
        expect(source).toContain("<CanvasPromptLibrary");
        expect(source).toContain("requestCreditCost");
        expect(source).toContain("onAddReferenceFiles(node.id, files)");
    });
});
