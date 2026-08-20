"use client";

import { Button, Modal, Tooltip } from "antd";
import { Download, FileAudio2, Film, ImageIcon, LoaderCircle, Maximize2, PencilLine, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AgentMarkdown } from "@/components/agent/agent-markdown";
import { SiteLogo } from "@/components/layout/site-logo";
import type { CreativeAsset } from "@/lib/creative-runtime-contract";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { cn } from "@/lib/utils";
import { userAvatarFallback } from "@/lib/user-avatar";
import { usePublicSessionStore } from "@/stores/use-public-session-store";

import { creationModeLabels } from "../creation-mode";
import type { DirectCreationMessage } from "../use-direct-creation";

export function DirectCreationMessages({ messages, onReuse }: { messages: DirectCreationMessage[]; onReuse: (message: DirectCreationMessage) => void }) {
    const endRef = useRef<HTMLDivElement>(null);
    const site = usePublicSessionStore((state) => state.payload?.settings?.site) || { title: "DQ-绘图", logoUrl: "/logo.svg" };
    const user = usePublicSessionStore((state) => state.payload?.user || null);
    const avatarUrl = user?.avatarUrl?.trim();
    const fallback = userAvatarFallback(user?.displayName || user?.username || "用户");

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [messages.at(-1)?.id, messages.at(-1)?.status]);

    return (
        <div className="mx-auto w-full max-w-[1120px] space-y-3 px-3 pb-4 pt-6 sm:space-y-8 sm:px-8 sm:pb-10 sm:pt-20">
            {messages.map((item) => (
                <article key={item.id} className={cn("flex items-start gap-3", item.role === "user" ? "justify-end" : "justify-start")}>
                    {item.role === "assistant" ? (
                        <span className="mt-1 grid size-7 shrink-0 place-items-center">
                            <SiteLogo logoUrl={site.logoUrl} className="size-5" />
                        </span>
                    ) : null}
                    <div className={cn("min-w-0", item.role === "user" ? "max-w-[85%] py-1" : "min-w-0 flex-1")}>
                        {item.role === "user" && item.assets?.length ? <DirectReferenceStrip assets={item.assets} /> : null}
                        {item.role === "assistant" ? (
                            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[#8b949f] dark:text-[#7f8996]">
                                <span className="font-medium text-[#4b5563] dark:text-[#c8d0da]">{creationModeLabels[item.mode]}</span>
                                <span className="max-w-56 truncate">{item.model}</span>
                                {item.status === "pending" ? <span>生成中</span> : item.status === "cancelled" ? <span>已停止</span> : null}
                            </div>
                        ) : null}
                        <div className={cn("break-words text-[15px] leading-7", item.status === "failed" && "text-red-600 dark:text-red-300", item.status === "cancelled" && "text-stone-400")}>
                            {item.role === "assistant" && item.status === "pending" ? <LoaderCircle className="mr-2 inline size-4 animate-spin text-stone-400" /> : null}
                            {item.role === "assistant" && item.mode === "text" && item.status === "completed" ? <AgentMarkdown>{item.content}</AgentMarkdown> : <span className="whitespace-pre-wrap">{item.content}</span>}
                        </div>
                        {item.role === "assistant" && item.resultUrls?.length ? <DirectMediaResults message={item} /> : null}
                        {item.role === "assistant" && item.error ? <p className="mt-2 text-xs leading-5 text-red-600 dark:text-red-300">{item.error}</p> : null}
                        {item.status !== "pending" ? (
                            <div className={cn("mt-1 flex", item.role === "user" ? "justify-end" : "justify-start")}>
                                <Tooltip title={item.role === "user" ? "编辑并重新创作" : "沿用本次设置再次创作"}>
                                    <Button type="text" size="small" className="!h-7 !px-1.5 !text-xs !text-stone-500" icon={item.role === "user" ? <PencilLine className="size-3.5" /> : <RotateCcw className="size-3.5" />} onClick={() => onReuse(item)}>
                                        {item.role === "user" ? "编辑" : "再次创作"}
                                    </Button>
                                </Tooltip>
                            </div>
                        ) : null}
                    </div>
                    {item.role === "user" ? (
                        <span className="mt-1 grid size-7 shrink-0 place-items-center overflow-hidden rounded-full" role="img" aria-label={user?.displayName || user?.username || "用户"}>
                            {avatarUrl ? (
                                <img src={avatarUrl} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                                <span className="grid size-full place-items-center bg-[#66758e] text-[10px] font-semibold text-white dark:bg-[#d8dee8] dark:text-[#252b33]">{fallback}</span>
                            )}
                        </span>
                    ) : null}
                </article>
            ))}
            <div ref={endRef} className="h-36 sm:h-40" aria-hidden="true" />
        </div>
    );
}

function DirectReferenceStrip({ assets }: { assets: CreativeAsset[] }) {
    return (
        <div className="mb-1.5 flex max-w-full flex-wrap justify-end gap-1.5" aria-label="本轮参考素材">
            {assets.map((asset) => {
                const url = asset.serverUrl || asset.remoteUrl || "";
                const Icon = asset.type === "video" ? Film : asset.type === "audio" ? FileAudio2 : ImageIcon;
                return (
                    <div
                        key={asset.id}
                        className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-stone-200 bg-stone-100 text-stone-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300"
                        title={asset.title}
                    >
                        {asset.type === "image" && url ? <img src={imagePreviewUrl(url, 192)} alt={asset.title || "参考图"} loading="lazy" className="size-full object-cover" /> : <Icon className="size-5" />}
                    </div>
                );
            })}
        </div>
    );
}

function DirectMediaResults({ message }: { message: DirectCreationMessage }) {
    const [previewUrl, setPreviewUrl] = useState("");
    const video = message.mode === "video";
    return (
        <>
            <div className={cn("mt-4 grid gap-2", video ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4")}>
                {message.resultUrls?.map((url, index) => (
                    <div key={`${url}-${index}`} className={cn("group/result relative overflow-hidden rounded-md border border-stone-200 bg-stone-100 dark:border-stone-700 dark:bg-stone-900", video ? "aspect-video" : "aspect-square")}>
                        {video ? <video src={url} muted playsInline preload="metadata" className="size-full object-cover" /> : <img src={imagePreviewUrl(url, 960)} alt={`生成结果 ${index + 1}`} className="size-full object-cover" />}
                        <button
                            type="button"
                            className="absolute inset-0 grid place-items-center bg-black/0 text-transparent transition group-hover/result:bg-black/20 group-hover/result:text-white"
                            onClick={() => setPreviewUrl(url)}
                            aria-label={`预览生成结果 ${index + 1}`}
                        >
                            <Maximize2 className="size-5" />
                        </button>
                        <a
                            href={url}
                            download
                            className="absolute bottom-2 right-2 grid size-8 place-items-center rounded-md bg-black/65 text-white opacity-0 transition hover:bg-black/80 group-hover/result:opacity-100"
                            aria-label={`下载生成结果 ${index + 1}`}
                        >
                            <Download className="size-4" />
                        </a>
                    </div>
                ))}
            </div>
            <Modal open={Boolean(previewUrl)} footer={null} centered destroyOnHidden width={video ? "min(1120px, calc(100vw - 24px))" : "min(960px, calc(100vw - 24px))"} onCancel={() => setPreviewUrl("")}>
                {previewUrl ? video ? <video src={previewUrl} controls autoPlay className="max-h-[78vh] w-full bg-black object-contain" /> : <img src={previewUrl} alt="生成结果预览" className="mx-auto max-h-[78vh] max-w-full object-contain" /> : null}
            </Modal>
        </>
    );
}
