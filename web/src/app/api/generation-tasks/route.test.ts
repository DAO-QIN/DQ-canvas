import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), listStoredGenerationTaskRecords: vi.fn(), getLocalMediaRegistrations: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/generation-task-store", () => ({ listStoredGenerationTaskRecords: mocks.listStoredGenerationTaskRecords }));
vi.mock("@/lib/server/local-media-registry", () => ({ getLocalMediaRegistrations: mocks.getLocalMediaRegistrations }));

import { GET } from "./route";

describe("GET /api/generation-tasks", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one" });
        mocks.getLocalMediaRegistrations.mockResolvedValue([]);
        mocks.listStoredGenerationTaskRecords.mockResolvedValue({
            items: [
                {
                    id: "running",
                    userId: "user-one",
                    type: "image",
                    status: "running",
                    payload: { progress: 0.4, prompt: "portrait", sourceNodeId: "node-one", targetNodeId: "result-one", billing: { pointsCost: 4, pointsRecordId: "charge-one" } },
                    projectId: "canvas-one",
                    surface: "canvas",
                    createdAt: 1000,
                    updatedAt: 2000,
                    expiresAt: 5000,
                    executionPhase: "polling",
                },
            ],
            total: 1,
        });
    });

    it("scopes active tasks to the current user and canvas project", async () => {
        const response = await GET(new Request("http://localhost/api/generation-tasks?projectId=canvas-one&limit=10"));

        expect(response.status).toBe(200);
        expect(mocks.listStoredGenerationTaskRecords).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-one", projectId: "canvas-one", surface: "canvas", statuses: ["pending", "running", "paused"], includeAll: false }));
        expect(await response.json()).toEqual({
            code: 0,
            data: {
                tasks: [expect.objectContaining({ id: "running", status: "running", progress: 40, stage: "polling", sourceNodeId: "node-one", targetNodeId: "result-one", billing: { pointsCost: 4, refunded: false } })],
                total: 1,
            },
            msg: "OK",
        });
    });

    it("scopes Design tasks without falling back to Canvas", async () => {
        mocks.listStoredGenerationTaskRecords.mockResolvedValueOnce({ items: [], total: 0 });

        const response = await GET(new Request("http://localhost/api/generation-tasks?surface=design&projectId=design-one"));

        expect(response.status).toBe(200);
        expect(mocks.listStoredGenerationTaskRecords).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-one", projectId: "design-one", surface: "design" }));
    });

    it("returns only a verified stable image result and Design recovery fields", async () => {
        mocks.listStoredGenerationTaskRecords.mockResolvedValueOnce({
            items: [
                {
                    id: "design-image",
                    userId: "user-one",
                    type: "image",
                    status: "success",
                    payload: {
                        config: { quality: "high", size: "1024x1024", apiKey: "provider-secret", advancedConfig: { queryPath: "/internal" } },
                        result: {
                            dataUrl: "data:image/png;base64,SECRET",
                            serverUrl: "/api/generation-log-assets/permanent/2026/image/result.png",
                            remoteUrl: "https://provider.example/result.png",
                            width: 1024,
                            height: 1024,
                            bytes: 123,
                        },
                        upstream: { id: "upstream-secret", providerPayload: { token: "secret" } },
                        binding: { surface: "design", projectId: "design-one", target: { scope: "frame", frameId: "frame-one" }, elementId: "element-one" },
                    },
                    surface: "design",
                    projectId: "design-one",
                    clientRequestId: "design-request-one",
                    attemptNo: 2,
                    binding: { surface: "design", projectId: "design-one", target: { scope: "frame", frameId: "frame-one" }, elementId: "element-one" },
                    createdAt: 1_000,
                    updatedAt: 2_000,
                    expiresAt: 5_000,
                },
            ],
            total: 1,
        });
        mocks.getLocalMediaRegistrations.mockResolvedValueOnce([
            {
                storageKey: "permanent/2026/image/result.png",
                scope: "generation",
                storageClass: "permanent",
                type: "image",
                ownerUserId: "user-one",
                source: "image-workbench",
                mimeType: "image/png",
                bytes: 123,
                createdAt: "2026-08-13T00:00:00.000Z",
            },
        ]);

        const response = await GET(new Request("http://localhost/api/generation-tasks?surface=design&projectId=design-one&activeOnly=false"));
        const payload = await response.json();

        expect(mocks.getLocalMediaRegistrations).toHaveBeenCalledWith(["permanent/2026/image/result.png"]);
        expect(payload.data.tasks).toEqual([
            expect.objectContaining({
                id: "design-image",
                clientRequestId: "design-request-one",
                attemptNo: 2,
                quality: "high",
                size: "1024x1024",
                binding: { surface: "design", projectId: "design-one", target: { scope: "frame", frameId: "frame-one" }, elementId: "element-one" },
                imageResult: { storageKey: "permanent/2026/image/result.png", mimeType: "image/png", width: 1024, height: 1024, bytes: 123 },
            }),
        ]);
        const serialized = JSON.stringify(payload);
        expect(serialized).not.toContain("data:image");
        expect(serialized).not.toContain("provider.example");
        expect(serialized).not.toContain("provider-secret");
        expect(serialized).not.toContain("upstream-secret");
    });

    it("omits unverified image results and mismatched bindings", async () => {
        mocks.listStoredGenerationTaskRecords.mockResolvedValueOnce({
            items: [
                {
                    id: "unsafe-result",
                    userId: "user-one",
                    type: "image",
                    status: "success",
                    payload: {
                        result: { serverUrl: "/api/generation-log-assets/temporary/result.png", width: 32, height: 32 },
                        binding: { surface: "design", projectId: "another-project", target: { scope: "workspace" } },
                    },
                    surface: "design",
                    projectId: "design-one",
                    createdAt: 1,
                    updatedAt: 2,
                    expiresAt: 3,
                },
            ],
            total: 1,
        });
        mocks.getLocalMediaRegistrations.mockResolvedValueOnce([
            {
                storageKey: "temporary/result.png",
                scope: "generation",
                storageClass: "temporary",
                type: "image",
                ownerUserId: "another-user",
                source: "image-workbench",
                mimeType: "image/png",
                bytes: 10,
                createdAt: "2026-08-13T00:00:00.000Z",
            },
        ]);

        const response = await GET(new Request("http://localhost/api/generation-tasks?surface=design&projectId=design-one&activeOnly=false"));
        const task = (await response.json()).data.tasks[0];

        expect(task.imageResult).toBeUndefined();
        expect(task.binding).toBeUndefined();
    });

    it("rejects unknown task surfaces instead of leaking Canvas tasks", async () => {
        const response = await GET(new Request("http://localhost/api/generation-tasks?surface=unknown&projectId=design-one"));

        expect(response.status).toBe(400);
        expect(mocks.listStoredGenerationTaskRecords).not.toHaveBeenCalled();
    });

    it("requires authentication", async () => {
        mocks.getCurrentUser.mockResolvedValue(null);
        const response = await GET(new Request("http://localhost/api/generation-tasks"));
        expect(response.status).toBe(401);
        expect(mocks.listStoredGenerationTaskRecords).not.toHaveBeenCalled();
    });

    it("keeps paused tasks visible to the active task indicator", async () => {
        mocks.listStoredGenerationTaskRecords.mockResolvedValueOnce({
            items: [{ id: "paused", userId: "user-one", type: "video", status: "paused", payload: {}, projectId: "canvas-one", surface: "canvas", createdAt: 1000, updatedAt: 2000, expiresAt: 5000 }],
            total: 1,
        });

        const response = await GET(new Request("http://localhost/api/generation-tasks?projectId=canvas-one"));
        expect((await response.json()).data.tasks).toEqual([expect.objectContaining({ id: "paused", status: "paused" })]);
    });

    it("maps persisted background-removal milestones without time-derived progress", async () => {
        mocks.listStoredGenerationTaskRecords.mockResolvedValueOnce({
            items: [
                {
                    id: "cutout",
                    userId: "user-one",
                    type: "image_process",
                    status: "running",
                    payload: {
                        sourceNodeId: "source",
                        sourceStorageKey: "source.png",
                        model: "isnet-anime",
                        progressStage: "inference",
                        progress: 91,
                        options: { version: 3, model: "isnet-anime", outputMode: "transparent", backgroundColor: [255, 255, 255, 255] },
                        optionsHash: "hash",
                    },
                    projectId: "canvas-one",
                    surface: "canvas",
                    createdAt: 1_000,
                    updatedAt: 2_000,
                    expiresAt: 5_000,
                    executionPhase: "polling",
                    lastUpstreamStatus: "processing",
                },
            ],
            total: 1,
        });

        const response = await GET(new Request("http://localhost/api/generation-tasks?projectId=canvas-one"));

        expect((await response.json()).data.tasks).toEqual([expect.objectContaining({ id: "cutout", model: "isnet-anime", progressStage: "inference", progress: 50, stage: "rembg \u63a8\u7406", sourceNodeId: "source", sourceStorageKey: "source.png" })]);
    });

    it("returns a verified permanent image result for a successful Design background-removal task", async () => {
        mocks.listStoredGenerationTaskRecords.mockResolvedValueOnce({
            items: [
                {
                    id: "design-cutout",
                    userId: "user-one",
                    type: "image_process",
                    status: "success",
                    payload: {
                        sourceElementId: "element-one",
                        sourceAssetVersionId: "version-one",
                        result: { storageKey: "permanent/cutout.png", width: 640, height: 480, mimeType: "image/png", bytes: 321 },
                        binding: { surface: "design", projectId: "design-one", baseRevision: 4, target: { scope: "workspace" }, elementId: "element-one", assetVersionId: "version-one" },
                    },
                    surface: "design",
                    projectId: "design-one",
                    createdAt: 1,
                    updatedAt: 2,
                    expiresAt: 3,
                },
            ],
            total: 1,
        });
        mocks.getLocalMediaRegistrations.mockResolvedValueOnce([
            {
                storageKey: "permanent/cutout.png",
                scope: "reference",
                storageClass: "permanent",
                type: "image",
                ownerUserId: "user-one",
                source: "design",
                mimeType: "image/png",
                bytes: 321,
                createdAt: "2026-08-14T00:00:00.000Z",
            },
        ]);

        const response = await GET(new Request("http://localhost/api/generation-tasks?surface=design&projectId=design-one&activeOnly=false"));
        const result = (await response.json()).data.tasks[0];

        expect(result).toMatchObject({
            id: "design-cutout",
            type: "image_process",
            status: "succeeded",
            sourceElementId: "element-one",
            sourceAssetVersionId: "version-one",
            imageResult: { storageKey: "permanent/cutout.png", mimeType: "image/png", width: 640, height: 480, bytes: 321 },
            binding: { surface: "design", projectId: "design-one", elementId: "element-one", assetVersionId: "version-one" },
        });
    });

    it("migrates legacy V1 background-removal snapshots and drops invalid ones", async () => {
        mocks.listStoredGenerationTaskRecords.mockResolvedValueOnce({
            items: [
                { id: "legacy", userId: "user-one", type: "image_process", status: "running", payload: { options: { version: 1, outputMask: true } }, projectId: "canvas-one", surface: "canvas", createdAt: 1, updatedAt: 2, expiresAt: 3 },
                { id: "invalid", userId: "user-one", type: "image_process", status: "running", payload: { options: { version: 2, outputMask: true } }, projectId: "canvas-one", surface: "canvas", createdAt: 1, updatedAt: 2, expiresAt: 3 },
            ],
            total: 2,
        });

        const response = await GET(new Request("http://localhost/api/generation-tasks?projectId=canvas-one"));
        const tasks = (await response.json()).data.tasks;

        expect(tasks[0].options).toMatchObject({ version: 3, model: "u2net", outputMode: "mask" });
        expect(tasks[0].options).not.toHaveProperty("outputMask");
        expect(tasks[1].options).toBeUndefined();
    });

    it.each([
        ["success", "completed", 100, "\u5df2\u5b8c\u6210"],
        ["error", "failed", 75, "\u5931\u8d25"],
        ["cancelled", "cancelled", 50, "\u5df2\u53d6\u6d88"],
    ])("terminates background-removal progress for %s", async (status, progressStage, progress, stage) => {
        mocks.listStoredGenerationTaskRecords.mockResolvedValueOnce({
            items: [{ id: "cutout", userId: "user-one", type: "image_process", status, payload: { progressStage: "inference", progress }, projectId: "canvas-one", surface: "canvas", createdAt: 1_000, updatedAt: 2_000, expiresAt: 5_000 }],
            total: 1,
        });

        const response = await GET(new Request("http://localhost/api/generation-tasks?projectId=canvas-one&activeOnly=false"));

        expect((await response.json()).data.tasks[0]).toMatchObject({ progressStage, progress, stage });
    });
});
