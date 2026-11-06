import { notFound, redirect } from "next/navigation";
import { db } from "@/server/db";
import { Overview } from "../../_components/overview";
import { AdHeading } from "../../_components/ad-heading";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ad" };

export default async function AdPage({ params }: { params: Promise<{ adId: string }> }) {
  const { adId } = await params;
  const ad = db().prepare("SELECT a.id, a.name, a.current_version_id, k.name AS brand_name FROM ads a LEFT JOIN brand_kits k ON k.id = a.brand_kit_id WHERE a.id = ? AND a.deleted_at IS NULL").get(adId) as
    | { id: string; name: string; current_version_id: string; brand_name: string | null }
    | undefined;
  if (!ad) notFound();
  const v = db().prepare("SELECT status, number FROM ad_versions WHERE id = ?").get(ad.current_version_id) as { status: string; number: number };
  if (v.status === "draft") redirect(`/ads/${ad.id}/edit`);
  return (
    <main id="main" className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
      <AdHeading name={ad.name} brandName={ad.brand_name} eyebrow={`Version ${v.number}`} />
      <Overview key={ad.current_version_id} versionId={ad.current_version_id} adId={ad.id} />
    </main>
  );
}
