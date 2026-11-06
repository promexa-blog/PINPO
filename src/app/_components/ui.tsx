import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { IconChevronDown } from "./icons";

/** PINPO studio primitives (tokens from globals.css). One control vocabulary everywhere. */

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export function buttonClass(variant: ButtonVariant = "primary", size: "md" | "sm" = "md") {
  const base =
    "inline-flex select-none items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45";
  const sizes = { md: "min-h-10 px-3.5 text-sm", sm: "min-h-8 px-2.5 text-[13px]" }[size];
  const styles = {
    primary: "bg-accent text-accent-ink hover:bg-accent-hover disabled:bg-panel-2 disabled:text-ink-3 disabled:opacity-100 disabled:ring-1 disabled:ring-line",
    secondary: "border border-line bg-panel-2 text-ink hover:border-line-strong",
    quiet: "text-ink-2 hover:bg-panel-2 hover:text-ink",
    danger: "border border-bad/45 text-bad hover:bg-bad-soft",
  }[variant];
  return `${base} ${sizes} ${styles}`;
}

export function Button({ variant = "primary", size = "md", className = "", type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "md" | "sm" }) {
  return <button type={type} {...props} className={`${buttonClass(variant, size)} ${className}`} />;
}

export function Field({ label, hint, error, children, htmlFor, optional }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor: string; optional?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-semibold text-ink">
        {label}
        {optional ? <span className="ml-1.5 font-normal text-ink-3">optional</span> : null}
      </label>
      {children}
      {hint ? <p className="text-xs leading-relaxed text-ink-3">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-xs font-semibold text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const control =
  "min-h-10 w-full min-w-0 rounded-lg border border-line bg-sunken px-3 text-sm text-ink transition-colors duration-150 placeholder:text-ink-3 hover:border-line-strong focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 disabled:opacity-50 read-only:text-ink-2";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${control} ${props.className ?? ""}`} />;
}
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative min-w-0">
      <select {...props} className={`${control} appearance-none pr-9 ${className ?? ""}`} />
      <IconChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3" />
    </div>
  );
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${control} min-h-24 py-2.5 leading-relaxed ${props.className ?? ""}`} />;
}

export function Checkbox({ id, label, checked, onChange, hint }: { id: string; label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-[18px] shrink-0 cursor-pointer" />
      <label htmlFor={id} className="cursor-pointer text-sm leading-snug">
        {label}
        {hint ? <span className="mt-0.5 block text-xs text-ink-3">{hint}</span> : null}
      </label>
    </div>
  );
}

export function Section({ id, title, description, children, actions, className = "" }: { id?: string; title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={`rounded-xl border border-line bg-panel p-4 sm:p-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id ? `${id}-title` : undefined} className="text-base font-semibold tracking-tight">
            {title}
          </h2>
          {description ? <p className="mt-1 max-w-prose text-[13px] text-ink-2">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export type Tone = "ok" | "warn" | "bad" | "neutral" | "accent";

export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  const t = {
    ok: "bg-ok-soft text-ok",
    warn: "bg-warn-soft text-warn",
    bad: "bg-bad-soft text-bad",
    neutral: "bg-panel-2 text-ink-2",
    accent: "bg-accent-soft text-accent-text",
  }[tone];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${t}`}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function PageTitle({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pt-8 pb-6">
      <div className="min-w-0">
        <h1 className="text-[1.625rem] font-semibold leading-tight tracking-tight">{title}</h1>
        {description ? <p className="mt-1.5 max-w-prose text-sm text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Notice({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  const t = { ok: "border-ok/35 bg-ok-soft", warn: "border-warn/40 bg-warn-soft", bad: "border-bad/40 bg-bad-soft", neutral: "border-line bg-panel-2", accent: "border-accent/40 bg-accent-soft" }[tone];
  return <div className={`rounded-lg border px-3.5 py-3 text-sm ${t}`}>{children}</div>;
}

export const usd = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `$${n.toFixed(n < 1 ? 3 : 2)}`);

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; items?: { message: string }[]; fields?: { path: string; message: string }[] } };
    const items = body.error?.items?.map((i) => i.message) ?? body.error?.fields?.map((f) => f.message) ?? [];
    const err = new Error([body.error?.message ?? `Request failed (${res.status})`, ...items].join("\n")) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
