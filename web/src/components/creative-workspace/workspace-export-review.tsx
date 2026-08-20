"use client";

/* Blob previews cannot use the Next image optimizer. */
/* eslint-disable @next/next/no-img-element */

import { Check, Download, Image as ImageIcon, LoaderCircle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import styles from "./workspace-export-review.module.css";
import { workspaceThemeStyle, type WorkspaceThemeTokens } from "./workspace-theme";

export const WORKSPACE_EXPORT_FORMATS = ["png", "jpeg", "webp"] as const;
export const WORKSPACE_EXPORT_SCALES = [1, 2, 3, 4] as const;
export const WORKSPACE_EXPORT_BACKGROUNDS = ["original", "transparent", "white"] as const;

export type WorkspaceExportFormat = (typeof WORKSPACE_EXPORT_FORMATS)[number];
export type WorkspaceExportScale = (typeof WORKSPACE_EXPORT_SCALES)[number];
export type WorkspaceExportBackground = (typeof WORKSPACE_EXPORT_BACKGROUNDS)[number];

export type WorkspaceExportSettings = Readonly<{
    format: WorkspaceExportFormat;
    scale: WorkspaceExportScale;
    quality: number;
    background: WorkspaceExportBackground;
}>;

export type WorkspaceExportReviewItem = Readonly<{
    id: string;
    name: string;
    width: number;
    height: number;
    detail?: string;
    selectedByDefault?: boolean;
}>;

export type WorkspaceExportProgress = Readonly<{
    completed: number;
    total: number;
    currentItemId: string | null;
    currentItemName: string | null;
}>;

export type WorkspaceExportRequest = Readonly<{
    itemIds: readonly string[];
    settings: WorkspaceExportSettings;
    reportProgress: (progress: WorkspaceExportProgress) => void;
}>;

export type WorkspaceExportReviewProps = {
    open: boolean;
    title: string;
    items: readonly WorkspaceExportReviewItem[];
    initialSettings: WorkspaceExportSettings;
    theme: WorkspaceThemeTokens;
    loadPreview?: (itemId: string, settings: Pick<WorkspaceExportSettings, "format" | "background">) => Promise<Blob>;
    onExport: (request: WorkspaceExportRequest) => Promise<void>;
    onClose: () => void;
};

type PreviewState = Readonly<{ status: "loading" | "ready" | "error"; url?: string; message?: string }>;

export function normalizeWorkspaceExportSettings(settings: WorkspaceExportSettings): WorkspaceExportSettings {
    const quality = Math.min(1, Math.max(0.1, Number.isFinite(settings.quality) ? settings.quality : 1));
    if (settings.format === "jpeg" && settings.background === "transparent") return { ...settings, background: "white", quality };
    return { ...settings, quality };
}

export function WorkspaceExportReview({ open, title, items, initialSettings, theme, loadPreview, onExport, onClose }: WorkspaceExportReviewProps) {
    const dialogRef = useRef<HTMLDialogElement | null>(null);
    const openerRef = useRef<HTMLElement | null>(null);
    const previewUrlsRef = useRef<string[]>([]);
    const itemKey = items.map((item) => `${item.id}:${item.selectedByDefault !== false}`).join("|");
    const settingsKey = `${initialSettings.format}:${initialSettings.scale}:${initialSettings.quality}:${initialSettings.background}`;
    const [selectedIds, setSelectedIds] = useState<Set<string>>(() => defaultSelection(items));
    const [settings, setSettings] = useState(() => normalizeWorkspaceExportSettings(initialSettings));
    const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<WorkspaceExportProgress | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [complete, setComplete] = useState(false);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open && !dialog.open) {
            openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            if (typeof dialog.showModal === "function") dialog.showModal();
            else dialog.setAttribute("open", "");
        } else if (!open && dialog.open) {
            if (typeof dialog.close === "function") dialog.close();
            else dialog.removeAttribute("open");
            const opener = openerRef.current;
            openerRef.current = null;
            if (opener && opener.isConnected) requestAnimationFrame(() => opener.focus());
        }
    }, [open]);

    useEffect(() => {
        if (!open) return;
        setSelectedIds(defaultSelection(items));
        setSettings(normalizeWorkspaceExportSettings(initialSettings));
        setBusy(false);
        setProgress(null);
        setError(null);
        setComplete(false);
    }, [itemKey, open, settingsKey, items, initialSettings]);

    useEffect(() => {
        revokePreviewUrls(previewUrlsRef.current);
        previewUrlsRef.current = [];
        if (!open || !loadPreview || !items.length) {
            setPreviews({});
            return;
        }
        let cancelled = false;
        setPreviews(Object.fromEntries(items.map((item) => [item.id, { status: "loading" as const }])));
        void (async () => {
            for (const item of items) {
                try {
                    const blob = await loadPreview(item.id, { format: settings.format, background: settings.background });
                    if (cancelled) continue;
                    const url = URL.createObjectURL(blob);
                    previewUrlsRef.current.push(url);
                    setPreviews((current) => ({ ...current, [item.id]: { status: "ready", url } }));
                } catch (previewError) {
                    if (!cancelled) setPreviews((current) => ({ ...current, [item.id]: { status: "error", message: errorMessage(previewError, "预览不可用") } }));
                }
            }
        })();
        return () => {
            cancelled = true;
            revokePreviewUrls(previewUrlsRef.current);
            previewUrlsRef.current = [];
        };
    }, [items, itemKey, loadPreview, open, settings.background, settings.format]);

    const selectedItems = useMemo(() => items.filter((item) => selectedIds.has(item.id)), [items, selectedIds]);
    const allSelected = items.length > 0 && selectedItems.length === items.length;
    const updateSettings = (patch: Partial<WorkspaceExportSettings>) => {
        setSettings((current) => normalizeWorkspaceExportSettings({ ...current, ...patch }));
        setComplete(false);
        setError(null);
    };
    const toggleItem = (id: string) => {
        setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
        setComplete(false);
        setError(null);
    };
    const close = () => {
        if (!busy) onClose();
    };
    const submit = async () => {
        if (!selectedItems.length || busy) return;
        setBusy(true);
        setComplete(false);
        setError(null);
        setProgress({ completed: 0, total: selectedItems.length, currentItemId: selectedItems[0]?.id ?? null, currentItemName: selectedItems[0]?.name ?? null });
        try {
            await onExport({ itemIds: selectedItems.map((item) => item.id), settings, reportProgress: setProgress });
            setProgress({ completed: selectedItems.length, total: selectedItems.length, currentItemId: null, currentItemName: null });
            setComplete(true);
        } catch (exportError) {
            setError(errorMessage(exportError, "导出失败"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <dialog
            ref={dialogRef}
            className={styles.dialog}
            style={workspaceThemeStyle(theme)}
            aria-label={title}
            aria-modal="true"
            data-workspace-export-review
            onCancel={(event) => {
                event.preventDefault();
                close();
            }}
            onClick={(event) => {
                if (event.target === event.currentTarget) close();
            }}
        >
            <section className={styles.panel}>
                <header className={styles.header}>
                    <div className={styles.heading}>
                        <h2>{title}</h2>
                        <span>
                            {selectedItems.length}/{items.length}
                        </span>
                    </div>
                    <button type="button" className={styles.iconButton} aria-label="关闭导出审阅" title="关闭" disabled={busy} onClick={close}>
                        <X size={17} aria-hidden="true" />
                    </button>
                </header>

                <div className={styles.body}>
                    <section className={styles.itemSection} aria-label="导出范围">
                        <div className={styles.sectionHeader}>
                            <strong>导出范围</strong>
                            <div className={styles.rangeActions}>
                                <button type="button" disabled={busy || allSelected} onClick={() => setSelectedIds(new Set(items.map((item) => item.id)))}>
                                    全选
                                </button>
                                <button type="button" disabled={busy || selectedIds.size === 0} onClick={() => setSelectedIds(new Set())}>
                                    清空
                                </button>
                            </div>
                        </div>
                        <div className={styles.itemList}>
                            {items.map((item) => {
                                const selected = selectedIds.has(item.id);
                                const preview = previews[item.id];
                                return (
                                    <label key={item.id} className={`${styles.itemRow} ${selected ? styles.itemSelected : ""}`}>
                                        <input type="checkbox" checked={selected} disabled={busy} onChange={() => toggleItem(item.id)} />
                                        <span className={styles.preview} style={{ aspectRatio: `${Math.max(1, item.width)} / ${Math.max(1, item.height)}` }}>
                                            {preview?.status === "ready" ? (
                                                <img src={preview.url} alt="" />
                                            ) : preview?.status === "loading" ? (
                                                <LoaderCircle className={styles.spinner} size={18} aria-label="正在生成预览" />
                                            ) : (
                                                <ImageIcon size={18} aria-hidden="true" />
                                            )}
                                        </span>
                                        <span className={styles.itemText}>
                                            <strong>{item.name}</strong>
                                            <small>
                                                {item.width} x {item.height}
                                                {item.detail ? ` · ${item.detail}` : ""}
                                            </small>
                                            {preview?.status === "error" ? <em>{preview.message}</em> : null}
                                        </span>
                                        {selected ? <Check className={styles.selectedIcon} size={16} aria-hidden="true" /> : null}
                                    </label>
                                );
                            })}
                        </div>
                    </section>

                    <section className={styles.settingsSection} aria-label="导出设置">
                        <SettingGroup label="格式">
                            <SegmentedControl label="导出格式" values={WORKSPACE_EXPORT_FORMATS} value={settings.format} disabled={busy} labels={{ png: "PNG", jpeg: "JPEG", webp: "WebP" }} onChange={(format) => updateSettings({ format })} />
                        </SettingGroup>
                        <SettingGroup label="倍率">
                            <SegmentedControl label="导出倍率" values={WORKSPACE_EXPORT_SCALES} value={settings.scale} disabled={busy} labels={{ 1: "1x", 2: "2x", 3: "3x", 4: "4x" }} onChange={(scale) => updateSettings({ scale })} />
                        </SettingGroup>
                        <SettingGroup label="背景">
                            <SegmentedControl
                                label="背景模式"
                                values={WORKSPACE_EXPORT_BACKGROUNDS}
                                value={settings.background}
                                disabled={busy}
                                disabledValues={settings.format === "jpeg" ? ["transparent"] : []}
                                labels={{ original: "画框", transparent: "透明", white: "白色" }}
                                onChange={(background) => updateSettings({ background })}
                            />
                        </SettingGroup>
                        <label className={styles.qualityRow}>
                            <span>质量</span>
                            <input
                                type="range"
                                min="10"
                                max="100"
                                step="5"
                                value={Math.round(settings.quality * 100)}
                                disabled={busy || settings.format === "png"}
                                aria-label="导出质量"
                                onChange={(event) => updateSettings({ quality: Number(event.currentTarget.value) / 100 })}
                            />
                            <output>{settings.format === "png" ? "无损" : `${Math.round(settings.quality * 100)}%`}</output>
                        </label>
                    </section>
                </div>

                <footer className={styles.footer}>
                    <div className={styles.progress} role={error ? "alert" : "status"}>
                        {error ? (
                            <span className={styles.error}>{error}</span>
                        ) : complete ? (
                            <span className={styles.success}>导出完成</span>
                        ) : busy && progress ? (
                            <span>
                                正在导出 {Math.min(progress.completed + 1, progress.total)}/{progress.total}
                                {progress.currentItemName ? ` · ${progress.currentItemName}` : ""}
                            </span>
                        ) : (
                            <span>{selectedItems.length > 1 ? `将打包 ${selectedItems.length} 项` : selectedItems.length === 1 ? "导出 1 项" : "未选择导出项"}</span>
                        )}
                    </div>
                    <button type="button" className={styles.secondaryButton} disabled={busy} onClick={close}>
                        {complete ? "完成" : "取消"}
                    </button>
                    <button type="button" className={styles.primaryButton} disabled={busy || !selectedItems.length} onClick={() => void submit()}>
                        {busy ? <LoaderCircle className={styles.spinner} size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
                        {complete ? "再次导出" : selectedItems.length > 1 ? "批量导出" : "导出"}
                    </button>
                </footer>
            </section>
        </dialog>
    );
}

function SettingGroup({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className={styles.settingGroup}>
            <span>{label}</span>
            {children}
        </div>
    );
}

function SegmentedControl<T extends string | number>({
    label,
    values,
    value,
    labels,
    disabled,
    disabledValues = [],
    onChange,
}: {
    label: string;
    values: readonly T[];
    value: T;
    labels: Record<T, string>;
    disabled: boolean;
    disabledValues?: readonly T[];
    onChange: (value: T) => void;
}) {
    return (
        <div className={styles.segmented} role="radiogroup" aria-label={label}>
            {values.map((entry) => (
                <button key={entry} type="button" role="radio" aria-checked={entry === value} className={entry === value ? styles.segmentActive : ""} disabled={disabled || disabledValues.includes(entry)} onClick={() => onChange(entry)}>
                    {labels[entry]}
                </button>
            ))}
        </div>
    );
}

function defaultSelection(items: readonly WorkspaceExportReviewItem[]) {
    const explicit = items.filter((item) => item.selectedByDefault).map((item) => item.id);
    return new Set(explicit.length ? explicit : items.map((item) => item.id));
}

function revokePreviewUrls(urls: readonly string[]) {
    for (const url of urls) URL.revokeObjectURL(url);
}

function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message.trim() ? error.message : fallback;
}
