"use client";

import { Button, Select, Tooltip } from "antd";
import { ChevronDown, ChevronUp, Eye, EyeOff, Frame, Layers3, Lock, Unlock } from "lucide-react";

import type { DesignDocument, DesignOperationScope } from "@/lib/design";

import type { DesignEditorSelection, DesignLayerReorder } from "../model/design-editor-commands";

type Props = {
    document: DesignDocument;
    selection: DesignEditorSelection;
    onSelect: (selection: DesignEditorSelection) => void;
    onReorder: (direction: DesignLayerReorder) => void;
    onElementPatch: (elementId: string, patch: { locked?: boolean; hidden?: boolean }) => void;
    onMoveScope: (target: DesignOperationScope) => void;
};

export function DesignEditorLayers({ document, selection, onSelect, onReorder, onElementPatch, onMoveScope }: Props) {
    const selectedIds = selection?.kind === "elements" ? selection.ids : [];
    const selectedElements = document.elements.filter((element) => selectedIds.includes(element.id));
    const containsLocked = selectedElements.some((element) => element.locked);
    const scopeValue = selectedElements.length ? (selectedElements[0].frameId ?? "workspace") : null;
    const scopes = [{ value: "workspace", label: "Workspace" }, ...document.frames.map((frame) => ({ value: frame.id, label: frame.name }))];
    return (
        <div className="flex min-h-0 flex-1 flex-col" data-testid="design-layer-panel">
            <div className="border-b border-[#e7e9ed] px-3 py-2.5 dark:border-[#292e35]">
                <div className="flex items-center justify-between gap-2">
                    <div>
                        <h2 className="text-xs font-semibold">图层与作用域</h2>
                        <p className="mt-0.5 text-[9px] text-[#939baa]">顶部在前 · 锁定位置不被挤动</p>
                    </div>
                    <div className="flex items-center gap-0.5">
                        <LayerAction label="置底" disabled={!selectedIds.length || containsLocked} onClick={() => onReorder("back")}>
                            <ChevronDown className="size-3.5" />
                        </LayerAction>
                        <LayerAction label="后移一层" disabled={!selectedIds.length || containsLocked} onClick={() => onReorder("backward")}>
                            <ChevronDown className="size-3.5" />
                        </LayerAction>
                        <LayerAction label="前移一层" disabled={!selectedIds.length || containsLocked} onClick={() => onReorder("forward")}>
                            <ChevronUp className="size-3.5" />
                        </LayerAction>
                        <LayerAction label="置顶" disabled={!selectedIds.length || containsLocked} onClick={() => onReorder("front")}>
                            <ChevronUp className="size-3.5" />
                        </LayerAction>
                    </div>
                </div>
                <Select
                    className="mt-2 w-full"
                    size="small"
                    value={scopeValue}
                    placeholder="选择元素后移动作用域"
                    disabled={!selectedIds.length || containsLocked}
                    options={scopes}
                    onChange={(value) => onMoveScope(value === "workspace" ? { scope: "workspace" } : { scope: "frame", frameId: value })}
                />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                <LayerScope title="Workspace" icon={<Layers3 className="size-3.5" />} ids={document.layers.find((layer) => layer.scope === "workspace")?.elementIds ?? []} {...{ document, selectedIds, onSelect, onElementPatch }} />
                {document.frames.map((frame) => (
                    <div key={frame.id} className="mt-2">
                        <button
                            type="button"
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] font-medium ${selection?.kind === "frame" && selection.id === frame.id ? "bg-[#e8eefb] text-[#4968ad] dark:bg-[#263454]" : "hover:bg-[#f4f6f8] dark:hover:bg-[#20242b]"}`}
                            onClick={() => onSelect({ kind: "frame", id: frame.id })}
                        >
                            <Frame className="size-3.5" />
                            <span className="min-w-0 flex-1 truncate">{frame.name}</span>
                            {frame.locked ? <Lock className="size-3 text-[#9aa3af]" /> : null}
                        </button>
                        <LayerScope title="" ids={document.layers.find((layer) => layer.scope === "frame" && layer.frameId === frame.id)?.elementIds ?? []} {...{ document, selectedIds, onSelect, onElementPatch }} />
                    </div>
                ))}
            </div>
        </div>
    );
}

function LayerScope({
    title,
    icon,
    ids,
    document,
    selectedIds,
    onSelect,
    onElementPatch,
}: {
    title: string;
    icon?: React.ReactNode;
    ids: string[];
    document: DesignDocument;
    selectedIds: string[];
    onSelect: Props["onSelect"];
    onElementPatch: Props["onElementPatch"];
}) {
    return (
        <section>
            {title ? (
                <h3 className="mb-1 flex items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8a93a0]">
                    {icon}
                    {title}
                </h3>
            ) : null}
            <div className="space-y-0.5 pl-2">
                {[...ids].reverse().map((id) => {
                    const element = document.elements.find((candidate) => candidate.id === id);
                    if (!element) return null;
                    const selected = selectedIds.includes(id);
                    return (
                        <div key={id} className={`group flex items-center rounded-md text-[11px] ${selected ? "bg-[#e8eefb] text-[#4968ad] dark:bg-[#263454] dark:text-[#b7c9f5]" : "hover:bg-[#f4f6f8] dark:hover:bg-[#20242b]"}`}>
                            <button
                                type="button"
                                className="min-w-0 flex-1 truncate px-2 py-1.5 text-left"
                                title={element.name}
                                onClick={(event) => onSelect(toggleLayerSelection(selectedIds, id, event.shiftKey && selectedIds.every((selectedId) => ids.includes(selectedId))))}
                            >
                                {element.name}
                            </button>
                            <LayerAction label={element.hidden ? "显示" : "隐藏"} onClick={() => onElementPatch(id, { hidden: !element.hidden })}>
                                {element.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                            </LayerAction>
                            <LayerAction label={element.locked ? "解锁" : "锁定"} onClick={() => onElementPatch(id, { locked: !element.locked })}>
                                {element.locked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
                            </LayerAction>
                        </div>
                    );
                })}
                {!ids.length ? <p className="px-2 py-1 text-[10px] text-[#a0a7b1]">暂无元素</p> : null}
            </div>
        </section>
    );
}

function toggleLayerSelection(selectedIds: string[], id: string, additive: boolean): DesignEditorSelection {
    if (!additive) return { kind: "elements", ids: [id] };
    const ids = selectedIds.includes(id) ? selectedIds.filter((candidate) => candidate !== id) : [...selectedIds, id];
    return ids.length ? { kind: "elements", ids } : null;
}

function LayerAction({ label, disabled = false, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <Tooltip title={label}>
            <Button
                type="text"
                size="small"
                disabled={disabled}
                className="!size-6 !min-w-0 !p-0"
                aria-label={label}
                onClick={(event) => {
                    event.stopPropagation();
                    onClick();
                }}
            >
                {children}
            </Button>
        </Tooltip>
    );
}
