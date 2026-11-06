# PINPO — DemandMesh AI Ad Studio: Implementation Plan (v2.2)

> v2.2 = v2.1 with targeted refinements only (marked **[v2.2]**). Architecture, stack, features, folder structure, schema, API and branding are unchanged except where marked. First step after approval: save this file as `docs/engineering/PINPO_IMPLEMENTATION_PLAN_V2.2.md`.

## 0. Context
PINPO is the **dedicated AI advertisement production studio for DemandMesh** (demandmesh.shop). DemandMesh is a Kerala, India online shop selling fashion & accessories, health & personal care, home & kitchen, and office & stationery. Its group buys are pitched as "Buy it now, or buy together for less". Its tagline is "Where demands connects." Its Instagram is @demandmesh.

The app runs locally for one user. That user writes a structured creative brief, picks a template, and gets an editable storyboard, generated without an LLM. Scenes are generated with fal.ai, then composed locally with the official DemandMesh brand: overlays, voiceover, music, and the DemandMesh outro. Every ad then passes technical validation and creative/brand QA before it is exported in the chosen social format.

**Approved decisions (unchanged):**
- Next.js 16, React 19 and TypeScript
- fal.ai as the only video provider, with one key used server-side only
- SQLite for storage
- Local FFmpeg for composition
- 15–60s ads built from several scenes
- A mock mode that generates fake clips
- Local file storage
- Overlays, end cards, music and an ad library
- **No** Claude prompt improvement
- Single local user
- A persistent background worker with leases and recovery (v2)

**Added in v2.1:**
- DemandMesh master brand kit (protected and the default)
- Creative brief and a rule-based storyboard
- 7 templates plus a group-buy template
- DemandMesh outro system with 4 types
- Creative/brand QA report
- Imported voiceover and audio editing
- Three cost levels: estimated, calculated and provider-confirmed
- Product preservation, including scenes built from the original product photo
- Malayalam and Hindi text support

**Inputs confirmed by the user (2026-11-06):**
- **Logo:** use the website PNG (`/brand/demandmesh/demandmesh-horizontal-trimmed-304x62.png`) as a temporary official logo. It is low resolution, so it will be replaced later. It is never AI-upscaled, and QA flags it as low-res.
- **Fonts:** a free placeholder family for now, easy to swap. I picked **Noto Sans + Noto Sans Malayalam + Noto Sans Devanagari** (OFL licence, one consistent design, and covers ₹).
- **Languages:** English, Malayalam and Hindi.
- **Templates:** add the 8th, group-buy template.

---

## 1. Architecture
```
 Browser (React UI) ──same-origin HTTP (127.0.0.1)──▶ Next.js (UI + API, no fal, no ffmpeg)
                                                          │ read/write (GET has no side effects)
                                                          ▼
                                                SQLite (WAL) data/studio.db
                                                          ▲ leases, heartbeats, jobs
 fal.ai queue API ◀──submit/status/result/cancel── Worker process (tsx, long-running)
                                                          ├─ ffmpeg / ffprobe (static)
                                                          ├─ Brand renderer: headless Chrome (puppeteer-core)
                                                          │    renders overlays, outros, product stills → PNG
                                                          └─ storage/ (content-addressed assets, cache, work)
```
- **Two processes, one codebase.** `npm run dev` and `npm start` launch Next and the worker together (via `concurrently`).
- **Only the worker reads `FAL_KEY`.** All slow or external work happens in the worker, so jobs survive restarts of either process.

### Brand renderer: headless Chrome (changed from v2)
v2 rendered text with `@napi-rs/canvas`. Malayalam and Devanagari need proper text shaping (conjuncts and vowel signs), and exact brand typography needs CSS layout, so v2.1 renders overlays, outros and product-still frames as **HTML/CSS in headless Chrome** via `puppeteer-core`.
- The worker starts one browser instance lazily and reuses it.
- The editor preview uses the **same HTML layout components**, so the preview matches the final video (WYSIWYG).

**[v2.2] Renderer reliability (`server/render/*`):**
- **Installation:** `npm run setup` uses `@puppeteer/browsers` (already in the stack) to install a **pinned** `chrome-headless-shell` version into `.cache/chrome/`. The pinned version is recorded in `settings` and appears on the Settings page. System Chrome (`/usr/bin/google-chrome`) is a fallback only, and when used QA shows "renderer version differs from pinned; snapshots may differ".
- **Deterministic output:**
  - exact viewport W×H, `deviceScaleFactor: 1`
  - launch flags `--force-device-scale-factor=1 --font-render-hinting=none --disable-lcd-text --force-color-profile=srgb --hide-scrollbars`
  - CSS animations and transitions disabled; motion comes from ffmpeg, not the browser
  - screenshots clipped to exact bounds with a transparent background for overlays
  - the output PNG's dimensions are asserted after every render
- **Fonts:**
  - Fonts load only from local files via `@font-face` (`file://`).
  - Before each screenshot the worker waits for `document.fonts.ready`, then asserts `document.fonts.check()` for every family, weight and script used. The render fails with `FONT_NOT_LOADED` instead of silently falling back.
  - Glyph coverage of each string is checked against the font's cmap via a precomputed coverage set built at setup from the bundled fonts. This catches missing-glyph boxes ("tofu").
- **Shaping tests:** a fixed corpus of Malayalam strings (conjuncts, chillu letters, vowel signs) and Hindi strings (conjuncts, reph, matras, nukta) is rendered and pixel-compared with approved reference PNGs. This runs in Phase 0 to approve the references, in CI, and at worker start as a quick smoke test with 1 Malayalam and 1 Hindi string.
- **HTML injection prevention:**
  - Templates are React components rendered with `renderToStaticMarkup`, so all user text is escaped text nodes. No `dangerouslySetInnerHTML` (enforced by a lint rule).
  - Templates contain no page scripts.
  - A CSP meta tag is set: `default-src 'none'; img-src file: data:; font-src file:; style-src 'unsafe-inline'`.
  - Asset references are resolved server-side to known storage paths, never taken from user input.
