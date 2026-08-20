"use client";

import { Button, Input, Select, Switch } from "antd";
import { LockKeyhole, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { DESIGN_LIMITS, type DesignDocument, type DesignElement, type DesignFrame, type DesignOperation, type DesignTransform } from "@/lib/design";

import type { DesignEditorSelection } from "../model/design-editor-commands";

type Props = {
    document: DesignDocument;
    selection: DesignEditorSelection;
    onFramePatch: (patch: Extract<DesignOperation, { type: "update-frame" }>["patch"]) => void;
    onTransformPatch: (patch: Partial<DesignTransform>) => void;
    onElementPatch: (patch: Extract<DesignOperation, { type: "update-element" }>["patch"]) => void;
    onTextPatch: (patch: Extract<DesignOperation, { type: "update-text" }>["patch"]) => void;
    onShapePatch: (patch: Extract<DesignOperation, { type: "update-shape" }>["patch"]) => void;
    onLinePatch: (patch: Extract<DesignOperation, { type: "update-line" }>["patch"]) => void;
    onArrowPatch: (patch: Extract<DesignOperation, { type: "update-arrow" }>["patch"]) => void;
    onDelete: () => void;
};

export function DesignEditorInspector(props: Props) {
    const selection = props.selection;
    if (!selection) return <EmptyInspector document={props.document} />;
    if (selection.kind === "frame") {
        const frame = props.document.frames.find((candidate) => candidate.id === selection.id);
        return frame ? <FrameInspector {...props} frame={frame} /> : <EmptyInspector document={props.document} />;
    }
    if (selection.ids.length > 1) return <MultiElementInspector document={props.document} ids={selection.ids} onDelete={props.onDelete} />;
    const element = props.document.elements.find((candidate) => candidate.id === selection.ids[0]);
    return element ? <ElementInspector {...props} element={element} /> : <EmptyInspector document={props.document} />;
}

function MultiElementInspector({ document, ids, onDelete }: { document: DesignDocument; ids: string[]; onDelete: () => void }) {
    const elements = document.elements.filter((element) => ids.includes(element.id));
    const locked = elements.some((element) => element.locked);
    return (
        <InspectorBody title={`${elements.length} 个元素`} subtitle="同一作用域多选">
            <InspectorSection title="批量选择">
                <ReadOnlyRow label="作用域" value={elements[0]?.frameId ? (document.frames.find((frame) => frame.id === elements[0].frameId)?.name ?? elements[0].frameId) : "Workspace"} />
                <ReadOnlyRow label="可编辑" value={locked ? "含锁定元素" : "可以批量移动与排版"} />
            </InspectorSection>
            <Button block danger size="small" icon={<Trash2 className="size-3.5" />} disabled={locked} onClick={onDelete}>
                删除所选元素
            </Button>
        </InspectorBody>
    );
}

function FrameInspector({ document, frame, onFramePatch, onDelete }: Props & { frame: DesignFrame }) {
    const childCount = document.elements.filter((element) => element.frameId === frame.id).length;
    return (
        <InspectorBody title="画框" subtitle={frame.id}>
            <InspectorSection title="基础">
                <TextField label="名称" value={frame.name} disabled={frame.locked} onCommit={(name) => name && onFramePatch({ name })} />
                <ColorField label="背景" value={frame.background ?? "#ffffff"} disabled={frame.locked} onCommit={(background) => onFramePatch({ background })} />
                <ToggleRow label="锁定" checked={frame.locked} onChange={(locked) => onFramePatch({ locked })} />
            </InspectorSection>
            <InspectorSection title="位置与尺寸">
                <NumberGrid>
                    <NumberField label="X" value={frame.x} disabled={frame.locked} min={-DESIGN_LIMITS.maxCoordinate} max={DESIGN_LIMITS.maxCoordinate} onCommit={(x) => onFramePatch({ x })} />
                    <NumberField label="Y" value={frame.y} disabled={frame.locked} min={-DESIGN_LIMITS.maxCoordinate} max={DESIGN_LIMITS.maxCoordinate} onCommit={(y) => onFramePatch({ y })} />
                    <NumberField label="宽" value={frame.width} disabled={frame.locked} min={1} max={DESIGN_LIMITS.maxFrameEdge} integer onCommit={(width) => onFramePatch({ width })} />
                    <NumberField label="高" value={frame.height} disabled={frame.locked} min={1} max={DESIGN_LIMITS.maxFrameEdge} integer onCommit={(height) => onFramePatch({ height })} />
                </NumberGrid>
            </InspectorSection>
            <InspectorSection title="安全删除">
                <p className="rounded-md bg-[#f5f6f8] px-2.5 py-2 text-[11px] leading-5 text-[#788292] dark:bg-[#20242b] dark:text-[#9ba5b2]">{childCount ? `画框中还有 ${childCount} 个元素，本阶段不会静默级联删除。` : "该画框为空，可以安全删除。"}</p>
                <Button block danger size="small" icon={<Trash2 className="size-3.5" />} disabled={frame.locked || childCount > 0} onClick={onDelete}>
                    删除空画框
                </Button>
            </InspectorSection>
        </InspectorBody>
    );
}

function ElementInspector({ element, onTransformPatch, onElementPatch, onTextPatch, onShapePatch, onLinePatch, onArrowPatch, onDelete }: Props & { element: DesignElement }) {
    return (
        <InspectorBody title={elementTitle(element)} subtitle={element.id}>
            <InspectorSection title="基础">
                <TextField label="名称" value={element.name} disabled={element.locked} onCommit={(name) => name && onElementPatch({ name })} />
                <NumberField label="透明度" value={element.opacity} disabled={element.locked} min={0} max={1} step={0.05} onCommit={(opacity) => onElementPatch({ opacity })} />
                <ToggleRow label="锁定" checked={element.locked} onChange={(locked) => onElementPatch({ locked })} />
            </InspectorSection>
            <InspectorSection title="位置与变换">
                <NumberGrid>
                    <NumberField label="X" value={element.transform.x} disabled={element.locked} min={-DESIGN_LIMITS.maxCoordinate} max={DESIGN_LIMITS.maxCoordinate} onCommit={(x) => onTransformPatch({ x })} />
                    <NumberField label="Y" value={element.transform.y} disabled={element.locked} min={-DESIGN_LIMITS.maxCoordinate} max={DESIGN_LIMITS.maxCoordinate} onCommit={(y) => onTransformPatch({ y })} />
                    <NumberField label="宽" value={element.transform.width} disabled={element.locked} min={0.001} max={DESIGN_LIMITS.maxElementEdge} onCommit={(width) => onTransformPatch({ width })} />
                    <NumberField label="高" value={element.transform.height} disabled={element.locked} min={0.001} max={DESIGN_LIMITS.maxElementEdge} onCommit={(height) => onTransformPatch({ height })} />
                    <NumberField label="旋转" value={element.transform.rotation} disabled={element.locked} min={-360000} max={360000} onCommit={(rotation) => onTransformPatch({ rotation })} />
                </NumberGrid>
            </InspectorSection>
            {element.kind === "text" ? <TextStyle element={element} disabled={element.locked} onPatch={onTextPatch} /> : null}
            {element.kind === "shape" ? <ShapeStyle element={element} disabled={element.locked} onPatch={onShapePatch} /> : null}
            {element.kind === "line" ? <LineStyle element={element} disabled={element.locked} onPatch={onLinePatch} /> : null}
            {element.kind === "arrow" ? <ArrowStyle element={element} disabled={element.locked} onPatch={onArrowPatch} /> : null}
            {element.kind === "image" ? (
                <InspectorSection title="图片">
                    <p className="rounded-md bg-[#f5f8ff] px-2.5 py-2 text-[11px] leading-5 text-[#647493] dark:bg-[#1d2638] dark:text-[#aebfe3]">图片在素材阶段前只显示安全占位符，本阶段不读取受保护资源。</p>
                </InspectorSection>
            ) : null}
            <Button block danger size="small" icon={<Trash2 className="size-3.5" />} disabled={element.locked} onClick={onDelete}>
                删除元素
            </Button>
        </InspectorBody>
    );
}

function TextStyle({ element, disabled, onPatch }: { element: Extract<DesignElement, { kind: "text" }>; disabled: boolean; onPatch: Props["onTextPatch"] }) {
    return (
        <InspectorSection title="文字">
            <TextAreaField label="内容" value={element.text} disabled={disabled} onCommit={(text) => onPatch({ text })} />
            <NumberGrid>
                <NumberField label="字号" value={element.fontSize} disabled={disabled} min={0.1} max={10000} onCommit={(fontSize) => onPatch({ fontSize })} />
                <NumberField label="字重" value={element.fontWeight} disabled={disabled} min={1} max={1000} integer onCommit={(fontWeight) => onPatch({ fontWeight })} />
            </NumberGrid>
            <ColorField label="填充" value={element.fill} disabled={disabled} onCommit={(fill) => onPatch({ fill })} />
            <SelectField label="对齐" value={element.align} disabled={disabled} options={["left", "center", "right", "justify"]} labels={["左对齐", "居中", "右对齐", "两端对齐"]} onChange={(align) => onPatch({ align: align as typeof element.align })} />
        </InspectorSection>
    );
}

function ShapeStyle({ element, disabled, onPatch }: { element: Extract<DesignElement, { kind: "shape" }>; disabled: boolean; onPatch: Props["onShapePatch"] }) {
    return (
        <InspectorSection title="形状">
            <NullableColorField label="填充" value={element.fill} disabled={disabled} onCommit={(fill) => onPatch({ fill })} />
            <NullableColorField label="描边" value={element.stroke} disabled={disabled} onCommit={(stroke) => onPatch({ stroke })} />
            <NumberField label="描边宽度" value={element.strokeWidth} disabled={disabled} min={0} max={1000} onCommit={(strokeWidth) => onPatch({ strokeWidth })} />
            {element.shape === "rectangle" ? <NumberField label="圆角" value={element.cornerRadius} disabled={disabled} min={0} max={DESIGN_LIMITS.maxElementEdge} onCommit={(cornerRadius) => onPatch({ cornerRadius })} /> : null}
        </InspectorSection>
    );
}

function LineStyle({ element, disabled, onPatch }: { element: Extract<DesignElement, { kind: "line" }>; disabled: boolean; onPatch: Props["onLinePatch"] }) {
    return (
        <InspectorSection title="线条">
            <ColorField label="颜色" value={element.stroke} disabled={disabled} onCommit={(stroke) => onPatch({ stroke })} />
            <NumberField label="线宽" value={element.strokeWidth} disabled={disabled} min={0.001} max={1000} onCommit={(strokeWidth) => onPatch({ strokeWidth })} />
            <SelectField label="端点" value={element.cap} disabled={disabled} options={["butt", "round", "square"]} labels={["平头", "圆头", "方头"]} onChange={(cap) => onPatch({ cap: cap as typeof element.cap })} />
        </InspectorSection>
    );
}

function ArrowStyle({ element, disabled, onPatch }: { element: Extract<DesignElement, { kind: "arrow" }>; disabled: boolean; onPatch: Props["onArrowPatch"] }) {
    return (
        <InspectorSection title="箭头">
            <ColorField label="颜色" value={element.stroke} disabled={disabled} onCommit={(stroke) => onPatch({ stroke })} />
            <NumberField label="线宽" value={element.strokeWidth} disabled={disabled} min={0.001} max={1000} onCommit={(strokeWidth) => onPatch({ strokeWidth })} />
            <SelectField label="起点" value={element.startHead} disabled={disabled} options={["none", "arrow", "circle"]} labels={["无", "箭头", "圆点"]} onChange={(startHead) => onPatch({ startHead: startHead as typeof element.startHead })} />
            <SelectField label="终点" value={element.endHead} disabled={disabled} options={["none", "arrow", "circle"]} labels={["无", "箭头", "圆点"]} onChange={(endHead) => onPatch({ endHead: endHead as typeof element.endHead })} />
        </InspectorSection>
    );
}

function EmptyInspector({ document }: { document: DesignDocument }) {
    return (
        <InspectorBody title="项目检查器" subtitle="未选择对象">
            <InspectorSection title="文档状态">
                <ReadOnlyRow label="Schema" value={`v${document.schemaVersion}`} />
                <ReadOnlyRow label="Revision" value={`r${document.revision}`} />
                <ReadOnlyRow label="画框 / 元素" value={`${document.frames.length} / ${document.elements.length}`} />
            </InspectorSection>
            <InspectorSection title="操作提示">
                <div className="rounded-lg border border-[#dfe5f2] bg-[#f5f8ff] p-3 text-[11px] leading-5 text-[#5c6c8b] dark:border-[#2d3b58] dark:bg-[#1d2638] dark:text-[#aebfe3]">
                    点击画框或元素后可编辑属性。拖动控制柄缩放，元素顶部控制柄可旋转；按 Delete 删除。
                </div>
            </InspectorSection>
        </InspectorBody>
    );
}

function InspectorBody({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
    return (
        <>
            <div className="border-b border-[#e7e9ed] px-3 py-2.5 dark:border-[#292e35]">
                <h2 className="text-xs font-semibold">{title}</h2>
                <p className="mt-0.5 truncate text-[9px] text-[#939baa]" title={subtitle}>
                    {subtitle}
                </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
        </>
    );
}

function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="mb-5 space-y-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8a93a0]">{title}</h3>
            {children}
        </section>
    );
}

