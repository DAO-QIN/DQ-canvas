import { DESIGN_ELEMENT_KINDS, DESIGN_EXPORT_FORMATS, DESIGN_EXPORT_SCALES, DESIGN_LIMITS, DESIGN_SCHEMA_VERSION } from "./limits";
import type {
    DesignAnnotation,
    DesignAnnotationTarget,
    DesignArrowElement,
    DesignAsset,
    DesignAssetVersion,
    DesignDocument,
    DesignDocumentMetadata,
    DesignElement,
    DesignElementBase,
    DesignExportSettings,
    DesignFrame,
    DesignGuide,
    DesignImageElement,
    DesignLayerScope,
    DesignLineElement,
    DesignNormalizedRect,
    DesignShapeElement,
    DesignStableResourceLocator,
    DesignTextElement,
    DesignTransform,
    DesignViewport,
    DesignWorkspace,
} from "./schema";

export type DesignValidationIssueCode = "INVALID_TYPE" | "UNKNOWN_FIELD" | "UNSUPPORTED_VERSION" | "INVALID_VALUE" | "LIMIT_EXCEEDED" | "DUPLICATE_ID" | "MISSING_REFERENCE" | "INVALID_LAYER" | "INVALID_ASSET_CHAIN" | "UNSAFE_RESOURCE";

export type DesignValidationIssue = {
    code: DesignValidationIssueCode;
    path: string;
    message: string;
};

export class DesignDocumentValidationError extends Error {
    readonly issues: DesignValidationIssue[];

    constructor(issue: DesignValidationIssue | DesignValidationIssue[]) {
        const issues = Array.isArray(issue) ? issue : [issue];
        super(issues.map((item) => `${item.path}: ${item.message}`).join("；"));
        this.name = "DesignDocumentValidationError";
        this.issues = issues;
    }
}

export type DesignDocumentParseResult = { success: true; document: DesignDocument } | { success: false; issues: DesignValidationIssue[] };

export function parseDesignDocumentV1(value: unknown): DesignDocument {
    const bytes = byteLength(value);
    if (bytes > DESIGN_LIMITS.maxDocumentBytes) fail("$", "LIMIT_EXCEEDED", `文档不得超过 ${DESIGN_LIMITS.maxDocumentBytes} 字节`);
    const root = record(value, "$", ["schemaVersion", "id", "revision", "metadata", "workspace", "guides", "frames", "elements", "layers", "assets", "assetVersions", "annotations"]);
    if (root.schemaVersion !== DESIGN_SCHEMA_VERSION) fail("$.schemaVersion", "UNSUPPORTED_VERSION", `只支持 Design Document v${DESIGN_SCHEMA_VERSION}`);

    const document: DesignDocument = {
        schemaVersion: DESIGN_SCHEMA_VERSION,
        id: stableId(root.id, "$.id"),
        revision: integer(root.revision, "$.revision", 0, Number.MAX_SAFE_INTEGER),
        metadata: metadata(root.metadata, "$.metadata"),
        workspace: workspace(root.workspace, "$.workspace"),
        guides: array(root.guides, "$.guides", DESIGN_LIMITS.maxGuides, guide),
        frames: array(root.frames, "$.frames", DESIGN_LIMITS.maxFrames, frame),
        elements: array(root.elements, "$.elements", DESIGN_LIMITS.maxElements, element),
        layers: array(root.layers, "$.layers", DESIGN_LIMITS.maxFrames + 1, layer),
        assets: array(root.assets, "$.assets", DESIGN_LIMITS.maxAssets, asset),
        assetVersions: array(root.assetVersions, "$.assetVersions", DESIGN_LIMITS.maxAssetVersions, assetVersion),
        annotations: array(root.annotations, "$.annotations", DESIGN_LIMITS.maxAnnotations, annotation),
    };
    validateRelations(document);
    return document;
}

export function safeParseDesignDocumentV1(value: unknown): DesignDocumentParseResult {
    try {
        return { success: true, document: parseDesignDocumentV1(value) };
    } catch (error) {
        if (error instanceof DesignDocumentValidationError) return { success: false, issues: error.issues };
        throw error;
    }
}

