import { describe, expect, it } from "vitest";

import { defineWorkspaceSurface, defineWorkspaceSurfaceCapabilities, workspaceCommandIsSupported, workspaceSurfaceSupports, type WorkspaceCommandDescriptor } from "./surface-contract";

describe("workspace surface contract", () => {
    it("defines immutable, deduplicated capabilities", () => {
        const capabilities = defineWorkspaceSurfaceCapabilities("history.undo", "viewport.zoom", "history.undo", "extension:smart-layout");

        expect(capabilities).toEqual({ "history.undo": true, "viewport.zoom": true, "extension:smart-layout": true });
        expect(Object.isFrozen(capabilities)).toBe(true);
        expect(workspaceSurfaceSupports(capabilities, ["history.undo", "viewport.zoom"])).toBe(true);
        expect(workspaceSurfaceSupports(capabilities, ["selection.resize"])).toBe(false);
    });

    it("fails closed when a command requires a missing capability", () => {
        const capabilities = defineWorkspaceSurfaceCapabilities("selection.read");
        const readCommand: WorkspaceCommandDescriptor = {
            id: "selection.inspect",
            label: "Inspect selection",
            group: "selection",
            effect: "read",
            requiredCapabilities: ["selection.read"],
        };
        const resizeCommand: WorkspaceCommandDescriptor = {
            ...readCommand,
            id: "selection.resize",
            label: "Resize selection",
            effect: "document",
            requiredCapabilities: ["selection.read", "selection.resize"],
        };

        expect(workspaceCommandIsSupported(capabilities, readCommand)).toBe(true);
        expect(workspaceCommandIsSupported(capabilities, resizeCommand)).toBe(false);
    });

    it("takes a frozen snapshot and rejects duplicate command ids", () => {
        const mutableCommands: WorkspaceCommandDescriptor[] = [{ id: "history.undo", label: "Undo", group: "history", effect: "document", requiredCapabilities: ["history.undo"] }];
        const surface = defineWorkspaceSurface({ id: "sample", label: "Sample", capabilities: { "history.undo": true }, commands: mutableCommands });
        mutableCommands.push({ id: "history.redo", label: "Redo", group: "history", effect: "document" });

        expect(surface.commands).toHaveLength(1);
        expect(Object.isFrozen(surface)).toBe(true);
        expect(Object.isFrozen(surface.commands)).toBe(true);
        expect(Object.isFrozen(surface.commands[0].requiredCapabilities)).toBe(true);
        expect(() =>
            defineWorkspaceSurface({
                id: "duplicate",
                label: "Duplicate",
                capabilities: {},
                commands: [
                    { id: "same", label: "First", group: "surface", effect: "read" },
                    { id: "same", label: "Second", group: "surface", effect: "read" },
                ],
            }),
        ).toThrow("duplicate command id: same");
    });
});
