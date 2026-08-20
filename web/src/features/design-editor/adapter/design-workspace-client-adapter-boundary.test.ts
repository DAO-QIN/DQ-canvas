import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Design workspace client adapter boundary", () => {
    it("keeps Design types and Store/Fabric imports inside the feature adapter", () => {
        const adapter = readFileSync(new URL("./design-workspace-client-adapter.ts", import.meta.url), "utf8");
        const sharedContract = readFileSync(new URL("../../../lib/creative-workspace/surface-contract.ts", import.meta.url), "utf8");
        const sharedRegistry = readFileSync(new URL("../../../lib/creative-workspace/surface-registry.ts", import.meta.url), "utf8");

        expect(adapter).toContain('from "../store/design-editor-store"');
        expect(adapter).toContain('from "../fabric/design-fabric-adapter"');
        expect(sharedContract).not.toMatch(/Design(?:Document|Operation|Editor|Fabric|Project)/);
        expect(sharedRegistry).not.toMatch(/Design(?:Document|Operation|Editor|Fabric|Project)/);
    });

    it("is declarative, isolated from Workbench wiring and does not execute Store or Fabric commands", () => {
        const adapter = readFileSync(new URL("./design-workspace-client-adapter.ts", import.meta.url), "utf8");
        const workbench = readFileSync(new URL("../components/design-editor-workbench.tsx", import.meta.url), "utf8");

        expect(adapter).not.toMatch(/\.getState\(\)\.(?:undo|redo|flush|dispatch|select)\(/);
        expect(adapter).not.toMatch(/\.fitViewport\(|\.workspaceCenter\(/);
        expect(adapter).not.toMatch(/DesignOperation/);
        expect(workbench).not.toContain("design-workspace-client-adapter");
    });

    it("contains no export placeholder command or capability", () => {
        const adapter = readFileSync(new URL("./design-workspace-client-adapter.ts", import.meta.url), "utf8");

        expect(adapter).not.toMatch(/command\("[^"]*export/i);
        expect(adapter).not.toMatch(/extension:[^"\s]*export/i);
    });
});
