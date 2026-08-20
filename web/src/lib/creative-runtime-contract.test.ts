import { describe, expect, it } from "vitest";

import { CreativeRuntimeInputError, creativeConversationSourceForSurface, creativeConversationSources, creativeSurfaces, isCreativeConversationSourceCompatible, isCreativeProjectHandoff, normalizeCreativeRunRequest } from "./creative-runtime-contract";

describe("normalizeCreativeRunRequest", () => {
    it("normalizes a chat request and deduplicates assets", () => {
        expect(
            normalizeCreativeRunRequest({
                clientRequestId: " req-1 ",
                surface: "chat",
                prompt: " hello ",
                assetIds: ["a", "a", "b"],
                skillIds: ["character-design", "character-design"],
                modelIds: [" image-pro ", "image-pro", "video-pro"],
                agentModelId: " planner-pro ",
            }),
        ).toEqual({
            clientRequestId: "req-1",
            surface: "chat",
            prompt: "hello",
            assetIds: ["a", "b"],
            skillIds: ["character-design"],
            modelIds: ["image-pro", "video-pro"],
            agentModelId: "planner-pro",
        });
    });

    it("limits and omits optional Agent model identifiers", () => {
        expect(normalizeCreativeRunRequest({ ...validChatRequest(), agentModelId: `  ${"m".repeat(200)}  ` }).agentModelId).toHaveLength(160);
        expect(normalizeCreativeRunRequest({ ...validChatRequest(), agentModelId: "   " }).agentModelId).toBeUndefined();
    });

    it("requires projects for canvas, design and drama", () => {
        expect(() => normalizeCreativeRunRequest({ clientRequestId: "x", surface: "canvas", prompt: "draw" })).toThrow("画布标识不能为空");
        expect(() => normalizeCreativeRunRequest({ clientRequestId: "x", surface: "design", prompt: "draw" })).toThrow("画板标识不能为空");
        expect(() => normalizeCreativeRunRequest({ clientRequestId: "x", surface: "drama", prompt: "write" })).toThrow("短剧项目标识不能为空");
    });

    it("rejects project state on chat and oversized snapshots", () => {
        expect(() => normalizeCreativeRunRequest({ clientRequestId: "x", surface: "chat", projectId: "p", prompt: "hello" })).toThrow("普通对话不接受项目或快照");
        try {
            normalizeCreativeRunRequest({ clientRequestId: "x", surface: "canvas", projectId: "p", prompt: "draw", snapshot: { value: "x".repeat(513 * 1024) } });
            throw new Error("expected validation error");
        } catch (error) {
            expect(error).toBeInstanceOf(CreativeRuntimeInputError);
            expect((error as CreativeRuntimeInputError).status).toBe(413);
        }
    });
});

function validChatRequest() {
    return { clientRequestId: "request", surface: "chat", prompt: "hello" };
}

describe("isCreativeProjectHandoff", () => {
    it("accepts complete handoffs and rejects incomplete event payloads", () => {
        expect(
            isCreativeProjectHandoff({
                id: "handoff-one",
                sourceRunId: "run-one",
                conversationId: "conversation-one",
                surface: "canvas",
                title: "品牌画布",
                summary: "整理当前内容",
                assetIds: [],
                assets: [],
            }),
        ).toBe(true);
        expect(
            isCreativeProjectHandoff({
                id: "handoff-design",
                sourceRunId: "run-one",
                conversationId: "conversation-one",
                surface: "design",
                title: "设计画板",
                summary: "P5 前不开放",
                assetIds: [],
                assets: [],
            }),
        ).toBe(false);
        expect(isCreativeProjectHandoff({ id: "handoff-one", surface: "canvas", title: "品牌画布", assets: [] })).toBe(false);
    });
});

describe("creative conversation surface/source contract", () => {
    it("keeps Design first-class without advertising its P5 handoff", () => {
        expect(creativeSurfaces).toEqual(["chat", "canvas", "design", "drama"]);
        expect(creativeConversationSources).toEqual(["agent", "image-workbench", "video-workbench", "canvas", "design", "drama"]);
        expect(creativeConversationSourceForSurface("design")).toBe("design");
    });

    it.each([
        ["chat", "agent", true],
        ["chat", "image-workbench", true],
        ["chat", "video-workbench", true],
        ["chat", "design", false],
        ["canvas", "canvas", true],
        ["canvas", "agent", false],
        ["design", "design", true],
        ["design", "canvas", false],
        ["design", "agent", false],
        ["drama", "drama", true],
    ] as const)("matches %s with %s: %s", (surface, source, expected) => {
        expect(isCreativeConversationSourceCompatible(surface, source)).toBe(expected);
    });
});
