import {
    assertWorkspaceActionAuthorized,
    defineWorkspaceActionReceipt,
    defineWorkspaceActionRequest,
    workspaceActionRequestFingerprint,
    workspaceActionRequiresConfirmation,
    type WorkspaceActionReceipt,
    type WorkspaceActionRequest,
} from "./agent-contract";
import { confirmWorkspaceAgentRunActions, rejectWorkspaceAgentRunActions, submitWorkspaceAgentRunReceipt, type WorkspaceAgentRunSummary } from "./workspace-agent-run-client";

export type WorkspaceAgentActionState =
    | Readonly<{ status: "idle" }>
    | Readonly<{ status: "pending-confirmation"; request: WorkspaceActionRequest; fingerprint: string }>
    | Readonly<{ status: "confirming" | "executing" | "submitting" | "rejecting"; request: WorkspaceActionRequest; fingerprint: string }>
    | Readonly<{ status: "applied"; request: WorkspaceActionRequest; fingerprint: string; receipt: WorkspaceActionReceipt; replayed: boolean; message?: string }>
    | Readonly<{ status: "rejected"; request: WorkspaceActionRequest; fingerprint: string; receipt?: WorkspaceActionReceipt; message?: string }>
    | Readonly<{ status: "conflict" | "error"; request: WorkspaceActionRequest; fingerprint: string; receipt?: WorkspaceActionReceipt; message: string; retryable: boolean }>;

export type WorkspaceAgentActionApi = Readonly<{
    confirm: typeof confirmWorkspaceAgentRunActions;
    reject: typeof rejectWorkspaceAgentRunActions;
    submitReceipt: typeof submitWorkspaceAgentRunReceipt;
}>;

export type WorkspaceAgentActionController = Readonly<{
    receive: (request: WorkspaceActionRequest) => Promise<void>;
    receiveReceipt: (request: WorkspaceActionRequest, receipt: WorkspaceActionReceipt, message?: string) => void;
    receiveRejected: (input: { batchId: string; fingerprint: string }, message?: string) => void;
    confirm: () => Promise<void>;
    reject: () => Promise<void>;
    retry: () => Promise<void>;
    getState: () => WorkspaceAgentActionState;
}>;

const defaultApi: WorkspaceAgentActionApi = {
    confirm: confirmWorkspaceAgentRunActions,
    reject: rejectWorkspaceAgentRunActions,
    submitReceipt: submitWorkspaceAgentRunReceipt,
};

