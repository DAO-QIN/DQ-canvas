import { DESIGN_POC_SCHEMA_VERSION, type DesignPocDocument, type DesignPocElement } from "./types";

const MAX_COORDINATE = 100_000;

export function cloneDesignPocDocument(document: DesignPocDocument): DesignPocDocument {
    return structuredClone(document);
}

export function normalizeDesignPocDocument(value: unknown): DesignPocDocument {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("DesignPocDocument 必须是对象");
    const document = value as Partial<DesignPocDocument>;
    if (document.schemaVersion !== DESIGN_POC_SCHEMA_VERSION) throw new Error("DesignPocDocument 版本不受支持");
    if (!text(document.id) || !text(document.title)) throw new Error("DesignPocDocument 缺少稳定 ID 或标题");
    if (!Array.isArray(document.frames) || !document.frames.length) throw new Error("DesignPocDocument 至少需要一个 Frame");
    if (!Array.isArray(document.assets) || !Array.isArray(document.elements)) throw new Error("DesignPocDocument 资源或元素列表无效");

    const frameIds = new Set<string>();
    for (const frame of document.frames) {
        assertStableId(frame.id, "Frame");
        if (frameIds.has(frame.id)) throw new Error(`Frame ID 重复：${frame.id}`);
        frameIds.add(frame.id);
        finite(frame.x, `${frame.id}.x`);
        finite(frame.y, `${frame.id}.y`);
        positive(frame.width, `${frame.id}.width`);
        positive(frame.height, `${frame.id}.height`);
        if (!text(frame.name) || !text(frame.background)) throw new Error(`Frame 内容无效：${frame.id}`);
    }

    const assetIds = new Set<string>();
    for (const asset of document.assets) {
        assertStableId(asset.id, "资源");
        if (assetIds.has(asset.id)) throw new Error(`资源 ID 重复：${asset.id}`);
        assetIds.add(asset.id);
        if (asset.kind !== "image" || !/^\/design-poc\/[a-z0-9._-]+$/i.test(asset.src)) throw new Error(`资源必须使用受控站内路径：${asset.id}`);
        positive(asset.width, `${asset.id}.width`);
        positive(asset.height, `${asset.id}.height`);
    }

    const elementIds = new Set<string>();
    for (const element of document.elements) {
        validateElement(element, frameIds, assetIds);
        if (elementIds.has(element.id)) throw new Error(`元素 ID 重复：${element.id}`);
        elementIds.add(element.id);
    }

    const serialized = JSON.stringify(document);
    if (/"(?:src)":"(?:data:|blob:|https?:\/\/[^/])/i.test(serialized)) throw new Error("文档包含不允许的内联或站外资源");
    return normalizeDomainNumbers(cloneDesignPocDocument(document as DesignPocDocument));
}

export function canonicalDesignPocDocument(document: DesignPocDocument) {
    const normalized = normalizeDesignPocDocument(document);
    return {
        ...normalized,
        frames: normalized.frames.toSorted((a, b) => a.id.localeCompare(b.id)),
        assets: normalized.assets.toSorted((a, b) => a.id.localeCompare(b.id)),
        elements: normalized.elements.toSorted((a, b) => a.id.localeCompare(b.id)),
    };
}

export function designPocDocumentsEqual(left: DesignPocDocument, right: DesignPocDocument) {
    return JSON.stringify(canonicalDesignPocDocument(left)) === JSON.stringify(canonicalDesignPocDocument(right));
}

export function describeDesignPocDifference(left: DesignPocDocument, right: DesignPocDocument) {
    return firstDifference(canonicalDesignPocDocument(left), canonicalDesignPocDocument(right), "document") || "无字段差异";
}

function firstDifference(left: unknown, right: unknown, path: string): string | null {
    if (Object.is(left, right)) return null;
    if (typeof left !== typeof right || left === null || right === null) return `${path}: ${JSON.stringify(left)} !== ${JSON.stringify(right)}`;
    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right)) return `${path}: 数组类型不一致`;
        if (left.length !== right.length) return `${path}.length: ${left.length} !== ${right.length}`;
        for (let index = 0; index < left.length; index += 1) {
            const difference = firstDifference(left[index], right[index], `${path}[${index}]`);
            if (difference) return difference;
        }
        return null;
    }
    if (typeof left === "object") {
        const leftRecord = left as Record<string, unknown>;
        const rightRecord = right as Record<string, unknown>;
        const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].toSorted();
        for (const key of keys) {
            const difference = firstDifference(leftRecord[key], rightRecord[key], `${path}.${key}`);
            if (difference) return difference;
        }
        return null;
    }
    return `${path}: ${JSON.stringify(left)} !== ${JSON.stringify(right)}`;
}

