export type WorkspaceRect = Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
}>;

export type WorkspaceFloatingSide = "top" | "bottom";

export type WorkspaceFloatingPlacement = Readonly<{
    x: number;
    y: number;
    side: WorkspaceFloatingSide;
    availableWidth: number;
    availableHeight: number;
}>;

export type WorkspaceFloatingPlacementInput = Readonly<{
    anchor: WorkspaceRect;
    viewport: WorkspaceRect;
    floatingSize: Readonly<{ width: number; height: number }>;
    preferredSide?: WorkspaceFloatingSide;
    gap?: number;
    margin?: number;
}>;

/**
 * Positions a surface-neutral floating control around a client-space anchor.
 * The preferred side is used while it fits, then flipped, then clamped as a
 * last resort. All returned coordinates share the viewport's coordinate space.
 */
export function resolveWorkspaceFloatingPlacement({
    anchor: rawAnchor,
    viewport: rawViewport,
    floatingSize: rawFloatingSize,
    preferredSide = "bottom",
    gap: rawGap = 12,
    margin: rawMargin = 12,
}: WorkspaceFloatingPlacementInput): WorkspaceFloatingPlacement {
    const viewport = normalizedRect(rawViewport);
    const anchor = normalizedRect(rawAnchor);
    const margin = clamp(finite(rawMargin, 12), 0, Math.max(0, Math.min(viewport.width, viewport.height) / 2));
    const gap = Math.max(0, finite(rawGap, 12));
    const availableWidth = Math.max(0, viewport.width - margin * 2);
    const width = Math.min(Math.max(0, finite(rawFloatingSize.width, 0)), availableWidth);
    const requestedHeight = Math.max(0, finite(rawFloatingSize.height, 0));
    const topSpace = Math.max(0, anchor.y - gap - (viewport.y + margin));
    const bottomSpace = Math.max(0, viewport.y + viewport.height - margin - (anchor.y + anchor.height + gap));
    const alternateSide = preferredSide === "top" ? "bottom" : "top";
    const preferredSpace = preferredSide === "top" ? topSpace : bottomSpace;
    const alternateSpace = alternateSide === "top" ? topSpace : bottomSpace;
    const side = preferredSpace >= requestedHeight ? preferredSide : alternateSpace >= requestedHeight ? alternateSide : topSpace > bottomSpace ? "top" : "bottom";
    const availableHeight = side === "top" ? topSpace : bottomSpace;
    const height = Math.min(requestedHeight, Math.max(0, viewport.height - margin * 2));
    const centeredX = anchor.x + anchor.width / 2 - width / 2;
    const x = clamp(centeredX, viewport.x + margin, viewport.x + viewport.width - margin - width);
    const preferredY = side === "top" ? anchor.y - gap - height : anchor.y + anchor.height + gap;
    const y = clamp(preferredY, viewport.y + margin, viewport.y + viewport.height - margin - height);

    return Object.freeze({ x: round(x), y: round(y), side, availableWidth: round(availableWidth), availableHeight: round(availableHeight) });
}

function normalizedRect(rect: WorkspaceRect): WorkspaceRect {
    return {
        x: finite(rect.x, 0),
        y: finite(rect.y, 0),
        width: Math.max(0, finite(rect.width, 0)),
        height: Math.max(0, finite(rect.height, 0)),
    };
}

function finite(value: number, fallback: number) {
    return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(min, value), Math.max(min, max));
}

function round(value: number) {
    return Math.round(value * 1000) / 1000;
}
