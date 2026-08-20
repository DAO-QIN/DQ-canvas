import { normalizeDesignPocDocument } from "./document";
import type { DesignPocDocument, DesignPocElement, DesignPocFrame, DesignPocOperation } from "./types";

const FRAMES: DesignPocFrame[] = [
    { id: "frame-amazon-main", name: "Amazon 主图", x: 160, y: 160, width: 2000, height: 2000, background: "#ffffff", export: { format: "png", scale: 1 } },
    { id: "frame-amazon-aplus", name: "Amazon A+ 横幅", x: 2360, y: 160, width: 1464, height: 600, background: "#f2f4f7", export: { format: "png", scale: 1 } },
    { id: "frame-social-feed", name: "社媒竖图", x: 4024, y: 160, width: 1080, height: 1350, background: "#dce8ff", export: { format: "png", scale: 1 } },
    { id: "frame-social-story", name: "Story 广告", x: 5304, y: 160, width: 1080, height: 1920, background: "#111827", export: { format: "png", scale: 1 } },
];

const FRAME_SHORT_NAMES: Record<string, string> = {
    "frame-amazon-main": "main",
    "frame-amazon-aplus": "aplus",
    "frame-social-feed": "feed",
    "frame-social-story": "story",
};

export function createDesignPocFixture(): DesignPocDocument {
    const elements = FRAMES.flatMap((frame) => createFrameElements(frame));
    return normalizeDesignPocDocument({
        schemaVersion: 1,
        id: "design-poc-product-campaign",
        title: "DQ 商品图多画板 PoC",
        frames: FRAMES,
        assets: [
            { id: "asset-product-transparent", kind: "image", name: "透明商品图", src: "/design-poc/product-transparent.png", mimeType: "image/png", width: 3000, height: 3000 },
            { id: "asset-product-background", kind: "image", name: "裁剪坐标背景", src: "/design-poc/product-background.jpg", mimeType: "image/jpeg", width: 3200, height: 2400 },
        ],
        elements,
        viewport: { x: 0, y: 0, zoom: 0.12 },
    });
}

export function createPerformanceDesignPocFixture(count = 200): DesignPocDocument {
    const base = createDesignPocFixture();
    const seed = base.elements.filter((element) => element.frameId === "frame-amazon-main" && element.kind !== "image")[0];
    if (!seed) throw new Error("性能夹具缺少种子元素");
    const elements: DesignPocElement[] = Array.from({ length: count }, (_, index) => ({
        ...structuredClone(seed),
        id: `perf-element-${String(index + 1).padStart(3, "0")}`,
        name: `性能元素 ${index + 1}`,
        x: 40 + (index % 20) * 92,
        y: 40 + Math.floor(index / 20) * 92,
        width: 72,
        height: 72,
        zIndex: index + 1,
        locked: false,
        hidden: false,
    }));
    return normalizeDesignPocDocument({ ...base, id: "design-poc-performance-200", title: "200 元素性能夹具", elements });
}

export function createVisualProbeDesignPocFixture(): DesignPocDocument {
    const frame = structuredClone(FRAMES[0]);
    return normalizeDesignPocDocument({
        schemaVersion: 1,
        id: "design-poc-visual-probe",
        title: "裁剪与 Frame 边界像素探针",
        frames: [frame],
        assets: [{ id: "asset-product-background", kind: "image", name: "裁剪坐标背景", src: "/design-poc/product-background.jpg", mimeType: "image/jpeg", width: 3200, height: 2400 }],
        elements: [
            {
                id: "element-visual-crop",
                frameId: frame.id,
                kind: "image",
                name: "裁剪网格探针",
                assetId: "asset-product-background",
                x: 0,
                y: 0,
                width: 1000,
                height: 800,
                rotation: 0,
                opacity: 1,
                locked: false,
                hidden: false,
                zIndex: 1,
                crop: { x: 0.125, y: 0.1, width: 0.75, height: 0.8 },
                flipX: false,
                flipY: false,
            },
            {
                id: "element-visual-frame-clip",
                frameId: frame.id,
                kind: "image",
                name: "Frame 边缘裁剪探针",
                assetId: "asset-product-background",
                x: 1700,
                y: 1500,
                width: 600,
                height: 600,
                rotation: 0,
                opacity: 1,
                locked: false,
                hidden: false,
                zIndex: 2,
                crop: null,
                flipX: false,
                flipY: false,
            },
        ],
        viewport: { x: 0, y: 0, zoom: 0.12 },
    });
}

