"use client";

import { useRef } from "react";
import { Tldraw, type Editor } from "tldraw";

import type { DesignPocAdapter } from "../contract/types";
import { TldrawPocAdapter } from "./tldraw-poc-adapter";

export function TldrawPocSurface({ onReady }: { onReady: (adapter: DesignPocAdapter | null, owner: DesignPocAdapter) => void }) {
    const editorRef = useRef<Editor | null>(null);

    return (
        <div className="h-full min-h-[540px] w-full" data-testid="tldraw-poc-surface">
            <Tldraw
                hideUi
                licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY || undefined}
                onMount={(editor) => {
                    editorRef.current = editor;
                    const adapter = new TldrawPocAdapter(editor);
                    onReady(adapter, adapter);
                    return () => {
                        adapter.destroy();
                        if (editorRef.current === editor) editorRef.current = null;
                        onReady(null, adapter);
                    };
                }}
            />
        </div>
    );
}