- **Network isolation:** request interception aborts every request except `file://` under the allowed asset, font and work directories, and `data:`. The page also runs with the network emulated offline.
- **Crash recovery:**
  - Each render times out after 15s.
  - On `disconnected` or timeout: kill the process tree, relaunch, retry the render once, then fail the job stage with `RENDERER_CRASH` (retryable per policy).
  - The browser is recycled after 200 renders.
  - The browser PID is stored, and orphaned Chrome processes are killed at worker start.

### Stack
| Purpose | Package |
|---|---|
| App | `next` 16.4.x, `react` 19, TypeScript, Tailwind |
| fal | `@fal-ai/client` 1.10.x (worker only) |
| DB | `better-sqlite3` |
| Media | `ffmpeg-static`, `ffprobe-static` |
| Images | `sharp` (decode, re-encode, crop, strip EXIF, colour sampling) |
| Brand rendering | `puppeteer-core` + `@puppeteer/browsers` (pinned chrome-headless-shell) **[v2.2: install order clarified, no new deps]** |
| Validation | `zod` |
| Dev / test | `tsx`, `concurrently`, `vitest`, `@playwright/test` |

There are no other services: no Redis, no cloud storage, no microservices.

---

## 2. Folder structure (v2 plus the brand, brief, QA and audio additions)
```
PINPO/
├─ assets/
│  ├─ brand/demandmesh/   # official logo files (+ sha256 manifest), brand.json (tokens), LICENSES
│  ├─ fonts/              # Noto Sans, Noto Sans Malayalam, Noto Sans Devanagari (+ OFL)
│  └─ templates/          # 8 built-in templates (JSON)
├─ data/  storage/  scripts/  tests/          # as v2 (data/ and storage/ are gitignored)
└─ src/
   ├─ app/  ads/[adId]/{page,edit}  brand/  templates/  settings/  api/**
   ├─ components/  editor/{brief,storyboard,scenes,audio,finishing,review}/  brand-preview/  qa/
   ├─ lib/                 # client-safe: zod schemas, types, brand layout components (shared with renderer)
   ├─ server/
   │  ├─ db/  models/  storage/  security/  jobs/  fal/          # as v2
   │  ├─ brand/     master.ts (seed + protection), tokens.ts, outro-presets.ts, logo.ts
   │  ├─ brief/     schema.ts, claims.ts, offers.ts
   │  ├─ planning/  storyboard.ts (template × brief → scenes), scenes.ts, timeline.ts, consistency.ts, estimate.ts
   │  ├─ render/    browser.ts (puppeteer pool), html-render.ts, safe-area.ts, fonts.ts
   │  ├─ media/     run, probe, validate, normalize, filtergraph, overlays, outro, product-still, audio, compose, frames
   │  └─ qa/        technical.ts, creative.ts, checks/*.ts
   └─ worker/  index.ts  loop.ts  handlers/{scene-generate,compose,qa,maintenance}.ts
```

---

## 3. DemandMesh master brand kit
**Protected and the default.**
- Seeded on first run with `is_master=1, locked=1`. It cannot be deleted.
- Editing requires an explicit **Unlock brand settings** step. Each saved edit creates a `brand_kit_revisions` row.
- Every ad version stores the **brand revision ID** it used, so old ads never change.
- Other brand kits are possible (e.g. sub-campaigns), but DemandMesh is the default and the only one used with the DemandMesh outro.

**Tokens (`assets/brand/demandmesh/brand.json`, mirrored in the DB):**
| Token | Value |
|---|---|
| primary | #0C1C28 |
| primaryHover | #162B3A |
| secondary | #526979 |
| secondaryLight | #E8EEF1 |
| background | #FFFFFF |
| surface | #F7F9FA |
| border | #E1E7EA |
| website | demandmesh.shop |
| social | Instagram @demandmesh |
| tagline | "Where demands connects." (verbatim from the site) |

**Typography tokens:**
- Fonts: Noto Sans (Latin and ₹), Noto Sans Malayalam, Noto Sans Devanagari. Per-language fallback stacks.
- Font sizes are expressed in **frame-relative units** (% of frame height), for example headline 5.2%, sub-headline 3.0%, body 2.4%, CTA 2.8%.
- Weights 400, 600 and 700; line height 1.15–1.3; letter spacing 0 for Indic scripts.

**Spacing:** an 8-unit grid scaled to the frame (1 unit = 0.74% of frame width).

**CTA style:**
- Pill shape, minimum height 6% of frame height, horizontal padding 4 units.
- Default: `primary` background with white text.
- Inverse on dark footage: `secondaryLight` background with `primary` text.
- Optional arrow icon.

**Motion presets:**
| Preset | Motion |
|---|---|
| fade-up | 0.45s, ease-out, 3% rise |
| slide-in | 0.5s from the safe-area edge |
| scale-in | 0.96 → 1, 0.4s |
| logo-reveal | fade + 0.98 → 1, 0.6s |
| exit | 0.3s fade |

All presets are capped so they never move text outside the safe area.

**Colour rule:** overlays, CTAs and outros may use **only brand tokens** plus white and black text. The editor's colour pickers are limited to the palette. Green (seen on the site's discount tag) is **not** introduced unless DemandMesh approves it.

**[v2.2] Scope of brand rules:**
- Brand rules govern the **brand layer**: logo, overlay, CTA and outro colours, typography, spacing, safe areas, and outro structure.
- They do **not** fix the composition of the footage. Camera, lighting, setting, storytelling, transitions and pacing vary by product and campaign (see §5).
- Overlays choose from several **approved layout variants**, all built from the same tokens: lower third, centred statement, side panel (16:9), corner offer badge, and split headline. This keeps ads recognisably DemandMesh without making them look identical.

**Logo rules:**
- Logos are stored as `assets` rows with `official=1` and a pinned sha256 in `brand_kit_logos (variant: horizontal | icon | inverse)`.
- The renderer only accepts a logo whose hash matches the pinned official hash. It never generates, redraws, recolours, stretches or AI-upscales a logo.
- The logo is rendered at no more than its native pixel width × 1.25. Below that, QA warns "low-resolution logo — replace official file".
- The current file is the website PNG: download it, record its hash, and mark it `temporary=1`.
- Logo variants without a file (icon, inverse) are disabled until supplied. An inverse is **never** synthesised by recolouring.