function validateElement(element: DesignPocElement, frameIds: Set<string>, assetIds: Set<string>) {
    assertStableId(element.id, "元素");
    if (!frameIds.has(element.frameId)) throw new Error(`元素引用不存在的 Frame：${element.id}`);
    if (!text(element.name)) throw new Error(`元素名称为空：${element.id}`);
    finite(element.x, `${element.id}.x`);
    finite(element.y, `${element.id}.y`);
    positive(element.width, `${element.id}.width`);
    positive(element.height, `${element.id}.height`);
    finite(element.rotation, `${element.id}.rotation`);
    if (!Number.isFinite(element.opacity) || element.opacity < 0 || element.opacity > 1) throw new Error(`元素透明度无效：${element.id}`);
    if (!Number.isInteger(element.zIndex)) throw new Error(`元素层级无效：${element.id}`);
    if (element.kind === "image") {
        if (!assetIds.has(element.assetId)) throw new Error(`图片引用不存在的资源：${element.id}`);
        if (element.crop) validateCrop(element.crop, element.id);
    } else if (element.kind === "text") {
        if (!text(element.text) || !text(element.fontFamily)) throw new Error(`文本内容或字体无效：${element.id}`);
        positive(element.fontSize, `${element.id}.fontSize`);
        positive(element.lineHeight, `${element.id}.lineHeight`);
        finite(element.letterSpacing, `${element.id}.letterSpacing`);
    } else if (element.kind === "shape") {
        if (element.shape !== "rectangle" && element.shape !== "ellipse") throw new Error(`图形类型无效：${element.id}`);
        if (!text(element.fill) || !text(element.stroke)) throw new Error(`图形颜色无效：${element.id}`);
    } else {
        throw new Error(`元素类型无效：${(element as { id?: string }).id || "unknown"}`);
    }
}

function validateCrop(crop: { x: number; y: number; width: number; height: number }, id: string) {
    for (const [key, value] of Object.entries(crop)) {
        if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`裁剪参数越界：${id}.${key}`);
    }
    if (crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1 || crop.y + crop.height > 1) throw new Error(`裁剪区域无效：${id}`);
}

function assertStableId(value: unknown, label: string) {
    if (!text(value) || !/^[a-z][a-z0-9-]{2,119}$/i.test(String(value))) throw new Error(`${label} ID 无效`);
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function finite(value: unknown, label: string) {
    if (!Number.isFinite(value) || Math.abs(Number(value)) > MAX_COORDINATE) throw new Error(`${label} 必须是有限坐标`);
}

function positive(value: unknown, label: string) {
    finite(value, label);
    if (Number(value) <= 0) throw new Error(`${label} 必须大于 0`);
}

function normalizeDomainNumbers(document: DesignPocDocument): DesignPocDocument {
    return visitNumbers(document) as DesignPocDocument;
}

function visitNumbers(value: unknown): unknown {
    if (typeof value === "number") return Math.round(value * 1000) / 1000;
    if (Array.isArray(value)) return value.map(visitNumbers);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, visitNumbers(nested)]));
    }
    return value;
}
