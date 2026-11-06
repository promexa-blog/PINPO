import Link from "next/link";
import { IconArrowLeft } from "./icons";

/** Ad page heading: back to library, ad name, brand. */
export function AdHeading({ name, brandName, eyebrow }: { name: string; brandName: string | null; eyebrow: string }) {
  return (
    <div className="pt-5">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink">
        <IconArrowLeft size={16} />
        All ads
      </Link>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[1.5rem] font-semibold leading-tight tracking-tight">{name}</h1>
        <p className="text-sm text-ink-2">
          {eyebrow}
          {brandName ? ` · ${brandName}` : ""}
        </p>
      </div>
    </div>
  );
}
