// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceImageMaskEditDialog } from "./workspace-image-mask-edit-dialog";

vi.mock("antd", () => ({
    Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
    Input: { TextArea: (props: { placeholder?: string }) => <textarea aria-label={props.placeholder} /> },
    Modal: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div role="dialog">{children}</div> : null),
    Slider: () => <input aria-label="slider" type="range" />,
}));

vi.mock("lucide-react", () => ({
    Brush: () => null,
    Eraser: () => null,
    RotateCcw: () => null,
    WandSparkles: () => null,
    X: () => null,
}));

vi.mock("@/lib/media-image-url", () => ({ imagePreviewUrl: (value: string) => value }));

type FakeCanvasContext = CanvasRenderingContext2D & { painted: boolean };

const contexts = new WeakMap<HTMLCanvasElement, FakeCanvasContext>();
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
        configurable: true,
        value(this: HTMLCanvasElement) {
            const existing = contexts.get(this);
            if (existing) return existing;
            const context = {
                painted: false,
                beginPath: vi.fn(),
                arc: vi.fn(),
                moveTo: vi.fn(),
                lineTo: vi.fn(),
                save: vi.fn(),
                restore: vi.fn(),
                drawImage: vi.fn(),
                putImageData: vi.fn(),
                clearRect() {
                    context.painted = false;
                },
                fillRect: vi.fn(),
                fill() {
                    context.painted = true;
                },
                stroke() {
                    context.painted = true;
                },
                getImageData(_x: number, _y: number, width: number, height: number) {
                    const data = new Uint8ClampedArray(width * height * 4);
                    if (context.painted) data[3] = 255;
                    return { data, width, height, colorSpace: "srgb" };
                },
            } as unknown as FakeCanvasContext;
            contexts.set(this, context);
            return context;
        },
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "setPointerCapture", { configurable: true, value: vi.fn() });
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
});

describe("WorkspaceImageMaskEditDialog", () => {
    it("preserves a painted mask across a parent rerender with unchanged source dimensions", async () => {
        const props = {
            dataUrl: "data:image/png;base64,source",
            open: true,
            sourceDimensions: { width: 10, height: 6 },
            onClose: vi.fn(),
            onConfirm: vi.fn(),
        } as const;

        await act(async () => root.render(<WorkspaceImageMaskEditDialog {...props} />));
        const canvases = container.querySelectorAll("canvas");
        const mask = canvases[0];
        const preview = canvases[1];
        expect(mask).toBeInstanceOf(HTMLCanvasElement);
        expect(preview).toBeInstanceOf(HTMLCanvasElement);

        await act(async () => preview.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true })));
        expect(contexts.get(mask)?.painted).toBe(true);

        await act(async () => root.render(<WorkspaceImageMaskEditDialog {...props} />));

        expect(contexts.get(mask)?.painted).toBe(true);
    });
});
