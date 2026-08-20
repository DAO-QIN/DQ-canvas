"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Input, Modal } from "antd";
import { Check, MessageSquareText, RotateCcw, X } from "lucide-react";

import { imagePreviewUrl } from "@/lib/media-image-url";
import type { WorkspaceImageCropRect } from "./workspace-image-data";

export type WorkspaceImageAnnotationInput = {
    text: string;
    region: WorkspaceImageCropRect | null;
};

export type WorkspaceImageAnnotationDialogProps = {
    dataUrl: string;
    open: boolean;
    onClose: () => void;
    onConfirm: (input: WorkspaceImageAnnotationInput) => void;
    afterClose?: () => void;
};

const defaultRegion: WorkspaceImageCropRect = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };

export function WorkspaceImageAnnotationDialog({ dataUrl, open, onClose, onConfirm, afterClose }: WorkspaceImageAnnotationDialogProps) {
    const imageRef = useRef<HTMLImageElement>(null);
    const dragRef = useRef<{ startX: number; startY: number } | null>(null);
    const [text, setText] = useState("");
    const [region, setRegion] = useState<WorkspaceImageCropRect | null>(defaultRegion);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!open) return;
        setText("");
        setRegion(defaultRegion);
        setError("");
    }, [dataUrl, open]);

    const point = (event: ReactPointerEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        return {
            x: clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1),
            y: clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1),
        };
    };

    const start = (event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const current = point(event);
        dragRef.current = { startX: current.x, startY: current.y };
        setRegion({ x: current.x, y: current.y, width: 0.01, height: 0.01 });
    };

    const move = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag) return;
        event.preventDefault();
        const current = point(event);
        const x = Math.min(drag.startX, current.x);
        const y = Math.min(drag.startY, current.y);
        setRegion({ x, y, width: Math.max(0.01, Math.abs(current.x - drag.startX)), height: Math.max(0.01, Math.abs(current.y - drag.startY)) });
    };

    const stop = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!dragRef.current) return;
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };

    const submit = () => {
        const nextText = text.trim();
        if (!nextText) return setError("请输入批注内容");
        onConfirm({ text: nextText, region });
    };

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={onClose} afterClose={afterClose} footer={null} width={900} centered destroyOnHidden>
            <div className="grid gap-4 md:grid-cols-[minmax(320px,1fr)_300px]" data-testid="workspace-image-annotation-dialog">
                <div className="flex min-h-64 items-center justify-center overflow-hidden rounded-lg border bg-black/5 p-3">
                    <div className="relative inline-block max-w-full select-none">
                        <img ref={imageRef} src={imagePreviewUrl(dataUrl, 1920)} alt="待批注图片" className="block max-h-[65vh] max-w-full object-contain" draggable={false} />
                        <div className="absolute inset-0 cursor-crosshair touch-none" role="application" aria-label="拖动选择批注区域" onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop}>
                            {region ? <div className="pointer-events-none absolute border-2 border-sky-500 bg-sky-400/20 shadow-[0_0_0_9999px_rgba(0,0,0,.18)]" style={rectStyle(region)} /> : null}
                        </div>
                    </div>
                </div>
                <div className="flex min-w-0 flex-col gap-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <MessageSquareText className="size-5" />
                            <h2 className="text-xl font-semibold">添加图片批注</h2>
                        </div>
                    </div>
                    <Input.TextArea
                        autoFocus
                        value={text}
                        status={error ? "error" : undefined}
                        autoSize={{ minRows: 5, maxRows: 10 }}
                        maxLength={4000}
                        showCount
                        placeholder="描述要修改的内容，例如：将这一区域的材质改为磨砂金属"
                        onChange={(event) => {
                            setText(event.target.value);
                            setError("");
                        }}
                    />
                    {error ? (
                        <div role="alert" className="text-xs font-medium text-[#ef4444]">
                            {error}
                        </div>
                    ) : null}
                    <div className="text-xs opacity-60">{region ? `区域 ${percent(region.x)}, ${percent(region.y)} · ${percent(region.width)} x ${percent(region.height)}` : "整张图片"}</div>
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                        <Button icon={<RotateCcw className="size-4" />} onClick={() => setRegion(region ? null : defaultRegion)}>
                            {region ? "改为整图" : "选择区域"}
                        </Button>
                        <div className="flex items-center gap-2">
                            <Button icon={<X className="size-4" />} onClick={onClose}>
                                取消
                            </Button>
                            <Button type="primary" icon={<Check className="size-4" />} onClick={submit}>
                                保存批注
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </Modal>
    );
}

function rectStyle(region: WorkspaceImageCropRect) {
    return { left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` };
}

function percent(value: number) {
    return `${Math.round(value * 100)}%`;
}

function clamp(value: number, minimum: number, maximum: number) {
    return Math.min(maximum, Math.max(minimum, value));
}
