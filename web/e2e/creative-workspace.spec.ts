import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type APIRequestContext, type ConsoleMessage, type Locator, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import sharp from "sharp";

import { pollTask, protocolFixtureState, resetProtocolFixture } from "./support";

const WORKSPACE_VIEWPORTS = [
    { label: "desktop", width: 1440, height: 900 },
    { label: "rail-breakpoint", width: 860, height: 900 },
    { label: "compact", width: 520, height: 820 },
] as const;

const PNG_FIXTURE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGPQq/3/H4QZYAwAWewKpRUlAtEAAAAASUVORK5CYII=", "base64");
const MP4_FIXTURE = Buffer.from("AAAAIGZ0eXBpc29tAAACAGlzb21pc28ybXA0MQ==", "base64");

type DesignProjectEnvelope = {
    code?: number;
    data?: {
        project?: {
            id: string;
            revision: number;
            document: {
                frames: Array<{ id: string; name: string }>;
                elements: Array<{ id: string; name: string; kind?: string; assetVersionId?: string }>;
                assets: Array<{ id: string; kind: string; currentVersionId: string; versionIds: string[] }>;
                assetVersions: Array<{
                    id: string;
                    assetId: string;
                    parentVersionId: string | null;
                    locator: { kind: string; storageKey?: string };
                    provenance: { generationTaskId: string | null };
                }>;
            };
        };
    };
    msg?: string;
};

type CanvasProject = {
    id: string;
    nodes: Array<{
        id: string;
        type: string;
        title?: string;
        position: { x: number; y: number };
        width: number;
        height: number;
        metadata?: { locked?: boolean; [key: string]: unknown };
    }>;
    connections: Array<{ id: string; fromNodeId: string; toNodeId: string }>;
    viewport: { x: number; y: number; k: number };
};

type BrowserDiagnostics = {
    errors: string[];
    warnings: string[];
    allowedHttpFailures: string[];
    unexpectedHttpFailures: string[];
    pendingHttpChecks: Promise<void>[];
};