---

## 4. Creative brief → storyboard (rule-based, no LLM)
**Brief fields (stored per version in `briefs`):**
- **Product:** name; category (the four store categories); description of appearance (colour, material, size or dimensions, packaging, branding on the product); product page URL; product images (originals).
- **Audience:** who it's for, location (default Kerala/India), language(s) (EN/ML/HI).
- **Campaign:** objective (awareness, traffic, sales, group-buy sign-ups), platform (Instagram Reels, Story or Feed, YouTube Shorts or in-stream, Facebook Feed). The platform sets format, length bounds and safe area.
- **Benefits:** a list. Each is a **claim** with a "confirmed by me" checkbox and an optional source.
- **Price and offers:**
  - Price ₹, MRP ₹, discount (**computed** from price and MRP, never typed freely), valid until, terms
  - Group-buy fields: group price, minimum buyers, deadline
- **CTA:** chosen from approved CTA phrases (e.g. "Shop now on demandmesh.shop", "Join the group buy"), editable per language.
- **Creative direction:** a free text field, plus tone (premium, friendly, energetic, calm, informative) and visual style (studio, lifestyle, minimal, bold).

**Storyboard generator (`planning/storyboard.ts`, deterministic and unit-tested):**
1. Inputs are template × brief × platform × model.
2. Output is an editable list of scenes, each with: role, duration (from the template's weights, fitted with `timeline.ts` and the model's allowed durations), scene type, visual direction, video prompt, overlay text and motion preset.
3. Video prompts are built from the template's prompt scaffold with slots filled **only from brief text**: product appearance, tone, style, audience setting.
4. Every AI prompt also gets "no text, no logos, no watermarks" (and a negative prompt where the model supports one), because AI-rendered text and logos come out wrong. All text and logos are added by our renderer.
5. Overlay text is copied **verbatim** from brief fields: benefits, offer fields, CTA.
6. Missing information becomes visible placeholders (e.g. `[Add a confirmed benefit]`) that **block Generate**.
7. Nothing is ever invented: no specs, discounts, reviews, ratings or performance claims.
8. Regenerating the storyboard on a draft shows a diff and asks before replacing scenes the user has edited.

---

## 5. Template library (8 built-ins; user templates via "Save as template")
Each template defines:
- scene roles with duration weights
- scene type per role
- visual direction
- prompt scaffold
- overlay structure (which brief field, position, motion)
- CTA placement
- default outro preset
- supported platforms
- suggested lengths

| Template | Scene roles (default 30s) | Default outro |
|---|---|---|
| Product showcase | Hook (product reveal) → Hero detail → Use moment → Benefit → CTA | Standard |
| Problem & solution | Problem → Frustration beat → Product appears → Solution in use → CTA | Standard |
| Product demonstration | Hook → Step 1 → Step 2 → Result → CTA | Product-specific |
| Lifestyle | Mood opener → Product in daily life → Social moment → Product close-up → CTA | Minimal logo |
| Feature highlights | Hook → Feature 1 → Feature 2 → Feature 3 → CTA | Product-specific |
| Promotional offer | Offer hook (price/discount) → Product hero → Offer details + validity → Urgency → CTA | Promotional |
| Brand awareness | Brand mood → Categories montage → "Where demands connects." → Shop experience → CTA | Standard |
| **Group buy** (added) | Hook "Buy together for less" → Product → How group price drops (min buyers) → Deadline → CTA "Join the group buy" | Promotional |

Scenes whose role is "product hero" or "close-up" default to **original product scene types** (§7).

**[v2.2] Creative controls (templates define roles and intent, not a fixed look).** Each scene has editable controls. The storyboard generator fills defaults from a deterministic mapping of brief **category × tone × visual style × platform**, and the user can change any of them:

| Control | Options |
|---|---|
| Camera | static, slow push-in, pull-out, orbit, pan, top-down, handheld, macro |
| Lighting | soft studio, natural daylight, golden hour, moody low-key, high-key bright |
| Setting / background | from the brief (e.g. kitchen counter, office desk, outdoor Kerala street, plain brand-colour studio) |
| Pacing | calm, standard, fast. Changes scene-duration weights and transition length within the fixed total length. |
| Transition per cut | hard cut, crossfade, dip to white, dip to primary, slide |
| Overlay layout variant | see §3 |
| `product_original` motion | push-in, pan, parallax, rotate-in |

The camera and lighting choices are appended to AI prompts as plain descriptive text. The outro preset system stays consistent for every ad.

---

## 6. DemandMesh outro system (`brand/outro-presets.ts`, rendered HTML → PNG/frames)
**Every outro:**
- uses the official logo, brand tokens, the typography scale and the spacing grid
- is centred on a safe-area grid
- shows "demandmesh.shop" exactly
- lasts 2.5–4s, with motion from the presets and a 0.5s crossfade from the last scene

| Preset | Content |
|---|---|
| **Standard** | Logo (horizontal), tagline, CTA pill, website; white background, primary text |
| **Promotional** | Logo, offer line (from brief offer fields only: price ₹ / MRP struck through / computed % off / valid until), CTA, website; surface background with a primary offer badge |
| **Product-specific** | Original product cut-out or photo (from the uploaded asset, never AI), product name, price if provided, CTA, logo, website |
| **Minimal logo** | Logo reveal on white or primary (inverse only if an official inverse logo exists), website |

Outros support EN, ML and HI text using the brief language. Layout specs live in tokens; the outro test suite renders each preset per format and compares against approved snapshots.

---

## 7. Product preservation & consistency (extends v2 §7)
**Scene types:**
1. **`product_original`**, no AI. The **original uploaded product photo** is animated locally: slow push-in/pan, parallax over a brand-colour or blurred backdrop, rendered by Chrome + ffmpeg. The aspect ratio is preserved, never stretched, and the colours are untouched. This is the default for hero, close-up, offer and outro product shots.
2. **`ai_from_product`**: image-to-video, where the start frame is the original photo composited (unaltered, aspect preserved) onto a target-aspect canvas. This gives AI motion while starting from the exact product.
3. **`ai_reference`**: models with reference support get the original product photos as references, plus the product-appearance text lock.
4. **`ai_scene`**: AI footage without the product (mood, lifestyle, problem beats).

