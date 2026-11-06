"use client";

import { useState } from "react";
import { Button } from "./ui";
import { useFeedback } from "./feedback";

export function MaintenanceButtons() {
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const run = async (url: string, label: string) => {
    setBusy(true);
    try {
      const r = await fetch(url, { method: "POST" });
      toast(r.ok ? `${label} started — the worker runs it in the background.` : `${label} couldn't start. Is the worker running?`, r.ok ? "ok" : "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" disabled={busy} onClick={() => run("/api/system/gc", "Clean-up")}>
        Free up space
      </Button>
      <Button variant="secondary" disabled={busy} onClick={() => run("/api/system/backup", "Backup")}>
        Back up database now
      </Button>
    </div>
  );
}
