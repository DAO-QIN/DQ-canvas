import { describe, expect, it } from "vitest";

import {
    MAX_WORKSPACE_SNAPSHOT_BYTES,
    WorkspaceAgentContractError,
    assertWorkspaceActionAuthorized,
    confirmWorkspaceActionRequest,
    defineWorkspaceActionReceipt,
    defineWorkspaceActionRequest,
    defineWorkspaceSnapshot,
    workspaceActionRequestFingerprint,
    workspaceActionRequiresConfirmation,
    workspaceConfirmationRequiredReceipt,
    type WorkspaceActionRequest,
    type WorkspaceSnapshot,
} from "./agent-contract";

const snapshot: WorkspaceSnapshot = {
    schemaVersion: 1,
    surface: "canvas",
    projectId: "project-one",
    title: "商品图画布",
    revision: 3,
    selectionIds: ["node-one"],
    entities: [
        {
            id: "node-one",
            kind: "image",
            name: "商品图",
            bounds: { x: 20, y: 30, width: 640, height: 640 },
            resource: { kind: "storage-key", storageKey: "permanent/product.png" },
        },
    ],
    relations: [],
    truncated: false,
};

const readRequest: WorkspaceActionRequest = {
    surface: "canvas",
    projectId: "project-one",
    baseRevision: 3,
    batchId: "agent-read-one",
    actions: [{ actionId: "read-selection", kind: "inspect", effect: "read", command: "selection.read", label: "读取当前选区", targetIds: [], parameters: {} }],
};

const writeRequest: WorkspaceActionRequest = {
    surface: "canvas",
    projectId: "project-one",
    baseRevision: 3,
    batchId: "agent-write-one",
    actions: [{ actionId: "move-node", kind: "update", effect: "write", command: "content.update", label: "移动商品图", targetIds: ["node-one"], parameters: { position: { x: 120, y: 160 } } }],
};

describe("workspace Agent contract", () => {
    it("normalizes and freezes a bounded snapshot with stable resource locators", () => {
        const normalized = defineWorkspaceSnapshot(snapshot);

        expect(normalized).toEqual(snapshot);
        expect(Object.isFrozen(normalized)).toBe(true);
        expect(Object.isFrozen(normalized.entities)).toBe(true);
        expect(new TextEncoder().encode(JSON.stringify(normalized)).length).toBeLessThan(MAX_WORKSPACE_SNAPSHOT_BYTES);
    });

    it.each([
        [{ ...snapshot, entities: [{ ...snapshot.entities[0], text: "data:image/png;base64,secret" }] }, "临时/敏感数据"],
        [{ ...snapshot, entities: [{ ...snapshot.entities[0], resource: { kind: "storage-key", storageKey: "blob:preview" } }] }, "稳定存储键"],
        [{ ...snapshot, entities: [...snapshot.entities, snapshot.entities[0]] }, "entity id 重复"],
        [{ ...snapshot, relations: [{ id: "missing", fromId: "node-one", toId: "node-missing", kind: "edge" }] }, "不存在的实体"],
    ])("rejects unsafe or unstable snapshot input", (value, message) => {
        expect(() => defineWorkspaceSnapshot(value as WorkspaceSnapshot)).toThrow(message);
    });

    it("rejects snapshots beyond the byte limit even when entity count is valid", () => {
        const entities = Array.from({ length: 140 }, (_, index) => ({ id: `node-${index}`, kind: "text", name: `节点 ${index}`, text: "x".repeat(2_000) }));

        expect(() => defineWorkspaceSnapshot({ ...snapshot, selectionIds: [], entities, truncated: true })).toThrow("256 KiB");
    });

    it("executes read requests without confirmation and binds write confirmation to the exact fingerprint", () => {
        const read = defineWorkspaceActionRequest(readRequest);
        expect(workspaceActionRequiresConfirmation(read)).toBe(false);
        expect(assertWorkspaceActionAuthorized(read)).toEqual(read);

        const pending = defineWorkspaceActionRequest(writeRequest);
        expect(workspaceActionRequiresConfirmation(pending)).toBe(true);
        expect(() => assertWorkspaceActionAuthorized(pending)).toThrow("显式确认");

        const confirmed = confirmWorkspaceActionRequest(pending, "2026-08-13T12:00:00.000Z");
        expect(confirmed.confirmation).toEqual({ batchId: pending.batchId, fingerprint: workspaceActionRequestFingerprint(pending), confirmedAt: "2026-08-13T12:00:00.000Z" });
        expect(assertWorkspaceActionAuthorized(confirmed)).toEqual(confirmed);
        expect(() => defineWorkspaceActionRequest({ ...confirmed, actions: [{ ...confirmed.actions[0], label: "另一项操作" }] })).toThrow("确认信息与当前批次不匹配");
    });

    it("returns a structured confirmation-required receipt without applying writes", () => {
        const receipt = workspaceConfirmationRequiredReceipt(writeRequest);

        expect(receipt).toMatchObject({ status: "confirmation-required", baseRevision: 3, resultRevision: 3, affectedIds: [], error: { code: "CONFIRMATION_REQUIRED", retryable: true } });
        expect(receipt.results).toEqual([expect.objectContaining({ actionId: "move-node", status: "skipped", affectedIds: [] })]);
    });

    it("rejects sensitive parameters and mismatched adapter receipts", () => {
        expect(() =>
            defineWorkspaceActionRequest({
                ...writeRequest,
                actions: [{ ...writeRequest.actions[0], parameters: { api_key: "do-not-persist" } }],
            }),
        ).toThrow(WorkspaceAgentContractError);

        const request = confirmWorkspaceActionRequest(writeRequest, "2026-08-13T12:00:00.000Z");
        expect(() =>
            defineWorkspaceActionReceipt(request, {
                surface: "design",
                projectId: request.projectId,
                batchId: request.batchId,
                fingerprint: workspaceActionRequestFingerprint(request),
                status: "applied",
                baseRevision: request.baseRevision,
                resultRevision: 4,
                affectedIds: ["node-one"],
                results: [{ actionId: "move-node", status: "applied", affectedIds: ["node-one"] }],
            }),
        ).toThrow("不匹配");
    });

    it("requires one unique result per action and coherent applied receipts", () => {
        const request = confirmWorkspaceActionRequest(
            { ...writeRequest, actions: [...writeRequest.actions, { actionId: "delete-node", kind: "delete", effect: "write", command: "content.delete", label: "删除节点", targetIds: ["node-one"], parameters: {} }] },
            "2026-08-13T12:00:00.000Z",
        );
        const base = {
            surface: request.surface,
            projectId: request.projectId,
            batchId: request.batchId,
            fingerprint: workspaceActionRequestFingerprint(request),
            status: "applied" as const,
            baseRevision: request.baseRevision,
            resultRevision: 4,
            affectedIds: ["node-one"],
        };
        expect(() =>
            defineWorkspaceActionReceipt(request, {
                ...base,
                results: [
                    { actionId: "move-node", status: "applied", affectedIds: ["node-one"] },
                    { actionId: "move-node", status: "applied", affectedIds: ["node-one"] },
                ],
            }),
        ).toThrow("唯一对应");
        expect(() =>
            defineWorkspaceActionReceipt(request, {
                ...base,
                results: [
                    { actionId: "move-node", status: "applied", affectedIds: ["node-one"] },
                    { actionId: "delete-node", status: "rejected", affectedIds: [], error: { code: "LOCKED", message: "已锁定" } },
                ],
            }),
        ).toThrow("不能包含未执行动作");
    });
});
