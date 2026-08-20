import { defineWorkspaceSurface, defineWorkspaceSurfaceCapabilities, workspaceCommandIsSupported, type WorkspaceCommandDescriptor, type WorkspaceSurfaceCapabilityId, type WorkspaceSurfaceDescriptor } from "@/lib/creative-workspace";

import type { DesignFabricAdapter } from "../fabric/design-fabric-adapter";
import { selectedDesignElements } from "../model/design-editor-commands";
import type { DesignEditorSaveStatus, DesignEditorState, DesignEditorStore } from "../store/design-editor-store";

export const DESIGN_WORKSPACE_SURFACE_ID = "design" as const;

export const DESIGN_WORKSPACE_EXTENSION_CAPABILITIES = {
    saveFlush: "extension:design.save.flush",
    resizeObserve: "extension:design.surface.resize-observe",
} as const satisfies Readonly<Record<string, WorkspaceSurfaceCapabilityId>>;

export const DESIGN_WORKSPACE_COMMAND_IDS = [
    "history.undo",
    "history.redo",
    "viewport.zoom-in",
    "viewport.zoom-out",
    "viewport.fit",
    "selection.clear",
    "selection.delete",
    "selection.align",
    "selection.distribute",
    "content.create-frame",
    "content.create-text",
    "surface.save",
] as const;

export type DesignWorkspaceCommandId = (typeof DESIGN_WORKSPACE_COMMAND_IDS)[number];

export type DesignWorkspaceCommandAvailability = Readonly<{
    enabled: boolean;
    reason?: "loading" | "save-blocked" | "nothing-to-undo" | "nothing-to-redo" | "no-selection" | "locked-selection" | "insufficient-selection" | "non-empty-frame" | "no-pending-save" | "fabric-unavailable" | "capability-unavailable";
}>;

export type DesignWorkspaceClientAdapter = Readonly<{
    descriptor: WorkspaceSurfaceDescriptor<typeof DESIGN_WORKSPACE_SURFACE_ID, DesignWorkspaceCommandId>;
    commandAvailability: Readonly<Record<DesignWorkspaceCommandId, DesignWorkspaceCommandAvailability>>;
}>;

type DesignWorkspaceAdapterInput = Readonly<{
    state: Pick<DesignEditorState, "project" | "status" | "pendingCount" | "selection" | "canUndo" | "canRedo">;
    fabric: Pick<DesignFabricAdapter, "fitViewport" | "workspaceCenter" | "getSelectionBounds" | "sceneToScreen" | "screenToScene" | "subscribeSelection" | "subscribeViewport" | "subscribeResize"> | null;
}>;

/**
 * Maps the current Design Store/Fabric surface to the shared declarative
 * contract. It deliberately exposes no Design command handler or operation
 * payload; execution stays in the feature controller and Store.
 */
export function createDesignWorkspaceClientAdapter(input: DesignWorkspaceAdapterInput): DesignWorkspaceClientAdapter {
    const descriptor = createDesignWorkspaceSurfaceDescriptor(input);
    const stateAvailability = designWorkspaceCommandAvailability(input);
    const commandAvailability = Object.fromEntries(
        descriptor.commands.map((command) => {
            const supported = workspaceCommandIsSupported(descriptor.capabilities, command);
            const availability = stateAvailability[command.id];
            return [command.id, supported || !availability.enabled ? availability : { enabled: false, reason: "capability-unavailable" as const }];
        }),
    ) as Record<DesignWorkspaceCommandId, DesignWorkspaceCommandAvailability>;
    return Object.freeze({ descriptor, commandAvailability: Object.freeze(commandAvailability) });
}

export function createDesignWorkspaceSurfaceDescriptor(input: DesignWorkspaceAdapterInput) {
    const loaded = Boolean(input.state.project) && input.state.status !== "loading" && input.state.status !== "not-found";
    const capabilities = loaded
        ? defineWorkspaceSurfaceCapabilities(
              "history.undo",
              "history.redo",
              "viewport.pan",
              "viewport.zoom",
              ...(input.fabric ? (["viewport.fit", "viewport.observe", "viewport.coordinate-conversion", "selection.bounds", "selection.observe", DESIGN_WORKSPACE_EXTENSION_CAPABILITIES.resizeObserve] as const) : []),
              "selection.read",
              "selection.align",
              "selection.distribute",
              "selection.delete",
              "content.create",
              DESIGN_WORKSPACE_EXTENSION_CAPABILITIES.saveFlush,
          )
        : defineWorkspaceSurfaceCapabilities();

    return defineWorkspaceSurface({
        id: DESIGN_WORKSPACE_SURFACE_ID,
        label: "Design",
        capabilities,
        commands: DESIGN_WORKSPACE_COMMAND_DESCRIPTORS,
    });
}

export function createDesignWorkspaceAdapterFromStore(store: DesignEditorStore, fabric: DesignWorkspaceAdapterInput["fabric"]): DesignWorkspaceClientAdapter {
    return createDesignWorkspaceClientAdapter({ state: store.getState(), fabric });
}

