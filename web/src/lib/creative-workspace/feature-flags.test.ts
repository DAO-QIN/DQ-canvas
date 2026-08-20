import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CREATIVE_WORKSPACE_FEATURE_FLAGS, getCreativeWorkspaceFeatureFlags, isCreativeWorkspaceEnabled, resolveCreativeWorkspaceFeatureFlags, type CreativeWorkspaceSurface } from "./feature-flags";

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("creative workspace surface feature flags", () => {
    it("keeps both surfaces on the legacy shell by default", () => {
        expect(DEFAULT_CREATIVE_WORKSPACE_FEATURE_FLAGS).toEqual({ canvas: false, design: false });
        expect(Object.isFrozen(DEFAULT_CREATIVE_WORKSPACE_FEATURE_FLAGS)).toBe(true);
        expect(resolveCreativeWorkspaceFeatureFlags()).toEqual(DEFAULT_CREATIVE_WORKSPACE_FEATURE_FLAGS);
    });

    it("enables canvas and design independently", () => {
        expect(resolveCreativeWorkspaceFeatureFlags({ canvas: "1" })).toEqual({ canvas: true, design: false });
        expect(resolveCreativeWorkspaceFeatureFlags({ design: "1" })).toEqual({ canvas: false, design: true });
        expect(resolveCreativeWorkspaceFeatureFlags({ canvas: "1", design: "1" })).toEqual({ canvas: true, design: true });
    });

    it.each(["", "0", "true", "yes", "on", "01", " 1 "])("fails closed for a non-canonical value of %j", (value) => {
        expect(resolveCreativeWorkspaceFeatureFlags({ canvas: value, design: value })).toEqual({ canvas: false, design: false });
    });

    it("reads only the two public per-surface environment variables", () => {
        vi.stubEnv("NEXT_PUBLIC_DQ_CREATIVE_WORKSPACE_CANVAS_ENABLED", "1");
        vi.stubEnv("NEXT_PUBLIC_DQ_CREATIVE_WORKSPACE_DESIGN_ENABLED", "0");

        expect(getCreativeWorkspaceFeatureFlags()).toEqual({ canvas: true, design: false });
    });

    it("fails closed for an unexpected runtime surface", () => {
        const unexpectedSurface = "unknown" as CreativeWorkspaceSurface;

        expect(isCreativeWorkspaceEnabled(unexpectedSurface, { canvas: true, design: true })).toBe(false);
    });

    it("stays isomorphic and independent from either editor domain", () => {
        const source = readFileSync(new URL("./feature-flags.ts", import.meta.url), "utf8");
        const environmentReads = [...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((match) => match[1]);

        expect(environmentReads).toEqual(["NEXT_PUBLIC_DQ_CREATIVE_WORKSPACE_CANVAS_ENABLED", "NEXT_PUBLIC_DQ_CREATIVE_WORKSPACE_DESIGN_ENABLED"]);
        expect(source).not.toMatch(/from\s+["'][^"']+["']/);
        expect(source).not.toMatch(/\b(?:CanvasNodeData|CanvasAgentOp|DesignDocument|DesignOperation)\b/);
    });
});
