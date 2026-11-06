# PINPO v3 addendum — generic ad studio (option A)

Approved 2026-11-06. Extends plan v2.2; everything not listed here is unchanged (local single-user
app, fal.ai only, SQLite, worker, QA/compliance gates, costs, versions, EN/ML/HI).

## What changes

1. **Brand kits, not one master brand.** Any number of brands; one is the *default* for new ads
   (`brand_kits.is_master` now means "default"). A brand is: name, website, tagline, two colours
   (main + accent; the other tokens are derived), approved calls to action, optional group-deal
   line, optional logo. DemandMesh is seeded on first run as the first brand; nothing is lost.
2. **Revision pinning is now enforced everywhere.** Compose, scene rendering, QA, previews and
   rights all use `brandForVersion(versionId)` — the brand revision the version was created with.
   (v2.2 code read the *current* master brand in compose/scene-generate; fixed.) New drafts
   (fork) pick up the brand's latest revision.
3. **Colour rule for any brand.** Main colour must reach 4.5:1 on white (overlay panels put white
   text on it and it on white); accent must reach 3:1. The form suggests a darker shade otherwise.
4. **Logo optional.** Uploaded logos (PNG/JPG/WebP, purpose `brand_logo`) are pinned by hash in
   the revision and become official. Without a logo the outro sets the brand name as a text
   wordmark; QA warns.
5. **Website check per brand.** The end-card check verifies the brand's own website (valid host)
   instead of the literal "demandmesh.shop".
6. **Studio identity.** The studio chrome becomes PINPO's own (no customer brand colours).
   Step-by-step creation flow, library wall, templates gallery, brands pages.

## Not changed

No accounts, cloud, payments or LLM. Typography/spacing/motion tokens are the studio's tuned
layout system, shared by all brands (custom fonts per brand: future work).
