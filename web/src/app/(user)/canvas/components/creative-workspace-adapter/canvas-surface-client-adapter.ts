import { defineWorkspaceSurface, defineWorkspaceSurfaceCapabilities, workspaceCommandIsSupported, type WorkspaceSurfaceCapabilityId } from "@/lib/creative-workspace";

import { CanvasNodeType, type CanvasNodeData, type Position, type ViewportTransform } from "../../types";

export const CANVAS_SURFACE_COMMAND_IDS = ["history.undo", "history.redo", "viewport.pan", "viewport.zoom", "viewport.reset", "selection.clear", "selection.delete", "selection.resize", "create.node"] as const;

export type CanvasSurfaceCommandId = (typeof CANVAS_SURFACE_COMMAND_IDS)[number];

export type CanvasSurfaceCommand =
    | Readonly<{ id: "history.undo" }>
    | Readonly<{ id: "history.redo" }>
    | Readonly<{ id: "viewport.pan"; deltaX: number; deltaY: number }>
    | Readonly<{ id: "viewport.zoom"; scale: number }>
    | Readonly<{ id: "viewport.reset" }>
    | Readonly<{ id: "selection.clear" }>
    | Readonly<{ id: "selection.delete" }>
    | Readonly<{ id: "selection.resize"; nodeId?: string; width: number; height: number; position?: Position }>
    | Readonly<{ id: "create.node"; nodeType: CanvasNodeType; position?: Position }>;

export type CanvasSurfaceCommandFailureReason = "unknown-command" | "unsupported-command" | "disabled-command" | "invalid-command" | "handler-error";

export type CanvasSurfaceCommandResult =
    Readonly<{ ok: true; commandId: CanvasSurfaceCommandId; snapshot: CanvasSurfaceClientSnapshot }> | Readonly<{ ok: false; commandId: string; reason: CanvasSurfaceCommandFailureReason; message: string; snapshot: CanvasSurfaceClientSnapshot }>;

export type CanvasSurfaceRect = Readonly<{ x: number; y: number; width: number; height: number }>;
export type CanvasSurfacePoint = Readonly<{ x: number; y: number }>;

export type CanvasSurfaceClientState = Readonly<{
    projectId: string;
    nodes: readonly CanvasNodeData[];
    selectedNodeIds: ReadonlySet<string>;
    selectedConnectionId?: string | null;
    viewport: ViewportTransform;
    viewportSize: Readonly<{ width: number; height: number }>;
    surfaceClientRect?: Readonly<{ left: number; top: number; width: number; height: number }>;
    canUndo: boolean;
    canRedo: boolean;
}>;

export type CanvasSurfaceClientSnapshot = Readonly<{
    surfaceId: "canvas";
    projectId: string;
    revision: number;
    viewport: Readonly<{ x: number; y: number; scale: number }>;
    viewportSize: Readonly<{ width: number; height: number }>;
    surfaceClientRect: Readonly<{ left: number; top: number; width: number; height: number }>;
    history: Readonly<{ canUndo: boolean; canRedo: boolean }>;
    selection: Readonly<{
        nodeIds: readonly string[];
        connectionId: string | null;
        bounds: CanvasSurfaceRect | null;
        clientBounds: CanvasSurfaceRect | null;
        containsLockedNode: boolean;
        resizable: boolean;
    }>;
}>;

export type CanvasSurfaceChangeKind = "history" | "viewport" | "selection" | "resize" | "document";
export type CanvasSurfaceSubscriber = (snapshot: CanvasSurfaceClientSnapshot, change: CanvasSurfaceChangeKind) => void;

type MaybePromise = void | Promise<void>;

export type CanvasSurfaceCommandHandlers = Readonly<{
    undo?: () => MaybePromise;
    redo?: () => MaybePromise;
    setViewport?: (viewport: ViewportTransform) => MaybePromise;
    setZoomScale?: (scale: number) => MaybePromise;
    resetViewport?: () => MaybePromise;
    clearSelection?: () => MaybePromise;
    deleteNodes?: (nodeIds: Set<string>) => MaybePromise;
    deleteConnection?: (connectionId: string) => MaybePromise;
    resizeNode?: (nodeId: string, width: number, height: number, position?: Position) => MaybePromise;
    createNode?: (nodeType: CanvasNodeType, position?: Position) => MaybePromise;
}>;