The v2 rules still apply: product-appearance lock text in every product prompt, a shared seed where supported, and optional continuity mode.

Every AI scene that shows the product is flagged for **human review** in creative QA, because AI may alter packaging text or shape.

**[v2.2] Preservation pipeline and realistic validation:**
- **Input validation:**
  - Product images are decoded by sharp and converted to sRGB using their embedded ICC profile, so the colours look the same as intended. They are never stretched; the original aspect ratio is kept exactly, and any letterbox uses a brand backdrop or blurred backdrop.
  - QA warns if the image would be shown above its native resolution × 1.25, and asks for a larger image instead of upscaling.
  - Transparent PNG cut-outs are supported as uploaded; there is no automatic background removal.
- **Colour handling through video:**
  - Explicit RGB → BT.709 limited-range conversion in ffmpeg, with the output tagged `bt709` (primaries, transfer and matrix). Untagged output would shift colours in players.
  - Product-still segments are encoded at CRF ≤ 16.
- **Measurement that tolerates compression.** For `product_original` and the product-specific outro:
  - Decode the final frame at the segment's hold point (the end of the push-in, when the product is fully visible and static).
  - Crop the known product rectangle from the layout, and scale the reference to the same size.
  - Compare inside the product mask (the alpha channel for cut-outs, otherwise the full rectangle):
    - mean CIEDE2000 **ΔE ≤ 3.0**
    - 95th percentile **ΔE ≤ 8**
    - luminance **SSIM ≥ 0.92**
    - aspect ratio error ≤ 0.5%
  - Thresholds live in config and are calibrated in Phase 0 against 4:2:0 subsampling at the chosen CRF.
- **AI product scenes** (`ai_from_product`, `ai_reference`, or any AI scene marked "shows product") **always** require human review before export, whatever the metrics say. The metrics are shown only as hints.

---

## 8. Voiceover & audio editing
**Tracks per version (`audio_tracks`):**
- clip audio (per scene: on/off, volume)
- **voiceover segments**: imported files (MP3/WAV/M4A), each anchored to a scene start plus an offset, with volume and fade in/out
- **music**: one track with volume, fades and loop/trim

**Mixing (`media/audio.ts`):**
- Voiceover sits on top.
- Music is **ducked under voiceover** (sidechain from the VO bus); clip audio is optionally ducked too.
- Crossfades are aligned to video transitions.
- Final loudness: −14 LUFS, true peak −1.5 dBTP.

**Timing checks:**
- Warn when a VO segment runs past its scene or past the ad end.
- Warn when overlay reading time is shorter than words ÷ 2.5 + 0.5s.

**Editor:** waveform display (peaks computed by the worker with ffmpeg, stored as JSON), drag to offset, per-track volume sliders, mute and solo, and a scene-synced preview.

**TTS:** not implemented. The audio track model allows a future `source: "tts"`, but nothing is built for it now.

## 8a. [v2.2] Asset provenance & rights
Every creative asset carries provenance metadata, captured at upload in the same dialog and enforced at export.

| Field | Values / notes |
|---|---|
| `source_type` | official_brand, product_supplier, own_photo, stock_licensed, commissioned, recorded_voice, generated_fal, rendered, font |
| `origin` | Where it came from: URL, supplier name, stock site + item ID, or the fal endpoint + request_id for generated clips |
| `license` | Free text with presets: Owned by DemandMesh, Supplier permission, Royalty-free (stock), CC BY 4.0, OFL (fonts), Proprietary |
| `commercial_use` | yes / no / unknown |
| `attribution_text` | Required when the licence needs credit |
| `rights_holder` | |
| `license_expires_at` | |
| `talent_consent` | Required for voiceovers and any recognisable person: "consent for commercial ad use obtained" |
| `proof_note` | Licence ID, invoice or email reference |

- **Required at upload:** music and voiceover need source_type, license and commercial_use, plus talent consent for voice. Product images need source_type (own_photo or product_supplier) and confirmation of permission to use. Logos are `official_brand`, seeded automatically.
- **Generated clips** record model, endpoint and request_id. Their commercial-use status follows fal's and the model's terms, which Phase 0 checks per model; until confirmed, the item is `needs review`.
- **Fonts** are recorded as OFL.
- **Export gate (a creative QA item):**
  - `fail` if any used asset has `commercial_use = no`, an expired licence, or a voiceover without talent consent
  - `needs review` if any is `unknown`
- **Credits:** attributions are collected into a `credits.txt` exported next to the MP4 and shown in the export panel.

---

## 9. Quality assurance (two separate reports)
**Technical report:** v2's FFprobe validation of clips and the final video.

**Creative & brand report (`qa/creative.ts`, a worker job after compose):**
- Each item has a **method** (automated, heuristic, human) and a **status** (pass, warn, fail, needs review).
- Results are stored in `qa_reports` and `qa_items` with evidence: frame thumbnails, measured values.

| Check | Method |
|---|---|
| Logo accuracy | Automated: logo asset hash equals the pinned official hash; rendered outro frame vs expected render compared with SSIM ≥ 0.98; logo scale ≤ native × 1.25 (warn if low-res temporary logo) |
| Brand colour compliance | Automated: every overlay/CTA/outro colour comes from tokens (checked at render input); sampled overlay regions within ΔE ≤ 3 of tokens |
| Product appearance consistency | `product_original` scenes pass automatically. AI product scenes are **needs review**: reference photo shown beside extracted frames. A colour-histogram similarity is shown as a hint only, never as a pass. |
| Text readability | Automated: contrast of text vs sampled backdrop ≥ 4.5:1 (else auto-add the backdrop panel); minimum size ≥ 2.4% of frame height; on-screen time ≥ reading time; Indic glyphs render (no tofu, checked via font coverage) |
| Hook effectiveness | Heuristic + human: first 2s has motion and a hook overlay; the product or offer appears by 3s. Labelled a **creative assessment**, not a verdict. |
| CTA presence | Automated: a CTA overlay or outro CTA exists and matches the brief CTA |
| End-card correctness | Automated: preset suits the template/objective; website text exactly "demandmesh.shop"; official logo; duration 2.5–4s |
| Product claim accuracy | Automated: every overlay sentence maps to a **confirmed** brief claim; numbers, %, "best", "#1", "guaranteed", "clinically", ratings and review language not in the brief are flagged as **fail** |
| Offer accuracy | Automated: price, MRP and % off match brief values; % recomputed; validity date shown if provided and not expired; group-buy numbers match |
| Platform-safe placement | Automated: every text and logo box lies inside the platform safe area |

