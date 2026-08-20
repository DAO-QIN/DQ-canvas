import { strToU8, zipSync } from "fflate";

import { createDesignFrameExportBatchPlan, type DesignDocument, type DesignFrameExportOptions, type DesignFrameExportPlan } from "@/lib/design";

import type { DesignFabricFrameExportResult } from "../fabric/design-fabric-adapter";

export const DESIGN_EXPORT_MAX_PIXEL_AREA = 120_000_000;
export const DESIGN_EXPORT_MAX_BATCH_PIXEL_AREA = 240_000_000;

export type DesignFrameExportExecutor = (plan: DesignFrameExportPlan) => Promise<DesignFabricFrameExportResult>;

export type DesignFrameExportProgressReporter = (progress: { completed: number; total: number; currentItemId: string | null; currentItemName: string | null }) => void;

export type DesignFrameExportBundle = Readonly<{
    blob: Blob;
    fileName: string;
    results: readonly DesignFabricFrameExportResult[];
    plans: readonly DesignFrameExportPlan[];
}>;

export async function createDesignFrameExportBundle({
    document,
    frameIds,
    options,
    exportFrame,
    reportProgress = () => undefined,
}: {
    document: DesignDocument;
    frameIds: readonly string[];
    options: DesignFrameExportOptions;
    exportFrame: DesignFrameExportExecutor;
    reportProgress?: DesignFrameExportProgressReporter;
}): Promise<DesignFrameExportBundle> {
    const plans = createDesignFrameExportBatchPlan(
        document,
        frameIds.map((frameId) => ({ frameId, options })),
    );
    assertDesignExportPixelBudget(plans);
    const results: DesignFabricFrameExportResult[] = [];
    for (let index = 0; index < plans.length; index += 1) {
        const plan = plans[index];
        reportProgress({ completed: index, total: plans.length, currentItemId: plan.frame.id, currentItemName: plan.frame.name });
        results.push(await exportFrame(plan));
    }
    reportProgress({ completed: plans.length, total: plans.length, currentItemId: null, currentItemName: null });
    if (results.length === 1) return { blob: results[0].blob, fileName: results[0].fileName, results, plans };

    const entries: Record<string, Uint8Array> = {};
    for (const result of results) entries[`frames/${result.fileName}`] = new Uint8Array(await result.blob.arrayBuffer());
    entries["manifest.json"] = strToU8(
        JSON.stringify(
            {
                schemaVersion: 1,
                surface: "design",
                documentId: document.id,
                revision: document.revision,
                exportedAt: new Date().toISOString(),
                frames: plans.map((plan) => ({
                    id: plan.frame.id,
                    name: plan.frame.name,
                    fileName: plan.fileName,
                    sourceWidth: plan.frame.width,
                    sourceHeight: plan.frame.height,
                    pixelWidth: plan.pixelWidth,
                    pixelHeight: plan.pixelHeight,
                    format: plan.format,
                    scale: plan.scale,
                    quality: plan.quality,
                    background: plan.background,
                })),
            },
            null,
            2,
        ),
    );
    return { blob: new Blob([zipSync(entries, { level: 0 })], { type: "application/zip" }), fileName: `${safeArchiveName(document.metadata.title)}-frames-r${document.revision}.zip`, results, plans };
}

export function assertDesignExportPixelBudget(plans: readonly DesignFrameExportPlan[], maxPixelArea = DESIGN_EXPORT_MAX_PIXEL_AREA, maxBatchPixelArea = DESIGN_EXPORT_MAX_BATCH_PIXEL_AREA) {
    let batchPixelArea = 0;
    for (const plan of plans) {
        const area = plan.pixelWidth * plan.pixelHeight;
        if (!Number.isSafeInteger(area) || area > maxPixelArea) throw new Error(`“${plan.frame.name}”导出尺寸 ${plan.pixelWidth} x ${plan.pixelHeight} 超出浏览器安全像素预算，请降低倍率`);
        batchPixelArea += area;
        if (!Number.isSafeInteger(batchPixelArea) || batchPixelArea > maxBatchPixelArea) throw new Error(`批量导出总像素 ${batchPixelArea.toLocaleString("zh-CN")} 超出浏览器安全预算，请减少画框或降低倍率`);
    }
}

function safeArchiveName(value: string) {
    const result = value
        .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
        .replace(/^[.\s]+|[.\s]+$/g, "")
        .slice(0, 100);
    return result || "design";
}
