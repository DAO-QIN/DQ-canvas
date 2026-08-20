import { describe, expect, it } from "vitest";
import { workspaceActionRequiresConfirmation } from "@/lib/creative-workspace";
import { buildAgentWorkspaceActionRequest } from "./agent-workspace-actions";

const canvasSnapshot = {
    schemaVersion: 1 as const,
    surface: "canvas" as const,
    projectId: "canvas-one",
    title: "画布",
    revision: 7,
    selectionIds: ["node-one"],
    entities: [
        { id: "node-one", kind: "image", name: "主图", bounds: { x: 0, y: 0, width: 100, height: 100 }, resource: { kind: "storage-key" as const, storageKey: "permanent/main.webp" } },
        { id: "node-locked", kind: "text", name: "锁定标题", locked: true, bounds: { x: 120, y: 0, width: 100, height: 40 }, text: "标题" },
    ],
    relations: [{ id: "edge-one", fromId: "node-one", toId: "node-locked", kind: "connection" }],
    truncated: false,
};

describe("buildAgentWorkspaceActionRequest", () => {
    it("fixes identity, risk and stable ids on the server", () => {
        const input = {
            runId: "run-one",
            surface: "canvas" as const,
            projectId: "canvas-one",
            snapshot: canvasSnapshot,
            proposals: [{ command: "content.update", label: "移动主图", targetIds: ["node-one"], parameters: { position: { x: 80, y: 120 } } }],
        };
        const first = buildAgentWorkspaceActionRequest(input);
        const second = buildAgentWorkspaceActionRequest(input);

        expect(first).toEqual(second);
        expect(first).toMatchObject({ surface: "canvas", projectId: "canvas-one", baseRevision: 7, batchId: expect.stringMatching(/^agent-workspace-/) });
        expect(first.actions[0]).toMatchObject({ actionId: expect.stringMatching(/^agent-action-/), kind: "update", effect: "write", command: "content.update", targetIds: ["node-one"] });
        expect(workspaceActionRequiresConfirmation(first)).toBe(true);
    });

    it("uses the current selection for selection reads without trusting model ids", () => {
        const request = buildAgentWorkspaceActionRequest({ runId: "run-read", surface: "canvas", projectId: "canvas-one", snapshot: canvasSnapshot, proposals: [{ command: "selection.read", label: "读取选择", targetIds: [], parameters: {} }] });
        expect(request.actions[0]).toMatchObject({ kind: "inspect", effect: "read", targetIds: ["node-one"] });
        expect(workspaceActionRequiresConfirmation(request)).toBe(false);
    });

    it("generates creation ids and rejects model-controlled ids", () => {
        const request = buildAgentWorkspaceActionRequest({
            runId: "run-create",
            surface: "canvas",
            projectId: "canvas-one",
            snapshot: canvasSnapshot,
            proposals: [{ command: "content.create", label: "创建文字", targetIds: [], parameters: { nodeType: "text", text: "新品发布" } }],
        });
        expect(request.actions[0].targetIds).toEqual([expect.stringMatching(/^agent-entity-/)]);
        expect(() =>
            buildAgentWorkspaceActionRequest({
                runId: "run-create",
                surface: "canvas",
                projectId: "canvas-one",
                snapshot: canvasSnapshot,
                proposals: [{ command: "content.create", label: "创建文字", targetIds: ["model-picked-id"], parameters: { nodeType: "text" } }],
            }),
        ).toThrow("必须由服务端生成");
    });

    it("fails closed for identity, unsupported commands, missing and locked targets", () => {
        expect(() => buildAgentWorkspaceActionRequest({ runId: "run", surface: "design", projectId: "canvas-one", snapshot: canvasSnapshot, proposals: [{ command: "workspace.read", label: "读取", targetIds: [], parameters: {} }] })).toThrow("身份不匹配");
        expect(() => buildAgentWorkspaceActionRequest({ runId: "run", surface: "canvas", projectId: "canvas-one", snapshot: canvasSnapshot, proposals: [{ command: "content.align", label: "对齐", targetIds: ["node-one"], parameters: {} }] })).toThrow(
            "不支持工作台命令",
        );
        expect(() =>
            buildAgentWorkspaceActionRequest({ runId: "run", surface: "canvas", projectId: "canvas-one", snapshot: canvasSnapshot, proposals: [{ command: "content.update", label: "修改", targetIds: ["missing"], parameters: { text: "x" } }] }),
        ).toThrow("不存在的实体");
        expect(() => buildAgentWorkspaceActionRequest({ runId: "run", surface: "canvas", projectId: "canvas-one", snapshot: canvasSnapshot, proposals: [{ command: "content.delete", label: "删除", targetIds: ["node-locked"], parameters: {} }] })).toThrow(
            "已锁定实体",
        );
    });

    it("rejects temporary resources and validates relation endpoints", () => {
        expect(() =>
            buildAgentWorkspaceActionRequest({
                runId: "run-resource",
                surface: "design",
                projectId: "design-one",
                snapshot: { ...canvasSnapshot, surface: "design", projectId: "design-one", relations: [] },
                proposals: [{ command: "asset.insert-image", label: "插入图片", targetIds: [], parameters: { resource: { kind: "storage-key", storageKey: "https://temporary.example/image.png" } } }],
            }),
        ).toThrow("稳定存储键");
        expect(() =>
            buildAgentWorkspaceActionRequest({
                runId: "run-relation",
                surface: "canvas",
                projectId: "canvas-one",
                snapshot: canvasSnapshot,
                proposals: [{ command: "relation.create", label: "连接节点", targetIds: [], parameters: { fromId: "node-one", toId: "missing" } }],
            }),
        ).toThrow("toId 必须引用现有实体");
    });
});
