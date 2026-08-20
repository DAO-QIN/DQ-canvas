"use client";

import { App, Button, Drawer } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { History, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { SiteLogo } from "@/components/layout/site-logo";
import { FirstUseGuide } from "@/components/onboarding/first-use-guide";
import { CREATIVE_UPLOAD_ACCEPT, CREATIVE_UPLOAD_MAX_BYTES, isCreativeUploadMimeType } from "@/lib/creative-upload";
import type { CreateOverviewAsset } from "@/lib/create-workbench-overview";
import type { CreativeAsset } from "@/lib/creative-runtime-contract";
import { useCreativeAgentModels } from "@/hooks/use-creative-agent-options";
import { listAgentSkills, type AgentSkillSummary } from "@/services/api/agent-skills";
import { usePublicSessionStore } from "@/stores/use-public-session-store";
import { useConfigStore } from "@/stores/use-config-store";
import type { PublicGalleryItem } from "@/services/api/work-governance";
import { createAgentPromptFromHash } from "@/lib/create-agent-prompt";

import { CreativeComposer } from "./components/creative-composer";
import { CreativeConversationList } from "./components/creative-conversation-list";
import { DirectCreationMessages } from "./components/direct-creation-messages";
import { CreateInspirationGallery } from "./components/create-inspiration-gallery";
import { CreativeMessages } from "./components/creative-messages";
import { CreateWorkbenchOverview } from "./components/create-workbench-overview";
import { createConversationHref, createConversationIdFromSearch } from "./create-conversation-navigation";
import { creationModeLabels, type CreationMode } from "./creation-mode";
import { useCreateAgent } from "./use-create-agent";
import { useDirectCreation, type DirectCreationMessage, type DirectVideoMethod } from "./use-direct-creation";

export default function CreatePage() {
    const { message } = App.useApp();
    const router = useRouter();
    const inputRef = useRef<TextAreaRef>(null);
    const attachmentInputRef = useRef<HTMLInputElement>(null);
    const initialConversationRestoredRef = useRef(false);
    const initialPromptRestoredRef = useRef(false);
    const [prompt, setPrompt] = useState("");
    const [skills, setSkills] = useState<AgentSkillSummary[]>([]);
    const [skillsLoading, setSkillsLoading] = useState(true);
    const [selectedSkillIds, setSelectedSkillIds] = useState<Partial<Record<CreationMode, string>>>({});
    const [mode, setMode] = useState<CreationMode>("agent");
    const [videoCount, setVideoCount] = useState(1);
    const [videoMethod, setVideoMethod] = useState<DirectVideoMethod>("auto");
    const [directAssets, setDirectAssets] = useState<CreativeAsset[]>([]);
    const [historyOpen, setHistoryOpen] = useState(false);
    const publicSettings = usePublicSessionStore((state) => state.payload?.settings);
    const currentUser = usePublicSessionStore((state) => state.payload?.user);
    const publicSessionReady = usePublicSessionStore((state) => state.ready);
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const site = publicSettings?.site || { title: "DQ-绘图", logoUrl: "/logo.svg" };
    const agent = useCreateAgent();
    const direct = useDirectCreation(config, currentUser?.id);
    const openAgentConversation = agent.openConversation;
    const newAgentConversation = agent.newConversation;
    const hasAgentConversation = agent.messages.length > 0;
    const hasConversation = mode === "agent" ? hasAgentConversation : direct.messages.length > 0;
    const showConversation = hasConversation || (mode === "agent" && agent.conversationLoading);
    const selectedSkillId = selectedSkillIds[mode];
    const selectedSkill = skills.find((skill) => skill.id === selectedSkillId);
    const modelOptions = useCreativeAgentModels().filter((model) => model.capability === "image" || model.capability === "video");
    const missingModels = [!config.textModel ? "默认文本模型" : "", !modelOptions.length ? "至少一个图片或视频模型" : ""].filter(Boolean);

    useEffect(() => {
        let active = true;
        setSkillsLoading(true);
        void listAgentSkills("all")
            .then((items) => {
                if (active) setSkills(items);
            })
            .catch((error) => {
                if (active) {
                    setSkills([]);
                    message.error(error instanceof Error ? error.message : "加载创作 Skill 失败");
                }
            })
            .finally(() => {
                if (active) setSkillsLoading(false);
            });
        return () => {
            active = false;
        };
    }, [message]);

    useEffect(() => {
        if (initialConversationRestoredRef.current) return;
        initialConversationRestoredRef.current = true;
        const conversationId = createConversationIdFromSearch(window.location.search);
        if (!conversationId) return;
        void openAgentConversation(conversationId).catch((error) => {
            message.error(error instanceof Error ? error.message : "恢复对话失败");
            router.replace("/create");
        });
    }, [message, openAgentConversation, router]);

    useEffect(() => {
        if (initialPromptRestoredRef.current) return;
        initialPromptRestoredRef.current = true;
        const incomingPrompt = createAgentPromptFromHash(window.location.hash);
        if (!incomingPrompt) return;
        setPrompt(incomingPrompt);
        router.replace("/create");
        window.requestAnimationFrame(() => inputRef.current?.focus());
        message.success("已填入作品提示词");
    }, [message, router]);

    const openConversation = (id: string) => {
        setMode("agent");
        router.push(createConversationHref(id));
        void openAgentConversation(id).catch((error) => {
            message.error(error instanceof Error ? error.message : "打开对话失败");
            router.replace("/create");
        });
    };

    const newConversation = () => {
        if (mode === "agent") {
            newAgentConversation();
        } else {
            direct.clear();
            setDirectAssets([]);
        }
        setSelectedSkillIds({});
        agent.clearAttachments();
        router.replace("/create");
    };

    const submit = async () => {
        if (!prompt.trim()) {
            message.warning("请先描述你的创作需求");
            inputRef.current?.focus();
            return;
        }
        if (mode !== "agent") {
            if (selectedSkill?.requiresReference && !directAssets.length) {
                message.warning(`Skill「${selectedSkill.name}」需要先添加参考素材`);
                return;
            }
            if (
                direct.submit({
                    mode,
                    prompt,
                    assets: directAssets,
                    videoCount,
                    videoMethod,
                    skillIds: selectedSkillId ? [selectedSkillId] : [],
                })
            ) {
                setPrompt("");
                setDirectAssets([]);
                setSelectedSkillIds((current) => ({ ...current, [mode]: undefined }));
                agent.clearAttachments();
            }
            return;
        }
        if (
            await agent.submit(prompt, {
                skillIds: selectedSkillId ? [selectedSkillId] : [],
            })
        ) {
            setPrompt("");
            setSelectedSkillIds((current) => ({ ...current, agent: undefined }));
            setDirectAssets([]);
            agent.clearAttachments();
        }
    };

    const uploadAttachments = async (files: File[], successMessage?: string) => {
        const unsupported = files.find((file) => !isUploadAllowedForMode(mode, file.type));
        if (unsupported) {
            message.error(`${unsupported.name} 不是${attachmentTypeLabel(mode)}`);
            return false;
        }
        const oversized = files.find((file) => file.size > CREATIVE_UPLOAD_MAX_BYTES);
        if (oversized) {
            message.error(`${oversized.name} 超过 20MB`);
            return false;
        }
        try {
            const items = await agent.uploadAttachments(files);
            if (mode !== "agent" && items.length) setDirectAssets((current) => Array.from(new Map([...current, ...items].map((item) => [item.id, item])).values()).slice(-20));
            if (items.length) message.success(successMessage || `已上传 ${items.length} 份素材`);
            return items.length > 0;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "素材上传失败");
            return false;
        }
    };

    const usePublicPrompt = (value: string) => {
        setPrompt(value);
        window.requestAnimationFrame(() => inputRef.current?.focus());
        message.success("已填入公开提示词");
    };

    const importReferenceMedia = async (input: { url: string; mimeType?: string; fileStem: string }): Promise<boolean> => {
        try {
            const response = await fetch(input.url);
            if (!response.ok) throw new Error("读取参考素材失败");
            const blob = await response.blob();
            const mimeType = blob.type || input.mimeType || "";
            if (!isCreativeUploadMimeType(mimeType)) throw new Error("该媒体格式暂不支持作为参考素材");
            const extension = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
            const referenced = await uploadAttachments([new File([blob], `${input.fileStem}.${extension}`, { type: mimeType })], "已引用到创作输入框");
            if (referenced) window.requestAnimationFrame(() => inputRef.current?.focus());
            return referenced;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "引用素材失败");
            return false;
        }
    };

    const usePublicImage = async (item: PublicGalleryItem) => {
        const preview = item.preview;
        if (!preview || preview.mediaType !== "image") return;
        await importReferenceMedia({ url: preview.url, mimeType: preview.mimeType, fileStem: item.slug });
    };

    const importRecentAsset = async (asset: CreateOverviewAsset) => {
        try {
            const reference = recentOverviewAssetToCreativeAsset(asset, currentUser?.id || "");
            if (mode === "agent") {
                await agent.referenceExistingAsset({ id: asset.id, type: asset.kind, url: asset.url, mimeType: asset.mimeType, title: asset.title });
            } else {
                setDirectAssets((current) => Array.from(new Map([...current, reference].map((item) => [item.id, item])).values()).slice(-20));
            }
            if (mode === "video") setVideoMethod("reference");
            window.requestAnimationFrame(() => inputRef.current?.focus());
            message.success("已引用最近生成素材");
            return true;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "引用素材失败");
            return false;
        }
    };

    const selectSkill = (skill: AgentSkillSummary) => {
        setSelectedSkillIds((current) => ({ ...current, [mode]: current[mode] === skill.id ? undefined : skill.id }));
        if (mode === "image" || mode === "video") applySkillDefaults(skill, mode, updateConfig, setVideoCount, setVideoMethod);
        window.requestAnimationFrame(() => inputRef.current?.focus());
    };

    const changeMode = (nextMode: CreationMode) => {
        setMode(nextMode);
        if (nextMode === "agent") {
            const allowedIds = agent.selectedAssets.filter((asset) => isAssetAllowedForMode(nextMode, asset.type)).map((asset) => asset.id);
            agent.restoreAttachments(allowedIds);
        } else {
            setDirectAssets((current) => (mode === "agent" ? agent.selectedAssets : current).filter((asset) => isAssetAllowedForMode(nextMode, asset.type)));
        }
        window.requestAnimationFrame(() => inputRef.current?.focus());
    };

    const reuseDirectMessage = (item: DirectCreationMessage) => {
        const index = direct.messages.findIndex((messageItem) => messageItem.id === item.id);
        const source =
            item.role === "user"
                ? item
                : direct.messages
                      .slice(0, index)
                      .reverse()
                      .find((messageItem) => messageItem.role === "user" && messageItem.mode === item.mode);
        setMode(item.mode);
        setPrompt(source?.content || "");
        setDirectAssets(source?.assets || []);
        setSelectedSkillIds((current) => ({ ...current, [item.mode]: source?.skillIds?.[0] || item.skillIds?.[0] }));
        updateConfig(item.mode === "text" ? "textModel" : item.mode === "image" ? "imageModel" : "videoModel", item.model);
        updateConfig("size", item.settings.size);
        if (item.mode === "image") {
            updateConfig("quality", item.settings.quality);
            updateConfig("count", item.settings.count);
        }
        if (item.mode === "video") {
            updateConfig("vquality", item.settings.videoQuality);
            updateConfig("videoSeconds", item.settings.videoSeconds);
            setVideoCount(item.settings.videoCount);
            setVideoMethod(item.settings.videoMethod);
        }
        window.requestAnimationFrame(() => inputRef.current?.focus());
        message.info("已回填提示词、素材和生成设置");
    };

    const composer = (
        <CreativeComposer
            mode={mode}
            inputRef={inputRef}
            value={prompt}
            busy={mode === "agent" ? agent.sending : direct.busy}
            centered={!showConversation}
            onChange={setPrompt}
            onSubmit={() => void submit()}
            onCancel={() => void (mode === "agent" ? agent.cancel() : direct.cancel()).catch((error) => message.error(error instanceof Error ? error.message : "停止任务失败"))}
            attachments={mode === "agent" ? agent.selectedAssets : directAssets}
            skills={skills}
            skillsLoading={skillsLoading}
            selectedSkill={selectedSkill}
            uploading={agent.uploading}
            onRemoveAttachment={(id) => {
                if (mode === "agent") agent.removeAttachment(id);
                else setDirectAssets((current) => current.filter((asset) => asset.id !== id));
            }}
            onSelectSkill={selectSkill}
            onRemoveSkill={() => setSelectedSkillIds((current) => ({ ...current, [mode]: undefined }))}
            config={config}
            onModeChange={changeMode}
            onConfigChange={(key, value) => updateConfig(key, value)}
            videoCount={videoCount}
            onVideoCountChange={setVideoCount}
            videoMethod={videoMethod}
            onVideoMethodChange={setVideoMethod}
            onAttachment={() => attachmentInputRef.current?.click()}
            onPasteImages={(files) => void uploadAttachments(files)}
            onMentionRecentAsset={importRecentAsset}
        />
    );

    return (
        <main className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#fafbfc] text-[#20242a] dark:bg-[#111316] dark:text-[#f3f5f7]">
            <div className="absolute right-3 top-3 z-10 flex items-center gap-1 sm:right-5 sm:top-4">
                {hasConversation ? <Button type="text" shape="circle" icon={<Plus className="size-4" />} onClick={newConversation} aria-label="新建对话" title="新建对话" /> : null}
                <Button
                    type="text"
                    shape="circle"
                    icon={<History className="size-4" />}
                    onClick={() => {
                        setMode("agent");
                        setHistoryOpen(true);
                    }}
                    aria-label="Agent 创作历史"
                    title="Agent 创作历史"
                />
            </div>

            <section className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
                {showConversation && mode === "agent" ? (
                    <CreativeMessages
                        messages={agent.messages}
                        assets={agent.assets}
                        loading={agent.conversationLoading}
                        projectLinks={agent.projectLinks}
                        projectErrors={agent.projectErrors}
                        runDetails={agent.runDetails}
                        materializingProjectId={agent.materializingProjectId}
                        onMaterializeProject={agent.materializeProject}
                        onRetryTask={(runId, taskId) => void agent.retryTask(runId, taskId).catch((error) => message.error(error instanceof Error ? error.message : "重试任务失败"))}
                        onRetryRun={(runId) => void agent.retryRun(runId).catch((error) => message.error(error instanceof Error ? error.message : "重新分析失败"))}
                        onRetrySubmission={(messageId) => void agent.retrySubmission(messageId).catch((error) => message.error(error instanceof Error ? error.message : "重试请求失败"))}
                        onEditMessage={(editedMessage) => {
                            const assetIds = Array.isArray(editedMessage.metadata.assetIds) ? editedMessage.metadata.assetIds.filter((id): id is string => typeof id === "string") : [];
                            setPrompt(editedMessage.content);
                            agent.restoreAttachments(assetIds);
                            window.requestAnimationFrame(() => inputRef.current?.focus());
                            message.info("已回填消息和本轮参考素材，可修改后重新发送");
                        }}
                        selectedAssetIds={agent.selectedAssetIds}
                        onToggleAsset={agent.toggleAsset}
                        hasOlder={agent.hasOlderMessages}
                        olderLoading={agent.olderMessagesLoading}
                        onLoadOlder={() => void agent.loadOlderMessages()}
                        canConfigureModels={currentUser?.role === "admin"}
                    />
                ) : showConversation ? (
                    <DirectCreationMessages messages={direct.messages} onReuse={reuseDirectMessage} />
                ) : (
                    <div className="mx-auto flex min-h-full w-full min-w-0 max-w-[1320px] flex-col items-center px-2.5 pb-3 pt-3 sm:px-8 sm:pb-8 sm:pt-12 lg:pt-[9vh] xl:pt-[11vh]">
                        <div className="text-center">
                            <SiteLogo logoUrl={site.logoUrl} className="mx-auto size-8" />
                            <h1 className="mt-2.5 text-[22px] font-semibold leading-tight sm:mt-5 sm:text-[30px]">
                                {site.title} {creationModeLabels[mode]}
                            </h1>
                            <p className="mt-2 text-sm text-[#8b949f] dark:text-[#7f8996]">从一个想法开始</p>
                        </div>
                        {mode === "agent" ? (
                            <FirstUseGuide
                                ready={publicSessionReady}
                                completed={hasAgentConversation || agent.conversations.length > 0}
                                missingModels={missingModels}
                                onUseExample={() => {
                                    setPrompt("为一款透明玻璃香水瓶创作电商主视觉：冷白背景，柔和侧光，突出瓶身折射与高级质感，输出一张 4:5 竖图。");
                                    window.requestAnimationFrame(() => inputRef.current?.focus());
                                }}
                            />
                        ) : null}
                        <div className="mt-3 w-full sm:mt-6">{composer}</div>
                        <CreateWorkbenchOverview
                            onUseAsset={async (asset) => {
                                await importRecentAsset(asset);
                            }}
                        />
                        <CreateInspirationGallery onUsePrompt={usePublicPrompt} onUseImage={usePublicImage} />
                    </div>
                )}
            </section>

            {showConversation ? composer : null}
            <input
                ref={attachmentInputRef}
                type="file"
                multiple
                accept={attachmentAccept(mode)}
                className="hidden"
                onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    event.target.value = "";
                    void uploadAttachments(files);
                }}
            />

            <Drawer title="创作历史" placement="right" size="min(92vw, 380px)" open={historyOpen} onClose={() => setHistoryOpen(false)} styles={{ body: { padding: 0, overflow: "hidden" } }}>
                <CreativeConversationList
                    items={agent.conversations}
                    activeId={agent.conversationId}
                    loading={agent.historyLoading}
                    hasMore={agent.historyHasMore}
                    loadingMore={agent.historyLoadingMore}
                    onLoadMore={() => void agent.loadMoreConversations()}
                    onNew={() => {
                        newConversation();
                        setHistoryOpen(false);
                    }}
                    onOpen={(id) => {
                        openConversation(id);
                        setHistoryOpen(false);
                    }}
                    onRename={async (id, title) => {
                        try {
                            await agent.renameConversation(id, title);
                            message.success("标题已更新");
                        } catch (error) {
                            message.error(error instanceof Error ? error.message : "修改标题失败");
                            throw error;
                        }
                    }}
                    onArchive={async (ids) => {
                        try {
                            await agent.archiveConversations(ids);
                            message.success(ids.length > 1 ? `已删除 ${ids.length} 条对话` : "对话已删除");
                        } catch (error) {
                            message.error(error instanceof Error ? error.message : "删除对话失败");
                            throw error;
                        }
                    }}
                />
            </Drawer>
        </main>
    );
}

