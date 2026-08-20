import type { DesignDocument } from "@/lib/design";

import type { DesignEditorSelection } from "./design-editor-commands";

/** Frames are transferable only when their own layer contains an image. */
export function designHandoffSelectionIds(document: DesignDocument, selection: DesignEditorSelection) {
    if (!selection) return [];
    if (selection.kind === "frame") {
        const frameLayer = document.layers.find((layer) => layer.scope === "frame" && layer.frameId === selection.id);
        const imageIds = new Set(document.elements.filter((element) => element.kind === "image").map((element) => element.id));
        return frameLayer?.elementIds.some((id) => imageIds.has(id)) ? [selection.id] : [];
    }
    const imageIds = new Set(document.elements.filter((element) => element.kind === "image").map((element) => element.id));
    return selection.ids.filter((id) => imageIds.has(id));
}
