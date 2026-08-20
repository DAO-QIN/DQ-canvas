export const DESIGN_LIMITS = Object.freeze({
    maxDocumentBytes: 10 * 1024 * 1024,
    maxFrames: 100,
    maxElements: 5_000,
    maxAssets: 2_000,
    maxAssetVersions: 2_000,
    maxAnnotations: 2_000,
    maxGuides: 1_000,
    maxOperationsPerBatch: 100,
    maxFrameEdge: 16_384,
    maxExportEdge: 32_768,
    maxCoordinate: 1_000_000,
    maxElementEdge: 100_000,
    maxTitleLength: 200,
    maxDescriptionLength: 4_000,
    maxNameLength: 200,
    maxTextLength: 100_000,
    maxAnnotationLength: 4_000,
    maxFontFamilyLength: 200,
    maxStorageKeyLength: 1_024,
    maxIdLength: 160,
    numberPrecision: 3,
} as const);

export const DESIGN_SCHEMA_VERSION = 1 as const;

export const DESIGN_EXPORT_SCALES = [1, 2, 3, 4] as const;
export const DESIGN_EXPORT_FORMATS = ["png", "jpeg", "webp"] as const;
export const DESIGN_ELEMENT_KINDS = ["image", "text", "shape", "line", "arrow"] as const;
