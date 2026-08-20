"use client";

import { App } from "antd";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CreativeAsset } from "@/lib/creative-runtime-contract";
import { generationErrorMessage } from "@/lib/generation-error";
import { appStorageKey } from "@/lib/storage-keys";
import { cancelImageGenerationTask, createImageGenerationTask, waitForImageGenerationTask } from "@/services/api/image";
import { cancelTextGenerationTask, createTextGenerationTask, waitForTextGenerationTask } from "@/services/api/text";
import { cancelServerVideoGenerationTask, createServerVideoGenerationTask, storeGeneratedVideo, waitForVideoGenerationTask } from "@/services/api/video";
import { imageToDataUrl, uploadImage } from "@/services/image-storage";
import type { AiConfig } from "@/stores/use-config-store";
import type { AiTextMessage } from "@/types/ai";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

import type { DirectCreationMode } from "./creation-mode";

export type DirectVideoMethod = "auto" | "text" | "reference";
export type DirectCreationStatus = "pending" | "completed" | "failed" | "cancelled";

type DirectTask =
    | { kind: "text"; id: string; model: string }
    | { kind: "image"; id: string; model: string; taskKind: "generation" | "edit" }
    | { kind: "video"; id: string; model: string; provider: "openai" | "seedance" | "generation"; pollPath?: string; resultUrl?: string; serverTaskId?: string; durationSeconds?: number };

export type DirectCreationSettings = {
    size: string;
    quality: string;
    count: string;
    videoSeconds: string;
    videoQuality: string;
    videoCount: number;
    videoMethod: DirectVideoMethod;
};

export type DirectCreationMessage = {
    id: string;
    role: "user" | "assistant";
    mode: DirectCreationMode;
    content: string;
    createdAt: number;
    status: DirectCreationStatus;
    model: string;
    skillIds?: string[];
    assets?: CreativeAsset[];
    resultUrls?: string[];
    error?: string;
    tasks?: DirectTask[];
    settings: DirectCreationSettings;
};

type Submission = {
    mode: DirectCreationMode;
    prompt: string;
    assets: CreativeAsset[];
    videoCount: number;
    videoMethod: DirectVideoMethod;
    skillIds: string[];
};

type TaskStartResult = {
    tasks: DirectTask[];
    warning?: string;
};

