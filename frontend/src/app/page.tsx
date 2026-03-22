"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type OverviewResponse = {
  totalViews: number;
  uploads: number;
  avgViews: number;
  outliers: number;
  chart: { date: string; views: number }[];
  channels: string[];
  coverage: { minDate: string; maxDate: string; days: number } | null;
};

type OutlierItem = {
  videoId: string;
  videoUrl: string;
  thumbnailUrl: string;
  title: string;
  publishedAt: string;
  views: number;
  mainChannelName: string;
  sourceId: string;
  sourceName: string;
};

type OutliersResponse = {
  period: "all" | "7d" | "28d";
  count: number;
  items: OutlierItem[];
};

type VideosResponse = {
  period: "all" | "7d" | "28d";
  count: number;
  items: OutlierItem[];
};

export default function Home() {
  const searchParams = useSearchParams();
  const initialPeriod = useMemo(() => {
    const p = searchParams.get("period");
    return p === "all" || p === "7d" || p === "28d" ? p : "28d";
  }, [searchParams]);

  const [period, setPeriod] = useState<"all" | "7d" | "28d">(initialPeriod);
  const [selectedChannel, setSelectedChannel] = useState<string>("All channels");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [outliersOpen, setOutliersOpen] = useState(false);
  const [outliersLoading, setOutliersLoading] = useState(false);
  const [outliersError, setOutliersError] = useState<string | null>(null);
  const [outliersData, setOutliersData] = useState<OutliersResponse | null>(null);
  const [videosOpen, setVideosOpen] = useState(false);
  const [videosLoading, setVideosLoading] = useState(false);
  const [videosError, setVideosError] = useState<string | null>(null);
  const [videosData, setVideosData] = useState<VideosResponse | null>(null);
  const [selectedOutlierSources, setSelectedOutlierSources] = useState<string[]>(
    []
  );

  useEffect(() => {
    setPeriod(initialPeriod);
  }, [initialPeriod]);

  const formatThousands = (value: number) => {
    const n = Math.round(value);
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  };

  /** YYYY-MM-DD → e.g. 23.02 (day.month, German-style) */
  const formatChartDate = (iso: string) => {
    const s = String(iso).trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return s;
    const day = String(Number(m[3]));
    const month = m[2];
    return `${day}.${month}`;
  };
  const formatMio = (value: number) => {
    const mio = value / 1_000_000;
    return `${mio.toFixed(1).replace(".", ",")} Mio.`;
  };

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const params = new URLSearchParams();
        params.set("period", period);
        if (selectedChannel !== "All channels") {
          params.set("channel", selectedChannel);
        }
        const res = await fetch(`/api/overview?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to load overview data");
        const json = (await res.json()) as OverviewResponse;
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [period, selectedChannel]);

  useEffect(() => {
    if (!outliersOpen) return;
    async function loadOutliers() {
      try {
        setOutliersLoading(true);
        setOutliersError(null);
        setSelectedOutlierSources([]);
        const params = new URLSearchParams();
        params.set("period", period);
        if (selectedChannel !== "All channels") {
          params.set("channel", selectedChannel);
        }
        const res = await fetch(`/api/outliers?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to load outliers");
        const json = (await res.json()) as OutliersResponse;
        setOutliersData(json);
      } catch (e) {
        setOutliersError(e instanceof Error ? e.message : "Failed to load outliers");
      } finally {
        setOutliersLoading(false);
      }
    }
    loadOutliers();
  }, [outliersOpen, period, selectedChannel]);

  const outlierSources = Array.from(
    new Set(
      (outliersData?.items ?? [])
        .map((i) => i.sourceName || i.sourceId)
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));

  const filteredOutliers =
    selectedOutlierSources.length === 0
      ? outliersData?.items ?? []
      : (outliersData?.items ?? []).filter((i) =>
          selectedOutlierSources.includes(i.sourceName || i.sourceId)
        );

  useEffect(() => {
    if (!videosOpen) return;
    async function loadVideos() {
      try {
        setVideosLoading(true);
        setVideosError(null);
        const params = new URLSearchParams();
        params.set("period", period);
        if (selectedChannel !== "All channels") {
          params.set("channel", selectedChannel);
        }
        const res = await fetch(`/api/videos?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to load videos");
        const json = (await res.json()) as VideosResponse;
        setVideosData(json);
      } catch (e) {
        setVideosError(e instanceof Error ? e.message : "Failed to load videos");
      } finally {
        setVideosLoading(false);
      }
    }
    loadVideos();
  }, [videosOpen, period, selectedChannel]);

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
        <header className="flex flex-col gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Dashboard
            </h1>
          </div>
          <div className="flex w-full flex-wrap items-center gap-3">
            <nav className="flex gap-3 text-sm font-medium text-zinc-700">
              <Link href="/" className="rounded-full bg-zinc-900 px-4 py-1 text-zinc-50">
                Dashboard
              </Link>
              <Link
                href={`/sources?period=${period}`}
                className="rounded-full border border-zinc-300 px-4 py-1 hover:bg-zinc-100"
              >
                Sources
              </Link>
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs font-medium uppercase text-zinc-500">
                Channel
              </span>
              <select
                className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs text-zinc-800 shadow-sm"
                value={selectedChannel}
                onChange={(e) => setSelectedChannel(e.target.value)}
              >
                <option>All channels</option>
                {(data?.channels ?? []).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-1 rounded-full bg-zinc-100 p-1 text-xs">
              <button
                type="button"
                className={`rounded-full px-3 py-1 ${
                  period === "all"
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-600"
                }`}
                onClick={() => setPeriod("all")}
              >
                All
              </button>
              <button
                type="button"
                className={`rounded-full px-3 py-1 ${
                  period === "7d"
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-600"
                }`}
                onClick={() => setPeriod("7d")}
              >
                7d
              </button>
              <button
                type="button"
                className={`rounded-full px-3 py-1 ${
                  period === "28d"
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-600"
                }`}
                onClick={() => setPeriod("28d")}
              >
                28d
              </button>
            </div>
          </div>
        </header>

        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setVideosOpen(true)}
            className="group rounded-2xl border border-zinc-200 bg-white p-4 text-left transition-all hover:border-emerald-400 hover:shadow-[0_0_0_3px_rgba(16,185,129,0.15)]"
            title="Open all videos list"
          >
            <p className="text-xs font-medium uppercase text-zinc-500">
              Total views
            </p>
            <p className="mt-2 text-2xl font-semibold text-zinc-900">
              {loading || !data ? "…" : formatMio(data.totalViews)}
            </p>
            <p className="mt-1 text-xs text-emerald-700 opacity-0 transition-opacity group-hover:opacity-100">
              Click to open full videos list
            </p>
          </button>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <p className="text-xs font-medium uppercase text-zinc-500">
              Uploads
            </p>
            <p className="mt-2 text-2xl font-semibold text-zinc-900">
              {loading || !data ? "…" : formatThousands(data.uploads)}
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <p className="text-xs font-medium uppercase text-zinc-500">
              AVG Views
            </p>
            <p className="mt-2 text-2xl font-semibold text-zinc-900">
              {loading || !data ? "…" : formatThousands(data.avgViews)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOutliersOpen(true)}
            className="group rounded-2xl border border-zinc-200 bg-white p-4 text-left transition-all hover:border-emerald-400 hover:shadow-[0_0_0_3px_rgba(16,185,129,0.15)]"
            title="Open outlier videos list"
          >
            <p className="text-xs font-medium uppercase text-zinc-500">
              Outliers (+100k)
            </p>
            <p className="mt-2 text-2xl font-semibold text-zinc-900">
              {loading || !data ? "…" : formatThousands(data.outliers)}
            </p>
            <p className="mt-1 text-xs text-emerald-700 opacity-0 transition-opacity group-hover:opacity-100">
              Click to open outlier list
            </p>
          </button>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="h-[320px] w-full">
            {loading ? (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                Loading…
              </div>
            ) : !data || data.chart.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                No chart data yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.chart}>
                  <CartesianGrid stroke="#e4e4e7" vertical={false} />
                  <XAxis
                    dataKey="date"
                    minTickGap={20}
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v) => formatChartDate(String(v))}
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v) => formatThousands(Number(v))}
                  />
                  <Tooltip
                    formatter={(value) => [formatThousands(Number(value)), "views"]}
                    labelFormatter={(label) => formatChartDate(String(label))}
                  />
                  <Line
                    type="monotone"
                    dataKey="views"
                    stroke="#09090b"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {outliersOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
            <div className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-900">
                    Outlier Videos (&gt; 100k)
                  </h2>
                  <p className="text-xs text-zinc-500">Period: {period}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium uppercase text-zinc-500">
                    Source
                  </span>
                  <details className="relative">
                    <summary className="cursor-pointer list-none rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs text-zinc-800 shadow-sm">
                      {selectedOutlierSources.length === 0
                        ? "All sources"
                        : `${selectedOutlierSources.length} selected`}
                    </summary>
                    <div className="absolute right-0 z-10 mt-2 w-64 rounded-xl border border-zinc-200 bg-white p-3 shadow-xl">
                      <div className="mb-2 flex items-center justify-between">
                        <button
                          type="button"
                          className="text-xs text-zinc-600 underline"
                          onClick={() => setSelectedOutlierSources([])}
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          className="text-xs text-zinc-600 underline"
                          onClick={() =>
                            setSelectedOutlierSources(
                              outlierSources.filter((s) => s !== "Unknown source")
                            )
                          }
                        >
                          Exclude Unknown
                        </button>
                      </div>
                      <div className="max-h-56 space-y-1 overflow-y-auto">
                        {outlierSources.map((src) => {
                          const checked = selectedOutlierSources.includes(src);
                          return (
                            <label
                              key={src}
                              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-zinc-50"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  setSelectedOutlierSources((prev) => {
                                    if (e.target.checked) return [...prev, src];
                                    return prev.filter((v) => v !== src);
                                  });
                                }}
                              />
                              <span className="truncate">{src}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </details>
                  <button
                    type="button"
                    onClick={() => setOutliersOpen(false)}
                    className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                  >
                    X
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {outliersError && (
                  <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    {outliersError}
                  </div>
                )}

                {outliersLoading ? (
                  <div className="text-sm text-zinc-500">Loading…</div>
                ) : !outliersData || outliersData.items.length === 0 ? (
                  <div className="text-sm text-zinc-500">
                    No outliers found for this period.
                  </div>
                ) : filteredOutliers.length === 0 ? (
                  <div className="text-sm text-zinc-500">
                    No outliers found for the selected source.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredOutliers.map((item) => (
                      <article
                        key={item.videoId}
                        className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-2"
                      >
                        <a href={item.videoUrl} target="_blank" rel="noreferrer">
                          <Image
                            src={item.thumbnailUrl}
                            alt={item.title}
                            width={96}
                            height={56}
                            className="h-14 w-24 rounded-md object-cover"
                          />
                        </a>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-zinc-900">
                            {item.title}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
                            <span>
                              <span className="font-medium text-zinc-800">Views:</span>{" "}
                              {formatThousands(item.views)}
                            </span>
                            <span>
                              <span className="font-medium text-zinc-800">Channel:</span>{" "}
                              {item.mainChannelName}
                            </span>
                            <span>
                              <span className="font-medium text-zinc-800">Source:</span>{" "}
                              {item.sourceName}
                            </span>
                            <span>
                              <span className="font-medium text-zinc-800">ID:</span>{" "}
                              {item.sourceId || "—"}
                            </span>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {videosOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
            <div className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-900">
                    All Videos (sorted by views)
                  </h2>
                  <p className="text-xs text-zinc-500">Period: {period}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setVideosOpen(false)}
                  className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                >
                  X
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {videosError && (
                  <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    {videosError}
                  </div>
                )}
                {videosLoading ? (
                  <div className="text-sm text-zinc-500">Loading…</div>
                ) : !videosData || videosData.items.length === 0 ? (
                  <div className="text-sm text-zinc-500">
                    No videos found for this period.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {videosData.items.map((item) => (
                      <article
                        key={item.videoId}
                        className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-2"
                      >
                        <a href={item.videoUrl} target="_blank" rel="noreferrer">
                          <Image
                            src={item.thumbnailUrl}
                            alt={item.title}
                            width={96}
                            height={56}
                            className="h-14 w-24 rounded-md object-cover"
                          />
                        </a>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-zinc-900">
                            {item.title}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
                            <span>
                              <span className="font-medium text-zinc-800">Views:</span>{" "}
                              {formatThousands(item.views)}
                            </span>
                            <span>
                              <span className="font-medium text-zinc-800">Channel:</span>{" "}
                              {item.mainChannelName}
                            </span>
                            <span>
                              <span className="font-medium text-zinc-800">Source:</span>{" "}
                              {item.sourceName}
                            </span>
                            <span>
                              <span className="font-medium text-zinc-800">ID:</span>{" "}
                              {item.sourceId || "—"}
                            </span>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
