import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/api/points", () => ({ refreshUserPointsIfSystem: vi.fn(async () => undefined), syncUserPointsFromHeaders: vi.fn() }));
vi.mock("@/services/image-storage", () => ({ imageToDataUrl: vi.fn() }));
vi.mock("@/stores/use-config-store", () => ({
    resolveModelRequestConfig: vi.fn((config: Record<string, unknown>, model: string) => ({ ...config, model, apiSource: "system" })),
}));

import { createImageGenerationTask, waitForImageGenerationTask } from "./image";

describe("image API cancellation", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("continues polling after cancellation is requested and only settles on the confirmed terminal state", async () => {
        vi.useFakeTimers();
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(json({ task: { id: "image-cancelled", status: "cancelled", executionPhase: "cancel_requested", message: "已提交取消，正在确认上游状态" } }))
            .mockResolvedValueOnce(json({ task: { id: "image-cancelled", status: "cancelled", executionPhase: "completed", message: "任务已取消" } }));
        vi.stubGlobal("fetch", fetchMock);

        const promise = waitForImageGenerationTask({ apiSource: "custom" } as never, { id: "image-cancelled", kind: "generation", model: "image-v1" });
        const rejection = expect(promise).rejects.toThrow();
        await vi.advanceTimersByTimeAsync(1800);
        await rejection;
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("submits only selected Skill ids from the browser", async () => {
        const fetchMock = vi.fn().mockResolvedValue(json({ task: { id: "image-task", kind: "generation", model: "image-v1" } }));
        vi.stubGlobal("fetch", fetchMock);

        await createImageGenerationTask({ imageModel: "image-v1", quality: "auto", size: "1:1" } as never, "A glass bottle", [], undefined, { skillIds: ["product-photo"] });

        const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as { skillIds?: string[]; prompt: string };
        expect(body).toMatchObject({ prompt: "A glass bottle", skillIds: ["product-photo"] });
        expect(JSON.stringify(body)).not.toContain("Instructions:");
    });

    it("binds Design image tasks to the project and idempotent client request", async () => {
        const fetchMock = vi.fn().mockResolvedValue(json({ task: { id: "design-image-task", kind: "generation", model: "image-v1" } }));
        vi.stubGlobal("fetch", fetchMock);

        await createImageGenerationTask({ imageModel: "image-v1", quality: "auto", size: "1:1" } as never, "A layout study", [], undefined, {
            surface: "design",
            projectId: "design-one",
            clientRequestId: "design-one-request-one",
            binding: { surface: "design", projectId: "design-one", target: { scope: "frame", frameId: "frame-one" }, elementId: "element-one" },
        });

        const request = fetchMock.mock.calls[0][1] as RequestInit;
        const body = JSON.parse(String(request.body)) as { context?: Record<string, unknown> };
        expect(request.headers).toMatchObject({ "X-DQ-Client-Request-Id": "design-one-request-one" });
        expect(body.context).toMatchObject({
            surface: "design",
            projectId: "design-one",
            clientRequestId: "design-one-request-one",
            binding: { surface: "design", projectId: "design-one", target: { scope: "frame", frameId: "frame-one" }, elementId: "element-one" },
        });
    });
});

function json(value: unknown) {
    return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}
