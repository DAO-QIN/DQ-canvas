import { describe, expect, it } from "vitest";

import { createDesignDocumentFixture } from "@/lib/design/design.test-fixture";

import { createDesignWorkspaceClientAdapter, DESIGN_WORKSPACE_EXTENSION_CAPABILITIES, designSaveCanFlush, type DesignWorkspaceCommandId } from "./design-workspace-client-adapter";
import type { DesignEditorState } from "../store/design-editor-store";

describe("Design workspace client adapter", () => {
    it("maps only capabilities implemented by the current Store and Fabric controller", () => {
        const adapter = createDesignWorkspaceClientAdapter({ state: state(), fabric: fabricController() });

        expect(adapter.descriptor.id).toBe("design");
        expect(adapter.descriptor.capabilities).toMatchObject({
            "history.undo": true,
            "history.redo": true,
            "viewport.pan": true,
            "viewport.zoom": true,
            "viewport.fit": true,
            "viewport.observe": true,
            "viewport.coordinate-conversion": true,
            "selection.read": true,
            "selection.bounds": true,
            "selection.observe": true,
            "selection.align": true,
            "selection.distribute": true,
            "selection.delete": true,
            "content.create": true,
            [DESIGN_WORKSPACE_EXTENSION_CAPABILITIES.saveFlush]: true,
            [DESIGN_WORKSPACE_EXTENSION_CAPABILITIES.resizeObserve]: true,
        });
        expect(adapter.descriptor.capabilities).not.toHaveProperty("selection.resize");
        expect(adapter.descriptor.capabilities).not.toHaveProperty("selection.prompt");
    });

    it("omits Fabric-only fit support when no Fabric controller is ready", () => {
        const adapter = createDesignWorkspaceClientAdapter({ state: state(), fabric: null });

        expect(adapter.descriptor.capabilities).not.toHaveProperty("viewport.fit");
        expect(adapter.descriptor.capabilities).not.toHaveProperty("viewport.observe");
        expect(adapter.descriptor.capabilities).not.toHaveProperty("viewport.coordinate-conversion");
        expect(adapter.descriptor.capabilities).not.toHaveProperty("selection.bounds");
        expect(adapter.descriptor.capabilities).not.toHaveProperty("selection.observe");
        expect(adapter.descriptor.capabilities).not.toHaveProperty(DESIGN_WORKSPACE_EXTENSION_CAPABILITIES.resizeObserve);
        expect(adapter.commandAvailability["viewport.fit"]).toEqual({ enabled: false, reason: "fabric-unavailable" });
    });

    it("does not advertise export until a real renderer exists", () => {
        const adapter = createDesignWorkspaceClientAdapter({ state: state(), fabric: fabricController() });
        const ids = adapter.descriptor.commands.map((command) => command.id);
        const capabilities = Object.keys(adapter.descriptor.capabilities);

        expect(ids).not.toContain("surface.export");
        expect(ids.every((id) => !id.includes("export"))).toBe(true);
        expect(capabilities.every((capability) => !capability.includes("export"))).toBe(true);
    });

    it("gates history, selection and save commands from live Store state", () => {
        const adapter = createDesignWorkspaceClientAdapter({
            state: state({
                selection: { kind: "elements", ids: ["element-product", "element-title"] },
                canUndo: true,
                canRedo: false,
                status: "dirty",
                pendingCount: 2,
            }),
            fabric: fabricController(),
        });

        expect(availability(adapter, "history.undo")).toEqual({ enabled: true });
        expect(availability(adapter, "history.redo")).toEqual({ enabled: false, reason: "nothing-to-redo" });
        expect(availability(adapter, "selection.delete")).toEqual({ enabled: true });
        expect(availability(adapter, "selection.align")).toEqual({ enabled: true });
        expect(availability(adapter, "selection.distribute")).toEqual({ enabled: false, reason: "insufficient-selection" });
        expect(availability(adapter, "surface.save")).toEqual({ enabled: true });
    });

    it("blocks writes during error/conflict and locked selection states", () => {
        const document = createDesignDocumentFixture();
        const title = document.elements.find((element) => element.id === "element-title")!;
        title.locked = true;
        const locked = createDesignWorkspaceClientAdapter({ state: state({ project: project(document), selection: { kind: "elements", ids: [title.id] } }), fabric: fabricController() });
        expect(availability(locked, "selection.delete")).toEqual({ enabled: false, reason: "locked-selection" });
        expect(availability(locked, "selection.align")).toEqual({ enabled: false, reason: "locked-selection" });
        expect(availability(locked, "selection.distribute")).toEqual({ enabled: false, reason: "locked-selection" });

        const conflict = createDesignWorkspaceClientAdapter({ state: state({ status: "conflict", pendingCount: 1, canUndo: true }), fabric: fabricController() });
        expect(availability(conflict, "history.undo")).toEqual({ enabled: false, reason: "save-blocked" });
        expect(availability(conflict, "content.create-frame")).toEqual({ enabled: false, reason: "save-blocked" });
        expect(availability(conflict, "surface.save")).toEqual({ enabled: false, reason: "save-blocked" });
    });

    it("requires an empty unlocked frame for deletion", () => {
        const populatedFrame = createDesignWorkspaceClientAdapter({ state: state({ selection: { kind: "frame", id: "frame-main" } }), fabric: fabricController() });
        expect(availability(populatedFrame, "selection.delete")).toEqual({ enabled: false, reason: "non-empty-frame" });

        const document = createDesignDocumentFixture();
        document.elements = document.elements.filter((element) => element.frameId !== "frame-social");
        const socialLayer = document.layers.find((layer) => layer.scope === "frame" && layer.frameId === "frame-social");
        if (socialLayer?.scope === "frame") socialLayer.elementIds = [];
        const emptyFrame = createDesignWorkspaceClientAdapter({ state: state({ project: project(document), selection: { kind: "frame", id: "frame-social" } }), fabric: fabricController() });
        expect(availability(emptyFrame, "selection.delete")).toEqual({ enabled: true });
    });

    it("fails closed before a project is loaded", () => {
        const adapter = createDesignWorkspaceClientAdapter({ state: state({ project: null, status: "loading" }), fabric: null });

        expect(adapter.descriptor.capabilities).toEqual({});
        expect(Object.values(adapter.commandAvailability).every((availability) => !availability.enabled)).toBe(true);
        expect(Object.values(adapter.commandAvailability).every((availability) => availability.reason === "loading")).toBe(true);
    });

    it.each([
        ["saved", 0, false],
        ["saved", 1, true],
        ["dirty", 1, true],
        ["saving", 1, true],
        ["error", 1, false],
        ["conflict", 1, false],
        ["loading", 1, false],
        ["not-found", 1, false],
    ] as const)("maps save status %s with %i pending batches to %s", (status, pendingCount, expected) => {
        expect(designSaveCanFlush(status, pendingCount)).toBe(expected);
    });
});

