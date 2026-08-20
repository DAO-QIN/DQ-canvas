import { afterEach, describe, expect, it, vi } from "vitest";

import { applyDesignOperations, createDesignProject, deleteDesignProject, DesignProjectRequestError, listDesignProjects } from "./design-projects";

afterEach(() => vi.unstubAllGlobals());

describe("design project API client", () => {
    it("normalizes the paged project response", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ code: 0, data: { projects: [{ id: "design-1" }], total: 1, page: 2, pageSize: 6 }, msg: "OK" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );
        vi.stubGlobal("fetch", fetchMock);

        await expect(listDesignProjects({ page: 2, pageSize: 6, status: "active" })).resolves.toMatchObject({ items: [{ id: "design-1" }], total: 1, page: 2, pageSize: 6 });
        expect(fetchMock).toHaveBeenCalledWith("/api/design/projects?page=2&pageSize=6&status=active", { cache: "no-store" });
    });

    it("sends only the supported create payload", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { project: { id: "design-new" } } }), { status: 201 }));
        vi.stubGlobal("fetch", fetchMock);

        await createDesignProject({ title: "商品主图", description: "秋季上新" });
        expect(fetchMock).toHaveBeenCalledWith("/api/design/projects", expect.objectContaining({ method: "POST", body: JSON.stringify({ title: "商品主图", description: "秋季上新" }) }));
    });

    it("carries the expected revision when deleting", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { deleted: true } }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(deleteDesignProject("design/a", 7)).resolves.toBe(true);
        expect(fetchMock).toHaveBeenCalledWith("/api/design/projects/design%2Fa", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ expectedRevision: 7 }) }));
    });

    it("posts a typed operation batch to the project operations route", async () => {
        const batch = { batchId: "batch-one", expectedRevision: 7, mode: "atomic" as const, source: "ui" as const, label: "调整视口", operations: [{ opId: "op-one", type: "update-workspace" as const, patch: { viewport: { x: 20, y: 30, zoom: 1.25 } } }] };
        const response = { project: { id: "design-one", revision: 8 }, receipt: { batchId: "batch-one", status: "applied" } };
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: response }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(applyDesignOperations("design/one", batch)).resolves.toMatchObject(response);
        expect(fetchMock).toHaveBeenCalledWith("/api/design/projects/design%2Fone/operations", expect.objectContaining({ method: "POST", body: JSON.stringify(batch) }));
    });

    it("accepts a replayed operation receipt", async () => {
        const batch = { batchId: "batch-retry", expectedRevision: 7, mode: "atomic" as const, source: "ui" as const, label: "重试视口", operations: [{ opId: "op-retry", type: "update-workspace" as const, patch: { viewport: { x: 1, y: 2, zoom: 1 } } }] };
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { project: { id: "design-one", revision: 8 }, receipt: { batchId: "batch-retry", status: "replayed", originalStatus: "applied" } } }), { status: 200 })),
        );

        await expect(applyDesignOperations("design-one", batch)).resolves.toMatchObject({ receipt: { status: "replayed", originalStatus: "applied" } });
    });

    it("preserves the 409 conflict status and service message", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 409, data: null, msg: "revision 冲突" }), { status: 409 })));

        const error = await deleteDesignProject("design-1", 2).catch((reason: unknown) => reason);
        expect(error).toBeInstanceOf(DesignProjectRequestError);
        expect(error).toMatchObject({ status: 409, message: "revision 冲突" });
    });
});
