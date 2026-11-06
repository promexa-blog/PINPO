"use client";

import { useRouter } from "next/navigation";

export function TemplateDelete({ templateKey, name }: { templateKey: string; name: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="min-h-11 rounded-lg px-3 text-xs font-semibold hover:bg-dm-surface"
      onClick={async () => {
        if (!window.confirm(`Delete the template "${name}"? Ads made from it are not affected.`)) return;
        const r = await fetch(`/api/templates/${templateKey}`, { method: "DELETE" });
        if (r.ok) router.refresh();
      }}
    >
      Delete
    </button>
  );
}
