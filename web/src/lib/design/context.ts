import type { DesignAnnotation, DesignAssetVersion, DesignDocument, DesignElement, DesignFrame, DesignViewport } from "./schema";
import { parseDesignDocumentV1 } from "./validation";

export type DesignContextInput = {
    selectedElementIds: string[];
    activeFrameId: string | null;
    viewport: { x: number; y: number; width: number; height: number; zoom: number };
    maxElements?: number;
    maxTextCharacters?: number;
};

export type DesignContextElement = DesignElement extends infer Element ? (Element extends DesignElement ? Omit<Element, "hidden"> : never) : never;

export type DesignContext = {
    schemaVersion: 1;
    documentId: string;
    revision: number;
    activeFrame: DesignFrame | null;
    viewport: DesignViewport & { width: number; height: number };
    selectedElementIds: string[];
    elements: DesignContextElement[];
    assetVersions: DesignAssetVersion[];
    annotations: DesignAnnotation[];
    truncated: boolean;
    omittedElementCount: number;
    textCharacters: number;
    truncatedTextElementIds: string[];
};

export function buildDesignContext(documentValue: unknown, input: DesignContextInput): DesignContext {
    const document = parseDesignDocumentV1(documentValue);
    const maxElements = clampInteger(input.maxElements ?? 100, 1, 1_000, "maxElements");
    const maxTextCharacters = clampInteger(input.maxTextCharacters ?? 20_000, 1, 100_000, "maxTextCharacters");
    const viewport = {
        x: finite(input.viewport.x, "viewport.x"),
        y: finite(input.viewport.y, "viewport.y"),
        width: positive(input.viewport.width, "viewport.width"),
        height: positive(input.viewport.height, "viewport.height"),
        zoom: positive(input.viewport.zoom, "viewport.zoom"),
    };
    const visible = document.elements.filter((item) => !item.hidden);
    const frames = new Map(document.frames.map((item) => [item.id, item]));
    const elementMap = new Map(visible.map((item) => [item.id, item]));
    const selectedElementIds = [...new Set(input.selectedElementIds)].filter((id) => elementMap.has(id));
    const selected = selectedElementIds.map((id) => elementMap.get(id)!);
    const selectedSet = new Set(selectedElementIds);
    const inViewport = visible.filter((item) => !selectedSet.has(item.id) && intersects(item, viewport, frames));
    const inViewportSet = new Set(inViewport.map((item) => item.id));
    const remainder = visible.filter((item) => !selectedSet.has(item.id) && !inViewportSet.has(item.id));
    const prioritized = [...selected, ...inViewport, ...remainder];
    const elements: DesignContextElement[] = [];
    let textCharacters = 0;
    const truncatedTextElementIds: string[] = [];
    for (const item of prioritized) {
        if (elements.length >= maxElements) break;
        const { hidden: _hidden, ...contextElement } = structuredClone(item);
        if (contextElement.kind === "text") {
            const remaining = Math.max(0, maxTextCharacters - textCharacters);
            if (contextElement.text.length > remaining) {
                contextElement.text = contextElement.text.slice(0, remaining);
                truncatedTextElementIds.push(contextElement.id);
            }
            textCharacters += contextElement.text.length;
        }
        elements.push(contextElement);
    }
    const included = new Set(elements.map((item) => item.id));
    const assetVersionIds = new Set(elements.flatMap((item) => (item.kind === "image" ? [item.assetVersionId] : [])));
    const assetVersions = document.assetVersions.filter((item) => assetVersionIds.has(item.id));
    const annotations = document.annotations.filter((item) => {
        if (item.resolved) return false;
        if (item.target.kind === "element") return included.has(item.target.elementId);
        return input.activeFrameId === item.target.frameId;
    });
    return {
        schemaVersion: 1,
        documentId: document.id,
        revision: document.revision,
        activeFrame: document.frames.find((item) => item.id === input.activeFrameId) ?? null,
        viewport,
        selectedElementIds,
        elements,
        assetVersions: structuredClone(assetVersions),
        annotations: structuredClone(annotations),
        truncated: elements.length < visible.length || truncatedTextElementIds.length > 0,
        omittedElementCount: visible.length - elements.length,
        textCharacters,
        truncatedTextElementIds,
    };
}

function intersects(element: DesignElement, viewport: { x: number; y: number; width: number; height: number }, frames: Map<string, DesignFrame>) {
    const bounds = element.transform;
    const frame = element.frameId ? frames.get(element.frameId) : null;
    const x = bounds.x + (frame?.x ?? 0);
    const y = bounds.y + (frame?.y ?? 0);
    return x < viewport.x + viewport.width && x + bounds.width > viewport.x && y < viewport.y + viewport.height && y + bounds.height > viewport.y;
}

function finite(value: number, label: string) {
    if (!Number.isFinite(value)) throw new Error(`${label} 必须是有限数值`);
    return value;
}

function positive(value: number, label: string) {
    finite(value, label);
    if (value <= 0) throw new Error(`${label} 必须大于 0`);
    return value;
}

function clampInteger(value: number, minimum: number, maximum: number, label: string) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label} 必须在 ${minimum} 到 ${maximum} 之间`);
    return value;
}
