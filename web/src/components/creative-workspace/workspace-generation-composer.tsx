"use client";

import { ArrowUp, FileText, Image as ImageIcon, LoaderCircle, Music2, Plus, Settings2, Square, Video, X } from "lucide-react";
import { useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";

import { ImageSettingsPanel, imageQualityLabel, imageSizeLabel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { canvasThemes, type CanvasColorTheme } from "@/lib/canvas-theme";
import type { ReferenceImage } from "@/types/image";

import styles from "./workspace-generation-composer.module.css";

export type WorkspaceGenerationCapability = NonNullable<ComponentProps<typeof ModelPicker>["capability"]>;

export type WorkspaceReferenceUploadKind = "image" | "video";

export type WorkspaceGenerationComposerProps = Readonly<{
    config: ComponentProps<typeof ModelPicker>["config"];
    colorTheme: CanvasColorTheme;
    prompt: string;
    references: readonly ReferenceImage[];
    lockedReferenceIds?: readonly string[];
    capability?: WorkspaceGenerationCapability;
    model?: string;
    busy?: boolean;
    disabled?: boolean;
    placeholder?: string;
    statusText?: string;
    ariaLabel?: string;
    submitLabel?: string;
    promptEditor?: ReactNode;
    referenceControl?: ReactNode;
    supplementaryControls?: ReactNode;
    settingsControl?: ReactNode;
    footerExtras?: ReactNode;
    allowReferenceUpload?: boolean;
    referenceUploadKinds?: readonly WorkspaceReferenceUploadKind[];
    onAddReferenceFiles?: (files: File[]) => void | Promise<void>;
    onPromptChange: (value: string) => void;
    onReferencesChange: (references: ReferenceImage[]) => void;
    onModelChange: (model: string) => void;
    onConfigChange: (key: "quality" | "size" | "count", value: string) => void;
    onSubmit: () => void;
    onStop?: () => void;
    onMissingConfig?: () => void;
}>;

const MAX_REFERENCES = 20;

/** Shared Asui-style composer. Surface adapters own task and reference semantics. */
export function WorkspaceGenerationComposer({
    config,
    colorTheme,
    prompt,
    references,
    lockedReferenceIds = [],
    capability = "image",
    model,
    busy = false,
    disabled = false,
    placeholder = "输入生成或修改指令，Enter 发送",
    statusText,
    ariaLabel = "图片生成",
    submitLabel,
    promptEditor,
    referenceControl,
    supplementaryControls,
    settingsControl,
    footerExtras,
    allowReferenceUpload = true,
    referenceUploadKinds = ["image"],
    onAddReferenceFiles,
    onPromptChange,
    onReferencesChange,
    onModelChange,
    onConfigChange,
    onSubmit,
    onStop,
    onMissingConfig,
}: WorkspaceGenerationComposerProps) {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const locked = new Set(lockedReferenceIds);
    const canSubmit = Boolean(prompt.trim()) && !busy && !disabled;
    const actionLabel = busy && onStop ? "停止生成" : submitLabel || `生成${capabilityLabel(capability)}`;
    const referenceAccept = referenceUploadKinds.flatMap(referenceMimeTypes).join(",");
    const referenceUploadLabel = referenceUploadKinds.includes("video") ? "添加参考素材" : "添加参考图";

    const submitFromKeyboard = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        if (canSubmit) onSubmit();
    };

    const addFiles = async (files: FileList | null) => {
        if (!files?.length) return;
        const available = Math.max(0, MAX_REFERENCES - references.length);
        const accepted = Array.from(files)
            .filter((file) => referenceUploadKinds.some((kind) => acceptsReferenceFile(file, kind)))
            .slice(0, available);
        if (onAddReferenceFiles) {
            await onAddReferenceFiles(accepted);
            return;
        }
        const next = await Promise.all(accepted.map(readReferenceFile));
        onReferencesChange([...references, ...next]);
    };

    return (
        <aside className={styles.positioner} aria-label={ariaLabel} data-workspace-generation-capability={capability}>
            <section className={styles.composer} data-testid="workspace-generation-composer">
                <input
                    ref={fileInputRef}
                    type="file"
                    accept={referenceAccept}
                    multiple
                    className={styles.hiddenInput}
                    onChange={(event) => {
                        void addFiles(event.currentTarget.files);
                        event.currentTarget.value = "";
                    }}
                />
                {promptEditor ? (
                    <div className={styles.promptEditor}>{promptEditor}</div>
                ) : (
                    <textarea
                        className={styles.prompt}
                        value={prompt}
                        disabled={disabled}
                        placeholder={placeholder}
                        aria-label={`${capabilityLabel(capability)}生成指令`}
                        onChange={(event) => onPromptChange(event.currentTarget.value)}
                        onKeyDown={submitFromKeyboard}
                    />
                )}
                {references.length ? (
                    <div className={styles.referenceStrip} aria-label="参考图">
                        {references.map((reference, index) => (
                            <figure className={styles.reference} key={reference.id} title={reference.name}>
                                <ReferencePreview reference={reference} label={`参考图 ${index + 1}`} />
                                <figcaption>{index + 1}</figcaption>
                                {!locked.has(reference.id) ? (
                                    <button type="button" aria-label={`移除参考图 ${index + 1}`} onClick={() => onReferencesChange(references.filter((item) => item.id !== reference.id))}>
                                        <X size={13} />
                                    </button>
                                ) : null}
                            </figure>
                        ))}
                    </div>
                ) : null}
                {statusText ? (
                    <p className={styles.status} role="status">
                        {statusText}
                    </p>
                ) : null}
                {supplementaryControls ? <div className={styles.supplementary}>{supplementaryControls}</div> : null}
                <footer className={styles.footer}>
                    {referenceControl ||
                        (allowReferenceUpload ? (
                            <button type="button" className={styles.iconButton} aria-label={referenceUploadLabel} title={referenceUploadLabel} disabled={disabled || references.length >= MAX_REFERENCES} onClick={() => fileInputRef.current?.click()}>
                                <Plus size={17} />
                            </button>
                        ) : null)}
                    <ModelPicker config={config} value={model ?? config.imageModel} onChange={onModelChange} capability={capability} className={styles.modelPicker} placeholder={`选择${capabilityLabel(capability)}模型`} onMissingConfig={onMissingConfig} />
                    {settingsControl ||
                        (capability === "image" ? (
                            <div className={styles.settingsWrap}>
                                <button type="button" className={styles.settingsButton} aria-label="图片生成参数" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}>
                                    <Settings2 size={14} />
                                    <span>
                                        {imageQualityLabel(config.quality || "auto")} · {imageSizeLabel(config.size || "auto")} · {Math.max(1, Number(config.count) || 1)} 张
                                    </span>
                                </button>
                                {settingsOpen ? (
                                    <div className={styles.settingsPanel}>
                                        <ImageSettingsPanel config={config} onConfigChange={onConfigChange} theme={canvasThemes[colorTheme]} showTitle={false} className="space-y-4" maxCount={10} quickCount={4} />
                                    </div>
                                ) : null}
                            </div>
                        ) : null)}
                    {footerExtras}
                    <button type="button" className={`${styles.submit} ${busy && onStop ? styles.stop : ""}`} disabled={busy ? !onStop : !canSubmit} aria-label={actionLabel} onClick={busy && onStop ? onStop : onSubmit}>
                        {busy ? onStop ? <Square size={13} fill="currentColor" /> : <LoaderCircle size={17} className={styles.spinner} /> : <ArrowUp size={17} />}
                    </button>
                </footer>
            </section>
        </aside>
    );
}