**Export gating:** export is enabled when there are no `fail` items and every `needs review` item is acknowledged ("I reviewed this") in the report. Acknowledgements are stored with a timestamp. Exporting with warnings is allowed, and the warnings are shown.

### [v2.2] Advertising compliance safeguards (`qa/checks/compliance.ts`, `brief/claims.ts`)
- **Claim classification.** Each brief claim and each overlay or voiceover-script line is classified with EN/ML/HI keyword and pattern lists:
  - **medical/health** — cure, treat, heal, prevent disease, therapeutic, immunity, weight loss, "clinically proven", "doctor/dermatologist recommended or tested", approval claims such as FDA/AYUSH/ISO
  - **safety** — "100% safe", "no side effects", "chemical-free", "non-toxic", "child-safe"
  - **performance** — numbers with units, %, "lasts X hours", "X times faster", "guaranteed"
  - **comparative or superlative** — best, #1, lowest price, cheapest, better than
  - **environmental** — eco-friendly, biodegradable, organic
  - **testimonial or review** — quotes, ratings, stars, "customers love", user counts
  - **urgency** — only today, last chance, limited stock, countdown, ending soon
- **Rules:**
  - **Medical/health, safety, performance, comparative and environmental claims** need a confirmed claim with a **substantiation source** (document, URL or certificate reference) and a separate **human attestation** checkbox. Without both: `fail`. With both: `needs review`. Health & Personal Care products also get a category banner reminding the reviewer of stricter rules.
  - **Testimonials, reviews and ratings** are blocked unless the brief has a real testimonial record with source, the customer's name or permission, and a consent checkbox. AI scenes may not be prompted to show "customer reviews" or invented people giving endorsements; such prompt patterns are rejected.
  - **Urgency:**
    - "limited stock" needs a confirmed stock statement.
    - Time-limited wording or a countdown needs `valid_until`.
    - If `valid_until` or a group-buy deadline is in the past at export: `fail`.
    - Urgency wording without backing data: `fail`.
  - **Pricing:**
    - price, MRP, discount % (always computed) and ₹ formatting must exactly match the brief
    - MRP must be ≥ price
    - a strike-through price requires an MRP
    - "lowest price" needs a confirmed source
    - stale prices: a brief older than 7 days at export gives `needs review` ("re-confirm current price")
- **Final human attestation at export:** "I confirm all claims, prices and offers in this ad are accurate, current and substantiated." Stored with a timestamp per version.
- **Disclaimer.** These checks reduce risk but are not legal review. The README points the user to India's ASCI code and the Consumer Protection rules for final responsibility.

---

## 10. Cost accuracy (replaces v2 cost tracking) — **[v2.2] refined**
The ledger records **one row per fal request attempt** (`UNIQUE(fal_request_id, kind)`), so retries are counted individually and nothing is counted twice. Mock-mode attempts are recorded at $0 with `mock=1`.

| Category | What it contains | Label in UI |
|---|---|---|
| **Estimated** | Registry list prices at Generate time (pricing version stored) | "Estimated" |
| **Calculated** | Successful attempts only: delivered ffprobe duration × list price for that resolution and audio | "Calculated from list prices — not billing data" |
| **Failed-generation exposure** | Attempts fal accepted but that ended in an error, attempts we rejected after delivery (corrupt or invalid), and clips discarded by a regenerate. Each is valued at its list price as a **maximum** exposure. Whether fal bills failures is **not documented**, so this is shown as a range from $0 to that amount. | "Possible charges for failed attempts (billing unknown)" |
| **Cancellation exposure** | Cancels returning 202 `CANCELLATION_REQUESTED` (may still bill), valued at the maximum. A 200 `OK` cancel records $0. | "Possible charges for cancelled attempts" |
| **Duplicate exposure** | `possible_duplicate` submissions after crash recovery | "Possible duplicate charge" |
| **Confirmed** | `confirmed_provider` (fal billing data by request ID, only if Phase 0 finds a supported API) or `confirmed_manual` (user-entered from the fal dashboard, with a note) | "Confirmed (fal)" / "Confirmed (manual)" |

- **Display:** per scene, per version and per ad, each total shows **Estimated · Calculated · Exposure (max) · Confirmed**. "Confirmed" stays empty until real data exists.
- **Labelling rule:** calculated and exposure values are never labelled actual or billed.
- **Reconciliation:** once confirmed data exists for a request, its calculated and exposure rows are marked `reconciled` and shown struck through for audit.

---

## 11. Database schema (v2 plus v2.1)
v2 tables stay unchanged: `assets`, `ads`, `ad_versions`, `scenes`, `jobs`, `job_events`, `workers`, `settings`.

