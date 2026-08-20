import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/api/points", () => ({ refreshUserPointsIfSystem: vi.fn(), syncUserPointsFromHeaders: vi.fn() }));
vi.mock("@/stores/use-config-store", () => ({
    resolveModelRequestConfig: vi.fn((config: Record<string, unknown>, model: string) => ({ ...config, model, apiSource: "system" })),
}));

import type { AiConfig } from "@/stores/use-config-store";
import { createTextGenerationTask, waitForTextGenerationTask } from "./text";

describe("文本任务轮询", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("stops polling when the upstream submission needs manual review", async () => {
        const fetchMock = vi.fn(async () => Response.json({ task: { id: "text-review", status: "running", model: "text-model", needsReview: true } }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(waitForTextGenerationTask({ apiSource: "system" } as AiConfig, { id: "text-review", status: "running", model: "text-model" })).rejects.toThrow("上游创建状态待确认");
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("submits only selected Skill ids from the browser", async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ task: { id: "text-task", model: "text-model" } }));
        vi.stubGlobal("fetch", fetchMock);

        await createTextGenerationTask({ textModel: "text-model" } as AiConfig, [{ role: "user", content: "Write a caption" }], { skillIds: ["caption-skill"] });

        const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as { skillIds?: string[]; messages: unknown[] };
        expect(body.skillIds).toEqual(["caption-skill"]);
        expect(JSON.stringify(body)).not.toContain("Instructions:");
    });
});