function availability(adapter: ReturnType<typeof createDesignWorkspaceClientAdapter>, commandId: DesignWorkspaceCommandId) {
    return adapter.commandAvailability[commandId];
}

function state(overrides: Partial<Pick<DesignEditorState, "project" | "status" | "pendingCount" | "selection" | "canUndo" | "canRedo">> = {}) {
    const document = createDesignDocumentFixture();
    return {
        project: project(document),
        status: "saved" as const,
        pendingCount: 0,
        selection: null,
        canUndo: false,
        canRedo: false,
        ...overrides,
    };
}

function project(document = createDesignDocumentFixture()) {
    return {
        id: document.id,
        title: document.metadata.title,
        status: "active" as const,
        revision: document.revision,
        document,
        createdAt: document.metadata.createdAt,
        updatedAt: document.metadata.updatedAt,
    };
}

function fabricController() {
    return {
        fitViewport: () => ({ x: 0, y: 0, zoom: 1 }),
        workspaceCenter: () => ({ x: 0, y: 0 }),
        getSelectionBounds: () => null,
        sceneToScreen: (point: { x: number; y: number }) => point,
        screenToScene: (point: { x: number; y: number }) => point,
        subscribeSelection: () => () => undefined,
        subscribeViewport: () => () => undefined,
        subscribeResize: () => () => undefined,
    };
}