function NumberGrid({ children }: { children: ReactNode }) {
    return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

function FieldShell({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block min-w-0">
            <span className="mb-1 block text-[10px] text-[#7b8593] dark:text-[#939dab]">{label}</span>
            {children}
        </label>
    );
}

function TextField({ label, value, disabled, onCommit }: { label: string; value: string; disabled: boolean; onCommit: (value: string) => void }) {
    const [draft, setDraft] = useState<string>(value);
    useEffect(() => setDraft(value), [value]);
    return (
        <FieldShell label={label}>
            <Input size="small" value={draft} disabled={disabled} maxLength={200} onChange={(event) => setDraft(event.target.value)} onBlur={() => draft !== value && onCommit(draft.trim())} onPressEnter={(event) => event.currentTarget.blur()} />
        </FieldShell>
    );
}

function TextAreaField({ label, value, disabled, onCommit }: { label: string; value: string; disabled: boolean; onCommit: (value: string) => void }) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    return (
        <FieldShell label={label}>
            <Input.TextArea size="small" rows={3} value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onBlur={() => draft !== value && onCommit(draft)} />
        </FieldShell>
    );
}

function NumberField({ label, value, disabled, min, max, integer = false, step = 1, onCommit }: { label: string; value: number; disabled: boolean; min: number; max: number; integer?: boolean; step?: number; onCommit: (value: number) => void }) {
    const [draft, setDraft] = useState(String(value));
    useEffect(() => setDraft(String(value)), [value]);
    const commit = () => {
        const parsed = Number(draft);
        if (!Number.isFinite(parsed)) return setDraft(String(value));
        const next = integer ? Math.round(parsed) : Math.round(parsed * 1000) / 1000;
        if (next < min || next > max) return setDraft(String(value));
        if (next !== value) onCommit(next);
    };
    return (
        <FieldShell label={label}>
            <Input size="small" type="number" step={step} min={min} max={max} value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onPressEnter={(event) => event.currentTarget.blur()} />
        </FieldShell>
    );
}

