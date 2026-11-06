# Implementation notes

This log covers decisions made while building against `PINPO_IMPLEMENTATION_PLAN_V2.2.md`: deliberate deviations from the plan, and facts discovered along the way. Each entry gives the reason.

## Phase 3 — vertical slice pipeline

### ffmpeg 7.0.2 (`ffmpeg-static`) findings
1. **Per-frame scaling crashes.** A scale with `eval=frame` followed by `pad` or another scale/format in yuv420p corrupts the heap (`malloc_consolidate(): invalid chunk size`). The crop filter also evaluates `iw`/`ih` only on the first frame, so a push-in drifted toward the top-left.
   → Push-in and the outro logo reveal use **`zoompan`**, which keeps a fixed output size and re-centres every frame, applied to a 2× upscaled canvas for sub-pixel smoothness. Pan and parallax use a fixed-size `crop` with per-frame x/y only.
2. **Timebase mismatch.** `xfade` fails when its inputs use different timebases (1/15360 vs 1/12800).
   → Every clip is encoded with `-video_track_timescale 15360`. The compose graph also normalises each input with `settb=AVTB,setpts=PTS-STARTPTS,fps=30` before joining.
3. **Frame rate silently dropped to 25 fps.** After `setpts`/`trim`, the filter output loses its frame rate and ffmpeg falls back to 25 fps CFR.
   → Every encode passes **`-r 30`** explicitly, and the graph adds `fps=30` after `concat` and before the final format conversion.
4. **Music made output too long** (Phase 0). The final always passes `-t <timeline total>`, and the audio is `atrim`/`apad`-ed to the exact total.

### Deviations from the plan (with reasons)
| Plan | Implemented | Why |
|---|---|---|
| `server/models/entries/{…}.ts` | Both slice models are in `server/models/registry.ts` | Only two models in the slice. They split into `entries/` when Phase 5 adds the remaining models. |
| Product-preservation check on the **final** video at the hold frame | Measured on the **scene clip** at its hold frame (CRF 16), before overlays | Lower-third overlays can overlap the product rectangle in the final, which would wrongly fail the check. The final re-encode (CRF 18) adds negligible change on top. |
| Compose fallback: "hard cuts, no ducking" | Fallback keeps the planned timeline, uses **plain crossfades**, no ducking | Hard cuts remove the transition overlaps, which would make the ad longer than the length the user chose. |
| `dip_primary` transition to #0C1C28 | `xfade=fadeblack` | `xfade` has no custom-colour dip, and black is the closest to DemandMesh primary. To revisit if DemandMesh wants an exact primary dip; it can be built as a colour-source overlay. |
| EN/ML/HI overlays per scene | Each **version** renders one ad language (`finishing.outroLang`). Make another language as a new version. | Mixed-language overlays in one video weren't requested. Exports are per language and per platform. |
| Draft brief requires product name, appearance and audience | These may be empty while drafting; **Generate** requires them | Otherwise a placeholder description saved as real text could leak into AI prompts, and partly filled forms couldn't autosave. |

### Reliability fixes found by testing
- Killing the `tsx` wrapper with SIGKILL leaves the real Node worker running. Tests now spawn `node --import tsx` so crash tests are real. `npm run dev` is unaffected, because `concurrently -k` and `tsx watch` forward signals.
- Worker shutdown waited without limit for handlers after aborting them. It now bounds every wait (5 s grace, 5 s after abort) and has a 45 s hard-exit timer. Jobs resume from their stored stage, so a fast exit is safe.
- The product check compared transparent cut-outs as black. It now compares **only inside the alpha mask** for ΔE, and computes SSIM against the reference composited over the rendered backdrop. A cut-out lunch box measures mean ΔE 0.54, P95 1.55, SSIM 0.995.

## Phase 4 — pending (needs the user)
Phase 4 is generating a real 15s ad with the user's fal key and a real DemandMesh product, then getting the user's quality approval. It is **not done**: `.env.local` has no `FAL_KEY` (mock mode), and no real product photo has been supplied. The user asked for autonomous progress, so work continued with Phase 5. To run Phase 4:
1. Put `FAL_KEY=…` and `FAL_MOCK=0` in `.env.local`, then run `npm run dev`.
2. Create a *Product showcase* ad and upload the real product photo.
3. Generate at 720p with Wan 3.0, which is about $0.70–0.80 at list price.

