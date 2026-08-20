import { expect, test, type CDPSession, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const MEASUREMENT_RUNS = 3;
test.setTimeout(300_000);

type GateMeasurement = {
    engine: "tldraw" | "fabric";
    passed: boolean;
    durationMs: number;
    loadDurationMs: number;
    operationDurationMs: number;
    documentBytes: number;
    roundTrips: number;
    visualChecks: { cropPixelStable: boolean; frameClipStable: boolean };
    exports: Array<{ format: "png" | "jpeg"; scale: 1 | 2; width: number; height: number; bytes: number; durationMs: number }>;
    errors: string[];
};

type PerformanceMeasurement = {
    engine: "tldraw" | "fabric";
    durationMs: number;
    elementCount: number;
    documentBytes: number;
    longTaskCount: number | null;
    longestLongTaskMs: number | null;
};

type CandidateRun = { run: number; gate: GateMeasurement; performance: PerformanceMeasurement };

test("compares tldraw and Fabric with the same product-design gate", async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    const unexpectedHttpFailures: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("response", async (response) => {
        if (response.status() < 400) return;
        const url = new URL(response.url());
        if (response.status() === 409 && url.pathname === "/api/notifications/interactions" && (await response.text()).includes("社区互动需要启用 PostgreSQL 数据库")) return;
        unexpectedHttpFailures.push(`${response.status()} ${url.pathname}`);
    });

    await page.goto("/design-poc", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("design-poc-workbench")).toBeVisible();

    const tldraw = await runCandidate(page, testInfo, "tldraw 5.2.5");
    const beforeFabricResources = await nextAssetResources(page);
    await page.getByRole("button", { name: "Fabric 7.4.0" }).click();
    await expect(page.getByTestId("poc-status")).toContainText("fabric 已就绪");
    const afterFabricResources = await nextAssetResources(page);
    const fabricIncrementalResources = afterFabricResources.filter((resource) => !beforeFabricResources.some((existing) => existing.name === resource.name));
    const fabric = await runCandidate(page, testInfo, "Fabric 7.4.0");

    await expect(page.getByTestId("poc-comparison-status")).toContainText("两个候选的技术 Gate 均已执行");
    const lifecycle = await runLifecycleProbe(page);
    const evidence = {
        capturedAt: new Date().toISOString(),
        browser: page.context().browser()?.version() || "unknown",
        viewport: page.viewportSize(),
        measurementRuns: MEASUREMENT_RUNS,
        candidates: {
            tldraw: { runs: tldraw, summary: summarizeCandidate(tldraw) },
            fabric: { runs: fabric, summary: summarizeCandidate(fabric) },
        },
        resources: { initialThroughTldraw: beforeFabricResources, fabricIncremental: fabricIncrementalResources },
        lifecycle,
        allowedBaselineHttpFailure: "409 /api/notifications/interactions：文件数据库不支持社区互动通知",
    };
    console.log(`Phase 1 measurement evidence:\n${JSON.stringify(evidence, null, 2)}`);
    await writeFile(testInfo.outputPath("phase-1-measurements.json"), JSON.stringify(evidence, null, 2), "utf8");
    await testInfo.attach("phase-1-measurements.json", { body: Buffer.from(JSON.stringify(evidence, null, 2)), contentType: "application/json" });

    expect(consoleErrors.filter((message) => !message.includes("license") && !message.includes("409 (Conflict)"))).toEqual([]);
    expect(unexpectedHttpFailures).toEqual([]);
});

