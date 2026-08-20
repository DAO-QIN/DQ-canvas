import type { BackgroundRemovalOptionsV1 } from "@/lib/background-removal-options";
import type { BackgroundRemovalProgressStage } from "@/lib/background-removal-progress";
import type { SurfaceBinding } from "@/lib/creative-workspace/surface-binding";

/**
 * Public task shape shared by workspace surfaces and the generation API.
 * Provider-specific records stay behind the server/API boundary.
 */
export type CreativeWorkspaceGenerationTaskStatus = "queued" | "running" | "paused" | "succeeded" | "failed" | "cancelled";

export type CreativeWorkspaceGenerationTask = {
    id: string;
    type: string;
    status: CreativeWorkspaceGenerationTaskStatus;
    progress?: number;
    stage?: string;
    prompt?: string;
    model?: string;
    kind?: "generation" | "edit";
    provider?: "openai" | "seedance" | "generation";
    pollPath?: string;
    serverTaskId?: string;
    durationSeconds?: number;
    sourceStorageKey?: string;
    options?: BackgroundRemovalOptionsV1;
    optionsHash?: string;
    progressStage?: BackgroundRemovalProgressStage;
    projectId?: string;
    sourceNodeId?: string;
    sourceIdentity?: string;
    sourceElementId?: string;
    sourceAssetVersionId?: string;
    /** The canvas node that receives this task's result. */
    targetNodeId?: string;
    clientRequestId?: string;
    attemptNo?: number;
    quality?: string;
    size?: string;
    binding?: SurfaceBinding;
    imageResult?: {
        storageKey: string;
        mimeType: "image/png" | "image/jpeg" | "image/webp";
        width: number;
        height: number;
        bytes?: number;
    };
    executionPhase?: string;
    lastUpstreamStatus?: string;
    error?: string;
    billing?: { pointsCost: number; refunded?: boolean };
    createdAt: number;
    updatedAt: number;
};

export type CanvasGenerationTask = CreativeWorkspaceGenerationTask;
