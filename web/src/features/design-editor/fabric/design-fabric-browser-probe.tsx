"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import type { DesignDocument, DesignElement } from "@/lib/design";

import type { DesignEditorSelection } from "../model/design-editor-commands";
import type { DesignFabricAdapter } from "./design-fabric-adapter";
import { DesignFabricSurface } from "./design-fabric-surface";

const NOW = "2026-08-12T00:00:00.000Z";

export function DesignFabricBrowserProbe() {
    const [document, setDocument] = useState(() => browserProbeDocument());
    const [selection, setSelection] = useState<DesignEditorSelection>({ kind: "elements", ids: ["text-one", "image-one"] });
    const [lastIntent, setLastIntent] = useState("none");
    const documentRef = useRef(document);
    const selectionRef = useRef(selection);
    documentRef.current = document;
    selectionRef.current = selection;
    const documentJson = useMemo(() => JSON.stringify(document), [document]);

    const update = useCallback((mutation: (next: DesignDocument) => void) => {
        setDocument((current) => {
            const next = structuredClone(current);
            next.revision += 1;
            next.metadata.updatedAt = new Date(Date.parse(NOW) + next.revision).toISOString();
            mutation(next);
            return next;
        });
    }, []);

    const handleReady = useCallback((adapter: DesignFabricAdapter | null) => {
        if (adapter) window.__dqDesignFabricProbe?.project(documentRef.current, selectionRef.current);
    }, []);

    return (
        <main data-testid="design-fabric-browser-probe" style={{ display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", width: "100vw", height: "100vh", background: "#eef1f5" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 12, background: "#fff", borderBottom: "1px solid #d8dde7" }}>
                <button type="button" onClick={() => update(updateRichElements)}>
                    Update rich elements
                </button>
                <button type="button" onClick={() => update((next) => updateArrowTopology(next))}>
                    Change arrow topology
                </button>
                <button type="button" onClick={() => update(reorderWorkspaceElements)}>
                    Reorder workspace
                </button>
                <button type="button" onClick={() => update(moveTextAcrossFrame)}>
                    Move text across frame
                </button>
                <button type="button" onClick={() => setSelection({ kind: "elements", ids: ["text-one", "image-one"] })}>
                    Select same frame
                </button>
                <button type="button" onClick={() => setSelection({ kind: "elements", ids: ["text-one", "frame-two-shape"] })}>
                    Select cross frame
                </button>
                <button type="button" onClick={() => window.__dqDesignFabricProbe?.moveSelection(35, 20)}>
                    Move active selection
                </button>
                <span data-testid="probe-last-intent">{lastIntent}</span>
                <pre data-testid="probe-document" style={{ display: "none" }}>
                    {documentJson}
                </pre>
            </div>
            <section style={{ position: "relative", minHeight: 0 }}>
                <DesignFabricSurface document={document} selection={selection} onReady={handleReady} onViewportCommit={() => undefined} onSelectionChange={setSelection} onTransformCommit={(intent) => setLastIntent(JSON.stringify(intent))} />
            </section>
        </main>
    );
}

function browserProbeDocument(): DesignDocument {
    const elements: DesignElement[] = [
        text("text-one", "frame-one", 40, 40),
        image("image-one", "frame-one", 300, 40),
        line("line-one", "frame-one", 40, 240),
        arrow("arrow-one", "frame-one", 360, 230),
        shape("frame-two-shape", "frame-two", 60, 80),
        ...Array.from({ length: 200 }, (_, index) => shape(`perf-${index}`, null, 40 + (index % 20) * 42, 720 + Math.floor(index / 20) * 42, 32, 32)),
    ];
    return {
        schemaVersion: 1,
        id: "design-fabric-browser-probe",
        revision: 0,
        metadata: { title: "Fabric browser probe", description: "", createdAt: NOW, updatedAt: NOW },
        workspace: { background: "#dfe4ec", viewport: { x: 60, y: 40, zoom: 0.7 } },
        guides: [],
        frames: [
            { id: "frame-one", name: "Frame one", x: 100, y: 100, width: 720, height: 480, background: "#ffffff", locked: false, export: { format: "png", scale: 1, quality: 1, background: "frame" } },
            { id: "frame-two", name: "Frame two", x: 900, y: 100, width: 480, height: 480, background: "#f8fafc", locked: false, export: { format: "png", scale: 1, quality: 1, background: "frame" } },
        ],
        assets: [],
        assetVersions: [],
        elements,
        layers: [
            { scope: "workspace", elementIds: elements.filter((element) => element.frameId === null).map((element) => element.id) },
            { scope: "frame", frameId: "frame-one", elementIds: ["text-one", "image-one", "line-one", "arrow-one"] },
            { scope: "frame", frameId: "frame-two", elementIds: ["frame-two-shape"] },
        ],
        annotations: [],
    };
}

function updateRichElements(document: DesignDocument) {
    const textElement = document.elements.find((element) => element.id === "text-one");
    if (textElement?.kind === "text") Object.assign(textElement, { text: "Updated text", fontSize: 32, fill: "#dc2626", lineHeight: 1.4, letterSpacing: 2 });
    const imageElement = document.elements.find((element) => element.id === "image-one");
    if (imageElement?.kind === "image") {
        imageElement.transform = { ...imageElement.transform, width: 300, height: 180 };
        imageElement.cornerRadius = 24;
    }
    const lineElement = document.elements.find((element) => element.id === "line-one");
    if (lineElement?.kind === "line") Object.assign(lineElement, { stroke: "#2563eb", strokeWidth: 8, dash: [10, 4], cap: "square" });
    const arrowElement = document.elements.find((element) => element.id === "arrow-one");
    if (arrowElement?.kind === "arrow") Object.assign(arrowElement, { stroke: "#16a34a", strokeWidth: 9, dash: [4, 2] });
}

function updateArrowTopology(document: DesignDocument) {
    const element = document.elements.find((candidate) => candidate.id === "arrow-one");
    if (element?.kind === "arrow") element.startHead = element.startHead === "none" ? "circle" : "none";
}

function reorderWorkspaceElements(document: DesignDocument) {
    const layer = document.layers.find((candidate) => candidate.scope === "workspace");
    if (layer) layer.elementIds.reverse();
}

function moveTextAcrossFrame(document: DesignDocument) {
    const element = document.elements.find((candidate) => candidate.id === "text-one");
    if (!element) return;
    const source = document.layers.find((candidate) => candidate.scope === "frame" && candidate.frameId === element.frameId);
    const target = document.layers.find((candidate) => candidate.scope === "frame" && candidate.frameId === "frame-two");
    if (!source || !target || source.scope !== "frame" || target.scope !== "frame") return;
    source.elementIds = source.elementIds.filter((id) => id !== element.id);
    target.elementIds.push(element.id);
    element.frameId = "frame-two";
    element.transform = { ...element.transform, x: 80, y: 260 };
}

function base(id: string, frameId: string | null, x: number, y: number, width: number, height: number) {
    return { id, frameId, name: id, transform: { x, y, width, height, rotation: 0, flipX: false, flipY: false }, opacity: 1, blendMode: "normal" as const, locked: false, hidden: false };
}

function text(id: string, frameId: string, x: number, y: number): DesignElement {
    return {
        ...base(id, frameId, x, y, 220, 100),
        kind: "text",
        text: "Initial text",
        fontFamily: "Arial",
        fontSize: 24,
        fontWeight: 700,
        fontStyle: "normal",
        lineHeight: 1.2,
        letterSpacing: 0,
        align: "center",
        verticalAlign: "middle",
        fill: "#111827",
        stroke: null,
        strokeWidth: 0,
    };
}

function image(id: string, frameId: string, x: number, y: number): DesignElement {
    return { ...base(id, frameId, x, y, 240, 150), kind: "image", assetVersionId: "probe-image", crop: null, fit: "contain", cornerRadius: 6 };
}

function line(id: string, frameId: string, x: number, y: number): DesignElement {
    return { ...base(id, frameId, x, y, 260, 20), kind: "line", stroke: "#334155", strokeWidth: 4, dash: [], cap: "round" };
}

function arrow(id: string, frameId: string, x: number, y: number): DesignElement {
    return { ...base(id, frameId, x, y, 260, 140), kind: "arrow", stroke: "#0f172a", strokeWidth: 5, dash: [], startHead: "none", endHead: "arrow" };
}

function shape(id: string, frameId: string | null, x: number, y: number, width = 160, height = 120): DesignElement {
    return { ...base(id, frameId, x, y, width, height), kind: "shape", shape: "rectangle", fill: "#dbeafe", stroke: "#60a5fa", strokeWidth: 1, cornerRadius: 4 };
}
