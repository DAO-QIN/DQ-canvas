import type { DesignDocument, DesignElement, DesignFrame, DesignOperation, DesignOperationScope, DesignPoint, DesignTransform } from "@/lib/design";

export type DesignEditorSelection = { kind: "frame"; id: string } | { kind: "elements"; ids: string[] } | null;
export type DesignCreatableElementKind = "text" | "rectangle" | "ellipse" | "line" | "arrow";
export type DesignAlignment = "left" | "horizontal-center" | "right" | "top" | "vertical-center" | "bottom";
export type DesignDistribution = "horizontal" | "vertical";
export type DesignLayerReorder = "forward" | "backward" | "front" | "back";
export type DesignRect = { x: number; y: number; width: number; height: number };

export function validDesignEditorSelection(document: DesignDocument, selection: DesignEditorSelection): DesignEditorSelection {
    if (!selection) return null;
    if (selection.kind === "frame") return document.frames.some((frame) => frame.id === selection.id) ? selection : null;
    if (!selection.ids.length || new Set(selection.ids).size !== selection.ids.length) return null;
    const elements = selection.ids.map((id) => document.elements.find((element) => element.id === id));
    if (elements.some((element) => !element)) return null;
    return elements.every((element) => element?.frameId === elements[0]?.frameId) ? selection : null;
}

export function createFrameOperation(document: DesignDocument, id: string, opId: string, center: DesignPoint): Extract<DesignOperation, { type: "create-frame" }> {
    const sequence = document.frames.length + 1;
    const stagger = ((sequence - 1) % 6) * 48;
    const frame: DesignFrame = {
        id,
        name: `画框 ${sequence}`,
        x: round(center.x - 600 + stagger),
        y: round(center.y - 600 + stagger),
        width: 1200,
        height: 1200,
        background: "#ffffff",
        locked: false,
        export: { format: "png", scale: 1, quality: 1, background: "frame" },
    };
    return { opId, type: "create-frame", frame, index: document.frames.length };
}

export function createElementOperation(document: DesignDocument, selection: DesignEditorSelection, kind: DesignCreatableElementKind, id: string, opId: string, workspaceCenter: DesignPoint): Extract<DesignOperation, { type: "create-element" }> {
    const frame = targetFrame(document, selection);
    const layer = document.layers.find((candidate) => (frame ? candidate.scope === "frame" && candidate.frameId === frame.id : candidate.scope === "workspace"));
    const index = layer?.elementIds.length ?? 0;
    const size = elementSize(kind);
    const center = frame ? { x: frame.width / 2, y: frame.height / 2 } : workspaceCenter;
    const stagger = (index % 8) * 24;
    const transform: DesignTransform = {
        x: round(center.x - size.width / 2 + stagger),
        y: round(center.y - size.height / 2 + stagger),
        width: size.width,
        height: size.height,
        rotation: 0,
        flipX: false,
        flipY: false,
    };
    const common = {
        id,
        frameId: frame?.id ?? null,
        name: elementName(kind, document.elements.length + 1),
        transform,
        opacity: 1,
        blendMode: "normal" as const,
        locked: false,
        hidden: false,
    };
    let element: DesignElement;
    if (kind === "text") {
        element = {
            ...common,
            kind: "text",
            text: "在右侧输入文字",
            fontFamily: "Inter, Noto Sans SC, sans-serif",
            fontSize: 48,
            fontWeight: 600,
            fontStyle: "normal",
            lineHeight: 1.2,
            letterSpacing: 0,
            align: "left",
            verticalAlign: "top",
            fill: "#111827",
            stroke: null,
            strokeWidth: 0,
        };
    } else if (kind === "rectangle" || kind === "ellipse") {
        element = {
            ...common,
            kind: "shape",
            shape: kind,
            fill: kind === "rectangle" ? "#6366f1" : "#14b8a6",
            stroke: null,
            strokeWidth: 0,
            cornerRadius: kind === "rectangle" ? 24 : 0,
        };
    } else if (kind === "line") {
        element = { ...common, kind: "line", stroke: "#334155", strokeWidth: 4, dash: [], cap: "round" };
    } else {
        element = { ...common, kind: "arrow", stroke: "#0f172a", strokeWidth: 5, dash: [], startHead: "none", endHead: "arrow" };
    }
    return { opId, type: "create-element", element, index };
}

export function selectedDesignEntity(document: DesignDocument, selection: DesignEditorSelection) {
    if (!selection) return null;
    if (selection.kind === "frame") return document.frames.find((frame) => frame.id === selection.id) ?? null;
    return selection.ids.length === 1 ? (document.elements.find((element) => element.id === selection.ids[0]) ?? null) : null;
}

export function selectedDesignElements(document: DesignDocument, selection: DesignEditorSelection) {
    if (selection?.kind !== "elements") return [];
    const ids = new Set(selection.ids);
    return document.elements.filter((element) => ids.has(element.id));
}

