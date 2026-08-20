"use client";

import { useEffect, useRef } from "react";
import { Canvas } from "fabric";

import type { DesignPocAdapter } from "../contract/types";
import { FabricPocAdapter } from "./fabric-poc-adapter";

export function FabricPocSurface({ onReady }: { onReady: (adapter: DesignPocAdapter | null, owner: DesignPocAdapter) => void }) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const element = canvasRef.current;
        if (!element) return;
        const canvas = new Canvas(element, {
            width: Math.max(860, element.parentElement?.clientWidth || 0),
            height: Math.max(540, element.parentElement?.clientHeight || 0),
            backgroundColor: "#d9dee7",
            preserveObjectStacking: true,
            selection: true,
            renderOnAddRemove: false,
        });
        const adapter = new FabricPocAdapter(canvas);
        onReady(adapter, adapter);
        return () => {
            onReady(null, adapter);
            void adapter.destroy();
        };
    }, [onReady]);

    return (
        <div className="h-full min-h-[540px] w-full overflow-hidden" data-testid="fabric-poc-surface">
            <canvas ref={canvasRef} />
        </div>
    );
}
