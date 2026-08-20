import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../types";
import { canvasHandoffSelectionIds, isCanvasHandoffNode } from "./canvas-handoff-selection";

function node(id: string, type: CanvasNodeType): CanvasNodeData {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { storageKey: `permanent/${id}.png` } };
}

describe("Canvas Handoff selection projection", () => {
    it("accepts image, panorama and drawing nodes only", () => {
        expect([CanvasNodeType.Image, CanvasNodeType.Panorama, CanvasNodeType.Drawing].map((type) => isCanvasHandoffNode(node(type, type)))).toEqual([true, true, true]);
        expect(isCanvasHandoffNode(node("text", CanvasNodeType.Text))).toBe(false);
        expect(isCanvasHandoffNode(node("video", CanvasNodeType.Video))).toBe(false);
    });

    it("rejects blank and temporary visual nodes before opening the dialog", () => {
        expect(isCanvasHandoffNode({ ...node("blank", CanvasNodeType.Image), metadata: {} })).toBe(false);
        expect(isCanvasHandoffNode({ ...node("temporary", CanvasNodeType.Image), metadata: { storageKey: "temporary/image.png" } })).toBe(false);
        expect(isCanvasHandoffNode({ ...node("legacy", CanvasNodeType.Drawing), metadata: { drawingPreview: { storageKey: "", serverUrl: "/api/reference-assets/permanent/drawings/a%20b.webp", mimeType: "image/webp", width: 100, height: 100 } } })).toBe(
            true,
        );
    });

    it("filters mixed and stale selections before creating a handoff request", () => {
        const nodes = [node("image", CanvasNodeType.Image), node("drawing", CanvasNodeType.Drawing), node("text", CanvasNodeType.Text), node("video", CanvasNodeType.Video)];
        expect(canvasHandoffSelectionIds(nodes, ["text", "image", "missing", "video", "drawing"])).toEqual(["image", "drawing"]);
        expect(canvasHandoffSelectionIds(nodes, ["text", "video"])).toEqual([]);
    });
});
