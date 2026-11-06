import { redirect } from "next/navigation";

/** Old single-brand page → brand kits. */
export default function BrandPage() {
  redirect("/brands");
}
