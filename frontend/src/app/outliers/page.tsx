"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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

export default function OutliersPage() {
  const [period, setPeriod] = useState<"all" | "7d" | "28d">("28d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OutliersResponse | null>(null);

  const formatThousands = (value: number) => {
    const n = Math.round(value);
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  };

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/outliers?period=${period}`);
        if (!res.ok) throw new Error("Failed to load outliers");
        const json = (await res.json()) as OutliersResponse;
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load outliers");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [period]);

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
        <header className="flex flex-col gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Outliers</h1>
          </div>
          <div className="flex w-full flex-wrap items-center gap-3">
            <nav className="flex gap-3 text-sm font-medium text-zinc-700">
              <Link
                href="/"
                className="rounded-full border border-zinc-300 px-4 py-1 hover:bg-zinc-100"
              >
                Dashboard
              </Link>
              <Link
                href="/channels"
                className="rounded-full border border-zinc-300 px-4 py-1 hover:bg-zinc-100"
              >
                Channels
              </Link>
              <Link
                href="/sources"
                className="rounded-full border border-zinc-300 px-4 py-1 hover:bg-zinc-100"
              >
                Sources
              </Link>
              <Link href="/outliers" className="rounded-full bg-zinc-900 px-4 py-1 text-zinc-50">
                Outliers
              </Link>
            </nav>

            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs font-medium uppercase text-zinc-500">
                Period
              </span>
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
          </div>
        </header>

        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-xs font-medium uppercase text-zinc-500">
            Outlier videos (&gt; 100k views)
          </p>
          <p className="mt-2 text-2xl font-semibold text-zinc-900">
            {loading ? "…" : formatThousands(data?.count ?? 0)}
          </p>
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {loading ? (
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
              Loading…
            </div>
          ) : !data || data.items.length === 0 ? (
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
              No outliers found in this period.
            </div>
          ) : (
            data.items.map((item) => (
              <article
                key={item.videoId}
                className="overflow-hidden rounded-2xl border border-zinc-200 bg-white"
              >
                <a href={item.videoUrl} target="_blank" rel="noreferrer">
                  <img
                    src={item.thumbnailUrl}
                    alt={item.title}
                    className="h-44 w-full object-cover"
                  />
                </a>
                <div className="p-4">
                  <p className="line-clamp-2 text-sm font-medium text-zinc-900">
                    {item.title}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-600">
                    <p>
                      <span className="font-medium text-zinc-800">Views: </span>
                      {formatThousands(item.views)}
                    </p>
                    <p>
                      <span className="font-medium text-zinc-800">Channel: </span>
                      {item.mainChannelName}
                    </p>
                    <p>
                      <span className="font-medium text-zinc-800">Source: </span>
                      {item.sourceName}
                    </p>
                    <p>
                      <span className="font-medium text-zinc-800">Source ID: </span>
                      {item.sourceId || "—"}
                    </p>
                  </div>
                </div>
              </article>
            ))
          )}
        </section>
      </div>
    </main>
  );
}