export function cloneDesignDocument(document: DesignDocument): DesignDocument {
    return structuredClone(document);
}

function metadata(value: unknown, path: string): DesignDocumentMetadata {
    const input = record(value, path, ["title", "description", "createdAt", "updatedAt"]);
    const createdAt = isoDate(input.createdAt, `${path}.createdAt`);
    const updatedAt = isoDate(input.updatedAt, `${path}.updatedAt`);
    if (Date.parse(updatedAt) < Date.parse(createdAt)) fail(`${path}.updatedAt`, "INVALID_VALUE", "更新时间不能早于创建时间");
    return {
        title: string(input.title, `${path}.title`, 1, DESIGN_LIMITS.maxTitleLength),
        description: string(input.description, `${path}.description`, 0, DESIGN_LIMITS.maxDescriptionLength),
        createdAt,
        updatedAt,
    };
}

function workspace(value: unknown, path: string): DesignWorkspace {
    const input = record(value, path, ["background", "viewport"]);
    return { background: color(input.background, `${path}.background`), viewport: viewport(input.viewport, `${path}.viewport`) };
}

function viewport(value: unknown, path: string): DesignViewport {
    const input = record(value, path, ["x", "y", "zoom"]);
    return {
        x: decimal(input.x, `${path}.x`, -DESIGN_LIMITS.maxCoordinate, DESIGN_LIMITS.maxCoordinate),
        y: decimal(input.y, `${path}.y`, -DESIGN_LIMITS.maxCoordinate, DESIGN_LIMITS.maxCoordinate),
        zoom: decimal(input.zoom, `${path}.zoom`, 0.01, 64),
    };
}

function frame(value: unknown, path: string): DesignFrame {
    const input = record(value, path, ["id", "name", "x", "y", "width", "height", "background", "locked", "export"]);
    const result: DesignFrame = {
        id: stableId(input.id, `${path}.id`),
        name: string(input.name, `${path}.name`, 1, DESIGN_LIMITS.maxNameLength),
        x: decimal(input.x, `${path}.x`, -DESIGN_LIMITS.maxCoordinate, DESIGN_LIMITS.maxCoordinate),
        y: decimal(input.y, `${path}.y`, -DESIGN_LIMITS.maxCoordinate, DESIGN_LIMITS.maxCoordinate),
        width: integer(input.width, `${path}.width`, 1, DESIGN_LIMITS.maxFrameEdge),
        height: integer(input.height, `${path}.height`, 1, DESIGN_LIMITS.maxFrameEdge),
        background: input.background === null ? null : color(input.background, `${path}.background`),
        locked: boolean(input.locked, `${path}.locked`),
        export: exportSettings(input.export, `${path}.export`),
    };
    if (result.width * result.export.scale > DESIGN_LIMITS.maxExportEdge || result.height * result.export.scale > DESIGN_LIMITS.maxExportEdge) fail(`${path}.export.scale`, "INVALID_VALUE", `默认导出边长不得超过 ${DESIGN_LIMITS.maxExportEdge} px`);
    return result;
}

function guide(value: unknown, path: string): DesignGuide {
    const input = record(value, path, ["id", "axis", "position", "frameId", "locked"]);
    return {
        id: stableId(input.id, `${path}.id`),
        axis: enumeration(input.axis, `${path}.axis`, ["horizontal", "vertical"] as const),
        position: decimal(input.position, `${path}.position`, -DESIGN_LIMITS.maxCoordinate, DESIGN_LIMITS.maxCoordinate),
        frameId: input.frameId === null ? null : stableId(input.frameId, `${path}.frameId`),
        locked: boolean(input.locked, `${path}.locked`),
    };
}