**Changed or new:**
| Table | Columns |
|---|---|
| `assets` | `official`, `temporary`, **[v2.2]** provenance columns per §8a: `source_type`, `origin`, `license`, `commercial_use`, `attribution_text`, `rights_holder`, `license_expires_at`, `talent_consent`, `proof_note`, `icc_profile` |
| `brand_kits` | `is_master`, `locked`, `current_revision_id` |
| `brand_kit_revisions` | id, brand_kit_id, number, tokens_json (colours, typography, spacing, motion, CTA style, website, social, tagline), created_at |
| `brand_kit_logos` | brand_kit_id, variant, asset_id, pinned_sha256 |
| `brand_kit_products` | as v2 |
| `outro_presets` | id, brand_kit_id, type (standard / promotional / product / minimal), layout_json, duration_s, builtin |
| `templates` | `scenes_json` gains role, weight, scene_type, visual_direction, prompt_scaffold, overlay_spec, motion; plus cta_spec, default_outro_type, platforms, lengths |
| `briefs` | version_id PK, product_json, audience_json, campaign_json, offers_json, cta_json, creative_json, languages |
| `claims` | id, version_id, text, language, confirmed, source, created_at; **[v2.2]** `category` (general / medical_health / safety / performance / comparative / environmental / testimonial / urgency / pricing), `substantiation`, `attested_at`, `testimonial_consent` |
| **[v2.2]** `attestations` | id, version_id, kind (compliance_final / qa_review), text, at |
| `ad_versions` | `brand_revision_id`, `template_id`, `outro_preset_id`, `platform`, `qa_status` (none / running / passed / needs_review / failed / approved) |
| `scenes` | `scene_type` (product_original / ai_from_product / ai_reference / ai_scene), `visual_direction`, `motion_preset`, `overlay_json` (text per language, claim_ids, position, style); **[v2.2]** `shows_product`, `creative_json` (camera, lighting, setting, transition_out, layout_variant) |
| `ad_versions` (more) | **[v2.2]** `pacing` (calm / standard / fast) |
| `audio_tracks` | id, version_id, kind (clip / voiceover / music), scene_id, asset_id, offset_s, volume_db, fade_in_s, fade_out_s, duck, muted, source (upload; tts reserved), peaks_json |
| `qa_reports` | id, version_id, kind (technical / creative), status, created_at |
| `qa_items` | id, report_id, check, method, status, message, evidence_json, acknowledged_at |
| `cost_entries` | **[v2.2]** `kind` = estimated / calculated / exposure_failed / exposure_canceled / exposure_duplicate / confirmed_provider / confirmed_manual; `attempt`, `fal_request_id`, `mock`, `reconciled`, `basis_json` (duration, resolution, audio, pricing version); UNIQUE(fal_request_id, kind) |

**Lifecycles:**
- Versions as in v2, with `qa_running → approved` added after `ready`.
- Jobs as in v2, with a `qa` job type created in the same transaction as compose success.

---

## 12. API routes (v2 routes plus these)
| Method & path | Purpose |
|---|---|
| GET `/api/brand` · POST `/api/brand/unlock` · PATCH `/api/brand` (requires unlock; creates revision) · GET `/api/brand/revisions` | Master brand kit |
| POST `/api/brand/logos` (local official import only; hash pinned; PNG; SVG only via `scripts/import-logo.ts`, rasterised at fixed sizes) | Official logos |
| GET `/api/outro-presets` · POST `/api/outro-presets/preview` (render PNG preview via worker queue) | Outros |
| PATCH `/api/versions/[vid]` | Now also: brief, claims, audio tracks, outro preset (autosave with revision) |
| POST `/api/versions/[vid]/storyboard` | Rule-based storyboard from template × brief; returns diff when replacing edited scenes (`confirm=true` to apply) |
| GET `/api/versions/[vid]/qa` · POST `/api/versions/[vid]/qa/[itemId]/ack` · POST `/api/versions/[vid]/qa/rerun` | QA report |
| POST `/api/versions/[vid]/costs/confirm` | Manual confirmed amount (with note) |
| GET `/api/versions/[vid]/export?platform=` | Final MP4 download named `demandmesh_<product>_<platform>_<WxH>_v<N>.mp4`; 409 until export gate passes |
| GET `/api/assets/[id]/peaks` | Audio waveform peaks |
| **[v2.2]** PATCH `/api/assets/[id]/provenance` | Edit provenance fields; `POST /api/assets` now requires them per §8a |
| **[v2.2]** POST `/api/versions/[vid]/attest` | Final compliance attestation (required by the export gate) |

All v2 rules still apply: zod, same-origin, no GET side effects, asset ID serving, 409/422/423/507 semantics.

---

## 13. UI/UX specification (extends v2 §10)
**Studio chrome uses the DemandMesh palette:**
- white and surface backgrounds, border lines
- primary navy for text and primary buttons, hover colour on hover
- secondary for muted text, secondary-light for selected states

Noto Sans for UI text, responsive to 375px, AA contrast, visible focus, reduced motion respected.

**Editor sections (left nav with completion badges):**
1. **Brief:** guided form grouped as Product · Audience · Campaign · Benefits & claims (confirm checkboxes) · Price & offers (computed discount) · CTA · Creative direction. Languages are toggled as EN/ML/HI tabs on text fields.
2. **Storyboard:** template picker with a preview of scene roles → **Build storyboard** → scene cards. Each card shows role, type badge (Original product / AI from product / AI with references / AI scene), duration (valid values only), visual direction, prompt, overlay text per language, motion preset, product images. Cards can be reordered, added and duplicated. Placeholders are highlighted.
3. **Audio:** track lanes (clip, voiceover segments, music) aligned to the scene timeline, with waveforms, offsets, volumes, mute/solo and ducking toggle.
4. **Finishing:** outro preset picker with a live preview per format; overlay style; safe-area guide overlay; frame preview rendered with the same HTML as the final.
5. **Review & generate:** brief completeness, claim confirmations, cost (estimated), model capability warnings → **Generate version N**.

**Version overview:**
- generation progress (v2)
- **Technical** and **Creative & brand** QA tabs, with evidence thumbnails, side-by-side product reference vs frames, and acknowledge buttons
- three-level cost panel
- export panel: platform presets, filename, gate status

**Brand page:**
- read-only view of tokens, logos (with "temporary / low-res" badge), typography specimen in EN/ML/HI, CTA and outro previews
- Unlock to edit, with revision history

---

## 14. Development phases — **[v2.2] resequenced: one excellent end-to-end ad first, then expand**
All v2.1 scope remains. Only the order changes, so that a complete, high-quality DemandMesh ad exists before the advanced features are broadened.