export const DESIGN_POC_OPERATION_SEQUENCE: DesignPocOperation[] = [
    { id: "op-transform-product", type: "transform", elementId: "element-main-product", dx: 40, dy: 30, scale: 0.75, rotation: 17 },
    { id: "op-bring-product-forward", type: "bring-forward", elementId: "element-main-product" },
    { id: "op-crop-background", type: "crop-image", elementId: "element-main-background", crop: { x: 0.125, y: 0.1, width: 0.75, height: 0.8 } },
    {
        id: "op-update-title",
        type: "update-text",
        elementId: "element-main-title",
        patch: { fontFamily: "Arial", fontSize: 88, fontWeight: 700, lineHeight: 1.15, letterSpacing: 1.5, align: "center" },
    },
    { id: "op-align-center", type: "align-horizontal-center", elementIds: ["element-main-title", "element-main-subtitle", "element-main-product"] },
    { id: "op-distribute-horizontal", type: "distribute-horizontal", elementIds: ["element-main-shape-1", "element-main-shape-2", "element-main-shape-3"] },
    {
        id: "op-duplicate-to-feed",
        type: "duplicate-to-frame",
        elementIds: ["element-main-product", "element-main-title"],
        targetFrameId: "frame-social-feed",
        newIds: ["element-feed-product-copy", "element-feed-title-copy"],
        offset: { x: 80, y: 120 },
    },
];

export const DESIGN_POC_INVALID_OPERATIONS: DesignPocOperation[] = [
    { id: "op-invalid-element", type: "transform", elementId: "element-does-not-exist", dx: 1, dy: 1, scale: 1, rotation: 0 },
    { id: "op-invalid-crop-type", type: "crop-image", elementId: "element-main-title", crop: { x: 0, y: 0, width: 1, height: 1 } },
    {
        id: "op-invalid-frame",
        type: "duplicate-to-frame",
        elementIds: ["element-main-title"],
        targetFrameId: "frame-does-not-exist",
        newIds: ["element-invalid-copy"],
        offset: { x: 0, y: 0 },
    },
];

function createFrameElements(frame: DesignPocFrame): DesignPocElement[] {
    const short = FRAME_SHORT_NAMES[frame.id];
    const compact = frame.width < 1200;
    const productSize = Math.min(frame.width * 0.48, frame.height * 0.48);
    return [
        {
            id: `element-${short}-background`,
            frameId: frame.id,
            kind: "image",
            name: "网格背景",
            assetId: "asset-product-background",
            x: frame.width * 0.08,
            y: frame.height * 0.12,
            width: frame.width * 0.84,
            height: frame.height * 0.55,
            rotation: 0,
            opacity: short === "main" ? 0.14 : 0.22,
            locked: short === "main",
            hidden: short === "story",
            zIndex: 1,
            crop: null,
            flipX: false,
            flipY: false,
        },
        {
            id: `element-${short}-product`,
            frameId: frame.id,
            kind: "image",
            name: "透明商品",
            assetId: "asset-product-transparent",
            x: frame.width * 0.5 - productSize * 0.5,
            y: frame.height * 0.28,
            width: productSize,
            height: productSize,
            rotation: short === "main" ? 17 : 0,
            opacity: 1,
            locked: false,
            hidden: false,
            zIndex: 4,
            crop: short === "aplus" ? { x: 0.1, y: 0.05, width: 0.8, height: 0.8 } : null,
            flipX: false,
            flipY: false,
        },
        {
            id: `element-${short}-title`,
            frameId: frame.id,
            kind: "text",
            name: "主标题",
            text: "DQ Bottle / 轻盈一整天",
            x: frame.width * 0.1,
            y: frame.height * 0.08,
            width: frame.width * 0.8,
            height: compact ? 140 : 180,
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            zIndex: 6,
            color: short === "story" ? "#ffffff" : "#111827",
            fontFamily: "Arial",
            fontSize: compact ? 50 : 74,
            fontWeight: 700,
            lineHeight: 1.2,
            letterSpacing: 0,
            align: "center",
        },
        {
            id: `element-${short}-subtitle`,
            frameId: frame.id,
            kind: "text",
            name: "副标题",
            text: "Clean hydration · 2026",
            x: frame.width * 0.2,
            y: frame.height * 0.82,
            width: frame.width * 0.6,
            height: 90,
            rotation: 0,
            opacity: 0.82,
            locked: false,
            hidden: false,
            zIndex: 7,
            color: short === "story" ? "#dbeafe" : "#334155",
            fontFamily: "Arial",
            fontSize: compact ? 30 : 42,
            fontWeight: 400,
            lineHeight: 1.3,
            letterSpacing: 1,
            align: "center",
        },
        ...([0, 1, 2] as const).map((index): DesignPocElement => ({
            id: `element-${short}-shape-${index + 1}`,
            frameId: frame.id,
            kind: "shape",
            name: `卖点形状 ${index + 1}`,
            shape: index === 1 ? "ellipse" : "rectangle",
            x: frame.width * 0.12 + index * frame.width * 0.28,
            y: frame.height * 0.91,
            width: frame.width * 0.2,
            height: Math.min(72, frame.height * 0.08),
            rotation: 0,
            opacity: 1,
            locked: index === 0 && short === "main",
            hidden: index === 2 && short === "aplus",
            zIndex: 8 + index,
            fill: index === 0 ? "#2563eb" : index === 1 ? "#f59e0b" : "#10b981",
            stroke: "#0f172a",
            strokeWidth: 2,
            radius: index === 1 ? 999 : 18,
        })),
    ];
}