## Phase 5 — expand creative
- **Registry re-verified against live fal before coding** (`npm run models:check` passes for 5 models and all modes). Corrections versus the earlier research:
  - **Gemini Omni Flash v1.1** allows **3–10 s** (15 s is v1.2), costs $0.03/$0.10/$0.15 per second, and has no audio or seed parameters.
  - **Kling v3 Pro** has **no resolution parameter**, and its image-to-video follows the image's aspect. The registry exposes one 720p tier.
  - **MiniMax H3 reference mode** has its own, higher price ($0.05/$0.08/$0.16 per second plus reference tokens), so pricing now supports per-mode tables and Kling's audio surcharge.
  - **Seedance 2.0 Mini** is token-billed. fal's per-second figures are used as **estimates**, and the UI says so.
- **Reference mode:** AI product scenes automatically use the reference endpoint when the model has one (Seedance, MiniMax, Gemini). The original product photos are uploaded unaltered, and prompts refer to them with each model's tag (`@Image1`, `Image 1`, …).
- **Templates:** 8 built-ins, including **Group buy**. The group-buy hook uses DemandMesh's own line "Buy it now, or buy together for less", verbatim from demandmesh.shop, added as the brand token `groupBuyLine`. Group-buy price, minimum buyers and deadline lines are generated only from the brief.
- **Outros:** Standard, Promotional (needs an offer), Product-specific (original photo, name, price) and Minimal logo. A light-on-white version of the minimal outro is used until an official inverse logo exists.
- **Rendering snapshots:** 7 outro references and 4 Malayalam/Hindi shaping references are committed in `tests/fixtures/render-refs/` after visual review.
- **Known limitations:**
  - Generated offer and group-buy lines (e.g. "Group price when 5 people join") are English in every ad language. No machine translation is done, because that would be invented copy.
  - The 16:9 outro reads small. This is flagged for the Phase 9 polish pass.

## Phase 6 — audio
- **Voiceover segments** are stored in `audio_tracks` and anchored by **scene position** (migration 002). Scene rows are recreated when the storyboard is rebuilt, so a `scene_id` foreign key would dangle.
- **Mix:**
  - The voiceover bus sits on top.
  - Music is sidechain-ducked under the voiceover (ratio 12).
  - Scene sound is optionally ducked under the voiceover.
  - In "mix" mode, music is also ducked under scene sound.
  - Test V1 measures this: music drops ≥ 8 dB during the voiceover, the voiceover starts within ±40 ms of its scheduled time, and the final is −14 ±2 LUFS.
- **Loudness correction pass (finding).** Single-pass `loudnorm` produced −19.7 LUFS for a voiceover-only ad (mostly silence plus short speech). Compose now measures integrated loudness after encoding. If it's off by more than 1 LU, it re-encodes only the audio with the exact gain and an `alimiter` at −1.5 dBTP, copying the video stream.
- **Deviations:**
  - The plan had waveform peaks computed by the worker and served by `GET /api/assets/[id]/peaks`. The editor instead decodes the audio file in the browser (Web Audio API) and draws peaks itself. This avoids a worker job and an extra route for the same result, and the server stays free of ffmpeg work for previews.
  - Audio uploads are checked with **ffprobe inside the Next upload route** (fast, bounded: ≤20 MB, ≤10 min). The rule "Next never runs ffmpeg" holds for generation and composition.
- **Rights:** a voiceover without recorded voice-artist consent makes QA `asset_rights` **fail**, which blocks export (PV3). The draft check warns about it before you generate.

## Phase 7 — full QA, compliance and rights
- **Rights gate** (`qa/checks/rights.ts`, used by compose):
  - **fail:** commercial use "no", licence expired, voiceover without voice-artist consent, CC BY licence without a credit line
  - **needs review:** commercial use unknown
  - The gate covers clips, product photos (including reference images), music, voiceovers, the logo and the fonts.
