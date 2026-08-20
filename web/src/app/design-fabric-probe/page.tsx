import { notFound } from "next/navigation";

import { DesignFabricBrowserProbe } from "@/features/design-editor/fabric/design-fabric-browser-probe";

export default function DesignFabricProbePage() {
    if (process.env.DQ_DESIGN_FABRIC_PROBE_ENABLED !== "1") notFound();
    return <DesignFabricBrowserProbe />;
}
