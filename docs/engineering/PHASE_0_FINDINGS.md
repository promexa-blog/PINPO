# Phase 0 — Verification findings (2026-11-06)

Results of the Phase 0 checks in `PINPO_IMPLEMENTATION_PLAN_V2.2.md` §14. Each item says what was verified, how, and the decision taken.

## Media toolchain
| Check | Result | Decision |
|---|---|---|
| `ffmpeg-static` version | **7.0.2** (johnvansickle static build) | Use as planned |
| Filters needed by the plan | `xfade`, `acrossfade`, `sidechaincompress`, `loudnorm`, `ebur128`, `blackdetect`, `silencedetect`, `ssim`, `zscale`, `colorspace`, `overlay`, `aloop`, `amix`, `afade` — all present | — |
| `drawtext` | **Not available** | Fine: plan renders all text in Chrome, not ffmpeg |
| Encoders | `libx264`, `aac` present | — |
| Test compose (2 clips, xfade 0.5s, music ducked with sidechaincompress, loudnorm −14) | Output 1080×1920 h264 yuv420p, tagged **bt709**, AAC 48 kHz stereo, **−13.8 LUFS**, `moov` before `mdat` (faststart OK) | Pipeline approach confirmed |
| Exact length | Output was **5.6s** vs planned 5.5s because the music input outlasted the video | Composer must always pass `-t <timeline total>` and `amix=duration=first`; validation tolerance ±0.1s stays |
| `ffprobe-static` | Ships **ffprobe 4.0.2 (2018)**; reads our ffmpeg 7 output correctly (JSON streams/format, colour tags) | Use it; validation code must not rely on fields newer than ffprobe 4 |
| `better-sqlite3` | Loads on Node 22; SQLite **3.53.4**; WAL OK | — |
| `sharp` | libvips **8.18.7** | — |

## Brand renderer (Chrome)
| Check | Result | Decision |
|---|---|---|
| Pinned Chrome | `@puppeteer/browsers install chrome-headless-shell@stable` → **157.0.8103.38** | Pin this version in setup script and settings |
| Font loading via `page.setContent` | **All fonts failed** (`about:blank` page cannot load `file://` fonts) — the font check correctly caught it | Renderer writes each HTML document to `storage/work/` and opens it by `file://` URL |
| Fonts after fix | Noto Sans + Noto Sans Malayalam load; `document.fonts.check` true | — |
| Devanagari font | Not loaded — **Noto Sans (Latin VF) already contains Devanagari**, so Chrome never needed the Devanagari face | Renderer sets font-family per `lang` (en/ml/hi) and calls `document.fonts.load()` for every face it uses before `check()` |
| Malayalam shaping | ക്ഷ, ന്റ, chillu ൾ, ച്ച് rendered correctly | Strings become the shaping reference corpus |
| Hindi shaping | क्ष, त्र, ज्ञ, reph र्क, matras rendered correctly | Same |
| ₹ glyph | Correct in Noto Sans | — |
| HTML injection | `<img src=x onerror=…>` as text node rendered literally, no request made | Text-node-only rendering confirmed |
| Determinism | Two consecutive screenshots **byte-identical** with the planned flags | — |
| Network | Request interception allowing only `file:`/`data:` works; 0 blocked requests for local-only pages | — |

## Brand assets
| Item | Result |
|---|---|
| Temporary logo | `https://demandmesh.shop/brand/demandmesh/demandmesh-horizontal-trimmed-304x62.png` — PNG **304×62 RGBA**, sRGB, sha256 `ee313ede8d0103388cfc091334739548f105d7595a43764c0c9745e0d1822368`. Pinned as `official=1, temporary=1`. Max render width = 380px (native × 1.25). |
| Fonts | Noto Sans, Noto Sans Malayalam, Noto Sans Devanagari variable TTFs from `google/fonts` (OFL 1.1) |

## fal.ai (vertical-slice models)
Schemas fetched from `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=…`; prices from each model's `llms.txt`; status from `api.fal.ai/v1/models`.

| Model | Verified inputs | Output | Price (seen 2026-11-06) | Catalog |
|---|---|---|---|---|
| `alibaba/wan-3.0/text-to-video` | `prompt` (req), `duration` int **2–30** or null, `resolution` 480p/720p/1080p (default 1080p), `aspect_ratio` adaptive/16:9/4:3/1:1/3:4/9:16, `audio` bool (default true), `seed`, `enable_prompt_expansion` (default **true**), `enable_thinking`, `enable_safety_checker` | `video`, `duration`, `seed`, `actual_prompt` | $0.05 / $0.10 / $0.20 per s | active, `license_type: commercial` |
| `alibaba/wan-3.0/image-to-video` | as above + `start_image_url` (req), `end_image_url` | same | same | active |
| `minimax/h3-max-turbo/text-to-video` | `prompt`, `prompt_expansion_mode` (req), `duration` number **0.92–15**, `resolution` 480P/768P/1080P (default 768P), `aspect_ratio` 21:9/16:9/4:3/1:1/3:4/9:16, `seed`, `target_audio_url`, `sync_mode` | `video`, `expanded_prompt`, `timings` | **Promo to 2026-11-15**: $0.0175/$0.028/$0.056; **from 2026-11-16**: $0.025/$0.04/$0.08 per s | active, commercial, `retires_at: null` |
| `minimax/h3-max-turbo/image-to-video` | `image_url`, `end_image_url`, no `aspect_ratio` (follows image) | same | same | active |

Decisions:
- **Provider-side prompt expansion is disabled by default** (`enable_prompt_expansion: false`, `prompt_expansion_mode: "disabled"`): it rewrites prompts and could add product details or claims not in the brief. It stays a per-scene option.
- Registry pricing supports **date-ranged prices** (MiniMax promo). Estimates use the price in effect on the generation date.
- `license_type: "commercial"` from the catalog is stored as the provenance `commercial_use` evidence for generated clips; models without it are `unknown` → needs review.

## fal Platform APIs (cost + recovery)
| Need | Finding | Decision |
|---|---|---|
| Machine-readable prices | `GET /v1/models/pricing` exists (unit price per endpoint) | `scripts/models-check.ts` uses it together with OpenAPI schemas |
| Confirmed billing | `GET /v1/models/usage` returns usage records with `cost_total` by endpoint/date/auth method. Requires a key with **`billing:usage:read`** (presets `BILLING` or `FULL`). No per-request ID documented. | "Confirmed (fal)" is shown **per endpoint per day** on Settings when the key has billing permission. Per-ad confirmed stays **manual** unless records can be tied to one ad's time window with no other usage; never inferred. |
| Request lookup for crash recovery | `GET /v1/models/requests/by-endpoint` lists requests by endpoint, time range and status (permission `models:requests:read`, included in the default `API` preset). **No tag filter documented.** | Recovery after a crash between submit and storing `request_id`: list requests for that endpoint in `[submit_started − 5s, +120s]`, exclude IDs already in our DB; adopt it only if **exactly one** candidate remains, otherwise resubmit and record `exposure_duplicate`. |
| Failed-request billing | Not documented | Remains "exposure, billing unknown" (plan §10) |