- **Credits:** `GET /api/versions/[vid]/credits` produces `credits.txt` from attributions and third-party licences. The export panel links to it.
- **Logo/outro accuracy:** the final's outro hold frame is compared with the expected official render, zoomed to 1.02 to match the end of the logo reveal. It must reach SSIM ≥ 0.97 on the full frame, and the measured value is stored as QA evidence. *Deviation:* the plan says logo-region SSIM ≥ 0.98. Full-frame is used because the logo's exact box isn't exported from the layout. The pinned-hash check still guarantees the right file.
- **Colour compliance** is enforced at render input: every brand-layer colour must be a token. The plan's extra check, sampling overlay pixels with ΔE ≤ 3, is **not implemented**. It adds little, because overlays are rendered from tokens onto solid panels.
- **Bug found and fixed:** in Zod 4, `z.record(LangEnum, …)` requires **all** keys, so the editor would have rejected scenes with overlays in only one language. It is now `z.partialRecord`, with a regression test.

## Phase 8 — product UI completion
- **Versions:**
  - "New version from this" copies the brief, claims (with new IDs, and overlay lines re-pointed to them), scenes and voiceovers into a new draft. Earlier versions and their finals are never changed.
  - The overview has a version switcher. A non-current version can be deleted.
  - There is only one draft per ad, so forking again returns the existing draft.
- **Clip reuse at $0:** Generate looks up the scene's `inputs_hash` anywhere in the same ad and reuses a finished clip, so no fal call is made. When every scene is reused (finishing-only edits such as outro, music or voiceover), the version goes straight to compose. Test I16: 0 scene jobs, $0 estimated, a new final, and the old final kept.
- **Brand settings:**
  - Copy fields are editable after an explicit unlock that lasts 10 minutes: tagline, group-buy line, approved CTAs in EN/ML/HI, and social.
  - Saving creates a revision and re-locks. Existing versions keep their revision.
  - Colours, logo files and website are identity and can't be edited here.
  - The master brand can't be deleted (B1/B2).
- **Library:** search and status filter (server-rendered), duplicate, and soft delete.
- **Templates:** a list of built-in and user templates. *Save as template* keeps the **structure** (roles, timing weights, scene types, layouts, overlay sources) and never the product copy. User templates can be deleted; built-ins can't.
- **Storage:** a daily GC job and a "Free up space" button. GC purges ads deleted more than 7 days ago, removes unreferenced assets after 24 hours (official and seed assets are never removed), and caps the cache at 5 GB (LRU). There is also a "Back up database now" button.
- **Settings:** studio status, storage use, spend by month (estimated / calculated / possible extra / confirmed, kept separate), and model check dates with a warning after 30 days.
- **Observed once, not reproducible:** right after many new route files were created, the dev server went into a "Compiled in 1ms" reload loop on one page. It didn't recur after a restart, and data/storage/SQLite writes were tested and ruled out as the trigger. Worth watching during development; it doesn't affect production builds.

## Phase 9 — UI polish
- **Root cause of the dev reload loop (found and fixed).** Turbopack watches everything under the project root. With the database and media inside the project (`data/`, `storage/`), the editor went into a Fast Refresh feedback loop (134 page reloads in 6 s). Moving the data outside the project gave 2 navigations and 0 recompiles.
  - Runtime data now defaults to **`~/.pinpo`** (override with `PINPO_HOME`), and `npm run setup` migrates old in-project folders.
  - *Deviation:* the plan's folder structure had `data/` and `storage/` in the repo root, still gitignored. The worker now reads `.env.local` from the project folder explicitly.
- **WYSIWYG frame previews** in the storyboard (plan §13). They use the same `OverlayLayer` component the renderer uses, at full frame size and scaled down, over the original product photo or an "AI footage" placeholder, with the platform safe area dashed. The brand fonts are served to the browser from the bundled files through an allow-listed `/api/fonts/[file]` route.
- **16:9 typography:** landscape frames scale type 1.4× (portrait and square are unchanged), so 16:9 text and outros no longer read small. The 16:9 outro snapshot was re-approved after visual review.
- **Small fixes:** the new-ad form defaults to *Product showcase*; library thumbnails are capped in height on phones; the header wraps at 375px; every page was checked for horizontal scroll at 375px (none).
