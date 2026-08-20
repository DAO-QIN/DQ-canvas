import type { DESIGN_ELEMENT_KINDS, DESIGN_EXPORT_FORMATS, DESIGN_EXPORT_SCALES, DESIGN_SCHEMA_VERSION } from "./limits";

export type DesignExportScale = (typeof DESIGN_EXPORT_SCALES)[number];
export type DesignExportFormat = (typeof DESIGN_EXPORT_FORMATS)[number];
export type DesignElementKind = (typeof DESIGN_ELEMENT_KINDS)[number];
export type DesignColor = `#${string}`;

export type DesignPoint = { x: number; y: number };
export type DesignViewport = { x: number; y: number; zoom: number };
export type DesignNormalizedRect = { x: number; y: number; width: number; height: number };
export type DesignTransform = {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    flipX: boolean;
    flipY: boolean;
};

export type DesignExportSettings = {
    format: DesignExportFormat;
    scale: DesignExportScale;
    quality: number;
    background: "frame" | "transparent" | "white";
};

export type DesignDocumentMetadata = {
    title: string;
    description: string;
    createdAt: string;
    updatedAt: string;
};

export type DesignWorkspace = {
    background: DesignColor;
    viewport: DesignViewport;
};

export type DesignGuide = {
    id: string;
    axis: "horizontal" | "vertical";
    position: number;
    frameId: string | null;
    locked: boolean;
};

export type DesignFrame = {
    id: string;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    background: DesignColor | null;
    locked: boolean;
    export: DesignExportSettings;
};

export type DesignStableResourceLocator = { kind: "storage-key"; storageKey: string } | { kind: "library-asset"; libraryAssetId: string };

export type DesignAsset = {
    id: string;
    kind: "image";
    name: string;
    currentVersionId: string;
    versionIds: string[];
};

export type DesignAssetVersion = {
    id: string;
    assetId: string;
    parentVersionId: string | null;
    source: "upload" | "library" | "generated" | "derived";
    locator: DesignStableResourceLocator;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
    width: number;
    height: number;
    createdAt: string;
    provenance: {
        operation: "upload" | "import" | "generate" | "background-removal" | "edit" | "upscale" | "other";
        sourceElementId: string | null;
        generationTaskId: string | null;
    };
};

export type DesignElementBase = {
    id: string;
    frameId: string | null;
    name: string;
    transform: DesignTransform;
    opacity: number;
    /** P0 deliberately freezes blending to normal; later modes require a schema migration and export tests. */
    blendMode: "normal";
    locked: boolean;
    hidden: boolean;
};

export type DesignImageElement = DesignElementBase & {
    kind: "image";
    assetVersionId: string;
    crop: DesignNormalizedRect | null;
    fit: "fill" | "contain" | "cover";
    cornerRadius: number;
};

export type DesignTextElement = DesignElementBase & {
    kind: "text";
    text: string;
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    fontStyle: "normal" | "italic";
    lineHeight: number;
    letterSpacing: number;
    align: "left" | "center" | "right" | "justify";
    verticalAlign: "top" | "middle" | "bottom";
    fill: DesignColor;
    stroke: DesignColor | null;
    strokeWidth: number;
};

export type DesignShapeElement = DesignElementBase & {
    kind: "shape";
    shape: "rectangle" | "ellipse";
    fill: DesignColor | null;
    stroke: DesignColor | null;
    strokeWidth: number;
    cornerRadius: number;
};

export type DesignLineElement = DesignElementBase & {
    kind: "line";
    stroke: DesignColor;
    strokeWidth: number;
    dash: number[];
    cap: "butt" | "round" | "square";
};

export type DesignArrowElement = DesignElementBase & {
    kind: "arrow";
    stroke: DesignColor;
    strokeWidth: number;
    dash: number[];
    startHead: "none" | "arrow" | "circle";
    endHead: "none" | "arrow" | "circle";
};

export type DesignElement = DesignImageElement | DesignTextElement | DesignShapeElement | DesignLineElement | DesignArrowElement;

export type DesignLayerScope = { scope: "workspace"; elementIds: string[] } | { scope: "frame"; frameId: string; elementIds: string[] };

export type DesignAnnotationTarget = { kind: "element"; elementId: string; region: DesignNormalizedRect | null } | { kind: "frame"; frameId: string; region: DesignNormalizedRect };

export type DesignAnnotation = {
    id: string;
    text: string;
    target: DesignAnnotationTarget;
    resolved: boolean;
    createdAt: string;
    updatedAt: string;
};

export type DesignDocumentV1 = {
    schemaVersion: typeof DESIGN_SCHEMA_VERSION;
    id: string;
    revision: number;
    metadata: DesignDocumentMetadata;
    workspace: DesignWorkspace;
    guides: DesignGuide[];
    frames: DesignFrame[];
    elements: DesignElement[];
    layers: DesignLayerScope[];
    assets: DesignAsset[];
    assetVersions: DesignAssetVersion[];
    annotations: DesignAnnotation[];
};

export type DesignDocument = DesignDocumentV1;