export function createWorkspaceAgentActionController(input: {
    runId: string;
    execute: (request: WorkspaceActionRequest) => Promise<WorkspaceActionReceipt>;
    onStateChange: (state: WorkspaceAgentActionState) => void;
    onRunTransition?: (run: WorkspaceAgentRunSummary) => void;
    api?: WorkspaceAgentActionApi;
}): WorkspaceAgentActionController {
    const api = input.api || defaultApi;
    let state: WorkspaceAgentActionState = { status: "idle" };
    let operation: Promise<void> | null = null;
    const completedFingerprints = new Set<string>();
    const pendingReceipts = new Map<string, WorkspaceActionReceipt>();

    const update = (next: WorkspaceAgentActionState) => {
        state = next;
        input.onStateChange(next);
    };
    const submit = async (request: WorkspaceActionRequest, receipt: WorkspaceActionReceipt) => {
        const fingerprint = workspaceActionRequestFingerprint(request);
        update({ status: "submitting", request, fingerprint });
        const submitted = await api.submitReceipt(input.runId, receipt);
        input.onRunTransition?.(submitted.run);
        pendingReceipts.delete(fingerprint);
        completedFingerprints.add(fingerprint);
        applyReceiptState(request, submitted.run.workspaceActionReceipt || receipt, submitted.replayed);
    };
    const executeAndSubmit = async (requestValue: WorkspaceActionRequest) => {
        const request = defineWorkspaceActionRequest(requestValue);
        const fingerprint = workspaceActionRequestFingerprint(request);
        if (completedFingerprints.has(fingerprint)) return;
        if (workspaceActionRequiresConfirmation(request)) assertWorkspaceActionAuthorized(request);
        let receipt = pendingReceipts.get(fingerprint);
        if (!receipt) {
            update({ status: "executing", request, fingerprint });
            receipt = defineWorkspaceActionReceipt(request, await input.execute(request));
            pendingReceipts.set(fingerprint, receipt);
        }
        await submit(request, receipt);
    };
    const runExclusive = async (request: WorkspaceActionRequest, work: () => Promise<void>) => {
        if (operation) return operation;
        operation = work()
            .catch((error) => {
                const fingerprint = workspaceActionRequestFingerprint(request);
                update({ status: "error", request, fingerprint, receipt: pendingReceipts.get(fingerprint), message: errorMessage(error), retryable: isRetryable(error) });
            })
            .finally(() => {
                operation = null;
            });
        return operation;
    };
    const applyReceiptState = (requestValue: WorkspaceActionRequest, receiptValue: WorkspaceActionReceipt, replayed = false, message?: string) => {
        const request = defineWorkspaceActionRequest(requestValue);
        const receipt = defineWorkspaceActionReceipt(request, receiptValue);
        const fingerprint = workspaceActionRequestFingerprint(request);
        pendingReceipts.delete(fingerprint);
        completedFingerprints.add(fingerprint);
        if (receipt.status === "applied" || receipt.status === "replayed") {
            update({ status: "applied", request, fingerprint, receipt, replayed: replayed || receipt.status === "replayed", message });
            return;
        }
        if (receipt.status === "conflict") {
            update({ status: "conflict", request, fingerprint, receipt, message: receipt.error?.message || message || "工作区版本已变化", retryable: Boolean(receipt.error?.retryable) });
            return;
        }
        update({ status: "rejected", request, fingerprint, receipt, message: receipt.error?.message || message || "工作区操作未执行" });
    };

    return {
        receive: async (requestValue) => {
            const request = defineWorkspaceActionRequest(requestValue);
            const fingerprint = workspaceActionRequestFingerprint(request);
            if (completedFingerprints.has(fingerprint)) return;
            if (workspaceActionRequiresConfirmation(request) && !request.confirmation) {
                if (state.status !== "pending-confirmation" || state.fingerprint !== fingerprint) update({ status: "pending-confirmation", request, fingerprint });
                return;
            }
            return runExclusive(request, () => executeAndSubmit(request));
        },
        receiveReceipt: (request, receipt, message) => applyReceiptState(request, receipt, receipt.status === "replayed", message),
        receiveRejected: (rejection, message) => {
            if (state.status === "idle" || state.request.batchId !== rejection.batchId || state.fingerprint !== rejection.fingerprint) return;
            pendingReceipts.delete(rejection.fingerprint);
            completedFingerprints.add(rejection.fingerprint);
            update({ status: "rejected", request: state.request, fingerprint: state.fingerprint, message: message || "已拒绝这组工作区操作" });
        },
        confirm: async () => {
            if (state.status !== "pending-confirmation" && state.status !== "error") return;
            const request = state.request;
            const fingerprint = state.fingerprint;
            return runExclusive(request, async () => {
                update({ status: "confirming", request, fingerprint });
                const confirmed = await api.confirm(input.runId, fingerprint);
                input.onRunTransition?.(confirmed.run);
                await executeAndSubmit(assertWorkspaceActionAuthorized(confirmed.request));
            });
        },
        reject: async () => {
            if (state.status !== "pending-confirmation" && state.status !== "error") return;
            const request = state.request;
            const fingerprint = state.fingerprint;
            return runExclusive(request, async () => {
                update({ status: "rejecting", request, fingerprint });
                const rejected = await api.reject(input.runId, fingerprint);
                input.onRunTransition?.(rejected.run);
                completedFingerprints.add(fingerprint);
                update({ status: "rejected", request, fingerprint, message: "已拒绝这组工作区操作" });
            });
        },
        retry: async () => {
            if (state.status !== "error" || !state.retryable) return;
            const request = state.request;
            const fingerprint = state.fingerprint;
            return runExclusive(request, () => (request.confirmation ? executeAndSubmit(request) : Promise.resolve(update({ status: "pending-confirmation", request, fingerprint }))));
        },
        getState: () => state,
    };
}

function errorMessage(error: unknown) {
    return error instanceof Error && error.message ? error.message : "工作区操作失败";
}

function isRetryable(error: unknown) {
    const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
    return !status || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}
