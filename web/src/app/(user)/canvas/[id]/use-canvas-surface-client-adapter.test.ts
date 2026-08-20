import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const hookSource = () => readFileSync(new URL("./use-canvas-surface-client-adapter.ts", import.meta.url), "utf8");
const controllerSource = () => readFileSync(new URL("./use-canvas-page-controller.tsx", import.meta.url), "utf8");

describe("Canvas surface client adapter lifecycle wiring", () => {
    it("creates one adapter from a latest-runtime ref and destroys it on a real unmount", () => {
        const source = hookSource();

        expect(source).toContain("const runtimeRef = useRef(runtime)");
        expect(source).toContain("runtimeRef.current = runtime");
        expect(source).toContain("const adapterRef = useRef<CanvasSurfaceClientAdapter | null>(null)");
        expect(source.match(/createCanvasSurfaceClientAdapter\(/g)).toHaveLength(1);
        expect(source).toMatch(/if \(!adapterRef\.current\) \{[\s\S]*adapterRef\.current = createCanvasSurfaceClientAdapter/);
        expect(source).toContain("const destroyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)");
        expect(source).toContain("clearTimeout(destroyTimerRef.current)");
        expect(source).toMatch(/return \(\) => \{[\s\S]*destroyTimerRef\.current = setTimeout\(\(\) => \{/);
        expect(source).toContain("adapter.destroy()");
        expect(source).toContain("adapterRef.current = null");
    });

    it("reads mutable Canvas truth through refs and never captures a duplicate document", () => {
        const source = hookSource();

        expect(source).toContain("nodes: state.nodesRef.current");
        expect(source).toContain("selectedNodeIds: state.selectedNodeIdsRef.current");
        expect(source).toContain("viewport: state.viewportRef.current");
        expect(source).toContain("state.containerRef.current?.getBoundingClientRect()");
        expect(source).not.toMatch(/useState\s*<[^>]*(?:CanvasNodeData|ViewportTransform)/);
        expect(source).not.toContain("setNodes(");
    });

    it("injects existing domain handlers without reimplementing Store or Agent semantics", () => {
        const source = hookSource();

        expect(source).toContain("runtimeRef.current.interactions.undoCanvas()");
        expect(source).toContain("runtimeRef.current.interactions.redoCanvas()");
        expect(source).toContain("runtimeRef.current.state.setViewport(viewport)");
        expect(source).toContain("runtimeRef.current.interactions.setZoomScale(scale)");
        expect(source).toContain("runtimeRef.current.interactions.resetViewport()");
        expect(source).toContain("runtimeRef.current.interactions.deselectCanvas()");
        expect(source).toContain("runtimeRef.current.interactions.deleteNodes(nodeIds)");
        expect(source).toContain("runtimeRef.current.interactions.deleteConnection(connectionId)");
        expect(source).toContain("runtimeRef.current.media.handleNodeResize(nodeId, width, height, position)");
        expect(source).toContain("runtimeRef.current.interactions.createNode(nodeType, position)");
        expect(source).not.toMatch(/useCanvasStore|CanvasAssistant|canvas-agent|generation/i);
    });

    it("publishes classified history, viewport, selection, resize and document changes", () => {
        const source = hookSource();

        for (const kind of ["history", "viewport", "selection"] as const) {
            expect(source).toContain(`adapter.refresh("${kind}")`);
        }
        expect(source).toContain('pendingNodeChangeRef.current = "resize"');
        expect(source).toContain('const change = pendingNodeChangeRef.current ?? "document"');
        expect(source).toContain("adapter.refresh(change)");
        expect(source).toContain("autoRefresh: false");
        expect(source).toContain("runtime.state.historyState.canRedo");
        expect(source).toContain("runtime.state.historyState.canUndo");
        expect(source).toContain("runtime.state.viewport");
        expect(source).toContain("runtime.state.selectedConnectionId");
        expect(source).toContain("runtime.state.selectedNodeIds");
        expect(source).toContain("runtime.state.size");
        expect(source).toContain("runtime.state.nodes");
    });

    it("adds the adapter to the existing controller return without changing prior spreads", () => {
        const source = controllerSource();

        expect(source).toContain("const surfaceClientAdapter = useCanvasSurfaceClientAdapter({ state, interactions, media })");
        expect(source).toContain("return { ...state, ...tasks, ...interactions, ...media, ...generation, surfaceClientAdapter }");
    });
});
