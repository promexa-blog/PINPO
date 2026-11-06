"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, Input, Textarea, api } from "./ui";

interface Props {
  brandId: string;
  tagline: string;
  groupBuyLine: string;
  approvedCtas: { en: string[]; ml: string[]; hi: string[] };
  instagram: string;
}

/** Brand copy editing behind an explicit unlock; saving creates a revision and re-locks (plan §3). */
export function BrandEditor(props: Props) {
  const router = useRouter();
  const [unlocked, setUnlocked] = useState(false);
  const [tagline, setTagline] = useState(props.tagline);
  const [groupBuyLine, setGroupBuyLine] = useState(props.groupBuyLine);
  const [ctas, setCtas] = useState({ en: props.approvedCtas.en.join("\n"), ml: props.approvedCtas.ml.join("\n"), hi: props.approvedCtas.hi.join("\n") });
  const [instagram, setInstagram] = useState(props.instagram);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  if (!unlocked)
    return (
      <div className="grid gap-2">
        <p className="text-sm text-dm-secondary">Brand settings are locked so ads stay on-brand. Colours, logo and website can&apos;t be changed here.</p>
        <Button
          variant="secondary"
          className="justify-self-start"
          onClick={async () => {
            if (!window.confirm("Unlock brand settings for 10 minutes? Saving creates a new brand revision; existing ads keep theirs.")) return;
            await api(`/api/brands/${props.brandId}/unlock`, { method: "POST" });
            setUnlocked(true);
          }}
        >
          Unlock brand settings
        </Button>
      </div>
    );

  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setMsg(null);
        try {
          await api(`/api/brands/${props.brandId}`, { method: "PATCH", body: JSON.stringify({ tagline, groupBuyLine, approvedCtas: { en: lines(ctas.en), ml: lines(ctas.ml), hi: lines(ctas.hi) }, social: { instagram }, note: note || undefined }) });
          setUnlocked(false);
          setMsg("Saved as a new brand revision. Brand settings are locked again.");
          router.refresh();
        } catch (err) {
          setMsg((err as Error).message);
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tagline" htmlFor="b-tag">
          <Input id="b-tag" value={tagline} maxLength={80} onChange={(e) => setTagline(e.target.value)} />
        </Field>
        <Field label="Group-buy line" htmlFor="b-gb">
          <Input id="b-gb" value={groupBuyLine} maxLength={80} onChange={(e) => setGroupBuyLine(e.target.value)} />
        </Field>
        {(["en", "ml", "hi"] as const).map((l) => (
          <Field key={l} label={`Approved calls to action (${{ en: "English", ml: "Malayalam", hi: "Hindi" }[l]}) — one per line`} htmlFor={`b-cta-${l}`}>
            <Textarea id={`b-cta-${l}`} lang={l} value={ctas[l]} onChange={(e) => setCtas({ ...ctas, [l]: e.target.value })} />
          </Field>
        ))}
        <Field label="Instagram" htmlFor="b-ig">
          <Input id="b-ig" value={instagram} maxLength={60} onChange={(e) => setInstagram(e.target.value)} />
        </Field>
        <Field label="What changed (for the revision history)" htmlFor="b-note">
          <Input id="b-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="flex gap-3">
        <Button type="submit">Save new revision</Button>
        <Button type="button" variant="quiet" onClick={() => setUnlocked(false)}>
          Cancel
        </Button>
      </div>
      {msg ? <p role="status" className="text-sm font-semibold">{msg}</p> : null}
    </form>
  );
}