export function useDirectCreation(config: AiConfig, ownerId?: string) {
    const { message: notice } = App.useApp();
    const [messages, setMessages] = useState<DirectCreationMessage[]>([]);
    const [hydrated, setHydrated] = useState(false);
    const [busy, setBusy] = useState(false);
    const controllerRef = useRef<AbortController | null>(null);
    const activeTasksRef = useRef<DirectTask[]>([]);
    const recoveringRef = useRef(new Set<string>());
    const storageKey = appStorageKey(`create_direct_thread:${ownerId || "anonymous"}`);

    useEffect(() => {
        setHydrated(false);
        recoveringRef.current.clear();
        try {
            const stored = window.localStorage.getItem(storageKey);
            const parsed = stored ? (JSON.parse(stored) as unknown) : [];
            setMessages(normalizeStoredMessages(parsed));
        } catch {
            setMessages([]);
        } finally {
            setHydrated(true);
        }
    }, [storageKey]);

    useEffect(() => {
        if (!hydrated) return;
        window.localStorage.setItem(storageKey, JSON.stringify(messages.slice(-80)));
    }, [hydrated, messages, storageKey]);

    const finishMessage = useCallback((id: string, patch: Partial<DirectCreationMessage>) => {
        setMessages((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    }, []);

    const runExistingTasks = useCallback(
        async (assistant: DirectCreationMessage, controller: AbortController) => {
            const tasks = assistant.tasks || [];
            const requestConfig = configForMessage(config, assistant);
            if (!tasks.length) throw new Error("任务创建状态未保存，请到对应工作台的生成记录中查看结果");
            activeTasksRef.current = tasks;
            if (assistant.mode === "text") {
                const task = tasks.find((item): item is Extract<DirectTask, { kind: "text" }> => item.kind === "text");
                if (!task) throw new Error("文本任务信息不完整");
                const content = await waitForTextGenerationTask(requestConfig, task, { signal: controller.signal });
                finishMessage(assistant.id, { content: content || "文本生成完成", status: "completed", error: undefined });
                return;
            }
            if (assistant.mode === "image") {
                const imageTasks = tasks.filter((item): item is Extract<DirectTask, { kind: "image" }> => item.kind === "image");
                const settled = await Promise.allSettled(
                    imageTasks.map(async (task) => {
                        const result = await waitForImageGenerationTask(requestConfig, { id: task.id, model: task.model, kind: task.taskKind }, { signal: controller.signal });
                        const stable = result.serverUrl || result.remoteUrl;
                        if (stable) return stable;
                        return (await uploadImage(result.dataUrl)).url;
                    }),
                );
                const resultUrls = settled.flatMap((item) => (item.status === "fulfilled" ? [item.value] : []));
                const failure = settled.find((item): item is PromiseRejectedResult => item.status === "rejected");
                if (!resultUrls.length) throw failure?.reason || new Error("图片任务没有返回结果");
                finishMessage(assistant.id, {
                    content: failure ? `${resultUrls.length} 张图片已生成，部分任务失败` : `${resultUrls.length} 张图片已生成`,
                    status: "completed",
                    resultUrls,
                    error: failure ? generationErrorMessage(failure.reason) : undefined,
                });
                return;
            }

            const videoTasks = tasks.filter((item): item is Extract<DirectTask, { kind: "video" }> => item.kind === "video");
            const settled = await Promise.allSettled(
                videoTasks.map(async (task) => {
                    const result = await waitForVideoGenerationTask(requestConfig, task, { signal: controller.signal });
                    return (await storeGeneratedVideo(result)).url;
                }),
            );
            const resultUrls = settled.flatMap((item) => (item.status === "fulfilled" && item.value ? [item.value] : []));
            const failure = settled.find((item): item is PromiseRejectedResult => item.status === "rejected");
            if (!resultUrls.length) throw failure?.reason || new Error("视频任务没有返回结果");
            finishMessage(assistant.id, {
                content: failure ? `${resultUrls.length} 个视频已生成，部分任务失败` : `${resultUrls.length} 个视频已生成`,
                status: "completed",
                resultUrls,
                error: failure ? generationErrorMessage(failure.reason) : undefined,
            });
        },
        [config, finishMessage],
    );

    const runMessage = useCallback(
        async (assistant: DirectCreationMessage, controller: AbortController, start?: (recordTask: (task: DirectTask) => void) => Promise<TaskStartResult>) => {
            setBusy(true);
            controllerRef.current = controller;
            try {
                let creationWarning: string | undefined;
                if (start) {
                    const started = await start((task) => {
                        activeTasksRef.current = [...activeTasksRef.current, task];
                        finishMessage(assistant.id, { tasks: activeTasksRef.current });
                    });
                    const { tasks } = started;
                    creationWarning = started.warning;
                    activeTasksRef.current = tasks;
                    assistant = { ...assistant, tasks };
                    finishMessage(assistant.id, { tasks });
                }
                await runExistingTasks(assistant, controller);
                if (creationWarning) finishMessage(assistant.id, { error: creationWarning });
                notice.success(assistant.mode === "text" ? "文本已生成" : assistant.mode === "image" ? "图片已生成" : "视频已生成");
            } catch (error) {
                if (controller.signal.aborted) finishMessage(assistant.id, { content: "已停止", status: "cancelled", error: undefined });
                else finishMessage(assistant.id, { content: "生成失败", status: "failed", error: generationErrorMessage(error) });
            } finally {
                if (controllerRef.current === controller) controllerRef.current = null;
                activeTasksRef.current = [];
                recoveringRef.current.delete(assistant.id);
                setBusy(false);
            }
        },
        [finishMessage, notice, runExistingTasks],
    );

    useEffect(() => {
        if (!hydrated || busy) return;
        const pending = messages.find((item) => item.role === "assistant" && item.status === "pending" && !recoveringRef.current.has(item.id));
        if (!pending) return;
        recoveringRef.current.add(pending.id);
        const controller = new AbortController();
        void runMessage(pending, controller);
    }, [busy, hydrated, messages, runMessage]);

    const submit = useCallback(
        (input: Submission) => {
            const prompt = input.prompt.trim();
            if (!prompt || busy) return false;
            const model = input.mode === "text" ? config.textModel : input.mode === "image" ? config.imageModel : config.videoModel;
            if (!model) {
                notice.warning(`当前没有可用的${input.mode === "text" ? "文本" : input.mode === "image" ? "图片" : "视频"}模型，请联系管理员配置`);
                return false;
            }
            const usableAssets = assetsForMode(input.mode, input.assets, input.videoMethod);
            if (input.mode === "video" && input.videoMethod === "reference" && !usableAssets.length) {
                notice.warning("参考生成需要先添加图片、视频或音频素材");
                return false;
            }
            const settings = settingsFromConfig(config, input.videoCount, input.videoMethod);
            const requestConfig = configForSettings(config, input.mode, model, settings);
            const userMessage: DirectCreationMessage = {
                id: `direct-user-${nanoid()}`,
                role: "user",
                mode: input.mode,
                content: prompt,
                createdAt: Date.now(),
                status: "completed",
                model,
                skillIds: input.skillIds,
                assets: usableAssets,
                settings,
            };
            const assistant: DirectCreationMessage = {
                id: `direct-assistant-${nanoid()}`,
                role: "assistant",
                mode: input.mode,
                content: "正在创建任务",
                createdAt: Date.now(),
                status: "pending",
                model,
                skillIds: input.skillIds,
                settings,
            };
            const history = [...messages, userMessage];
            setMessages((current) => [...current, userMessage, assistant]);
            recoveringRef.current.add(assistant.id);
            const controller = new AbortController();
            const start = async (recordTask: (task: DirectTask) => void): Promise<TaskStartResult> => {
                if (input.mode === "text") {
                    const textMessages = await buildTextMessages(history, usableAssets, prompt);
                    const task = await createTextGenerationTask(requestConfig, textMessages, { signal: controller.signal, surface: "chat", clientRequestId: assistant.id, skillIds: input.skillIds });
                    const directTask = { kind: "text", id: task.id, model: task.model } satisfies DirectTask;
                    recordTask(directTask);
                    return { tasks: [directTask] };
                }
                if (input.mode === "image") {
                    const references = usableAssets.map(imageReferenceFromAsset);
                    const count = Math.max(1, Math.min(4, Math.floor(Number(settings.count) || 1)));
                    return createTrackedTasks(
                        count,
                        async (index) => {
                            const task = await createImageGenerationTask(requestConfig, prompt, references, undefined, {
                                signal: controller.signal,
                                logSource: "image-workbench",
                                logTitle: prompt.slice(0, 60),
                                surface: "chat",
                                clientRequestId: `${assistant.id}:${index}`,
                                skillIds: input.skillIds,
                            });
                            return { kind: "image", id: task.id, model: task.model, taskKind: task.kind } satisfies DirectTask;
                        },
                        recordTask,
                    );
                }
                const references = usableAssets.filter((asset) => asset.type === "image").map(imageReferenceFromAsset);
                const videoReferences = usableAssets.filter((asset) => asset.type === "video").map(videoReferenceFromAsset);
                const audioReferences = usableAssets.filter((asset) => asset.type === "audio").map(audioReferenceFromAsset);
                return createTrackedTasks(
                    Math.max(1, Math.min(4, input.videoCount)),
                    async (index) => {
                        const task = await createServerVideoGenerationTask(requestConfig, prompt, references, videoReferences, audioReferences, {
                            signal: controller.signal,
                            surface: "chat",
                            source: "video-workbench",
                            clientRequestId: `${assistant.id}:${index}`,
                            skillIds: input.skillIds,
                        });
                        return {
                            kind: "video",
                            id: task.id,
                            model: task.model,
                            provider: task.provider,
                            pollPath: task.pollPath,
                            resultUrl: task.resultUrl,
                            serverTaskId: task.serverTaskId,
                            durationSeconds: task.durationSeconds,
                        } satisfies DirectTask;
                    },
                    recordTask,
                );
            };
            void runMessage(assistant, controller, start);
            return true;
        },
        [busy, config, messages, notice, runMessage],
    );

    const cancel = useCallback(async () => {
        const controller = controllerRef.current;
        const tasks = activeTasksRef.current;
        controller?.abort();
        const outcomes = await Promise.allSettled(
            tasks.map((task) => {
                if (task.kind === "text") return cancelTextGenerationTask(task);
                if (task.kind === "image") return cancelImageGenerationTask(task);
                return cancelServerVideoGenerationTask(task);
            }),
        );
        const failure = outcomes.find((item): item is PromiseRejectedResult => item.status === "rejected");
        if (failure) notice.warning(generationErrorMessage(failure.reason));
    }, [notice]);

    return {
        messages,
        busy,
        submit,
        cancel,
        clear: () => setMessages([]),
    };
}

async function createTrackedTasks(count: number, createTask: (index: number) => Promise<DirectTask>, recordTask: (task: DirectTask) => void): Promise<TaskStartResult> {
    const tasks: DirectTask[] = [];
    for (let index = 0; index < count; index += 1) {
        try {
            const task = await createTask(index);
            tasks.push(task);
            recordTask(task);
        } catch (error) {
            if (!tasks.length) throw error;
            return {
                tasks,
                warning: `部分任务创建失败，已继续处理 ${tasks.length} 个已创建任务：${generationErrorMessage(error)}`,
            };
        }
    }
    return { tasks };
}

function settingsFromConfig(config: AiConfig, videoCount: number, videoMethod: DirectVideoMethod): DirectCreationSettings {
    return {
        size: config.size,
        quality: config.quality,
        count: String(Math.max(1, Math.min(4, Math.floor(Number(config.count) || 1)))),
        videoSeconds: config.videoSeconds,
        videoQuality: config.vquality,
        videoCount: Math.max(1, Math.min(4, Math.floor(videoCount) || 1)),
        videoMethod,
    };
}

function configForSettings(config: AiConfig, mode: DirectCreationMode, model: string, settings: DirectCreationSettings): AiConfig {
    return {
        ...config,
        model,
        ...(mode === "text" ? { textModel: model } : {}),
        ...(mode === "image" ? { imageModel: model, size: settings.size, quality: settings.quality, count: "1" } : {}),
        ...(mode === "video" ? { videoModel: model, size: settings.size, vquality: settings.videoQuality, videoSeconds: settings.videoSeconds } : {}),
    };
}

function configForMessage(config: AiConfig, message: DirectCreationMessage) {
    return configForSettings(config, message.mode, message.model, message.settings);
}

function assetsForMode(mode: DirectCreationMode, assets: CreativeAsset[], videoMethod: DirectVideoMethod) {
    if (mode === "text" || mode === "image") return assets.filter((asset) => asset.type === "image" && Boolean(assetUrl(asset)));
    if (videoMethod === "text") return [];
    return assets.filter((asset) => (asset.type === "image" || asset.type === "video" || asset.type === "audio") && Boolean(assetUrl(asset)));
}

async function buildTextMessages(history: DirectCreationMessage[], assets: CreativeAsset[], prompt: string): Promise<AiTextMessage[]> {
    const previous = history
        .slice(0, -1)
        .filter((item) => item.mode === "text" && (item.role === "user" || item.status === "completed"))
        .slice(-10)
        .map((item): AiTextMessage => ({ role: item.role, content: item.content }));
    const images = await Promise.all(assets.filter((asset) => asset.type === "image").map((asset) => imageToDataUrl(imageReferenceFromAsset(asset))));
    return [
        ...previous,
        {
            role: "user",
            content: images.length ? [{ type: "text", text: prompt }, ...images.filter(Boolean).map((url) => ({ type: "image_url" as const, image_url: { url } }))] : prompt,
        },
    ];
}

function imageReferenceFromAsset(asset: CreativeAsset): ReferenceImage {
    const url = assetUrl(asset);
    return {
        id: asset.id,
        name: asset.title || "参考图",
        type: asset.mimeType || "image/png",
        dataUrl: url,
        url,
        remoteUrl: asset.remoteUrl,
        serverUrl: asset.serverUrl,
        storageKey: asset.storageKey,
        width: asset.width,
        height: asset.height,
    };
}

function videoReferenceFromAsset(asset: CreativeAsset): ReferenceVideo {
    return {
        id: asset.id,
        name: asset.title || "参考视频",
        type: asset.mimeType || "video/mp4",
        url: assetUrl(asset),
        storageKey: asset.storageKey,
        bytes: asset.bytes,
        width: asset.width,
        height: asset.height,
        durationMs: asset.durationMs,
    };
}

function audioReferenceFromAsset(asset: CreativeAsset): ReferenceAudio {
    return {
        id: asset.id,
        name: asset.title || "参考音频",
        type: asset.mimeType || "audio/mpeg",
        url: assetUrl(asset),
        storageKey: asset.storageKey,
        durationMs: asset.durationMs,
    };
}

function assetUrl(asset: CreativeAsset) {
    return asset.serverUrl || asset.remoteUrl || "";
}

function normalizeStoredMessages(value: unknown): DirectCreationMessage[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): DirectCreationMessage[] => {
        if (!item || typeof item !== "object") return [];
        const message = item as DirectCreationMessage;
        if (!message.id || (message.role !== "user" && message.role !== "assistant") || !["text", "image", "video"].includes(message.mode)) return [];
        return [{ ...message, skillIds: Array.isArray(message.skillIds) ? message.skillIds.filter((id): id is string => typeof id === "string").slice(0, 8) : undefined }];
    });
}
