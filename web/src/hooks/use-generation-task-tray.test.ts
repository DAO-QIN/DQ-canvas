import { describe, expect, it } from "vitest";

import type { CreativeWorkspaceGenerationTask } from "@/services/api/generation-tasks";

import { activeGenerationTasks, taskRefetchInterval } from "./use-generation-task-tray";

describe("generation task tray query policy", () => {
    it("keeps only recoverable active statuses in the visible tray", () => {
        const tasks = [task("queued"), task("running"), task("paused"), task("succeeded"), task("failed"), task("cancelled")];
        expect(activeGenerationTasks(tasks).map((item) => item.status)).toEqual(["queued", "running", "paused"]);
    });

    it("polls persisted image processing milestones faster", () => {
        expect(taskRefetchInterval([{ ...task("running"), type: "image_process" }])).toBe(1_000);
        expect(taskRefetchInterval([task("running")])).toBe(2_000);
        expect(taskRefetchInterval([task("succeeded")])).toBe(4_000);
    });
});

function task(status: CreativeWorkspaceGenerationTask["status"]): CreativeWorkspaceGenerationTask {
    return { id: `task-${status}`, type: "image", status, createdAt: 1, updatedAt: 2 };
}