function exportSettings(value: unknown, path: string): DesignExportSettings {
    const input = record(value, path, ["format", "scale", "quality", "background"]);
    const result: DesignExportSettings = {
        format: enumeration(input.format, `${path}.format`, DESIGN_EXPORT_FORMATS),
        scale: enumeration(input.scale, `${path}.scale`, DESIGN_EXPORT_SCALES),
        quality: decimal(input.quality, `${path}.quality`, 0.01, 1),
        background: enumeration(input.background, `${path}.background`, ["frame", "transparent", "white"] as const),
    };
    if (result.format === "jpeg" && result.background === "transparent") fail(`${path}.background`, "INVALID_VALUE", "JPEG 导出不支持透明背景");
    return result;
}

function transform(value: unknown, path: string): DesignTransform {
    const input = record(value, path, ["x", "y", "width", "height", "rotation", "flipX", "flipY"]);
    return {
        x: decimal(input.x, `${path}.x`, -DESIGN_LIMITS.maxCoordinate, DESIGN_LIMITS.maxCoordinate),
        y: decimal(input.y, `${path}.y`, -DESIGN_LIMITS.maxCoordinate, DESIGN_LIMITS.maxCoordinate),
        width: decimal(input.width, `${path}.width`, 0.001, DESIGN_LIMITS.maxElementEdge),
        height: decimal(input.height, `${path}.height`, 0.001, DESIGN_LIMITS.maxElementEdge),
        rotation: decimal(input.rotation, `${path}.rotation`, -360_000, 360_000),
        flipX: boolean(input.flipX, `${path}.flipX`),
        flipY: boolean(input.flipY, `${path}.flipY`),
    };
}

