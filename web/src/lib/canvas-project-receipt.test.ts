import { describe, expect, it } from "vitest";

import type { CanvasProject } from "./canvas-project-contract";
import { canvasSaveFingerprint, stableCanvasProjectSnapshot } from "./canvas-project-receipt";

describe("Canvas save fingerprint", () => {
    it("matches the JSON-transmitted shape when optional values are undefined", () => {
        const project: CanvasProject = {
            id: "canvas-one",
            title: "Test",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            nodes: [{ id: "image-one", type: "image", title: "Image", position: { x: 0, y: 0 }, width: 10, height: 10, metadata: { storageKey: "permanent/image.png", remoteUrl: undefined } } as CanvasProject["nodes"][number]],
            connections: [],
            chatSessions: [],
            activeChatId: null,
            backgroundMode: "lines" as const,
            showImageInfo: false,
            viewport: { x: 0, y: 0, k: 1 },
        };

        const transmitted = JSON.parse(JSON.stringify(project));
        expect(canvasSaveFingerprint(project, 0)).toBe(canvasSaveFingerprint(transmitted, 0));
        expect(stableCanvasProjectSnapshot(project, 0)).toBe(stableCanvasProjectSnapshot(transmitted, 0));
    });
});
