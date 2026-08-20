export const DESIGN_POC_SCHEMA_VERSION = 1 as const;

export type DesignPocEngineKind = "tldraw" | "fabric";

export type DesignPocAsset = {
    id: string;
    kind: "image";
    name: string;
    src: string;
    mimeType: "image/png" | "image/jpeg";
    width: number;
    height: number;
};

export type DesignPocFrame = {
    id: string;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    background: string;
    export: {
        format: "png" | "jpeg";
        scale: 1 | 2;
    };
};

export type DesignPocCrop = {
    x: number;
    y: number;
    width: number;
    height: number;
};

type DesignPocElementBase = {
    id: string;
    frameId: string;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    opacity: number;
    locked: boolean;
    hidden: boolean;
    zIndex: number;
};

export type DesignPocImageElement = DesignPocElementBase & {
    kind: "image";
    assetId: string;
    crop: DesignPocCrop | null;
    flipX: boolean;
    flipY: boolean;
};

export type DesignPocTextElement = DesignPocElementBase & {
    kind: "text";
    text: string;
    color: string;
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    lineHeight: number;
    letterSpacing: number;
    align: "left" | "center" | "right";
};

export type DesignPocShapeElement = DesignPocElementBase & {
    kind: "shape";
    shape: "rectangle" | "ellipse";
    fill: string;
    stroke: string;
    strokeWidth: number;
    radius: number;
};

export type DesignPocElement = DesignPocImageElement | DesignPocTextElement | DesignPocShapeElement;

export type DesignPocDocument = {
    schemaVersion: typeof DESIGN_POC_SCHEMA_VERSION;
    id: string;
    title: string;
    frames: DesignPocFrame[];
    assets: DesignPocAsset[];
    elements: DesignPocElement[];
    viewport: { x: number; y: number; zoom: number };
};

export type DesignPocOperation =
    | { id: string; type: "transform"; elementId: string; dx: number; dy: number; scale: number; rotation: number }
    | { id: string; type: "bring-forward"; elementId: string }
    | { id: string; type: "crop-image"; elementId: string; crop: DesignPocCrop }
    | {
          id: string;
          type: "update-text";
          elementId: string;
          patch: Pick<DesignPocTextElement, "fontFamily" | "fontSize" | "fontWeight" | "lineHeight" | "letterSpacing" | "align">;
      }
    | { id: string; type: "align-horizontal-center"; elementIds: string[] }
    | { id: string; type: "distribute-horizontal"; elementIds: string[] }
    | { id: string; type: "duplicate-to-frame"; elementIds: string[]; targetFrameId: string; newIds: string[]; offset: { x: number; y: number } };

export type DesignPocOperationError = {
    operationId: string;
    code: "INVALID_OPERATION" | "ELEMENT_NOT_FOUND" | "FRAME_NOT_FOUND" | "TYPE_MISMATCH" | "ID_CONFLICT";
    message: string;
};

export type DesignPocOperationReceipt = {
    status: "applied" | "partial" | "rejected";
    appliedOperationIds: string[];
    createdElementIds: string[];
    errors: DesignPocOperationError[];
};

export type DesignPocMetrics = {
    engine: DesignPocEngineKind;
    elementCount: number;
    frameCount: number;
    documentBytes: number;
    zoom: number;
};

export type DesignPocExportResult = {
    blob: Blob;
    width: number;
    height: number;
    durationMs: number;
};

export type DesignPocAdapter = {
    readonly engine: DesignPocEngineKind;
    load(document: DesignPocDocument, options?: { recordHistory?: boolean }): Promise<void>;
    exportDocument(): DesignPocDocument;
    apply(operations: DesignPocOperation[]): Promise<DesignPocOperationReceipt>;
    undo(): Promise<void>;
    redo(): Promise<void>;
    getSelection(): string[];
    setSelection(ids: string[]): void;
    exportFrame(frameId: string, options: { scale: 1 | 2; format: "png" | "jpeg" }): Promise<DesignPocExportResult>;
    getMetrics(): DesignPocMetrics;
    destroy(): void | Promise<void>;
};

export type DesignPocGateResult = {
    engine: DesignPocEngineKind;
    passed: boolean;
    startedAt: string;
    durationMs: number;
    documentBytes: number;
    loadDurationMs: number;
    operationDurationMs: number;
    roundTrips: number;
    roundTripStable: boolean;
    undoStable: boolean;
    redoStable: boolean;
    selectionStable: boolean;
    visualChecks: {
        cropPixelStable: boolean;
        frameClipStable: boolean;
        samples: Array<{ name: string; rgba: [number, number, number, number] }>;
    };
    exports: Array<{ format: "png" | "jpeg"; scale: 1 | 2; width: number; height: number; bytes: number; durationMs: number }>;
    errors: string[];
};
