import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDesignDocumentFixture } from "@/lib/design/design.test-fixture";
import type { DesignProject } from "@/lib/design";

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    createVersion: vi.fn(),
}));

vi.mock("@/lib/server/design-project-store", () => ({
    DesignProjectStoreError: class DesignProjectStoreError extends Error {},
    applyDesignProjectOperationBatch: vi.fn(),
    createCurrentDesignProjectVersion: mocks.createVersion,
    createDesignProject: mocks.create,
    deleteDesignProject: vi.fn(),
    getDesignProject: mocks.get,
    listDesignProjectSummaries: vi.fn(),
    listDesignProjectVersions: vi.fn(),
    restoreDesignProjectVersion: vi.fn(),
    updateDesignProject: mocks.update,
}));

import { createDesignProjectForUser, createDesignProjectVersionForUser, designProjectError, getDesignProjectForUser, updateDesignProjectForUser } from "./design-project-service";

const NOW = "2026-08-11T10:00:00.000Z";

describe("design project service validation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.create.mockImplementation(async (_userId: string, project: DesignProject) => project);
        mocks.update.mockImplementation(async (_userId: string, project: DesignProject) => project);
        mocks.createVersion.mockResolvedValue({ id: "version-one", projectId: "design-one", version: 1, snapshotRevision: 0, reason: "手动保存版本", createdAt: NOW });
    });

    it("assigns a server project id and resets imported timestamps", async () => {
        const document = createDesignDocumentFixture();
        document.revision = 0;
        const result = await createDesignProjectForUser("user-one", { title: "导入画板", document });

        expect(result.id).toMatch(/^design-/);
        expect(result.id).not.toBe(document.id);
        expect(result.document.id).toBe(result.id);
        expect(result.createdAt).not.toBe(document.metadata.createdAt);
    });

    it("rejects future schema fields and maps size failures to 413", async () => {
        const document = createDesignDocumentFixture() as unknown as Record<string, unknown>;
        document.revision = 0;
        document.unknownState = true;
        const error = await createDesignProjectForUser("user-one", { document }).catch((caught) => caught);
        expect(designProjectError(error)).toMatchObject({ status: 400, details: [{ code: "UNKNOWN_FIELD" }] });

        const oversized = createDesignDocumentFixture();
        oversized.revision = 0;
        oversized.metadata.description = "x".repeat(10 * 1024 * 1024 + 1);
        const sizeError = await createDesignProjectForUser("user-one", { document: oversized }).catch((caught) => caught);
        expect(designProjectError(sizeError)).toMatchObject({ status: 413 });
    });

    it("fails closed when a stored document does not match its project index", async () => {
        const project = makeProject(3);
        mocks.get.mockResolvedValue({ ...project, revision: 4 });
        await expect(getDesignProjectForUser("user-one", project.id)).rejects.toThrow("索引字段与文档不一致");
    });

    it("preserves immutable id/createdAt and requires a forward revision", async () => {
        const project = makeProject(3);
        mocks.get.mockResolvedValue(project);

        const wrongId = structuredClone(project.document);
        wrongId.id = "design-other";
        wrongId.revision = 4;
        await expect(updateDesignProjectForUser("user-one", project.id, { expectedRevision: 3, document: wrongId })).rejects.toMatchObject({ status: 400 });

        const sameRevision = structuredClone(project.document);
        await expect(updateDesignProjectForUser("user-one", project.id, { expectedRevision: 3, document: sameRevision })).rejects.toMatchObject({ status: 400 });
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it("validates the stored document before snapshotting the current revision", async () => {
        const project = makeProject(0);
        mocks.get.mockResolvedValue({ ...project, revision: 1 });
        await expect(createDesignProjectVersionForUser("user-one", project.id, { expectedRevision: 1 })).rejects.toThrow("索引字段与文档不一致");
        expect(mocks.createVersion).not.toHaveBeenCalled();
    });
});

function makeProject(revision: number): DesignProject {
    const document = createDesignDocumentFixture();
    document.revision = revision;
    document.metadata.createdAt = NOW;
    document.metadata.updatedAt = NOW;
    return { id: document.id, title: document.metadata.title, status: "active", revision, document, createdAt: NOW, updatedAt: NOW };
}
