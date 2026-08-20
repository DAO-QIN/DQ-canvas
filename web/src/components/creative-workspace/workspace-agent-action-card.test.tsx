import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { WorkspaceAgentActionState } from "@/lib/creative-workspace";

import { WorkspaceAgentActionCard } from "./workspace-agent-action-card";

const request = {
    surface: "design" as const,
    projectId: "design-one",
    baseRevision: 6,
    batchId: "batch-one",
    actions: [{ actionId: "move-one", kind: "arrange" as const, effect: "write" as const, command: "content.update", label: "移动主标题", targetIds: ["title-one"], parameters: {} }],
};

describe("WorkspaceAgentActionCard", () => {
    it("renders a write summary with explicit confirm and reject commands", () => {
        const state: WorkspaceAgentActionState = { status: "pending-confirmation", request, fingerprint: "sha256:test" };
        const markup = renderToStaticMarkup(<WorkspaceAgentActionCard state={state} onConfirm={vi.fn()} onReject={vi.fn()} onRetry={vi.fn()} />);

        expect(markup).toContain('data-status="pending-confirmation"');
        expect(markup).toContain("移动主标题");
        expect(markup).toContain("确认");
        expect(markup).toContain("拒绝");
    });

    it("shows retry only for retryable synchronization errors", () => {
        const state: WorkspaceAgentActionState = { status: "error", request, fingerprint: "sha256:test", message: "gateway timeout", retryable: true };
        const markup = renderToStaticMarkup(<WorkspaceAgentActionCard state={state} onConfirm={vi.fn()} onReject={vi.fn()} onRetry={vi.fn()} />);

        expect(markup).toContain('data-status="error"');
        expect(markup).toContain("gateway timeout");
        expect(markup).toContain("重试");
    });
});
