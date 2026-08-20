import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { CreativeWorkspaceGenerationTask } from "@/lib/creative-workspace";

import { mergeDesignGenerationTasks } from "./design-editor-workbench";

describe("DesignEditorWorkbench responsibility boundaries", () => {
    it("delegates commands, shortcuts and non-persistent view state to focused hooks", () => {
        const source = readFileSync(new URL("./design-editor-workbench.tsx", import.meta.url), "utf8");

        expect(source).toContain('import { useDesignEditorController } from "../controller/use-design-editor-controller"');
        expect(source).toContain('import { useDesignEditorShortcuts } from "../controller/use-design-editor-shortcuts"');
        expect(source).toContain('import { useDesignEditorViewState } from "../controller/use-design-editor-view-state"');
        expect(source).toContain("const controller = useDesignEditorController({ store, notify: message })");
        expect(source).toMatch(/useDesignEditorShortcuts\(\{[\s\S]*store,[\s\S]*notify: message,[\s\S]*removeSelection: controller\.removeSelection,[\s\S]*openExport:/);
        expect(source).not.toContain('window.addEventListener("keydown"');
        expect(source).not.toContain('type: "update-transform"');
        expect(source).not.toContain("function dispatchSelectedElement");
    });

    it("keeps Store lifecycle, exceptional shell states, safe navigation and both shell branches in the composition layer", () => {
        const source = readFileSync(new URL("./design-editor-workbench.tsx", import.meta.url), "utf8");

        expect(source).toContain("createDesignEditorStore(projectId)");
        expect(source).toContain("createDesignSaveNavigationCoordinator");
        expect(source).toContain("store.getState().load()");
        expect(source).toContain("store.getState().destroy()");
        expect(source).toContain('state.status === "not-found"');
        expect(source).toContain("if (creativeWorkspaceEnabled)");
        expect(source).toContain("<DesignEditorCreativeShell");
        expect(source).toContain("<DesignFabricSurface");
        expect(source.match(/afterClose=\{imageTools\.restoreDialogFocus\}/g)).toHaveLength(4);
        expect(source.match(/sourceDimensions=\{imageTools\.dialogImage\}/g)).toHaveLength(3);
    });

    it("shows active, retryable failed and explicitly pending Design image tasks once", () => {
        const task = (id: string, status: CreativeWorkspaceGenerationTask["status"], updatedAt: number, project = "design-one"): CreativeWorkspaceGenerationTask => ({
            id,
            type: "image",
            status,
            binding: { surface: "design", projectId: project, baseRevision: 1, target: { scope: "workspace" } },
            createdAt: 1,
            updatedAt,
        });
        const active = task("active", "running", 4);
        const failed = { ...task("failed", "failed", 3), prompt: "重试这个生成任务" };
        const persisted = task("persisted", "succeeded", 2);
        const pending = task("pending", "succeeded", 5);
        const failedProcess = { ...task("failed-process", "failed", 6), type: "image_process" };

        expect(mergeDesignGenerationTasks([active], [active, failed, failedProcess, persisted, task("other", "failed", 9, "design-other")], [pending], "design-one").map((item) => item.id)).toEqual(["failed-process", "pending", "active", "failed"]);
    });
});
