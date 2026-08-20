import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

import { CanvasNodeType, isCanvasImageNodeType, type CanvasGenerationMode, type CanvasNodeData } from "../types";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";
import { buildCanvasNodeConfig } from "../utils/canvas-node-config";
import { PANORAMA_IMAGE_SIZE } from "../utils/canvas-panorama";

export function canvasNodeGenerationMode(type: CanvasNodeData["type"]): CanvasGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

export function canvasNodeGenerationConfig(globalConfig: AiConfig, node: CanvasNodeData, mode = canvasNodeGenerationMode(node.type)): AiConfig {
    const defaultModel = mode === "image" ? globalConfig.imageModel : mode === "video" ? globalConfig.videoModel : mode === "audio" ? globalConfig.audioModel : globalConfig.textModel;
    const model = node.metadata?.model || defaultModel || (mode === "audio" ? defaultConfig.audioModel : globalConfig.model || defaultConfig.model);
    const config = buildCanvasNodeConfig(globalConfig, node, mode, model);
    return node.type === CanvasNodeType.Panorama ? { ...config, size: PANORAMA_IMAGE_SIZE } : config;
}

export function canvasGenerationPlaceholder(node: CanvasNodeData, mode = canvasNodeGenerationMode(node.type)) {
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = isCanvasImageNodeType(node.type) && Boolean(node.metadata?.content);
    if (mode === "video") return "描述要生成的视频内容，或引用首尾帧素材";
    if (mode === "audio") return "描述要生成的音频内容";
    if (node.type === CanvasNodeType.Panorama) return hasImageContent ? "描述如何调整这个全景环境" : "描述要生成的 360° 全景环境";
    if (mode === "image") return hasImageContent ? "描述要如何修改这张图" : "描述要生成的图片内容";
    return hasTextContent ? "描述要如何修改这段文本" : "描述要生成的文本内容";
}

export function canvasGenerationModeLabel(mode: CanvasGenerationMode) {
    return mode === "image" ? "图片" : mode === "video" ? "视频" : mode === "audio" ? "音频" : "文本";
}

export function canvasComposerReference(reference: CanvasResourceReference): ReferenceImage {
    return {
        id: reference.nodeId,
        name: reference.title || reference.label,
        type: reference.kind === "image" ? "image/*" : reference.kind === "video" ? "video/*" : reference.kind === "audio" ? "audio/*" : "text/plain",
        dataUrl: reference.previewUrl || "",
        previewUrl: reference.previewUrl,
    };
}

export function isCanvasComposerNode(node: CanvasNodeData | null | undefined): node is CanvasNodeData {
    return Boolean(node && [CanvasNodeType.Image, CanvasNodeType.Panorama, CanvasNodeType.Text, CanvasNodeType.Video, CanvasNodeType.Audio].includes(node.type));
}
