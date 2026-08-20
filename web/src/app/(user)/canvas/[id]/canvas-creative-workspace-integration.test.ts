import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(resolve(process.cwd(), path), "utf8");

describe("Canvas creative workspace integration", () => {
    it("gates the shared chrome independently while retaining the legacy rollback branch", async () => {
        const source = await read("src/app/(user)/canvas/[id]/canvas-client-page.tsx");

        expect(source).toContain('isCreativeWorkspaceEnabled("canvas")');
        expect(source).toContain("<CanvasCreativeWorkspaceChrome");
        expect(source).toContain("<CanvasSelectionSizeOverlay adapter={surfaceClientAdapter} />");
        expect(source).toContain("<CanvasTopBar");
        expect(source).toContain("<CanvasToolbar");
        expect(source).toContain("<CanvasZoomControls");
        expect(source).toContain("hosted={creativeWorkspaceEnabled}");
    });

    it("hosts one shared bottom composer while preserving the legacy node-panel rollback", async () => {
        const [page, promptPanel, fileActions] = await Promise.all([
            read("src/app/(user)/canvas/[id]/canvas-client-page.tsx"),
            read("src/app/(user)/canvas/components/canvas-node-prompt-panel.tsx"),
            read("src/app/(user)/canvas/[id]/use-canvas-file-actions.tsx"),
        ]);

        expect(page).toContain("generationComposer={");
        expect(page).toContain('variant="workspace"');
        expect(page).toContain("!creativeWorkspaceEnabled || node.type === CanvasNodeType.Config");
        expect(page.match(/<CanvasNodePromptPanel\b/g)).toHaveLength(2);
        expect(promptPanel).toContain("<WorkspaceGenerationComposer");
        expect(page).toContain("creativeWorkspaceEnabled ? selectedWorkspaceComposerNode : null");
        expect(fileActions).toContain("const createReferenceMediaNodes");
        expect(fileActions).toContain("target = nodesRef.current.find");
        expect(fileActions).toContain("fromNodeId: node.id, toNodeId: targetNodeId");
        expect(fileActions).toContain('file.type.startsWith("video/")');
        expect(fileActions).not.toContain("metadata: { references:");
    });

    it("keeps one Canvas surface and all domain overlays outside the shared package", async () => {
        const [page, sharedShell] = await Promise.all([read("src/app/(user)/canvas/[id]/canvas-client-page.tsx"), read("src/components/creative-workspace/creative-workspace-shell.tsx")]);

        expect(page.match(/<DQCanvas\b/g)).toHaveLength(1);
        for (const capability of ["CanvasNodeHoverToolbar", "CanvasNodeContextMenu", "CanvasDrawingEditorModal", "AssetPickerModal", "CanvasAssistantPanel"]) {
            expect(page).toContain(`<${capability}`);
            expect(sharedShell).not.toContain(capability);
        }
        expect(sharedShell).not.toMatch(/CanvasNodeData|CanvasConnection|CanvasAgentOp|useCanvasStore/);
    });

    it("flushes the current project before leaving through shared or legacy navigation", async () => {
        const [page, navigation, store] = await Promise.all([read("src/app/(user)/canvas/[id]/canvas-client-page.tsx"), read("src/app/(user)/canvas/[id]/use-canvas-navigation-actions.tsx"), read("src/app/(user)/canvas/stores/use-canvas-store.ts")]);

        expect(page).toContain("navigateToWorkbench");
        expect(page).toContain("navigateToProjects");
        expect(navigation).toContain("await flushCurrentProject()");
        expect(navigation).toContain("viewport: viewportRef.current");
        expect(store).toContain("flushProject: async (id)");
    });

    it("prepares every Agent run from persisted Canvas truth", async () => {
        const [page, interactions, panel] = await Promise.all([
            read("src/app/(user)/canvas/[id]/canvas-client-page.tsx"),
            read("src/app/(user)/canvas/[id]/use-canvas-interaction-core.tsx"),
            read("src/app/(user)/canvas/components/canvas-assistant-panel.tsx"),
        ]);

        expect(page).toContain("onPrepareRun={prepareAgentRun}");
        expect(panel).toMatch(/agentRunController\.create\([\s\S]*onPrepareRun/);
        expect(panel).not.toContain('fetch("/api/agent/runs"');
        expect(interactions).toMatch(/const prepareAgentRun = useCallback\(async \(\) => \{[\s\S]*await persistAgentSnapshot\(/);
    });

    it("persists applied workspace actions before reporting their receipt", async () => {
        const interactions = await read("src/app/(user)/canvas/[id]/use-canvas-interaction-core.tsx");

        expect(interactions).toMatch(/updateProject\(projectId,[\s\S]*const receipt = await flushProject\(projectId\)/);
        expect(interactions).toContain('if (!receipt) throw new Error("Canvas 写操作没有产生服务端保存回执")');
        expect(interactions).toMatch(/executeCanvasWorkspaceActions\(\{[\s\S]*persist: persistAgentSnapshot/);
    });

    it("restores awaiting-confirmation runs and wires the shared confirmation card", async () => {
        const panel = await read("src/app/(user)/canvas/components/canvas-assistant-panel.tsx");

        expect(panel).toContain('restore({ surface: "canvas", projectId })');
        expect(panel).toContain("<WorkspaceAgentActionCard");
        expect(panel).toContain("workspaceActionControllerRef.current?.confirm()");
        expect(panel).toContain("workspaceActionControllerRef.current?.reject()");
        expect(panel).toContain("workspaceActionControllerRef.current?.retry()");
    });
});
