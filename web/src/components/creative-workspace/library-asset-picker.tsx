"use client";

import { useState } from "react";
import { Alert, Button, Empty, Input, Modal, Pagination, Spin, Tag } from "antd";
import { Search } from "lucide-react";

import { useLibraryAssetPage } from "@/hooks/use-library-asset-page";
import { imagePreviewUrl } from "@/lib/media-image-url";
import type { Asset, AssetKind } from "@/lib/library-asset-contract";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/stores/use-user-store";

export type LibraryAssetStableLocator = Readonly<{ kind: "library-asset"; libraryAssetId: string }>;
export type LibraryAssetSelection = Readonly<{ locator: LibraryAssetStableLocator; asset: Asset }>;

export type LibraryAssetPickerProps = Readonly<{
    open: boolean;
    onSelect: (selection: LibraryAssetSelection) => void;
    onClose: () => void;
    allowedKinds?: readonly AssetKind[];
    title?: string;
}>;

const PAGE_SIZE = 8;
const KIND_OPTIONS = [
    { label: "全部", value: "all" },
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
    { label: "音频", value: "audio" },
] as const;

export function LibraryAssetPicker({ open, onSelect, onClose, allowedKinds, title = "选择素材" }: LibraryAssetPickerProps) {
    const userId = useUserStore((state) => state.user?.id || "");
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
    const [page, setPage] = useState(1);
    const options = KIND_OPTIONS.filter((option) => option.value === "all" || !allowedKinds || allowedKinds.includes(option.value));
    const effectiveKind = kindFilter !== "all" && allowedKinds && !allowedKinds.includes(kindFilter) ? "all" : kindFilter;
    const { assets, total, loading, error, reload } = useLibraryAssetPage({ userId: open ? userId : "", page, pageSize: PAGE_SIZE, kind: effectiveKind, keyword });
    const visibleAssets = allowedKinds ? assets.filter((asset) => allowedKinds.includes(asset.kind)) : assets;
    const ready = Boolean(userId && open && !loading && !error);

    return (
        <Modal
            title={title}
            open={open}
            onCancel={onClose}
            footer={null}
            width="min(760px, calc(100vw - 24px))"
            destroyOnHidden
            styles={{ body: { maxHeight: "min(620px, calc(100dvh - 140px))", overflowY: "auto", padding: "0 clamp(12px, 3vw, 24px) clamp(12px, 3vw, 24px)" } }}
        >
            <div className="space-y-4" data-library-asset-picker>
                <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                    <Input
                        className="w-full sm:w-56"
                        size="small"
                        prefix={<Search className="size-3.5 text-stone-400" />}
                        placeholder="搜索素材"
                        value={keyword}
                        allowClear
                        onChange={(event) => {
                            setPage(1);
                            setKeyword(event.target.value);
                        }}
                    />
                    <div className="hide-scrollbar flex max-w-full gap-1.5 overflow-x-auto pb-0.5">
                        {options.map((option) => (
                            <Tag.CheckableTag
                                key={option.value}
                                checked={effectiveKind === option.value}
                                className={cn("prompt-filter-tag", effectiveKind === option.value && "is-active")}
                                onChange={() => {
                                    setPage(1);
                                    setKindFilter(option.value);
                                }}
                            >
                                {option.label}
                            </Tag.CheckableTag>
                        ))}
                    </div>
                </div>

                {!ready && !error ? (
                    <div className="grid min-h-32 place-items-center sm:min-h-56">
                        <Spin size="small" description="正在加载素材" />
                    </div>
                ) : error ? (
                    <Alert
                        type="error"
                        showIcon
                        message="素材加载失败"
                        description={error}
                        action={
                            <Button size="small" onClick={reload}>
                                重试
                            </Button>
                        }
                    />
                ) : visibleAssets.length ? (
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
                        {visibleAssets.map((asset) => (
                            <LibraryAssetCard key={asset.id} asset={asset} onSelect={() => onSelect(libraryAssetSelection(asset))} />
                        ))}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有素材" className="!my-6 sm:!my-8" />
                )}

                {total > PAGE_SIZE ? (
                    <div className="flex justify-center">
                        <Pagination size="small" current={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} showSizeChanger={false} />
                    </div>
                ) : null}
            </div>
        </Modal>
    );
}

export function libraryAssetSelection(asset: Asset): LibraryAssetSelection {
    return Object.freeze({ locator: Object.freeze({ kind: "library-asset", libraryAssetId: asset.id }), asset });
}

function LibraryAssetCard({ asset, onSelect }: { asset: Asset; onSelect: () => void }) {
    const cover = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    return (
        <button
            type="button"
            className="group relative cursor-pointer overflow-hidden rounded-lg border border-stone-200 bg-white text-left transition hover:border-stone-400 hover:shadow-md dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-500"
            onClick={onSelect}
        >
            {cover ? (
                <img src={imagePreviewUrl(cover, 480)} alt={asset.title} loading="lazy" decoding="async" className="aspect-[4/3] w-full object-cover" />
            ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-3 text-center text-xs leading-5 text-stone-500 dark:bg-stone-800 dark:text-stone-400">{asset.title}</div>
            )}
            <div className="p-2.5">
                <div className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1 text-xs font-medium text-stone-800 dark:text-stone-200">{asset.title}</span>
                    <Tag className="m-0 shrink-0 text-[10px]">{assetKindLabel(asset.kind)}</Tag>
                </div>
            </div>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-stone-950/0 text-sm font-medium text-white opacity-0 transition group-hover:bg-stone-950/55 group-hover:opacity-100">插入</div>
        </button>
    );
}

function assetKindLabel(kind: AssetKind) {
    return kind === "image" ? "图片" : kind === "video" ? "视频" : kind === "audio" ? "音频" : "文本";
}
