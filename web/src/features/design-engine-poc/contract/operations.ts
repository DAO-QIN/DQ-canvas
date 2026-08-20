import { cloneDesignPocDocument, normalizeDesignPocDocument } from "./document";
import type { DesignPocDocument, DesignPocElement, DesignPocOperation, DesignPocOperationError, DesignPocOperationReceipt } from "./types";

export function applyDesignPocOperations(document: DesignPocDocument, operations: DesignPocOperation[]) {
    let next = cloneDesignPocDocument(document);
    const receipt: DesignPocOperationReceipt = { status: "rejected", appliedOperationIds: [], createdElementIds: [], errors: [] };
    for (const operation of operations) {
        const outcome = applyOperation(next, operation);
        if (outcome.error) {
            receipt.errors.push(outcome.error);
            continue;
        }
        next = outcome.document;
        receipt.appliedOperationIds.push(operation.id);
        receipt.createdElementIds.push(...outcome.createdElementIds);
    }
    receipt.status = receipt.appliedOperationIds.length === operations.length ? "applied" : receipt.appliedOperationIds.length ? "partial" : "rejected";
    return { document: normalizeDesignPocDocument(next), receipt };
}

function applyOperation(document: DesignPocDocument, operation: DesignPocOperation): { document: DesignPocDocument; createdElementIds: string[]; error?: never } | { document: DesignPocDocument; createdElementIds: []; error: DesignPocOperationError } {
    const elements = document.elements;
    const index = "elementId" in operation ? elements.findIndex((element) => element.id === operation.elementId) : -1;
    if ("elementId" in operation && index < 0) return failure(document, operation.id, "ELEMENT_NOT_FOUND", `元素不存在：${operation.elementId}`);

    if (operation.type === "transform") {
        const source = elements[index];
        if (!Number.isFinite(operation.scale) || operation.scale <= 0 || !Number.isFinite(operation.dx) || !Number.isFinite(operation.dy) || !Number.isFinite(operation.rotation)) return failure(document, operation.id, "INVALID_OPERATION", "变换参数无效");
        return success(document, operation.id, [{ ...source, x: source.x + operation.dx, y: source.y + operation.dy, width: source.width * operation.scale, height: source.height * operation.scale, rotation: operation.rotation }]);
    }
    if (operation.type === "bring-forward") {
        const source = elements[index];
        const siblings = elements.filter((element) => element.frameId === source.frameId);
        const nextZ = Math.min(Math.max(...siblings.map((element) => element.zIndex)), source.zIndex + 1);
        return success(document, operation.id, [{ ...source, zIndex: nextZ }]);
    }
    if (operation.type === "crop-image") {
        const source = elements[index];
        if (source.kind !== "image") return failure(document, operation.id, "TYPE_MISMATCH", `元素不是图片：${source.id}`);
        const crop = operation.crop;
        if (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1 || crop.y + crop.height > 1)
            return failure(document, operation.id, "INVALID_OPERATION", "裁剪区域必须位于 0–1 范围内");
        return success(document, operation.id, [{ ...source, crop }]);
    }
    if (operation.type === "update-text") {
        const source = elements[index];
        if (source.kind !== "text") return failure(document, operation.id, "TYPE_MISMATCH", `元素不是文本：${source.id}`);
        if (operation.patch.fontSize <= 0 || operation.patch.lineHeight <= 0 || operation.patch.fontWeight <= 0 || !operation.patch.fontFamily.trim()) return failure(document, operation.id, "INVALID_OPERATION", "文本属性无效");
        return success(document, operation.id, [{ ...source, ...operation.patch }]);
    }
    if (operation.type === "align-horizontal-center") {
        const selected = selectElements(document, operation.elementIds);
        if (selected.error) return failure(document, operation.id, selected.error.code, selected.error.message);
        if (new Set(selected.elements.map((element) => element.frameId)).size !== 1) return failure(document, operation.id, "INVALID_OPERATION", "对齐元素必须位于同一 Frame");
        const center = (Math.min(...selected.elements.map((element) => element.x)) + Math.max(...selected.elements.map((element) => element.x + element.width))) / 2;
        return success(
            document,
            operation.id,
            selected.elements.map((element) => ({ ...element, x: center - element.width / 2 })),
        );
    }
    if (operation.type === "distribute-horizontal") {
        const selected = selectElements(document, operation.elementIds);
        if (selected.error) return failure(document, operation.id, selected.error.code, selected.error.message);
        if (selected.elements.length < 3) return failure(document, operation.id, "INVALID_OPERATION", "等距分布至少需要 3 个元素");
        if (new Set(selected.elements.map((element) => element.frameId)).size !== 1) return failure(document, operation.id, "INVALID_OPERATION", "分布元素必须位于同一 Frame");
        const sorted = selected.elements.toSorted((a, b) => a.x - b.x);
        const left = sorted[0].x;
        const right = sorted.at(-1)!.x + sorted.at(-1)!.width;
        const totalWidth = sorted.reduce((sum, element) => sum + element.width, 0);
        const gap = (right - left - totalWidth) / (sorted.length - 1);
        let cursor = left;
        return success(
            document,
            operation.id,
            sorted.map((element) => {
                const updated = { ...element, x: cursor };
                cursor += element.width + gap;
                return updated;
            }),
        );
    }
    if (operation.type === "duplicate-to-frame") {
        const target = document.frames.find((frame) => frame.id === operation.targetFrameId);
        if (!target) return failure(document, operation.id, "FRAME_NOT_FOUND", `目标 Frame 不存在：${operation.targetFrameId}`);
        const selected = selectElements(document, operation.elementIds);
        if (selected.error) return failure(document, operation.id, selected.error.code, selected.error.message);
        if (operation.newIds.length !== selected.elements.length || new Set(operation.newIds).size !== operation.newIds.length) return failure(document, operation.id, "INVALID_OPERATION", "复制结果 ID 数量或唯一性无效");
        if (operation.newIds.some((id) => elements.some((element) => element.id === id))) return failure(document, operation.id, "ID_CONFLICT", "复制结果 ID 已存在");
        const copies = selected.elements.map((element, copyIndex) => ({
            ...structuredClone(element),
            id: operation.newIds[copyIndex],
            frameId: target.id,
            name: `${element.name} 副本`,
            x: operation.offset.x + copyIndex * 60,
            y: operation.offset.y + copyIndex * 80,
            locked: false,
            zIndex: 50 + copyIndex,
        }));
        return { document: { ...document, elements: [...elements, ...copies] }, createdElementIds: copies.map((element) => element.id) };
    }
    return failure(document, (operation as DesignPocOperation).id, "INVALID_OPERATION", "不支持的操作");
}

function selectElements(document: DesignPocDocument, ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    const elements = uniqueIds.map((id) => document.elements.find((element) => element.id === id)).filter((element): element is DesignPocElement => Boolean(element));
    if (elements.length !== uniqueIds.length) return { elements: [], error: { code: "ELEMENT_NOT_FOUND" as const, message: "批量操作包含不存在的元素" } };
    return { elements };
}

function success(document: DesignPocDocument, _operationId: string, updates: DesignPocElement[]) {
    const updateMap = new Map(updates.map((element) => [element.id, element]));
    return { document: { ...document, elements: document.elements.map((element) => updateMap.get(element.id) || element) }, createdElementIds: [] as string[] };
}

function failure(document: DesignPocDocument, operationId: string, code: DesignPocOperationError["code"], message: string) {
    return { document, createdElementIds: [] as [], error: { operationId, code, message } };
}
