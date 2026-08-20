"use client";

import { LibraryAssetPicker, type LibraryAssetSelection } from "@/components/creative-workspace";

export type InsertAssetPayload =
    | { kind: "text"; content: string; title: string }
    | { kind: "image"; dataUrl: string; title: string; storageKey?: string; remoteUrl?: string; serverUrl?: string }
    | { kind: "video"; url: string; title: string; storageKey?: string; remoteUrl?: string; serverUrl?: string; width?: number; height?: number }
    | { kind: "audio"; url: string; title: string; storageKey?: string; remoteUrl?: string; serverUrl?: string; durationMs?: number };

type Props = {
    open: boolean;
    defaultTab?: string;
    onInsert: (payload: InsertAssetPayload) => void;
    onClose: () => void;
};

/** Canvas compatibility wrapper. Shared selection emits a stable locator;
 * Canvas keeps consuming its existing runtime payload until its node model is migrated.
 */
export function AssetPickerModal({ open, onInsert, onClose }: Props) {
    return <LibraryAssetPicker open={open} onSelect={(selection) => onInsert(canvasInsertPayload(selection))} onClose={onClose} />;
}

export function canvasInsertPayload({ asset }: LibraryAssetSelection): InsertAssetPayload {
    if (asset.kind === "text") return { kind: "text", content: asset.data.content, title: asset.title };
    if (asset.kind === "video")
        return {
            kind: "video",
            url: asset.data.url,
            storageKey: asset.data.storageKey,
            remoteUrl: asset.data.remoteUrl,
            serverUrl: asset.data.serverUrl,
            title: asset.title,
            width: asset.data.width,
            height: asset.data.height,
        };
    if (asset.kind === "audio")
        return {
            kind: "audio",
            url: asset.data.url,
            storageKey: asset.data.storageKey,
            remoteUrl: asset.data.remoteUrl,
            serverUrl: asset.data.serverUrl,
            title: asset.title,
            durationMs: asset.data.durationMs,
        };
    return {
        kind: "image",
        dataUrl: asset.data.dataUrl,
        storageKey: asset.data.storageKey,
        remoteUrl: asset.data.remoteUrl,
        serverUrl: asset.data.serverUrl,
        title: asset.title,
    };
}
