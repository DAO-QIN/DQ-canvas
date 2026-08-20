import { describe, expect, it } from "vitest";

import { applyDesignOperationBatch } from "./operation-executor";
import { createDesignDocumentFixture } from "./design.test-fixture";
import { createDesignImageImportBatch, DesignImageImportError, type DesignImageImportInput } from "./image-import";

const NOW = "2026-08-12T12:00:00.000Z";

describe("Design image import batch", () => {
    it("atomically adds a stable uploaded asset and a workspace image element", () => {
        const document = createDesignDocumentFixture();
        const batch = createDesignImageImportBatch(document, {
            requestId: "upload-one",
            name: " 产品图 ",
            locator: { kind: "storage-key", storageKey: "permanent/2026/images/product.png" },
            mimeType: "image/png",
            width: 1200,
            height: 800,
            createdAt: NOW,
            target: { scope: "workspace" },
            position: { x: 40.1254, y: 80.3456 },
            source: "upload",
            operation: "upload",
        });

        expect(batch).toMatchObject({ mode: "atomic", source: "ui", expectedRevision: document.revision, operations: [{ type: "add-asset" }, { type: "create-element", index: 1 }] });
        const outcome = applyDesignOperationBatch(document, batch, { now: () => NOW });
        const addAsset = batch.operations[0];
        const createElement = batch.operations[1];
        expect(outcome.receipt.status).toBe("applied");
        expect(outcome.document.assets.at(-1)).toMatchObject({ id: addAsset.type === "add-asset" ? addAsset.asset.id : "", name: "产品图" });
        expect(outcome.document.elements.at(-1)).toMatchObject({ id: createElement.type === "create-element" ? createElement.element.id : "", frameId: null, transform: { x: 40.125, y: 80.346, width: 1200, height: 800 } });
        expect(outcome.document.layers.find((layer) => layer.scope === "workspace")?.elementIds.at(-1)).toBe(createElement.type === "create-element" ? createElement.element.id : "");
    });

    it("places a library asset in an explicit Frame and records generated provenance", () => {
        const document = createDesignDocumentFixture();
        const batch = createDesignImageImportBatch(document, {
            requestId: "task-result-one",
            name: "生成结果",
            locator: { kind: "library-asset", libraryAssetId: "library-result-one" },
            mimeType: "image/webp",
            width: 768,
            height: 1024,
            createdAt: NOW,
            target: { scope: "frame", frameId: "frame-social" },
            position: { x: 120, y: 160 },
            source: "generated",
            operation: "generate",
            generationTaskId: "task-one",
        });

        const outcome = applyDesignOperationBatch(document, batch, { now: () => NOW });
        expect(outcome.receipt.status).toBe("applied");
        expect(outcome.document.assetVersions.at(-1)).toMatchObject({ locator: { kind: "library-asset", libraryAssetId: "library-result-one" }, provenance: { operation: "generate", generationTaskId: "task-one" } });
        expect(outcome.document.elements.at(-1)).toMatchObject({ frameId: "frame-social", kind: "image", fit: "contain" });
        expect(outcome.document.layers.find((layer) => layer.scope === "frame" && layer.frameId === "frame-social")?.elementIds).toHaveLength(2);
    });

    it("derives the same stable ids for the same document and request identity", () => {
        const document = createDesignDocumentFixture();
        const input = {
            requestId: "stable-request",
            name: "Stable",
            locator: { kind: "storage-key" as const, storageKey: "permanent/stable.png" },
            mimeType: "image/png" as const,
            width: 10,
            height: 20,
            createdAt: NOW,
            target: { scope: "workspace" as const },
            position: { x: 0, y: 0 },
            source: "upload" as const,
            operation: "import" as const,
        };

        expect(createDesignImageImportBatch(document, input)).toEqual(createDesignImageImportBatch(document, input));
        expect(createDesignImageImportBatch({ ...document, revision: document.revision + 1 }, input).batchId).toBe(createDesignImageImportBatch(document, input).batchId);
    });

    it("keeps natural asset dimensions while using a fitted canvas display size", () => {
        const document = createDesignDocumentFixture();
        const batch = createDesignImageImportBatch(document, {
            requestId: "large-upload",
            name: "Large",
            locator: { kind: "storage-key", storageKey: "permanent/large.png" },
            mimeType: "image/png",
            width: 4000,
            height: 2000,
            displaySize: { width: 640, height: 320 },
            createdAt: NOW,
            target: { scope: "workspace" },
            position: { x: 10, y: 20 },
            source: "upload",
            operation: "upload",
        });

        expect(batch.operations[0]).toMatchObject({ type: "add-asset", initialVersion: { width: 4000, height: 2000 } });
        expect(batch.operations[1]).toMatchObject({ type: "create-element", element: { transform: { x: 10, y: 20, width: 640, height: 320 } } });
    });

    it("rolls back the asset when the paired element creation is rejected", () => {
        const document = createDesignDocumentFixture();
        const input: DesignImageImportInput = {
            requestId: "atomic-request",
            name: "Atomic",
            locator: { kind: "storage-key", storageKey: "permanent/atomic.png" },
            mimeType: "image/png",
            width: 100,
            height: 100,
            createdAt: NOW,
            target: { scope: "workspace" },
            position: { x: 0, y: 0 },
            source: "upload",
            operation: "upload",
        };
        const batch = createDesignImageImportBatch(document, input);
        const createElement = batch.operations[1];
        if (createElement.type !== "create-element") throw new Error("expected create-element");
        const conflicting = structuredClone(document);
        conflicting.elements.push({
            id: createElement.element.id,
            frameId: null,
            name: "Existing",
            transform: { x: 0, y: 0, width: 10, height: 10, rotation: 0, flipX: false, flipY: false },
            opacity: 1,
            blendMode: "normal",
            locked: false,
            hidden: false,
            kind: "shape",
            shape: "rectangle",
            fill: "#ffffff",
            stroke: null,
            strokeWidth: 0,
            cornerRadius: 0,
        });
        const workspace = conflicting.layers.find((layer) => layer.scope === "workspace");
        if (!workspace) throw new Error("expected workspace layer");
        workspace.elementIds.push(createElement.element.id);

        const outcome = applyDesignOperationBatch(conflicting, createDesignImageImportBatch(conflicting, input), { now: () => NOW });

        expect(outcome.receipt.status).toBe("rejected");
        expect(outcome.receipt.results).toMatchObject([
            { type: "add-asset", status: "rolled-back" },
            { type: "create-element", status: "rejected", error: { code: "ID_CONFLICT" } },
        ]);
        expect(outcome.document.assets).toEqual(conflicting.assets);
        expect(outcome.document.assetVersions).toEqual(conflicting.assetVersions);
    });

    it.each<[{ patch: Partial<DesignImageImportInput>; message: string }]>([
        [{ patch: { target: { scope: "frame", frameId: "missing" } }, message: "Frame 不存在：missing" }],
        [{ patch: { locator: { kind: "storage-key", storageKey: "https://signed.example/result.png" } }, message: "locator.storageKey 必须是稳定存储键" }],
        [{ patch: { locator: { kind: "storage-key", storageKey: "blob:temporary" } }, message: "locator.storageKey 必须是稳定存储键" }],
        [{ patch: { mimeType: "image/gif" as DesignImageImportInput["mimeType"] }, message: "mimeType 无效" }],
    ])("rejects invalid placement or unstable resources", ({ patch, message }) => {
        const document = createDesignDocumentFixture();
        const input = {
            requestId: "invalid-request",
            name: "Invalid",
            locator: { kind: "storage-key" as const, storageKey: "permanent/valid.png" },
            mimeType: "image/png" as const,
            width: 10,
            height: 10,
            createdAt: NOW,
            target: { scope: "workspace" as const },
            position: { x: 0, y: 0 },
            source: "upload" as const,
            operation: "upload" as const,
            ...patch,
        };

        expect(() => createDesignImageImportBatch(document, input)).toThrowError(new DesignImageImportError(message));
    });
});
