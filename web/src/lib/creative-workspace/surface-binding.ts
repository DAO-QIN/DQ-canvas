export const RESULT_SUBMISSION_SURFACES = ["canvas", "design"] as const;
export type ResultSubmissionSurface = (typeof RESULT_SUBMISSION_SURFACES)[number];

export type CanvasSurfaceBinding = Readonly<{
    surface: "canvas";
    projectId: string;
    targetNodeId: string;
    sourceNodeId?: string;
}>;

export type DesignSurfaceTarget = Readonly<{ scope: "workspace" } | { scope: "frame"; frameId: string }>;

export type DesignSurfaceBinding = Readonly<{
    surface: "design";
    projectId: string;
    target: DesignSurfaceTarget;
    baseRevision?: number;
    elementId?: string;
    assetVersionId?: string;
}>;

export type SurfaceBinding = CanvasSurfaceBinding | DesignSurfaceBinding;

export class SurfaceBindingValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SurfaceBindingValidationError";
    }
}

const MAX_ID_LENGTH = 160;

export function parseSurfaceBinding(value: object): SurfaceBinding {
    const input = record(value);
    if (input.surface === "canvas") {
        exactKeys(input, ["surface", "projectId", "targetNodeId", "sourceNodeId"]);
        return Object.freeze({
            surface: "canvas",
            projectId: requiredId(input.projectId, "projectId"),
            targetNodeId: requiredId(input.targetNodeId, "targetNodeId"),
            ...optionalIdProperty(input.sourceNodeId, "sourceNodeId"),
        });
    }
    if (input.surface === "design") {
        exactKeys(input, ["surface", "projectId", "target", "baseRevision", "elementId", "assetVersionId"]);
        return Object.freeze({
            surface: "design",
            projectId: requiredId(input.projectId, "projectId"),
            target: designTarget(input.target),
            ...optionalRevisionProperty(input.baseRevision),
            ...optionalIdProperty(input.elementId, "elementId"),
            ...optionalIdProperty(input.assetVersionId, "assetVersionId"),
        });
    }
    throw new SurfaceBindingValidationError("surface 必须是 canvas 或 design");
}

export function surfaceBindingKey(binding: SurfaceBinding) {
    return binding.surface === "canvas"
        ? [binding.surface, binding.projectId, binding.targetNodeId, binding.sourceNodeId || ""].map(keyPart).join(":")
        : [
              binding.surface,
              binding.projectId,
              binding.target.scope,
              binding.target.scope === "frame" ? binding.target.frameId : "",
              binding.baseRevision === undefined ? "" : String(binding.baseRevision),
              binding.elementId || "",
              binding.assetVersionId || "",
          ]
              .map(keyPart)
              .join(":");
}

function designTarget(value: unknown): DesignSurfaceTarget {
    const input = record(value, "target");
    if (input.scope === "workspace") {
        exactKeys(input, ["scope"], "target");
        return Object.freeze({ scope: "workspace" });
    }
    if (input.scope === "frame") {
        exactKeys(input, ["scope", "frameId"], "target");
        return Object.freeze({ scope: "frame", frameId: requiredId(input.frameId, "target.frameId") });
    }
    throw new SurfaceBindingValidationError("target.scope 必须是 workspace 或 frame");
}

function record(value: unknown, label = "binding"): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new SurfaceBindingValidationError(`${label} 必须是对象`);
    return value as Record<string, unknown>;
}

function exactKeys(input: Record<string, unknown>, allowed: readonly string[], label = "binding") {
    const allowedSet = new Set(allowed);
    const extra = Object.keys(input).find((key) => !allowedSet.has(key));
    if (extra) throw new SurfaceBindingValidationError(`${label} 包含未知字段 ${extra}`);
}

function requiredId(value: unknown, field: string) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > MAX_ID_LENGTH) throw new SurfaceBindingValidationError(`${field} 无效`);
    return value.trim();
}

function optionalIdProperty(value: unknown, field: "sourceNodeId" | "elementId" | "assetVersionId") {
    if (value === undefined) return {};
    return { [field]: requiredId(value, field) };
}

function optionalRevisionProperty(value: unknown) {
    if (value === undefined) return {};
    if (!Number.isSafeInteger(value) || Number(value) < 0) throw new SurfaceBindingValidationError("baseRevision 无效");
    return { baseRevision: Number(value) };
}

function keyPart(value: string) {
    return `${value.length}:${value}`;
}
