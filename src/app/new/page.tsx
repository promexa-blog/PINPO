import Link from "next/link";
import { redirect } from "next/navigation";
import { listBrands } from "@/server/brand/kits";
import { templateCards } from "@/server/planning/template-cards";
import { NewAdForm } from "../_components/new-ad-form";
import { IconArrowLeft } from "../_components/icons";

export const dynamic = "force-dynamic";
export const metadata = { title: "New ad" };

export default async function NewAdPage({ searchParams }: { searchParams: Promise<{ template?: string; brand?: string }> }) {
  const { template, brand } = await searchParams;
  const brands = listBrands();
  if (!brands.length) redirect("/brands/new?next=new");
  return (
    <main id="main" className="mx-auto max-w-7xl px-4 pb-32 sm:px-6">
      <Link href="/" className="mt-6 inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink">
        <IconArrowLeft size={16} />
        All ads
      </Link>
      <h1 className="mt-3 text-[1.625rem] font-semibold tracking-tight">New ad</h1>
      <p className="mt-1.5 max-w-prose text-sm text-ink-2">Choose who it&apos;s for, how the story goes and where it runs. You&apos;ll add the product and the details next.</p>
      <NewAdForm brands={brands} templates={templateCards()} initialTemplate={template} initialBrand={brand} />
    </main>
  );
}
