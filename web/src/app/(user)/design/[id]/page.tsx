"use client";

import { useParams } from "next/navigation";

import { DesignEditorWorkbench } from "@/features/design-editor/components/design-editor-workbench";

export default function DesignEditorPage() {
    const params = useParams<{ id: string }>();
    return <DesignEditorWorkbench projectId={String(params.id || "")} />;
}
