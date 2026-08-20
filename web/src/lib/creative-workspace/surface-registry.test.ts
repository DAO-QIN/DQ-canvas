import { describe, expect, it } from "vitest";

import { createWorkspaceSurfaceRegistry, getWorkspaceSurface, getWorkspaceSurfaceCommand, listWorkspaceSurfaceCommands, registerWorkspaceSurface, unregisterWorkspaceSurface, workspaceRegistrySurfaceSupports } from "./surface-registry";
import { defineWorkspaceSurfaceCapabilities, type WorkspaceSurfaceDescriptor } from "./surface-contract";

const sampleSurface: WorkspaceSurfaceDescriptor = {
    id: "sample",
    label: "Sample surface",
    capabilities: defineWorkspaceSurfaceCapabilities("history.undo", "selection.read"),
    commands: [
        { id: "history.undo", label: "Undo", group: "history", effect: "document", requiredCapabilities: ["history.undo"] },
        { id: "selection.inspect", label: "Inspect", group: "selection", effect: "read", requiredCapabilities: ["selection.read"] },
        { id: "selection.resize", label: "Resize", group: "selection", effect: "document", requiredCapabilities: ["selection.resize"] },
    ],
};

describe("workspace surface registry", () => {
    it("registers immutable snapshots and looks them up by opaque id", () => {
        const empty = createWorkspaceSurfaceRegistry();
        const registry = registerWorkspaceSurface(empty, sampleSurface);

        expect(empty.surfaces).toEqual([]);
        expect(getWorkspaceSurface(registry, "sample")?.label).toBe("Sample surface");
        expect(Object.isFrozen(registry)).toBe(true);
        expect(Object.isFrozen(registry.surfaces)).toBe(true);
        expect(workspaceRegistrySurfaceSupports(registry, "sample", ["history.undo"])).toBe(true);
        expect(workspaceRegistrySurfaceSupports(registry, "missing", [])).toBe(false);
    });

    it("capability-gates unsupported commands instead of exposing fake actions", () => {
        const registry = createWorkspaceSurfaceRegistry([sampleSurface]);

        expect(listWorkspaceSurfaceCommands(registry, "sample").map((command) => command.id)).toEqual(["history.undo", "selection.inspect"]);
        expect(getWorkspaceSurfaceCommand(registry, "sample", "history.undo")?.effect).toBe("document");
        expect(getWorkspaceSurfaceCommand(registry, "sample", "selection.resize")).toBeUndefined();
        expect(listWorkspaceSurfaceCommands(registry, "missing")).toEqual([]);
    });

    it("rejects duplicate surfaces and unregisters without mutating previous snapshots", () => {
        const registry = createWorkspaceSurfaceRegistry([sampleSurface]);

        expect(() => registerWorkspaceSurface(registry, sampleSurface)).toThrow("already registered: sample");
        const removed = unregisterWorkspaceSurface(registry, "sample");
        expect(removed.surfaces).toEqual([]);
        expect(registry.surfaces).toHaveLength(1);
        expect(unregisterWorkspaceSurface(removed, "missing")).toBe(removed);
    });
});
