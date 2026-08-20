import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Design project library and Phase 5 editor boundary", () => {
    it("uses the Design Project API and revision-aware deletion in the project library", () => {
        const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
        expect(source).toContain("listDesignProjects");
        expect(source).toContain("createDesignProject");
        expect(source).toContain("deleteDesignProject(project.id, project.revision)");
        expect(source).toContain("isDesignProjectConflict");
        expect(source).not.toContain("useCanvasStore");
    });

    it("keeps the route thin and delegates the writable document to the project-level editor store", () => {
        const source = readFileSync(new URL("./[id]/page.tsx", import.meta.url), "utf8");
        expect(source).toContain("DesignEditorWorkbench");
        expect(source).toContain("projectId={String(params.id");
        expect(source).not.toContain("setDocument");
        expect(source).not.toContain("useCanvasStore");
        expect(source).not.toContain("fabric");
    });
});
