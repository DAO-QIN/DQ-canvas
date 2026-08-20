import { describe, expect, it } from "vitest";

import { WorkspaceHandoffContractError, parseWorkspaceHandoffRequest, workspaceHandoffRequestFingerprint } from "./workspace-handoff";

const request = {
    handoffId: "handoff-one",
    source: { surface: "canvas" as const, projectId: "canvas-one", revision: 3, selectionIds: ["image-one", "image-two"] },
    target: { surface: "design" as const, projectId: "design-one", baseRevision: 7 },
};

describe("Workspace handoff contract", () => {
    it("normalizes a cross-surface request and creates a stable fingerprint", () => {
        const parsed = parseWorkspaceHandoffRequest(request);
        expect(parsed).toEqual(request);
        expect(Object.isFrozen(parsed)).toBe(true);
        expect(workspaceHandoffRequestFingerprint(parsed)).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(workspaceHandoffRequestFingerprint(parsed)).toBe(workspaceHandoffRequestFingerprint(structuredClone(request)));
    });

    it.each([
        ["same surface", { ...request, target: { ...request.target, surface: "canvas" } }],
        ["empty selection", { ...request, source: { ...request.source, selectionIds: [] } }],
        ["duplicate selection", { ...request, source: { ...request.source, selectionIds: ["image-one", "image-one"] } }],
        ["unsafe id", { ...request, handoffId: "handoff/one" }],
        ["unknown locator-like field", { ...request, storageKey: "permanent/private.png" }],
        ["unknown URL field", { ...request, source: { ...request.source, url: "https://signed.example/image.png" } }],
    ])("rejects %s", (_label, value) => {
        expect(() => parseWorkspaceHandoffRequest(value)).toThrow(WorkspaceHandoffContractError);
    });

    it("binds the fingerprint to selection order and target revision", () => {
        expect(workspaceHandoffRequestFingerprint(request)).not.toBe(workspaceHandoffRequestFingerprint({ ...request, source: { ...request.source, selectionIds: [...request.source.selectionIds].reverse() } }));
        expect(workspaceHandoffRequestFingerprint(request)).not.toBe(workspaceHandoffRequestFingerprint({ ...request, target: { ...request.target, baseRevision: 8 } }));
    });
});
