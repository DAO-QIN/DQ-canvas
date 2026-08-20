import { parseSurfaceBinding, surfaceBindingKey, type SurfaceBinding } from "./surface-binding";

export const RESULT_SUBMISSION_STATUSES = ["pending", "applied", "partial", "rejected", "replayed", "conflict"] as const;
export type ResultSubmissionStatus = (typeof RESULT_SUBMISSION_STATUSES)[number];

export type ResultSubmissionIdentity = Readonly<{
    taskId: string;
    receiptId: string;
    batchId: string;
    fingerprint: string;
}>;

export type ResultSubmissionRequest = Readonly<
    ResultSubmissionIdentity & {
        binding: SurfaceBinding;
    }
>;

export type ResultSubmissionError = Readonly<{
    code: string;
    message: string;
    retryable: boolean;
}>;

export type ResultSubmissionReceipt = Readonly<
    ResultSubmissionRequest & {
        status: ResultSubmissionStatus;
        affectedIds: readonly string[];
        error?: ResultSubmissionError;
    }
>;

export type ResultSubmissionAdapter = (request: ResultSubmissionRequest) => Promise<ResultSubmissionReceipt>;

export class ResultSubmissionContractError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ResultSubmissionContractError";
    }
}

export type ResultSubmissionCoordinator = Readonly<{
    submit: (request: ResultSubmissionRequest, adapter: ResultSubmissionAdapter) => Promise<ResultSubmissionReceipt>;
}>;

export function createResultSubmissionCoordinator(): ResultSubmissionCoordinator {
    const inFlight = new Map<string, { fingerprint: string; promise: Promise<ResultSubmissionReceipt> }>();

    return Object.freeze({
        submit(request: ResultSubmissionRequest, adapter: ResultSubmissionAdapter) {
            const normalized = normalizeRequest(request);
            const key = submissionIdentityKey(normalized);
            const active = inFlight.get(key);
            if (active) {
                if (active.fingerprint === normalized.fingerprint) return active.promise;
                return Promise.resolve(conflictReceipt(normalized, "SUBMISSION_IDENTITY_CONFLICT", "相同提交标识对应了不同结果"));
            }

            const promise = Promise.resolve()
                .then(() => adapter(normalized))
                .then((receipt) => validateReceipt(normalized, receipt))
                .finally(() => {
                    if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
                });
            inFlight.set(key, { fingerprint: normalized.fingerprint, promise });
            return promise;
        },
    });
}

export function submissionIdentityKey(identity: Pick<ResultSubmissionRequest, "taskId" | "receiptId" | "batchId" | "binding">) {
    return [surfaceBindingKey(identity.binding), identity.taskId, identity.receiptId, identity.batchId].map(keyPart).join("|");
}

function normalizeRequest(request: ResultSubmissionRequest): ResultSubmissionRequest {
    return Object.freeze({
        taskId: requiredText(request.taskId, "taskId"),
        receiptId: requiredText(request.receiptId, "receiptId"),
        batchId: requiredText(request.batchId, "batchId"),
        fingerprint: requiredText(request.fingerprint, "fingerprint", 256),
        binding: parseSurfaceBinding(request.binding),
    });
}

function validateReceipt(request: ResultSubmissionRequest, receipt: ResultSubmissionReceipt): ResultSubmissionReceipt {
    const normalized = normalizeReceipt(receipt);
    if (submissionIdentityKey(normalized) !== submissionIdentityKey(request) || normalized.fingerprint !== request.fingerprint) {
        throw new ResultSubmissionContractError("领域适配器返回了不匹配的提交回执");
    }
    return normalized;
}

function normalizeReceipt(receipt: ResultSubmissionReceipt): ResultSubmissionReceipt {
    if (!RESULT_SUBMISSION_STATUSES.includes(receipt.status)) throw new ResultSubmissionContractError("领域适配器返回了无效状态");
    const affectedIds = Object.freeze(Array.from(new Set(receipt.affectedIds.map((id) => requiredText(id, "affectedIds")))));
    const error = receipt.error ? Object.freeze({ code: requiredText(receipt.error.code, "error.code"), message: requiredText(receipt.error.message, "error.message", 1000), retryable: Boolean(receipt.error.retryable) }) : undefined;
    if ((receipt.status === "rejected" || receipt.status === "conflict") && !error) throw new ResultSubmissionContractError(`${receipt.status} 回执必须包含错误`);
    return Object.freeze({ ...normalizeRequest(receipt), status: receipt.status, affectedIds, ...(error ? { error } : {}) });
}

function conflictReceipt(request: ResultSubmissionRequest, code: string, message: string): ResultSubmissionReceipt {
    return Object.freeze({ ...request, status: "conflict", affectedIds: Object.freeze([]), error: Object.freeze({ code, message, retryable: false }) });
}

function requiredText(value: string, field: string, max = 160) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new ResultSubmissionContractError(`${field} 无效`);
    return value.trim();
}

function keyPart(value: string) {
    return `${value.length}:${value}`;
}
