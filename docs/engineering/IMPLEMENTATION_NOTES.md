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
