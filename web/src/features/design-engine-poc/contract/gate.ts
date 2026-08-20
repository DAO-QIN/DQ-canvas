import { createDesignPocFixture, createVisualProbeDesignPocFixture, DESIGN_POC_OPERATION_SEQUENCE } from "./fixture";
import { describeDesignPocDifference, designPocDocumentsEqual } from "./document";
import { applyDesignPocOperations } from "./operations";
import type { DesignPocAdapter, DesignPocGateResult } from "./types";

export async function runDesignPocGate(adapter: DesignPocAdapter): Promise<DesignPocGateResult> {
    const started = performance.now();
    const result: DesignPocGateResult = {
        engine: adapter.engine,
        passed: false,
        startedAt: new Date().toISOString(),
        durationMs: 0,
        documentBytes: 0,
        loadDurationMs: 0,
        operationDurationMs: 0,
        roundTrips: 0,
        roundTripStable: false,
        undoStable: false,
        redoStable: false,
        selectionStable: false,
        visualChecks: { cropPixelStable: false, frameClipStable: false, samples: [] },
        exports: [],
        errors: [],
    };
    try {
        const fixture = createDesignPocFixture();
        const loadStarted = performance.now();
        await adapter.load(fixture);
        result.loadDurationMs = rounded(performance.now() - loadStarted);
        adapter.setSelection(["element-main-product", "element-main-title"]);
        result.selectionStable = sameIds(adapter.getSelection(), ["element-main-product", "element-main-title"]);
        adapter.setSelection([]);

        const operationStarted = performance.now();
        for (const operation of DESIGN_POC_OPERATION_SEQUENCE) {
            const receipt = await adapter.apply([operation]);
            if (receipt.status !== "applied") result.errors.push(`${operation.id}: ${receipt.errors.map((error) => error.message).join("；")}`);
        }
        result.operationDurationMs = rounded(performance.now() - operationStarted);
        const expected = DESIGN_POC_OPERATION_SEQUENCE.reduce((document, operation) => applyDesignPocOperations(document, [operation]).document, fixture);

        const afterOperations = adapter.exportDocument();
        if (!designPocDocumentsEqual(afterOperations, expected)) result.errors.push(`统一操作后的文档语义不一致：${describeDesignPocDifference(afterOperations, expected)}`);
        for (let index = 0; index < DESIGN_POC_OPERATION_SEQUENCE.length; index += 1) await adapter.undo();
        result.undoStable = designPocDocumentsEqual(adapter.exportDocument(), fixture);
        if (!result.undoStable) result.errors.push(`7 次 Undo 未恢复基础夹具：${describeDesignPocDifference(adapter.exportDocument(), fixture)}`);
        for (let index = 0; index < DESIGN_POC_OPERATION_SEQUENCE.length; index += 1) await adapter.redo();
        result.redoStable = designPocDocumentsEqual(adapter.exportDocument(), expected);
        if (!result.redoStable) result.errors.push(`7 次 Redo 未恢复操作结果：${describeDesignPocDifference(adapter.exportDocument(), expected)}`);

        let roundTrip = adapter.exportDocument();
        for (let index = 0; index < 10; index += 1) {
            await adapter.load(roundTrip, { recordHistory: false });
            const exported = adapter.exportDocument();
            if (!designPocDocumentsEqual(exported, roundTrip)) {
                result.errors.push(`第 ${index + 1} 次文档往返不一致：${describeDesignPocDifference(exported, roundTrip)}`);
                break;
            }
            roundTrip = exported;
            result.roundTrips += 1;
        }
        result.roundTripStable = result.roundTrips === 10;
        if (!result.roundTripStable) result.errors.push(`文档只稳定往返 ${result.roundTrips}/10 次`);

        for (const options of [
            { format: "png" as const, scale: 1 as const },
            { format: "png" as const, scale: 2 as const },
            { format: "jpeg" as const, scale: 1 as const },
        ]) {
            const exported = await adapter.exportFrame("frame-amazon-main", options);
            result.exports.push({ ...options, width: exported.width, height: exported.height, bytes: exported.blob.size, durationMs: rounded(exported.durationMs) });
        }
        const dimensionsCorrect = result.exports.every((entry) => entry.width === 2000 * entry.scale && entry.height === 2000 * entry.scale && entry.bytes > 0);
        if (!dimensionsCorrect) result.errors.push("Frame 导出像素尺寸或 Blob 无效");
        result.documentBytes = new TextEncoder().encode(JSON.stringify(adapter.exportDocument())).byteLength;
        await runVisualChecks(adapter, result);
        result.passed = result.errors.length === 0 && result.selectionStable && result.undoStable && result.redoStable && result.roundTripStable && result.visualChecks.cropPixelStable && result.visualChecks.frameClipStable && dimensionsCorrect;
    } catch (error) {
        result.errors.push(error instanceof Error ? error.message : "PoC Gate 执行失败");
    }
    result.durationMs = rounded(performance.now() - started);
    return result;
}

async function runVisualChecks(adapter: DesignPocAdapter, result: DesignPocGateResult) {
    await adapter.load(createVisualProbeDesignPocFixture(), { recordHistory: false });
    const exported = await adapter.exportFrame("frame-amazon-main", { scale: 1, format: "png" });
    if (exported.width !== 2000 || exported.height !== 2000) {
        result.errors.push("视觉探针导出尺寸错误");
        return;
    }
    const samples = await sampleBlob(exported.blob, [
        ["crop-vertical-grid", 167, 300],
        ["crop-vertical-field", 125, 300],
        ["crop-horizontal-grid", 250, 67],
        ["crop-horizontal-field", 250, 100],
        ["frame-clip-inside", 1950, 1800],
        ["frame-clip-outside", 1650, 1800],
    ]);
    result.visualChecks.samples = [...samples.entries()].map(([name, rgba]) => ({ name, rgba }));
    result.visualChecks.cropPixelStable =
        colorDistance(requiredSample(samples, "crop-vertical-grid"), requiredSample(samples, "crop-vertical-field")) >= 25 && colorDistance(requiredSample(samples, "crop-horizontal-grid"), requiredSample(samples, "crop-horizontal-field")) >= 25;
    result.visualChecks.frameClipStable = colorDistance(requiredSample(samples, "frame-clip-inside"), requiredSample(samples, "frame-clip-outside")) >= 80;
    if (!result.visualChecks.cropPixelStable) result.errors.push("图片裁剪像素探针未检测到预期网格位置");
    if (!result.visualChecks.frameClipStable) result.errors.push("Frame 边界裁剪像素探针未检测到预期内外差异");
}

async function sampleBlob(blob: Blob, probes: Array<[string, number, number]>) {
    const bitmap = await createImageBitmap(blob);
    try {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("无法创建视觉探针 Canvas 2D 上下文");
        context.drawImage(bitmap, 0, 0);
        return new Map(
            probes.map(([name, x, y]) => {
                const pixel = context.getImageData(x, y, 1, 1).data;
                return [name, [pixel[0], pixel[1], pixel[2], pixel[3]] as [number, number, number, number]];
            }),
        );
    } finally {
        bitmap.close();
    }
}

function requiredSample(samples: Map<string, [number, number, number, number]>, name: string) {
    const sample = samples.get(name);
    if (!sample) throw new Error(`视觉探针采样缺失：${name}`);
    return sample;
}

function colorDistance(left: [number, number, number, number], right: [number, number, number, number]) {
    return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function sameIds(left: string[], right: string[]) {
    return left.toSorted().join("|") === right.toSorted().join("|");
}

function rounded(value: number) {
    return Math.round(value * 100) / 100;
}
