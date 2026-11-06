import { getMasterBrand } from "@/server/brand/master";
import { SystemStatusPanel } from "@/components/status/system-status";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const brand = getMasterBrand();
  const logo = brand?.logos.find((l) => l.variant === "horizontal");
  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 sm:px-8">
      <header className="flex items-center justify-between border-b border-dm-border py-5">
        <div className="flex items-center gap-4">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- official logo served as-is, never re-processed
            <img src={`/api/assets/${logo.assetId}`} alt="DemandMesh" width={logo.width ?? 152} height={logo.height ?? 31} className="h-7 w-auto" />
          ) : (
            <span className="text-lg font-bold">DemandMesh</span>
          )}
          <span className="hidden text-sm text-dm-secondary sm:inline">Ad Studio</span>
        </div>
      </header>
      <main className="flex-1 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Ads</h1>
        <p className="mt-2 max-w-prose text-dm-secondary">
          Your DemandMesh ads will appear here. Creating ads arrives in the next build step.
        </p>
        <section aria-labelledby="system-heading" className="mt-10">
          <h2 id="system-heading" className="text-base font-semibold">
            Studio status
          </h2>
          <SystemStatusPanel />
        </section>
      </main>
    </div>
  );
}
