-- PINPO initial schema (plan v2.2 §3, §11). All *_at columns are epoch milliseconds.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Content-addressed, immutable files + provenance (plan §8a).
CREATE TABLE assets (
  id                 TEXT PRIMARY KEY,
  sha256             TEXT NOT NULL UNIQUE,
  kind               TEXT NOT NULL CHECK (kind IN ('image','audio','video','font','document')),
  mime               TEXT NOT NULL,
  bytes              INTEGER NOT NULL,
  width              INTEGER,
  height             INTEGER,
  duration_s         REAL,
  path               TEXT NOT NULL,
  source             TEXT NOT NULL CHECK (source IN ('upload','generated','composed','derived','seed','rendered')),
  original_name      TEXT,
  official           INTEGER NOT NULL DEFAULT 0,
  temporary          INTEGER NOT NULL DEFAULT 0,
  source_type        TEXT CHECK (source_type IN ('official_brand','product_supplier','own_photo','stock_licensed','commissioned','recorded_voice','generated_fal','rendered','font')),
  origin             TEXT,
  license            TEXT,
  commercial_use     TEXT NOT NULL DEFAULT 'unknown' CHECK (commercial_use IN ('yes','no','unknown')),
  attribution_text   TEXT,
  rights_holder      TEXT,
  license_expires_at INTEGER,
  talent_consent     INTEGER NOT NULL DEFAULT 0,
  proof_note         TEXT,
  icc_profile        TEXT,
  created_at         INTEGER NOT NULL
);

CREATE TABLE brand_kits (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  is_master           INTEGER NOT NULL DEFAULT 0,
  locked              INTEGER NOT NULL DEFAULT 0,
  current_revision_id TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  deleted_at          INTEGER
);
CREATE UNIQUE INDEX one_master_brand ON brand_kits(is_master) WHERE is_master = 1;

CREATE TABLE brand_kit_revisions (
  id           TEXT PRIMARY KEY,
  brand_kit_id TEXT NOT NULL REFERENCES brand_kits(id),
  number       INTEGER NOT NULL,
  tokens_json  TEXT NOT NULL,
  note         TEXT,
  created_at   INTEGER NOT NULL,
  UNIQUE (brand_kit_id, number)
);

CREATE TABLE brand_kit_logos (
  brand_kit_id  TEXT NOT NULL REFERENCES brand_kits(id),
  variant       TEXT NOT NULL CHECK (variant IN ('horizontal','icon','inverse')),
  asset_id      TEXT NOT NULL REFERENCES assets(id),
  pinned_sha256 TEXT NOT NULL,
  PRIMARY KEY (brand_kit_id, variant)
);

CREATE TABLE brand_kit_products (
  brand_kit_id TEXT NOT NULL REFERENCES brand_kits(id),
  asset_id     TEXT NOT NULL REFERENCES assets(id),
  position     INTEGER NOT NULL,
  PRIMARY KEY (brand_kit_id, asset_id)
);

CREATE TABLE outro_presets (
  id           TEXT PRIMARY KEY,
  brand_kit_id TEXT NOT NULL REFERENCES brand_kits(id),
  type         TEXT NOT NULL CHECK (type IN ('standard','promotional','product','minimal')),
  name         TEXT NOT NULL,
  layout_json  TEXT NOT NULL,
  duration_s   REAL NOT NULL,
  builtin      INTEGER NOT NULL DEFAULT 1,
  UNIQUE (brand_kit_id, type, name)
);