test.describe("Asui creative workspace", () => {
    for (const viewport of WORKSPACE_VIEWPORTS) {
        test(`keeps the shared Design shell reachable at ${viewport.width}px`, async ({ page, request }) => {
            const diagnostics = captureBrowserDiagnostics(page);
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
            const project = await createDesignProject(request, `E2E 布局 ${viewport.label} ${randomUUID().slice(0, 8)}`);

            await page.goto(`/design/${project.id}`, { waitUntil: "domcontentloaded" });
            await expectSharedWorkspace(page, viewport);
            await expectNoHorizontalOverflow(page, `Design ${viewport.width}px`);
            await captureWorkspaceScreenshot(page, `design-${viewport.width}.png`);
            await expectCleanBrowserDiagnostics(diagnostics, `Design ${viewport.width}px`);
        });
    }

    test("flushes a newly created Frame before returning and restores it after reopening", async ({ page, request }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const title = `E2E 立即返回 ${randomUUID().slice(0, 8)}`;
        const project = await createDesignProject(request, title);

        await page.goto(`/design/${project.id}`, { waitUntil: "domcontentloaded" });
        await expect(page.locator("[data-creative-workspace-shell]")).toBeVisible();
        await expect(page.getByRole("button", { name: "新建画框", exact: true })).toBeEnabled();

        const saveRequest = page.waitForResponse((response) => {
            if (response.request().method() !== "POST" || new URL(response.url()).pathname !== `/api/design/projects/${project.id}/operations`) return false;
            return (response.request().postDataJSON() as { label?: string } | null)?.label === "创建画框";
        });
        await page.getByRole("button", { name: "新建画框", exact: true }).click();
        await page.getByRole("button", { name: "返回我的画板", exact: true }).click();

        const response = await saveRequest;
        expect(response.ok(), await response.text()).toBe(true);
        await expect(page).toHaveURL(/\/design(?:\?|$)/);

        const persisted = await getDesignProject(request, project.id);
        expect(persisted.revision).toBe(project.revision + 1);
        expect(persisted.document.frames).toHaveLength(1);
        const frameName = persisted.document.frames[0]?.name;
        expect(frameName).toBeTruthy();

        await page.goto(`/design/${project.id}`, { waitUntil: "domcontentloaded" });
        await expect(page.locator("[data-creative-workspace-shell]")).toBeVisible();
        await expect(page.getByTestId("design-layer-panel").getByText(frameName!, { exact: true })).toBeVisible();
    });

    test("exports real source-size PNG, transparent WebP and a complete multi-Frame archive", async ({ page, request }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const diagnostics = captureBrowserDiagnostics(page);
        const project = await createDesignProject(request, `E2E Design export ${randomUUID().slice(0, 8)}`);
        await createDesignExportFrames(request, project, [
            { id: "frame-export-solid", name: "红色主图", width: 64, height: 48, background: "#ff0000" },
            { id: "frame-export-alpha", name: "透明画框", width: 32, height: 24, background: null },
        ]);

        await page.goto(`/design/${project.id}`, { waitUntil: "domcontentloaded" });
        const openExport = page.getByRole("button", { name: "导出画框", exact: true });
        await expect(openExport).toBeEnabled();

        await openExport.click();
        let dialog = page.getByRole("dialog", { name: "导出画框", exact: true });
        await expect(dialog).toBeVisible();
        await selectOnlyExportItem(dialog, 0);
        await chooseExportSettings(dialog, { format: "PNG", scale: "1x", background: "画框" });
        const pngDownloadPromise = page.waitForEvent("download");
        await dialog.getByRole("button", { name: "导出", exact: true }).click();
        const pngDownload = await pngDownloadPromise;
        expect(pngDownload.suggestedFilename()).toBe("红色主图.png");
        const png = await downloadBuffer(pngDownload);
        const pngMetadata = await sharp(png).metadata();
        expect(pngMetadata).toMatchObject({ format: "png", width: 64, height: 48 });
        const pngPixel = await sharp(png).ensureAlpha().raw().toBuffer();
        expect([...pngPixel.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
        await dialog.getByRole("button", { name: "完成", exact: true }).click();
        await expect(dialog).not.toBeVisible();
        await expect(openExport).toBeFocused();

        await openExport.click();
        dialog = page.getByRole("dialog", { name: "导出画框", exact: true });
        await selectOnlyExportItem(dialog, 1);
        await chooseExportSettings(dialog, { format: "WebP", scale: "1x", background: "透明" });
        const webpDownloadPromise = page.waitForEvent("download");
        await dialog.getByRole("button", { name: "导出", exact: true }).click();
        const webpDownload = await webpDownloadPromise;
        expect(webpDownload.suggestedFilename()).toBe("透明画框.webp");
        const webp = await downloadBuffer(webpDownload);
        const webpMetadata = await sharp(webp).metadata();
        expect(webpMetadata).toMatchObject({ format: "webp", width: 32, height: 24, hasAlpha: true });
        const webpPixels = await sharp(webp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        expect(minimumAlpha(webpPixels.data, webpPixels.info.channels)).toBe(0);
        await dialog.getByRole("button", { name: "完成", exact: true }).click();
        await expect(dialog).not.toBeVisible();

        await openExport.click();
        dialog = page.getByRole("dialog", { name: "导出画框", exact: true });
        await chooseExportSettings(dialog, { format: "PNG", scale: "1x", background: "画框" });
        const archiveDownloadPromise = page.waitForEvent("download");
        await dialog.getByRole("button", { name: "批量导出", exact: true }).click();
        const archiveDownload = await archiveDownloadPromise;
        expect(archiveDownload.suggestedFilename()).toMatch(/-frames-r\d+\.zip$/);
        const entries = unzipSync(new Uint8Array(await downloadBuffer(archiveDownload)));
        expect(Object.keys(entries).sort()).toEqual(["frames/红色主图.png", "frames/透明画框.png", "manifest.json"]);
        const manifest = JSON.parse(new TextDecoder().decode(entries["manifest.json"])) as { surface: string; frames: Array<{ id: string; fileName: string; pixelWidth: number; pixelHeight: number }> };
        expect(manifest.surface).toBe("design");
        expect(manifest.frames).toEqual([
            expect.objectContaining({ id: "frame-export-solid", fileName: "红色主图.png", pixelWidth: 64, pixelHeight: 48 }),
            expect.objectContaining({ id: "frame-export-alpha", fileName: "透明画框.png", pixelWidth: 32, pixelHeight: 24 }),
        ]);
        expect(await sharp(entries["frames/红色主图.png"]).metadata()).toMatchObject({ width: 64, height: 48 });
        expect(await sharp(entries["frames/透明画框.png"]).metadata()).toMatchObject({ width: 32, height: 24 });
        await expectCleanBrowserDiagnostics(diagnostics, "Design Frame downloads");
    });

    test("keeps the export dialog inside 1440/860/520 viewports and restores focus", async ({ page, request }) => {
        const diagnostics = captureBrowserDiagnostics(page);
        const project = await createDesignProject(request, `E2E Design export dialog ${randomUUID().slice(0, 8)}`);
        await createDesignExportFrames(request, project, [{ id: "frame-export-dialog", name: "响应式画框", width: 120, height: 80, background: "#ffffff" }]);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`/design/${project.id}`, { waitUntil: "domcontentloaded" });

        for (const viewport of WORKSPACE_VIEWPORTS) {
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
            const rightRail = page.locator("[data-workspace-right-rail]");
            if (viewport.width <= 860 && (await rightRail.getAttribute("data-state")) !== "closed") {
                await page.getByRole("button", { name: "收起辅助面板", exact: true }).click();
                await expect(rightRail).toHaveAttribute("data-state", "closed");
                await expect(rightRail).not.toBeVisible();
            }
            const openExport = page.getByRole("button", { name: "导出画框", exact: true });
            await openExport.click();
            const dialog = page.getByRole("dialog", { name: "导出画框", exact: true });
            await expect(dialog).toBeVisible();
            await expectExportDialogInsideViewport(dialog, viewport);
            await expectNoHorizontalOverflow(page, `Design export dialog ${viewport.width}px`);
            await captureExportScreenshot(page, `dialog-${viewport.width}.png`);

            await dialog.getByRole("button", { name: "关闭导出审阅", exact: true }).click();
            await expect(dialog).not.toBeVisible();
            await expect(openExport).toBeFocused();
        }
        await expectCleanBrowserDiagnostics(diagnostics, "Design export dialog responsiveness");
    });

    test("persists one generated Design image through the real task pipeline and replays it idempotently", async ({ page, request }) => {
        await resetProtocolFixture(request);
        await page.setViewportSize({ width: 1440, height: 900 });
        const diagnostics = captureBrowserDiagnostics(page);
        const project = await createDesignProject(request, `E2E Design generation ${randomUUID().slice(0, 8)}`);
        const prompt = `Design permanent image ${randomUUID().slice(0, 8)}`;

        await page.goto(`/design/${project.id}`, { waitUntil: "domcontentloaded" });
        const composer = page.getByTestId("workspace-generation-composer");
        const promptInput = page.getByRole("textbox", { name: "图片生成指令", exact: true });
        const submit = page.getByRole("button", { name: "生成图片", exact: true });
        await expect(composer).toBeVisible();
        await expect(page.getByRole("combobox", { name: "e2e-image", exact: true })).toBeVisible();
        await expect(submit).toBeDisabled();
        await promptInput.fill(prompt);
        await expect(submit).toBeEnabled();

        const taskCreated = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/image-tasks");
        const resultCommitted = page.waitForResponse((response) => {
            if (response.request().method() !== "POST" || new URL(response.url()).pathname !== `/api/design/projects/${project.id}/operations`) return false;
            return (response.request().postDataJSON() as { label?: string } | null)?.label === "插入生成图片";
        });
        await submit.click();

        const taskResponse = await taskCreated;
        expect(taskResponse.ok(), await taskResponse.text()).toBe(true);
        const taskId = ((await taskResponse.json()) as { task?: { id?: string } }).task?.id;
        expect(taskId).toBeTruthy();
        expect(await pollTask(request, `/api/image-tasks/${taskId}`)).toMatchObject({ status: "success", result: { width: 2, height: 2, mimeType: "image/png" } });

        const commitResponse = await resultCommitted;
        expect(commitResponse.ok(), await commitResponse.text()).toBe(true);
        await expect(page.getByRole("button", { name: "AI 生成图", exact: true })).toBeVisible();

        const persisted = await getDesignProject(request, project.id);
        expect(persisted.document.assets).toHaveLength(1);
        expect(persisted.document.assetVersions).toHaveLength(1);
        expect(persisted.document.elements).toHaveLength(1);
        const version = persisted.document.assetVersions[0];
        const element = persisted.document.elements[0];
        expect(version).toMatchObject({ parentVersionId: null, locator: { kind: "storage-key" }, provenance: { generationTaskId: taskId } });
        expect(version.locator.storageKey).toBeTruthy();
        expect(version.locator.storageKey).not.toMatch(/^(?:https?:|data:|blob:)/i);
        expect(element).toMatchObject({ kind: "image", assetVersionId: version.id });
        expect((await protocolFixtureState(request)).requests.filter((item) => item.method === "POST" && item.path.endsWith("/images/generations"))).toHaveLength(1);

        await page.getByRole("button", { name: "AI 生成图", exact: true }).click();
        await expect(page.getByText("所选图片将作为改图参考", { exact: true })).toBeVisible();
        await expect(page.getByRole("img", { name: "参考图 1", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "移除参考图 1", exact: true })).toHaveCount(0);

        let replayWrites = 0;
        page.on("request", (request) => {
            if (request.method() === "POST" && new URL(request.url()).pathname === `/api/design/projects/${project.id}/operations`) replayWrites += 1;
        });
        const recoveredTasks = page.waitForResponse((response) => {
            const url = new URL(response.url());
            return response.request().method() === "GET" && url.pathname === "/api/generation-tasks" && url.searchParams.get("surface") === "design" && url.searchParams.get("projectId") === project.id;
        });
        await page.reload({ waitUntil: "domcontentloaded" });
        expect((await recoveredTasks).ok()).toBe(true);
        await expect(page.getByRole("button", { name: "AI 生成图", exact: true })).toBeVisible();
        await expect.poll(async () => (await getDesignProject(request, project.id)).revision).toBe(persisted.revision);
        expect(replayWrites).toBe(0);
        const replayed = await getDesignProject(request, project.id);
        expect(replayed.document.assets).toHaveLength(1);
        expect(replayed.document.assetVersions).toHaveLength(1);
        expect(replayed.document.elements).toHaveLength(1);
        await expectCleanBrowserDiagnostics(diagnostics, "Design image generation and replay");
    });

    test("keeps the shared Canvas shell reachable at 1440/860/520 without overflow", async ({ page, request }) => {
        for (const viewport of WORKSPACE_VIEWPORTS) {
            const projectId = await createCanvasProject(request, `E2E Canvas 契约 ${viewport.label} ${randomUUID().slice(0, 8)}`);
            const diagnostics = captureBrowserDiagnostics(page);
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
            await page.goto(`/canvas/${projectId}`, { waitUntil: "domcontentloaded" });

            await expectCanvasWorkspace(page, viewport);
            await createCanvasNodeFromDock(page, viewport, "新建图片");
            await expect(page.locator('[data-workspace-generation-capability="image"]')).toBeVisible();
            await expectCanvasComposerPlacement(page);
            await expectNoHorizontalOverflow(page, `Canvas ${viewport.width}px`);
            await captureWorkspaceScreenshot(page, `canvas-${viewport.width}.png`);
            await expectCleanBrowserDiagnostics(diagnostics, `Canvas ${viewport.width}px`);
        }
    });

    test("hands one permanent image from Canvas to Design and back into another Canvas", async ({ page, request }) => {
        const suffix = randomUUID().slice(0, 8);
        const sourceTitle = `E2E Handoff source ${suffix}`;
        const designTargetTitle = `E2E Handoff design ${suffix}`;
        const canvasTargetTitle = `E2E Handoff canvas ${suffix}`;
        const sourceCanvasId = await createCanvasProject(request, sourceTitle);
        const designTarget = await createDesignProject(request, designTargetTitle);
        const targetCanvasId = await createCanvasProject(request, canvasTargetTitle);
        const diagnostics = captureBrowserDiagnostics(page);

        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`/canvas/${sourceCanvasId}`, { waitUntil: "domcontentloaded" });
        const canvasHandoff = page.getByRole("button", { name: "交接到画板", exact: true });
        await expect(canvasHandoff).toBeDisabled();

        await page.getByRole("button", { name: "新建图片", exact: true }).click();
        await expect(canvasHandoff, "blank image nodes must not be transferable").toBeDisabled();
        const imageTargetId = await page.locator("[data-node-id]").first().getAttribute("data-node-id");
        expect(imageTargetId).toBeTruthy();
        const imageSaved = page.waitForResponse((response) => canvasPatchContainsReference(response, sourceCanvasId, "handoff-source.png", "image", imageTargetId!));
        await page.locator('[data-workspace-generation-capability="image"] input[type="file"]').setInputFiles({ name: "handoff-source.png", mimeType: "image/png", buffer: PNG_FIXTURE });
        expect((await imageSaved).ok()).toBe(true);

        const sourceCanvas = await getCanvasProject(request, sourceCanvasId);
        const sourceImage = sourceCanvas.nodes.find((node) => node.title === "handoff-source.png");
        expect(sourceImage).toMatchObject({ type: "image", metadata: { storageKey: expect.stringMatching(/^permanent\//) } });
        await page.locator(`[data-node-id="${sourceImage!.id}"]`).focus();
        await page.keyboard.press("Enter");
        await expect(canvasHandoff).toBeEnabled();
        await canvasHandoff.click();

        const canvasDialog = page.getByRole("dialog", { name: "跨工作台交接" });
        await expect(canvasDialog).toBeVisible();
        await expect(canvasDialog.getByText(designTargetTitle, { exact: false })).toBeVisible();
        const canvasToDesign = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/workspace/handoffs");
        await canvasDialog.getByRole("button", { name: "开始交接", exact: true }).click();
        expect((await canvasToDesign).status()).toBe(200);
        await expect(canvasDialog.getByText("素材交接完成", { exact: true })).toBeVisible();
        await captureWorkspaceScreenshot(page, "canvas-to-design-applied.png");
        await canvasDialog.getByRole("button", { name: "打开目标项目", exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/design/${designTarget.id}(?:\\?|$)`));

        const importedDesign = await getDesignProject(request, designTarget.id);
        expect(importedDesign.revision).toBe(designTarget.revision + 1);
        expect(importedDesign.document.elements).toEqual([expect.objectContaining({ kind: "image", name: "handoff-source.png" })]);
        expect(importedDesign.document.assetVersions[0]?.locator.storageKey).toMatch(/^permanent\//);
        const designLayer = page.getByTestId("design-layer-panel").getByRole("button", { name: "handoff-source.png", exact: true });
        await expect(designLayer).toBeVisible();
        await designLayer.click();

        const designHandoff = page.getByRole("button", { name: "交接到画布", exact: true });
        await expect(designHandoff).toBeEnabled();
        await designHandoff.click();
        const designDialog = page.getByRole("dialog", { name: "跨工作台交接" });
        await expect(designDialog).toBeVisible();
        await designDialog.getByRole("combobox").click();
        await page.getByRole("option", { name: new RegExp(canvasTargetTitle) }).click();
        const designToCanvas = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/workspace/handoffs");
        await designDialog.getByRole("button", { name: "开始交接", exact: true }).click();
        expect((await designToCanvas).status()).toBe(200);
        await expect(designDialog.getByText("素材交接完成", { exact: true })).toBeVisible();
        await captureWorkspaceScreenshot(page, "design-to-canvas-applied.png");
        await designDialog.getByRole("button", { name: "打开目标项目", exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/canvas/${targetCanvasId}(?:\\?|$)`));

        const importedCanvas = await getCanvasProject(request, targetCanvasId);
        expect(importedCanvas.nodes).toEqual([expect.objectContaining({ type: "image", title: "handoff-source.png", metadata: expect.objectContaining({ storageKey: sourceImage?.metadata?.storageKey }) })]);
        await expect(page.locator("[data-node-id]")).toHaveCount(1);
        await expectNoHorizontalOverflow(page, "bidirectional Handoff target Canvas");
        await expectCleanBrowserDiagnostics(diagnostics, "bidirectional Handoff");
    });

    test("switches the single Canvas composer across all generation capabilities and hides it for incompatible selections", async ({ page, request }) => {
        const projectId = await createCanvasProject(request, `E2E Canvas Composer ${randomUUID().slice(0, 8)}`);
        const diagnostics = captureBrowserDiagnostics(page);
        const viewport = WORKSPACE_VIEWPORTS[0];
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(`/canvas/${projectId}`, { waitUntil: "domcontentloaded" });

        for (const [label, capability, capabilityLabel] of [
            ["新建图片", "image", "图片"],
            ["新建文本", "text", "文本"],
            ["新建视频", "video", "视频"],
            ["新建音频", "audio", "音频"],
        ] as const) {
            await createCanvasNodeFromDock(page, viewport, label);
            const composer = page.getByTestId("workspace-generation-composer");
            await expect(composer).toHaveCount(1);
            await expect(page.locator(`[data-workspace-generation-capability="${capability}"]`)).toBeVisible();
            await expect(page.getByRole("textbox", { name: `${capabilityLabel}生成指令`, exact: true })).toBeVisible();
            await expect(page.locator("[data-node-id]").filter({ has: composer })).toHaveCount(0);
        }

        await createCanvasNodeFromDock(page, viewport, "新建绘图");
        await expect(page.getByTestId("workspace-generation-composer")).toHaveCount(0);

        const firstCompatibleId = await page.locator("[data-node-id]").nth(0).getAttribute("data-node-id");
        const secondCompatibleId = await page.locator("[data-node-id]").nth(1).getAttribute("data-node-id");
        expect(firstCompatibleId).toBeTruthy();
        expect(secondCompatibleId).toBeTruthy();
        await page.locator(`[data-node-id="${firstCompatibleId}"]`).focus();
        await page.keyboard.press("Enter");
        await page.locator(`[data-node-id="${secondCompatibleId}"]`).focus();
        await page.keyboard.down("Shift");
        await page.keyboard.press("Enter");
        await page.keyboard.up("Shift");
        await expect(page.locator('[data-node-id][data-selected="true"]')).toHaveCount(2);
        await expect(page.getByTestId("workspace-generation-composer")).toHaveCount(0);
        await expectCleanBrowserDiagnostics(diagnostics, "Canvas shared composer capability switching");
    });

    test("uploads image and video references as permanent connected Canvas nodes without replay duplicates", async ({ page, request }) => {
        const projectId = await createCanvasProject(request, `E2E Canvas reference upload ${randomUUID().slice(0, 8)}`);
        const diagnostics = captureBrowserDiagnostics(page);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`/canvas/${projectId}`, { waitUntil: "domcontentloaded" });

        await page.getByRole("button", { name: "新建图片", exact: true }).click();
        const imageTargetId = await page.locator("[data-node-id]").first().getAttribute("data-node-id");
        expect(imageTargetId).toBeTruthy();
        const imageComposer = page.locator('[data-workspace-generation-capability="image"]');
        const imageInput = imageComposer.locator('input[type="file"]');
        await expect(imageInput).toHaveAttribute("accept", "image/png,image/jpeg,image/webp");

        const imageSaved = page.waitForResponse((response) => canvasPatchContainsReference(response, projectId, "reference-image.png", "image", imageTargetId!));
        await imageInput.setInputFiles({ name: "reference-image.png", mimeType: "image/png", buffer: PNG_FIXTURE });
        expect((await imageSaved).ok()).toBe(true);
        await expect(page.locator("[data-node-id]")).toHaveCount(2);
        await expect(page.locator("[data-connection-id]")).toHaveCount(1);

        await page.getByRole("button", { name: "新建视频", exact: true }).click();
        await expect(page.locator("[data-node-id]")).toHaveCount(3);
        const videoTargetId = await page.locator("[data-node-id]").last().getAttribute("data-node-id");
        expect(videoTargetId).toBeTruthy();
        const videoComposer = page.locator('[data-workspace-generation-capability="video"]');
        const videoInput = videoComposer.locator('input[type="file"]');
        const videoAccept = await videoInput.getAttribute("accept");
        expect(videoAccept?.split(",")).toEqual(["image/png", "image/jpeg", "image/webp", "video/mp4", "video/webm", "video/quicktime"]);

        const videoSaved = page.waitForResponse((response) => canvasPatchContainsReference(response, projectId, "reference-video.mp4", "video", videoTargetId!));
        await videoInput.setInputFiles({ name: "reference-video.mp4", mimeType: "video/mp4", buffer: MP4_FIXTURE });
        expect((await videoSaved).ok()).toBe(true);
        await expect(page.locator("[data-node-id]")).toHaveCount(4);
        await expect(page.locator("[data-connection-id]")).toHaveCount(2);

        const persisted = await getCanvasProject(request, projectId);
        const imageReference = persisted.nodes.find((node) => node.title === "reference-image.png");
        const videoReference = persisted.nodes.find((node) => node.title === "reference-video.mp4");
        expect(imageReference).toMatchObject({ type: "image", metadata: { mimeType: "image/png" } });
        expect(videoReference).toMatchObject({ type: "video", metadata: { mimeType: "video/mp4" } });
        expect(String(imageReference?.metadata?.storageKey)).toMatch(/^permanent\//);
        expect(String(videoReference?.metadata?.storageKey)).toMatch(/^permanent\//);
        expect(persisted.connections).toEqual(expect.arrayContaining([expect.objectContaining({ fromNodeId: imageReference?.id, toNodeId: imageTargetId }), expect.objectContaining({ fromNodeId: videoReference?.id, toNodeId: videoTargetId })]));

        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(page.locator("[data-node-id]")).toHaveCount(4);
        await expect(page.locator("[data-connection-id]")).toHaveCount(2);
        const replayed = await getCanvasProject(request, projectId);
        expect(replayed.nodes).toHaveLength(4);
        expect(replayed.connections).toHaveLength(2);
        await expectCleanBrowserDiagnostics(diagnostics, "Canvas permanent reference uploads");
    });

    test("creates a sibling Canvas crop result with provenance and replays it without duplication", async ({ page, request }) => {
        const projectId = await createCanvasProject(request, `E2E Canvas crop ${randomUUID().slice(0, 8)}`);
        const diagnostics = captureBrowserDiagnostics(page);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`/canvas/${projectId}`, { waitUntil: "domcontentloaded" });

        await createCanvasNodeFromDock(page, WORKSPACE_VIEWPORTS[0], "新建图片");
        const targetNodeId = await page.locator("[data-node-id]").first().getAttribute("data-node-id");
        expect(targetNodeId).toBeTruthy();

        const imageComposer = page.locator('[data-workspace-generation-capability="image"]');
        const imageSaved = page.waitForResponse((response) => canvasPatchContainsReference(response, projectId, "crop-source.png", "image", targetNodeId!));
        await imageComposer.locator('input[type="file"]').setInputFiles({ name: "crop-source.png", mimeType: "image/png", buffer: PNG_FIXTURE });
        expect((await imageSaved).ok()).toBe(true);
        await expect(page.locator("[data-node-id]")).toHaveCount(2);

        const uploaded = await getCanvasProject(request, projectId);
        const source = uploaded.nodes.find((node) => node.title === "crop-source.png");
        expect(source).toMatchObject({ type: "image", metadata: { mimeType: "image/png" } });
        expect(String(source?.metadata?.storageKey)).toMatch(/^permanent\//);
        const sourceNodeId = source?.id;
        expect(sourceNodeId).toBeTruthy();

        const sourceLocator = page.locator(`[data-node-id="${sourceNodeId}"]`);
        await sourceLocator.hover();
        await expect(page.getByRole("button", { name: /裁剪/ }).first()).toBeVisible();
        await page.getByRole("button", { name: /裁剪/ }).first().click();
        await expect(page.getByRole("dialog", { name: "裁剪图片" })).toBeVisible();

        const cropPersisted = page.waitForResponse((response) => {
            if (response.request().method() !== "PATCH" || new URL(response.url()).pathname !== `/api/canvas/projects/${projectId}`) return false;
            const body = canvasPatchProject(response);
            return Boolean(body?.nodes?.some((node) => node.metadata?.derivedOperation === "crop" && node.metadata?.derivedImageProvenance));
        });
        await page.getByRole("button", { name: /确认裁剪/ }).click();
        expect((await cropPersisted).ok()).toBe(true);
        await expect(page.locator("[data-node-id]")).toHaveCount(3);

        const cropped = await getCanvasProject(request, projectId);
        expect(cropped.nodes).toHaveLength(3);
        expect(cropped.connections).toHaveLength(2);
        const derived = cropped.nodes.find((node) => node.metadata?.derivedOperation === "crop");
        expect(derived).toMatchObject({ type: "image", metadata: { derivedOperation: "crop" } });
        expect(derived?.metadata?.derivedImageProvenance).toMatchObject({ operation: "crop", sourceNodeId });
        expect(cropped.connections).toEqual(expect.arrayContaining([expect.objectContaining({ fromNodeId: sourceNodeId, toNodeId: derived?.id })]));
        expect(cropped.nodes.some((node) => node.id === sourceNodeId)).toBe(true);

        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(page.locator("[data-node-id]")).toHaveCount(3);
        await expect(page.locator("[data-connection-id]")).toHaveCount(2);
        const replayed = await getCanvasProject(request, projectId);
        expect(replayed.nodes).toHaveLength(3);
        expect(replayed.nodes.filter((node) => node.metadata?.derivedOperation === "crop")).toHaveLength(1);
        await expectCleanBrowserDiagnostics(diagnostics, "Canvas crop provenance and replay");
    });

    test("creates real Canvas nodes and a connection, flushes on leave, and restores after reopening", async ({ page, request }) => {
        const projectId = await createCanvasProject(request, `E2E Canvas 保存 ${randomUUID().slice(0, 8)}`);
        const diagnostics = captureBrowserDiagnostics(page);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`/canvas/${projectId}`, { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("canvas-creative-workspace")).toBeVisible();

        await page.getByRole("button", { name: "新建文本", exact: true }).click();
        await expect(page.locator("[data-node-id]")).toHaveCount(1);
        const sourceNode = page.locator("[data-node-id]").first();
        const sourceId = await sourceNode.getAttribute("data-node-id");
        expect(sourceId).toBeTruthy();

        await sourceNode.hover();
        await sourceNode.getByRole("button", { name: "从此节点连接", exact: true }).click();
        await expect(page.locator("[data-connection-create-menu]")).toBeVisible();
        await page
            .locator("[data-connection-create-menu]")
            .getByRole("button", { name: /图片生成/ })
            .click();

        await expect(page.locator("[data-node-id]")).toHaveCount(2);
        await expect(page.locator("[data-connection-id]")).toHaveCount(1);

        const saveResponse = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/canvas/projects/${projectId}`);
        await page.getByRole("button", { name: "打开画布菜单", exact: true }).click();
        await page.getByRole("menuitem", { name: "我的画布", exact: true }).click();
        expect((await saveResponse).ok()).toBe(true);
        await expect(page).toHaveURL(/\/canvas(?:\?|$)/);

        const persisted = await getCanvasProject(request, projectId);
        expect(persisted.nodes).toHaveLength(2);
        expect(persisted.connections).toHaveLength(1);
        expect(persisted.connections[0]).toMatchObject({ fromNodeId: sourceId });

        await page.goto(`/canvas/${projectId}`, { waitUntil: "domcontentloaded" });
        await expect(page.locator("[data-node-id]")).toHaveCount(2);
        await expect(page.locator("[data-connection-id]")).toHaveCount(1);
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(page.locator("[data-node-id]")).toHaveCount(2);
        await expect(page.locator("[data-connection-id]")).toHaveCount(1);
        await expectCleanBrowserDiagnostics(diagnostics, "Canvas node/connection persistence");
    });

    test("flushes a debounced Canvas viewport before immediate navigation and restores it", async ({ page, request }) => {
        const projectId = await createCanvasProject(request, `E2E Canvas viewport ${randomUUID().slice(0, 8)}`);
        const diagnostics = captureBrowserDiagnostics(page);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`/canvas/${projectId}`, { waitUntil: "domcontentloaded" });
        const surface = page.locator(".canvas-surface");
        await expect(surface).toBeVisible();
        const before = await getCanvasProject(request, projectId);
        const surfaceBox = await box(surface);

        await page.mouse.move(surfaceBox.x + surfaceBox.width * 0.72, surfaceBox.y + surfaceBox.height * 0.52);
        await page.mouse.down();
        await page.mouse.move(surfaceBox.x + surfaceBox.width * 0.72 + 173, surfaceBox.y + surfaceBox.height * 0.52 + 81, { steps: 3 });
        await page.mouse.up();

        const saveResponse = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/canvas/projects/${projectId}`);
        await page.getByRole("button", { name: "打开画布菜单", exact: true }).click();
        await page.getByRole("menuitem", { name: "我的画布", exact: true }).click();
        expect((await saveResponse).ok()).toBe(true);

        const persisted = await getCanvasProject(request, projectId);
        expect(Math.abs(persisted.viewport.x - before.viewport.x) + Math.abs(persisted.viewport.y - before.viewport.y)).toBeGreaterThan(100);
        await page.goto(`/canvas/${projectId}`, { waitUntil: "domcontentloaded" });
        await expect(surface).toBeVisible();
        const restoredTransform = await page.locator(".canvas-surface > .origin-top-left").getAttribute("style");
        expect(restoredTransform).toContain(`translate(${persisted.viewport.x}px, ${persisted.viewport.y}px)`);
        await expectCleanBrowserDiagnostics(diagnostics, "Canvas viewport persistence");
    });

    test("exposes stable Canvas contracts and the hosted Agent rail", async ({ page, request }) => {
        const projectId = await createCanvasProject(request, `E2E Canvas Agent ${randomUUID().slice(0, 8)}`);
        const diagnostics = captureBrowserDiagnostics(page);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`/canvas/${projectId}`, { waitUntil: "domcontentloaded" });

        const sharedShell = page.locator("[data-creative-workspace-shell]");

        await expect(sharedShell).toBeVisible();
        await expect(page.locator("[data-workspace-top-bar]")).toBeVisible();
        await expect(page.locator("[data-workspace-tool-dock]")).toBeVisible();
        await expect(page.locator("[data-workspace-zoom-dock]")).toBeVisible();
        await expect(page.getByRole("button", { name: "打开画布菜单", exact: true })).toBeVisible();
        for (const label of ["新建文本", "新建图片", "新建全景图", "新建绘图", "新建视频", "新建音频", "新建生成配置"]) {
            await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
        }
        await expect(page.getByRole("button", { name: "重置视图", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "打开画布快捷键", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Agent 对话", exact: true })).toBeVisible();

        await page.getByRole("button", { name: "Agent 对话", exact: true }).click();
        const rail = page.locator("[data-workspace-right-rail]");
        await expect(rail).toHaveAttribute("data-state", "open");
        await expect(page.locator("[data-canvas-agent-hosted]")).toBeVisible();
        await expect(page.getByRole("button", { name: "收起 Agent", exact: true })).toBeVisible();
        await page.getByRole("button", { name: "收起 Agent", exact: true }).click();
        await expect(rail).toHaveAttribute("data-state", "closed");
        await expect(rail).not.toBeVisible();
        await expectCleanBrowserDiagnostics(diagnostics, "Canvas hosted Agent");
    });

    test("edits a single Canvas selection size, persists it, and keeps one shared bottom Composer", async ({ page, request }) => {
        const projectId = await createCanvasProject(request, `E2E Canvas size ${randomUUID().slice(0, 8)}`);
        const diagnostics = captureBrowserDiagnostics(page);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`/canvas/${projectId}`, { waitUntil: "domcontentloaded" });

        await page.getByRole("button", { name: "新建文本", exact: true }).click();
        const node = page.locator("[data-node-id]").first();
        await expect(node).toBeVisible();
        const nodeId = await node.getAttribute("data-node-id");
        expect(nodeId).toBeTruthy();

        const sizeBar = page.locator("[data-workspace-selection-size-bar]");
        await expect(sizeBar).toBeVisible();
        const widthInput = page.locator('input[aria-label="选区宽度"]');
        const heightInput = page.locator('input[aria-label="选区高度"]');
        await expect(widthInput).toHaveValue("340");
        await expect(heightInput).toHaveValue("240");

        const resizedPatch = page.waitForResponse(async (response) => {
            if (response.request().method() !== "PATCH" || new URL(response.url()).pathname !== `/api/canvas/projects/${projectId}`) return false;
            const body = canvasPatchProject(response);
            return Boolean(body?.nodes?.some((item) => item.id === nodeId && item.width === 500 && item.height === 280));
        });
        await widthInput.fill("500");
        await heightInput.fill("280");
        await heightInput.press("Enter");
        expect((await resizedPatch).ok()).toBe(true);

        const persisted = await getCanvasProject(request, projectId);
        const resizedNode = persisted.nodes.find((item) => item.id === nodeId);
        expect(resizedNode).toMatchObject({ width: 500, height: 280 });

        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(page.locator(`[data-node-id="${nodeId}"]`)).toBeVisible();
        await page.locator(`[data-node-id="${nodeId}"]`).focus();
        await page.keyboard.press("Enter");
        await expect(page.getByTestId("workspace-generation-composer")).toHaveCount(1);
        await expect(page.locator('[data-workspace-generation-capability="text"]')).toBeVisible();
        await expect(page.getByRole("textbox", { name: "文本生成指令", exact: true })).toBeVisible();
        await expect(page.locator(`[data-node-id="${nodeId}"]`).getByRole("textbox", { name: "文本生成指令", exact: true })).toHaveCount(0);
        await expect(page.locator("[data-workspace-selection-prompt]")).toHaveCount(0);
        await expectCanvasComposerPlacement(page);
        await expectCleanBrowserDiagnostics(diagnostics, "Canvas selection size and shared Composer");
    });

    test("disables shared size editing for multi-selection and locked nodes", async ({ page, request }) => {
        const projectId = await createCanvasProject(request, `E2E Canvas selection guards ${randomUUID().slice(0, 8)}`);
        const diagnostics = captureBrowserDiagnostics(page);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`/canvas/${projectId}`, { waitUntil: "domcontentloaded" });

        await page.getByRole("button", { name: "新建文本", exact: true }).click();
        const firstNode = page.locator("[data-node-id]").first();
        const firstId = await firstNode.getAttribute("data-node-id");
        expect(firstId).toBeTruthy();
        await page.getByRole("button", { name: "新建文本", exact: true }).click();
        const allNodes = page.locator("[data-node-id]");
        await expect(allNodes).toHaveCount(2);
        const secondId = await allNodes.nth(1).getAttribute("data-node-id");
        expect(secondId).toBeTruthy();

        await page.locator(`[data-node-id="${firstId}"]`).focus();
        await page.keyboard.press("Enter");
        await page.locator(`[data-node-id="${secondId}"]`).focus();
        await page.keyboard.down("Shift");
        await page.keyboard.press("Enter");
        await page.keyboard.up("Shift");
        await expect(page.locator('[data-node-id][data-selected="true"]')).toHaveCount(2);
        await expect(page.locator("[data-workspace-selection-size-bar]")).toBeVisible();
        await expect(page.locator('input[aria-label="选区宽度"]')).toBeDisabled();
        await expect(page.locator('input[aria-label="选区高度"]')).toBeDisabled();

        await page.locator(`[data-node-id="${firstId}"]`).focus();
        await page.keyboard.press("Enter");
        await page.locator(`[data-node-id="${firstId}"]`).hover();
        const lockedPatch = page.waitForResponse(async (response) => {
            if (response.request().method() !== "PATCH" || new URL(response.url()).pathname !== `/api/canvas/projects/${projectId}`) return false;
            const body = canvasPatchProject(response);
            return Boolean(body?.nodes?.some((item) => item.id === firstId && item.metadata?.locked === true));
        });
        await page.locator('button[aria-label="锁定位置和尺寸"]').click();
        await expect(page.locator(`[data-node-id="${firstId}"] [data-canvas-node-lock-badge]`)).toBeVisible();
        await expect(page.locator("[data-workspace-selection-size-bar]")).toContainText("已锁定");
        await expect(page.locator('input[aria-label="选区宽度"]')).toBeDisabled();
        await expect(page.locator('input[aria-label="选区高度"]')).toBeDisabled();
        expect((await lockedPatch).ok()).toBe(true);

        const locked = await getCanvasProject(request, projectId);
        expect(locked.nodes.find((item) => item.id === firstId)?.metadata?.locked).toBe(true);
        await expectCleanBrowserDiagnostics(diagnostics, "Canvas multi-selection and lock guards");
    });
});

async function expectSharedWorkspace(page: Page, viewport: (typeof WORKSPACE_VIEWPORTS)[number]) {
    const shell = page.locator("[data-creative-workspace-shell]");
    const topBar = page.locator("[data-workspace-top-bar]");
    const toolDock = page.locator("[data-workspace-tool-dock]");
    const zoomDock = page.locator("[data-workspace-zoom-dock]");
    const rightRail = page.locator("[data-workspace-right-rail]");

    await expect(shell).toBeVisible();
    await expect(topBar).toBeVisible();
    await expect(toolDock).toBeVisible();
    await expect(zoomDock).toBeVisible();
    await expect(rightRail).toBeVisible();
    await expect(page.getByRole("button", { name: "返回我的画板", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "新建画框", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "新建文字", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "新建形状、线条或箭头", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "交接到画布", exact: true })).toBeVisible();

    const [shellBox, topBarBox, toolDockBox, zoomDockBox, railBox] = await Promise.all([box(shell), box(topBar), box(toolDock), box(zoomDock), box(rightRail)]);
    expect(shellBox.width).toBeCloseTo(viewport.width, 0);
    expect(shellBox.height).toBeCloseTo(viewport.height, 0);
    expectInside(topBarBox, shellBox, "top bar");
    expectInside(toolDockBox, shellBox, "tool dock");
    expectInside(zoomDockBox, shellBox, "zoom dock");
    expectInside(railBox, shellBox, "right rail");
    expect(overlapArea(toolDockBox, zoomDockBox), "tool dock and zoom dock must not overlap").toBe(0);

    if (viewport.width > 860) {
        expect(railBox.width).toBeGreaterThanOrEqual(400);
        expect(railBox.width).toBeLessThanOrEqual(460);
        expect(railBox.x, "desktop rail must be a right-side sibling").toBeGreaterThan(shellBox.width - railBox.width - 24);
        expect(overlapArea(topBarBox, railBox), "desktop top bar must stay in the canvas pane").toBe(0);
    } else {
        expect(railBox.x).toBeGreaterThanOrEqual(11);
        expect(railBox.x + railBox.width).toBeLessThanOrEqual(viewport.width - 11);
        expect(railBox.y + railBox.height).toBeLessThanOrEqual(viewport.height - 11);
        expect(railBox.y).toBeGreaterThan(0);
    }

    if (viewport.width === 520) {
        expect(toolDockBox.height).toBeCloseTo(44, 0);
        expect(topBarBox.height).toBeGreaterThanOrEqual(48);
        expect(zoomDockBox.y + zoomDockBox.height).toBeLessThanOrEqual(toolDockBox.y);
    } else {
        expect(toolDockBox.height).toBeCloseTo(56, 0);
        expect(topBarBox.height).toBeGreaterThanOrEqual(56);
    }

    const composer = page.getByTestId("workspace-generation-composer");
    await expect(composer).toBeVisible();
    if (viewport.width <= 860) {
        await page.getByRole("button", { name: "收起辅助面板", exact: true }).click();
        await expect(rightRail).toHaveAttribute("data-state", "closed");
        await expect(rightRail).not.toBeVisible();
    }
    const composerBox = await box(composer);
    expect(overlapArea(composerBox, toolDockBox), "generation composer and tool dock must not overlap").toBe(0);
    expect(overlapArea(composerBox, zoomDockBox), "generation composer and zoom dock must not overlap").toBe(0);
}

async function expectCanvasWorkspace(page: Page, viewport: (typeof WORKSPACE_VIEWPORTS)[number]) {
    const shell = page.locator("[data-creative-workspace-shell]");
    const topBar = page.locator("[data-workspace-top-bar]");
    const toolDock = page.locator("[data-workspace-tool-dock]");
    const zoomDock = page.locator("[data-workspace-zoom-dock]");
    const rightRail = page.locator("[data-workspace-right-rail]");

    await expect(shell).toBeVisible();
    await expect(topBar).toBeVisible();
    await expect(toolDock).toBeVisible();
    await expect(zoomDock).toBeVisible();
    await expect(rightRail).toBeAttached();
    await expect(page.getByRole("button", { name: "打开画布菜单", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Agent 对话", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "交接到画板", exact: true })).toBeVisible();

    const [shellBox, topBarBox, toolDockBox, zoomDockBox] = await Promise.all([box(shell), box(topBar), box(toolDock), box(zoomDock)]);
    expect(shellBox.width).toBeCloseTo(viewport.width, 0);
    expectInside(topBarBox, shellBox, "Canvas top bar");
    expectInside(toolDockBox, shellBox, "Canvas tool dock");
    expectInside(zoomDockBox, shellBox, "Canvas zoom dock");
    expect(overlapArea(toolDockBox, zoomDockBox), "Canvas tool and zoom docks must not overlap").toBe(0);

    if (viewport.width === 520) {
        expect(toolDockBox.height).toBeCloseTo(44, 0);
        expect(zoomDockBox.y + zoomDockBox.height).toBeLessThanOrEqual(toolDockBox.y);
        await page.getByRole("button", { name: "添加组件", exact: true }).click();
        for (const label of ["新建文本", "新建图片", "新建全景图", "新建绘图", "新建视频", "新建音频", "新建生成配置"]) {
            await expect(page.getByRole("menuitem", { name: label, exact: true })).toBeVisible();
        }
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu", { name: "添加组件", exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "添加组件", exact: true })).toHaveAttribute("aria-pressed", "false");
    } else {
        expect(toolDockBox.height).toBeCloseTo(56, 0);
        for (const label of ["新建文本", "新建图片", "新建全景图", "新建绘图", "新建视频", "新建音频", "新建生成配置"]) {
            await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
        }
    }
}

async function createCanvasNodeFromDock(page: Page, viewport: (typeof WORKSPACE_VIEWPORTS)[number], label: string) {
    if (viewport.width === 520) {
        await page.getByRole("button", { name: "添加组件", exact: true }).click();
        await page.getByRole("menuitem", { name: label, exact: true }).click();
        return;
    }
    await page.getByRole("button", { name: label, exact: true }).click();
}

async function expectCanvasComposerPlacement(page: Page) {
    const composer = page.getByTestId("workspace-generation-composer");
    const toolDock = page.locator("[data-workspace-tool-dock]");
    const zoomDock = page.locator("[data-workspace-zoom-dock]");
    await expect(composer).toHaveCount(1);
    const [composerBox, toolDockBox, zoomDockBox] = await Promise.all([box(composer), box(toolDock), box(zoomDock)]);
    expect(overlapArea(composerBox, toolDockBox), "Canvas composer and tool dock must not overlap").toBe(0);
    expect(overlapArea(composerBox, zoomDockBox), "Canvas composer and zoom dock must not overlap").toBe(0);
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
    const overflow = await page.evaluate(() => ({
        body: document.body.scrollWidth - document.body.clientWidth,
        document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(overflow.body, `${label}: body horizontal overflow`).toBeLessThanOrEqual(1);
    expect(overflow.document, `${label}: document horizontal overflow`).toBeLessThanOrEqual(1);
}

async function captureWorkspaceScreenshot(page: Page, fileName: string) {
    const directory = path.resolve(process.cwd(), "output/playwright/p5-handoff");
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, fileName), fullPage: true });
}

async function captureExportScreenshot(page: Page, fileName: string) {
    const directory = path.resolve(process.cwd(), "output/playwright/p6-export");
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, fileName), fullPage: true });
}

async function createDesignProject(request: APIRequestContext, title: string) {
    const response = await request.post("/api/design/projects", { data: { title } });
    expect(response.ok(), await response.text()).toBe(true);
    const payload = (await response.json()) as DesignProjectEnvelope;
    const project = payload.data?.project;
    expect(project, payload.msg || "Design project response is missing data.project").toBeTruthy();
    return project!;
}

async function getDesignProject(request: APIRequestContext, projectId: string) {
    const response = await request.get(`/api/design/projects/${encodeURIComponent(projectId)}`);
    expect(response.ok(), await response.text()).toBe(true);
    const payload = (await response.json()) as DesignProjectEnvelope;
    const project = payload.data?.project;
    expect(project, payload.msg || "Design project response is missing data.project").toBeTruthy();
    return project!;
}

async function createDesignExportFrames(request: APIRequestContext, project: { id: string; revision: number }, frames: ReadonlyArray<{ id: string; name: string; width: number; height: number; background: string | null }>) {
    const response = await request.post(`/api/design/projects/${encodeURIComponent(project.id)}/operations`, {
        data: {
            batchId: `batch-e2e-export-${randomUUID()}`,
            expectedRevision: project.revision,
            mode: "atomic",
            source: "ui",
            label: "准备导出画框",
            operations: frames.map((frame, index) => ({
                opId: `op-e2e-export-${randomUUID()}`,
                type: "create-frame",
                frame: {
                    ...frame,
                    x: 100 + index * 240,
                    y: 100,
                    locked: false,
                    export: { format: "png", scale: 1, quality: 1, background: "frame" },
                },
                index,
            })),
        },
    });
    expect(response.ok(), await response.text()).toBe(true);
}

async function selectOnlyExportItem(dialog: Locator, index: number) {
    await dialog.getByRole("button", { name: "清空", exact: true }).click();
    await dialog.getByRole("checkbox").nth(index).check();
    await expect(dialog.getByRole("checkbox").nth(index)).toBeChecked();
}

async function chooseExportSettings(dialog: Locator, settings: { format: "PNG" | "JPEG" | "WebP"; scale: "1x" | "2x" | "3x" | "4x"; background: "画框" | "透明" | "白色" }) {
    await dialog.getByRole("radio", { name: settings.format, exact: true }).click();
    await dialog.getByRole("radio", { name: settings.scale, exact: true }).click();
    await dialog.getByRole("radio", { name: settings.background, exact: true }).click();
}

async function downloadBuffer(download: import("@playwright/test").Download) {
    expect(await download.failure()).toBeNull();
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    return readFile(filePath!);
}

function minimumAlpha(data: Uint8Array, channels: number) {
    let minimum = 255;
    for (let index = channels - 1; index < data.length; index += channels) minimum = Math.min(minimum, data[index]);
    return minimum;
}

async function expectExportDialogInsideViewport(dialog: Locator, viewport: (typeof WORKSPACE_VIEWPORTS)[number]) {
    const dialogBox = await box(dialog);
    expectInside(dialogBox, { x: 0, y: 0, width: viewport.width, height: viewport.height }, `export dialog ${viewport.width}px`);
    const geometry = await dialog.evaluate((element) => {
        const panel = element.firstElementChild as HTMLElement | null;
        const body = panel?.children.item(1) as HTMLElement | null;
        const footer = panel?.lastElementChild as HTMLElement | null;
        return {
            dialogOverflow: element.scrollWidth - element.clientWidth,
            panelOverflow: panel ? panel.scrollWidth - panel.clientWidth : -1,
            bodyOverflow: body ? body.scrollWidth - body.clientWidth : -1,
            footerBottom: footer?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY,
            dialogBottom: element.getBoundingClientRect().bottom,
        };
    });
    expect(geometry.dialogOverflow, "dialog horizontal overflow").toBeLessThanOrEqual(1);
    expect(geometry.panelOverflow, "dialog panel horizontal overflow").toBeLessThanOrEqual(1);
    expect(geometry.bodyOverflow, "dialog body horizontal overflow").toBeLessThanOrEqual(1);
    expect(geometry.footerBottom, "dialog footer must remain visible").toBeLessThanOrEqual(geometry.dialogBottom + 1);
}

async function createCanvasProject(request: APIRequestContext, title: string) {
    const response = await request.post("/api/canvas/projects", { data: { title } });
    expect(response.ok(), await response.text()).toBe(true);
    const payload = (await response.json()) as { data?: { project?: { id: string } }; msg?: string };
    const projectId = payload.data?.project?.id;
    expect(projectId, payload.msg || "Canvas project response is missing data.project.id").toBeTruthy();
    return projectId!;
}

async function getCanvasProject(request: APIRequestContext, projectId: string) {
    const response = await request.get(`/api/canvas/projects/${encodeURIComponent(projectId)}`);
    expect(response.ok(), await response.text()).toBe(true);
    const payload = (await response.json()) as { data?: { project?: CanvasProject }; msg?: string };
    const project = payload.data?.project;
    expect(project, payload.msg || "Canvas project response is missing data.project").toBeTruthy();
    return project!;
}

function canvasPatchContainsReference(response: import("@playwright/test").Response, projectId: string, title: string, type: string, targetNodeId: string) {
    if (response.request().method() !== "PATCH" || new URL(response.url()).pathname !== `/api/canvas/projects/${projectId}`) return false;
    const body = canvasPatchProject(response);
    const reference = body?.nodes?.find((node) => node.title === title && node.type === type && String(node.metadata?.storageKey || "").startsWith("permanent/"));
    return Boolean(reference && body?.connections?.some((connection) => connection.fromNodeId === reference.id && connection.toNodeId === targetNodeId));
}

function canvasPatchProject(response: import("@playwright/test").Response): CanvasProject | null {
    const body = response.request().postDataJSON() as ({ project?: CanvasProject } & Partial<CanvasProject>) | null;
    return body?.project || body;
}

function captureBrowserDiagnostics(page: Page): BrowserDiagnostics {
    const diagnostics: BrowserDiagnostics = { errors: [], warnings: [], allowedHttpFailures: [], unexpectedHttpFailures: [], pendingHttpChecks: [] };
    page.on("console", (message) => recordConsoleMessage(diagnostics, message));
    page.on("pageerror", (error) => diagnostics.errors.push(`pageerror: ${error.message}`));
    page.on("response", (response) => {
        if (response.status() < 400) return;
        diagnostics.pendingHttpChecks.push(recordHttpFailure(diagnostics, response));
    });
    return diagnostics;
}

function recordConsoleMessage(diagnostics: BrowserDiagnostics, message: ConsoleMessage) {
    if (message.type() === "error") diagnostics.errors.push(message.text());
    if (message.type() === "warning") diagnostics.warnings.push(message.text());
}

async function expectCleanBrowserDiagnostics(diagnostics: BrowserDiagnostics, label: string) {
    await Promise.all(diagnostics.pendingHttpChecks);
    const allowedConflictCount = diagnostics.allowedHttpFailures.length;
    const conflictErrors = diagnostics.errors.filter(isAllowedFileDatabaseConsoleError);
    expect(conflictErrors.length, `${label}: every 409 console error must match the file-database notification baseline`).toBeLessThanOrEqual(allowedConflictCount);
    expect(
        diagnostics.errors.filter((message) => !isAllowedFileDatabaseConsoleError(message)),
        `${label}: browser errors`,
    ).toEqual([]);
    expect(diagnostics.warnings, `${label}: browser warnings`).toEqual([]);
    expect(diagnostics.unexpectedHttpFailures, `${label}: unexpected HTTP failures`).toEqual([]);
}

async function recordHttpFailure(diagnostics: BrowserDiagnostics, response: import("@playwright/test").Response) {
    const url = new URL(response.url());
    const detail = `${response.status()} ${response.request().method()} ${url.pathname}`;
    if (response.status() === 409 && response.request().method() === "GET" && url.pathname === "/api/notifications/interactions") {
        const body = await response.text().catch(() => "");
        if (body.includes("社区互动需要启用 PostgreSQL 数据库")) {
            diagnostics.allowedHttpFailures.push(detail);
            return;
        }
    }
    diagnostics.unexpectedHttpFailures.push(detail);
}

function isAllowedFileDatabaseConsoleError(message: string) {
    return message.includes("409 (Conflict)");
}

async function box(locator: Locator) {
    const value = await locator.boundingBox();
    expect(value, "expected visible element to have a bounding box").not.toBeNull();
    return value!;
}

function expectInside(inner: { x: number; y: number; width: number; height: number }, outer: { x: number; y: number; width: number; height: number }, label: string) {
    const tolerance = 1;
    expect(inner.x, `${label} left edge`).toBeGreaterThanOrEqual(outer.x - tolerance);
    expect(inner.y, `${label} top edge`).toBeGreaterThanOrEqual(outer.y - tolerance);
    expect(inner.x + inner.width, `${label} right edge`).toBeLessThanOrEqual(outer.x + outer.width + tolerance);
    expect(inner.y + inner.height, `${label} bottom edge`).toBeLessThanOrEqual(outer.y + outer.height + tolerance);
}

function overlapArea(first: { x: number; y: number; width: number; height: number }, second: { x: number; y: number; width: number; height: number }) {
    const width = Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x));
    const height = Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y));
    return width * height;
}
