import type { WorkspaceStableResourceLocator } from "@/lib/creative-workspace";

export type AgentCanvasSnapshotNode = Readonly<{
    id: string;
    type: string;
    title: string;
    width?: number;
    height?: number;
    size?: string;
    content?: string;
    locked: boolean;
    hidden: boolean;
    resource?: WorkspaceStableResourceLocator;
}>;

export type AgentCanvasSnapshotRelation = Readonly<{
    id: string;
    fromNodeId: string;
    toNodeId: string;
}>;

export function selectedCanvasNodeIds(snapshot: unknown) {
    const source = record(snapshot);
    const ids = Array.isArray(source.selectionIds) ? source.selectionIds : Array.isArray(source.selectedNodeIds) ? source.selectedNodeIds : [];
    return Array.from(new Set(ids.filter((id): id is string => typeof id === "string" && Boolean(id.trim())).map((id) => id.trim()))).slice(0, 20);
}

export function agentCanvasSnapshotNodes(snapshot: unknown): AgentCanvasSnapshotNode[] {
    const source = record(snapshot);
    const sharedEntities = records(source.entities);
    if (source.surface === "canvas" && sharedEntities.length) return sharedEntities.flatMap(sharedCanvasNode);
    return records(source.nodes).flatMap(legacyCanvasNode);
}

export function agentCanvasSnapshotRelations(snapshot: unknown): AgentCanvasSnapshotRelation[] {
    const source = record(snapshot);
    const sharedRelations = records(source.relations);
    if (source.surface === "canvas" && sharedRelations.length) {
        return sharedRelations.flatMap((relation) => {
            const id = text(relation.id);
            const fromNodeId = text(relation.fromId);
            const toNodeId = text(relation.toId);
            return id && fromNodeId && toNodeId ? [{ id, fromNodeId, toNodeId }] : [];
        });
    }
    return records(source.connections).flatMap((connection) => {
        const id = text(connection.id);
        const fromNodeId = text(connection.fromNodeId);
        const toNodeId = text(connection.toNodeId);
        return id && fromNodeId && toNodeId ? [{ id, fromNodeId, toNodeId }] : [];
    });
}

function sharedCanvasNode(entity: Record<string, unknown>): AgentCanvasSnapshotNode[] {
    const id = text(entity.id);
    const type = text(entity.kind);
    if (!id || !type) return [];
    const bounds = record(entity.bounds);
    const content = safeContent(entity.text);
    return [
        Object.freeze({
            id,
            type,
            title: safeLabel(entity.name, type),
            width: positiveNumber(bounds.width),
            height: positiveNumber(bounds.height),
            ...(type === "config" && exactPixelSize(content) ? { size: content } : {}),
            ...(content ? { content } : {}),
            locked: Boolean(entity.locked),
            hidden: Boolean(entity.hidden),
            ...(stableResource(entity.resource) ? { resource: stableResource(entity.resource) } : {}),
        }),
    ];
}

function legacyCanvasNode(node: Record<string, unknown>): AgentCanvasSnapshotNode[] {
    const id = text(node.id);
    const type = text(node.type);
    if (!id || !type) return [];
    const metadata = record(node.metadata);
    const content = safeContent(metadata.content || metadata.prompt || metadata.composerContent);
    const resource = stableResource(node.resource) || stableResource(metadata.resource) || stableStorageKey(metadata.storageKey);
    return [
        Object.freeze({
            id,
            type: type === "panorama" ? "image" : type,
            title: safeLabel(node.title, type),
            width: positiveNumber(metadata.naturalWidth) || positiveNumber(node.width),
            height: positiveNumber(metadata.naturalHeight) || positiveNumber(node.height),
            ...(safeSize(metadata.size) ? { size: safeSize(metadata.size) } : {}),
            ...(content ? { content } : {}),
            locked: Boolean(metadata.locked),
            hidden: Boolean(metadata.hidden),
            ...(resource ? { resource } : {}),
        }),
    ];
}

function stableResource(value: unknown): WorkspaceStableResourceLocator | undefined {
    const input = record(value);
    if (input.kind === "storage-key") return stableStorageKey(input.storageKey);
    if (input.kind === "library-asset") {
        const libraryAssetId = text(input.libraryAssetId);
        return /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(libraryAssetId) ? Object.freeze({ kind: "library-asset", libraryAssetId }) : undefined;
    }
    return undefined;
}

function stableStorageKey(value: unknown): WorkspaceStableResourceLocator | undefined {
    const storageKey = text(value);
    if (!storageKey || storageKey.length > 1_024 || storageKey.startsWith("/") || /^(?:data|blob|https?|temporary)(?::|\/)/i.test(storageKey) || /[\\\0-\x1f?#]/.test(storageKey) || storageKey.includes("..")) return undefined;
    const segments = storageKey.split("/");
    return segments.every((segment) => segment && segment !== "." && segment !== "..") ? Object.freeze({ kind: "storage-key", storageKey }) : undefined;
}

function safeLabel(value: unknown, fallback: string) {
    const label = safeContent(value);
    return (label || fallback || "节点").slice(0, 200);
}

function safeContent(value: unknown) {
    const content = text(value);
    return content && !/^(?:data|blob|https?):/i.test(content) ? content.slice(0, 2_000) : "";
}

function safeSize(value: unknown) {
    const size = text(value);
    return size && size.length <= 40 && !/^(?:data|blob|https?):/i.test(size) ? size : "";
}

function exactPixelSize(value: string) {
    return /^\d{2,5}\s*[xX×]\s*\d{2,5}$/.test(value) ? value.replace(/[X×]/g, "x").replace(/\s/g, "") : "";
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function records(value: unknown) {
    return Array.isArray(value) ? value.map(record) : [];
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function positiveNumber(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
