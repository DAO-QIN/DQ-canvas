import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../types";
import { canvasDerivedImageProvenance, canvasDerivedImageSourceMatches } from "./canvas-derived-image";

describe("canvas derived image provenance", () => {
    it("writes structured provenance and legacy source fields from the same source identity", () => {
        const metadata = canvasDerivedImageProvenance(imageNode(), "annotation");
        expect(metadata).toEqual({
            derivedOperation: "annotation",
            sourceNodeId: "source",
            sourceStorageKey: "permanent/source.png",
            derivedImageProvenance: {
                operation: "annotation",
                sourceNodeId: "source",
                sourceStorageKey: "permanent/source.png",
                sourceFingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
            },
        });
        expect(canvasDerivedImageSourceMatches(metadata.derivedImageProvenance!, [imageNode()])).toBe(true);
    });

    it("does not persist a transient content URL as provenance when no stable storage key exists", () => {
        expect(canvasDerivedImageProvenance(imageNode({ storageKey: undefined, content: "blob:transient" }), "crop")).toEqual({
            derivedOperation: "crop",
            sourceNodeId: "source",
            sourceStorageKey: undefined,
            derivedImageProvenance: { operation: "crop", sourceNodeId: "source", sourceFingerprint: expect.stringMatching(/^[a-f0-9]{16}$/) },
        });
    });

    it("rejects a removed or replaced source while accepting an unchanged one", () => {
        const provenance = canvasDerivedImageProvenance(imageNode(), "mask-edit").derivedImageProvenance!;

        expect(canvasDerivedImageSourceMatches(provenance, [])).toBe(false);
        expect(canvasDerivedImageSourceMatches(provenance, [imageNode({ content: "/signed/source.png?token=refreshed" })])).toBe(true);
        expect(canvasDerivedImageSourceMatches(provenance, [imageNode({ storageKey: "permanent/replacement.png" })])).toBe(false);
        expect(canvasDerivedImageSourceMatches(provenance, [imageNode()])).toBe(true);
    });

    it("uses content identity when no stable storage key exists", () => {
        const provenance = canvasDerivedImageProvenance(imageNode({ storageKey: undefined, content: "blob:one" }), "annotation").derivedImageProvenance!;

        expect(canvasDerivedImageSourceMatches(provenance, [imageNode({ storageKey: undefined, content: "blob:one" })])).toBe(true);
        expect(canvasDerivedImageSourceMatches(provenance, [imageNode({ storageKey: undefined, content: "blob:two" })])).toBe(false);
    });
});

function imageNode(metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    return {
        id: "source",
        type: CanvasNodeType.Image,
        title: "Source",
        position: { x: 0, y: 0 },
        width: 320,
        height: 240,
        metadata: { content: "/source.png", storageKey: "permanent/source.png", ...metadata },
    };
}