export type CanvasSurfaceClientAdapterOptions = Readonly<{
    readState: () => CanvasSurfaceClientState;
    handlers?: CanvasSurfaceCommandHandlers;
    /**
     * React-owned state is only authoritative after its commit phase. Set this
     * to false when the owner publishes a classified refresh from that phase.
     */
    autoRefresh?: boolean;
}>;

export type CanvasSurfaceClientAdapter = Readonly<{
    descriptor: ReturnType<typeof createCanvasSurfaceDescriptor>;
    getSnapshot: () => CanvasSurfaceClientSnapshot;
    refresh: (change?: CanvasSurfaceChangeKind) => CanvasSurfaceClientSnapshot;
    subscribe: (subscriber: CanvasSurfaceSubscriber) => () => void;
    execute: (command: CanvasSurfaceCommand | Readonly<{ id: string }>) => Promise<CanvasSurfaceCommandResult>;
    commandEnabled: (commandId: string) => boolean;
    sceneToClient: (point: Position) => CanvasSurfacePoint;
    clientToScene: (point: Position) => CanvasSurfacePoint;
    sceneRectToClient: (rect: CanvasSurfaceRect) => CanvasSurfaceRect;
    destroy: () => void;
}>;

const CANVAS_RESET_CAPABILITY = "extension:canvas.viewport.reset" as const;
const CANVAS_CLEAR_SELECTION_CAPABILITY = "extension:canvas.selection.clear" as const;

const CANVAS_CREATABLE_NODE_TYPES = new Set<CanvasNodeType>([CanvasNodeType.Text, CanvasNodeType.Image, CanvasNodeType.Panorama, CanvasNodeType.Drawing, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Config]);

const canvasCommandDescriptors = [
    { id: "history.undo", label: "撤销", group: "history", effect: "document", shortcut: "Control+Z", requiredCapabilities: ["history.undo"] },
    { id: "history.redo", label: "重做", group: "history", effect: "document", shortcut: "Control+Shift+Z", requiredCapabilities: ["history.redo"] },
    { id: "viewport.pan", label: "平移视图", group: "viewport", effect: "view", requiredCapabilities: ["viewport.pan"] },
    { id: "viewport.zoom", label: "缩放视图", group: "viewport", effect: "view", requiredCapabilities: ["viewport.zoom"] },
    { id: "viewport.reset", label: "重置视图", group: "viewport", effect: "view", requiredCapabilities: [CANVAS_RESET_CAPABILITY] },
    { id: "selection.clear", label: "取消选择", group: "selection", effect: "view", requiredCapabilities: [CANVAS_CLEAR_SELECTION_CAPABILITY] },
    { id: "selection.delete", label: "删除选中内容", group: "selection", effect: "document", requiredCapabilities: ["selection.delete"] },
    { id: "selection.resize", label: "调整选中节点尺寸", group: "selection", effect: "document", requiredCapabilities: ["selection.resize"] },
    { id: "create.node", label: "创建画布节点", group: "create", effect: "document", requiredCapabilities: ["content.create"] },
] as const;

/**
 * Canvas-only client bridge for domain-neutral workspace consumers. Shared
 * code sees only the descriptor; Canvas nodes and command handlers never
 * cross into the shared package.
 */