function ReferencePreview({ reference, label }: { reference: ReferenceImage; label: string }) {
    const source = reference.previewUrl || reference.url || reference.serverUrl || reference.dataUrl;
    if (source && reference.type.startsWith("video/")) return <video src={source} aria-label={label} muted playsInline preload="metadata" />;
    if (source && reference.type.startsWith("image/")) {
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={source} alt={label} />;
    }
    const Icon = reference.type.startsWith("audio/") ? Music2 : reference.type.startsWith("video/") ? Video : reference.type.startsWith("image/") ? ImageIcon : FileText;
    return (
        <span className={styles.referenceFallback} role="img" aria-label={label}>
            <Icon size={17} />
        </span>
    );
}

function capabilityLabel(capability: WorkspaceGenerationCapability) {
    return capability === "image" ? "图片" : capability === "video" ? "视频" : capability === "audio" ? "音频" : "文本";
}

function referenceMimeTypes(kind: WorkspaceReferenceUploadKind) {
    return kind === "video" ? ["video/mp4", "video/webm", "video/quicktime"] : ["image/png", "image/jpeg", "image/webp"];
}

function acceptsReferenceFile(file: File, kind: WorkspaceReferenceUploadKind) {
    return referenceMimeTypes(kind).includes(file.type.toLowerCase());
}

async function readReferenceFile(file: File): Promise<ReferenceImage> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("参考图读取失败")));
        reader.onerror = () => reject(reader.error || new Error("参考图读取失败"));
        reader.readAsDataURL(file);
    });
    return { id: clientId(), name: file.name, type: file.type, dataUrl, previewUrl: dataUrl };
}

function clientId() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
