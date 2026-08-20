export type DesignHistorySource = "ui" | "agent" | "system";

/** Metadata for one undoable document transaction. Runtime task progress is intentionally excluded. */
export type DesignHistoryTransaction = {
    id: string;
    label: string;
    source: DesignHistorySource;
    baseRevision: number;
    resultRevision: number;
    operationIds: string[];
    createdAt: string;
};

export type DesignHistoryEntry = {
    transaction: DesignHistoryTransaction;
    beforeRevision: number;
    afterRevision: number;
};