CREATE TABLE templates (
  id                 TEXT PRIMARY KEY,
  key                TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  description        TEXT NOT NULL,
  builtin            INTEGER NOT NULL DEFAULT 0,
  scenes_json        TEXT NOT NULL,
  cta_spec_json      TEXT NOT NULL,
  default_outro_type TEXT NOT NULL,
  platforms_json     TEXT NOT NULL,
  lengths_json       TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE TABLE ads (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  brand_kit_id       TEXT NOT NULL REFERENCES brand_kits(id),
  current_version_id TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  deleted_at         INTEGER
);

CREATE TABLE ad_versions (
  id                TEXT PRIMARY KEY,
  ad_id             TEXT NOT NULL REFERENCES ads(id),
  number            INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','queued','generating','composing','ready','failed','canceled')),
  qa_status         TEXT NOT NULL DEFAULT 'none'
                    CHECK (qa_status IN ('none','running','passed','needs_review','failed','approved')),
  revision          INTEGER NOT NULL DEFAULT 0,
  settings_json     TEXT NOT NULL,
  finishing_json    TEXT NOT NULL,
  settings_hash     TEXT,
  platform          TEXT NOT NULL,
  pacing            TEXT NOT NULL DEFAULT 'standard' CHECK (pacing IN ('calm','standard','fast')),
  brand_revision_id TEXT NOT NULL REFERENCES brand_kit_revisions(id),
  template_id       TEXT REFERENCES templates(id),
  outro_preset_id   TEXT REFERENCES outro_presets(id),
  final_asset_id    TEXT REFERENCES assets(id),
  thumb_asset_id    TEXT REFERENCES assets(id),
  error_code        TEXT,
  error_message     TEXT,
  parent_version_id TEXT REFERENCES ad_versions(id),
  locked_at         INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  UNIQUE (ad_id, number)
);
CREATE UNIQUE INDEX one_draft_per_ad ON ad_versions(ad_id) WHERE status = 'draft';

CREATE TABLE briefs (
  version_id     TEXT PRIMARY KEY REFERENCES ad_versions(id) ON DELETE CASCADE,
  product_json   TEXT NOT NULL,
  audience_json  TEXT NOT NULL,
  campaign_json  TEXT NOT NULL,
  offers_json    TEXT NOT NULL,
  cta_json       TEXT NOT NULL,
  creative_json  TEXT NOT NULL,
  languages_json TEXT NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE claims (
  id                  TEXT PRIMARY KEY,
  version_id          TEXT NOT NULL REFERENCES ad_versions(id) ON DELETE CASCADE,
  position            INTEGER NOT NULL,
  text                TEXT NOT NULL,
  language            TEXT NOT NULL CHECK (language IN ('en','ml','hi')),
  category            TEXT NOT NULL DEFAULT 'general'
                      CHECK (category IN ('general','medical_health','safety','performance','comparative','environmental','testimonial','urgency','pricing')),
  confirmed           INTEGER NOT NULL DEFAULT 0,
  source              TEXT,
  substantiation      TEXT,
  attested_at         INTEGER,
  testimonial_consent INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL
);

CREATE TABLE scenes (
  id                    TEXT PRIMARY KEY,
  version_id            TEXT NOT NULL REFERENCES ad_versions(id) ON DELETE CASCADE,
  position              INTEGER NOT NULL,
  role                  TEXT NOT NULL,
  scene_type            TEXT NOT NULL CHECK (scene_type IN ('product_original','ai_from_product','ai_reference','ai_scene')),
  prompt                TEXT NOT NULL DEFAULT '',
  duration_s            REAL NOT NULL,
  shows_product         INTEGER NOT NULL DEFAULT 0,
  visual_direction      TEXT NOT NULL DEFAULT '',
  motion_preset         TEXT NOT NULL DEFAULT 'fade-up',
  creative_json         TEXT NOT NULL DEFAULT '{}',
  overlay_json          TEXT NOT NULL DEFAULT '{}',
  product_asset_id      TEXT REFERENCES assets(id),
  start_frame_asset_id  TEXT REFERENCES assets(id),
  end_frame_asset_id    TEXT REFERENCES assets(id),
  inputs_hash           TEXT,
  clip_asset_id         TEXT REFERENCES assets(id),
  reused_from_scene_id  TEXT REFERENCES scenes(id),
  status                TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','pending','running','succeeded','failed','canceled','reused')),
  UNIQUE (version_id, position)
);

CREATE TABLE audio_tracks (
  id          TEXT PRIMARY KEY,
  version_id  TEXT NOT NULL REFERENCES ad_versions(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('clip','voiceover','music')),
  scene_id    TEXT REFERENCES scenes(id),
  asset_id    TEXT REFERENCES assets(id),
  offset_s    REAL NOT NULL DEFAULT 0,
  volume_db   REAL NOT NULL DEFAULT 0,
  fade_in_s   REAL NOT NULL DEFAULT 0,
  fade_out_s  REAL NOT NULL DEFAULT 0,
  duck        INTEGER NOT NULL DEFAULT 1,
  muted       INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload','tts')),
  peaks_json  TEXT
);

CREATE TABLE jobs (
  id                TEXT PRIMARY KEY,
  type              TEXT NOT NULL CHECK (type IN ('scene_generate','compose','qa','render_preview','maintenance')),
  version_id        TEXT REFERENCES ad_versions(id),
  scene_id          TEXT REFERENCES scenes(id),
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','running','retry_wait','blocked_disk','succeeded','failed','canceled')),
  stage             TEXT NOT NULL,
  priority          INTEGER NOT NULL DEFAULT 100,
  attempt           INTEGER NOT NULL DEFAULT 1,
  max_attempts      INTEGER NOT NULL DEFAULT 3,
  next_run_at       INTEGER NOT NULL,
  idempotency_key   TEXT NOT NULL UNIQUE,
  lease_owner       TEXT,
  lease_expires_at  INTEGER,
  heartbeat_at      INTEGER,
  fal_endpoint      TEXT,
  fal_request_id    TEXT,
  submit_state      TEXT CHECK (submit_state IN ('none','submitting','submitted')),
  submit_started_at INTEGER,
  input_json        TEXT NOT NULL DEFAULT '{}',
  result_json       TEXT,
  progress          REAL,
  queue_position    INTEGER,
  error_code        TEXT,
  error_message     TEXT,
  cancel_requested  INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX jobs_claimable ON jobs(type, status, next_run_at);
CREATE INDEX jobs_by_version ON jobs(version_id);

CREATE TABLE job_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      TEXT NOT NULL REFERENCES jobs(id),
  at          INTEGER NOT NULL,
  from_status TEXT,
  to_status   TEXT,
  stage       TEXT,
  message     TEXT,
  data_json   TEXT
);
CREATE INDEX job_events_by_job ON job_events(job_id, id);

CREATE TABLE cost_entries (
  id                 TEXT PRIMARY KEY,
  version_id         TEXT REFERENCES ad_versions(id),
  job_id             TEXT REFERENCES jobs(id),
  scene_id           TEXT REFERENCES scenes(id),
  kind               TEXT NOT NULL CHECK (kind IN ('estimated','calculated','exposure_failed','exposure_canceled','exposure_duplicate','confirmed_provider','confirmed_manual')),
  usd                REAL NOT NULL,
  attempt            INTEGER,
  fal_request_id     TEXT,
  mock               INTEGER NOT NULL DEFAULT 0,
  reconciled         INTEGER NOT NULL DEFAULT 0,
  possible_duplicate INTEGER NOT NULL DEFAULT 0,
  pricing_version    TEXT,
  basis_json         TEXT,
  note               TEXT,
  at                 INTEGER NOT NULL,
  UNIQUE (fal_request_id, kind)
);
CREATE INDEX cost_by_version ON cost_entries(version_id);

CREATE TABLE qa_reports (
  id         TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES ad_versions(id),
  kind       TEXT NOT NULL CHECK (kind IN ('technical','creative')),
  status     TEXT NOT NULL CHECK (status IN ('running','passed','needs_review','failed')),
  created_at INTEGER NOT NULL
);

CREATE TABLE qa_items (
  id              TEXT PRIMARY KEY,
  report_id       TEXT NOT NULL REFERENCES qa_reports(id) ON DELETE CASCADE,
  check_key       TEXT NOT NULL,
  method          TEXT NOT NULL CHECK (method IN ('automated','heuristic','human')),
  status          TEXT NOT NULL CHECK (status IN ('pass','warn','fail','needs_review')),
  message         TEXT NOT NULL,
  evidence_json   TEXT,
  acknowledged_at INTEGER
);

CREATE TABLE attestations (
  id         TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES ad_versions(id),
  kind       TEXT NOT NULL CHECK (kind IN ('compliance_final','qa_review')),
  text       TEXT NOT NULL,
  at         INTEGER NOT NULL
);

-- Single-instance worker lease + heartbeat (plan §5).
CREATE TABLE workers (
  id                 TEXT PRIMARY KEY,
  instance_id        TEXT NOT NULL,
  pid                INTEGER NOT NULL,
  started_at         INTEGER NOT NULL,
  heartbeat_at       INTEGER NOT NULL,
  lease_expires_at   INTEGER NOT NULL,
  fal_key_configured INTEGER NOT NULL DEFAULT 0,
  mock_mode          INTEGER NOT NULL DEFAULT 0,
  renderer_version   TEXT,
  browser_pid        INTEGER,
  stopped_at         INTEGER
);