| # | Scope | Exit criteria |
|---|---|---|
| **0 Verify** | v2.1 checks, plus: pinned chrome-headless-shell installs; Malayalam/Hindi shaping references approved; product-preservation thresholds calibrated; fal commercial-use terms per model; fal billing API existence | Findings recorded in the registry and this plan; fallbacks chosen |
| **1 Foundation** | DB, migrations, storage with provenance, worker lock/lease/heartbeat, status, master brand + fonts seeded, renderer with reliability rules | Both processes run; renderer smoke test passes |
| **2 Vertical slice: logic** | Registry (default model + cheapest), timeline, **Product showcase** template, core brief fields (product, benefits/claims, price, CTA), storyboard, creative-control defaults, scene types `product_original` + `ai_scene` + `ai_from_product` | Unit tests green |
| **3 Vertical slice: pipeline + minimal UI** | Mock and real providers, scene handler, EN overlays, **Standard outro**, music track, compose, technical validation, core compliance (claims, pricing, offers), cost ledger, export gate; minimal brief → storyboard → generate → review → export screens | Mock 15s 9:16 showcase ad passes technical QA and core compliance end to end |
| **4 Vertical slice: real ad + user review** | One real 15s 9:16 Product showcase ad for a real DemandMesh product, using the user's key | **User approves the quality.** Fixes applied before expanding. |
| **5 Expand creative** | Remaining 7 templates (incl. group buy), all creative controls and layout variants, all 4 outros, Malayalam/Hindi, full model registry, reference and consistency strategies, 16:9 / 1:1 | Per-template mock ads pass; outro and shaping snapshots match |
| **6 Audio** | Voiceover segments, ducking, lanes, waveforms, timing checks | V1/V2 tests pass |
| **7 Full QA, compliance & provenance** | All creative/brand checks, compliance classifier (EN/ML/HI), testimonials and urgency rules, provenance gate, credits, attestations | Q- and M-series tests pass |
| **8 Product UI completion** | Brand page with unlock/revisions, versions/fork/reuse, library, autosave conflicts, cost panel with all categories | API + component tests green |
| **9 UI polish** | Design pass, responsive and accessibility checks | Screenshots at 375/768/1440 reviewed (after dm-1a finishes) |
| **10 Hardening & release** | e2e, fault suites, `next build`, typecheck, lint, README (setup, logo/font replacement, costs, QA and compliance meaning) | All acceptance criteria pass |

Estimate unchanged: about 4 working sessions plus feedback rounds, with the first reviewable real ad at the end of Phase 4. Real-fal testing should cost a few dollars.

---

## 15. Acceptance criteria
**Technical (v2, kept):**
- Duration within ±0.1s; exact format resolution; crash and restart safety; cancel within 10s; FFprobe validation; non-destructive versions with clip reuse; autosave with conflict handling; key never exposed; usable at 375px with a keyboard.

**DemandMesh advert (v2.1). A completed ad must:**
1. **Look professionally produced:**
   - consistent typography and motion presets
   - no AI-rendered text or logos
   - loudness −14 ±2 LUFS
   - no black or silent gaps flagged
2. **Preserve product identity:**
   - hero, close-up and outro product shots use the original photo (`product_original`) by default
   - **[v2.2]** those shots meet the calibrated colour and structure thresholds (mean ΔE ≤ 3, P95 ≤ 8, SSIM ≥ 0.92, aspect error ≤ 0.5%)
   - any AI product scene is human-reviewed before export
3. **Follow brand guidelines:**
   - only token colours
   - official pinned logo
   - brand fonts and spacing
4. **Open with a hook** in the first 2s, and show the product or offer by 3s (assessment shown).
5. **Communicate genuine benefits:** every overlay claim maps to a user-confirmed brief claim; no invented specs, discounts, reviews or performance claims.
6. **Have readable, correctly placed overlays:** contrast ≥ 4.5:1, minimum size, enough reading time, inside the platform safe area, correct EN/ML/HI shaping.
7. **Include an appropriate CTA** that matches the brief.
8. **Use the correct DemandMesh outro:** right preset, exact "demandmesh.shop", official logo.
9. **Pass technical validation.**
10. **Export in the selected platform format** with the export gate satisfied.
11. **[v2.2] Make no unsupported claims:**
    - medical/health, safety, performance, comparative and environmental claims are substantiated and attested
    - no fabricated testimonials
    - no urgency without backing data
    - no expired offers or deadlines
    - prices and discounts match the brief exactly
    - the final compliance attestation is recorded
12. **[v2.2] Have clear rights:** every used asset has commercial-use permission, a valid licence, talent consent where needed, and the required credits.
13. **[v2.2] Look distinct while on-brand:** it uses its own creative controls (camera, lighting, setting, pacing, transitions, layout variants) while the brand layer stays consistent.

Costs always show **estimated, calculated, failed/cancelled/duplicate exposure and confirmed** separately; nothing calculated or estimated is labelled as billed.

---

