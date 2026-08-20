"use client";

import { Canvas } from "fabric";
import { useEffect, useRef } from "react";

import type { DesignDocument, DesignViewport } from "@/lib/design";
import { resolveDesignResource } from "@/services/api/design-resources";

import type { DesignEditorSelection } from "../model/design-editor-commands";
import { DesignFabricAdapter, type DesignFabricDiagnostics, type DesignFabricTransformIntent } from "./design-fabric-adapter";

declare global {
    interface Window {
        __dqDesignFabricProbe?: {
            project: (document: DesignDocument, selection?: DesignEditorSelection) => void;
            setSelection: (selection: DesignEditorSelection) => void;
            moveSelection: (deltaX: number, deltaY: number) => void;
            diagnostics: () => DesignFabricDiagnostics;
        };
    }
}

function designFabricProbeEnabled() {
    return process.env.NEXT_PUBLIC_DQ_DESIGN_FABRIC_PROBE_ENABLED === "1";
}

export function DesignFabricSurface({
    document,
    selection,
    onReady,
    onViewportCommit,
    onSelectionChange,
    onTransformCommit,
}: {
    document: DesignDocument;
    selection: DesignEditorSelection;
    onReady: (adapter: DesignFabricAdapter | null) => void;
    onViewportCommit: (viewport: DesignViewport) => void;
    onSelectionChange: (selection: DesignEditorSelection) => void;
    onTransformCommit: (intent: DesignFabricTransformIntent) => void;
}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const adapterRef = useRef<DesignFabricAdapter | null>(null);
    const commitRef = useRef(onViewportCommit);
    commitRef.current = onViewportCommit;
    const selectionRef = useRef(onSelectionChange);
    selectionRef.current = onSelectionChange;
    const transformRef = useRef(onTransformCommit);
    transformRef.current = onTransformCommit;
    const selectionValueRef = useRef(selection);
    selectionValueRef.current = selection;

    useEffect(() => {
        const element = canvasRef.current;
        const container = element?.parentElement;
        if (!element || !container) return;
        const canvas = new Canvas(element, { selection: true, selectionKey: "shiftKey", renderOnAddRemove: false, preserveObjectStacking: true, stopContextMenu: true });
        const adapter = new DesignFabricAdapter(
            canvas,
            {
                onViewportCommit: (viewport) => commitRef.current(viewport),
                onSelectionChange: (next) => selectionRef.current(next),
                onTransformCommit: (intent) => transformRef.current(intent),
            },
            { resolveResource: resolveDesignResource },
        );
        adapterRef.current = adapter;
        const resize = () => adapter.resize(container.clientWidth, container.clientHeight);
        const observer = new ResizeObserver(resize);
        observer.observe(container);
        resize();
        if (designFabricProbeEnabled()) {
            window.__dqDesignFabricProbe = {
                project: (document, selection = selectionValueRef.current) => adapter.project(document, selection),
                setSelection: (selection) => adapter.setSelection(selection),
                moveSelection: (deltaX, deltaY) => adapter.moveSelectionForDiagnostics(deltaX, deltaY),
                diagnostics: () => adapter.getDiagnostics(),
            };
        }
        onReady(adapter);
        return () => {
            observer.disconnect();
            onReady(null);
            delete window.__dqDesignFabricProbe;
            adapterRef.current = null;
            adapter.destroy();
        };
    }, [onReady]);

    useEffect(() => {
        adapterRef.current?.project(document, selectionValueRef.current);
    }, [document]);

    useEffect(() => {
        adapterRef.current?.setSelection(selection);
    }, [selection]);

    return (
        <div className="absolute inset-0 overflow-hidden" data-testid="design-fabric-surface">
            <canvas ref={canvasRef} />
        </div>
    );
}
