import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CreativeMessage } from "@/lib/creative-runtime-contract";

import { creativeMessageToWorkspacePanelMessage } from "./workspace-agent-panel";

describe("shared workspace Agent panel", () => {
    it("maps persisted server messages without Surface-specific chat state", () => {
        const message = {
            id: "message-one",
            conversationId: "conversation-one",
            sequence: 1,
            role: "assistant",
            status: "failed",
            content: "版本冲突",
            metadata: {},
            createdAt: 1,
            updatedAt: 1,
        } satisfies CreativeMessage;

        expect(creativeMessageToWorkspacePanelMessage(message)).toEqual({ id: "message-one", role: "error", text: "版本冲突" });
    });

    it("keeps the user message representation compact", () => {
        const message = creativeMessageToWorkspacePanelMessage({
            id: "user-one",
            conversationId: "conversation-one",
            sequence: 1,
            role: "user",
            status: "completed",
            content: "左对齐当前选区",
            metadata: {},
            createdAt: 1,
            updatedAt: 1,
        });
        expect(renderToStaticMarkup(<span data-role={message.role}>{message.text}</span>)).toContain('data-role="user"');
    });
});