function recentOverviewAssetToCreativeAsset(asset: CreateOverviewAsset, userId: string): CreativeAsset {
    const createdAt = Date.parse(asset.createdAt) || Date.now();
    const isRemote = /^https?:\/\//i.test(asset.url);
    return {
        id: asset.id,
        userId,
        conversationId: "recent-generation",
        ordinal: 0,
        type: asset.kind,
        status: "ready",
        title: asset.title || `最近${asset.kind === "image" ? "图片" : asset.kind === "video" ? "视频" : "音频"}`,
        storageKind: isRemote ? "remote" : "local",
        ...(isRemote ? { remoteUrl: asset.url } : { serverUrl: asset.url }),
        mimeType: asset.mimeType,
        metadata: { source: "recent-asset-reference", sourceAssetId: asset.id },
        createdAt,
        updatedAt: createdAt,
    };
}

function applySkillDefaults(
    skill: AgentSkillSummary,
    mode: "image" | "video",
    updateConfig: (key: "textModel" | "imageModel" | "videoModel" | "quality" | "size" | "count" | "vquality" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark", value: string) => void,
    setVideoCount: (value: number) => void,
    setVideoMethod: (value: DirectVideoMethod) => void,
) {
    const defaults = skill.defaultConfig || {};
    if (typeof defaults.size === "string") updateConfig("size", defaults.size);
    if (mode === "image") {
        if (typeof defaults.quality === "string") updateConfig("quality", defaults.quality);
        if (typeof defaults.count === "number" || typeof defaults.count === "string") updateConfig("count", String(defaults.count));
    } else {
        if (typeof defaults.vquality === "string") updateConfig("vquality", defaults.vquality);
        if (typeof defaults.videoSeconds === "number" || typeof defaults.videoSeconds === "string") updateConfig("videoSeconds", String(defaults.videoSeconds));
        if (skill.requiresReference) setVideoMethod("reference");
        if (typeof defaults.videoCount === "number") setVideoCount(Math.max(1, Math.min(4, Math.floor(defaults.videoCount))));
    }
}

function attachmentAccept(mode: CreationMode) {
    if (mode === "agent") return CREATIVE_UPLOAD_ACCEPT;
    if (mode === "video") return "image/*,video/*,audio/*";
    return "image/*";
}

function isUploadAllowedForMode(mode: CreationMode, mimeType: string) {
    if (!isCreativeUploadMimeType(mimeType)) return false;
    if (mode === "agent") return true;
    if (mode === "video") return mimeType.startsWith("image/") || mimeType.startsWith("video/") || mimeType.startsWith("audio/");
    return mimeType.startsWith("image/");
}

function isAssetAllowedForMode(mode: CreationMode, type: "text" | "image" | "video" | "audio") {
    if (mode === "agent") return type === "image" || type === "video" || type === "audio";
    if (mode === "video") return type === "image" || type === "video" || type === "audio";
    return type === "image";
}

function attachmentTypeLabel(mode: CreationMode) {
    if (mode === "video") return "支持的图片、视频或音频格式";
    if (mode === "agent") return "支持的创作素材格式";
    return "支持的图片格式";
}