function element(value: unknown, path: string): DesignElement {
    const discriminant = record(value, path).kind;
    if (!DESIGN_ELEMENT_KINDS.includes(discriminant as DesignElement["kind"])) fail(`${path}.kind`, "INVALID_VALUE", "元素类型不受支持");
    const commonKeys = ["id", "frameId", "kind", "name", "transform", "opacity", "blendMode", "locked", "hidden"];
    const kindKeys: Record<DesignElement["kind"], string[]> = {
        image: ["assetVersionId", "crop", "fit", "cornerRadius"],
        text: ["text", "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "align", "verticalAlign", "fill", "stroke", "strokeWidth"],
        shape: ["shape", "fill", "stroke", "strokeWidth", "cornerRadius"],
        line: ["stroke", "strokeWidth", "dash", "cap"],
        arrow: ["stroke", "strokeWidth", "dash", "startHead", "endHead"],
    };
    const kind = discriminant as DesignElement["kind"];
    const input = record(value, path, [...commonKeys, ...kindKeys[kind]]);
    const base: DesignElementBase = {
        id: stableId(input.id, `${path}.id`),
        frameId: input.frameId === null ? null : stableId(input.frameId, `${path}.frameId`),
        name: string(input.name, `${path}.name`, 1, DESIGN_LIMITS.maxNameLength),
        transform: transform(input.transform, `${path}.transform`),
        opacity: decimal(input.opacity, `${path}.opacity`, 0, 1),
        blendMode: enumeration(input.blendMode, `${path}.blendMode`, ["normal"] as const),
        locked: boolean(input.locked, `${path}.locked`),
        hidden: boolean(input.hidden, `${path}.hidden`),
    };
    if (kind === "image") return imageElement(input, path, base);
    if (kind === "text") return textElement(input, path, base);
    if (kind === "shape") return shapeElement(input, path, base);
    if (kind === "line") return lineElement(input, path, base);
    return arrowElement(input, path, base);
}

function imageElement(input: Record<string, unknown>, path: string, base: DesignElementBase): DesignImageElement {
    return {
        ...base,
        kind: "image",
        assetVersionId: stableId(input.assetVersionId, `${path}.assetVersionId`),
        crop: input.crop === null ? null : normalizedRect(input.crop, `${path}.crop`),
        fit: enumeration(input.fit, `${path}.fit`, ["fill", "contain", "cover"] as const),
        cornerRadius: decimal(input.cornerRadius, `${path}.cornerRadius`, 0, DESIGN_LIMITS.maxElementEdge),
    };
}

function textElement(input: Record<string, unknown>, path: string, base: DesignElementBase): DesignTextElement {
    return {
        ...base,
        kind: "text",
        text: string(input.text, `${path}.text`, 0, DESIGN_LIMITS.maxTextLength),
        fontFamily: string(input.fontFamily, `${path}.fontFamily`, 1, DESIGN_LIMITS.maxFontFamilyLength),
        fontSize: decimal(input.fontSize, `${path}.fontSize`, 0.1, 10_000),
        fontWeight: integer(input.fontWeight, `${path}.fontWeight`, 1, 1_000),
        fontStyle: enumeration(input.fontStyle, `${path}.fontStyle`, ["normal", "italic"] as const),
        lineHeight: decimal(input.lineHeight, `${path}.lineHeight`, 0.1, 20),
        letterSpacing: decimal(input.letterSpacing, `${path}.letterSpacing`, -1_000, 10_000),
        align: enumeration(input.align, `${path}.align`, ["left", "center", "right", "justify"] as const),
        verticalAlign: enumeration(input.verticalAlign, `${path}.verticalAlign`, ["top", "middle", "bottom"] as const),
        fill: color(input.fill, `${path}.fill`),
        stroke: input.stroke === null ? null : color(input.stroke, `${path}.stroke`),
        strokeWidth: decimal(input.strokeWidth, `${path}.strokeWidth`, 0, 1_000),
    };
}

function shapeElement(input: Record<string, unknown>, path: string, base: DesignElementBase): DesignShapeElement {
    return {
        ...base,
        kind: "shape",
        shape: enumeration(input.shape, `${path}.shape`, ["rectangle", "ellipse"] as const),
        fill: input.fill === null ? null : color(input.fill, `${path}.fill`),
        stroke: input.stroke === null ? null : color(input.stroke, `${path}.stroke`),
        strokeWidth: decimal(input.strokeWidth, `${path}.strokeWidth`, 0, 1_000),
        cornerRadius: decimal(input.cornerRadius, `${path}.cornerRadius`, 0, DESIGN_LIMITS.maxElementEdge),
    };
}

function lineElement(input: Record<string, unknown>, path: string, base: DesignElementBase): DesignLineElement {
    return {
        ...base,
        kind: "line",
        stroke: color(input.stroke, `${path}.stroke`),
        strokeWidth: decimal(input.strokeWidth, `${path}.strokeWidth`, 0.001, 1_000),
        dash: dash(input.dash, `${path}.dash`),
        cap: enumeration(input.cap, `${path}.cap`, ["butt", "round", "square"] as const),
    };
}

function arrowElement(input: Record<string, unknown>, path: string, base: DesignElementBase): DesignArrowElement {
    return {
        ...base,
        kind: "arrow",
        stroke: color(input.stroke, `${path}.stroke`),
        strokeWidth: decimal(input.strokeWidth, `${path}.strokeWidth`, 0.001, 1_000),
        dash: dash(input.dash, `${path}.dash`),
        startHead: enumeration(input.startHead, `${path}.startHead`, ["none", "arrow", "circle"] as const),
        endHead: enumeration(input.endHead, `${path}.endHead`, ["none", "arrow", "circle"] as const),
    };
}

function layer(value: unknown, path: string): DesignLayerScope {
    const discriminant = record(value, path).scope;
    if (discriminant === "workspace") {
        const input = record(value, path, ["scope", "elementIds"]);
        return { scope: "workspace", elementIds: idArray(input.elementIds, `${path}.elementIds`, DESIGN_LIMITS.maxElements) };
    }
    if (discriminant === "frame") {
        const input = record(value, path, ["scope", "frameId", "elementIds"]);
        return { scope: "frame", frameId: stableId(input.frameId, `${path}.frameId`), elementIds: idArray(input.elementIds, `${path}.elementIds`, DESIGN_LIMITS.maxElements) };
    }
    fail(`${path}.scope`, "INVALID_VALUE", "图层作用域必须是 workspace 或 frame");
}

function asset(value: unknown, path: string): DesignAsset {
    const input = record(value, path, ["id", "kind", "name", "currentVersionId", "versionIds"]);
    if (input.kind !== "image") fail(`${path}.kind`, "INVALID_VALUE", "当前只支持图片资源");
    return {
        id: stableId(input.id, `${path}.id`),
        kind: "image",
        name: string(input.name, `${path}.name`, 1, DESIGN_LIMITS.maxNameLength),
        currentVersionId: stableId(input.currentVersionId, `${path}.currentVersionId`),
        versionIds: idArray(input.versionIds, `${path}.versionIds`, DESIGN_LIMITS.maxAssetVersions, 1),
    };
}

function assetVersion(value: unknown, path: string): DesignAssetVersion {
    const input = record(value, path, ["id", "assetId", "parentVersionId", "source", "locator", "mimeType", "width", "height", "createdAt", "provenance"]);
    const provenanceInput = record(input.provenance, `${path}.provenance`, ["operation", "sourceElementId", "generationTaskId"]);
    return {
        id: stableId(input.id, `${path}.id`),
        assetId: stableId(input.assetId, `${path}.assetId`),
        parentVersionId: input.parentVersionId === null ? null : stableId(input.parentVersionId, `${path}.parentVersionId`),
        source: enumeration(input.source, `${path}.source`, ["upload", "library", "generated", "derived"] as const),
        locator: resourceLocator(input.locator, `${path}.locator`),
        mimeType: enumeration(input.mimeType, `${path}.mimeType`, ["image/png", "image/jpeg", "image/webp"] as const),
        width: integer(input.width, `${path}.width`, 1, DESIGN_LIMITS.maxExportEdge),
        height: integer(input.height, `${path}.height`, 1, DESIGN_LIMITS.maxExportEdge),
        createdAt: isoDate(input.createdAt, `${path}.createdAt`),
        provenance: {
            operation: enumeration(provenanceInput.operation, `${path}.provenance.operation`, ["upload", "import", "generate", "background-removal", "edit", "upscale", "other"] as const),
            sourceElementId: provenanceInput.sourceElementId === null ? null : stableId(provenanceInput.sourceElementId, `${path}.provenance.sourceElementId`),
            generationTaskId: provenanceInput.generationTaskId === null ? null : stableId(provenanceInput.generationTaskId, `${path}.provenance.generationTaskId`),
        },
    };
}

function resourceLocator(value: unknown, path: string): DesignStableResourceLocator {
    const kind = record(value, path).kind;
    if (kind === "storage-key") {
        const input = record(value, path, ["kind", "storageKey"]);
        const storageKey = string(input.storageKey, `${path}.storageKey`, 1, DESIGN_LIMITS.maxStorageKeyLength);
        if (isUnsafeResource(storageKey)) fail(`${path}.storageKey`, "UNSAFE_RESOURCE", "必须保存稳定 storageKey，不能保存 URL、内联数据或相对穿越路径");
        return { kind, storageKey };
    }
    if (kind === "library-asset") {
        const input = record(value, path, ["kind", "libraryAssetId"]);
        return { kind, libraryAssetId: stableId(input.libraryAssetId, `${path}.libraryAssetId`) };
    }
    fail(`${path}.kind`, "INVALID_VALUE", "资源 locator 类型不受支持");
}

function annotation(value: unknown, path: string): DesignAnnotation {
    const input = record(value, path, ["id", "text", "target", "resolved", "createdAt", "updatedAt"]);
    const createdAt = isoDate(input.createdAt, `${path}.createdAt`);
    const updatedAt = isoDate(input.updatedAt, `${path}.updatedAt`);
    if (Date.parse(updatedAt) < Date.parse(createdAt)) fail(`${path}.updatedAt`, "INVALID_VALUE", "更新时间不能早于创建时间");
    return {
        id: stableId(input.id, `${path}.id`),
        text: string(input.text, `${path}.text`, 1, DESIGN_LIMITS.maxAnnotationLength),
        target: annotationTarget(input.target, `${path}.target`),
        resolved: boolean(input.resolved, `${path}.resolved`),
        createdAt,
        updatedAt,
    };
}

function annotationTarget(value: unknown, path: string): DesignAnnotationTarget {
    const kind = record(value, path).kind;
    if (kind === "element") {
        const input = record(value, path, ["kind", "elementId", "region"]);
        return { kind, elementId: stableId(input.elementId, `${path}.elementId`), region: input.region === null ? null : normalizedRect(input.region, `${path}.region`) };
    }
    if (kind === "frame") {
        const input = record(value, path, ["kind", "frameId", "region"]);
        return { kind, frameId: stableId(input.frameId, `${path}.frameId`), region: normalizedRect(input.region, `${path}.region`) };
    }
    fail(`${path}.kind`, "INVALID_VALUE", "标注目标类型不受支持");
}

function normalizedRect(value: unknown, path: string): DesignNormalizedRect {
    const input = record(value, path, ["x", "y", "width", "height"]);
    const result = {
        x: decimal(input.x, `${path}.x`, 0, 1),
        y: decimal(input.y, `${path}.y`, 0, 1),
        width: decimal(input.width, `${path}.width`, 0.000_001, 1),
        height: decimal(input.height, `${path}.height`, 0.000_001, 1),
    };
    if (result.x + result.width > 1 || result.y + result.height > 1) fail(path, "INVALID_VALUE", "归一化区域必须完整位于 0–1 范围内");
    return result;
}

function validateRelations(document: DesignDocument) {
    const frameMap = unique(document.frames, "$.frames", "Frame");
    const elementMap = unique(document.elements, "$.elements", "元素");
    const assetMap = unique(document.assets, "$.assets", "资源");
    const versionMap = unique(document.assetVersions, "$.assetVersions", "资源版本");
    unique(document.guides, "$.guides", "辅助线");
    unique(document.annotations, "$.annotations", "标注");

    document.guides.forEach((item, index) => {
        if (item.frameId !== null && !frameMap.has(item.frameId)) fail(`$.guides[${index}].frameId`, "MISSING_REFERENCE", `Frame 不存在：${item.frameId}`);
    });

    document.elements.forEach((item, index) => {
        if (item.frameId !== null && !frameMap.has(item.frameId)) fail(`$.elements[${index}].frameId`, "MISSING_REFERENCE", `Frame 不存在：${item.frameId}`);
        if (item.kind === "image" && !versionMap.has(item.assetVersionId)) fail(`$.elements[${index}].assetVersionId`, "MISSING_REFERENCE", `资源版本不存在：${item.assetVersionId}`);
    });

    document.assetVersions.forEach((version, index) => {
        if (!assetMap.has(version.assetId)) fail(`$.assetVersions[${index}].assetId`, "MISSING_REFERENCE", `资源不存在：${version.assetId}`);
        if (version.parentVersionId) {
            const parent = versionMap.get(version.parentVersionId);
            if (!parent) fail(`$.assetVersions[${index}].parentVersionId`, "MISSING_REFERENCE", `父资源版本不存在：${version.parentVersionId}`);
            if (parent.assetId !== version.assetId) fail(`$.assetVersions[${index}].parentVersionId`, "INVALID_ASSET_CHAIN", "父资源版本必须属于同一逻辑资源");
        }
    });

    document.assets.forEach((item, index) => {
        const ids = new Set(item.versionIds);
        if (ids.size !== item.versionIds.length) fail(`$.assets[${index}].versionIds`, "DUPLICATE_ID", "资源版本 ID 不得重复");
        if (!ids.has(item.currentVersionId)) fail(`$.assets[${index}].currentVersionId`, "INVALID_ASSET_CHAIN", "当前版本必须包含在 versionIds 中");
        for (const versionId of ids) {
            const version = versionMap.get(versionId);
            if (!version) fail(`$.assets[${index}].versionIds`, "MISSING_REFERENCE", `资源版本不存在：${versionId}`);
            if (version.assetId !== item.id) fail(`$.assets[${index}].versionIds`, "INVALID_ASSET_CHAIN", `资源版本不属于资源：${versionId}`);
        }
        const actualIds = document.assetVersions.filter((version) => version.assetId === item.id).map((version) => version.id);
        if (actualIds.some((id) => !ids.has(id))) fail(`$.assets[${index}].versionIds`, "INVALID_ASSET_CHAIN", "versionIds 必须列出该资源的全部版本");
        assertAcyclicAssetChain(item.versionIds, versionMap, `$.assets[${index}].versionIds`);
        const rootCount = item.versionIds.filter((id) => versionMap.get(id)?.parentVersionId === null).length;
        if (rootCount !== 1) fail(`$.assets[${index}].versionIds`, "INVALID_ASSET_CHAIN", "每个逻辑资源必须且只能有一个根版本");
    });

    const scopeKeys = new Set<string>();
    const layeredElementIds = new Set<string>();
    document.layers.forEach((scope, index) => {
        const key = scope.scope === "workspace" ? "workspace" : `frame:${scope.frameId}`;
        if (scopeKeys.has(key)) fail(`$.layers[${index}]`, "INVALID_LAYER", `图层作用域重复：${key}`);
        scopeKeys.add(key);
        if (scope.scope === "frame" && !frameMap.has(scope.frameId)) fail(`$.layers[${index}].frameId`, "MISSING_REFERENCE", `Frame 不存在：${scope.frameId}`);
        const local = new Set<string>();
        scope.elementIds.forEach((id, elementIndex) => {
            if (local.has(id) || layeredElementIds.has(id)) fail(`$.layers[${index}].elementIds[${elementIndex}]`, "INVALID_LAYER", `元素重复出现在图层中：${id}`);
            local.add(id);
            layeredElementIds.add(id);
            const target = elementMap.get(id);
            if (!target) fail(`$.layers[${index}].elementIds[${elementIndex}]`, "MISSING_REFERENCE", `元素不存在：${id}`);
            const matches = scope.scope === "workspace" ? target.frameId === null : target.frameId === scope.frameId;
            if (!matches) fail(`$.layers[${index}].elementIds[${elementIndex}]`, "INVALID_LAYER", `元素作用域与图层不一致：${id}`);
        });
    });
    const requiredScopes = ["workspace", ...document.frames.map((item) => `frame:${item.id}`)];
    for (const key of requiredScopes) if (!scopeKeys.has(key)) fail("$.layers", "INVALID_LAYER", `缺少图层作用域：${key}`);
    for (const id of elementMap.keys()) if (!layeredElementIds.has(id)) fail("$.layers", "INVALID_LAYER", `元素未出现在图层顺序中：${id}`);

    document.annotations.forEach((item, index) => {
        if (item.target.kind === "element" && !elementMap.has(item.target.elementId)) fail(`$.annotations[${index}].target.elementId`, "MISSING_REFERENCE", "标注目标元素不存在");
        if (item.target.kind === "frame" && !frameMap.has(item.target.frameId)) fail(`$.annotations[${index}].target.frameId`, "MISSING_REFERENCE", "标注目标 Frame 不存在");
    });
}

function assertAcyclicAssetChain(ids: string[], versions: Map<string, DesignAssetVersion>, path: string) {
    for (const id of ids) {
        const seen = new Set<string>();
        let cursor: string | null = id;
        while (cursor) {
            if (seen.has(cursor)) fail(path, "INVALID_ASSET_CHAIN", `资源版本父链存在循环：${cursor}`);
            seen.add(cursor);
            cursor = versions.get(cursor)?.parentVersionId ?? null;
        }
    }
}

function unique<T extends { id: string }>(items: T[], path: string, label: string) {
    const map = new Map<string, T>();
    items.forEach((item, index) => {
        if (map.has(item.id)) fail(`${path}[${index}].id`, "DUPLICATE_ID", `${label} ID 重复：${item.id}`);
        map.set(item.id, item);
    });
    return map;
}

function record(value: unknown, path: string, allowedKeys?: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "INVALID_TYPE", "必须是对象");
    const input = value as Record<string, unknown>;
    if (allowedKeys) {
        const allowed = new Set(allowedKeys);
        const unknown = Object.keys(input).find((key) => !allowed.has(key));
        if (unknown) fail(`${path}.${unknown}`, "UNKNOWN_FIELD", `不支持字段 ${unknown}`);
    }
    return input;
}

