import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildWorkspaceHandoffRequest, canSubmitWorkspaceHandoff, isCompatibleStoredRequest, workspaceHandoffRequestForSubmission, workspaceHandoffStorageKey, type WorkspaceHandoffTargetOption } from "./workspace-handoff";

const target: WorkspaceHandoffTargetOption = { id: "design-one", title: "商品主图", revision: 4, surface: "design" };

describe("shared workspace handoff controller primitives", () => {
    it("disables the action when no transferable selection or target exists", () => {
        expect(canSubmitWorkspaceHandoff([], target)).toBe(false);
        expect(canSubmitWorkspaceHandoff(["image-a"], null)).toBe(false);
        expect(canSubmitWorkspaceHandoff(["image-a"], target)).toBe(true);
    });

    it("builds a contract-only persisted request from a selected target", () => {
        const request = buildWorkspaceHandoffRequest({ sourceSurface: "canvas", sourceProjectId: "canvas-one", selectionIds: ["image-b", "image-a"] }, target, 7);
        expect(request).toMatchObject({ source: { surface: "canvas", projectId: "canvas-one", revision: 7, selectionIds: ["image-b", "image-a"] }, target: { surface: "design", projectId: "design-one", baseRevision: 4 } });
        expect(request.handoffId).toMatch(/^handoff-/);
        expect(JSON.stringify(request)).not.toMatch(/url|mime|width|height|provider|credential/i);
    });

    it("uses a stable source selection key independent of selection order", () => {
        expect(workspaceHandoffStorageKey("canvas", "canvas-one", ["b", "a"])).toBe(workspaceHandoffStorageKey("canvas", "canvas-one", ["a", "b"]));
    });

    it("reuses the exact persisted request and handoffId after an interrupted submission", () => {
        const request = buildWorkspaceHandoffRequest({ sourceSurface: "canvas", sourceProjectId: "canvas-one", selectionIds: ["image-a"] }, target, 2);
        const changedTarget = { ...target, id: "design-two", revision: 99 };
        expect(workspaceHandoffRequestForSubmission(request, { sourceSurface: "canvas", sourceProjectId: "canvas-one", selectionIds: ["image-a"] }, changedTarget, 9)).toBe(request);
        expect(workspaceHandoffRequestForSubmission(request, { sourceSurface: "canvas", sourceProjectId: "canvas-one", selectionIds: ["image-a"] }, changedTarget, 9).handoffId).toBe(request.handoffId);
    });

    it("accepts refresh recovery only when the source and target still exist", () => {
        const request = buildWorkspaceHandoffRequest({ sourceSurface: "canvas", sourceProjectId: "canvas-one", selectionIds: ["image-a"] }, target, 2);
        expect(isCompatibleStoredRequest(request, { sourceSurface: "canvas", sourceProjectId: "canvas-one", selectionIds: ["image-a"] }, [target])).toBe(true);
        expect(isCompatibleStoredRequest(request, { sourceSurface: "canvas", sourceProjectId: "canvas-one", selectionIds: ["image-b"] }, [target])).toBe(false);
        expect(isCompatibleStoredRequest(request, { sourceSurface: "canvas", sourceProjectId: "canvas-one", selectionIds: ["image-a"] }, [])).toBe(false);
    });

    it("keeps target loading failures fail-closed and clears stale results on refresh", () => {
        const source = readFileSync(new URL("./workspace-handoff.tsx", import.meta.url), "utf8");
        expect(source).toContain('setView("error")');
        expect(source).toContain('setError(errorMessage(loadError, "目标项目加载失败"))');
        expect(source).toContain("setReceipt(null);");
    });
});
