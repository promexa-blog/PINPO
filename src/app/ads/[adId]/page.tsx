import { notFound, redirect } from "next/navigation";
import { db } from "@/server/db";
import { StudioHeader } from "../../_components/header";
import { Overview } from "../../_components/overview";

export const dynamic = "force-dynamic";

export default async function AdPage({ params }: { params: Promise<{ adId: string }> }) {
  const { adId } = await params;
  const ad = db().prepare("SELECT id, name, current_version_id FROM ads WHERE id = ? AND deleted_at IS NULL").get(adId) as { id: string; name: string; current_version_id: string } | undefined;
  if (!ad) notFound();
  const status = (db().prepare("SELECT status FROM ad_versions WHERE id = ?").get(ad.current_version_id) as { status: string }).status;
  if (status === "draft") redirect(`/ads/${ad.id}/edit`);
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-8">
      <StudioHeader crumb={{ href: `/ads/${ad.id}`, label: ad.name }} />
      <h1 className="mt-6 mb-4 text-2xl font-bold tracking-tight">{ad.name}</h1>
      <Overview key={ad.current_version_id} versionId={ad.current_version_id} adId={ad.id} />
    </div>
  );
}
