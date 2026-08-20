import { CanvasNodeType, type CanvasNodeData } from "../types";

/** Only visual Canvas nodes have a stable image representation for Handoff. */
export function isCanvasHandoffNode(node: CanvasNodeData | null | undefined) {
    return Boolean(node && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Panorama || node.type === CanvasNodeType.Drawing) && canvasHandoffStorageKey(node));
}

export function canvasHandoffSelectionIds(nodes: readonly CanvasNodeData[], selectionIds: readonly string[]) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return selectionIds.filter((id) => isCanvasHandoffNode(byId.get(id)));
}

function canvasHandoffStorageKey(node: CanvasNodeData) {
    const drawing = node.metadata?.drawingPreview;
    for (const value of [drawing?.storageKey, node.metadata?.storageKey, drawing?.serverUrl, node.metadata?.serverUrl, node.metadata?.content]) {
        const normalized = typeof value === "string" ? value.trim().replace(/\\/g, "/") : "";
        if (!normalized) continue;
        const direct = safePermanentStorageKey(normalized);
        if (direct) return direct;
        for (const route of ["/api/reference-assets/", "/api/generation-log-assets/"]) {
            const index = normalized.indexOf(route);
            if (index < 0) continue;
            try {
                const decoded = normalized
                    .slice(index + route.length)
                    .split(/[?#]/, 1)[0]
                    .split("/")
                    .map(decodeURIComponent)
                    .join("/");
                const key = safePermanentStorageKey(decoded);
                if (key) return key;
            } catch {
                // Continue through the remaining stable-resource candidates.
            }
        }
    }
    return "";
}

function safePermanentStorageKey(value: string) {
    if (!value.startsWith("permanent/") || value.length > 1_024 || /[\\\0-\x1f?#]/.test(value) || value.includes("..")) return "";
    return value.split("/").every((segment) => segment && segment !== "." && segment !== "..") ? value : "";
}
