import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), createProject: vi.fn(), listProjects: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/design-project-service", () => ({
    createDesignProjectForUser: mocks.createProject,
    listDesignProjectsForUser: mocks.listProjects,
    designProjectError: (error: unknown) => error,
    invalidDesignJsonError: () => Object.assign(new Error("请求 JSON 无效"), { status: 400 }),
}));

import { GET, POST } from "./route";

describe("/api/design/projects", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one" });
        mocks.listProjects.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
        mocks.createProject.mockResolvedValue({ id: "design-one", revision: 0 });
    });

    it("requires authentication", async () => {
        mocks.getCurrentUser.mockResolvedValue(null);
        expect((await GET(new Request("http://localhost/api/design/projects"))).status).toBe(401);
    });

    it("lists only through the current user service boundary", async () => {
        await GET(new Request("http://localhost/api/design/projects?page=2&pageSize=12&status=archived"));
        expect(mocks.listProjects).toHaveBeenCalledWith("user-one", { page: 2, pageSize: 12, status: "archived" });
    });

    it("rejects malformed JSON instead of silently creating a default project", async () => {
        const response = await POST(new Request("http://localhost/api/design/projects", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }));
        expect(response.status).toBe(400);
        expect(mocks.createProject).not.toHaveBeenCalled();
    });

    it("uses the current user for project creation", async () => {
        const response = await POST(new Request("http://localhost/api/design/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "商品主图" }) }));
        expect(response.status).toBe(201);
        expect(mocks.createProject).toHaveBeenCalledWith("user-one", { title: "商品主图" });
    });
});
