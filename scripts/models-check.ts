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
  const res = await fetch(url, { headers: { "User-Agent": "pinpo-models-check" } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json();
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
  const endpoint = model.endpoints[mode];
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
  for (const endpoint of Object.values(model.endpoints)) {
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
  const text = await getText(`https://fal.ai/models/${model.endpoints.t2v}/llms.txt`);
  const current = model.pricing.periods[model.pricing.periods.length - 1]!;
  for (const [res, usd] of Object.entries(current.perSecond)) {
    const needle = `$${usd}`;
    if (!text.includes(needle) && !text.includes(`$${usd.toFixed(3)}`)) fail(`${model.id}: ${res} price ${needle}/s not found in fal pricing text — re-verify`);
  }
  note(`prices checked against llms.txt`);
}

async function main() {
  for (const model of Object.values(MODELS)) {
    console.log(`\n${model.label} (verified ${model.verifiedAt})`);
    for (const mode of Object.keys(model.endpoints) as GenMode[]) await checkEndpoint(model, mode);
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
