# PINPO

PINPO is the local AI ad production studio for **DemandMesh** ([demandmesh.shop](https://demandmesh.shop)).

You write a creative brief and PINPO builds an editable storyboard. Scenes are generated with fal.ai, then composed locally with the official DemandMesh brand: overlays, voiceover, music and the outro. Every ad is checked by technical and brand/compliance QA before you export it for social media.

- **Plan (source of truth):** [docs/engineering/PINPO_IMPLEMENTATION_PLAN_V2.2.md](docs/engineering/PINPO_IMPLEMENTATION_PLAN_V2.2.md)
- **Verified facts:** [docs/engineering/PHASE_0_FINDINGS.md](docs/engineering/PHASE_0_FINDINGS.md)

> **Status:** Phases 0–3 and 5–10 of the plan are implemented and tested (94 unit/integration tests and 4 end-to-end tests). **Phase 4 is still open:** one real ad made with your fal.ai key, then a quality review by DemandMesh (see below). Decisions and deviations from the plan are in [docs/engineering/IMPLEMENTATION_NOTES.md](docs/engineering/IMPLEMENTATION_NOTES.md).

## Requirements
- Node.js 22+
- Linux or macOS. Tested on Ubuntu with x64.
- About 2 GB of free disk space, plus room for your videos.

## Setup
```bash
npm install
npm run setup     # installs the pinned headless Chrome renderer and creates .env.local
npm run dev       # starts the studio (http://127.0.0.1:3000) and the background worker
```
`.env.local` starts in **mock mode** (`FAL_MOCK=1`). Mock mode generates free local test clips. For real generation, set `FAL_KEY=…` and `FAL_MOCK=0`.

- The fal.ai key is read **only by the worker process**. It is never sent to the browser.
- The studio listens on `127.0.0.1` only and has no login. **Don't expose it to a network.**

## How it works
| Part | Role |
|---|---|
| Next.js (UI + API) | Validates input, stores drafts, queues jobs. Never calls fal and never runs ffmpeg. |
| Worker (`src/worker`) | Generates clips with fal.ai, composes video with ffmpeg, renders brand graphics in headless Chrome, runs QA. One worker runs at a time, with leases and crash recovery. |
| SQLite (`~/.pinpo/data/studio.db`) | Holds all state: ads, versions, jobs, costs, QA. WAL mode, with daily backups in `~/.pinpo/data/backups/`. |
| `~/.pinpo/storage/` | Content-addressed media files with rights/licence information. |

All studio data lives in **`~/.pinpo`**, outside the project folder. Set `PINPO_HOME` to move it. Keeping it outside the project stops Next's dev bundler from reloading pages whenever the database changes. `npm run setup` moves data from the old in-project `data/` and `storage/` folders automatically.

## Scripts
| Command | What it does |
|---|---|
| `npm run dev` | Studio and worker, with reload |
| `npm run build && npm start` | Production build, then run |
| `npm test` | Unit and integration tests |
| `npm run typecheck` / `npm run lint` | Static checks |

## Brand assets (temporary items)
- **Logo:** the 304×62 PNG from demandmesh.shop is a **temporary** official logo. It is never AI-upscaled, and QA warns that it is low resolution. Replace it with the official high-resolution files in `assets/brand/demandmesh/` and update the hashes in `brand.json`.
- **Fonts:** Noto Sans, Noto Sans Malayalam and Noto Sans Devanagari (OFL) are placeholders until DemandMesh's approved fonts are supplied (`src/server/render/fonts.ts`).

## Making ads
1. Open **Ads** → name the ad, pick a template and platform → **Create ad**.
2. Fill in the brief:
   - **Product:** name, how it looks, and a product photo. Transparent PNG cut-outs look best.
   - **Benefits:** tick "This is true" for each. Only confirmed benefits appear on screen.
   - **Price and offer:** the discount is calculated for you.
   - **Call to action and style.**
3. **Build storyboard.** Then adjust camera, lighting, setting, timing and text layout per scene. Each scene shows a live frame preview with the safe area.
4. Optional: music and **Voiceover**. Recordings need the voice artist's consent.
5. **Generate.** Watch progress, then check **Quality checks**.
6. Mark items needing review as "I reviewed this", tick the claims confirmation, then **Download MP4** and **credits.txt**.
7. To change a finished ad, use **New version from this**. Unchanged scenes are reused at $0, and older versions stay playable.

## Real generation with fal.ai (Phase 4)
1. Put your key in `.env.local`: `FAL_KEY=…` and `FAL_MOCK=0`. The key is only read by the worker.
2. Restart with `npm run dev` (or `npm run build && npm start`).
3. Make a 15s **Product showcase** ad for a real product at 720p with **Wan 3.0**. That's about **$0.70–0.80** at fal list prices.
4. Review the result. On the ad page, enter what fal actually charged ("Confirmed").

Costs are shown in four separate figures:
- **Estimated:** list price at Generate.
- **Calculated:** list price × the length of each delivered clip.
- **Possible extra:** failed or cancelled attempts that fal may still bill.
- **Confirmed:** what you enter from the fal dashboard.

Only "Confirmed" is billing data. Run `npm run models:check` before relying on prices. It compares the model list with fal's live schemas, prices and retirement dates.

## What the quality checks mean
- **Technical:** exact length and size, 30 fps, BT.709 colour, AAC 48 kHz, fast-start MP4, clean decode, loudness −14 LUFS.
- **Brand:**
  - official pinned logo
  - only DemandMesh colours
  - readable text inside the platform safe area
  - correct outro with "demandmesh.shop"
  - product photo unchanged (colour/structure measured)
- **Advertising compliance:**
  - every on-screen claim must be a confirmed brief benefit
  - health, safety, performance, comparison and eco claims need evidence and your confirmation
  - no invented reviews or ratings
  - urgency wording needs real dates or stock
  - prices and offers must match the brief and be current
- **Rights:** commercial-use permission, valid licences, voice-artist consent, required credits.
- **Review items:** AI scenes that show the product always need a human look before export.

These checks reduce risk but are **not legal review**. Follow the ASCI code and India's Consumer Protection rules for final responsibility.

## Replacing the temporary logo and fonts
- **Logo:**
  1. Put the official files (high-resolution PNG) in `assets/brand/demandmesh/`.
  2. Update `logo.horizontal.file` and `sha256` in `brand.json`.
  3. The renderer only accepts a logo whose hash matches. Existing databases need a new brand revision, or a fresh `PINPO_HOME`.
- **Fonts:**
  1. Add the approved TTF files to `assets/fonts/`.
  2. Update `FONTS` (file + sha256) in `src/server/render/fonts.ts`.
  3. Re-approve the render snapshots: `UPDATE_RENDER_REFS=1 npx vitest run tests/integration/render-snapshots.test.ts`, then review the images.

## Testing
| Command | What it covers |
|---|---|
| `npm test` | Unit and integration tests: queue/leases, renderer safety, media pipeline, mock end-to-end with worker crash recovery, compliance, rights, audio ducking, render snapshots |
| `npm run test:e2e` | Production build + Playwright (desktop and 375 px): create → generate → review → export, autosave/conflict, versions |
| `npm run models:check` | Registry vs live fal schemas, prices and retirement dates |

## Troubleshooting
- **"Worker offline"**: start the studio with `npm run dev` or `npm start`. Both start the worker as well.
- **"Brand renderer not ready"**: run `npm run setup`. It installs the pinned headless Chrome.
- **Running out of disk**: Settings → **Free up space**. Generation pauses automatically when the disk is low and resumes after space is freed.
- **Database problem**: daily backups are in `~/.pinpo/data/backups/`.
