import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { DesignEditorSaveStatus } from "../store/design-editor-store";
import { createDesignSaveNavigationCoordinator } from "../controller/design-save-navigation";

describe("DesignEditorWorkbench return navigation", () => {
    it("wires the return button through the save coordinator instead of navigating directly", () => {
        const source = readFileSync(new URL("./design-editor-workbench.tsx", import.meta.url), "utf8");

        expect(source).toContain('import { createDesignSaveNavigationCoordinator } from "../controller/design-save-navigation"');
        expect(source).toContain("getStatus: () => store.getState().status");
        expect(source).toContain("flush: () => store.getState().flush()");
        expect(source).toContain('navigate: () => router.push("/design")');
        expect(source).toContain("onClick={handleBackToProjects}");
        expect(source).not.toContain('onClick={() => router.push("/design")} aria-label="返回我的画板"');
    });

    it("selects the shared Design shell at the surface boundary without changing the Fabric or Store owner", () => {
        const source = readFileSync(new URL("./design-editor-workbench.tsx", import.meta.url), "utf8");

        expect(source).toContain('isCreativeWorkspaceEnabled("design")');
        expect(source).toContain("<DesignEditorCreativeShell");
        expect(source).toContain("surface={");
        expect(source).toContain("<DesignFabricSurface");
        expect(source).toContain("layersPanel={");
        expect(source).toContain("inspectorPanel={");
        expect(source).toContain("onDeleteProject={confirmRemove}");
        expect(source).toContain('title: "删除当前画板？"');
    });

    it("flushes a dirty Workbench before returning to the project library", async () => {
        const harness = createWorkbenchHarness("dirty", async (setStatus) => setStatus("saved"));

        await expect(harness.coordinator.navigate()).resolves.toBe(true);
        expect(harness.flush).toHaveBeenCalledOnce();
        expect(harness.navigate).toHaveBeenCalledOnce();
        expect(harness.onFailure).not.toHaveBeenCalled();
    });

    it("stays in the Workbench when saving changes the Store to error", async () => {
        const harness = createWorkbenchHarness("dirty", async (setStatus) => setStatus("error"));

        await expect(harness.coordinator.navigate()).resolves.toBe(false);
        expect(harness.flush).toHaveBeenCalledOnce();
        expect(harness.navigate).not.toHaveBeenCalled();
        expect(harness.onFailure).toHaveBeenCalledWith({ status: "error" });
    });

    it("does not flush or leave a conflicted Workbench", async () => {
        const harness = createWorkbenchHarness("conflict");

        await expect(harness.coordinator.navigate()).resolves.toBe(false);
        expect(harness.flush).not.toHaveBeenCalled();
        expect(harness.navigate).not.toHaveBeenCalled();
        expect(harness.onFailure).toHaveBeenCalledWith({ status: "conflict" });
    });

    it("coalesces consecutive return clicks into one save and one navigation", async () => {
        let releaseFlush!: () => void;
        const flushGate = new Promise<void>((resolve) => {
            releaseFlush = resolve;
        });
        const harness = createWorkbenchHarness("dirty", async (setStatus) => {
            await flushGate;
            setStatus("saved");
        });

        const first = harness.coordinator.navigate();
        const second = harness.coordinator.navigate();
        const third = harness.coordinator.navigate();
        expect(second).toBe(first);
        expect(third).toBe(first);
        expect(harness.flush).toHaveBeenCalledOnce();

        releaseFlush();
        await expect(Promise.all([first, second, third])).resolves.toEqual([true, true, true]);
        expect(harness.navigate).toHaveBeenCalledOnce();
    });
});

function createWorkbenchHarness(initialStatus: DesignEditorSaveStatus, flushAction: (setStatus: (status: DesignEditorSaveStatus) => void) => Promise<void> = async () => undefined) {
    let status = initialStatus;
    const setStatus = (nextStatus: DesignEditorSaveStatus) => {
        status = nextStatus;
    };
    const flush = vi.fn(() => flushAction(setStatus));
    const navigate = vi.fn(async () => undefined);
    const onFailure = vi.fn();
    const coordinator = createDesignSaveNavigationCoordinator({ getStatus: () => status, flush, navigate, onFailure });
    return { coordinator, flush, navigate, onFailure };
}
