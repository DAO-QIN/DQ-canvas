import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    currentUser: vi.fn(),
    readJsonBody: vi.fn(),
    getCanvasProjectForUser: vi.fn(),
    getDesignProjectForUser: vi.fn(),
    validateWorkspaceMediaResourceForUser: vi.fn(),
    getStoredGenerationTaskByRequest: vi.fn(),
    getActiveStoredGenerationTaskBySourceNode: vi.fn(),
    getLatestStoredGenerationTaskBySourceNode: vi.fn(),
    getActiveStoredGenerationTaskBySourceIdentity: vi.fn(),
    getLatestStoredGenerationTaskBySourceIdentity: vi.fn(),
    isBackgroundRemovalProviderEnabled: vi.fn(),
    readRegisteredImageBytes: vi.fn(),
    checkGenerationRateLimit: vi.fn(),
    rateLimitHeaders: vi.fn(),
    createBackgroundRemovalTaskWithResult: vi.fn(),
    publicBackgroundRemovalTask: vi.fn((task: unknown) => task),
}));

vi.mock("@/lib/auth/request", () => ({ readJsonBody: mocks.readJsonBody }));
vi.mock("@/lib/auth/store", () => ({ isAuthInputError: vi.fn(() => false) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/server/canvas-project-service", () => ({ getCanvasProjectForUser: mocks.getCanvasProjectForUser }));
vi.mock("@/lib/server/design-project-service", () => ({ getDesignProjectForUser: mocks.getDesignProjectForUser }));
vi.mock("@/lib/server/workspace-resource-resolver", () => ({ validateWorkspaceMediaResourceForUser: mocks.validateWorkspaceMediaResourceForUser }));
vi.mock("@/lib/server/background-removal-task-store", () => ({
    createBackgroundRemovalTaskWithResult: mocks.createBackgroundRemovalTaskWithResult,
    publicBackgroundRemovalTask: mocks.publicBackgroundRemovalTask,
}));
vi.mock("@/lib/server/generation-task-store", () => ({
    getLatestStoredGenerationTaskBySourceNode: mocks.getLatestStoredGenerationTaskBySourceNode,
    getActiveStoredGenerationTaskBySourceNode: mocks.getActiveStoredGenerationTaskBySourceNode,
    getLatestStoredGenerationTaskBySourceIdentity: mocks.getLatestStoredGenerationTaskBySourceIdentity,
    getActiveStoredGenerationTaskBySourceIdentity: mocks.getActiveStoredGenerationTaskBySourceIdentity,
    getStoredGenerationTaskByRequest: mocks.getStoredGenerationTaskByRequest,
}));
vi.mock("@/lib/server/background-removal-provider", () => ({ isBackgroundRemovalProviderEnabled: mocks.isBackgroundRemovalProviderEnabled }));
vi.mock("@/lib/server/registered-media-reader", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/server/registered-media-reader")>();
    return { ...actual, readRegisteredImageBytes: mocks.readRegisteredImageBytes };
});
vi.mock("@/lib/server/security", () => ({ checkGenerationRateLimit: mocks.checkGenerationRateLimit, rateLimitHeaders: mocks.rateLimitHeaders }));

import { RegisteredMediaReadError } from "@/lib/server/registered-media-reader";
import { POST } from "./route";

const DEFAULT_OPTIONS_HASH = "f2a20225a31ad391b22a91009b361c8e4ffdb396218691ca9ca4f69865162309";
const HAIR_OPTIONS_HASH = "6b66bd1c6a97c2edf2ecb037a983af71de49995a06f406976fb689d20ea74982";

describe("POST /api/background-removal-tasks", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.currentUser.mockResolvedValue({ id: "user-one", role: "user" });
        mocks.readJsonBody.mockResolvedValue(requestBody());
        mocks.getCanvasProjectForUser.mockResolvedValue(project());
        mocks.getDesignProjectForUser.mockResolvedValue(designProject());
        mocks.validateWorkspaceMediaResourceForUser.mockResolvedValue({ storageKey: "permanent/source.png", mediaType: "image", mimeType: "image/png" });
        mocks.getStoredGenerationTaskByRequest.mockResolvedValue(null);
        mocks.getActiveStoredGenerationTaskBySourceNode.mockResolvedValue(null);
        mocks.getLatestStoredGenerationTaskBySourceNode.mockResolvedValue(null);
        mocks.getActiveStoredGenerationTaskBySourceIdentity.mockResolvedValue(null);
        mocks.getLatestStoredGenerationTaskBySourceIdentity.mockResolvedValue(null);
        mocks.isBackgroundRemovalProviderEnabled.mockReturnValue(true);
        mocks.readRegisteredImageBytes.mockResolvedValue(source());
        mocks.checkGenerationRateLimit.mockResolvedValue({ allowed: true, remaining: 29, resetAt: Date.now() + 60_000 });
        mocks.rateLimitHeaders.mockReturnValue({ "Retry-After": "60" });
        mocks.createBackgroundRemovalTaskWithResult.mockResolvedValue({ task: task(), created: true });
    });

    it("requires an authenticated user before reading the request", async () => {
        mocks.currentUser.mockResolvedValue(null);

        const response = await POST(request());

        expect(response.status).toBe(401);
        expect(mocks.readJsonBody).not.toHaveBeenCalled();
        expect(mocks.createBackgroundRemovalTaskWithResult).not.toHaveBeenCalled();
    });

    it("requires a canvas project and source node for source-node idempotency", async () => {
        mocks.readJsonBody.mockResolvedValue({ sourceStorageKey: "permanent/source.png", context: {} });

        const response = await POST(request({ context: {} }));

        expect(response.status).toBe(400);
        expect(mocks.getCanvasProjectForUser).not.toHaveBeenCalled();
        expect(mocks.checkGenerationRateLimit).not.toHaveBeenCalled();
        expect(mocks.createBackgroundRemovalTaskWithResult).not.toHaveBeenCalled();
    });

    it.each([null, []])("rejects a non-object JSON body (%s)", async (body) => {
        mocks.readJsonBody.mockResolvedValue(body as never);

        const response = await POST(request());

        expect(response.status).toBe(400);
        expect(mocks.getCanvasProjectForUser).not.toHaveBeenCalled();
        expect(mocks.createBackgroundRemovalTaskWithResult).not.toHaveBeenCalled();
    });

    it("rejects invalid custom parameters before reading the source image", async () => {
        mocks.readJsonBody.mockResolvedValue({ ...requestBody(), options: { version: 1, foregroundThreshold: 10, backgroundThreshold: 10 } });

        const response = await POST(request());

        expect(response.status).toBe(400);
        expect(mocks.readRegisteredImageBytes).not.toHaveBeenCalled();
        expect(mocks.createBackgroundRemovalTaskWithResult).not.toHaveBeenCalled();
    });

    it("rejects a source node whose storage key is not owned by the canvas", async () => {
        mocks.getCanvasProjectForUser.mockResolvedValue(project({ nodes: [{ id: "node-one", metadata: { storageKey: "permanent/other.png" } }] }));

        const response = await POST(request());

        expect(response.status).toBe(404);
        expect(mocks.getStoredGenerationTaskByRequest).not.toHaveBeenCalled();
        expect(mocks.checkGenerationRateLimit).not.toHaveBeenCalled();
        expect(mocks.readRegisteredImageBytes).not.toHaveBeenCalled();
        expect(mocks.createBackgroundRemovalTaskWithResult).not.toHaveBeenCalled();
    });

    it("hides a missing or foreign media registration", async () => {
        mocks.readRegisteredImageBytes.mockRejectedValue(new RegisteredMediaReadError("missing image", 404, "missing"));

        const response = await POST(request());

        expect(response.status).toBe(404);
        expect(mocks.createBackgroundRemovalTaskWithResult).not.toHaveBeenCalled();
    });

    it("returns an idempotent task before applying the per-user rate limit", async () => {
        const existing = task({ id: "existing-task", status: "running" });
        mocks.getStoredGenerationTaskByRequest.mockResolvedValue(existing);
        mocks.checkGenerationRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 });

        const response = await POST(request({ context: { clientRequestId: "same-request", projectId: "project-one", sourceNodeId: "node-one" } }));

        expect(response.status).toBe(200);
        expect((await response.json()).data.task).toMatchObject({ id: "existing-task", status: "running" });
        expect(mocks.checkGenerationRateLimit).not.toHaveBeenCalled();
        expect(mocks.createBackgroundRemovalTaskWithResult).not.toHaveBeenCalled();
    });

    it("does not reuse a request id belonging to another canvas project", async () => {
        mocks.getStoredGenerationTaskByRequest.mockResolvedValue(task({ id: "other-project-task", projectId: "project-two" }));

        const response = await POST(request());

        expect(response.status).toBe(200);
        expect(mocks.createBackgroundRemovalTaskWithResult).toHaveBeenCalledWith(expect.objectContaining({ clientRequestId: expect.stringContaining(`:options:${DEFAULT_OPTIONS_HASH}:`), projectId: "project-one", sourceNodeId: "node-one" }));
        expect((await response.json()).data.task).toMatchObject({ id: "task-one" });
    });

    it("starts a fresh request after a terminal failure instead of replaying the old error", async () => {
        const existing = task({ id: "failed-task", status: "error", error: "provider unavailable" });
        mocks.getStoredGenerationTaskByRequest.mockResolvedValue(existing);

        const response = await POST(request());

        expect(response.status).toBe(200);
        expect(mocks.checkGenerationRateLimit).toHaveBeenCalled();
        expect(mocks.createBackgroundRemovalTaskWithResult).toHaveBeenCalledWith(
            expect.objectContaining({
                sourceStorageKey: "permanent/source.png",
                clientRequestId: expect.stringContaining(`:options:${DEFAULT_OPTIONS_HASH}:`),
            }),
        );
        expect((await response.json()).data.task).toMatchObject({ id: "task-one" });
    });

    it("reuses a successful result found through the source node before rate limiting", async () => {
        mocks.getStoredGenerationTaskByRequest.mockResolvedValue(task({ id: "failed-task", status: "error" }));
        mocks.getLatestStoredGenerationTaskBySourceNode.mockResolvedValue(task({ id: "success-task", status: "success", result: { storageKey: "permanent/result.png" } }));
        mocks.checkGenerationRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 });

        const response = await POST(request());

        expect(response.status).toBe(200);
        expect((await response.json()).data.task).toMatchObject({ id: "success-task", status: "success" });
        expect(mocks.checkGenerationRateLimit).not.toHaveBeenCalled();
        expect(mocks.createBackgroundRemovalTaskWithResult).not.toHaveBeenCalled();
    });

    it("does not reuse a successful result when the source node now points to another image", async () => {
        const previous = task({ id: "previous-success", status: "success", result: { storageKey: "permanent/old-result.png" } });
        mocks.getStoredGenerationTaskByRequest.mockResolvedValue(previous);
        mocks.getLatestStoredGenerationTaskBySourceNode.mockResolvedValue(previous);
        mocks.getCanvasProjectForUser.mockResolvedValue(project({ nodes: [{ id: "node-one", metadata: { storageKey: "permanent/new.png" } }] }));
        mocks.readJsonBody.mockResolvedValue({ sourceStorageKey: "permanent/new.png", context: { projectId: "project-one", sourceNodeId: "node-one", clientRequestId: "request-one" } });

        const response = await POST(request({ sourceStorageKey: "permanent/new.png" }));

        expect(response.status).toBe(200);
        expect(mocks.createBackgroundRemovalTaskWithResult).toHaveBeenCalledWith(
            expect.objectContaining({
                sourceStorageKey: "permanent/new.png",
                clientRequestId: expect.stringContaining(`:options:${DEFAULT_OPTIONS_HASH}:`),
            }),
        );
    });

    it("reuses the active task for a source node even with a new request id", async () => {
        const active = task({ id: "active-task", status: "pending" });
        mocks.getActiveStoredGenerationTaskBySourceNode.mockResolvedValue(active);

        const response = await POST(request({ context: { clientRequestId: "new-request", projectId: "project-one", sourceNodeId: "node-one" } }));

        expect(response.status).toBe(200);
        expect((await response.json()).data.task).toMatchObject({ id: "active-task", sourceNodeId: "node-one" });
        expect(mocks.getActiveStoredGenerationTaskBySourceNode).toHaveBeenCalledWith("image_process", "user-one", "node-one", "project-one");
        expect(mocks.checkGenerationRateLimit).not.toHaveBeenCalled();
        expect(mocks.createBackgroundRemovalTaskWithResult).not.toHaveBeenCalled();
    });

    it("keeps the source node mutually exclusive when active parameters differ", async () => {
        mocks.getActiveStoredGenerationTaskBySourceNode.mockResolvedValue(task({ id: "active-task", status: "running" }));
        mocks.readJsonBody.mockResolvedValue({ ...requestBody(), options: { version: 1, preset: "hair" } });

        const response = await POST(request());

        expect(response.status).toBe(409);
        expect(mocks.createBackgroundRemovalTaskWithResult).not.toHaveBeenCalled();
    });

    it("does not reuse a successful source-node result when parameters differ", async () => {
        mocks.getLatestStoredGenerationTaskBySourceNode.mockResolvedValue(task({ id: "old-success", status: "success" }));
        mocks.readJsonBody.mockResolvedValue({ ...requestBody(), options: { version: 1, preset: "hair" } });
        mocks.readRegisteredImageBytes.mockResolvedValue({ ...source(), width: 2_000, height: 2_000 });

        const response = await POST(request());

        expect(response.status).toBe(200);
        expect(mocks.createBackgroundRemovalTaskWithResult).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ preset: "hair", alphaMatting: true }), optionsHash: HAIR_OPTIONS_HASH }));
    });

    it("uses a stable request id for an A/B/A parameter sequence", async () => {
        const createdRequestIds: string[] = [];
        mocks.readRegisteredImageBytes.mockResolvedValue({ ...source(), width: 2_000, height: 2_000 });
        mocks.createBackgroundRemovalTaskWithResult.mockImplementation(async (input: Record<string, unknown>) => {
            createdRequestIds.push(String(input.clientRequestId));
            return { task: task({ ...input, id: `task-${createdRequestIds.length}` }), created: true };
        });

        mocks.readJsonBody.mockResolvedValue(requestBody());
        await POST(request());
        mocks.readJsonBody.mockResolvedValue({ ...requestBody(), options: { version: 1, preset: "hair" } });
        await POST(request());
        mocks.readJsonBody.mockResolvedValue(requestBody());
        await POST(request());

        expect(createdRequestIds[0]).toBe(createdRequestIds[2]);
        expect(createdRequestIds[0]).toContain(`:options:${DEFAULT_OPTIONS_HASH}:`);
        expect(createdRequestIds[1]).toContain(`:options:${HAIR_OPTIONS_HASH}:`);
        expect(createdRequestIds[1]).not.toBe(createdRequestIds[0]);
    });

    it("allows alpha matting at the 400000000 pixel limit", async () => {
        mocks.readJsonBody.mockResolvedValue({ ...requestBody(), options: { version: 1, preset: "hair" } });
        mocks.readRegisteredImageBytes.mockResolvedValue({ ...source(), width: 20_000, height: 20_000 });

        const response = await POST(request());

        expect(response.status).toBe(200);
        expect(mocks.createBackgroundRemovalTaskWithResult).toHaveBeenCalledOnce();
    });

    it("records the deployed silueta model by default", async () => {
        await POST(request());

        expect(mocks.createBackgroundRemovalTaskWithResult).toHaveBeenCalledWith(expect.objectContaining({ model: "silueta" }));
    });

    it("does not add an alpha-matting-only pixel limit above the registered source contract", async () => {
        mocks.readJsonBody.mockResolvedValue({ ...requestBody(), options: { version: 1, preset: "hair" } });
        mocks.readRegisteredImageBytes.mockResolvedValue({ ...source(), width: 20_001, height: 20_000 });

        const response = await POST(request());

        expect(response.status).toBe(200);
        expect(mocks.createBackgroundRemovalTaskWithResult).toHaveBeenCalledOnce();
    });

    it("rejects a changed source image while the node still has an active task", async () => {
        mocks.getActiveStoredGenerationTaskBySourceNode.mockResolvedValue(task({ id: "active-old", status: "running", sourceStorageKey: "permanent/old.png" }));

        const response = await POST(request());

        expect(response.status).toBe(409);
        expect(mocks.checkGenerationRateLimit).not.toHaveBeenCalled();
        expect(mocks.createBackgroundRemovalTaskWithResult).not.toHaveBeenCalled();
    });

    it("does not reschedule a task returned by an atomic source-node deduplication race", async () => {
        mocks.createBackgroundRemovalTaskWithResult.mockResolvedValue({ task: task({ id: "racing-task", status: "running" }), created: false });

        const response = await POST(request());

        expect(response.status).toBe(200);
        expect((await response.json()).data.task).toMatchObject({ id: "racing-task", status: "running" });
    });

    it("does not return a racing task for a different source image", async () => {
        mocks.createBackgroundRemovalTaskWithResult.mockResolvedValue({ task: task({ id: "racing-old", status: "running", sourceStorageKey: "permanent/old.png" }), created: false });

        const response = await POST(request());

        expect(response.status).toBe(409);
    });

    it("does not return a completed racing task for a different source image", async () => {
        mocks.createBackgroundRemovalTaskWithResult.mockResolvedValue({ task: task({ id: "racing-old-success", status: "success", sourceStorageKey: "permanent/old.png" }), created: false });

        const response = await POST(request());

        expect(response.status).toBe(409);
    });

    it("returns 429 without reading or creating a task when the user reaches 30 requests per minute", async () => {
        mocks.checkGenerationRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 });

        const response = await POST(request());

        expect(response.status).toBe(429);
        expect(response.headers.get("Retry-After")).toBe("60");
        expect(mocks.rateLimitHeaders).toHaveBeenCalled();
        expect(mocks.readRegisteredImageBytes).not.toHaveBeenCalled();
        expect(mocks.createBackgroundRemovalTaskWithResult).not.toHaveBeenCalled();
    });

    it("queues a new task instead of rejecting a user with another active task", async () => {
        const response = await POST(request());

        expect(response.status).toBe(200);
        expect(mocks.createBackgroundRemovalTaskWithResult).toHaveBeenCalledOnce();
    });

    it.each(["mask", "color"])("rejects new %s output requests", async (outputMode) => {
        mocks.readJsonBody.mockResolvedValue({ ...requestBody(), options: { version: 3, model: "silueta", outputMode } });

        const response = await POST(request());

        expect(response.status).toBe(400);
        expect(mocks.checkGenerationRateLimit).not.toHaveBeenCalled();
        expect(mocks.createBackgroundRemovalTaskWithResult).not.toHaveBeenCalled();
    });

    it.each([
        [415, "unsupported image MIME type"],
        [422, "malformed image bytes"],
        [413, "image larger than 30MB"],
        [413, "image larger than 400,000,000 pixels"],
    ])("maps the media reader limit (%s) for an %s", async (status) => {
        const code = status === 415 ? "unsupported" : status === 413 ? "too_large" : "invalid";
        mocks.readRegisteredImageBytes.mockRejectedValue(new RegisteredMediaReadError("invalid image", status as 415 | 413 | 422, code));

        const response = await POST(request());

        expect(response.status).toBe(status);
        expect(mocks.readRegisteredImageBytes).toHaveBeenCalledWith({ storageKey: "permanent/source.png", ownerUserId: "user-one" });
        expect(mocks.createBackgroundRemovalTaskWithResult).not.toHaveBeenCalled();
    });

    it("creates and schedules a task only after the owned image passes validation", async () => {
        const response = await POST(request());

        expect(response.status).toBe(200);
        expect(mocks.readRegisteredImageBytes).toHaveBeenCalledWith({ storageKey: "permanent/source.png", ownerUserId: "user-one" });
        expect(mocks.createBackgroundRemovalTaskWithResult).toHaveBeenCalledWith(
            expect.objectContaining({
                sourceStorageKey: "permanent/source.png",
                sourceNodeId: "node-one",
                sourceMimeType: "image/png",
                sourceBytes: 128,
                sourceWidth: 20_000,
                sourceHeight: 20_000,
                userId: "user-one",
                projectId: "project-one",
                clientRequestId: expect.stringContaining(`:options:${DEFAULT_OPTIONS_HASH}:`),
            }),
        );
        expect((await response.json()).data.task).toMatchObject({ id: "task-one" });
    });

    it("validates a Design element, version and locator before creating a bound task", async () => {
        const body = designRequestBody();
        mocks.readJsonBody.mockResolvedValue(body);

        const response = await POST(request(body));

        expect(response.status).toBe(200);
        expect(mocks.getCanvasProjectForUser).not.toHaveBeenCalled();
        expect(mocks.getDesignProjectForUser).toHaveBeenCalledWith("user-one", "design-one");
        expect(mocks.validateWorkspaceMediaResourceForUser).toHaveBeenCalledWith("user-one", { kind: "library-asset", libraryAssetId: "asset-library-one" }, ["image"]);
        expect(mocks.createBackgroundRemovalTaskWithResult).toHaveBeenCalledWith(
            expect.objectContaining({
                surface: "design",
                projectId: "design-one",
                sourceIdentity: "design-element:design-one:element-one:version-one",
                sourceElementId: "element-one",
                sourceAssetVersionId: "version-one",
                sourceLocator: { kind: "library-asset", libraryAssetId: "asset-library-one" },
                binding: {
                    surface: "design",
                    projectId: "design-one",
                    baseRevision: 4,
                    target: { scope: "frame", frameId: "frame-one" },
                    elementId: "element-one",
                    assetVersionId: "version-one",
                },
            }),
        );
        expect(mocks.getActiveStoredGenerationTaskBySourceIdentity).toHaveBeenCalledWith("image_process", "user-one", "design-element:design-one:element-one:version-one", "design-one");
        expect(mocks.getActiveStoredGenerationTaskBySourceNode).not.toHaveBeenCalled();
    });

    it("resolves the permanent source key from a Design library locator", async () => {
        const body = designRequestBody();
        delete (body as { sourceStorageKey?: string }).sourceStorageKey;
        mocks.readJsonBody.mockImplementationOnce((request: Request) => request.json());

        const response = await POST(
            new Request("http://localhost/api/background-removal-tasks", {
                method: "POST",
                headers: { "content-type": "application/json", cookie: "session=one" },
                body: JSON.stringify(body),
            }),
        );

        expect(response.status).toBe(200);
        expect(mocks.validateWorkspaceMediaResourceForUser).toHaveBeenCalledWith("user-one", { kind: "library-asset", libraryAssetId: "asset-library-one" }, ["image"]);
        expect(mocks.readRegisteredImageBytes).toHaveBeenCalledWith({ storageKey: "permanent/source.png", ownerUserId: "user-one" });
        expect(mocks.createBackgroundRemovalTaskWithResult).toHaveBeenCalledWith(expect.objectContaining({ sourceStorageKey: "permanent/source.png" }));
    });

    it("rejects a forged Design storage key before reading image bytes", async () => {
        const body = designRequestBody({ sourceStorageKey: "permanent/forged.png" });
        mocks.readJsonBody.mockResolvedValue(body);

        const response = await POST(request(body));

        expect(response.status).toBe(404);
        expect(mocks.readRegisteredImageBytes).not.toHaveBeenCalled();
        expect(mocks.createBackgroundRemovalTaskWithResult).not.toHaveBeenCalled();
    });

    it("rejects a stale Design asset version before resolving media", async () => {
        const body = designRequestBody({ context: { ...designRequestBody().context, sourceAssetVersionId: "version-old" } });
        mocks.readJsonBody.mockResolvedValue(body);

        const response = await POST(request(body));

        expect(response.status).toBe(404);
        expect(mocks.validateWorkspaceMediaResourceForUser).not.toHaveBeenCalled();
        expect(mocks.createBackgroundRemovalTaskWithResult).not.toHaveBeenCalled();
    });
});