export function designWorkspaceCommandAvailability(input: DesignWorkspaceAdapterInput): Readonly<Record<DesignWorkspaceCommandId, DesignWorkspaceCommandAvailability>> {
    const { state, fabric } = input;
    if (!state.project || state.status === "loading" || state.status === "not-found") return allDesignCommandsUnavailable("loading");
    const editingBlocked = designEditingBlocked(state.status) || !state.project;
    const selection = designSelectionRuntime(state);
    return Object.freeze({
        "history.undo": availability(!editingBlocked && state.canUndo, editingBlocked ? "save-blocked" : "nothing-to-undo"),
        "history.redo": availability(!editingBlocked && state.canRedo, editingBlocked ? "save-blocked" : "nothing-to-redo"),
        "viewport.zoom-in": availability(!editingBlocked, "save-blocked"),
        "viewport.zoom-out": availability(!editingBlocked, "save-blocked"),
        "viewport.fit": availability(!editingBlocked && Boolean(fabric), editingBlocked ? "save-blocked" : "fabric-unavailable"),
        "selection.clear": availability(!editingBlocked && Boolean(state.selection), editingBlocked ? "save-blocked" : "no-selection"),
        "selection.delete": availability(!editingBlocked && selection.exists && !selection.locked && selection.deletable, editingBlocked ? "save-blocked" : selection.reason),
        "selection.align": availability(!editingBlocked && selection.elementCount > 0 && !selection.locked, editingBlocked ? "save-blocked" : selection.reason),
        "selection.distribute": availability(
            !editingBlocked && selection.elementCount >= 3 && !selection.locked,
            editingBlocked ? "save-blocked" : selection.locked ? "locked-selection" : selection.elementCount ? "insufficient-selection" : selection.reason,
        ),
        "content.create-frame": availability(!editingBlocked, "save-blocked"),
        "content.create-text": availability(!editingBlocked, "save-blocked"),
        "surface.save": availability(designSaveCanFlush(state.status, state.pendingCount), state.pendingCount ? "save-blocked" : "no-pending-save"),
    });
}

export function designSaveCanFlush(status: DesignEditorSaveStatus, pendingCount: number) {
    return pendingCount > 0 && status !== "loading" && status !== "not-found" && status !== "error" && status !== "conflict";
}

function designSelectionRuntime(state: DesignWorkspaceAdapterInput["state"]): {
    exists: boolean;
    elementCount: number;
    locked: boolean;
    deletable: boolean;
    reason: DesignWorkspaceCommandAvailability["reason"];
} {
    const document = state.project?.document;
    const selection = state.selection;
    if (!document || !selection) return { exists: false, elementCount: 0, locked: false, deletable: false, reason: "no-selection" };
    if (selection.kind === "elements") {
        const elements = selectedDesignElements(document, selection);
        const locked = elements.length !== selection.ids.length || elements.some((element) => element.locked);
        return { exists: true, elementCount: elements.length, locked, deletable: elements.length === selection.ids.length, reason: locked ? "locked-selection" : "insufficient-selection" };
    }
    const frame = document.frames.find((candidate) => candidate.id === selection.id);
    const locked = !frame || frame.locked;
    const deletable = Boolean(frame && !frame.locked && !document.elements.some((element) => element.frameId === frame.id));
    return { exists: true, elementCount: 0, locked, deletable, reason: locked ? "locked-selection" : deletable ? "insufficient-selection" : "non-empty-frame" };
}

function availability(enabled: boolean, reason: DesignWorkspaceCommandAvailability["reason"]): DesignWorkspaceCommandAvailability {
    return enabled ? ENABLED : Object.freeze({ enabled: false, reason });
}

function designEditingBlocked(status: DesignEditorSaveStatus) {
    return status === "loading" || status === "not-found" || status === "error" || status === "conflict";
}

function allDesignCommandsUnavailable(reason: DesignWorkspaceCommandAvailability["reason"]): Readonly<Record<DesignWorkspaceCommandId, DesignWorkspaceCommandAvailability>> {
    return Object.freeze(Object.fromEntries(DESIGN_WORKSPACE_COMMAND_IDS.map((commandId) => [commandId, Object.freeze({ enabled: false, reason })]))) as Readonly<Record<DesignWorkspaceCommandId, DesignWorkspaceCommandAvailability>>;
}

const ENABLED = Object.freeze({ enabled: true }) as DesignWorkspaceCommandAvailability;

const DESIGN_WORKSPACE_COMMAND_DESCRIPTORS = Object.freeze([
    command("history.undo", "撤销", "history", "document", ["history.undo"], "Mod+Z"),
    command("history.redo", "重做", "history", "document", ["history.redo"], "Mod+Shift+Z"),
    command("viewport.zoom-in", "放大", "viewport", "view", ["viewport.zoom"]),
    command("viewport.zoom-out", "缩小", "viewport", "view", ["viewport.zoom"]),
    command("viewport.fit", "适应内容", "viewport", "view", ["viewport.fit"]),
    command("selection.clear", "取消选择", "selection", "view", ["selection.read"], "Escape"),
    command("selection.delete", "删除选择", "selection", "document", ["selection.delete"], "Delete"),
    command("selection.align", "对齐元素", "selection", "document", ["selection.align"]),
    command("selection.distribute", "分布元素", "selection", "document", ["selection.distribute"]),
    command("content.create-frame", "创建画框", "create", "document", ["content.create"]),
    command("content.create-text", "创建文字", "create", "document", ["content.create"]),
    command("surface.save", "立即保存", "surface", "document", [DESIGN_WORKSPACE_EXTENSION_CAPABILITIES.saveFlush]),
] satisfies readonly WorkspaceCommandDescriptor<DesignWorkspaceCommandId>[]);

function command(
    id: DesignWorkspaceCommandId,
    label: string,
    group: WorkspaceCommandDescriptor["group"],
    effect: WorkspaceCommandDescriptor["effect"],
    requiredCapabilities: readonly WorkspaceSurfaceCapabilityId[],
    shortcut?: string,
): WorkspaceCommandDescriptor<DesignWorkspaceCommandId> {
    return Object.freeze({ id, label, group, effect, requiredCapabilities: Object.freeze([...requiredCapabilities]), ...(shortcut ? { shortcut } : {}) });
}
