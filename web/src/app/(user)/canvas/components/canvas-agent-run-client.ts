import { watchWorkspaceAgentRun, type WorkspaceAgentActionReceiptEvent, type WorkspaceAgentActionRequestEvent } from "@/lib/creative-workspace/workspace-agent-run-client";
import type { WorkspaceActionRequest } from "@/lib/creative-workspace";

import type { CanvasAgentOp } from "../utils/canvas-agent-ops";
import type { CanvasAgentRunStage } from "./canvas-agent-progress";

type RunHandlers = {
    onPlan: (ops: CanvasAgentOp[], reply: string) => void;
    onAssistant: (text: string, detail?: { nodeIds?: string[]; taskType?: "text" | "image" | "video" | "audio"; runId?: string; taskId?: string; title?: string }) => void;
    onStage: (stage: CanvasAgentRunStage) => void;
    onPaused: (paused: boolean) => void;
    onOps: (ops: CanvasAgentOp[]) => void;
    onWorkspaceActionRequest?: (event: WorkspaceAgentActionRequestEvent) => void;
    onWorkspaceActionConfirmed?: (request: WorkspaceActionRequest) => void;
    onWorkspaceActionRejected?: (input: { batchId: string; fingerprint: string }) => void;
    onWorkspaceActionReceipt?: (event: WorkspaceAgentActionReceiptEvent<CanvasAgentOp>) => void;
};

export function watchCanvasAgentRun(runId: string, handlers: RunHandlers) {
    return watchWorkspaceAgentRun<CanvasAgentOp>(runId, {
        onLegacyPlan: handlers.onPlan,
        onAssistant: handlers.onAssistant,
        onStage: (stage) => {
            if (stage.key === "planning") {
                handlers.onStage({ ...stage, text: "正在理解需求并分析当前画布" });
                return;
            }
            if (stage.key === "plan") {
                handlers.onStage({ ...stage, text: "文本执行计划已生成，正在准备任务" });
                return;
            }
            handlers.onStage(stage);
        },
        onPaused: handlers.onPaused,
        onLegacyOps: handlers.onOps,
        onWorkspaceActionRequest: handlers.onWorkspaceActionRequest,
        onWorkspaceActionConfirmed: handlers.onWorkspaceActionConfirmed,
        onWorkspaceActionRejected: handlers.onWorkspaceActionRejected,
        onWorkspaceActionReceipt: handlers.onWorkspaceActionReceipt,
    });
}
