"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "./ui";
import { IconAlert, IconCheck, IconInfo, IconX } from "./icons";

/**
 * In-app confirmations, prompts and notices (replaces window.confirm/prompt/alert).
 * Dialogs use native <dialog>.showModal(): focus is trapped, Escape cancels, focus returns to the
 * trigger. Notices are announced through a polite live region.
 */

type Tone = "ok" | "info" | "bad";
interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}
interface PromptOptions {
  title: string;
  body?: ReactNode;
  label: string;
  defaultValue?: string;
  confirmLabel: string;
  maxLength?: number;
}
interface Request {
  kind: "confirm" | "prompt";
  opts: ConfirmOptions & Partial<PromptOptions>;
  resolve: (v: boolean | string | null) => void;
}
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

interface Feedback {
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  prompt: (o: PromptOptions) => Promise<string | null>;
  toast: (message: string, tone?: Tone) => void;
}

const Ctx = createContext<Feedback | null>(null);

export function useFeedback(): Feedback {
  const c = useContext(Ctx);
  if (!c) throw new Error("useFeedback must be used inside <FeedbackProvider>");
  return c;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<Request | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => setReq({ kind: "confirm", opts, resolve: (v) => resolve(v === true) })), []);
  const prompt = useCallback((opts: PromptOptions) => new Promise<string | null>((resolve) => setReq({ kind: "prompt", opts: { ...opts }, resolve: (v) => resolve(typeof v === "string" ? v : null) })), []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (message: string, tone: Tone = "ok") => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-2), { id, message, tone }]);
      window.setTimeout(() => dismiss(id), tone === "bad" ? 7000 : 4000);
    },
    [dismiss],
  );

  return (
    <Ctx.Provider value={{ confirm, prompt, toast }}>
      {children}
      {req ? (
        <FeedbackDialog
          key={req.opts.title}
          req={req}
          onClose={(v) => {
            req.resolve(v);
            setReq(null);
          }}
        />
      ) : null}
      <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-end sm:p-6">
        {toasts.map((t) => (
          <div key={t.id} role="status" className="toast-enter pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-sm shadow-lift">
            <span aria-hidden className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${t.tone === "ok" ? "bg-ok-soft text-ok" : t.tone === "bad" ? "bg-bad-soft text-bad" : "bg-accent-soft text-accent-text"}`}>
              {t.tone === "ok" ? <IconCheck size={12} strokeWidth={2.5} /> : t.tone === "bad" ? <IconAlert size={12} /> : <IconInfo size={12} />}
            </span>
            <p className="min-w-0 flex-1 leading-snug">{t.message}</p>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="-mr-1 grid size-6 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-panel-2 hover:text-ink">
              <IconX size={14} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

function FeedbackDialog({ req, onClose }: { req: Request; onClose: (v: boolean | string | null) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const [value, setValue] = useState(req.opts.defaultValue ?? "");
  const { opts } = req;

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const cancel = () => onClose(req.kind === "confirm" ? false : null);
  const ok = () => {
    if (req.kind === "prompt") {
      if (!value.trim()) return;
      onClose(value.trim());
    } else onClose(true);
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${uid}-t`}
      aria-describedby={opts.body ? `${uid}-b` : undefined}
      onCancel={(e) => {
        e.preventDefault();
        cancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current) cancel(); // click on the backdrop
      }}
      className="dialog-enter m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-line bg-panel p-0 text-ink shadow-lift backdrop:bg-black/55"
    >
      <form
        method="dialog"
        className="grid gap-4 p-5 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          ok();
        }}
      >
        <div className="flex items-start gap-3">
          {opts.danger ? (
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-bad-soft text-bad">
              <IconAlert size={18} />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 id={`${uid}-t`} className="text-base font-semibold tracking-tight">
              {opts.title}
            </h2>
            {opts.body ? (
              <div id={`${uid}-b`} className="mt-1.5 text-sm leading-relaxed text-ink-2">
                {opts.body}
              </div>
            ) : null}
          </div>
        </div>
        {req.kind === "prompt" ? (
          <div className="grid gap-1.5">
            <label htmlFor={`${uid}-i`} className="text-[13px] font-semibold">
              {opts.label}
            </label>
            <input
              id={`${uid}-i`}
              autoFocus
              value={value}
              maxLength={opts.maxLength ?? 80}
              onChange={(e) => setValue(e.target.value)}
              className="min-h-10 w-full rounded-lg border border-line bg-sunken px-3 text-sm text-ink hover:border-line-strong focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
            />
          </div>
        ) : null}
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={cancel} autoFocus={req.kind === "confirm"}>
            {opts.cancelLabel ?? "Cancel"}
          </Button>
          <Button type="submit" variant={opts.danger ? "danger" : "primary"} disabled={req.kind === "prompt" && !value.trim()} className={opts.danger ? "bg-bad-soft" : ""}>
            {opts.confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
