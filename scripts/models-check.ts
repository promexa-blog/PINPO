/**
 * Verifies the model registry against fal's live data (plan §8): OpenAPI input schemas,
 * llms.txt list prices and catalog status/retirement. Exits non-zero on any mismatch.
 * Run before releases and whenever fal announces model changes:  npx tsx scripts/models-check.ts
 */
import { MODELS, type ModelSpec, type GenMode } from "../src/server/models/registry";

type Schema = { properties?: Record<string, { enum?: string[]; anyOf?: { minimum?: number; maximum?: number; type?: string }[]; minimum?: number; maximum?: number }>; required?: string[] };

const problems: string[] = [];
const note = (m: string) => console.log(`  ${m}`);
const fail = (m: string) => {
  problems.push(m);
  console.log(`  ✗ ${m}`);
};

async function getJson(url: string): Promise<unknown> {
  // The catalog API rate-limits bursts (Phase 0): back off on 429 instead of failing.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "pinpo-models-check" } });
    if (res.status === 429 && attempt < 6) {
      const wait = Number(res.headers.get("retry-after") ?? 0) * 1000 || 5000 * (attempt + 1);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    return res.json();
  }
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "pinpo-models-check" } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.text();
}

async function inputSchema(endpoint: string): Promise<Schema> {
  const doc = (await getJson(`https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(endpoint)}`)) as { components: { schemas: Record<string, Schema> } };
  const key = Object.keys(doc.components.schemas).find((k) => /Input$/.test(k));
  if (!key) throw new Error(`No Input schema for ${endpoint}`);
  return doc.components.schemas[key]!;
}

async function checkEndpoint(model: ModelSpec, mode: GenMode) {
  const endpoint = model.endpoints[mode]!;
  console.log(`• ${endpoint}`);
  const live = await inputSchema(endpoint);
  const ours = model.inputSchema[mode] as unknown as { shape: Record<string, unknown> };
  const liveProps = Object.keys(live.properties ?? {});
  for (const key of Object.keys(ours.shape)) {
    if (!liveProps.includes(key)) fail(`${endpoint}: we send "${key}" but fal no longer accepts it`);
  }
  for (const req of live.required ?? []) {
    if (!(req in ours.shape)) fail(`${endpoint}: fal now requires "${req}"`);
  }
  const dur = live.properties?.duration;
  const range = dur?.anyOf?.find((a) => a.minimum !== undefined) ?? dur;
  if (range?.minimum !== undefined && range.minimum !== model.durations.min) fail(`${endpoint}: duration min ${range.minimum} ≠ registry ${model.durations.min}`);
  if (range?.maximum !== undefined && range.maximum !== model.durations.max) fail(`${endpoint}: duration max ${range.maximum} ≠ registry ${model.durations.max}`);
  note(`schema ok (${liveProps.length} fields)`);
}

async function checkCatalog(model: ModelSpec) {
  for (const endpoint of Object.values(model.endpoints).filter((e): e is string => !!e)) {
    const data = (await getJson(`https://api.fal.ai/v1/models?endpoint_id=${encodeURIComponent(endpoint)}`)) as { models: { metadata: { status: string; license_type?: string; retires_at?: string | null } }[] };
    const meta = data.models[0]?.metadata;
    if (!meta) {
      fail(`${endpoint}: not in fal catalog`);
      continue;
    }
    if (meta.status !== "active") fail(`${endpoint}: status ${meta.status}`);
    if (meta.retires_at) fail(`${endpoint}: retires at ${meta.retires_at}`);
    if (meta.license_type !== "commercial") fail(`${endpoint}: license_type ${meta.license_type ?? "missing"} (provenance needs review)`);
    await new Promise((r) => setTimeout(r, 1500)); // catalog API rate-limits bursts (Phase 0)
  }
}

async function checkPrice(model: ModelSpec) {
  const tables: [string, { perSecond: Partial<Record<string, number>>; audioPerSecond?: Partial<Record<string, number>> }][] = [
    ["t2v", model.pricing.periods[model.pricing.periods.length - 1]!],
  ];
  for (const [mode, periods] of Object.entries(model.pricing.modes ?? {})) if (periods?.length) tables.push([mode, periods[periods.length - 1]!]);
  for (const [mode, table] of tables) {
    const endpoint = model.endpoints[mode as GenMode] ?? model.endpoints.t2v!;
    const text = await getText(`https://fal.ai/models/${endpoint}/llms.txt`);
    const has = (usd: number) => [String(usd), usd.toFixed(2), usd.toFixed(3), usd.toFixed(4)].some((v) => text.includes(`$${v}`));
    for (const [res, usd] of Object.entries(table.perSecond)) {
      if (usd === undefined) continue;
      if (!has(usd)) fail(`${model.id} (${mode}): ${res} price $${usd}/s not found in fal pricing text — re-verify`);
      const audio = table.audioPerSecond?.[res];
      if (audio !== undefined && !has(Math.round((usd + audio) * 10_000) / 10_000)) fail(`${model.id} (${mode}): ${res} price with audio not found — re-verify`);
    }
  }
  note(`prices checked against llms.txt${model.pricing.estimate ? " (token-billed; per-second figures are fal's approximations)" : ""}`);
}

async function main() {
  for (const model of Object.values(MODELS)) {
    console.log(`\n${model.label} (verified ${model.verifiedAt})`);
    for (const mode of (Object.keys(model.endpoints) as GenMode[]).filter((m) => model.endpoints[m])) await checkEndpoint(model, mode);
    await checkCatalog(model);
    await checkPrice(model);
  }
  if (problems.length) {
    console.log(`\n${problems.length} problem(s). Update src/server/models/registry.ts from fal's docs, then re-run.`);
    process.exit(1);
  }
  console.log("\nRegistry matches fal.");
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