export function createCanvasSurfaceClientAdapter({ readState, handlers = {}, autoRefresh = true }: CanvasSurfaceClientAdapterOptions): CanvasSurfaceClientAdapter {
    const descriptor = createCanvasSurfaceDescriptor(handlers);
    const listeners = new Set<CanvasSurfaceSubscriber>();
    let revision = 0;
    let destroyed = false;
    let snapshot = buildCanvasSurfaceSnapshot(readState(), revision);

    const getSnapshot = () => snapshot;

    const refresh = (change: CanvasSurfaceChangeKind = "document") => {
        if (destroyed) return snapshot;
        revision += 1;
        snapshot = buildCanvasSurfaceSnapshot(readState(), revision);
        for (const listener of listeners) listener(snapshot, change);
        return snapshot;
    };

    const snapshotAfterCommand = (change: CanvasSurfaceChangeKind) => (autoRefresh ? refresh(change) : snapshot);

    const subscribe = (subscriber: CanvasSurfaceSubscriber) => {
        if (destroyed) return () => undefined;
        listeners.add(subscriber);
        let subscribed = true;
        return () => {
            if (!subscribed) return;
            subscribed = false;
            listeners.delete(subscriber);
        };
    };

    const commandEnabled = (commandId: string) => {
        const descriptorCommand = descriptor.commands.find((command) => command.id === commandId);
        if (!descriptorCommand || !workspaceCommandIsSupported(descriptor.capabilities, descriptorCommand)) return false;
        const state = readState();
        const selectedNodes = selectedCanvasNodes(state);
        switch (commandId) {
            case "history.undo":
                return state.canUndo;
            case "history.redo":
                return state.canRedo;
            case "selection.clear":
                return selectedNodes.length > 0 || Boolean(state.selectedConnectionId);
            case "selection.delete":
                return (selectedNodes.length > 0 && Boolean(handlers.deleteNodes)) || (Boolean(state.selectedConnectionId) && Boolean(handlers.deleteConnection));
            case "selection.resize":
                return selectedNodes.length === 1 && !selectedNodes[0]?.metadata?.locked;
            default:
                return true;
        }
    };

    const execute = async (command: CanvasSurfaceCommand | Readonly<{ id: string }>): Promise<CanvasSurfaceCommandResult> => {
        const descriptorCommand = descriptor.commands.find((item) => item.id === command.id);
        if (!descriptorCommand) return failure(command.id, "unknown-command", `Unknown Canvas surface command: ${command.id}`, snapshot);
        if (!workspaceCommandIsSupported(descriptor.capabilities, descriptorCommand)) {
            return failure(command.id, "unsupported-command", `Canvas surface command is not supported: ${command.id}`, snapshot);
        }
        if (!commandEnabled(command.id)) return failure(command.id, "disabled-command", `Canvas surface command is currently disabled: ${command.id}`, snapshot);

        const state = readState();
        try {
            switch (command.id) {
                case "history.undo":
                    await handlers.undo?.();
                    return success(command.id, snapshotAfterCommand("history"));
                case "history.redo":
                    await handlers.redo?.();
                    return success(command.id, snapshotAfterCommand("history"));
                case "viewport.pan": {
                    if (!isPanCommand(command)) return invalid(command.id, "Pan deltas must be finite numbers", snapshot);
                    await handlers.setViewport?.({ ...state.viewport, x: state.viewport.x + command.deltaX, y: state.viewport.y + command.deltaY });
                    return success(command.id, snapshotAfterCommand("viewport"));
                }
                case "viewport.zoom": {
                    if (!isZoomCommand(command)) return invalid(command.id, "Zoom scale must be a finite number", snapshot);
                    await handlers.setZoomScale?.(clamp(command.scale, 0.05, 5));
                    return success(command.id, snapshotAfterCommand("viewport"));
                }
                case "viewport.reset":
                    await handlers.resetViewport?.();
                    return success(command.id, snapshotAfterCommand("viewport"));
                case "selection.clear":
                    await handlers.clearSelection?.();
                    return success(command.id, snapshotAfterCommand("selection"));
                case "selection.delete": {
                    const selectedNodes = selectedCanvasNodes(state);
                    if (selectedNodes.length) await handlers.deleteNodes?.(new Set(selectedNodes.map((node) => node.id)));
                    else if (state.selectedConnectionId) await handlers.deleteConnection?.(state.selectedConnectionId);
                    return success(command.id, snapshotAfterCommand("document"));
                }
                case "selection.resize": {
                    if (!isResizeCommand(command)) return invalid(command.id, "Resize width, height and position must be finite", snapshot);
                    const selectedNode = selectedCanvasNodes(state)[0];
                    if (!selectedNode || (command.nodeId && command.nodeId !== selectedNode.id)) {
                        return invalid(command.id, "Resize target must be the single selected Canvas node", snapshot);
                    }
                    await handlers.resizeNode?.(selectedNode.id, Math.max(220, command.width), Math.max(160, command.height), command.position);
                    return success(command.id, snapshotAfterCommand("resize"));
                }
                case "create.node": {
                    if (!isCreateNodeCommand(command) || !CANVAS_CREATABLE_NODE_TYPES.has(command.nodeType)) {
                        return invalid(command.id, "Canvas node type or position is not creatable", snapshot);
                    }
                    await handlers.createNode?.(command.nodeType, command.position);
                    return success(command.id, snapshotAfterCommand("document"));
                }
                default:
                    return failure(command.id, "unknown-command", `Unknown Canvas surface command: ${command.id}`, snapshot);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : `Canvas surface command failed: ${command.id}`;
            return failure(command.id, "handler-error", message, snapshotAfterCommand("document"));
        }
    };

    const sceneToClient = (point: Position) => scenePointToClient(point, snapshot);
    const clientToScene = (point: Position) => clientPointToScene(point, snapshot);
    const sceneRectToClient = (rect: CanvasSurfaceRect) => sceneBoundsToClient(rect, snapshot);

    const destroy = () => {
        destroyed = true;
        listeners.clear();
    };

    return Object.freeze({ descriptor, getSnapshot, refresh, subscribe, execute, commandEnabled, sceneToClient, clientToScene, sceneRectToClient, destroy });
}

function createCanvasSurfaceDescriptor(handlers: CanvasSurfaceCommandHandlers) {
    const capabilities: WorkspaceSurfaceCapabilityId[] = ["viewport.observe", "viewport.coordinate-conversion", "selection.read", "selection.bounds", "selection.observe"];
    if (handlers.undo) capabilities.push("history.undo");
    if (handlers.redo) capabilities.push("history.redo");
    if (handlers.setViewport) capabilities.push("viewport.pan");
    if (handlers.setZoomScale) capabilities.push("viewport.zoom");
    if (handlers.resetViewport) capabilities.push(CANVAS_RESET_CAPABILITY);
    if (handlers.clearSelection) capabilities.push(CANVAS_CLEAR_SELECTION_CAPABILITY);
    if (handlers.deleteNodes || handlers.deleteConnection) capabilities.push("selection.delete");
    if (handlers.resizeNode) capabilities.push("selection.resize");
    if (handlers.createNode) capabilities.push("content.create");

    return defineWorkspaceSurface({
        id: "canvas",
        label: "Canvas",
        capabilities: defineWorkspaceSurfaceCapabilities(...capabilities),
        commands: canvasCommandDescriptors,
    });
}

function buildCanvasSurfaceSnapshot(state: CanvasSurfaceClientState, revision: number): CanvasSurfaceClientSnapshot {
    const selectedNodes = selectedCanvasNodes(state);
    const bounds = canvasNodeBounds(selectedNodes);
    const surfaceClientRect = Object.freeze({
        left: finiteOr(state.surfaceClientRect?.left, 0),
        top: finiteOr(state.surfaceClientRect?.top, 0),
        width: finiteOr(state.surfaceClientRect?.width, state.viewportSize.width),
        height: finiteOr(state.surfaceClientRect?.height, state.viewportSize.height),
    });
    const viewport = Object.freeze({ x: finiteOr(state.viewport.x, 0), y: finiteOr(state.viewport.y, 0), scale: clamp(finiteOr(state.viewport.k, 1), 0.05, 5) });
    const viewportSize = Object.freeze({ width: Math.max(0, finiteOr(state.viewportSize.width, 0)), height: Math.max(0, finiteOr(state.viewportSize.height, 0)) });
    const coordinateSnapshot = { viewport, surfaceClientRect };
    const frozenBounds = bounds ? Object.freeze(bounds) : null;
    const clientBounds = frozenBounds ? Object.freeze(sceneBoundsToClient(frozenBounds, coordinateSnapshot)) : null;
    const containsLockedNode = selectedNodes.some((node) => Boolean(node.metadata?.locked));
    const selection = Object.freeze({
        nodeIds: Object.freeze(selectedNodes.map((node) => node.id)),
        connectionId: state.selectedConnectionId || null,
        bounds: frozenBounds,
        clientBounds,
        containsLockedNode,
        resizable: selectedNodes.length === 1 && !containsLockedNode,
    });

    return Object.freeze({
        surfaceId: "canvas" as const,
        projectId: state.projectId,
        revision,
        viewport,
        viewportSize,
        surfaceClientRect,
        history: Object.freeze({ canUndo: Boolean(state.canUndo), canRedo: Boolean(state.canRedo) }),
        selection,
    });
}

function selectedCanvasNodes(state: CanvasSurfaceClientState) {
    return state.nodes.filter((node) => state.selectedNodeIds.has(node.id));
}

function canvasNodeBounds(nodes: readonly CanvasNodeData[]): { x: number; y: number; width: number; height: number } | null {
    if (!nodes.length) return null;
    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const node of nodes) {
        if (![node.position.x, node.position.y, node.width, node.height].every(Number.isFinite)) continue;
        left = Math.min(left, node.position.x);
        top = Math.min(top, node.position.y);
        right = Math.max(right, node.position.x + node.width);
        bottom = Math.max(bottom, node.position.y + node.height);
    }
    if (![left, top, right, bottom].every(Number.isFinite)) return null;
    return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function scenePointToClient(point: Position, snapshot: Pick<CanvasSurfaceClientSnapshot, "viewport" | "surfaceClientRect">): CanvasSurfacePoint {
    return Object.freeze({
        x: snapshot.surfaceClientRect.left + snapshot.viewport.x + point.x * snapshot.viewport.scale,
        y: snapshot.surfaceClientRect.top + snapshot.viewport.y + point.y * snapshot.viewport.scale,
    });
}

function clientPointToScene(point: Position, snapshot: Pick<CanvasSurfaceClientSnapshot, "viewport" | "surfaceClientRect">): CanvasSurfacePoint {
    return Object.freeze({
        x: (point.x - snapshot.surfaceClientRect.left - snapshot.viewport.x) / snapshot.viewport.scale,
        y: (point.y - snapshot.surfaceClientRect.top - snapshot.viewport.y) / snapshot.viewport.scale,
    });
}

function sceneBoundsToClient(rect: CanvasSurfaceRect, snapshot: Pick<CanvasSurfaceClientSnapshot, "viewport" | "surfaceClientRect">): CanvasSurfaceRect {
    const origin = scenePointToClient(rect, snapshot);
    return Object.freeze({ x: origin.x, y: origin.y, width: rect.width * snapshot.viewport.scale, height: rect.height * snapshot.viewport.scale });
}

function isPanCommand(command: Readonly<{ id: string }>): command is Extract<CanvasSurfaceCommand, { id: "viewport.pan" }> {
    return command.id === "viewport.pan" && "deltaX" in command && "deltaY" in command && Number.isFinite(command.deltaX) && Number.isFinite(command.deltaY);
}

function isZoomCommand(command: Readonly<{ id: string }>): command is Extract<CanvasSurfaceCommand, { id: "viewport.zoom" }> {
    return command.id === "viewport.zoom" && "scale" in command && Number.isFinite(command.scale);
}

function isResizeCommand(command: Readonly<{ id: string }>): command is Extract<CanvasSurfaceCommand, { id: "selection.resize" }> {
    if (command.id !== "selection.resize" || !("width" in command) || !("height" in command)) return false;
    if (typeof command.width !== "number" || typeof command.height !== "number" || !Number.isFinite(command.width) || !Number.isFinite(command.height) || command.width <= 0 || command.height <= 0) return false;
    if (!("position" in command) || command.position === undefined) return true;
    return isObject(command.position) && isFinitePosition(command.position);
}

function isCreateNodeCommand(command: Readonly<{ id: string }>): command is Extract<CanvasSurfaceCommand, { id: "create.node" }> {
    if (command.id !== "create.node" || !("nodeType" in command) || typeof command.nodeType !== "string") return false;
    if (!("position" in command) || command.position === undefined) return true;
    return isObject(command.position) && isFinitePosition(command.position);
}

function isFinitePosition(value: object): value is Position {
    return "x" in value && "y" in value && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function isObject(value: unknown): value is object {
    return typeof value === "object" && value !== null;
}

function success(commandId: CanvasSurfaceCommandId, snapshot: CanvasSurfaceClientSnapshot): CanvasSurfaceCommandResult {
    return Object.freeze({ ok: true, commandId, snapshot });
}

function invalid(commandId: string, message: string, snapshot: CanvasSurfaceClientSnapshot): CanvasSurfaceCommandResult {
    return failure(commandId, "invalid-command", message, snapshot);
}

function failure(commandId: string, reason: CanvasSurfaceCommandFailureReason, message: string, snapshot: CanvasSurfaceClientSnapshot): CanvasSurfaceCommandResult {
    return Object.freeze({ ok: false, commandId, reason, message, snapshot });
}

function finiteOr(value: number | undefined, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}
