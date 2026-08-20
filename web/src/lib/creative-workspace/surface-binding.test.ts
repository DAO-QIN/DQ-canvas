import { describe, expect, it } from "vitest";

import { parseSurfaceBinding, SurfaceBindingValidationError, surfaceBindingKey } from "./surface-binding";

describe("SurfaceBinding", () => {
    it("normalizes and freezes a Canvas result target", () => {
        const binding = parseSurfaceBinding({ surface: "canvas", projectId: " project ", sourceNodeId: " source ", targetNodeId: " target " });

        expect(binding).toEqual({ surface: "canvas", projectId: "project", sourceNodeId: "source", targetNodeId: "target" });
        expect(Object.isFrozen(binding)).toBe(true);
    });

    it("expresses workspace placement without a fabricated Frame id", () => {
        const binding = parseSurfaceBinding({ surface: "design", projectId: "project", target: { scope: "workspace" } });

        expect(binding).toEqual({ surface: "design", projectId: "project", target: { scope: "workspace" } });
        expect(binding.surface === "design" && Object.isFrozen(binding.target)).toBe(true);
    });

    it("keeps explicit Frame placement independent from Canvas node semantics", () => {
        expect(parseSurfaceBinding({ surface: "design", projectId: "project", target: { scope: "frame", frameId: " frame " }, baseRevision: 7, elementId: "element", assetVersionId: "version" })).toEqual({
            surface: "design",
            projectId: "project",
            target: { scope: "frame", frameId: "frame" },
            baseRevision: 7,
            elementId: "element",
            assetVersionId: "version",
        });
    });

    it.each([
        [{ surface: "canvas", projectId: "project" }, "targetNodeId 无效"],
        [{ surface: "design", projectId: "project" }, "target 必须是对象"],
        [{ surface: "design", projectId: "project", frameId: "frame", target: { scope: "workspace" } }, "binding 包含未知字段 frameId"],
        [{ surface: "design", projectId: "project", target: { scope: "workspace", frameId: "fake" } }, "target 包含未知字段 frameId"],
        [{ surface: "design", projectId: "project", target: { scope: "frame" } }, "target.frameId 无效"],
        [{ surface: "design", projectId: "project", target: { scope: "workspace" }, baseRevision: -1 }, "baseRevision 无效"],
        [{ surface: "design", projectId: "project", target: { scope: "unknown" } }, "target.scope 必须是 workspace 或 frame"],
        [{ surface: "design", projectId: "project", target: { scope: "frame", frameId: "frame" }, targetNodeId: "node" }, "binding 包含未知字段 targetNodeId"],
        [{ surface: "unknown", projectId: "project" }, "surface 必须是 canvas 或 design"],
    ])("rejects invalid or cross-domain bindings", (value, message) => {
        expect(() => parseSurfaceBinding(value)).toThrowError(new SurfaceBindingValidationError(message));
    });

    it("uses length-prefixed parts so distinct targets cannot collide", () => {
        const first = parseSurfaceBinding({ surface: "canvas", projectId: "a:b", targetNodeId: "c" });
        const second = parseSurfaceBinding({ surface: "canvas", projectId: "a", targetNodeId: "b:c" });

        expect(surfaceBindingKey(first)).not.toBe(surfaceBindingKey(second));
        expect(surfaceBindingKey(first)).toBe(surfaceBindingKey(parseSurfaceBinding({ ...first })));
        expect(surfaceBindingKey(parseSurfaceBinding({ surface: "design", projectId: "project", target: { scope: "workspace" } }))).not.toBe(
            surfaceBindingKey(parseSurfaceBinding({ surface: "design", projectId: "project", target: { scope: "frame", frameId: "workspace" } })),
        );
        expect(surfaceBindingKey(parseSurfaceBinding({ surface: "design", projectId: "project", target: { scope: "workspace" }, elementId: "element", assetVersionId: "v1" }))).not.toBe(
            surfaceBindingKey(parseSurfaceBinding({ surface: "design", projectId: "project", target: { scope: "workspace" }, elementId: "element", assetVersionId: "v2" })),
        );
    });
});
