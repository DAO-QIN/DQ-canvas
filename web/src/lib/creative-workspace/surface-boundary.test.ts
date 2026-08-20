import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const SHARED_CONTRACT_FILES = ["./surface-contract.ts", "./surface-registry.ts", "./surface-binding.ts", "./result-submission.ts", "./agent-contract.ts", "./index.ts"] as const;

describe("creative workspace surface boundary", () => {
    it.each(SHARED_CONTRACT_FILES)("keeps %s free of Canvas and Design domain dependencies", (path) => {
        const source = readFileSync(new URL(path, import.meta.url), "utf8");

        expect(source).not.toMatch(/from\s+["'][^"']*(?:canvas|design)[^"']*["']/i);
        expect(source).not.toMatch(/\b(?:CanvasNodeData|CanvasAgentOp|CanvasStore|DesignDocument|DesignOperation|DesignEditorStore)\b/);
        expect(source).not.toMatch(/@\/features\//);
    });

    it("keeps command descriptors declarative and handler-free", () => {
        const source = readFileSync(new URL("./surface-contract.ts", import.meta.url), "utf8");

        expect(source).toContain("export type WorkspaceCommandDescriptor");
        expect(source).not.toMatch(/\b(?:execute|handler|dispatch|invoke):/);
        expect(source).not.toMatch(/:\s*(?:unknown|any)\b|<\s*(?:unknown|any)\s*>/);
    });
});
