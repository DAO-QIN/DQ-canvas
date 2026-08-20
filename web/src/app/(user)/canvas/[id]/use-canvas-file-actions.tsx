"use client";

import dynamic from "next/dynamic";
import { nanoid } from "nanoid";
import { useCallback, useEffect } from "react";

import { uploadMediaFile } from "@/services/file-storage";
import { NODE_DEFAULT_SIZE } from "../constants";
import { CanvasNodeType, type CanvasNodeData, type Position } from "../types";
import { fitNodeSize } from "../utils/canvas-node-size";

const CanvasAssistantPanel = dynamic(() => import("../components/canvas-assistant-panel").then((mod) => mod.CanvasAssistantPanel), { ssr: false });
const loadAssetPickerModal = () => import("../components/asset-picker-modal").then((mod) => mod.AssetPickerModal);
const AssetPickerModal = dynamic(loadAssetPickerModal, { ssr: false, loading: () => null });

import { NODE_STATUS_SUCCESS, VIDEO_NODE_MAX_HEIGHT, VIDEO_NODE_MAX_WIDTH, createCanvasNode } from "./canvas-page-elements";
import { audioMetadata, imageMetadata, uploadCanvasImage, videoMetadata } from "./canvas-page-utils";

import type { CanvasInteractions } from "./use-canvas-interactions";
import type { CanvasPageState } from "./use-canvas-page-state";

