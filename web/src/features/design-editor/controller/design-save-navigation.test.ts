import { describe, expect, it, vi } from "vitest";

import type { DesignEditorSaveStatus } from "../store/design-editor-store";
import { createDesignSaveNavigationCoordinator } from "./design-save-navigation";

describe("design save navigation coordinator", () => {
    it("navigates immediately when the document is already saved", async () => {
        const flush = vi.fn(async () => undefined);
        const navigate = vi.fn(async () => undefined);
        const coordinator = createDesignSaveNavigationCoordinator({ getStatus: () => "saved", flush, navigate });

        await expect(coordinator.navigate()).resolves.toBe(true);
        expect(flush).not.toHaveBeenCalled();
        expect(navigate).toHaveBeenCalledOnce();
    });

    it.each(["dirty", "saving"] as const)("flushes a %s document and navigates only after it becomes saved", async (initialStatus) => {
        let status: DesignEditorSaveStatus = initialStatus;
        const flush = vi.fn(async () => {
            status = "saved";
        });
        const navigate = vi.fn(async () => undefined);
        const coordinator = createDesignSaveNavigationCoordinator({ getStatus: () => status, flush, navigate });

        await expect(coordinator.navigate()).resolves.toBe(true);
        expect(flush).toHaveBeenCalledOnce();
        expect(navigate).toHaveBeenCalledOnce();
    });

    it.each(["error", "conflict"] as const)("does not flush or navigate while the document is in %s", async (status) => {
        const flush = vi.fn(async () => undefined);
        const navigate = vi.fn(async () => undefined);
        const onFailure = vi.fn();
        const coordinator = createDesignSaveNavigationCoordinator({ getStatus: () => status, flush, navigate, onFailure });

        await expect(coordinator.navigate()).resolves.toBe(false);
        expect(flush).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
        expect(onFailure).toHaveBeenCalledWith({ status });
    });

    it("does not navigate when flushing resolves without reaching the saved state", async () => {
        let status: DesignEditorSaveStatus = "dirty";
        const flush = vi.fn(async () => {
            status = "error";
        });
        const navigate = vi.fn(async () => undefined);
        const onFailure = vi.fn();
        const coordinator = createDesignSaveNavigationCoordinator({ getStatus: () => status, flush, navigate, onFailure });

        await expect(coordinator.navigate()).resolves.toBe(false);
        expect(navigate).not.toHaveBeenCalled();
        expect(onFailure).toHaveBeenCalledWith({ status: "error" });
    });

    it("reports a flush rejection and keeps navigation blocked", async () => {
        const failure = new Error("save failed");
        const flush = vi.fn(async () => {
            throw failure;
        });
        const navigate = vi.fn(async () => undefined);
        const onFailure = vi.fn();
        const coordinator = createDesignSaveNavigationCoordinator({ getStatus: () => "dirty", flush, navigate, onFailure });

        await expect(coordinator.navigate()).resolves.toBe(false);
        expect(navigate).not.toHaveBeenCalled();
        expect(onFailure).toHaveBeenCalledWith({ status: "dirty", error: failure });
    });

    it("shares concurrent attempts and performs one flush and one navigation", async () => {
        let status: DesignEditorSaveStatus = "dirty";
        let releaseFlush!: () => void;
        const flushGate = new Promise<void>((resolve) => {
            releaseFlush = resolve;
        });
        const flush = vi.fn(async () => {
            await flushGate;
            status = "saved";
        });
        const navigate = vi.fn(async () => undefined);
        const coordinator = createDesignSaveNavigationCoordinator({ getStatus: () => status, flush, navigate });

        const first = coordinator.navigate();
        const second = coordinator.navigate();
        expect(second).toBe(first);
        expect(flush).toHaveBeenCalledOnce();

        releaseFlush();
        await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
        expect(navigate).toHaveBeenCalledOnce();
    });
});
