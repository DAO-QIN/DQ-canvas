import { describe, expect, it } from "vitest";

import { designImageMimeType } from "./design-image-input";

describe("Design image input", () => {
    it.each([
        ["image/png", "image/png"],
        ["IMAGE/JPEG; charset=binary", "image/jpeg"],
        ["image/jpg", "image/jpeg"],
        ["image/webp", "image/webp"],
    ])("normalizes %s", (input, expected) => expect(designImageMimeType(input)).toBe(expected));

    it.each(["image/gif", "image/svg+xml", "video/mp4", ""])('rejects unsupported media type "%s"', (input) => {
        expect(() => designImageMimeType(input)).toThrow("画板仅支持 PNG、JPEG 或 WebP 图片");
    });
});
