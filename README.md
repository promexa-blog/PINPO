# PINPO

PINPO is the local AI ad production studio for **DemandMesh** ([demandmesh.shop](https://demandmesh.shop)).

You write a creative brief and PINPO builds an editable storyboard. Scenes are generated with fal.ai, then composed locally with the official DemandMesh brand: overlays, voiceover, music and the outro. Every ad is checked by technical and brand/compliance QA before you export it for social media.

- **Plan (source of truth):** [docs/engineering/PINPO_IMPLEMENTATION_PLAN_V2.2.md](docs/engineering/PINPO_IMPLEMENTATION_PLAN_V2.2.md)
- **Verified facts:** [docs/engineering/PHASE_0_FINDINGS.md](docs/engineering/PHASE_0_FINDINGS.md)

> **Status:** under active development. Phase 1 (foundation) is complete. Creating ads arrives in Phases 2–4.

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
| SQLite (`data/studio.db`) | Holds all state: ads, versions, jobs, costs, QA. WAL mode, with daily backups in `data/backups/`. |
| `storage/` | Content-addressed media files with rights/licence information. |

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
