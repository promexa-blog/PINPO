"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

/** Small DemandMesh-styled primitives (tokens from globals.css). */

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" | "danger" }) {
  const styles = {
    primary: "bg-dm-primary text-white hover:bg-dm-hover disabled:bg-dm-secondary",
    secondary: "border border-dm-border bg-dm-bg text-dm-primary hover:bg-dm-surface disabled:text-dm-secondary",
    quiet: "text-dm-primary underline-offset-4 hover:underline disabled:text-dm-secondary",
    danger: "border border-dm-primary bg-dm-bg text-dm-primary hover:bg-dm-secondary-light",
  }[variant];
  return <button {...props} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${styles} ${className}`} />;
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string | null; children: ReactNode; htmlFor: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-dm-secondary">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-xs font-semibold text-dm-primary">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const control = "min-h-11 w-full rounded-lg border border-dm-border bg-dm-bg px-3 text-sm text-dm-primary placeholder:text-dm-secondary focus-visible:border-dm-primary";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${control} ${props.className ?? ""}`} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${control} ${props.className ?? ""}`} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${control} min-h-24 py-2 ${props.className ?? ""}`} />;
}

export function Checkbox({ id, label, checked, onChange, hint }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 size-5 shrink-0 accent-[#0C1C28]" />
      <label htmlFor={id} className="text-sm">
        {label}
        {hint ? <span className="block text-xs text-dm-secondary">{hint}</span> : null}
      </label>
    </div>
  );
}

export function Section({ id, title, description, children, actions }: { id?: string; title: string; description?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="rounded-xl border border-dm-border bg-dm-bg p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={id ? `${id}-title` : undefined} className="text-lg font-bold tracking-tight">
            {title}
          </h2>
          {description ? <p className="mt-1 max-w-prose text-sm text-dm-secondary">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Status({ tone, children }: { tone: "ok" | "warn" | "bad" | "neutral"; children: ReactNode }) {
  const t = {
    ok: "bg-dm-secondary-light text-dm-primary",
    warn: "border border-dm-secondary text-dm-primary",
    bad: "bg-dm-primary text-white",
    neutral: "bg-dm-surface text-dm-secondary",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${t}`}>{children}</span>;
}

export const usd = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `$${n.toFixed(n < 1 ? 3 : 2)}`);

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; items?: { message: string }[]; fields?: { path: string; message: string }[] } };
    const items = body.error?.items?.map((i) => i.message) ?? body.error?.fields?.map((f) => `${f.path}: ${f.message}`) ?? [];
    const err = new Error([body.error?.message ?? `Request failed (${res.status})`, ...items].join("\n")) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
