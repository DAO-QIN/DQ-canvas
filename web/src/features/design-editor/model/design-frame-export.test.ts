import { unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { createDesignDocumentFixture } from "@/lib/design/design.test-fixture";

import { assertDesignExportPixelBudget, createDesignFrameExportBundle } from "./design-frame-export";

describe("Design Frame export orchestration", () => {
    it("returns a single encoded Frame without wrapping it in an archive", async () => {
        const document = createDesignDocumentFixture();
        const exportFrame = vi.fn(async (plan) => ({ frameId: plan.frame.id, fileName: plan.fileName, mimeType: plan.mimeType, width: plan.pixelWidth, height: plan.pixelHeight, blob: new Blob([plan.frame.id], { type: plan.mimeType }) }));
        const result = await createDesignFrameExportBundle({ document, frameIds: ["frame-main"], options: { format: "webp", scale: 1, background: "transparent", quality: 0.8 }, exportFrame });

        expect(result.fileName).toBe("Amazon 主图.webp");
        expect(result.blob.type).toBe("image/webp");
        expect(result.results).toHaveLength(1);
    });

    it("exports in document order and packages complete results with a revision manifest", async () => {
        const document = createDesignDocumentFixture();
        const progress = vi.fn();
        const exportFrame = vi.fn(async (plan) => ({ frameId: plan.frame.id, fileName: plan.fileName, mimeType: plan.mimeType, width: plan.pixelWidth, height: plan.pixelHeight, blob: new Blob([plan.frame.id], { type: plan.mimeType }) }));
        const result = await createDesignFrameExportBundle({ document, frameIds: ["frame-main", "frame-social"], options: { format: "png", scale: 1, background: "white", quality: 1 }, exportFrame, reportProgress: progress });
        const files = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
        const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));

        expect(exportFrame.mock.calls.map(([plan]) => plan.frame.id)).toEqual(["frame-main", "frame-social"]);
        expect(Object.keys(files).sort()).toEqual(["frames/Amazon 主图.png", "frames/社媒竖图.png", "manifest.json"]);
        expect(manifest).toMatchObject({ schemaVersion: 1, surface: "design", documentId: document.id, revision: 7 });
        expect(manifest.frames.map((frame: { id: string }) => frame.id)).toEqual(["frame-main", "frame-social"]);
        expect(result.fileName).toBe("商品图 Campaign-frames-r7.zip");
        expect(progress).toHaveBeenLastCalledWith({ completed: 2, total: 2, currentItemId: null, currentItemName: null });
    });

    it("keeps same-name Frames as distinct archive entries", async () => {
        const document = createDesignDocumentFixture();
        document.frames[1].name = document.frames[0].name;
        const result = await createDesignFrameExportBundle({
            document,
            frameIds: ["frame-main", "frame-social"],
            options: { format: "png", scale: 1 },
            exportFrame: async (plan) => ({ frameId: plan.frame.id, fileName: plan.fileName, mimeType: plan.mimeType, width: plan.pixelWidth, height: plan.pixelHeight, blob: new Blob([plan.frame.id], { type: plan.mimeType }) }),
        });
        expect(Object.keys(unzipSync(new Uint8Array(await result.blob.arrayBuffer()))).sort()).toEqual(["frames/Amazon 主图-2.png", "frames/Amazon 主图.png", "manifest.json"]);
    });

    it("does not produce a partial archive when any Frame export fails", async () => {
        const document = createDesignDocumentFixture();
        const exportFrame = vi
            .fn()
            .mockResolvedValueOnce({ frameId: "frame-main", fileName: "main.png", mimeType: "image/png", width: 2000, height: 2000, blob: new Blob(["ok"], { type: "image/png" }) })
            .mockRejectedValueOnce(new Error("图片加载失败"));
        await expect(createDesignFrameExportBundle({ document, frameIds: ["frame-main", "frame-social"], options: { format: "png", scale: 1 }, exportFrame })).rejects.toThrow("图片加载失败");
    });

    it("rejects a single unsafe pixel allocation before invoking Fabric", () => {
        const document = createDesignDocumentFixture();
        const plan = { frame: document.frames[0], pixelWidth: 20_000, pixelHeight: 20_000 } as Parameters<typeof assertDesignExportPixelBudget>[0][number];
        expect(() => assertDesignExportPixelBudget([plan])).toThrow("超出浏览器安全像素预算");
    });

    it("rejects an unsafe combined batch before invoking Fabric", async () => {
        const document = createDesignDocumentFixture();
        document.frames = [
            { ...document.frames[0], width: 5_000, height: 5_000 },
            { ...document.frames[1], width: 5_000, height: 5_000 },
            { ...document.frames[1], id: "frame-third", name: "第三张", x: 8_000, width: 5_000, height: 5_000 },
        ];
        document.layers.push({ scope: "frame", frameId: "frame-third", elementIds: [] });
        const exportFrame = vi.fn();
        await expect(
            createDesignFrameExportBundle({
                document,
                frameIds: ["frame-main", "frame-social", "frame-third"],
                options: { format: "png", scale: 2 },
                exportFrame,
            }),
        ).rejects.toThrow("批量导出总像素");
        expect(exportFrame).not.toHaveBeenCalled();
    });
});
