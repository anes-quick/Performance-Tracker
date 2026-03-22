import { Suspense } from "react";
import { HomeDashboard } from "@/components/HomeDashboard";

function DashboardSkeleton() {
  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
        <header className="flex flex-col gap-4">
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <div className="h-9 w-full max-w-md animate-pulse rounded-full bg-zinc-200" />
        </header>
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-2xl border border-zinc-200 bg-white"
            />
          ))}
        </section>
        <section className="h-[320px] animate-pulse rounded-2xl border border-zinc-200 bg-white" />
        <p className="text-center text-sm text-zinc-500">Loading dashboard…</p>
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <HomeDashboard />
    </Suspense>
  );
}