function request(bodyPatch: Record<string, unknown> = {}) {
    return new Request("http://localhost/api/background-removal-tasks", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: "session=one" },
        body: JSON.stringify({ ...requestBody(), ...bodyPatch }),
    });
}

function requestBody() {
    return {
        sourceStorageKey: "permanent/source.png",
        context: { projectId: "project-one", sourceNodeId: "node-one", clientRequestId: "request-one" },
    };
}

function designRequestBody(patch: Record<string, unknown> = {}) {
    return {
        sourceStorageKey: "permanent/source.png",
        context: {
            surface: "design",
            projectId: "design-one",
            sourceElementId: "element-one",
            sourceAssetVersionId: "version-one",
            sourceLocator: { kind: "library-asset", libraryAssetId: "asset-library-one" },
            clientRequestId: "design-cutout-one",
        },
        ...patch,
    };
}

function project(patch: Record<string, unknown> = {}) {
    return {
        id: "project-one",
        nodes: [{ id: "node-one", metadata: { storageKey: "permanent/source.png" } }],
        ...patch,
    };
}

function designProject() {
    return {
        id: "design-one",
        revision: 4,
        document: {
            revision: 4,
            frames: [{ id: "frame-one" }],
            elements: [{ id: "element-one", kind: "image", frameId: "frame-one", assetVersionId: "version-one" }],
            assetVersions: [{ id: "version-one", locator: { kind: "library-asset", libraryAssetId: "asset-library-one" } }],
        },
    };
}

function source() {
    return {
        bytes: Buffer.alloc(128),
        mimeType: "image/png" as const,
        width: 20_000,
        height: 20_000,
        registration: { ownerUserId: "user-one", projectId: "project-one" },
    };
}

function task(patch: Record<string, unknown> = {}) {
    return {
        id: "task-one",
        operation: "remove-background",
        status: "pending",
        userId: "user-one",
        sourceStorageKey: "permanent/source.png",
        sourceNodeId: "node-one",
        sourceMimeType: "image/png",
        sourceBytes: 128,
        sourceWidth: 20_000,
        sourceHeight: 20_000,
        options: {
            version: 3,
            model: "silueta",
            preset: "standard",
            alphaMatting: false,
            foregroundThreshold: 240,
            backgroundThreshold: 10,
            refineRange: 10,
            cleanMask: false,
            outputMode: "transparent",
            backgroundColor: [255, 255, 255, 255],
        },
        optionsHash: DEFAULT_OPTIONS_HASH,
        projectId: "project-one",
        clientRequestId: "request-one",
        ...patch,
    };
}
