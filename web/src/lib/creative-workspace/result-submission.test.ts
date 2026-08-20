import { describe, expect, it, vi } from "vitest";

import { createResultSubmissionCoordinator, ResultSubmissionContractError, type ResultSubmissionReceipt, type ResultSubmissionRequest } from "./result-submission";

const request: ResultSubmissionRequest = {
    taskId: "task-one",
    receiptId: "receipt-one",
    batchId: "batch-one",
    fingerprint: "sha256:one",
    binding: { surface: "canvas", projectId: "project-one", sourceNodeId: "source-one", targetNodeId: "target-one" },
};

describe("result submission coordinator", () => {
    it("coalesces concurrent identical submissions while leaving persistent replay to the adapter", async () => {
        let release!: (receipt: ResultSubmissionReceipt) => void;
        const pending = new Promise<ResultSubmissionReceipt>((resolve) => {
            release = resolve;
        });
        const adapter = vi.fn(() => pending);
        const coordinator = createResultSubmissionCoordinator();

        const first = coordinator.submit(request, adapter);
        const second = coordinator.submit({ ...request }, adapter);
        await Promise.resolve();
        expect(adapter).toHaveBeenCalledTimes(1);

        release(receipt(request, "applied", ["target-one"]));
        await expect(Promise.all([first, second])).resolves.toEqual([expect.objectContaining({ status: "applied" }), expect.objectContaining({ status: "applied" })]);

        adapter.mockResolvedValueOnce(receipt(request, "replayed", ["target-one"]));
        await expect(coordinator.submit(request, adapter)).resolves.toMatchObject({ status: "replayed" });
        expect(adapter).toHaveBeenCalledTimes(2);
    });

    it("returns a conflict without invoking a second adapter for an in-flight identity with different content", async () => {
        let release!: (receipt: ResultSubmissionReceipt) => void;
        const adapter = vi.fn(
            () =>
                new Promise<ResultSubmissionReceipt>((resolve) => {
                    release = resolve;
                }),
        );
        const coordinator = createResultSubmissionCoordinator();
        const first = coordinator.submit(request, adapter);
        const conflicting = await coordinator.submit({ ...request, fingerprint: "sha256:different" }, adapter);

        expect(conflicting).toMatchObject({ status: "conflict", error: { code: "SUBMISSION_IDENTITY_CONFLICT", retryable: false } });
        expect(adapter).toHaveBeenCalledTimes(1);
        release(receipt(request, "applied", ["target-one"]));
        await first;
    });

    it("rejects an adapter receipt that changes binding or stable identity", async () => {
        const coordinator = createResultSubmissionCoordinator();
        const adapter = vi.fn(async () => receipt({ ...request, batchId: "other-batch" }, "applied", ["target-one"]));

        await expect(coordinator.submit(request, adapter)).rejects.toThrowError(new ResultSubmissionContractError("领域适配器返回了不匹配的提交回执"));
    });

    it("requires explicit errors for rejected and conflict receipts", async () => {
        const coordinator = createResultSubmissionCoordinator();
        const adapter = vi.fn(async () => ({ ...request, status: "rejected" as const, affectedIds: [] }));

        await expect(coordinator.submit(request, adapter)).rejects.toThrow("rejected 回执必须包含错误");
    });
});

function receipt(input: ResultSubmissionRequest, status: ResultSubmissionReceipt["status"], affectedIds: string[]): ResultSubmissionReceipt {
    return { ...input, status, affectedIds };
}
