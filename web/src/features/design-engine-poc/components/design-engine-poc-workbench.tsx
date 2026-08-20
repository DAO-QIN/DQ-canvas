"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useRef, useState } from "react";

import { createDesignPocFixture, createPerformanceDesignPocFixture, DESIGN_POC_INVALID_OPERATIONS } from "../contract/fixture";
import { runDesignPocGate } from "../contract/gate";
import type { DesignPocAdapter, DesignPocEngineKind, DesignPocGateResult } from "../contract/types";

const TldrawSurface = dynamic(() => import("../tldraw/tldraw-poc-surface").then((module) => module.TldrawPocSurface), { ssr: false });
const FabricSurface = dynamic(() => import("../fabric/fabric-poc-surface").then((module) => module.FabricPocSurface), { ssr: false });

type PerformanceResult = { engine: DesignPocEngineKind; durationMs: number; elementCount: number; documentBytes: number; longTaskCount: number | null; longestLongTaskMs: number | null };

export function DesignEnginePocWorkbench() {
    const [engine, setEngine] = useState<DesignPocEngineKind>("tldraw");
    const [adapter, setAdapter] = useState<DesignPocAdapter | null>(null);
    const adapterRef = useRef<DesignPocAdapter | null>(null);
    const [running, setRunning] = useState(false);
    const [message, setMessage] = useState("等待引擎初始化");
    const [results, setResults] = useState<Partial<Record<DesignPocEngineKind, DesignPocGateResult>>>({});
    const [performanceResults, setPerformanceResults] = useState<Partial<Record<DesignPocEngineKind, PerformanceResult>>>({});

    const handleReady = useCallback((next: DesignPocAdapter | null, owner: DesignPocAdapter) => {
        if (!next && adapterRef.current !== owner) return;
        adapterRef.current = next;
        setAdapter(next);
        setMessage(next ? `${next.engine} 已就绪，可运行统一 Gate` : "正在切换引擎...");
    }, []);

    const switchEngine = useCallback(
        (next: DesignPocEngineKind) => {
            if (next === engine) return;
            adapterRef.current = null;
            setAdapter(null);
            setMessage("正在切换引擎...");
            setEngine(next);
        },
        [engine],
    );

    const currentResult = results[engine];
    const currentPerformance = performanceResults[engine];
    const allComplete = Boolean(results.tldraw && results.fabric);
    const resultJson = useMemo(() => (currentResult ? JSON.stringify(currentResult, null, 2) : "尚未运行"), [currentResult]);

    const loadFixture = useCallback(async () => {
        if (!adapter || running) return;
        setRunning(true);
        try {
            await adapter.load(createDesignPocFixture());
            setMessage(`${adapter.engine} 已载入 4 Frame / 28 元素商品图夹具`);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "夹具载入失败");
        } finally {
            setRunning(false);
        }
    }, [adapter, running]);

    const runGate = useCallback(async () => {
        if (!adapter || running) return;
        setRunning(true);
        setMessage(`${adapter.engine} 正在执行 10 次往返、Undo/Redo 与 1x/2x 导出...`);
        const result = await runDesignPocGate(adapter);
        setResults((previous) => ({ ...previous, [adapter.engine]: result }));
        setMessage(result.passed ? `${adapter.engine} 技术 Gate 通过` : `${adapter.engine} 技术 Gate 未通过：${result.errors.join("；")}`);
        setRunning(false);
    }, [adapter, running]);

    const runInvalidOps = useCallback(async () => {
        if (!adapter || running) return;
        setRunning(true);
        try {
            await adapter.load(createDesignPocFixture());
            const receipt = await adapter.apply(DESIGN_POC_INVALID_OPERATIONS);
            setMessage(`非法 Ops 回执：${receipt.status} / ${receipt.errors.map((error) => error.code).join(", ")}`);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "非法 Ops 验证失败");
        } finally {
            setRunning(false);
        }
    }, [adapter, running]);

    const runPerformanceFixture = useCallback(async () => {
        if (!adapter || running) return;
        setRunning(true);
        try {
            const longTasks: number[] = [];
            const observer = typeof PerformanceObserver === "undefined" ? null : new PerformanceObserver((entries) => entries.getEntries().forEach((entry) => longTasks.push(entry.duration)));
            try {
                observer?.observe({ type: "longtask", buffered: false });
            } catch {
                observer?.disconnect();
            }
            const started = performance.now();
            await adapter.load(createPerformanceDesignPocFixture());
            for (let index = 0; index < 60; index += 1) adapter.setSelection([`perf-element-${String((index % 200) + 1).padStart(3, "0")}`]);
            adapter.setSelection([]);
            await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            observer?.disconnect();
            const metrics = adapter.getMetrics();
            const result = {
                engine: adapter.engine,
                durationMs: Math.round((performance.now() - started) * 100) / 100,
                elementCount: metrics.elementCount,
                documentBytes: metrics.documentBytes,
                longTaskCount: observer ? longTasks.length : null,
                longestLongTaskMs: observer && longTasks.length ? Math.round(Math.max(...longTasks) * 100) / 100 : observer ? 0 : null,
            };
            setPerformanceResults((previous) => ({ ...previous, [adapter.engine]: result }));
            setMessage(`${adapter.engine} 200 元素载入与 60 次选择完成：${result.durationMs}ms`);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "性能夹具验证失败");
        } finally {
            setRunning(false);
        }
    }, [adapter, running]);

    return (
        <main className="flex h-full min-h-0 flex-col bg-[#eef1f5] text-[#172033] dark:bg-[#101319] dark:text-[#edf2f7]" data-testid="design-poc-workbench">
            <section className="shrink-0 border-b border-slate-300/80 bg-white px-4 py-3 dark:border-slate-700 dark:bg-[#171b22]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-base font-semibold">我的画板 · 引擎隔离 PoC</h1>
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">不代表生产授权通过</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">统一夹具、统一 Design Ops、统一导出断言；不保存数据库，不调用 AI。</p>
                    </div>
                    <div className="flex rounded-lg border border-slate-300 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-900" aria-label="选择 PoC 引擎">
                        {(["tldraw", "fabric"] as const).map((candidate) => (
                            <button
                                key={candidate}
                                type="button"
                                className={`rounded-md px-4 py-2 text-xs font-semibold transition ${engine === candidate ? "bg-white text-blue-700 shadow-sm dark:bg-slate-700 dark:text-blue-300" : "text-slate-600 dark:text-slate-300"}`}
                                disabled={running}
                                aria-pressed={engine === candidate}
                                onClick={() => switchEngine(candidate)}
                            >
                                {candidate === "tldraw" ? "tldraw 5.2.5" : "Fabric 7.4.0"}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <ActionButton label="载入统一夹具" disabled={!adapter || running} onClick={() => void loadFixture()} />
                    <ActionButton label="运行完整 Gate" primary disabled={!adapter || running} onClick={() => void runGate()} />
                    <ActionButton label="验证非法 Ops" disabled={!adapter || running} onClick={() => void runInvalidOps()} />
                    <ActionButton label="运行 200 元素夹具" disabled={!adapter || running} onClick={() => void runPerformanceFixture()} />
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-600 dark:text-slate-300" role="status" data-testid="poc-status">
                        {running ? "执行中：" : "状态："}
                        {message}
                    </span>
                </div>
            </section>

            <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px]">
                <section className="relative min-h-[540px] overflow-hidden border-r border-slate-300 bg-[#d9dee7] dark:border-slate-700" key={engine}>
                    {engine === "tldraw" ? <TldrawSurface onReady={handleReady} /> : <FabricSurface onReady={handleReady} />}
                </section>
                <aside className="min-h-0 overflow-y-auto bg-white p-4 dark:bg-[#171b22]">
                    <h2 className="text-sm font-semibold">当前引擎证据</h2>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <Metric label="技术 Gate" value={currentResult ? (currentResult.passed ? "PASS" : "FAIL") : "未运行"} />
                        <Metric label="往返恢复" value={currentResult ? `${currentResult.roundTrips}/10` : "—"} />
                        <Metric label="Undo / Redo" value={currentResult ? `${currentResult.undoStable ? "✓" : "×"} / ${currentResult.redoStable ? "✓" : "×"}` : "—"} />
                        <Metric label="文档字节" value={currentResult ? String(currentResult.documentBytes) : "—"} />
                        <Metric label="Gate 耗时" value={currentResult ? `${currentResult.durationMs}ms` : "—"} />
                        <Metric label="200 元素" value={currentPerformance ? `${currentPerformance.durationMs}ms` : "未运行"} />
                        <Metric label="最长长任务" value={currentPerformance?.longestLongTaskMs === null || !currentPerformance ? "不可用" : `${currentPerformance.longestLongTaskMs}ms`} />
                    </dl>
                    <pre className="sr-only" data-testid="poc-performance-json">
                        {currentPerformance ? JSON.stringify(currentPerformance) : "尚未运行"}
                    </pre>
                    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-900/70">
                        <div className="font-semibold">导出结果</div>
                        {currentResult?.exports.length ? (
                            <ul className="mt-2 space-y-1" data-testid="poc-export-results">
                                {currentResult.exports.map((entry) => (
                                    <li key={`${entry.format}-${entry.scale}`}>
                                        {entry.format.toUpperCase()} {entry.scale}x · {entry.width}×{entry.height} · {entry.bytes} bytes · {entry.durationMs}ms
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="mt-2 text-slate-500">运行 Gate 后显示。</p>
                        )}
                    </div>
                    <div className={`mt-4 rounded-lg border p-3 text-xs ${allComplete ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900"}`} data-testid="poc-comparison-status">
                        {allComplete ? "两个候选的技术 Gate 均已执行，可进入证据评分。" : "必须分别运行 tldraw 与 Fabric，不能用单一候选得出选型结论。"}
                    </div>
                    <details className="mt-4">
                        <summary className="cursor-pointer text-xs font-semibold">原始 Gate JSON</summary>
                        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-[10px] leading-4 text-slate-100" data-testid="poc-result-json">
                            {resultJson}
                        </pre>
                    </details>
                </aside>
            </div>
        </main>
    );
}

function ActionButton({ label, primary = false, disabled, onClick }: { label: string; primary?: boolean; disabled: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            className={`rounded-md border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${primary ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"}`}
            disabled={disabled}
            onClick={onClick}
        >
            {label}
        </button>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
            <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
            <dd className="mt-1 font-semibold" data-metric={label}>
                {value}
            </dd>
        </div>
    );
}
