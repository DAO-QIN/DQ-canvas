export const CREATIVE_WORKSPACE_SURFACES = ["canvas", "design"] as const;

export type CreativeWorkspaceSurface = (typeof CREATIVE_WORKSPACE_SURFACES)[number];

export type CreativeWorkspaceFeatureFlags = Readonly<Record<CreativeWorkspaceSurface, boolean>>;

export type CreativeWorkspaceFeatureFlagInput = Readonly<Partial<Record<CreativeWorkspaceSurface, string | null | undefined>>>;

export const DEFAULT_CREATIVE_WORKSPACE_FEATURE_FLAGS: CreativeWorkspaceFeatureFlags = Object.freeze({
    canvas: false,
    design: false,
});

/**
 * Resolves rollout flags with an explicit opt-in policy. Only the exact value
 * "1" enables a surface; missing and malformed values keep the legacy shell.
 */
export function resolveCreativeWorkspaceFeatureFlags(input: CreativeWorkspaceFeatureFlagInput = {}): CreativeWorkspaceFeatureFlags {
    return Object.freeze({
        canvas: input.canvas === "1",
        design: input.design === "1",
    });
}

/**
 * Uses public build-time variables so server rendering and client hydration
 * resolve the same shell without exposing server-only configuration.
 */
export function getCreativeWorkspaceFeatureFlags(): CreativeWorkspaceFeatureFlags {
    return resolveCreativeWorkspaceFeatureFlags({
        canvas: process.env.NEXT_PUBLIC_DQ_CREATIVE_WORKSPACE_CANVAS_ENABLED,
        design: process.env.NEXT_PUBLIC_DQ_CREATIVE_WORKSPACE_DESIGN_ENABLED,
    });
}

export function isCreativeWorkspaceEnabled(surface: CreativeWorkspaceSurface, flags = getCreativeWorkspaceFeatureFlags()): boolean {
    if (!CREATIVE_WORKSPACE_SURFACES.includes(surface)) return false;
    return flags[surface] === true;
}