function ColorField({ label, value, disabled, onCommit }: { label: string; value: `#${string}`; disabled: boolean; onCommit: (value: `#${string}`) => void }) {
    const [draft, setDraft] = useState<string>(value);
    useEffect(() => setDraft(value), [value]);
    const commit = () => {
        if (draft !== value && /^#[0-9a-f]{6}$/i.test(draft)) onCommit(draft as `#${string}`);
        else setDraft(value);
    };
    return (
        <FieldShell label={label}>
            <div className="flex items-center gap-2">
                <input className="h-6 w-8 cursor-pointer rounded border border-[#d9dde4] bg-transparent p-0.5" type="color" value={normalizeColor(value)} disabled={disabled} onChange={(event) => onCommit(event.target.value as `#${string}`)} />
                <Input className="min-w-0 flex-1" size="small" value={draft} disabled={disabled} maxLength={7} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onPressEnter={(event) => event.currentTarget.blur()} />
            </div>
        </FieldShell>
    );
}

function NullableColorField({ label, value, disabled, onCommit }: { label: string; value: `#${string}` | null; disabled: boolean; onCommit: (value: `#${string}` | null) => void }) {
    const display = value ?? "none";
    return (
        <TextField
            label={`${label}（none 表示无）`}
            value={display}
            disabled={disabled}
            onCommit={(next) => {
                if (next.toLowerCase() === "none") onCommit(null);
                else if (/^#[0-9a-f]{6}$/i.test(next)) onCommit(next as `#${string}`);
            }}
        />
    );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex items-center justify-between rounded-md border border-[#e5e8ed] px-2.5 py-1.5 dark:border-[#30353d]">
            <span className="flex items-center gap-1.5 text-[11px] text-[#6f7987] dark:text-[#9aa4b1]">
                <LockKeyhole className="size-3" /> {label}
            </span>
            <Switch size="small" checked={checked} onChange={onChange} />
        </div>
    );
}

function SelectField({ label, value, disabled, options, labels, onChange }: { label: string; value: string; disabled: boolean; options: string[]; labels: string[]; onChange: (value: string) => void }) {
    return (
        <FieldShell label={label}>
            <Select size="small" className="w-full" value={value} disabled={disabled} options={options.map((option, index) => ({ value: option, label: labels[index] }))} onChange={onChange} />
        </FieldShell>
    );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-[#f5f6f8] dark:hover:bg-[#20242b]">
            <span className="text-[#747e8d] dark:text-[#929ba8]">{label}</span>
            <span className="font-medium">{value}</span>
        </div>
    );
}

function normalizeColor(value: string) {
    return /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
}

function elementTitle(element: DesignElement) {
    if (element.kind === "shape") return element.shape === "rectangle" ? "矩形" : "椭圆";
    return { text: "文字", line: "线条", arrow: "箭头", image: "图片" }[element.kind];
}
