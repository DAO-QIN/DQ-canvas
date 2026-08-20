import { notFound } from "next/navigation";

import { DesignEnginePocWorkbench } from "@/features/design-engine-poc/components/design-engine-poc-workbench";

export default function DesignEnginePocPage() {
    if (process.env.DQ_DESIGN_POC_ENABLED !== "1") notFound();
    return <DesignEnginePocWorkbench />;
}