export function useCanvasFileActions({ state, interactions }: { state: CanvasPageState; interactions: CanvasInteractions }) {
    const {
        message,
        setNodes,
        setConnections,
        size,
        setSelectedNodeIds,
        selectedConnectionId,
        setSelectedConnectionId,
        setHoveredNodeId,
        setPendingConnectionCreate,
        setSelectionBox,
        setContextMenu,
        setToolbarNodeId,
        setDialogNodeId,
        setEditingNodeId,
        setInfoNodeId,
        setCropNodeId,
        setMaskEditNodeId,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
    } = state;
    const { getCanvasCenter, setConnecting, deleteNodes, deleteConnection, copySelectedNodes, pasteCopiedNodes, undoCanvas, redoCanvas } = interactions;

    const createImageFileNode = useCallback(async (file: File, position: Position, preserveSelection = false) => {
        const image = await uploadCanvasImage(file);
        const size = fitNodeSize(image.width, image.height);
        const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const newNode: CanvasNodeData = {
            id,
            type: CanvasNodeType.Image,
            title: file.name,
            position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
            width: size.width,
            height: size.height,
            metadata: imageMetadata(image),
        };

        setNodes((prev) => [...prev, newNode]);
        setSelectedNodeIds((current) => (preserveSelection ? new Set([...current, id]) : new Set([id])));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
        return id;
    }, []);

    const createVideoFileNode = useCallback(async (file: File, position: Position) => {
        const video = await uploadMediaFile(file, "video");
        const size = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
        const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Video,
                title: file.name,
                position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
                width: size.width,
                height: size.height,
                metadata: videoMetadata(video),
            },
        ]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const createAudioFileNode = useCallback(async (file: File, position: Position) => {
        const audio = await uploadMediaFile(file, "audio");
        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
        const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Audio,
                title: file.name,
                position: { x: position.x - spec.width / 2, y: position.y - spec.height / 2 },
                width: spec.width,
                height: spec.height,
                metadata: audioMetadata(audio),
            },
        ]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
    }, []);

    const createReferenceMediaNodes = useCallback(
        async (targetNodeId: string, files: File[]) => {
            const accepted = files.filter(isComposerReferenceFile).slice(0, 20);
            if (!accepted.length) return;
            const uploaded = await Promise.all(
                accepted.map(async (file) => (file.type.startsWith("video/") ? ({ kind: "video", file, media: await uploadMediaFile(file, "video") } as const) : ({ kind: "image", file, media: await uploadCanvasImage(file) } as const))),
            );
            const target = nodesRef.current.find((node) => node.id === targetNodeId);
            if (!target) {
                message.warning("目标节点已不存在，参考素材未添加");
                return;
            }
            const existingCount = connectionsRef.current.filter((connection) => connection.toNodeId === targetNodeId).length;
            const referenceNodes = uploaded.map(({ file, kind, media }, index) => {
                const fitted = fitNodeSize(media.width || 1280, media.height || 720, kind === "video" ? VIDEO_NODE_MAX_WIDTH : undefined, kind === "video" ? VIDEO_NODE_MAX_HEIGHT : undefined);
                const column = Math.floor((existingCount + index) / 3);
                const row = (existingCount + index) % 3;
                const id = `${kind}-${Date.now()}-${nanoid(7)}`;
                return {
                    id,
                    type: kind === "video" ? CanvasNodeType.Video : CanvasNodeType.Image,
                    title: file.name,
                    position: {
                        x: target.position.x - fitted.width - 96 - column * (fitted.width + 36),
                        y: target.position.y + row * (fitted.height + 36),
                    },
                    width: fitted.width,
                    height: fitted.height,
                    metadata: kind === "video" ? videoMetadata(media) : imageMetadata(media),
                } satisfies CanvasNodeData;
            });
            const nextConnections = referenceNodes.map((node) => ({ id: nanoid(), fromNodeId: node.id, toNodeId: targetNodeId }));
            nodesRef.current = [...nodesRef.current, ...referenceNodes];
            connectionsRef.current = [...connectionsRef.current, ...nextConnections];
            setNodes(nodesRef.current);
            setConnections(connectionsRef.current);
            message.success(referenceNodes.length === 1 ? "参考素材已连接到当前节点" : `${referenceNodes.length} 个参考素材已连接到当前节点`);
        },
        [connectionsRef, message, nodesRef, setConnections, setNodes],
    );

    const createTextNodeFromClipboard = useCallback(
        (text: string) => {
            const trimmed = text.trim();
            if (!trimmed) return false;

            const node = {
                ...createCanvasNode(CanvasNodeType.Text, getCanvasCenter(), { content: trimmed, status: NODE_STATUS_SUCCESS }),
                title: trimmed.slice(0, 32) || "剪切板文本",
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
            setContextMenu(null);
            setDialogNodeId(node.id);
            return true;
        },
        [getCanvasCenter],
    );

    const pasteSystemClipboard = useCallback(async () => {
        if (!navigator.clipboard) return;

        const items = await navigator.clipboard.read();
        const imageItem = items.find((item) => item.types.some((type) => type.startsWith("image/")));
        if (imageItem) {
            const imageType = imageItem.types.find((type) => type.startsWith("image/"));
            if (!imageType) return;
            const blob = await imageItem.getType(imageType);
            const file = new File([blob], "clipboard-image.png", { type: imageType });
            void createImageFileNode(file, getCanvasCenter());
            message.success("已从剪切板添加图片");
            return;
        }

        const text = await navigator.clipboard.readText();
        if (createTextNodeFromClipboard(text)) message.success("已从剪切板添加文本");
    }, [createImageFileNode, createTextNodeFromClipboard, getCanvasCenter, message]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("[contenteditable='true'],[data-canvas-no-zoom]")) return;

            const key = event.key.toLowerCase();
            const isModifierShortcut = event.metaKey || event.ctrlKey;

            if (isModifierShortcut && !event.altKey && key === "z") {
                event.preventDefault();
                if (event.shiftKey) redoCanvas();
                else undoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "y") {
                event.preventDefault();
                redoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "a") {
                event.preventDefault();
                setSelectedNodeIds(new Set(nodesRef.current.map((node) => node.id)));
                setSelectedConnectionId(null);
                setContextMenu(null);
                setSelectionBox(null);
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "c") {
                event.preventDefault();
                copySelectedNodes();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "v") {
                event.preventDefault();
                if (!pasteCopiedNodes()) void pasteSystemClipboard();
                return;
            }

            if (event.key === "Delete" || event.key === "Backspace") {
                if (selectedNodeIdsRef.current.size) {
                    deleteNodes(new Set(selectedNodeIdsRef.current));
                } else if (selectedConnectionId) {
                    deleteConnection(selectedConnectionId);
                }
            }

            if (event.key === "Escape") {
                setSelectedNodeIds(new Set());
                setSelectedConnectionId(null);
                setContextMenu(null);
                setSelectionBox(null);
                setConnecting(null);
                setHoveredNodeId(null);
                setToolbarNodeId(null);
                setDialogNodeId(null);
                setEditingNodeId(null);
                setInfoNodeId(null);
                setCropNodeId(null);
                setMaskEditNodeId(null);
                setPendingConnectionCreate(null);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [copySelectedNodes, deleteConnection, deleteNodes, pasteCopiedNodes, pasteSystemClipboard, redoCanvas, selectedConnectionId, setConnecting, undoCanvas]);
    return {
        createImageFileNode,
        createVideoFileNode,
        createAudioFileNode,
        createReferenceMediaNodes,
        createTextNodeFromClipboard,
        pasteSystemClipboard,
    };
}

export type CanvasFileActions = ReturnType<typeof useCanvasFileActions>;

function isComposerReferenceFile(file: File) {
    return /^image\/(?:png|jpeg|webp)$/i.test(file.type) || /^video\/(?:mp4|webm|quicktime)$/i.test(file.type);
}
