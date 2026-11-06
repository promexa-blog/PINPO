import Link from "next/link";
import { BrandForm, EMPTY_BRAND } from "../../_components/brand-form";
import { IconArrowLeft } from "../../_components/icons";

export const metadata = { title: "New brand" };

export default async function NewBrandPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main id="main" className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
      <Link href={next === "new" ? "/new" : "/brands"} className="mt-6 inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink">
        <IconArrowLeft size={16} />
        {next === "new" ? "New ad" : "Brands"}
      </Link>
      <h1 className="mt-3 text-[1.625rem] font-semibold tracking-tight">New brand</h1>
      <p className="mt-1.5 mb-6 max-w-prose text-sm text-ink-2">Set it up once. The preview shows exactly how your ads will end.</p>
      <BrandForm mode="create" initial={EMPTY_BRAND} next={next} />
    </main>
  );
}