export function toggleDesignElementSelection(document: DesignDocument, selection: DesignEditorSelection, elementId: string, additive: boolean): DesignEditorSelection {
    const element = document.elements.find((candidate) => candidate.id === elementId);
    if (!element) return null;
    if (!additive || selection?.kind !== "elements") return { kind: "elements", ids: [elementId] };
    const selected = selectedDesignElements(document, selection);
    if (!selected.length || selected[0].frameId !== element.frameId) return { kind: "elements", ids: [elementId] };
    const ids = selection.ids.includes(elementId) ? selection.ids.filter((id) => id !== elementId) : [...selection.ids, elementId];
    return ids.length ? { kind: "elements", ids } : null;
}

export function visualDesignElementBounds(element: DesignElement): DesignRect {
    const { x, y, width, height, rotation } = element.transform;
    const angle = (rotation * Math.PI) / 180;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const points = [
        { x, y },
        { x: x + width * cosine, y: y + width * sine },
        { x: x - height * sine, y: y + height * cosine },
        { x: x + width * cosine - height * sine, y: y + width * sine + height * cosine },
    ];
    const left = Math.min(...points.map((point) => point.x));
    const top = Math.min(...points.map((point) => point.y));
    const right = Math.max(...points.map((point) => point.x));
    const bottom = Math.max(...points.map((point) => point.y));
    return { x: round(left), y: round(top), width: round(right - left), height: round(bottom - top) };
}

export function alignDesignElements(document: DesignDocument, ids: string[], alignment: DesignAlignment, createId: () => string): DesignOperation[] {
    const elements = validEditableElementGroup(document, ids);
    if (!elements.length) return [];
    const bounds = elements.map(visualDesignElementBounds);
    const target = elements.length === 1 ? frameBounds(document, elements[0].frameId) : unionBounds(bounds);
    if (!target) return [];
    return elements.flatMap((element, index) => {
        const delta = alignmentDelta(bounds[index], target, alignment);
        if (!delta.x && !delta.y) return [];
        return [{ opId: `op-${createId()}`, type: "update-transform" as const, elementId: element.id, transform: { ...element.transform, x: round(element.transform.x + delta.x), y: round(element.transform.y + delta.y) } }];
    });
}

export function distributeDesignElements(document: DesignDocument, ids: string[], distribution: DesignDistribution, createId: () => string): DesignOperation[] {
    const elements = validEditableElementGroup(document, ids);
    if (elements.length < 3) return [];
    const entries = elements.map((element) => ({ element, bounds: visualDesignElementBounds(element) })).toSorted((left, right) => (distribution === "horizontal" ? left.bounds.x - right.bounds.x : left.bounds.y - right.bounds.y));
    const first = entries[0].bounds;
    const last = entries.at(-1)!.bounds;
    const span = distribution === "horizontal" ? last.x + last.width - first.x : last.y + last.height - first.y;
    const occupied = entries.reduce((total, entry) => total + (distribution === "horizontal" ? entry.bounds.width : entry.bounds.height), 0);
    const gap = (span - occupied) / (entries.length - 1);
    let cursor = distribution === "horizontal" ? first.x : first.y;
    return entries.flatMap(({ element, bounds }, index) => {
        const size = distribution === "horizontal" ? bounds.width : bounds.height;
        const delta = index === 0 || index === entries.length - 1 ? 0 : cursor - (distribution === "horizontal" ? bounds.x : bounds.y);
        cursor += size + gap;
        if (!delta) return [];
        return [
            {
                opId: `op-${createId()}`,
                type: "update-transform" as const,
                elementId: element.id,
                transform: { ...element.transform, x: round(element.transform.x + (distribution === "horizontal" ? delta : 0)), y: round(element.transform.y + (distribution === "vertical" ? delta : 0)) },
            },
        ];
    });
}

export function reorderDesignElements(document: DesignDocument, ids: string[], direction: DesignLayerReorder, createId: () => string): Extract<DesignOperation, { type: "reorder-elements" }> | null {
    const elements = validEditableElementGroup(document, ids);
    if (!elements.length) return null;
    const layer = document.layers.find((candidate) => candidate.elementIds.includes(elements[0].id));
    if (!layer) return null;
    const lockedIds = new Set(document.elements.filter((element) => element.locked).map((element) => element.id));
    const movable = layer.elementIds.filter((id) => !lockedIds.has(id));
    const selected = new Set(ids);
    let next = [...movable];
    if (direction === "front" || direction === "back") {
        const moving = movable.filter((id) => selected.has(id));
        const resting = movable.filter((id) => !selected.has(id));
        next = direction === "front" ? [...resting, ...moving] : [...moving, ...resting];
    } else if (direction === "forward") {
        for (let index = next.length - 2; index >= 0; index -= 1) if (selected.has(next[index]) && !selected.has(next[index + 1])) [next[index], next[index + 1]] = [next[index + 1], next[index]];
    } else {
        for (let index = 1; index < next.length; index += 1) if (selected.has(next[index]) && !selected.has(next[index - 1])) [next[index], next[index - 1]] = [next[index - 1], next[index]];
    }
    let movableIndex = 0;
    const elementIds = layer.elementIds.map((id) => (lockedIds.has(id) ? id : next[movableIndex++]));
    if (elementIds.every((id, index) => id === layer.elementIds[index])) return null;
    const target: DesignOperationScope = layer.scope === "workspace" ? { scope: "workspace" } : { scope: "frame", frameId: layer.frameId };
    return { opId: `op-${createId()}`, type: "reorder-elements", target, elementIds };
}

