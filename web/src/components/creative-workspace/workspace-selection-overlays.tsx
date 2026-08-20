"use client";

import { LoaderCircle, SendHorizontal } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";

import styles from "./creative-workspace.module.css";
import { resolveWorkspaceFloatingPlacement, type WorkspaceFloatingSide, type WorkspaceRect } from "./workspace-floating-placement";

export type WorkspaceSelectionDimensions = Readonly<{
    width: number;
    height: number;
    editable?: boolean;
    locked?: boolean;
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
}>;

export type WorkspaceSelectionSizeBarProps = Readonly<{
    selectionBounds: WorkspaceRect | null;
    viewportBounds: WorkspaceRect;
    dimensions: WorkspaceSelectionDimensions;
    onCommit?: (dimensions: Readonly<{ width: number; height: number }>) => void | Promise<void>;
    actions?: ReactNode;
    preferredSide?: WorkspaceFloatingSide;
    ariaLabel?: string;
}>;

export type WorkspaceSelectionPromptProps = Readonly<{
    selectionBounds: WorkspaceRect | null;
    viewportBounds: WorkspaceRect;
    value: string;
    onChange: (value: string) => void;
    onSubmit: (value: string) => void | Promise<void>;
    placeholder?: string;
    submitLabel?: string;
    busy?: boolean;
    disabled?: boolean;
    leading?: ReactNode;
    trailing?: ReactNode;
    preferredSide?: WorkspaceFloatingSide;
    ariaLabel?: string;
}>;

const SIZE_BAR_ESTIMATE = Object.freeze({ width: 360, height: 46 });
const PROMPT_ESTIMATE = Object.freeze({ width: 640, height: 116 });

export function WorkspaceSelectionSizeBar({ selectionBounds, viewportBounds, dimensions, onCommit, actions, preferredSide = "top", ariaLabel = "选区尺寸" }: WorkspaceSelectionSizeBarProps) {
    const [draft, setDraft] = useState(() => dimensionDraft(dimensions));
    const [committing, setCommitting] = useState(false);
    const committingRef = useRef(false);
    const editable = Boolean(dimensions.editable && !dimensions.locked && onCommit);
    const placement = useMemo(
        () => (selectionBounds ? resolveWorkspaceFloatingPlacement({ anchor: selectionBounds, viewport: viewportBounds, floatingSize: SIZE_BAR_ESTIMATE, preferredSide, gap: 10 }) : null),
        [preferredSide, selectionBounds, viewportBounds],
    );

    useEffect(() => setDraft({ width: String(roundedDimension(dimensions.width)), height: String(roundedDimension(dimensions.height)) }), [dimensions.height, dimensions.width]);

    if (!selectionBounds || !placement) return null;

    const commit = async () => {
        if (!editable || committingRef.current || !onCommit) return;
        const next = normalizedDimensions(draft, dimensions);
        setDraft({ width: String(next.width), height: String(next.height) });
        if (next.width === roundedDimension(dimensions.width) && next.height === roundedDimension(dimensions.height)) return;
        committingRef.current = true;
        setCommitting(true);
        try {
            await onCommit(next);
        } finally {
            committingRef.current = false;
            setCommitting(false);
        }
    };

    return (
        <form
            className={styles.selectionSizeBar}
            style={floatingStyle(placement, viewportBounds)}
            data-workspace-selection-size-bar
            data-side={placement.side}
            aria-label={ariaLabel}
            onSubmit={(event) => {
                event.preventDefault();
                void commit();
            }}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void commit();
            }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <DimensionField label="W" value={draft.width} disabled={!editable || committing} onChange={(width) => setDraft((current) => ({ ...current, width }))} onCommit={() => void commit()} />
            <span className={styles.selectionDimensionCross} aria-hidden="true">
                ×
            </span>
            <DimensionField label="H" value={draft.height} disabled={!editable || committing} onChange={(height) => setDraft((current) => ({ ...current, height }))} onCommit={() => void commit()} />
            {dimensions.locked ? <span className={styles.selectionLockLabel}>已锁定</span> : null}
            {actions ? <span className={styles.selectionOverlayActions}>{actions}</span> : null}
            {committing ? <LoaderCircle className={styles.selectionOverlaySpinner} size={14} aria-label="正在更新尺寸" /> : null}
        </form>
    );
}

