import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { Editor } from "../../../_components/editor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit ad" };

export default async function EditPage({ params }: { params: Promise<{ adId: string }> }) {
  const { adId } = await params;
  const ad = db().prepare("SELECT a.id, a.name, a.current_version_id, k.name AS brand_name FROM ads a LEFT JOIN brand_kits k ON k.id = a.brand_kit_id WHERE a.id = ? AND a.deleted_at IS NULL").get(adId) as
    | { id: string; name: string; current_version_id: string; brand_name: string | null }
    | undefined;
  if (!ad) notFound();
  const n = (db().prepare("SELECT number FROM ad_versions WHERE id = ?").get(ad.current_version_id) as { number: number }).number;
  return (
    <main id="main" className="pb-20">
      <Editor versionId={ad.current_version_id} adId={ad.id} title={{ name: ad.name, meta: `Draft · version ${n}${ad.brand_name ? ` · ${ad.brand_name}` : ""}` }} />
    </main>
  );
}
