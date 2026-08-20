import type { DesignDocument } from "./schema";

export type DesignProjectStatus = "active" | "archived";

export type DesignProject = {
    id: string;
    title: string;
    status: DesignProjectStatus;
    revision: number;
    document: DesignDocument;
    createdAt: string;
    updatedAt: string;
};

export type DesignProjectSummary = Omit<DesignProject, "document"> & {
    frameCount: number;
    elementCount: number;
    assetCount: number;
};

export type DesignProjectSummaryPage = {
    items: DesignProjectSummary[];
    total: number;
    page: number;
    pageSize: number;
};

export type DesignProjectVersion = {
    id: string;
    projectId: string;
    version: number;
    snapshotRevision: number;
    reason: string;
    createdAt: string;
};
