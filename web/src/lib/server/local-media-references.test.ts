import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    ensurePostgresSchema: vi.fn(),
    getDatabaseProvider: vi.fn(),
    postgresQuery: vi.fn(),
    readJsonDataFile: vi.fn(),
    countDesignStorageKeyReferences: vi.fn(),
}));

vi.mock("@/lib/server/database", () => ({
    ensurePostgresSchema: mocks.ensurePostgresSchema,
    getDatabaseProvider: mocks.getDatabaseProvider,
    postgresQuery: mocks.postgresQuery,
}));
vi.mock("@/lib/server/data-adapter", () => ({ readJsonDataFile: mocks.readJsonDataFile }));
vi.mock("@/lib/server/design-resource-references", () => ({ countDesignStorageKeyReferences: mocks.countDesignStorageKeyReferences }));

import { countLocalMediaReferences } from "./local-media-references";

describe("countLocalMediaReferences", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.countDesignStorageKeyReferences.mockResolvedValue(new Map());
    });

    it("counts all requested keys with one PostgreSQL query", async () => {
        mocks.getDatabaseProvider.mockReturnValue("postgres");
        mocks.postgresQuery.mockResolvedValue({
            rows: [
                { storage_key: "permanent/one.png", total: "2" },
                { storage_key: "permanent/two.png", total: 0 },
            ],
        });

        const result = await countLocalMediaReferences(["permanent/one.png", "permanent/two.png", "permanent/one.png"]);

        expect(result).toEqual(
            new Map([
                ["permanent/one.png", 2],
                ["permanent/two.png", 0],
            ]),
        );
        expect(mocks.postgresQuery).toHaveBeenCalledTimes(1);
        expect(mocks.postgresQuery).toHaveBeenCalledWith(expect.stringContaining("unnest($1::text[])"), [["permanent/one.png", "permanent/two.png"]]);
        const sql = String(mocks.postgresQuery.mock.calls[0]?.[0]);
        for (const table of ["creative_assets", "library_assets", "canvas_projects", "drama_projects", "generation_log_assets", "generation_tasks", "published_work_assets"]) expect(sql).toContain(table);
        expect(sql).not.toContain("design_projects");
        expect(mocks.countDesignStorageKeyReferences).toHaveBeenCalledWith(["permanent/one.png", "permanent/two.png"]);
        expect(sql).toContain("t.expires_at > now()");
    });

    it("counts Design documents with the file provider and filters expired generation tasks at the correct slot", async () => {
        mocks.getDatabaseProvider.mockReturnValue("file");
        mocks.countDesignStorageKeyReferences.mockResolvedValueOnce(new Map([["permanent/design.png", 1]]));
        mocks.readJsonDataFile.mockImplementation(async (name: string) => {
            if (name === "generation-tasks.json")
                return [
                    { id: "active", expiresAt: Date.now() + 60_000, payload: { storageKey: "permanent/task.png" } },
                    { id: "expired", expiresAt: Date.now() - 60_000, payload: { storageKey: "permanent/expired.png" } },
                ];
            return {};
        });

        const result = await countLocalMediaReferences(["permanent/design.png", "permanent/task.png", "permanent/expired.png"]);

        expect(result.get("permanent/design.png")).toBe(1);
        expect(result.get("permanent/task.png")).toBe(1);
        expect(result.get("permanent/expired.png")).toBe(0);
    });
});
