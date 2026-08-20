import type { DesignAssetVersion } from "@/lib/design";

export function designImageMimeType(value: string): DesignAssetVersion["mimeType"] {
    const mimeType = value.split(";", 1)[0]?.trim().toLowerCase();
    if (mimeType === "image/jpg") return "image/jpeg";
    if (mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/webp") return mimeType;
    throw new Error("画板仅支持 PNG、JPEG 或 WebP 图片");
}