async function runCandidate(page: Page, testInfo: TestInfo, buttonName: string) {
    await expect(page.getByRole("button", { name: buttonName })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("poc-status")).toContainText(/已就绪/);
    await page.getByRole("button", { name: "验证非法 Ops" }).click();
    await expect(page.getByTestId("poc-status")).toContainText("rejected / ELEMENT_NOT_FOUND, TYPE_MISMATCH, FRAME_NOT_FOUND", { timeout: 30_000 });
    await page.getByRole("button", { name: "载入统一夹具" }).click();
    await expect(page.getByTestId("poc-status")).toContainText("4 Frame / 28 元素商品图夹具");
    const screenshotPath = testInfo.outputPath(`${buttonName.startsWith("tldraw") ? "tldraw" : "fabric"}-workbench.png`);
    await page.getByTestId("design-poc-workbench").screenshot({ path: screenshotPath });
    await testInfo.attach(`${buttonName} workbench`, { path: screenshotPath, contentType: "image/png" });

    const runs: CandidateRun[] = [];
    for (let index = 0; index < MEASUREMENT_RUNS; index += 1) {
        await page.getByRole("button", { name: "运行 200 元素夹具" }).click();
        await expect(page.getByTestId("poc-status")).toContainText("200 元素载入与 60 次选择完成", { timeout: 60_000 });
        const performance = JSON.parse((await page.getByTestId("poc-performance-json").textContent()) || "null") as PerformanceMeasurement;

        await page.getByRole("button", { name: "运行完整 Gate" }).click();
        await expect(page.getByTestId("poc-status")).toContainText(/技术 Gate (?:通过|未通过)/, { timeout: 120_000 });
        const gate = JSON.parse((await page.getByTestId("poc-result-json").textContent()) || "null") as GateMeasurement;
        console.log(`${buttonName} run ${index + 1} Gate result:\n${JSON.stringify(gate, null, 2)}`);
        expect(gate.passed, gate.errors.join("；")).toBe(true);
        await expect(page.getByTestId("poc-status")).toContainText("技术 Gate 通过");
        await expect(page.locator('[data-metric="往返恢复"]')).toHaveText("10/10");
        await expect(page.getByTestId("poc-export-results")).toContainText("2000×2000");
        await expect(page.getByTestId("poc-export-results")).toContainText("4000×4000");
        expect(gate.visualChecks).toMatchObject({ cropPixelStable: true, frameClipStable: true });
        runs.push({ run: index + 1, gate, performance });
    }
    return runs;
}

async function runLifecycleProbe(page: Page) {
    let cdp: CDPSession | null = null;
    try {
        cdp = await page.context().newCDPSession(page);
    } catch {}
    const heapBytes: Array<number | null> = [await collectHeap(page, cdp)];
    for (let index = 0; index < 10; index += 1) {
        const buttonName = index % 2 === 0 ? "tldraw 5.2.5" : "Fabric 7.4.0";
        const engine = index % 2 === 0 ? "tldraw" : "fabric";
        await page.getByRole("button", { name: buttonName }).click();
        await expect(page.getByTestId("poc-status")).toContainText(`${engine} 已就绪`, { timeout: 30_000 });
        heapBytes.push(await collectHeap(page, cdp));
    }
    await cdp?.detach();
    return { switches: 10, heapBytes, preciseHeapAvailable: heapBytes.every((value) => value !== null) };
}

async function collectHeap(page: Page, cdp: CDPSession | null) {
    if (!cdp) return null;
    try {
        await cdp.send("HeapProfiler.collectGarbage");
        const usage = await cdp.send("Runtime.getHeapUsage");
        return usage.usedSize;
    } catch {
        return null;
    }
}

async function nextAssetResources(page: Page) {
    return page.evaluate(() =>
        performance
            .getEntriesByType("resource")
            .map((entry) => entry as PerformanceResourceTiming)
            .filter((entry) => entry.name.includes("/_next/static/"))
            .map((entry) => ({ name: new URL(entry.name).pathname, initiatorType: entry.initiatorType, transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, decodedBodySize: entry.decodedBodySize })),
    );
}

function summarizeCandidate(runs: CandidateRun[]) {
    const exportDurations = (format: "png" | "jpeg", scale: 1 | 2) => runs.map((run) => run.gate.exports.find((entry) => entry.format === format && entry.scale === scale)?.durationMs || 0);
    const exportBytes = (format: "png" | "jpeg", scale: 1 | 2) => runs.map((run) => run.gate.exports.find((entry) => entry.format === format && entry.scale === scale)?.bytes || 0);
    return {
        gateDurationMs: numericSummary(runs.map((run) => run.gate.durationMs)),
        loadDurationMs: numericSummary(runs.map((run) => run.gate.loadDurationMs)),
        operationDurationMs: numericSummary(runs.map((run) => run.gate.operationDurationMs)),
        performance200DurationMs: numericSummary(runs.map((run) => run.performance.durationMs)),
        longestLongTaskMs: numericSummary(runs.map((run) => run.performance.longestLongTaskMs || 0)),
        png1xDurationMs: numericSummary(exportDurations("png", 1)),
        png2xDurationMs: numericSummary(exportDurations("png", 2)),
        jpeg1xDurationMs: numericSummary(exportDurations("jpeg", 1)),
        png1xBytes: numericSummary(exportBytes("png", 1)),
        png2xBytes: numericSummary(exportBytes("png", 2)),
        documentBytes: numericSummary(runs.map((run) => run.gate.documentBytes)),
    };
}

function numericSummary(values: number[]) {
    const sorted = values.toSorted((left, right) => left - right);
    return { values, median: sorted[Math.floor(sorted.length / 2)], worst: sorted.at(-1) || 0 };
}
