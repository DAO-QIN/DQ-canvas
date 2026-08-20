import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/app/(user)/canvas/types";

export type CanvasProject = {
    id: string;
    /** Monotonic server revision. Legacy projects may omit it and are treated as revision 0. */
    revision?: number;
    sourceHandoffId?: string;
    creativeConversationId?: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

export type CanvasProjectMediaPreview = {
    kind: "image" | "video";
    url: string;
};

export type CanvasProjectSummary = Pick<CanvasProject, "id" | "sourceHandoffId" | "creativeConversationId" | "title" | "createdAt" | "updatedAt"> & {
    revision: number;
    nodeCount: number;
    connectionCount: number;
    preview?: CanvasProjectMediaPreview;
};

export type CanvasProjectSummaryPage = {
    items: CanvasProjectSummary[];
    total: number;
    page: number;
    pageSize: number;
};

export type CreateCanvasProjectInput = {
    title?: string;
    sourceHandoffId?: string;
    project?: Partial<CanvasProject>;
};
