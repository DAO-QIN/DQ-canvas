import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), readAdminBackupData: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/auth/store-normalizers", () => ({ encryptAuthDbSecretsForStorage: vi.fn((value) => value) }));
vi.mock("@/lib/server/admin-backup-policy", async (importOriginal) => {
    const original = await importOriginal<typeof import("@/lib/server/admin-backup-policy")>();
    return { ...original, mergeAuthBackupSecrets: vi.fn(), sanitizeAuthBackup: vi.fn((value) => value) };
});
vi.mock("@/lib/server/admin-backup-store", () => ({ readAdminBackupData: mocks.readAdminBackupData, restoreAdminBackupData: vi.fn() }));
vi.mock("@/lib/server/database", () => ({ getDatabaseProvider: vi.fn(() => "file") }));
vi.mock("@/lib/server/data-adapter", () => ({
    copyDataFile: vi.fn(),
    ensureDataDirectory: vi.fn(),
    listDataDirectory: vi.fn(),
    removeDataPath: vi.fn(),
    resolveDataPath: vi.fn(),
    writeJsonDataFile: vi.fn(),
}));

import { GET, POST } from "./route";

describe("/api/admin/backup", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "admin-one", role: "admin" });
        mocks.readAdminBackupData.mockResolvedValue({
            auth: { users: [], settings: {} },
            prompts: { version: 1, prompts: [], seedSources: [] },
            generationLogs: { version: 1, logs: [] },
            accountDeletionRequests: { version: 1, requests: [] },
        });
    });

    it("exports a machine-readable account-config scope that excludes creative recovery", async () => {
        const response = await GET();
        const backup = await response.json();

        expect(response.status).toBe(200);
        expect(backup).toMatchObject({ backupType: "account-config", scope: { mode: "account-config", restoreStrategy: "merge-no-delete", disasterRecovery: false } });
        expect(backup.scope.excluded).toEqual(expect.arrayContaining(["canvas-projects", "design-projects", "creative-runtime", "generation-tasks", "media-binaries"]));
        expect(backup.files).not.toHaveProperty("designProjects");
    });

    it("rejects an oversized multipart backup before parsing it", async () => {
        const response = await POST(
            new Request("http://localhost/api/admin/backup", {
                method: "POST",
                headers: { "content-type": "multipart/form-data; boundary=test", "content-length": String(30 * 1024 * 1024 + 64 * 1024 + 1) },
                body: "--test--",
            }),
        );

        expect(response.status).toBe(413);
        expect((await response.json()).error).toBe("备份文件过大，请确认文件是否正确");
    });

    it("rejects a disaster recovery manifest at the account-config import endpoint", async () => {
        const formData = new FormData();
        formData.set("file", new File([JSON.stringify({ app: "DQ-绘图", backupType: "disaster", files: {} })], "recovery-point.json", { type: "application/json" }));

        const response = await POST(new Request("http://localhost/api/admin/backup", { method: "POST", body: formData }));

        expect(response.status).toBe(400);
        expect((await response.json()).error).toContain("不能用于整库灾难恢复");
    });
});
