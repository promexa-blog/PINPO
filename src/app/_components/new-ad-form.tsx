"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PLATFORMS, type PlatformKey } from "@/lib/platforms";
import { Button, Field, Input, Select, api } from "./ui";

export function NewAdForm({ templates }: { templates: { key: string; name: string; description: string; platforms: string[] }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [templateKey, setTemplateKey] = useState(templates[0]?.key ?? "");
  const [platform, setPlatform] = useState<PlatformKey>("instagram_reels");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const template = templates.find((t) => t.key === templateKey);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ adId: string }>("/api/ads", { method: "POST", body: JSON.stringify({ name: name.trim() || "Untitled ad", templateKey, platform }) });
      router.push(`/ads/${r.adId}/edit`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-xl border border-dm-border bg-dm-surface p-4 sm:grid-cols-[2fr_1.5fr_1.5fr_auto] sm:items-end">
      <Field label="Ad name" htmlFor="ad-name">
        <Input id="ad-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Steel lunch box — Reels" maxLength={120} />
      </Field>
      <Field label="Template" htmlFor="ad-template" hint={template?.description}>
        <Select id="ad-template" value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
          {templates.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Where it runs" htmlFor="ad-platform">
        <Select id="ad-platform" value={platform} onChange={(e) => setPlatform(e.target.value as PlatformKey)}>
          {Object.values(PLATFORMS)
            .filter((p) => !template || template.platforms.includes(p.key))
            .map((p) => (
              <option key={p.key} value={p.key}>
                {p.label} ({p.aspect})
              </option>
            ))}
        </Select>
      </Field>
      <Button type="submit" disabled={busy || !templateKey}>
        {busy ? "Creating…" : "Create ad"}
      </Button>
      {error ? (
        <p role="alert" className="text-sm font-semibold sm:col-span-4">
          {error}
        </p>
      ) : null}
    </form>
  );
}
