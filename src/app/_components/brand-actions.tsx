"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, api } from "./ui";
import { IconStar, IconTrash } from "./icons";
import { useFeedback } from "./feedback";

export function BrandActions({ brandId, name, isDefault }: { brandId: string; name: string; isDefault: boolean }) {
  const router = useRouter();
  const { confirm, toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, after: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (isDefault) return <p className="text-[13px] text-ink-3">New ads use this brand unless you pick another.</p>;
  return (
    <div className="grid justify-items-end gap-1">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => run(() => api(`/api/brands/${brandId}/default`, { method: "POST" }), () => {
              toast(`${name} is now the default brand.`);
              router.refresh();
            })}>
          <IconStar size={16} />
          Make default
        </Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={async () => {
            const ok = await confirm({ title: `Delete the brand “${name}”?`, body: "It disappears from the brand list. Ads already made with it keep working.", confirmLabel: "Delete brand", danger: true });
            if (ok)
              void run(() => api(`/api/brands/${brandId}`, { method: "DELETE" }), () => {
                toast(`Deleted the brand “${name}”.`);
                router.push("/brands");
              });
          }}
        >
          <IconTrash size={16} />
          Delete
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-[13px] font-semibold text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
