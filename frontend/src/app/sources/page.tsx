 "use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
  Tooltip,
} from "recharts";

type SourceMetrics = {
  source_id: string;
  source_channel_name?: string;
  videos: number;
  total_views: number;
  avg_views: number;
  outlier_count: number;
  outlier_ratio: number;
  niche_tags: string[];
  used_on_channels: string[];
};

type SourcesApiResponse = {
  metrics: SourceMetrics[];
  channels: string[];
  nicheOptions: string[];
};

type SourceVideoItem = {
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

type SourceVideosResponse = {
  sourceId: string;
  period: "all" | "7d" | "28d";
  count: number;
  items: SourceVideoItem[];
};

type SortKey =
  | "videos"
  | "total_views"
  | "avg_views"
  | "outlier_count"
  | "outlier_ratio";
type SortDirection = "asc" | "desc";
type StatusFilter = "all" | "scale" | "test" | "pause" | "unknown";
function nichePillClass(niche: string): string {
  switch (niche.toLowerCase()) {
    case "scary":
      return "bg-violet-100 text-violet-800";
    case "dance":
      return "bg-fuchsia-100 text-fuchsia-800";
    case "commentary":
      return "bg-sky-100 text-sky-800";
    default:
      return "bg-zinc-200 text-zinc-700";
  }
}

function NicheTagPills({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {tags.map((t) => (
        <span
          key={t}
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${nichePillClass(t)}`}
        >
          {t}
        </span>
      ))}
    </span>
  );
}

const SOURCE_COLORS = [
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#f59e0b",
  "#14b8a6",
  "#ef4444",
  "#6366f1",
  "#84cc16",
  "#9ca3af",
  "#06b6d4",
];

export default function SourcesPage() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const initialPeriod = useMemo(() => {
    const p = searchParams.get("period");
    return p === "all" || p === "7d" || p === "28d" ? p : "28d";
  }, [searchParams]);
  const initialNiche = useMemo(() => {
    const n = searchParams.get("niche")?.toLowerCase();
    if (n === "commentary" || n === "scary" || n === "dance") return n;
    return "all";
  }, [searchParams]);

  const [data, setData] = useState<SourceMetrics[]>([]);
  const [channels, setChannels] = useState<string[]>([]);
  const [nicheOptions, setNicheOptions] = useState<string[]>([
    "commentary",
    "scary",
    "dance",
  ]);
  const [selectedChannel, setSelectedChannel] = useState<string>("All channels");
  const [datePreset, setDatePreset] = useState<"all" | "7d" | "28d">(initialPeriod);
  const [nicheFilter, setNicheFilter] = useState<string>(initialNiche);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [hoveredSourceId, setHoveredSourceId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<SourceMetrics | null>(null);
  const [sourceVideosLoading, setSourceVideosLoading] = useState(false);
  const [sourceVideosError, setSourceVideosError] = useState<string | null>(null);
  const [sourceVideos, setSourceVideos] = useState<SourceVideoItem[]>([]);
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    setDatePreset(initialPeriod);
  }, [initialPeriod]);

  useEffect(() => {
    setNicheFilter(initialNiche);
  }, [initialNiche]);

  const replaceSourcesQuery = (overrides: {
    period?: "all" | "7d" | "28d";
    niche?: string;
  }) => {
    const params = new URLSearchParams();
    params.set("period", overrides.period ?? datePreset);
    const niche = overrides.niche ?? nicheFilter;
    if (niche !== "all") params.set("niche", niche);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const params = new URLSearchParams();

        if (selectedChannel && selectedChannel !== "All channels") {
          params.set("channel", selectedChannel);
        }

        params.set("period", datePreset);
        if (nicheFilter !== "all") params.set("niche", nicheFilter);

        const query = params.toString() ? `?${params.toString()}` : "";
        const res = await fetch(`/api/sources${query}`);
        if (!res.ok) throw new Error("Failed to fetch source metrics");
        const json = (await res.json()) as SourcesApiResponse | SourceMetrics[];
        if (Array.isArray(json)) {
          setData(
            json.map((row: SourceMetrics) => ({
              ...row,
              niche_tags: row.niche_tags ?? [],
              used_on_channels: row.used_on_channels ?? [],
            }))
          );
        } else {
          setData(json.metrics);
          setChannels(json.channels);
          if (json.nicheOptions?.length) setNicheOptions(json.nicheOptions);
        }
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Failed to load data";
        setError(message);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [selectedChannel, datePreset, nicheFilter]);

  const totalVideos = data.reduce((sum, s) => sum + s.videos, 0);
  const totalViews = data.reduce((sum, s) => sum + s.total_views, 0);
  const totalOutliers = data.reduce((sum, s) => sum + s.outlier_count, 0);
  const avgViewsOverall =
    totalVideos > 0 ? Math.round(totalViews / totalVideos) : 0;
  const formatThousands = (value: number) =>
    Math.round(value)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  const toggleSort = (key: SortKey) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDirection("desc");
      return;
    }
    if (sortDirection === "desc") {
      setSortDirection("asc");
      return;
    }
    setSortKey(null);
    setSortDirection("desc");
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return "";
    return sortDirection === "desc" ? " ↓" : " ↑";
  };

  const knownSources = useMemo(
    () =>
      data.filter(
        (s) =>
          s.source_id !== "UNKNOWN" &&
          (s.source_channel_name ?? "").trim().toLowerCase() !== "unknown source"
      ),
    [data]
  );

  const topKnownByViews = useMemo(
    () => [...knownSources].sort((a, b) => b.total_views - a.total_views).slice(0, 10),
    [knownSources]
  );

  const pieData = useMemo(() => {
    const top8 = topKnownByViews.slice(0, 8).map((s) => ({
      name: s.source_channel_name || s.source_id,
      value: s.total_views,
      sourceId: s.source_id,
    }));
    return top8;
  }, [topKnownByViews]);
  const colorBySourceId = useMemo(() => {
    const map = new Map<string, string>();
    topKnownByViews.forEach((s, idx) => {
      map.set(s.source_id, SOURCE_COLORS[idx % SOURCE_COLORS.length]);
    });
    return map;
  }, [topKnownByViews]);
  const activePieIndex = useMemo(() => {
    if (!hoveredSourceId) return -1;
    return pieData.findIndex((p) => p.sourceId === hoveredSourceId);
  }, [hoveredSourceId, pieData]);

  const renderActiveSlice = (props: {
    cx?: number;
    cy?: number;
    innerRadius?: number;
    outerRadius?: number;
    startAngle?: number;
    endAngle?: number;
    fill?: string;
  }) => {
    const {
      cx = 0,
      cy = 0,
      innerRadius = 0,
      outerRadius = 0,
      startAngle = 0,
      endAngle = 0,
      fill = "#22c55e",
    } = props;
    return (
      <g style={{ filter: "drop-shadow(0 0 8px rgba(16,185,129,0.45))" }}>
        <Sector
          cx={cx}
          cy={cy}
          innerRadius={innerRadius}
          outerRadius={outerRadius + 6}
          startAngle={startAngle}
          endAngle={endAngle}
          fill={fill}
        />
      </g>
    );
  };

  const decisionModel = useMemo(() => {
    const sortedAvg = [...knownSources]
      .map((s) => s.avg_views)
      .sort((a, b) => a - b);
    const quantile = (q: number) => {
      if (sortedAvg.length === 0) return 0;
      const idx = Math.max(0, Math.min(sortedAvg.length - 1, Math.floor((sortedAvg.length - 1) * q)));
      return sortedAvg[idx];
    };
    return {
      medianAvg: quantile(0.5),
      strongAvg: quantile(0.7),
      eliteAvg: quantile(0.85),
    };
  }, [knownSources]);

  const getStatusChip = (s: SourceMetrics) => {
    if (s.source_id === "UNKNOWN") {
      return { label: "Unknown", cls: "bg-zinc-100 text-zinc-700" };
    }
    const viralOverride =
      s.videos <= 3 && (s.avg_views >= 200_000 || s.avg_views >= decisionModel.eliteAvg * 2.5);
    if (viralOverride) {
      return { label: "Scale", cls: "bg-emerald-100 text-emerald-800" };
    }
    if (s.videos < 7) {
      // Not enough sample to justify "Pause"; keep testing unless it is strong enough for Scale.
      const { strongAvg, eliteAvg } = decisionModel;
      const strongSample = s.videos >= 5;
      if (
        (strongSample && s.avg_views >= strongAvg && s.outlier_ratio >= 0.2) ||
        (s.videos >= 4 && s.avg_views >= eliteAvg)
      ) {
        return { label: "Scale", cls: "bg-emerald-100 text-emerald-800" };
      }
      return { label: "Test", cls: "bg-amber-100 text-amber-800" };
    }
    const { medianAvg, strongAvg, eliteAvg } = decisionModel;
    const hasSample = s.videos >= 3;
    const strongSample = s.videos >= 5;

    if (
      (strongSample && s.avg_views >= strongAvg && s.outlier_ratio >= 0.2) ||
      (s.videos >= 4 && s.avg_views >= eliteAvg)
    ) {
      return { label: "Scale", cls: "bg-emerald-100 text-emerald-800" };
    }

    if (
      (s.videos < 3 && s.avg_views >= medianAvg) ||
      (hasSample && s.avg_views >= medianAvg)
    ) {
      return { label: "Test", cls: "bg-amber-100 text-amber-800" };
    }

    return { label: "Pause", cls: "bg-rose-100 text-rose-800" };
  };

  const filteredData = useMemo(() => {
    if (statusFilter === "all") return data;
    const { medianAvg, strongAvg, eliteAvg } = decisionModel;
    return data.filter((s) => {
      let label: StatusFilter = "pause";
      if (s.source_id === "UNKNOWN") {
        label = "unknown";
      } else if (
        s.videos <= 3 &&
        (s.avg_views >= 200_000 || s.avg_views >= eliteAvg * 2.5)
      ) {
        label = "scale";
      } else if (s.videos < 7) {
        const strongSample = s.videos >= 5;
        if (
          (strongSample && s.avg_views >= strongAvg && s.outlier_ratio >= 0.2) ||
          (s.videos >= 4 && s.avg_views >= eliteAvg)
        ) {
          label = "scale";
        } else {
          label = "test";
        }
      } else {
        const hasSample = s.videos >= 3;
        const strongSample = s.videos >= 5;
        if (
          (strongSample && s.avg_views >= strongAvg && s.outlier_ratio >= 0.2) ||
          (s.videos >= 4 && s.avg_views >= eliteAvg)
        ) {
          label = "scale";
        } else if (
          (s.videos < 3 && s.avg_views >= medianAvg) ||
          (hasSample && s.avg_views >= medianAvg)
        ) {
          label = "test";
        } else {
          label = "pause";
        }
      }
      return label === statusFilter;
    });
  }, [data, statusFilter, decisionModel]);

  const sortedData = useMemo(() => {
    if (!sortKey) return filteredData;
    const copy = [...filteredData];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const diff = Number(av) - Number(bv);
      return sortDirection === "asc" ? diff : -diff;
    });
    return copy;
  }, [filteredData, sortKey, sortDirection]);

  useEffect(() => {
    const source = selectedSource;
    if (!source) return;
    const sourceId = source.source_id;
    async function loadSourceVideos() {
      try {
        setSourceVideosLoading(true);
        setSourceVideosError(null);
        const params = new URLSearchParams();
        params.set("sourceId", sourceId);
        params.set("period", datePreset);
        if (selectedChannel !== "All channels") {
          params.set("channel", selectedChannel);
        }
        const res = await fetch(`/api/source-videos?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to load source videos");
        const json = (await res.json()) as SourceVideosResponse;
        setSourceVideos(json.items ?? []);
      } catch (e) {
        setSourceVideosError(
          e instanceof Error ? e.message : "Failed to load source videos"
        );
      } finally {
        setSourceVideosLoading(false);
      }
    }
    loadSourceVideos();
  }, [selectedSource, datePreset, selectedChannel]);

  useEffect(() => {
    if (!hoveredSourceId) return;
    const el = cardRefs.current[hoveredSourceId];
    if (!el) return;
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [hoveredSourceId]);

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
        <header className="flex flex-col gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Source Performance
            </h1>
          </div>
          <div className="flex w-full flex-wrap items-center gap-3 text-sm">
            <nav className="flex gap-3 text-sm font-medium text-zinc-700">
              <Link
                href={`/?period=${datePreset}`}
                className="rounded-full border border-zinc-300 px-4 py-1 hover:bg-zinc-100"
              >
                Dashboard
              </Link>
              <Link
                href={`/sources?period=${datePreset}${nicheFilter !== "all" ? `&niche=${nicheFilter}` : ""}`}
                className="rounded-full bg-zinc-900 px-4 py-1 text-zinc-50"
              >
                Sources
              </Link>
            </nav>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase text-zinc-500">
                Channel
              </span>
              <select
                className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs text-zinc-800 shadow-sm"
                value={selectedChannel}
                onChange={(e) => setSelectedChannel(e.target.value)}
              >
                <option>All channels</option>
                {channels.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase text-zinc-500">
                Niche
              </span>
              <select
                className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs text-zinc-800 shadow-sm"
                value={nicheFilter}
                onChange={(e) => {
                  const v = e.target.value;
                  setNicheFilter(v);
                  const params = new URLSearchParams();
                  params.set("period", datePreset);
                  if (v !== "all") params.set("niche", v);
                  router.replace(`${pathname}?${params.toString()}`, {
                    scroll: false,
                  });
                }}
              >
                <option value="all">All niches</option>
                {nicheOptions.map((n) => (
                  <option key={n} value={n}>
                    {n.charAt(0).toUpperCase() + n.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium uppercase text-zinc-500">
                Period
              </span>
              <div className="flex gap-1 rounded-full bg-zinc-100 p-1 text-xs">
                <button
                  type="button"
                  className={`rounded-full px-3 py-1 ${
                    datePreset === "all"
                      ? "bg-white text-zinc-900 shadow-sm"
                      : "text-zinc-600"
                  }`}
                  onClick={() => replaceSourcesQuery({ period: "all" })}
                >
                  All
                </button>
                <button
                  type="button"
                  className={`rounded-full px-3 py-1 ${
                    datePreset === "7d"
                      ? "bg-white text-zinc-900 shadow-sm"
                      : "text-zinc-600"
                  }`}
                  onClick={() => replaceSourcesQuery({ period: "7d" })}
                >
                  7d
                </button>
                <button
                  type="button"
                  className={`rounded-full px-3 py-1 ${
                    datePreset === "28d"
                      ? "bg-white text-zinc-900 shadow-sm"
                      : "text-zinc-600"
                  }`}
                  onClick={() => replaceSourcesQuery({ period: "28d" })}
                >
                  28d
                </button>
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <p className="text-xs font-medium uppercase text-zinc-500">
              Total views
            </p>
            <p className="mt-2 text-2xl font-semibold text-zinc-900">
              {loading ? "…" : totalViews.toLocaleString()}
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <p className="text-xs font-medium uppercase text-zinc-500">
              Uploads
            </p>
            <p className="mt-2 text-2xl font-semibold text-zinc-900">
              {loading ? "…" : totalVideos.toLocaleString()}
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <p className="text-xs font-medium uppercase text-zinc-500">
              AVG Views
            </p>
            <p className="mt-2 text-2xl font-semibold text-zinc-900">
              {loading ? "…" : avgViewsOverall.toLocaleString()}
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <p className="text-xs font-medium uppercase text-zinc-500">
              Outliers (+100k)
            </p>
            <p className="mt-2 text-2xl font-semibold text-zinc-900">
              {loading ? "…" : totalOutliers.toLocaleString()}
            </p>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-900">
                Views Share by Top Sources
              </h2>
              <p className="text-[11px] text-zinc-500">Unknown excluded</p>
            </div>
            <div className="h-[340px] w-full">
              {loading ? (
                <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                  Loading...
                </div>
              ) : pieData.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                  No known-source data yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={125}
                      labelLine={false}
                      /* Recharts 3 Pie supports activeIndex at runtime; types lag behind */
                      {...({
                        activeIndex: activePieIndex >= 0 ? activePieIndex : undefined,
                        activeShape: renderActiveSlice,
                      } as Record<string, unknown>)}
                      onMouseLeave={() => setHoveredSourceId(null)}
                      onMouseEnter={(entry) => {
                        const sourceId = String((entry as { sourceId?: string }).sourceId ?? "");
                        setHoveredSourceId(sourceId || null);
                      }}
                    >
                      {pieData.map((entry, index) => {
                        return (
                          <Cell
                            key={`${entry.sourceId}-${index}`}
                            fill={SOURCE_COLORS[index % SOURCE_COLORS.length]}
                          />
                        );
                      })}
                    </Pie>
                    <Tooltip formatter={(v) => formatThousands(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-900">
                Top Sources (by total views)
              </h2>
              <p className="text-[11px] text-zinc-500">Top 10</p>
            </div>
            <div className="max-h-[280px] space-y-2 overflow-y-auto pr-1">
              {loading ? (
                <div className="text-sm text-zinc-500">Loading...</div>
              ) : topKnownByViews.length === 0 ? (
                <div className="text-sm text-zinc-500">No known-source data yet.</div>
              ) : (
                topKnownByViews.map((s, idx) => {
                  const chip = getStatusChip(s);
                  return (
                    <button
                      key={s.source_id}
                      type="button"
                      ref={(el) => {
                        cardRefs.current[s.source_id] = el;
                      }}
                      onClick={() => setSelectedSource(s)}
                      onMouseEnter={() => setHoveredSourceId(s.source_id)}
                      onMouseLeave={() => setHoveredSourceId(null)}
                      className={`flex w-full items-center justify-between rounded-xl border p-2 text-left transition ${
                        hoveredSourceId === s.source_id
                          ? "bg-zinc-50 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]"
                          : "hover:bg-zinc-50"
                      }`}
                      style={{
                        borderColor: colorBySourceId.get(s.source_id) ?? "#e4e4e7",
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <p
                          className="block w-full truncate rounded-md px-2 py-1 text-xs font-semibold"
                          style={{
                            backgroundColor: `${colorBySourceId.get(s.source_id) ?? "#e4e4e7"}33`,
                            color: "#111827",
                          }}
                        >
                          {idx + 1}. {s.source_channel_name || s.source_id}
                        </p>
                        <p className="text-[11px] text-zinc-500">
                          {s.source_id} · {s.videos} uploads · avg {formatThousands(s.avg_views)}
                        </p>
                        <NicheTagPills tags={s.niche_tags ?? []} />
                        <p className="mt-0.5 text-[10px] text-zinc-500">
                          Used on:{" "}
                          {s.used_on_channels?.length
                            ? s.used_on_channels.join(", ")
                            : "—"}
                        </p>
                      </div>
                      <div className="ml-2 flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${chip.cls}`}>
                          {chip.label}
                        </span>
                        <span className="text-xs font-semibold text-zinc-800">
                          {formatThousands(s.total_views)}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
          {error && (
            <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="mb-3" />

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs text-zinc-700">
              <thead>
                <tr>
                  <th className="pb-2 pr-4" colSpan={7}>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="font-semibold uppercase text-zinc-500">
                        Status filter
                      </span>
                      <button
                        type="button"
                        onClick={() => setStatusFilter("all")}
                        className={`rounded-full px-2 py-0.5 ${
                          statusFilter === "all"
                            ? "bg-zinc-900 text-white"
                            : "bg-zinc-100 text-zinc-700"
                        }`}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatusFilter("scale")}
                        className={`rounded-full px-2 py-0.5 ${
                          statusFilter === "scale"
                            ? "bg-emerald-700 text-white"
                            : "bg-emerald-100 text-emerald-800"
                        }`}
                      >
                        Scale
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatusFilter("test")}
                        className={`rounded-full px-2 py-0.5 ${
                          statusFilter === "test"
                            ? "bg-amber-700 text-white"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        Test
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatusFilter("pause")}
                        className={`rounded-full px-2 py-0.5 ${
                          statusFilter === "pause"
                            ? "bg-rose-700 text-white"
                            : "bg-rose-100 text-rose-800"
                        }`}
                      >
                        Pause
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatusFilter("unknown")}
                        className={`rounded-full px-2 py-0.5 ${
                          statusFilter === "unknown"
                            ? "bg-zinc-700 text-white"
                            : "bg-zinc-200 text-zinc-700"
                        }`}
                      >
                        Unknown
                      </button>
                    </div>
                  </th>
                </tr>
                <tr className="border-b border-zinc-200 text-[11px] uppercase text-zinc-500">
                  <th className="py-2 pr-4">Source</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4 text-right">
                    <button type="button" className="font-medium" onClick={() => toggleSort("videos")}>
                      Videos{sortIndicator("videos")}
                    </button>
                  </th>
                  <th className="py-2 pr-4 text-right">
                    <button type="button" className="font-medium" onClick={() => toggleSort("total_views")}>
                      Total Views{sortIndicator("total_views")}
                    </button>
                  </th>
                  <th className="py-2 pr-4 text-right">
                    <button type="button" className="font-medium" onClick={() => toggleSort("avg_views")}>
                      Avg Views{sortIndicator("avg_views")}
                    </button>
                  </th>
                  <th className="py-2 pr-4 text-right">
                    <button type="button" className="font-medium" onClick={() => toggleSort("outlier_count")}>
                      Outliers{sortIndicator("outlier_count")}
                    </button>
                  </th>
                  <th className="py-2 pr-4 text-right">
                    <button type="button" className="font-medium" onClick={() => toggleSort("outlier_ratio")}>
                      Outlier Ratio{sortIndicator("outlier_ratio")}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td className="py-4 text-center text-zinc-500" colSpan={7}>
                      Loading…
                    </td>
                  </tr>
                )}
                {!loading && data.length === 0 && !error && (
                  <tr>
                    <td className="py-4 text-center text-zinc-500" colSpan={7}>
                      No source data yet. Make sure new uploads include a
                      Source ID in the description.
                    </td>
                  </tr>
                )}
                {!loading &&
                  sortedData.map((s) => (
                    <tr
                      key={s.source_id}
                      className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50"
                      onClick={() => setSelectedSource(s)}
                    >
                      <td className="py-2 pr-4">
                        <div className="flex max-w-[220px] flex-col">
                          <span className="text-xs font-medium">
                            {s.source_channel_name || "Unknown source"}
                          </span>
                          <span className="font-mono text-[11px] text-zinc-500">
                            {s.source_id}
                          </span>
                          <NicheTagPills tags={s.niche_tags ?? []} />
                          <span className="mt-0.5 text-[10px] leading-snug text-zinc-500">
                            Used on:{" "}
                            {s.used_on_channels?.length
                              ? s.used_on_channels.join(", ")
                              : "—"}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 pr-4">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${getStatusChip(s).cls}`}
                        >
                          {getStatusChip(s).label}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {s.videos.toLocaleString()}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {s.total_views.toLocaleString()}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {s.avg_views.toLocaleString()}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {s.outlier_count.toLocaleString()}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {(s.outlier_ratio * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>

        {selectedSource && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
            <div className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-900">
                    Source Videos
                  </h2>
                  <p className="text-xs text-zinc-500">
                    {selectedSource.source_channel_name || "Unknown source"} ({selectedSource.source_id}) · {datePreset}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <NicheTagPills tags={selectedSource.niche_tags ?? []} />
                    <span className="text-[11px] text-zinc-500">
                      Used on:{" "}
                      {selectedSource.used_on_channels?.length
                        ? selectedSource.used_on_channels.join(", ")
                        : "—"}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedSource(null)}
                  className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                >
                  X
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {sourceVideosError && (
                  <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    {sourceVideosError}
                  </div>
                )}
                {sourceVideosLoading ? (
                  <div className="text-sm text-zinc-500">Loading...</div>
                ) : sourceVideos.length === 0 ? (
                  <div className="text-sm text-zinc-500">
                    No videos found for this source in the selected filters.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sourceVideos.map((item) => (
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
                              {item.views.toLocaleString()}
                            </span>
                            <span>
                              <span className="font-medium text-zinc-800">Channel:</span>{" "}
                              {item.mainChannelName}
                            </span>
                            <span>
                              <span className="font-medium text-zinc-800">Date:</span>{" "}
                              {item.publishedAt.slice(0, 10)}
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


