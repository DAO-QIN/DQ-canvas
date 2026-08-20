import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("design engine PoC route isolation", () => {
    it("requires an explicit server-side environment flag", () => {
        const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
        expect(source).toContain('process.env.DQ_DESIGN_POC_ENABLED !== "1"');
        expect(source).toContain("notFound()");
    });
});
