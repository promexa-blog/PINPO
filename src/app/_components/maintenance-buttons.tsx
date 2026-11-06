"use client";

import { useState } from "react";
import { Button } from "./ui";

export function MaintenanceButtons() {
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (url: string, label: string) => {
    const r = await fetch(url, { method: "POST" });
    setMsg(r.ok ? `${label} queued — the worker runs it in the background.` : `${label} couldn't be queued.`);
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" onClick={() => run("/api/system/gc", "Clean-up")}>
        Free up space
      </Button>
      <Button variant="secondary" onClick={() => run("/api/system/backup", "Backup")}>
        Back up database now
      </Button>
      {msg ? <p role="status" className="text-sm">{msg}</p> : null}
    </div>
  );
}
