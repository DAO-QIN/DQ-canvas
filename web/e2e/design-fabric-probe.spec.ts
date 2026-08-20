import { expect, test, type Page } from "@playwright/test";

type ProbeDiagnostics = {
    objectCount: number;
    objects: Array<{ key: string; id: string; frameId: string | null; instanceId: number; index: number }>;
    active: { kind: "active-selection" | "object" | null; ids: string[] };
    counters: { created: number; replaced: number; removed: number; reordered: number; updated: number };
};

test("reconciles 200+ Fabric objects incrementally and preserves selection boundaries", async ({ page }) => {
    const browserErrors: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error") browserErrors.push(message.text());
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/design-fabric-probe", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("design-fabric-browser-probe")).toBeVisible();
    await expect.poll(() => diagnostics(page).then((value) => value.objectCount)).toBe(207);

    const initial = await diagnostics(page);
    expect(initial.active).toMatchObject({ kind: "active-selection", ids: ["text-one", "image-one"] });
    expect(initial.objects.filter((object) => object.key.startsWith("element:perf-"))).toHaveLength(200);
    const initialInstances = instanceMap(initial);

    const updateStartedAt = Date.now();
    await page.getByRole("button", { name: "Update rich elements", exact: true }).click();
    await expect.poll(() => revision(page)).toBe(1);
    await expect.poll(() => diagnostics(page).then((value) => value.counters.updated)).toBeGreaterThan(initial.counters.updated);
    const richUpdateDurationMs = Date.now() - updateStartedAt;
    const afterRichUpdate = await diagnostics(page);
    expect(afterRichUpdate.counters.replaced).toBe(initial.counters.replaced);
    expect(afterRichUpdate.counters.removed).toBe(initial.counters.removed);
    expect(instanceMap(afterRichUpdate)).toEqual(initialInstances);
    expect(richUpdateDurationMs).toBeLessThan(2_000);

    await page.getByRole("button", { name: "Change arrow topology", exact: true }).click();
    await expect.poll(() => revision(page)).toBe(2);
    await expect.poll(() => diagnostics(page).then((value) => value.counters.replaced)).toBe(initial.counters.replaced + 1);
    const afterArrowChange = await diagnostics(page);
    expect(instance(afterArrowChange, "element:arrow-one")).not.toBe(initialInstances["element:arrow-one"]);
    for (const key of ["element:text-one", "element:image-one", "element:line-one", "element:perf-137"]) {
        expect(instance(afterArrowChange, key)).toBe(initialInstances[key]);
    }

    const workspaceOrderBefore = workspacePerformanceOrder(afterArrowChange);
    await page.getByRole("button", { name: "Reorder workspace", exact: true }).click();
    await expect.poll(() => revision(page)).toBe(3);
    await expect.poll(() => diagnostics(page).then((value) => value.counters.reordered)).toBeGreaterThan(afterArrowChange.counters.reordered);
    const afterReorder = await diagnostics(page);
    expect(workspacePerformanceOrder(afterReorder)).toEqual([...workspaceOrderBefore].reverse());
    expect(instanceMap(afterReorder)).toEqual({ ...initialInstances, "element:arrow-one": instance(afterArrowChange, "element:arrow-one") });

    await page.getByRole("button", { name: "Select cross frame", exact: true }).click();
    await expect.poll(() => diagnostics(page).then((value) => value.active.kind)).toBeNull();
    await page.getByRole("button", { name: "Select same frame", exact: true }).click();
    await expect.poll(() => diagnostics(page).then((value) => value.active.kind)).toBe("active-selection");

    await page.getByRole("button", { name: "Move active selection", exact: true }).click();
    await expect(page.getByTestId("probe-last-intent")).toContainText('"kind":"elements"');
    const transformIntent = JSON.parse((await page.getByTestId("probe-last-intent").textContent()) || "null") as { transforms?: unknown[] } | null;
    expect(transformIntent?.transforms).toHaveLength(2);

    const textInstance = instance(await diagnostics(page), "element:text-one");
    await page.getByRole("button", { name: "Move text across frame", exact: true }).click();
    await expect.poll(() => revision(page)).toBe(4);
    await expect.poll(() => diagnostics(page).then((value) => value.objects.find((object) => object.key === "element:text-one")?.frameId)).toBe("frame-two");
    const afterCrossFrameMove = await diagnostics(page);
    expect(instance(afterCrossFrameMove, "element:text-one")).toBe(textInstance);
    expect(afterCrossFrameMove.active.kind).toBeNull();

    const paintedPixels = await page.locator("[data-testid=design-fabric-surface] canvas.lower-canvas").evaluate((canvas) => {
        const element = canvas as HTMLCanvasElement;
        const context = element.getContext("2d");
        if (!context) return 0;
        const pixels = context.getImageData(0, 0, element.width, element.height).data;
        let painted = 0;
        for (let index = 3; index < pixels.length; index += 64) if (pixels[index] > 0) painted += 1;
        return painted;
    });
    expect(paintedPixels).toBeGreaterThan(100);
    expect(browserErrors).toEqual([]);
});

async function diagnostics(page: Page) {
    return page.evaluate(() => window.__dqDesignFabricProbe?.diagnostics() as ProbeDiagnostics);
}

async function revision(page: Page) {
    const value = await page.getByTestId("probe-document").textContent();
    return Number((JSON.parse(value || "{}") as { revision?: number }).revision ?? -1);
}

function instanceMap(value: ProbeDiagnostics) {
    return Object.fromEntries(value.objects.map((object) => [object.key, object.instanceId]));
}

function instance(value: ProbeDiagnostics, key: string) {
    const object = value.objects.find((candidate) => candidate.key === key);
    expect(object, `missing Fabric projection ${key}`).toBeTruthy();
    return object!.instanceId;
}

function workspacePerformanceOrder(value: ProbeDiagnostics) {
    return value.objects
        .filter((object) => object.key.startsWith("element:perf-"))
        .sort((left, right) => left.index - right.index)
        .map((object) => object.key);
}
