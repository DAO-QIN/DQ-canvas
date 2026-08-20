import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    blobToDataUrl: vi.fn(),
    getServerMediaBlob: vi.fn(),
    readImageMeta: vi.fn(),
    uploadServerMedia: vi.fn(),
}));

vi.mock("@/lib/image-utils", () => ({ readImageMeta: mocks.readImageMeta }));
vi.mock("@/services/server-media-storage", () => ({
    blobToDataUrl: mocks.blobToDataUrl,
    getServerMediaBlob: mocks.getServerMediaBlob,
    serverMediaUrl: vi.fn((storageKey?: string, fallback = "") => fallback || storageKey || ""),
    uploadServerMedia: mocks.uploadServerMedia,
}));

import { uploadImage } from "./image-storage";

describe("image storage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.uploadServerMedia.mockResolvedValue({
            url: "/api/reference-assets/permanent/2026/08/14/images/source.png?format=webp&width=1600",
            storageKey: "permanent/2026/08/14/images/source.png",
            bytes: 42,
            mimeType: "image/png",
        });
        mocks.blobToDataUrl.mockResolvedValue("data:image/png;base64,b3JpZ2luYWw=");
        mocks.readImageMeta.mockResolvedValue({ width: 2335, height: 1270, mimeType: "image/png" });
    });

    it("reads authoritative dimensions from the original upload blob instead of its preview URL", async () => {
        const input = new Blob(["image"], { type: "image/png" });
        const uploaded = await uploadImage(input);

        expect(mocks.blobToDataUrl).toHaveBeenCalledWith(input);
        expect(mocks.readImageMeta).toHaveBeenCalledWith("data:image/png;base64,b3JpZ2luYWw=");
        expect(mocks.getServerMediaBlob).not.toHaveBeenCalled();
        expect(uploaded).toMatchObject({ width: 2335, height: 1270, serverUrl: "/api/reference-assets/permanent/2026/08/14/images/source.png?format=webp&width=1600" });
    });

    it("fetches original bytes when an existing managed URL is reused", async () => {
        const original = new Blob(["original"], { type: "image/png" });
        mocks.getServerMediaBlob.mockResolvedValue(original);

        await uploadImage("/api/reference-assets/permanent/2026/08/14/images/source.png?format=webp&width=1600");

        expect(mocks.getServerMediaBlob).toHaveBeenCalledWith("permanent/2026/08/14/images/source.png", "/api/reference-assets/permanent/2026/08/14/images/source.png?format=webp&width=1600");
        expect(mocks.blobToDataUrl).toHaveBeenCalledWith(original);
        expect(mocks.readImageMeta).toHaveBeenCalledWith("data:image/png;base64,b3JpZ2luYWw=");
    });
});
