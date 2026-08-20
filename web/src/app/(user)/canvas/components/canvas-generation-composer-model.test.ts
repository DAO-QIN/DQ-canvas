import { describe, expect, it } from "vitest";

import { defaultConfig } from "@/stores/use-config-store";

import { CanvasNodeType, type CanvasNodeData } from "../types";
import { canvasComposerReference, canvasGenerationPlaceholder, canvasNodeGenerationConfig, canvasNodeGenerationMode, isCanvasComposerNode } from "./canvas-generation-composer-model";

function node(type: CanvasNodeType, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    return { id: `${type}-1`, type, title: type, position: { x: 0, y: 0 }, width: 320, height: 240, metadata };
}

describe("Canvas workspace generation composer model", () => {
    it.each([
        [CanvasNodeType.Image, "image"],
        [CanvasNodeType.Panorama, "image"],
        [CanvasNodeType.Text, "text"],
        [CanvasNodeType.Video, "video"],
        [CanvasNodeType.Audio, "audio"],
    ] as const)("maps %s nodes to the existing %s generation chain", (type, mode) => {
        expect(canvasNodeGenerationMode(type)).toBe(mode);
        expect(isCanvasComposerNode(node(type))).toBe(true);
    });

    it("keeps non-generation Canvas nodes outside the shared composer", () => {
        expect(isCanvasComposerNode(node(CanvasNodeType.Config))).toBe(false);
        expect(isCanvasComposerNode(node(CanvasNodeType.Drawing))).toBe(false);
        expect(isCanvasComposerNode(node(CanvasNodeType.Brief))).toBe(false);
    });

    it("uses node-local models and parameters without changing the global config", () => {
        const global = {
            ...defaultConfig,
            imageModel: "global-image",
            videoModel: "global-video",
            textModel: "global-text",
            audioModel: "global-audio",
            canvasImageCount: "3",
        };
        const source = node(CanvasNodeType.Video, { model: "node-video", seconds: "10", vquality: "1080", size: "16:9" });

        expect(canvasNodeGenerationConfig(global, source)).toMatchObject({ model: "node-video", videoSeconds: "10", vquality: "1080", size: "16:9" });
        expect(global).toMatchObject({ videoModel: "global-video", videoSeconds: defaultConfig.videoSeconds });
    });

    it("keeps panorama generation fixed to a 2:1 request and exposes edit-aware prompts", () => {
        const global = { ...defaultConfig, imageModel: "image-model", size: "1:1" };
        expect(canvasNodeGenerationConfig(global, node(CanvasNodeType.Panorama))).toMatchObject({ model: "image-model", size: "2048x1024" });
        expect(canvasGenerationPlaceholder(node(CanvasNodeType.Panorama, { content: "/media/panorama.webp" }))).toContain("调整");
        expect(canvasGenerationPlaceholder(node(CanvasNodeType.Image, { content: "/media/source.webp" }))).toContain("修改");
        expect(canvasGenerationPlaceholder(node(CanvasNodeType.Text, { content: "原文" }))).toContain("修改");
    });

    it("projects connected Canvas resources into runtime-only shared previews", () => {
        expect(canvasComposerReference({ id: "resource", nodeId: "image-1", kind: "image", label: "参考图1", title: "来源", previewUrl: "/api/media/source", active: true })).toEqual({
            id: "image-1",
            name: "来源",
            type: "image/*",
            dataUrl: "/api/media/source",
            previewUrl: "/api/media/source",
        });
    });
});