export function moveDesignElementsToScope(document: DesignDocument, ids: string[], target: DesignOperationScope, createId: () => string): DesignOperation[] {
    const elements = validEditableElementGroup(document, ids);
    if (!elements.length) return [];
    const targetFrame = target.scope === "frame" ? document.frames.find((frame) => frame.id === target.frameId) : null;
    if (target.scope === "frame" && (!targetFrame || targetFrame.locked)) return [];
    if (elements.every((element) => element.frameId === (targetFrame?.id ?? null))) return [];
    const targetLayer = document.layers.find((layer) => (target.scope === "workspace" ? layer.scope === "workspace" : layer.scope === "frame" && layer.frameId === target.frameId));
    if (!targetLayer) return [];
    const operations: DesignOperation[] = [{ opId: `op-${createId()}`, type: "move-elements", elementIds: elements.map((element) => element.id), target, index: targetLayer.elementIds.length }];
    for (const element of elements) {
        const sourceFrame = element.frameId ? document.frames.find((frame) => frame.id === element.frameId) : null;
        const sceneX = element.transform.x + (sourceFrame?.x ?? 0);
        const sceneY = element.transform.y + (sourceFrame?.y ?? 0);
        operations.push({ opId: `op-${createId()}`, type: "update-transform", elementId: element.id, transform: { ...element.transform, x: round(sceneX - (targetFrame?.x ?? 0)), y: round(sceneY - (targetFrame?.y ?? 0)) } });
    }
    return operations;
}

function targetFrame(document: DesignDocument, selection: DesignEditorSelection) {
    if (selection?.kind === "frame") {
        const selected = document.frames.find((frame) => frame.id === selection.id && !frame.locked);
        if (selected) return selected;
    }
    if (selection?.kind === "elements" && selection.ids.length) {
        const frameId = document.elements.find((element) => element.id === selection.ids[0])?.frameId;
        const selected = frameId ? document.frames.find((frame) => frame.id === frameId && !frame.locked) : null;
        if (selected) return selected;
    }
    return document.frames.find((frame) => !frame.locked) ?? null;
}

function elementSize(kind: DesignCreatableElementKind) {
    if (kind === "text") return { width: 480, height: 120 };
    if (kind === "rectangle") return { width: 320, height: 220 };
    if (kind === "ellipse") return { width: 260, height: 260 };
    if (kind === "line") return { width: 360, height: 1 };
    return { width: 360, height: 120 };
}

function elementName(kind: DesignCreatableElementKind, sequence: number) {
    const labels: Record<DesignCreatableElementKind, string> = { text: "文字", rectangle: "矩形", ellipse: "椭圆", line: "线条", arrow: "箭头" };
    return `${labels[kind]} ${sequence}`;
}

function round(value: number) {
    return Math.round(value * 1000) / 1000;
}

function validEditableElementGroup(document: DesignDocument, ids: string[]) {
    const selection = validDesignEditorSelection(document, { kind: "elements", ids });
    if (selection?.kind !== "elements") return [];
    const elements = selectedDesignElements(document, selection);
    return elements.some((element) => element.locked) ? [] : elements;
}

function frameBounds(document: DesignDocument, frameId: string | null): DesignRect | null {
    if (!frameId) return null;
    const frame = document.frames.find((candidate) => candidate.id === frameId);
    return frame ? { x: 0, y: 0, width: frame.width, height: frame.height } : null;
}

function unionBounds(bounds: DesignRect[]): DesignRect {
    const x = Math.min(...bounds.map((item) => item.x));
    const y = Math.min(...bounds.map((item) => item.y));
    const right = Math.max(...bounds.map((item) => item.x + item.width));
    const bottom = Math.max(...bounds.map((item) => item.y + item.height));
    return { x, y, width: right - x, height: bottom - y };
}

function alignmentDelta(bounds: DesignRect, target: DesignRect, alignment: DesignAlignment) {
    if (alignment === "left") return { x: target.x - bounds.x, y: 0 };
    if (alignment === "horizontal-center") return { x: target.x + target.width / 2 - (bounds.x + bounds.width / 2), y: 0 };
    if (alignment === "right") return { x: target.x + target.width - (bounds.x + bounds.width), y: 0 };
    if (alignment === "top") return { x: 0, y: target.y - bounds.y };
    if (alignment === "vertical-center") return { x: 0, y: target.y + target.height / 2 - (bounds.y + bounds.height / 2) };
    return { x: 0, y: target.y + target.height - (bounds.y + bounds.height) };
}