function array<T>(value: unknown, path: string, maximum: number, parser: (value: unknown, path: string) => T, minimum = 0): T[] {
    if (!Array.isArray(value)) fail(path, "INVALID_TYPE", "必须是数组");
    if (value.length < minimum || value.length > maximum) fail(path, "LIMIT_EXCEEDED", `数组长度必须在 ${minimum} 到 ${maximum} 之间`);
    return value.map((item, index) => parser(item, `${path}[${index}]`));
}

function idArray(value: unknown, path: string, maximum: number, minimum = 0) {
    return array(value, path, maximum, stableId, minimum);
}

function dash(value: unknown, path: string) {
    return array(value, path, 20, (item, itemPath) => decimal(item, itemPath, 0, 10_000));
}

function stableId(value: unknown, path: string) {
    const output = string(value, path, 1, DESIGN_LIMITS.maxIdLength);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(output)) fail(path, "INVALID_VALUE", "ID 只能包含字母、数字、下划线和连字符");
    return output;
}

function string(value: unknown, path: string, minimum: number, maximum: number) {
    if (typeof value !== "string") fail(path, "INVALID_TYPE", "必须是字符串");
    if (value.length < minimum || value.length > maximum) fail(path, "LIMIT_EXCEEDED", `字符串长度必须在 ${minimum} 到 ${maximum} 之间`);
    return value;
}

