import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GenerationTaskCard, GenerationTaskTray } from "./generation-task-tray";
import type { WorkspaceThemeTokens } from "./workspace-theme";

const theme: WorkspaceThemeTokens = {
    canvasBackground: "#fff",
    panelBackground: "#fff",
    panelBorder: "#ddd",
    foreground: "#111",
    mutedForeground: "#666",
    controlForeground: "#333",
    controlHoverBackground: "#eee",
    activeBackground: "#def",
    activeForeground: "#157",
    dangerForeground: "#b22",
    focusRing: "#157",
};

describe("GenerationTaskTray", () => {
    it("binds the visible tray to an explicit surface and project", () => {
        const markup = renderToStaticMarkup(<GenerationTaskTray surface="design" projectId="design-one" tasks={[{ id: "task-one", type: "image", status: "running", createdAt: 1, updatedAt: 2 }]} theme={theme} />);
        expect(markup).toContain('data-surface="design"');
        expect(markup).toContain('data-project-id="design-one"');
        expect(markup).toContain("当前画板生成任务");
        expect(markup).not.toContain("task-one</p>");
    });

    it("keeps persisted progress milestones and billing semantics", () => {
        const markup = renderToStaticMarkup(
            <GenerationTaskCard task={{ id: "cutout", type: "image_process", status: "running", progressStage: "inference", progress: 50, billing: { pointsCost: 8 }, createdAt: 1, updatedAt: 2 }} now={2} expanded={false} onToggle={() => undefined} />,
        );
        expect(markup).toContain('aria-label="进度 50%"');
        expect(markup).toContain('aria-current="step"');
        expect(markup).toContain("8 积分");
    });

    it("renders domain-owned actions and pending notices without changing task semantics", () => {
        const markup = renderToStaticMarkup(
            <GenerationTaskCard
                task={{ id: "late-result", type: "image", status: "succeeded", prompt: "调整商品光线", createdAt: 1, updatedAt: 2 }}
                now={2}
                expanded
                notice="画板已更新，结果等待放置"
                actions={[
                    { id: "place", label: "放置到当前画板", busy: true, onPress: () => undefined },
                    { id: "cancel", label: "取消任务", tone: "danger", onPress: () => undefined },
                ]}
                onToggle={() => undefined}
            />,
        );

        expect(markup).toContain('aria-label="任务操作"');
        expect(markup).toContain("画板已更新，结果等待放置");
        expect(markup).toContain("放置到当前画板");
        expect(markup).toContain('aria-busy="true"');
        expect(markup).toContain("取消任务");
    });
});
