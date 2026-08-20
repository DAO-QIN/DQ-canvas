import { isCanvasImageNodeType, type CanvasDerivedImageOperation, type CanvasDerivedImageProvenance, type CanvasNodeData, type CanvasNodeMetadata } from "../types";

type CanvasDerivedImageMetadata = Pick<CanvasNodeMetadata, "derivedOperation" | "sourceNodeId" | "sourceStorageKey" | "derivedImageProvenance">;

export function canvasDerivedImageProvenance(sourceNode: CanvasNodeData, operation: CanvasDerivedImageOperation): CanvasDerivedImageMetadata {
    const sourceStorageKey = sourceNode.metadata?.storageKey?.trim() || undefined;
    const provenance: CanvasDerivedImageProvenance = {
        operation,
        sourceNodeId: sourceNode.id,
        sourceFingerprint: canvasDerivedImageSourceFingerprint(sourceNode),
        ...(sourceStorageKey ? { sourceStorageKey } : {}),
    };
    return {
        derivedOperation: operation,
        sourceNodeId: sourceNode.id,
        sourceStorageKey,
        derivedImageProvenance: provenance,
    };
}

export function canvasDerivedImageSourceMatches(provenance: CanvasDerivedImageProvenance, nodes: readonly CanvasNodeData[]) {
    const sourceNode = nodes.find((node) => node.id === provenance.sourceNodeId);
    if (!sourceNode || !isCanvasImageNodeType(sourceNode.type) || !sourceNode.metadata?.content?.trim()) return false;
    if ((sourceNode.metadata.storageKey?.trim() || undefined) !== provenance.sourceStorageKey) return false;
    return canvasDerivedImageSourceFingerprint(sourceNode) === provenance.sourceFingerprint;
}

export function canvasDerivedImageSourceFingerprint(node: CanvasNodeData) {
    const storageKey = node.metadata?.storageKey?.trim() || "";
    const identity = storageKey ? `storage:${storageKey}` : `content:${node.metadata?.content?.trim() || ""}`;
    return `${fnv1a(identity, 0x811c9dc5)}${fnv1a(identity, 0x9e3779b9)}`;
}

function fnv1a(value: string, seed: number) {
    let hash = seed >>> 0;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}