export function WorkspaceSelectionPrompt({
    selectionBounds,
    viewportBounds,
    value,
    onChange,
    onSubmit,
    placeholder = "描述你想如何修改当前选区…",
    submitLabel = "提交生成",
    busy = false,
    disabled = false,
    leading,
    trailing,
    preferredSide = "bottom",
    ariaLabel = "选区创作提示词",
}: WorkspaceSelectionPromptProps) {
    const promptId = useId();
    const placement = useMemo(
        () => (selectionBounds ? resolveWorkspaceFloatingPlacement({ anchor: selectionBounds, viewport: viewportBounds, floatingSize: PROMPT_ESTIMATE, preferredSide, gap: 14 }) : null),
        [preferredSide, selectionBounds, viewportBounds],
    );
    if (!selectionBounds || !placement) return null;
    const canSubmit = Boolean(value.trim()) && !busy && !disabled;

    const submit = (event?: FormEvent) => {
        event?.preventDefault();
        if (canSubmit) void onSubmit(value.trim());
    };
    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        submit();
    };

    return (
        <form className={styles.selectionPrompt} style={floatingStyle(placement, viewportBounds)} data-workspace-selection-prompt data-side={placement.side} aria-label={ariaLabel} onSubmit={submit} onPointerDown={(event) => event.stopPropagation()}>
            {leading ? <div className={styles.selectionPromptLeading}>{leading}</div> : null}
            <label className={styles.srOnly} htmlFor={promptId}>
                {ariaLabel}
            </label>
            <textarea id={promptId} className={styles.selectionPromptInput} value={value} placeholder={placeholder} disabled={disabled || busy} rows={2} onChange={(event) => onChange(event.target.value)} onKeyDown={handleKeyDown} />
            <div className={styles.selectionPromptFooter}>
                <span className={styles.selectionPromptHint}>Enter 发送 · Shift+Enter 换行</span>
                {trailing}
                <button type="submit" className={styles.selectionPromptSubmit} aria-label={submitLabel} title={submitLabel} disabled={!canSubmit}>
                    {busy ? <LoaderCircle className={styles.selectionOverlaySpinner} size={16} aria-hidden="true" /> : <SendHorizontal size={16} aria-hidden="true" />}
                </button>
            </div>
        </form>
    );
}

function DimensionField({ label, value, disabled, onChange, onCommit }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void; onCommit: () => void }) {
    return (
        <label className={styles.selectionDimensionField}>
            <span>{label}</span>
            <input
                inputMode="numeric"
                pattern="[0-9]*"
                value={value}
                disabled={disabled}
                aria-label={label === "W" ? "选区宽度" : "选区高度"}
                onChange={(event) => onChange(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    onCommit();
                }}
            />
        </label>
    );
}

function dimensionDraft(dimensions: Pick<WorkspaceSelectionDimensions, "width" | "height">) {
    return { width: String(roundedDimension(dimensions.width)), height: String(roundedDimension(dimensions.height)) };
}

function normalizedDimensions(draft: { width: string; height: string }, limits: WorkspaceSelectionDimensions) {
    return Object.freeze({
        width: clampDimension(Number(draft.width), limits.width, limits.minWidth, limits.maxWidth),
        height: clampDimension(Number(draft.height), limits.height, limits.minHeight, limits.maxHeight),
    });
}

function clampDimension(value: number, fallback: number, minimum = 1, maximum = 100_000) {
    const finite = Number.isFinite(value) && value > 0 ? value : fallback;
    return Math.min(Math.max(roundedDimension(finite), minimum), maximum);
}

function roundedDimension(value: number) {
    return Math.max(1, Math.round(Number.isFinite(value) ? value : 1));
}

function floatingStyle(placement: { x: number; y: number; availableWidth: number; availableHeight: number }, viewport: WorkspaceRect) {
    return {
        left: placement.x - viewport.x,
        top: placement.y - viewport.y,
        maxWidth: placement.availableWidth,
        maxHeight: Math.max(44, placement.availableHeight),
    };
}
