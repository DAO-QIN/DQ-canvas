import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceHandoffDialog, type WorkspaceHandoffProps, type WorkspaceHandoffTargetOption } from "./workspace-handoff";

const target: WorkspaceHandoffTargetOption = { id: "design-one", title: "商品主图", revision: 4, surface: "design" };

function props(overrides: Partial<WorkspaceHandoffProps> = {}): WorkspaceHandoffProps {
    return {
        sourceSurface: "canvas",
        sourceProjectId: "canvas-one",
        sourceRevision: 0,
        selectionIds: ["image-one"],
        loadTargets: async () => [target],
        flushSource: async () => undefined,
        getCurrentRevision: () => 0,
        onOpenTarget: vi.fn(),
        ...overrides,
    };
}

describe("WorkspaceHandoffDialog presentation boundaries", () => {
    it("disables the trigger when the projected selection is empty", () => {
        const markup = renderToStaticMarkup(<WorkspaceHandoffDialog {...props({ selectionIds: [] })} />);
        expect(markup).toMatch(/aria-label="交接到画板"[^>]*disabled=""/);
    });

    it("keeps a usable trigger for a transferable selection", () => {
        const markup = renderToStaticMarkup(<WorkspaceHandoffDialog {...props()} />);
        expect(markup).toContain('aria-label="交接到画板"');
        expect(markup).not.toMatch(/aria-label="交接到画板"[^>]*disabled=""/);
    });

    it("renders target options without virtualization so assistive technology can reach them", () => {
        const source = readFileSync(new URL("./workspace-handoff.tsx", import.meta.url), "utf8");
        expect(source).toContain("virtual={false}");
    });
});
