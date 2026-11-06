"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconTrash } from "./icons";
import { buttonClass } from "./ui";

export function TemplateDelete({ templateKey, name }: { templateKey: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid justify-items-end">
      <button
        type="button"
        aria-label={`Delete template ${name}`}
        className={buttonClass("quiet", "sm")}
        onClick={async () => {
          if (!window.confirm(`Delete the template "${name}"?\n\nAds made from it aren't affected.`)) return;
          const r = await fetch(`/api/templates/${templateKey}`, { method: "DELETE" });
          if (r.ok) router.refresh();
          else setError("Couldn't delete the template. Try again.");
        }}
      >
        <IconTrash size={15} />
        Delete
      </button>
      {error ? (
        <p role="alert" className="text-xs font-semibold text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
