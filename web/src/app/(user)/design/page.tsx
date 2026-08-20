"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { App, Button, Input, Modal, Popconfirm } from "antd";
import { ArrowRight, Clock3, CopyPlus, Layers3, PanelsTopLeft, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { CompactEmptyState } from "@/components/compact-empty-state";
import type { DesignProjectSummary } from "@/lib/design";
import { createDesignProject, deleteDesignProject, isDesignProjectConflict, listDesignProjects } from "@/services/api/design-projects";

const PAGE_SIZE = 12;

export default function DesignProjectsPage() {
    const router = useRouter();
    const { message } = App.useApp();
    const [projects, setProjects] = useState<DesignProjectSummary[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [deletingId, setDeletingId] = useState("");
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");

    const loadFirstPage = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const result = await listDesignProjects({ page: 1, pageSize: PAGE_SIZE, status: "active" });
            setProjects(result.items);
            setTotal(result.total);
            setPage(result.page);
        } catch (loadError) {
            setError(errorMessage(loadError, "画板项目加载失败"));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadFirstPage();
    }, [loadFirstPage]);

    const loadMore = async () => {
        if (loadingMore || projects.length >= total) return;
        setLoadingMore(true);
        try {
            const result = await listDesignProjects({ page: page + 1, pageSize: PAGE_SIZE, status: "active" });
            setProjects((current) => [...current, ...result.items.filter((project) => !current.some((item) => item.id === project.id))]);
            setTotal(result.total);
            setPage(result.page);
        } catch (loadError) {
            message.error(errorMessage(loadError, "更多项目加载失败"));
        } finally {
            setLoadingMore(false);
        }
    };

    const create = async () => {
        const cleanTitle = title.trim();
        if (!cleanTitle) return message.warning("请输入画板名称");
        setCreating(true);
        try {
            const project = await createDesignProject({ title: cleanTitle, description: description.trim() });
            setCreateOpen(false);
            setTitle("");
            setDescription("");
            message.success("画板已创建");
            router.push(`/design/${project.id}`);
        } catch (createError) {
            message.error(errorMessage(createError, "画板创建失败"));
        } finally {
            setCreating(false);
        }
    };

    const remove = async (project: DesignProjectSummary) => {
        if (deletingId) return;
        setDeletingId(project.id);
        try {
            await deleteDesignProject(project.id, project.revision);
            setProjects((current) => current.filter((item) => item.id !== project.id));
            setTotal((current) => Math.max(0, current - 1));
            message.success("画板已删除");
        } catch (deleteError) {
            if (isDesignProjectConflict(deleteError)) {
                message.warning("画板已在其他位置更新，列表已刷新，请重新确认删除");
                await loadFirstPage();
            } else {
                message.error(errorMessage(deleteError, "画板删除失败"));
            }
        } finally {
            setDeletingId("");
        }
    };

    const totals = useMemo(() => projects.reduce((result, project) => ({ frames: result.frames + project.frameCount, elements: result.elements + project.elementCount }), { frames: 0, elements: 0 }), [projects]);

    return (
        <main className="h-full overflow-y-auto bg-[#f6f7f9] text-[#1d2433] dark:bg-[#0f1115] dark:text-[#f2f5f8]" data-testid="design-projects-page">
            <div className="mx-auto w-full max-w-[1480px] px-3 py-4 sm:px-6 sm:py-8 xl:px-10">
                <header className="relative overflow-hidden rounded-2xl border border-[#e3e7ee] bg-white px-5 py-6 shadow-[0_18px_50px_-36px_rgba(31,45,70,0.45)] sm:px-8 sm:py-8 dark:border-[#292e37] dark:bg-[#171a20]">
                    <div className="pointer-events-none absolute -right-16 -top-28 size-72 rounded-full bg-[#dce7ff] blur-3xl dark:bg-[#1e3769]/50" />
                    <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
                        <div className="max-w-2xl">
                            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-[#5f78b5] dark:text-[#9bb6f2]">
                                <PanelsTopLeft className="size-4" />
                                Design workspace
                            </div>
                            <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">我的画板</h1>
                            <p className="mt-2 max-w-xl text-sm leading-6 text-[#687385] dark:text-[#a7afba]">面向商品主图、详情页和广告素材的精确排版空间。它与节点式“我的画布”独立保存，互不影响。</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2.5">
                            <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void loadFirstPage()}>
                                刷新
                            </Button>
                            <Button type="primary" className="!h-10 !px-4" icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)}>
                                新建画板
                            </Button>
                        </div>
                    </div>
                    <div className="relative mt-6 flex flex-wrap gap-x-7 gap-y-2 border-t border-[#edf0f4] pt-4 text-xs text-[#747e8d] dark:border-[#292e37] dark:text-[#939ca9]">
                        <span>
                            <strong className="mr-1.5 text-base font-semibold text-[#242c3a] dark:text-[#eef2f6]">{total}</strong>个项目
                        </span>
                        <span title="按当前已加载项目统计">
                            <strong className="mr-1.5 text-base font-semibold text-[#242c3a] dark:text-[#eef2f6]">{totals.frames}</strong>个画框
                        </span>
                        <span>
                            <strong className="mr-1.5 text-base font-semibold text-[#242c3a] dark:text-[#eef2f6]">{totals.elements}</strong>个元素（当前已加载）
                        </span>
                    </div>
                </header>

                {error ? (
                    <section className="mt-5 flex min-h-40 flex-col items-center justify-center rounded-xl border border-amber-300/70 bg-amber-50/80 px-4 text-center dark:border-amber-800 dark:bg-amber-950/20">
                        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">项目服务暂不可用</p>
                        <p className="mt-1 max-w-xl text-xs leading-5 text-amber-700 dark:text-amber-300">{error}</p>
                        <Button className="mt-4" size="small" icon={<RefreshCw className="size-3.5" />} onClick={() => void loadFirstPage()}>
                            重新加载
                        </Button>
                    </section>
                ) : loading ? (
                    <DesignProjectSkeleton />
                ) : projects.length ? (
                    <>
                        <section className="grid gap-3 py-5 sm:grid-cols-2 sm:gap-5 sm:py-7 xl:grid-cols-3 2xl:grid-cols-4">
                            {projects.map((project) => (
                                <DesignProjectCard key={project.id} project={project} deleting={deletingId === project.id} onOpen={() => router.push(`/design/${project.id}`)} onDelete={() => remove(project)} />
                            ))}
                        </section>
                        {projects.length < total ? (
                            <div className="flex justify-center pb-8">
                                <Button loading={loadingMore} onClick={() => void loadMore()}>
                                    加载更多
                                </Button>
                            </div>
                        ) : null}
                    </>
                ) : (
                    <CompactEmptyState
                        title="创建你的第一个商品设计画板"
                        description="画板使用独立 Design Document 保存。进入后可缩放、平移并自动恢复工作区视口。"
                        icon={<PanelsTopLeft className="size-4" />}
                        className="mt-5 min-h-56 bg-white dark:bg-[#171a20]"
                        action={
                            <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)}>
                                新建第一个画板
                            </Button>
                        }
                    />
                )}
            </div>

            <Modal title="新建画板" open={createOpen} okText="创建并进入" cancelText="取消" confirmLoading={creating} onOk={() => void create()} onCancel={() => !creating && setCreateOpen(false)}>
                <div className="space-y-4 pt-3">
                    <label className="block space-y-2">
                        <span className="text-sm font-medium">画板名称</span>
                        <Input autoFocus maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} onPressEnter={() => void create()} placeholder="例如：秋季新品 Amazon 主图" />
                    </label>
                    <label className="block space-y-2">
                        <span className="text-sm font-medium">
                            项目说明 <span className="font-normal text-muted-foreground">（可选）</span>
                        </span>
                        <Input.TextArea maxLength={4000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="记录渠道、规格或本次设计目标" />
                    </label>
                </div>
            </Modal>
        </main>
    );
}

