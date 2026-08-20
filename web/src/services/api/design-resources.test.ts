import { afterEach, describe, expect, it, vi } from "vitest";

import { DesignResourceRequestError, resolveDesignResource } from "./design-resources";

afterEach(() => vi.unstubAllGlobals());

describe("design resource API client", () => {
    it("posts a stable locator and purpose without caching the resolution", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    code: 0,
                    data: { url: "/api/reference-assets/permanent/image.png", cacheKey: "library-asset:asset-one", expiresAt: null },
                    msg: "OK",
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
            ),
        );
        vi.stubGlobal("fetch", fetchMock);
        const locator = { kind: "library-asset" as const, libraryAssetId: "asset-one" };

        await expect(resolveDesignResource(locator, { purpose: "editor" })).resolves.toEqual({
            url: "/api/reference-assets/permanent/image.png",
            cacheKey: "library-asset:asset-one",
            expiresAt: null,
        });
        expect(fetchMock).toHaveBeenCalledWith("/api/design/resources/resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ locator, purpose: "editor" }),
            cache: "no-store",
        });
    });

    it("returns only the runtime resource contract", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        code: 0,
                        data: {
                            url: "/api/generation-log-assets/permanent/image.png",
                            cacheKey: "storage-key:permanent/image.png",
                            expiresAt: null,
                            storageKey: "permanent/image.png",
                            document: { id: "must-not-leak" },
                        },
                    }),
                    { status: 200 },
                ),
            ),
        );

        const result = await resolveDesignResource({ kind: "storage-key", storageKey: "permanent/image.png" }, { purpose: "export" });

        expect(result).toEqual({ url: "/api/generation-log-assets/permanent/image.png", cacheKey: "storage-key:permanent/image.png", expiresAt: null });
        expect(Object.keys(result).sort()).toEqual(["cacheKey", "expiresAt", "url"]);
    });

    it("throws a status-aware request error for non-2xx responses", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 404, data: null, msg: "画板图片资源不存在或无权访问" }), { status: 404 })));

        const error = await resolveDesignResource({ kind: "library-asset", libraryAssetId: "asset-one" }, { purpose: "thumbnail" }).catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(DesignResourceRequestError);
        expect(error).toMatchObject({ status: 404, message: "画板图片资源不存在或无权访问" });
    });

    it("rejects malformed success payloads", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { url: "", cacheKey: "key", expiresAt: null } }), { status: 200 })));

        const error = await resolveDesignResource({ kind: "storage-key", storageKey: "permanent/image.png" }, { purpose: "editor" }).catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(DesignResourceRequestError);
        expect(error).toMatchObject({ status: 200, message: "画板资源响应无效" });
    });
});
