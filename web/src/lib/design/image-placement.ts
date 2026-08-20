import type { DesignOperationScope } from "./operations";
import type { DesignDocument, DesignPoint } from "./schema";

const DEFAULT_MAX_EDGE = 640;
const FRAME_INSET_RATIO = 0.9;

export type DesignImagePlacement = Readonly<{
    target: DesignOperationScope;
    position: DesignPoint;
    displaySize: Readonly<{ width: number; height: number }>;
}>;

export type DesignImagePlacementSelection = Readonly<{ kind: "frame"; id: string } | { kind: "elements"; ids: readonly string[] }> | null;

export function resolveDesignImagePlacement(document: DesignDocument, selection: DesignImagePlacementSelection, sceneCenter: DesignPoint, naturalSize: Readonly<{ width: number; height: number }>): DesignImagePlacement {
    const frame = selectedFrame(document, selection);
    const maxWidth = frame ? Math.min(DEFAULT_MAX_EDGE, frame.width * FRAME_INSET_RATIO) : DEFAULT_MAX_EDGE;
    const maxHeight = frame ? Math.min(DEFAULT_MAX_EDGE, frame.height * FRAME_INSET_RATIO) : DEFAULT_MAX_EDGE;
    const displaySize = fitImageSize(naturalSize.width, naturalSize.height, maxWidth, maxHeight);
    const center = frame ? { x: frame.width / 2, y: frame.height / 2 } : sceneCenter;

    return {
        target: frame ? { scope: "frame", frameId: frame.id } : { scope: "workspace" },
        position: { x: round(center.x - displaySize.width / 2), y: round(center.y - displaySize.height / 2) },
        displaySize,
    };
}

export function fitImageSize(width: number, height: number, maxWidth = DEFAULT_MAX_EDGE, maxHeight = DEFAULT_MAX_EDGE) {
    const safeWidth = positive(width, "width");
    const safeHeight = positive(height, "height");
    const widthLimit = positive(maxWidth, "maxWidth");
    const heightLimit = positive(maxHeight, "maxHeight");
    const scale = Math.min(1, widthLimit / safeWidth, heightLimit / safeHeight);
    return Object.freeze({ width: round(safeWidth * scale), height: round(safeHeight * scale) });
}

function selectedFrame(document: DesignDocument, selection: DesignImagePlacementSelection) {
    if (selection?.kind === "frame") return document.frames.find((frame) => frame.id === selection.id) ?? null;
    if (selection?.kind !== "elements" || !selection.ids.length) return null;
    const elements = selection.ids.map((id) => document.elements.find((element) => element.id === id));
    if (elements.some((element) => !element)) return null;
    const frameId = elements[0]?.frameId ?? null;
    if (!frameId || elements.some((element) => element?.frameId !== frameId)) return null;
    return document.frames.find((frame) => frame.id === frameId) ?? null;
}

function positive(value: number, field: string) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${field} 必须是正数`);
    return value;
}

function round(value: number) {
    return Math.round(value * 1000) / 1000;
}
