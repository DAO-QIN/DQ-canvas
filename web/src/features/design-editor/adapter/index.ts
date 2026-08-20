export {
    DESIGN_WORKSPACE_COMMAND_IDS,
    DESIGN_WORKSPACE_EXTENSION_CAPABILITIES,
    DESIGN_WORKSPACE_SURFACE_ID,
    createDesignWorkspaceAdapterFromStore,
    createDesignWorkspaceClientAdapter,
    createDesignWorkspaceSurfaceDescriptor,
    designSaveCanFlush,
    designWorkspaceCommandAvailability,
    type DesignWorkspaceClientAdapter,
    type DesignWorkspaceCommandAvailability,
    type DesignWorkspaceCommandId,
} from "./design-workspace-client-adapter";
export { createDesignWorkspaceSnapshot, designReceiptToWorkspaceReceipt, designWorkspaceActionsToBatch, executeDesignWorkspaceActions, type DesignWorkspaceAgentCommit, type DesignWorkspaceAgentCommitter } from "./design-workspace-agent-adapter";