function boolean(value: unknown, path: string) {
    if (typeof value !== "boolean") fail(path, "INVALID_TYPE", "必须是布尔值");
    return value;
}

function integer(value: unknown, path: string, minimum: number, maximum: number) {
    if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(path, "INVALID_VALUE", `必须是 ${minimum} 到 ${maximum} 之间的安全整数`);
    return Number(value);
}

function decimal(value: unknown, path: string, minimum: number, maximum: number) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) fail(path, "INVALID_VALUE", `必须是 ${minimum} 到 ${maximum} 之间的有限数值`);
    const factor = 10 ** DESIGN_LIMITS.numberPrecision;
    return Object.is(value, -0) ? 0 : Math.round(value * factor) / factor;
}

function enumeration<const T extends readonly (string | number)[]>(value: unknown, path: string, allowed: T): T[number] {
    if (!allowed.includes(value as never)) fail(path, "INVALID_VALUE", `必须是 ${allowed.join("、")} 之一`);
    return value as T[number];
}

function color(value: unknown, path: string) {
    const output = string(value, path, 4, 9);
    if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(output)) fail(path, "INVALID_VALUE", "必须是 #RGB、#RRGGBB 或 #RRGGBBAA 颜色");
    return output.toLowerCase() as `#${string}`;
}

function isoDate(value: unknown, path: string) {
    const output = string(value, path, 20, 40);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(output) || !Number.isFinite(Date.parse(output))) fail(path, "INVALID_VALUE", "必须是 UTC ISO 日期时间");
    return new Date(output).toISOString();
}

function isUnsafeResource(value: string) {
    const normalized = value.trim();
    return normalized !== value || /^(?:data:|blob:|https?:|\/)/i.test(normalized) || normalized.includes("..") || /(?:^|[?&])(expires|signature|x-amz-signature)=/i.test(normalized) || /[\\\0-\x1f?#]/.test(normalized);
}

function byteLength(value: unknown) {
    try {
        return new TextEncoder().encode(JSON.stringify(value)).byteLength;
    } catch {
        fail("$", "INVALID_TYPE", "文档必须可以序列化为 JSON");
    }
}

function fail(path: string, code: DesignValidationIssueCode, message: string): never {
    throw new DesignDocumentValidationError({ path, code, message });
}