## 16. Test cases (v2's U1–U8, I1–I17, A1–A7, E1–E3, R1–R2 kept, plus these)
| ID | Type | Case | Expected |
|---|---|---|---|
| B1 | unit | Delete or edit master brand without unlock | Rejected (423/409) |
| B2 | unit | Brand edit after unlock | New revision; old versions keep old revision |
| B3 | integration | Swap logo file on disk (hash mismatch) | Render refuses; QA logo check fails |
| B4 | unit | Colour outside tokens in overlay style | Validation error |
| S1 | unit | Storyboard for each template × platform × length | Valid roles, durations sum to target, placeholders for missing brief data |
| S2 | unit | Brief with no confirmed benefits | Benefit placeholders; Generate blocked |
| S3 | unit | Regenerate storyboard over edited scenes | Diff returned; nothing replaced without confirm |
| S4 | unit | Prompt builder | Contains product lock text + "no text/logos"; contains no invented claims |
| O1 | snapshot | Each outro preset × 3 formats × 3 languages | Matches approved renders (pixel diff ≤ threshold) |
| O2 | integration | Promotional outro with price/MRP | % off computed correctly; MRP struck through; date shown |
| L1 | integration | Malayalam and Hindi overlay strings (conjuncts) | Rendered without tofu; matches reference snapshot |
| P1 | integration | `product_original` scene **[v2.2 thresholds]** | Product region at hold frame vs scaled reference: mean ΔE2000 ≤ 3, P95 ≤ 8, SSIM ≥ 0.92, aspect error ≤ 0.5%; output tagged bt709 |
| P3 | integration | **[v2.2]** Product image with Display-P3 / Adobe RGB ICC profile | Converted to sRGB; P1 thresholds still pass |
| P4 | unit | **[v2.2]** Small product image shown large | Warning to upload larger image; no upscaling beyond 1.25× |
| P2 | integration | AI product scene | Creative QA item = needs review with side-by-side evidence |
| V1 | integration | VO segments + music | Music ducks ≥ 8 dB under VO; VO timing preserved ±40ms; final loudness in range |
| V2 | unit | VO longer than its scene/ad | Timing warning |
| Q1 | integration | Overlay contains "50% off" not in brief | Claim/offer check = fail; export blocked |
| Q2 | integration | Overlay text over bright footage | Contrast check triggers backdrop or fails |
| Q3 | integration | Text box outside 9:16 safe zone | Placement check fails |
| Q4 | integration | Outro website text altered | End-card check fails |
| Q5 | e2e | Acknowledge review items | Export enabled; ack timestamps stored |
| C1 | unit | Cost panel with no billing data | Confirmed empty; calculated labelled "not billing data" |
| C2 | api | Manual confirmed amount | Stored as `confirmed_manual` with note |
| C3 | integration | **[v2.2]** Scene fails twice (fal error), succeeds third time | 1 calculated + 2 exposure_failed rows; no double count |
| C4 | integration | **[v2.2]** Cancel returns 200 vs 202 | $0 entry vs exposure_canceled entry |
| C5 | integration | **[v2.2]** Crash between submit and request_id store, resubmitted | exposure_duplicate entry; UI warning |
| C6 | integration | **[v2.2]** Corrupt delivered clip regenerated | Discarded attempt → exposure_failed; new attempt → calculated |
| C7 | unit | **[v2.2]** Confirmed data arrives for a request | Its calculated/exposure rows marked reconciled |
| M1 | unit | **[v2.2]** Medical claim ("cures acne", ML and HI equivalents) without substantiation | fail; export blocked |
| M2 | unit | **[v2.2]** Same claim with source + attestation | needs review; export allowed after acknowledgement |
| M3 | unit | **[v2.2]** "No side effects", "100% safe" | Classified as safety; fail without substantiation |
| M4 | unit | **[v2.2]** Overlay "Rated 4.9★ by customers" or a quoted review without a testimonial record | fail |
| M5 | unit | **[v2.2]** AI prompt asking for "happy customer giving a review" | Rejected at storyboard/edit time |
| M6 | unit | **[v2.2]** "Only today!" with no valid_until; "Limited stock" without stock confirmation | fail |
| M7 | unit | **[v2.2]** Offer valid_until or group-buy deadline in the past at export | fail |
| M8 | unit | **[v2.2]** Price > MRP; overlay % differs from computed %; brief older than 7 days | fail / fail / needs review |
| M9 | e2e | **[v2.2]** Export without final attestation | Blocked until attested |
| PV1 | api | **[v2.2]** Upload music without licence/commercial-use fields | 400 |
| PV2 | integration | **[v2.2]** Ad uses asset with commercial_use = no, or an expired licence | fail; export blocked |
| PV3 | integration | **[v2.2]** Voiceover without talent consent | fail |
| PV4 | integration | **[v2.2]** Asset requiring attribution | Credit included in credits.txt and the export panel |
| CR1 | integration | **[v2.2]** Missing font file / font not loaded | Render fails with FONT_NOT_LOADED (no silent fallback) |
| CR2 | integration | **[v2.2]** String with a glyph missing from the font | Coverage check fails before render |
| CR3 | security | **[v2.2]** Overlay text `<img src=x onerror=…>` / `<script>` / `url(http://…)` | Rendered as literal text; no script runs; no network request |
| CR4 | security | **[v2.2]** Template referencing a remote image/font | Request aborted; render fails clearly |
| CR5 | integration | **[v2.2]** Kill the Chrome process mid-render | Relaunch + one retry succeeds; no orphan processes |
| CR6 | integration | **[v2.2]** Same overlay rendered twice | Byte-identical PNG of exact W×H |
| CR7 | integration | **[v2.2]** Pinned chrome-headless-shell missing | `npm run setup` installs it; fallback to system Chrome shows a version warning |
| F1 | unit | **[v2.2]** Storyboard for two products in different categories/tones with the same template | Different camera/lighting/setting/pacing defaults; same brand layer and outro |
| F2 | unit | **[v2.2]** Pacing change | Durations re-weighted; total length unchanged ±0.1s |
| T1 | e2e | Group-buy template: brief → storyboard → generate (mock) → QA → export | Passes at desktop and 375px |

**Machine courtesy:** Playwright runs, `next build` and long integration suites wait until the other session (dm-1a) reports its run is finished.

### [v2.2] Verification that v2.1 requirements are intact
- Architecture, process model, stack and dependency list are unchanged. The only change is the clarified install order of the existing `@puppeteer/browsers`.
- Every v2.1 feature remains:
  - master brand (protected and default)
  - brief and rule-based storyboard
  - 8 templates
  - 4 outro presets
  - product scene types
  - voiceover/audio editing, with optional TTS kept out of scope
  - two QA reports and the export gate
  - three cost levels, now extended with exposure categories
  - EN/ML/HI support
  - versions, autosave, library, worker reliability
- Brand tokens, logo rules and the colour rule are unchanged. The new creative controls apply to the footage only.
- No Claude API, no new services, and no invented fal capabilities: unknowns such as failure billing, a billing API and commercial-use terms are marked as Phase 0 verifications.

**Open items, to replace later and tracked in Settings:**
- official high-res logo files (horizontal, icon, inverse)
- DemandMesh's approved font files
- approval of any accent colour such as the site's green discount tag