function DesignProjectCard({ project, deleting, onOpen, onDelete }: { project: DesignProjectSummary; deleting: boolean; onOpen: () => void; onDelete: () => Promise<void> }) {
    return (
        <article className="group overflow-hidden rounded-xl border border-[#e1e5eb] bg-white transition duration-200 hover:-translate-y-0.5 hover:border-[#b8c6e7] hover:shadow-[0_18px_44px_-30px_rgba(34,57,105,0.55)] dark:border-[#2a2f38] dark:bg-[#171a20] dark:hover:border-[#44577f]">
            <button type="button" className="relative block h-36 w-full overflow-hidden bg-[#e9edf3] text-left sm:h-40 dark:bg-[#20242b]" onClick={onOpen} aria-label={`打开画板 ${project.title}`}>
                <span className="absolute inset-0 opacity-60 [background-image:radial-gradient(#9ba8ba_0.8px,transparent_0.8px)] [background-size:16px_16px] dark:opacity-25" />
                <span className="absolute left-[13%] top-[16%] h-[68%] w-[64%] rotate-[-1.5deg] rounded-sm border border-black/10 bg-white shadow-[0_15px_30px_-18px_rgba(20,32,50,0.65)] dark:bg-[#eef0f2]">
                    <span className="absolute inset-x-[12%] top-[16%] h-[22%] rounded-sm bg-gradient-to-r from-[#dbe5f9] to-[#e9dff6]" />
                    <span className="absolute bottom-[18%] left-[12%] h-1.5 w-[42%] rounded bg-[#252c38]/75" />
                    <span className="absolute bottom-[11%] left-[12%] h-1 w-[28%] rounded bg-[#9ba4b2]" />
                </span>
                <span className="absolute right-3 top-3 rounded-full border border-white/70 bg-white/85 px-2 py-1 text-[10px] font-medium text-[#566174] shadow-sm backdrop-blur dark:border-white/10 dark:bg-[#171a20]/85 dark:text-[#c8ced7]">
                    r{project.revision}
                </span>
                <span className="absolute bottom-3 right-3 grid size-8 place-items-center rounded-full bg-[#202b40] text-white opacity-0 shadow transition group-hover:opacity-100">
                    <ArrowRight className="size-4" />
                </span>
            </button>
            <div className="p-4">
                <div className="flex items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#edf2ff] text-[#5875bd] dark:bg-[#223052] dark:text-[#a9c0fa]">
                        <PanelsTopLeft className="size-[17px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                        <h2 className="truncate text-[15px] font-semibold" title={project.title}>
                            {project.title}
                        </h2>
                        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[#7a8492] dark:text-[#929ba8]">
                            <Clock3 className="size-3" />
                            {formatUpdatedAt(project.updatedAt)}
                        </p>
                    </div>
                </div>
                <div className="mt-4 grid grid-cols-3 divide-x divide-[#e7eaf0] rounded-lg bg-[#f6f7f9] py-2 text-center dark:divide-[#303640] dark:bg-[#20242b]">
                    <ProjectMetric icon={<CopyPlus className="size-3" />} value={project.frameCount} label="画框" />
                    <ProjectMetric icon={<Layers3 className="size-3" />} value={project.elementCount} label="元素" />
                    <ProjectMetric icon={<PanelsTopLeft className="size-3" />} value={project.assetCount} label="素材" />
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#eef0f3] pt-3 dark:border-[#2a2f38]">
                    <Popconfirm title="删除这个画板？" description="项目文档会被删除，共享素材不会被清理。" okText="删除" cancelText="取消" okButtonProps={{ danger: true, loading: deleting }} onConfirm={onDelete}>
                        <Button type="text" danger size="small" icon={<Trash2 className="size-3.5" />} loading={deleting}>
                            删除
                        </Button>
                    </Popconfirm>
                    <Button type="text" size="small" onClick={onOpen}>
                        打开画板 <ArrowRight className="ml-1 size-3.5" />
                    </Button>
                </div>
            </div>
        </article>
    );
}

function ProjectMetric({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
    return (
        <div>
            <div className="flex items-center justify-center gap-1 text-sm font-semibold">
                {icon}
                {value}
            </div>
            <div className="mt-0.5 text-[10px] text-[#8a93a0]">{label}</div>
        </div>
    );
}

function DesignProjectSkeleton() {
    return (
        <section className="grid gap-3 py-5 sm:grid-cols-2 sm:gap-5 sm:py-7 xl:grid-cols-3 2xl:grid-cols-4" aria-label="正在加载画板项目">
            {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="h-[290px] animate-pulse rounded-xl border border-[#e4e7ec] bg-white dark:border-[#2a2f38] dark:bg-[#171a20]">
                    <div className="h-40 bg-[#eaedf2] dark:bg-[#22262d]" />
                    <div className="space-y-3 p-4">
                        <div className="h-4 w-2/3 rounded bg-[#e7eaf0] dark:bg-[#292e36]" />
                        <div className="h-3 w-1/2 rounded bg-[#eef0f3] dark:bg-[#242931]" />
                        <div className="h-10 rounded bg-[#f0f2f5] dark:bg-[#20242b]" />
                    </div>
                </div>
            ))}
        </section>
    );
}

function formatUpdatedAt(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "更新时间未知";
    return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}
