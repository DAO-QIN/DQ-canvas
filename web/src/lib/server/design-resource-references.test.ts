import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDesignDocumentFixture } from "@/lib/design/design.test-fixture";

const mocks = vi.hoisted(() => ({ provider: "file" as "file" | "postgres", readJsonDataFile: vi.fn(), postgresQuery: vi.fn(), ensurePostgresSchema: vi.fn() }));

vi.mock("@/lib/server/database", () => ({
    ensurePostgresSchema: mocks.ensurePostgresSchema,
    getDatabaseProvider: vi.fn(() => mocks.provider),
    postgresQuery: mocks.postgresQuery,
}));
vi.mock("@/lib/server/data-adapter", () => ({ readJsonDataFile: mocks.readJsonDataFile }));

import { collectDesignDocumentResourceReferences, countDesignStorageKeyReferences, findDesignLibraryAssetReferences } from "./design-resource-references";

describe("Design resource references", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.provider = "file";
        mocks.readJsonDataFile.mockResolvedValue({ version: 1, projects: [], versions: [], receipts: [] });
    });

    it("links stable locators to direct versions and indirect image elements", () => {
        const references = collectDesignDocumentResourceReferences(createDesignDocumentFixture());

        expect(references).toContainEqual({
            locator: { kind: "library-asset", libraryAssetId: "library-product-cutout" },
            assetVersionIds: ["asset-product-v2"],
            elementIds: ["element-product"],
        });
        expect(references).toContainEqual({
            locator: { kind: "storage-key", storageKey: "users/user-one/design/product-original.png" },
            assetVersionIds: ["asset-product-v1"],
            elementIds: ["element-social-product"],
        });
    });

    it("counts current and historical file entities once and keeps users isolated", async () => {
        const current = createDesignDocumentFixture();
        const history = structuredClone(current);
        history.revision = 5;
        const other = structuredClone(current);
        mocks.readJsonDataFile.mockResolvedValue({
            version: 1,
            projects: [
                { userId: "user-one", project: { id: current.id, title: "当前", revision: current.revision, document: current } },
                { userId: "user-two", project: { id: other.id, title: "其他", revision: other.revision, document: other } },
            ],
            versions: [{ userId: "user-one", id: "version-one", projectId: current.id, version: 1, snapshotRevision: 5, snapshot: history }],
            receipts: [],
        });

        const references = await findDesignLibraryAssetReferences("user-one", "library-product-cutout");
        const storageCounts = await countDesignStorageKeyReferences(["users/user-one/design/product-original.png"]);

        expect(references).toEqual([
            expect.objectContaining({ entityType: "project", entityId: current.id, elementIds: ["element-product"] }),
            expect.objectContaining({ entityType: "version", entityId: "version-one", version: 1, elementIds: ["element-product"] }),
        ]);
        expect(storageCounts.get("users/user-one/design/product-original.png")).toBe(3);
    });

    it("uses exact structured JSONB locators for PostgreSQL current and historical entities", async () => {
        mocks.provider = "postgres";
        mocks.postgresQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ storage_key: "permanent/source.png", total: "2" }] });

        await findDesignLibraryAssetReferences("user-one", "asset-one");
        const counts = await countDesignStorageKeyReferences(["permanent/source.png"]);

        const librarySql = String(mocks.postgresQuery.mock.calls[0]?.[0]);
        expect(librarySql).toContain("design_project_versions");
        expect(librarySql).toContain("asset_version->'locator'->>'libraryAssetId' = $2");
        const storageSql = String(mocks.postgresQuery.mock.calls[1]?.[0]);
        expect(storageSql).toContain("asset_version->'locator'->>'storageKey' = r.storage_key");
        expect(counts.get("permanent/source.png")).toBe(2);
    });
});
