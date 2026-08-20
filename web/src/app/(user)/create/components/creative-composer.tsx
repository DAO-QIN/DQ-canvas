"use client";

import { Button, Input, Modal, Popover, Switch, Tooltip } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { ArrowUp, AtSign, Boxes, Check, ChevronDown, Circle, Clock3, FileAudio, FileAudio2, FileText, FileVideo, ImageIcon, Link2, LoaderCircle, Maximize2, Plus, Settings2, Sparkles, Square, Video, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { VoiceInputButton } from "@/components/conversation/voice-input-button";
import { ModelPicker } from "@/components/model-picker";
import { canvasThemes } from "@/lib/canvas-theme";
import type { CreativeAsset } from "@/lib/creative-runtime-contract";
import { clipboardImageFiles } from "@/lib/clipboard-image-files";
import type { CreateOverviewAsset } from "@/lib/create-workbench-overview";
import { parseImageDimensions } from "@/lib/image-size";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { normalizeSeedanceRatio } from "@/lib/seedance-video";
import { cn } from "@/lib/utils";
import { getCreateWorkbenchOverview } from "@/services/api/create-workbench-overview";
import type { AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

import { creationModeLabels, creationModePlaceholders, type CreationMode, type DirectCreationMode } from "../creation-mode";
import type { DirectVideoMethod } from "../use-direct-creation";

type SkillOption = {
    id: string;
    name: string;
    description: string;
    action?: "generate" | "edit";
    workspaces?: Array<"image" | "video" | "canvas" | "design" | "drama">;
};

type MentionDraft = { start: number; end: number; query: string };
export function CreativeComposer({
    mode,
    inputRef,
    value,
    busy,
    onChange,
    onSubmit,
    onCancel,
    onAttachment,
    onPasteImages,
    attachments,
    skills,
    skillsLoading,
    selectedSkill,
    uploading,
    onRemoveAttachment,
    onSelectSkill,
    onRemoveSkill,
    config,
    onModeChange,
    onConfigChange,
    videoCount,
    onVideoCountChange,
    videoMethod,
    onVideoMethodChange,
    onMentionRecentAsset,
    centered = false,
}: {
    mode: CreationMode;
    inputRef: RefObject<TextAreaRef | null>;
    value: string;
    busy: boolean;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onCancel: () => void;
    onAttachment: () => void;
    onPasteImages: (files: File[]) => void;
    attachments: CreativeAsset[];
    skills: SkillOption[];
    skillsLoading: boolean;
    selectedSkill?: SkillOption;
    uploading: boolean;
    onRemoveAttachment: (id: string) => void;
    onSelectSkill: (skill: SkillOption) => void;
    onRemoveSkill: () => void;
    config: AiConfig;
    onModeChange: (mode: CreationMode) => void;
    onConfigChange: (key: "textModel" | "imageModel" | "videoModel" | "quality" | "size" | "count" | "vquality" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark", value: string) => void;
    videoCount: number;
    onVideoCountChange: (value: number) => void;
    videoMethod: DirectVideoMethod;
    onVideoMethodChange: (value: DirectVideoMethod) => void;
    onMentionRecentAsset: (asset: CreateOverviewAsset) => Promise<boolean>;
    centered?: boolean;
}) {
    const visibleSkills = skills.filter((skill) => skillAvailableInMode(skill, mode));
    const [mentionOpen, setMentionOpen] = useState(false);
    const [mentionDraft, setMentionDraft] = useState<MentionDraft | null>(null);
    const [recentAssets, setRecentAssets] = useState<CreateOverviewAsset[]>([]);
    const [recentAssetsLoading, setRecentAssetsLoading] = useState(false);
    const [recentAssetsError, setRecentAssetsError] = useState("");
    const [mentioningAssetId, setMentioningAssetId] = useState("");
    const valueRef = useRef(value);
    const mentionDraftRef = useRef<MentionDraft | null>(null);
    valueRef.current = value;
    mentionDraftRef.current = mentionDraft;

    const loadRecentAssets = useCallback(async () => {
        setRecentAssetsLoading(true);
        setRecentAssetsError("");
        try {
            const overview = await getCreateWorkbenchOverview();
            setRecentAssets(overview.recentAssets);
        } catch (error) {
            setRecentAssetsError(error instanceof Error ? error.message : "最近生成内容加载失败");
        } finally {
            setRecentAssetsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (mentionOpen) void loadRecentAssets();
    }, [loadRecentAssets, mentionOpen]);

    const updatePromptFromInput = (nextValue: string, caret: number) => {
        onChange(nextValue);
        const draft = mentionDraftAt(nextValue, caret);
        setMentionDraft(draft);
        if (draft) setMentionOpen(true);
        else if (mentionDraftRef.current) setMentionOpen(false);
    };

    const insertMention = async (asset: CreateOverviewAsset) => {
        setMentioningAssetId(asset.id);
        const imported = await onMentionRecentAsset(asset);
        setMentioningAssetId("");
        if (!imported) return;

        const currentValue = valueRef.current;
        const currentDraft = mentionDraftRef.current;
        const textarea = inputRef.current?.resizableTextArea?.textArea;
        const caret = textarea?.selectionStart ?? currentValue.length;
        const start = currentDraft?.start ?? caret;
        const end = currentDraft?.end ?? caret;
        const label = mentionLabel(asset);
        const needsLeadingSpace = start > 0 && !/\s/.test(currentValue[start - 1] || "");
        const token = `${needsLeadingSpace ? " " : ""}@${label} `;
        const nextValue = `${currentValue.slice(0, start)}${token}${currentValue.slice(end)}`;
        const nextCaret = start + token.length;
        onChange(nextValue);
        setMentionDraft(null);
        mentionDraftRef.current = null;
        setMentionOpen(false);
        window.requestAnimationFrame(() => {
            const nextTextarea = inputRef.current?.resizableTextArea?.textArea;
            nextTextarea?.focus();
            nextTextarea?.setSelectionRange(nextCaret, nextCaret);
        });
    };

    return (
        <div className={cn("mx-auto w-full", centered ? "max-w-[960px]" : "max-w-[1120px] px-3 pb-3 sm:px-6 sm:pb-5")}>
            <div className="creative-composer rounded-[18px] border border-[#dde2e7] bg-white p-2 shadow-[0_14px_38px_rgba(32,36,42,0.09)] dark:border-[#30363e] dark:bg-[#181b20] dark:shadow-black/30">
                <div className="grid grid-cols-[58px_minmax(0,1fr)] items-start gap-3 px-2 pt-2 sm:grid-cols-[64px_minmax(0,1fr)] sm:gap-4">
                    <Tooltip title="添加参考内容">
                        <button
                            type="button"
                            className="flex h-[68px] w-[56px] -rotate-3 flex-col items-center justify-center gap-1 rounded-xl border border-[#d9dfe6] bg-[#f0f2f5] text-[#626d7a] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#e9edf1] hover:text-[#20242a] disabled:cursor-wait disabled:opacity-55 sm:w-[62px] dark:border-[#343b44] dark:bg-[#252a31] dark:text-[#aab3bf] dark:hover:bg-[#2c323a] dark:hover:text-white"
                            onClick={onAttachment}
                            disabled={uploading || busy}
                            aria-label="添加参考内容"
                        >
                            {uploading ? <LoaderCircle className="size-5 animate-spin" /> : <Plus className="size-5" />}
                            <span className="text-[10px] font-medium">参考内容</span>
                        </button>
                    </Tooltip>
                    <div className="min-w-0">
                        {selectedSkill || attachments.length ? <ComposerReferences selectedSkill={selectedSkill} attachments={attachments} onRemoveSkill={onRemoveSkill} onRemoveAttachment={onRemoveAttachment} /> : null}
                        <Input.TextArea
                            ref={inputRef}
                            value={value}
                            maxLength={4000}
                            autoSize={{ minRows: centered ? 3 : 2, maxRows: 8 }}
                            variant="borderless"
                            className="creative-composer-input !border-0 !bg-transparent !px-0 !py-0 !text-[15px] !leading-7 !shadow-none !outline-none"
                            placeholder={creationModePlaceholders[mode]}
                            onChange={(event) => updatePromptFromInput(event.target.value, event.target.selectionStart ?? event.target.value.length)}
                            onPaste={(event) => {
                                const files = clipboardImageFiles(event.clipboardData);
                                if (!files.length) return;
                                event.preventDefault();
                                onPasteImages(files);
                            }}
                            onPressEnter={(event) => {
                                if (event.shiftKey) return;
                                event.preventDefault();
                                if (!busy) onSubmit();
                            }}
                        />
                    </div>
                </div>
                <div className="mt-1 flex items-center gap-1 px-1 pb-1 sm:gap-2">
                    <SkillPicker mode={mode} skills={visibleSkills} loading={skillsLoading} selectedSkill={selectedSkill} onSelect={onSelectSkill} />
                    <CreationModePicker mode={mode} onChange={onModeChange} disabled={busy} />
                    {mode !== "agent" ? (
                        <>
                            <ModelPicker
                                config={config}
                                value={directModel(config, mode)}
                                capability={mode}
                                onChange={(model) => onConfigChange(directModelKey(mode), model)}
                                className="!h-9 !w-9 !min-w-9 !rounded-lg !border-0 !bg-transparent !px-2 !shadow-none [&_.canvas-model-picker-text]:hidden hover:!bg-[#eef1f4] sm:!w-auto sm:!max-w-[180px] sm:[&_.canvas-model-picker-text]:block dark:hover:!bg-[#292f37]"
                                placeholder={`选择${creationModeLabels[mode]}模型`}
                            />
                            {mode === "image" || mode === "video" ? (
                                <DirectGenerationSettings mode={mode} config={config} onConfigChange={onConfigChange} videoCount={videoCount} onVideoCountChange={onVideoCountChange} videoMethod={videoMethod} onVideoMethodChange={onVideoMethodChange} />
                            ) : null}
                        </>
                    ) : null}
                    <RecentAssetMentionPicker
                        mode={mode}
                        assets={recentAssets}
                        loading={recentAssetsLoading}
                        error={recentAssetsError}
                        open={mentionOpen}
                        query={mentionDraft?.query || ""}
                        mentioningAssetId={mentioningAssetId}
                        onOpenChange={(open) => {
                            setMentionOpen(open);
                            if (!open) setMentionDraft(null);
                        }}
                        onRetry={() => void loadRecentAssets()}
                        onSelect={(asset) => void insertMention(asset)}
                    />
                    <span className="min-w-0 flex-1" />
                    <VoiceInputButton disabled={busy} onTranscribed={(text) => onChange(value.trim() ? `${value.trim()} ${text}` : text)} />
                    <Tooltip title={busy ? "停止生成" : "发送"}>
                        <Button
                            type="primary"
                            shape="circle"
                            className="!size-9 !min-w-9"
                            icon={busy ? <Square className="size-3.5 fill-current" /> : <ArrowUp className="size-4" />}
                            disabled={!busy && !value.trim()}
                            onClick={busy ? onCancel : onSubmit}
                            aria-label={busy ? "停止生成" : "发送"}
                        />
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}

function RecentAssetMentionPicker({
    mode,
    assets,
    loading,
    error,
    open,
    query,
    mentioningAssetId,
    onOpenChange,
    onRetry,
    onSelect,
}: {
    mode: CreationMode;
    assets: CreateOverviewAsset[];
    loading: boolean;
    error: string;
    open: boolean;
    query: string;
    mentioningAssetId: string;
    onOpenChange: (open: boolean) => void;
    onRetry: () => void;
    onSelect: (asset: CreateOverviewAsset) => void;
}) {
    const availableAssets = assets.filter((asset) => recentAssetAllowedInMode(asset, mode));
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filteredAssets = normalizedQuery ? availableAssets.filter((asset) => `${asset.title} ${recentAssetKindLabel(asset.kind)}`.toLocaleLowerCase().includes(normalizedQuery)) : availableAssets;

    return (
        <Popover
            trigger="click"
            placement="bottomRight"
            arrow={false}
            autoAdjustOverflow={false}
            open={open}
            onOpenChange={onOpenChange}
            content={
                <div className="w-[min(360px,calc(100vw-32px))] py-1">
                    <div className="flex items-start justify-between gap-3 px-2 pb-2">
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-[#20242a] dark:text-[#f3f5f7]">引用最近生成</p>
                            <p className="mt-0.5 text-[11px] text-[#8b949f] dark:text-[#7f8996]">选择后会加入当前输入框的参考素材</p>
                        </div>
                        {query ? <span className="max-w-28 truncate rounded-full bg-[#f0f2f5] px-2 py-0.5 text-[10px] text-[#687483] dark:bg-[#292f37] dark:text-[#aab3bf]">@{query}</span> : null}
                    </div>
                    {loading ? (
                        <div className="flex items-center gap-2 px-2 py-5 text-xs text-[#8b949f] dark:text-[#7f8996]">
                            <LoaderCircle className="size-4 animate-spin" />
                            正在加载最近生成...
                        </div>
                    ) : null}
                    {!loading && error ? (
                        <div className="space-y-2 px-2 py-4 text-xs text-[#9b4d4d] dark:text-[#f0a4a4]">
                            <p>{error}</p>
                            <button type="button" className="rounded-md border border-current px-2 py-1 text-[11px] transition hover:bg-current/10" onClick={onRetry}>
                                重试
                            </button>
                        </div>
                    ) : null}
                    {!loading && !error && !filteredAssets.length ? <p className="px-2 py-5 text-xs text-[#8b949f] dark:text-[#7f8996]">暂无可引用的最近生成内容</p> : null}
                    {!loading && !error && filteredAssets.length ? (
                        <div className="hide-scrollbar max-h-[min(52vh,360px)] space-y-1 overflow-y-auto px-1">
                            {filteredAssets.map((asset) => {
                                const image = asset.kind === "image" && asset.url;
                                const Icon = asset.kind === "video" ? Video : FileAudio2;
                                const selecting = mentioningAssetId === asset.id;
                                return (
                                    <button
                                        key={asset.id}
                                        type="button"
                                        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-[#f4f6f8] disabled:cursor-wait disabled:opacity-60 dark:hover:bg-[#242930]"
                                        disabled={Boolean(mentioningAssetId)}
                                        onClick={() => onSelect(asset)}
                                    >
                                        <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border border-[#dfe3e8] bg-[#f2f4f6] text-[#687483] dark:border-[#343a42] dark:bg-[#252a31] dark:text-[#a9b2bd]">
                                            {image ? <img src={imagePreviewUrl(asset.url, 160)} alt="" className="size-full object-cover" loading="lazy" referrerPolicy="no-referrer" /> : <Icon className="size-4" />}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-xs font-medium text-[#344152] dark:text-[#edf1f5]">{asset.title || `${recentAssetKindLabel(asset.kind)}内容`}</span>
                                            <span className="mt-0.5 block text-[11px] text-[#8b949f] dark:text-[#7f8996]">
                                                {recentAssetKindLabel(asset.kind)} · {formatRecentAssetDate(asset.createdAt)}
                                            </span>
                                        </span>
                                        {selecting ? <LoaderCircle className="size-4 shrink-0 animate-spin text-[#667382]" /> : <AtSign className="size-3.5 shrink-0 text-[#9aa4b0]" />}
                                    </button>
                                );
                            })}
                        </div>
                    ) : null}
                </div>
            }
        >
            <Tooltip title="引用最近生成">
                <Button
                    type="text"
                    className={cn("!size-9 !min-w-9 !rounded-lg !px-2 !text-[#657180] hover:!bg-[#eef1f4] dark:!text-[#aab3bf] dark:hover:!bg-[#292f37]", open && "!bg-[#eef1f4] !text-[#20242a] dark:!bg-[#292f37] dark:!text-white")}
                    icon={<AtSign className="size-4" />}
                    aria-label="引用最近生成内容"
                    aria-expanded={open}
                />
            </Tooltip>
        </Popover>
    );
}

function SkillPicker({ mode, skills, loading, selectedSkill, onSelect }: { mode: CreationMode; skills: SkillOption[]; loading: boolean; selectedSkill?: SkillOption; onSelect: (skill: SkillOption) => void }) {
    const [open, setOpen] = useState(false);
    return (
        <Popover
            trigger="click"
            placement="bottomLeft"
            arrow={false}
            open={open}
            onOpenChange={setOpen}
            content={
                <div className="w-[calc(100vw-56px)] max-w-[320px] py-1 sm:w-80 sm:max-w-none">
                    <div className="px-2 pb-2">
                        <p className="text-sm font-semibold text-[#20242a] dark:text-[#f3f5f7]">选择创作 Skill</p>
                        <p className="mt-0.5 text-[11px] text-[#8b949f] dark:text-[#7f8996]">仅显示适用于{creationModeLabels[mode]}的能力</p>
                    </div>
                    {loading ? <p className="px-2 py-4 text-xs text-[#8b949f] dark:text-[#7f8996]">正在加载...</p> : null}
                    {!loading && !skills.length ? <p className="px-2 py-4 text-xs text-[#8b949f] dark:text-[#7f8996]">当前模式暂无可用 Skill</p> : null}
                    <div className="hide-scrollbar max-h-64 space-y-1 overflow-y-auto">
                        {skills.map((skill) => {
                            const selected = selectedSkill?.id === skill.id;
                            const visual = skillOptionVisual(skill);
                            const Icon = visual.icon;
                            return (
                                <button
                                    key={skill.id}
                                    type="button"
                                    className={cn(
                                        "flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition",
                                        selected ? "bg-[#eef1f4] text-[#20242a] dark:bg-[#292f37] dark:text-white" : "text-[#4d5662] hover:bg-[#f4f6f8] dark:text-[#c2c9d1] dark:hover:bg-[#242930]",
                                    )}
                                    onClick={() => {
                                        onSelect(skill);
                                        setOpen(false);
                                    }}
                                >
                                    <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg", visual.surfaceClass)}>
                                        <Icon className={cn("size-4", visual.iconClass)} />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-xs font-medium">{skill.name}</span>
                                        <span className="mt-0.5 line-clamp-2 block text-[11px] leading-4 text-[#8b949f] dark:text-[#7f8996]">{skill.description}</span>
                                    </span>
                                    {selected ? <Check className="mt-1 size-4 shrink-0" /> : null}
                                </button>
                            );
                        })}
                    </div>
                </div>
            }
        >
            <Button
                type="text"
                className={cn("!h-9 !max-w-[116px] !rounded-lg !px-2 !text-[#596575] dark:!text-[#a8b1bd]", selectedSkill && "!bg-[#eef1f4] !text-[#20242a] dark:!bg-[#292f37] dark:!text-white")}
                icon={<Boxes className="size-4" />}
                aria-label={selectedSkill ? `已选择 Skill：${selectedSkill.name}` : "选择创作 Skill"}
                aria-expanded={open}
            >
                <span className="truncate">Skill</span>
            </Button>
        </Popover>
    );
}

function ComposerReferences({ selectedSkill, attachments, onRemoveSkill, onRemoveAttachment }: { selectedSkill?: SkillOption; attachments: CreativeAsset[]; onRemoveSkill: () => void; onRemoveAttachment: (id: string) => void }) {
    return (
        <div className="hide-scrollbar mb-2 flex gap-2 overflow-x-auto pt-0.5">
            {selectedSkill ? (
                <span className="flex h-11 max-w-56 shrink-0 items-center gap-2 rounded-lg border border-[#d6dee8] bg-[#f1f4f8] px-2.5 text-xs font-medium text-[#344152] dark:border-[#3b4653] dark:bg-[#252b33] dark:text-[#edf1f5]">
                    <Sparkles className="size-3.5 shrink-0 text-[#95681d] dark:text-[#e4bb70]" />
                    <span className="truncate">{selectedSkill.name}</span>
                    <RemoveReferenceButton label={`移除 Skill ${selectedSkill.name}`} onClick={onRemoveSkill} />
                </span>
            ) : null}
            {attachments.map((asset) => (
                <ComposerReferenceMedia key={asset.id} asset={asset} onRemove={() => onRemoveAttachment(asset.id)} />
            ))}
        </div>
    );
}

function ComposerReferenceMedia({ asset, onRemove }: { asset: CreativeAsset; onRemove: () => void }) {
    const [previewOpen, setPreviewOpen] = useState(false);
    const url = asset.serverUrl || asset.remoteUrl || "";
    const canPreview = Boolean(url) && (asset.type === "image" || asset.type === "video" || asset.type === "audio");
    const Icon = asset.type === "image" ? ImageIcon : asset.type === "video" ? FileVideo : FileAudio;
    const title = asset.title || "参考素材";

    return (
        <>
            <span
                className="group/reference-media relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#dfe3e8] bg-[#f2f4f6] text-[#687483] dark:border-[#343a42] dark:bg-[#252a31] dark:text-[#a9b2bd]"
                title={title}
            >
                {asset.type === "image" && url ? <img src={imagePreviewUrl(url, 160)} alt={title} className="size-full object-cover" /> : <Icon className="size-4" />}
                {canPreview ? (
                    <button
                        type="button"
                        className="absolute bottom-0.5 left-0.5 grid size-5 place-items-center rounded-md bg-black/65 text-white opacity-90 transition hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                        onClick={(event) => {
                            event.stopPropagation();
                            setPreviewOpen(true);
                        }}
                        aria-label={`放大查看 ${title}`}
                    >
                        <Maximize2 className="size-3" />
                    </button>
                ) : null}
                <button type="button" className="absolute right-0.5 top-0.5 grid size-4 place-items-center rounded-full bg-black/65 text-white transition hover:bg-black/80" onClick={onRemove} aria-label={`移除 ${title}`}>
                    <X className="size-2.5" />
                </button>
            </span>
            {canPreview ? (
                <Modal
                    title={title}
                    open={previewOpen}
                    footer={null}
                    centered
                    destroyOnHidden
                    width={asset.type === "video" ? "min(1120px, calc(100vw - 24px))" : "min(960px, calc(100vw - 24px))"}
                    onCancel={() => setPreviewOpen(false)}
                    styles={{ body: { padding: 0, overflow: "hidden", background: asset.type === "video" ? "#000" : undefined } }}
                >
                    {asset.type === "image" ? <img src={imagePreviewUrl(url, 1920)} alt={title} className="mx-auto max-h-[78dvh] max-w-full object-contain" /> : null}
                    {asset.type === "video" ? <video src={url} controls autoPlay playsInline preload="metadata" className="max-h-[78dvh] w-full bg-black object-contain" /> : null}
                    {asset.type === "audio" ? <audio src={url} controls autoPlay className="w-full" /> : null}
                </Modal>
            ) : null}
        </>
    );
}

function RemoveReferenceButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            className="grid size-5 shrink-0 place-items-center rounded-md text-[#7c8795] transition hover:bg-[#dfe5ec] hover:text-[#263141] dark:text-[#aab3bf] dark:hover:bg-[#343c46] dark:hover:text-white"
            onClick={onClick}
            aria-label={label}
        >
            <X className="size-3" />
        </button>
    );
}

function CreationModePicker({ mode, onChange, disabled }: { mode: CreationMode; onChange: (mode: CreationMode) => void; disabled?: boolean }) {
    const [open, setOpen] = useState(false);
    const items: Array<{ id: CreationMode; label: string; icon: ReactNode }> = [
        { id: "agent", label: "Agent", icon: <QBrandIcon /> },
        { id: "text", label: "文本创作", icon: <FileText className="size-4" /> },
        { id: "image", label: "图片生成", icon: <ImageIcon className="size-4" /> },
        { id: "video", label: "视频生成", icon: <FileVideo className="size-4" /> },
    ];
    const current = items.find((item) => item.id === mode) || items[0];
    return (
        <Popover
            trigger="click"
            placement="bottomLeft"
            arrow={false}
            autoAdjustOverflow={false}
            open={open}
            onOpenChange={setOpen}
            content={
                <div className="w-[228px] p-1" role="listbox" aria-label="选择创作类型">
                    {items.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            role="option"
                            aria-selected={item.id === mode}
                            className={cn(
                                "flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left transition",
                                item.id === mode ? "bg-[#eef1f4] text-[#20242a] dark:bg-[#292f37] dark:text-white" : "text-[#4d5662] hover:bg-[#f4f6f8] dark:text-[#c2c9d1] dark:hover:bg-[#242930]",
                            )}
                            onClick={() => {
                                onChange(item.id);
                                setOpen(false);
                            }}
                        >
                            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-white text-[#465365] shadow-sm dark:bg-[#343b44] dark:text-[#e6eaf0]">{item.icon}</span>
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.label}</span>
                            {item.id === mode ? <Check className="size-4 shrink-0" aria-hidden="true" /> : null}
                        </button>
                    ))}
                </div>
            }
        >
            <Button
                type="text"
                className="!h-9 !max-w-[144px] !rounded-lg !px-2 !text-[#45505d] hover:!bg-[#eef1f4] dark:!text-[#c4cbd4] dark:hover:!bg-[#292f37]"
                icon={current.icon}
                disabled={disabled}
                aria-label={`创作类型：${current.label}`}
                aria-expanded={open}
            >
                <span className="truncate">{current.label}</span>
                <ChevronDown className={cn("size-3.5 shrink-0 transition", open && "rotate-180")} />
            </Button>
        </Popover>
    );
}

function QBrandIcon() {
    return <img src="/logo.svg" alt="" aria-hidden="true" className="size-6 shrink-0 object-contain dark:invert" />;
}

const creativeImageAspectOptions = [
    { value: "auto", label: "智能", width: 0, height: 0 },
    { value: "21:9", label: "21:9", width: 21, height: 9 },
    { value: "16:9", label: "16:9", width: 16, height: 9 },
    { value: "3:2", label: "3:2", width: 3, height: 2 },
    { value: "4:3", label: "4:3", width: 4, height: 3 },
    { value: "1:1", label: "1:1", width: 1, height: 1 },
    { value: "3:4", label: "3:4", width: 3, height: 4 },
    { value: "2:3", label: "2:3", width: 2, height: 3 },
    { value: "9:16", label: "9:16", width: 9, height: 16 },
] as const;

const creativeVideoAspectOptions = creativeImageAspectOptions.filter((item) => item.value !== "auto" && item.value !== "3:2" && item.value !== "2:3");

const creativeImageResolutionOptions = [
    { value: "1.5k", label: "标清 1.5K", shortLabel: "1.5K", maxSide: 1536 },
    { value: "2k", label: "高清 2K", shortLabel: "2K", maxSide: 2048 },
    { value: "4k", label: "超清 4K", shortLabel: "4K", maxSide: 3840 },
] as const;

const creativeVideoResolutionOptions = [
    { value: "480", label: "480P" },
    { value: "720", label: "720P" },
    { value: "1080", label: "1080P" },
] as const;

function DirectGenerationSettings({
    mode,
    config,
    onConfigChange,
    videoCount,
    onVideoCountChange,
    videoMethod,
    onVideoMethodChange,
}: {
    mode: "image" | "video";
    config: AiConfig;
    onConfigChange: (key: "textModel" | "imageModel" | "videoModel" | "quality" | "size" | "count" | "vquality" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark", value: string) => void;
    videoCount: number;
    onVideoCountChange: (value: number) => void;
    videoMethod: DirectVideoMethod;
    onVideoMethodChange: (value: DirectVideoMethod) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const count = Math.max(1, Math.min(4, Number(config.count) || 1));
    const summary = mode === "image" ? `${creativeImageAspectLabel(config.size)} · ${creativeImageResolutionLabel(config.size)} · ${count}` : `${creativeVideoAspectLabel(config.size)} · ${creativeVideoResolutionLabel(config.vquality)} · ${videoCount}`;
    return (
        <div className="flex items-center gap-1">
            <Popover
                trigger="click"
                placement="bottomRight"
                arrow={false}
                content={
                    <div className="max-h-[min(74vh,680px)] w-[min(640px,calc(100vw-32px))] overflow-y-auto py-1">
                        {mode === "image" ? (
                            <CreativeImageSettingsPanel config={config} theme={theme} onConfigChange={onConfigChange} />
                        ) : (
                            <CreativeVideoSettingsPanel config={config} theme={theme} onConfigChange={onConfigChange} videoCount={videoCount} onVideoCountChange={onVideoCountChange} videoMethod={videoMethod} onVideoMethodChange={onVideoMethodChange} />
                        )}
                    </div>
                }
            >
                <Button type="text" className="!h-9 !w-9 !min-w-9 !rounded-lg !px-2 !text-[#657180] sm:!w-auto sm:!max-w-[260px] dark:!text-[#9da7b3]" icon={<Settings2 className="size-4" />} aria-label={`生成设置：${summary}`} title={summary}>
                    <span className="direct-settings-summary hidden truncate text-xs sm:block">{summary}</span>
                    <ChevronDown className="direct-settings-chevron hidden size-3.5 shrink-0 sm:block" />
                </Button>
            </Popover>
            {mode === "video" ? <VideoDurationPicker config={config} theme={theme} onChange={(value) => onConfigChange("videoSeconds", value)} /> : null}
        </div>
    );
}

function CreativeImageSettingsPanel({ config, theme, onConfigChange }: { config: AiConfig; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onConfigChange: (key: "size" | "count", value: string) => void }) {
    const aspect = creativeImageAspectForSize(config.size);
    const resolution = creativeImageResolutionForSize(config.size);
    const count = Math.max(1, Math.min(4, Number(config.count) || 1));
    return (
        <CreativeSettingsSurface theme={theme}>
            <CreativeSettingSection title="选择比例" color={theme.node.muted}>
                <div className="grid grid-cols-5 gap-2 sm:grid-cols-9">
                    {creativeImageAspectOptions.map((item) => (
                        <CreativeAspectOption key={item.value} selected={aspect === item.value} theme={theme} item={item} onClick={() => onConfigChange("size", imageSizeForOptions(item.value, resolution))} />
                    ))}
                </div>
            </CreativeSettingSection>
            <CreativeSettingSection title="选择分辨率" color={theme.node.muted}>
                <div className="grid grid-cols-3 gap-2">
                    {creativeImageResolutionOptions.map((item) => (
                        <CreativeChoiceButton key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("size", imageSizeForOptions(aspect, item.value))}>
                            {item.label}
                        </CreativeChoiceButton>
                    ))}
                </div>
            </CreativeSettingSection>
            <CreativeSettingSection title="选择生成数量" color={theme.node.muted}>
                <div className="grid grid-cols-4 gap-2">
                    {[1, 2, 3, 4].map((value) => (
                        <CreativeChoiceButton key={value} selected={count === value} theme={theme} onClick={() => onConfigChange("count", String(value))}>
                            {value}
                        </CreativeChoiceButton>
                    ))}
                </div>
            </CreativeSettingSection>
            <CreativeImageDimensionControls size={config.size} theme={theme} onChange={(value) => onConfigChange("size", value)} />
        </CreativeSettingsSurface>
    );
}

function CreativeVideoSettingsPanel({
    config,
    theme,
    onConfigChange,
    videoCount,
    onVideoCountChange,
    videoMethod,
    onVideoMethodChange,
}: {
    config: AiConfig;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onConfigChange: (key: "size" | "vquality" | "videoGenerateAudio" | "videoWatermark", value: string) => void;
    videoCount: number;
    onVideoCountChange: (value: number) => void;
    videoMethod: DirectVideoMethod;
    onVideoMethodChange: (value: DirectVideoMethod) => void;
}) {
    const aspect = creativeVideoAspectForSize(config.size);
    const resolution = creativeVideoResolutionForValue(config.vquality);
    const generateAudio = config.videoGenerateAudio !== "false";
    const watermark = config.videoWatermark === "true";
    return (
        <CreativeSettingsSurface theme={theme}>
            <CreativeSettingSection title="选择比例" color={theme.node.muted}>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {creativeVideoAspectOptions.map((item) => (
                        <CreativeAspectOption key={item.value} selected={aspect === item.value} theme={theme} item={item} onClick={() => onConfigChange("size", item.value)} />
                    ))}
                </div>
            </CreativeSettingSection>
            <CreativeSettingSection title="选择分辨率" color={theme.node.muted}>
                <div className="grid grid-cols-3 gap-2">
                    {creativeVideoResolutionOptions.map((item) => (
                        <CreativeChoiceButton key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                            {item.label}
                        </CreativeChoiceButton>
                    ))}
                </div>
            </CreativeSettingSection>
            <CreativeSettingSection title="选择生成数量" color={theme.node.muted}>
                <div className="grid grid-cols-4 gap-2">
                    {[1, 2, 3, 4].map((value) => (
                        <CreativeChoiceButton key={value} selected={videoCount === value} theme={theme} onClick={() => onVideoCountChange(value)}>
                            {value}
                        </CreativeChoiceButton>
                    ))}
                </div>
            </CreativeSettingSection>
            <CreativeSettingSection title="生成方式" color={theme.node.muted}>
                <div className="grid grid-cols-3 gap-2">
                    {(["auto", "text", "reference"] as const).map((method) => (
                        <CreativeChoiceButton key={method} selected={videoMethod === method} theme={theme} onClick={() => onVideoMethodChange(method)}>
                            {videoMethodLabel(method)}
                        </CreativeChoiceButton>
                    ))}
                </div>
            </CreativeSettingSection>
            <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                <CreativeSwitchRow label="生成声音" checked={generateAudio} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} />
                <CreativeSwitchRow label="添加水印" checked={watermark} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} />
            </div>
        </CreativeSettingsSurface>
    );
}

function VideoDurationPicker({ config, theme, onChange }: { config: AiConfig; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onChange: (value: string) => void }) {
    const [open, setOpen] = useState(false);
    const minSeconds = 5;
    const seconds = normalizeCreativeVideoDuration(config.videoSeconds, minSeconds);
    return (
        <Popover
            trigger="click"
            placement="bottomRight"
            arrow={false}
            open={open}
            onOpenChange={setOpen}
            content={
                <div className="w-[min(420px,calc(100vw-32px))] space-y-3 px-1 py-1">
                    <p className="text-sm font-semibold" style={{ color: theme.node.text }}>
                        选择视频生成时长
                    </p>
                    <input
                        aria-label="视频生成时长"
                        type="range"
                        min={minSeconds}
                        max={15}
                        step={1}
                        value={seconds}
                        className="h-3 w-full cursor-pointer accent-[#7f8794] [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5"
                        onChange={(event) => onChange(event.target.value)}
                    />
                    <div className="grid grid-cols-3 text-[11px] font-medium" style={{ color: theme.node.muted }}>
                        {[5, 10, 15].map((tick) => (
                            <button key={tick} type="button" className={cn("transition hover:opacity-80", tick === 5 ? "justify-self-start" : tick === 15 ? "justify-self-end" : "justify-self-center")} onClick={() => onChange(String(tick))}>
                                {tick}
                            </button>
                        ))}
                    </div>
                    <label className="ml-auto flex h-12 w-32 items-center overflow-hidden rounded-xl px-3 text-sm" style={{ background: theme.node.fill, color: theme.node.text }}>
                        <input
                            type="number"
                            aria-label="时长秒数"
                            min={minSeconds}
                            max={15}
                            value={seconds}
                            onChange={(event) => onChange(normalizeCreativeVideoDuration(event.target.value, minSeconds).toString())}
                            className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        />
                        <span className="text-sm opacity-55">s</span>
                    </label>
                </div>
            }
        >
            <Button type="text" className="!h-9 !w-9 !min-w-9 !rounded-lg !px-2 !text-[#657180] sm:!w-auto dark:!text-[#9da7b3]" icon={<Clock3 className="size-4" />} aria-label={`视频生成时长：${seconds}秒`} title={`${seconds}秒`}>
                <span className="hidden text-xs sm:block">{seconds}s</span>
            </Button>
        </Popover>
    );
}

function CreativeSettingsSurface({ theme, children }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; children: ReactNode }) {
    return (
        <div className="space-y-4 rounded-2xl px-2 py-1 text-sm" style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
            {children}
        </div>
    );
}

function CreativeSettingSection({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <section className="space-y-2.5">
            <p className="text-xs font-medium" style={{ color }}>
                {title}
            </p>
            {children}
        </section>
    );
}

function CreativeChoiceButton({ selected, theme, onClick, children }: { selected: boolean; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            className="flex h-11 items-center justify-center rounded-xl border px-2 text-sm transition hover:opacity-80"
            style={{ borderColor: selected ? theme.node.text : theme.node.stroke, background: selected ? theme.node.fill : "transparent", color: theme.node.text }}
            aria-pressed={selected}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function CreativeAspectOption({ selected, theme, item, onClick }: { selected: boolean; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; item: { value: string; label: string; width: number; height: number }; onClick: () => void }) {
    return (
        <button
            type="button"
            className="flex h-[70px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl border px-1 text-xs transition hover:opacity-80"
            style={{ borderColor: selected ? theme.node.text : "transparent", background: selected ? theme.node.fill : "transparent", color: theme.node.text }}
            aria-pressed={selected}
            onClick={onClick}
        >
            <CreativeAspectIcon width={item.width} height={item.height} theme={theme} />
            <span className="truncate">{item.label}</span>
        </button>
    );
}

function CreativeAspectIcon({ width, height, theme }: { width: number; height: number; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    if (!width || !height) return <Circle className="size-4" style={{ color: theme.node.text }} />;
    const ratio = width / height;
    const boxWidth = ratio >= 1 ? 22 : Math.max(10, Math.round(22 * ratio));
    const boxHeight = ratio >= 1 ? Math.max(10, Math.round(22 / ratio)) : 22;
    return (
        <span className="grid h-6 w-8 place-items-center">
            <span className="rounded-[3px] border-2" style={{ width: boxWidth, height: boxHeight, borderColor: theme.node.text }} />
        </span>
    );
}

function CreativeImageDimensionControls({ size, theme, onChange }: { size: string; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onChange: (value: string) => void }) {
    const dimensions = creativeImageDimensionsForSize(size);
    return (
        <CreativeSettingSection title="尺寸" color={theme.node.muted}>
            <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
                <CreativeDimensionField prefix="W" value={dimensions.width} theme={theme} onChange={(value) => onChange(`${value}x${dimensions.height}`)} />
                <Link2 className="size-4 opacity-55" />
                <CreativeDimensionField prefix="H" value={dimensions.height} theme={theme} onChange={(value) => onChange(`${dimensions.width}x${value}`)} />
                <span className="text-xs opacity-55">PX</span>
            </div>
        </CreativeSettingSection>
    );
}

function CreativeDimensionField({ prefix, value, theme, onChange }: { prefix: string; value: number; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onChange: (value: number) => void }) {
    const [draft, setDraft] = useState(String(value || ""));
    useEffect(() => setDraft(String(value || "")), [value]);
    const commit = () => {
        const next = Math.max(1, Math.floor(Number(draft) || value || 1024));
        setDraft(String(next));
        onChange(next);
    };
    return (
        <label className="flex h-11 min-w-0 items-center overflow-hidden rounded-xl px-2.5" style={{ background: theme.node.fill, color: theme.node.text }}>
            <span className="mr-2 text-xs font-medium opacity-60">{prefix}</span>
            <input
                type="number"
                min={1}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                className="min-w-0 flex-1 bg-transparent text-right text-sm font-semibold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
        </label>
    );
}

function CreativeSwitchRow({ label, checked, theme, onChange }: { label: string; checked: boolean; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex h-8 items-center justify-between gap-3">
            <span className="text-sm">{label}</span>
            <Switch size="small" checked={checked} onChange={onChange} />
        </div>
    );
}

function creativeImageAspectForSize(size: string) {
    if (size === "auto") return "auto";
    const direct = creativeImageAspectOptions.find((item) => item.value === size);
    if (direct) return direct.value;
    const dimensions = parseImageDimensions(size);
    if (!dimensions) return "auto";
    return closestCreativeAspect(
        dimensions.width / dimensions.height,
        creativeImageAspectOptions.filter((item) => item.value !== "auto"),
    );
}

function creativeImageResolutionForSize(size: string) {
    const dimensions = parseImageDimensions(size);
    if (!dimensions) return "2k";
    const maxSide = Math.max(dimensions.width, dimensions.height);
    if (maxSide >= 3000) return "4k";
    if (maxSide >= 1900) return "2k";
    return "1.5k";
}

function closestCreativeAspect(ratio: number, candidates: ReadonlyArray<{ value: string; width: number; height: number }>) {
    return candidates.reduce((best, candidate) => {
        const bestRatio = best.width / best.height;
        const candidateRatio = candidate.width / candidate.height;
        return Math.abs(Math.log(ratio / candidateRatio)) < Math.abs(Math.log(ratio / bestRatio)) ? candidate : best;
    }).value;
}

function imageSizeForOptions(aspect: string, resolution: string) {
    const option = creativeImageResolutionOptions.find((item) => item.value === resolution) || creativeImageResolutionOptions[1];
    if (aspect === "auto") return "auto";
    const ratio = creativeImageAspectOptions.find((item) => item.value === aspect) || creativeImageAspectOptions[2];
    const longSide = option.maxSide;
    const width = ratio.width >= ratio.height ? longSide : alignCreativeDimension((longSide * ratio.width) / ratio.height);
    const height = ratio.width >= ratio.height ? alignCreativeDimension((longSide * ratio.height) / ratio.width) : longSide;
    return `${width}x${height}`;
}

function alignCreativeDimension(value: number) {
    return Math.max(16, Math.round(value / 16) * 16);
}

function creativeImageAspectLabel(size: string) {
    return creativeImageAspectOptions.find((item) => item.value === creativeImageAspectForSize(size))?.label || "智能";
}

function creativeImageResolutionLabel(size: string) {
    return creativeImageResolutionOptions.find((item) => item.value === creativeImageResolutionForSize(size))?.shortLabel || "2K";
}

function creativeImageDimensionsForSize(size: string) {
    const dimensions = parseImageDimensions(size);
    if (dimensions) return dimensions;
    return parseImageDimensions(imageSizeForOptions(creativeImageAspectForSize(size), creativeImageResolutionForSize(size))) || { width: 2048, height: 2048 };
}

function creativeVideoAspectForSize(size: string) {
    const ratio = normalizeSeedanceRatio(size);
    return ratio === "adaptive" ? "16:9" : ratio;
}

function creativeVideoResolutionForValue(value: string) {
    const normalized = String(value || "720").replace(/p$/i, "");
    return creativeVideoResolutionOptions.some((item) => item.value === normalized) ? normalized : "720";
}

function creativeVideoAspectLabel(size: string) {
    return creativeVideoAspectOptions.find((item) => item.value === creativeVideoAspectForSize(size))?.label || "16:9";
}

function creativeVideoResolutionLabel(value: string) {
    return creativeVideoResolutionOptions.find((item) => item.value === creativeVideoResolutionForValue(value))?.label || "720P";
}

function normalizeCreativeVideoDuration(value: string, min = 5) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.max(min, Math.min(15, Math.floor(parsed)));
}

function directModel(config: AiConfig, mode: DirectCreationMode) {
    return mode === "text" ? config.textModel : mode === "image" ? config.imageModel : config.videoModel;
}

function directModelKey(mode: DirectCreationMode): "textModel" | "imageModel" | "videoModel" {
    return mode === "text" ? "textModel" : mode === "image" ? "imageModel" : "videoModel";
}

function videoMethodLabel(value: DirectVideoMethod) {
    return value === "text" ? "文生视频" : value === "reference" ? "参考生成" : "自动判断";
}

function skillAvailableInMode(skill: SkillOption, mode: CreationMode) {
    if (mode === "agent") return true;
    if (mode === "text") return skill.workspaces?.includes("image") || skill.workspaces?.includes("video") || skill.workspaces?.includes("drama") || false;
    return (skill.workspaces || ["image"]).includes(mode);
}

function skillOptionVisual(skill: SkillOption) {
    if (skill.action === "edit") return { icon: Sparkles, surfaceClass: "bg-violet-50 dark:bg-violet-400/10", iconClass: "text-violet-600 dark:text-violet-300" };
    if (skill.workspaces?.includes("video")) return { icon: FileVideo, surfaceClass: "bg-emerald-50 dark:bg-emerald-400/10", iconClass: "text-emerald-600 dark:text-emerald-300" };
    if (skill.workspaces?.includes("image")) return { icon: ImageIcon, surfaceClass: "bg-sky-50 dark:bg-sky-400/10", iconClass: "text-sky-600 dark:text-sky-300" };
    return { icon: Boxes, surfaceClass: "bg-slate-100 dark:bg-slate-400/10", iconClass: "text-slate-600 dark:text-slate-300" };
}

function mentionDraftAt(value: string, caret: number): MentionDraft | null {
    const beforeCaret = value.slice(0, caret);
    const match = beforeCaret.match(/@([^\s@]*)$/);
    if (!match) return null;

    const start = caret - match[0].length;
    if (start > 0 && !/\s/.test(value[start - 1] || "")) return null;

    return {
        start,
        end: caret,
        query: match[1] || "",
    };
}

function mentionLabel(asset: CreateOverviewAsset) {
    return (asset.title || `${asset.kind}内容`).trim().replace(/\s+/g, "_").slice(0, 48);
}

function recentAssetAllowedInMode(asset: CreateOverviewAsset, mode: CreationMode) {
    if (mode === "agent" || mode === "video") return asset.kind === "image" || asset.kind === "video" || asset.kind === "audio";
    return asset.kind === "image";
}

function recentAssetKindLabel(kind: CreateOverviewAsset["kind"]) {
    return kind === "image" ? "图片" : kind === "video" ? "视频" : "音频";
}

function formatRecentAssetDate(value: string) {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return "最近";
    return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(timestamp);
}
