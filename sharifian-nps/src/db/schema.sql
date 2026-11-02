-- Sharifian NPS — schema v1. All timestamps are UTC ISO-8601 strings.
-- Columns marked [+] are additions to the original spec (see DECISIONS.md D26).

CREATE TABLE customers (
  id                  INTEGER PRIMARY KEY,
  mobile              TEXT NOT NULL UNIQUE,              -- 09xxxxxxxxx (normalized)
  name                TEXT,
  company             TEXT,
  city                TEXT,
  province            TEXT,
  customer_type       TEXT,                              -- عطاری، سوپرمارکت، رستوران، پخش‌کننده…
  value_tier          TEXT CHECK (value_tier IN ('A','B','C')),
  sales_rep           TEXT,
  first_purchase_date TEXT,                              -- stored as given in the CSV
  imported_at         TEXT NOT NULL,
  is_demo             INTEGER NOT NULL DEFAULT 0         -- [+] created by seed:demo
);

CREATE TABLE responses (
  id              INTEGER PRIMARY KEY,
  mobile          TEXT NOT NULL,
  customer_id     INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  score           INTEGER NOT NULL CHECK (score BETWEEN 0 AND 10),
  category        TEXT NOT NULL CHECK (category IN ('promoter','passive','detractor')),
  drivers         TEXT NOT NULL DEFAULT '[]',            -- JSON array of driver ids
  comment         TEXT,
  contact_ok      INTEGER NOT NULL DEFAULT 0,
  src             TEXT NOT NULL DEFAULT 'direct',
  rep             TEXT,
  duration_ms     INTEGER,
  ip_hash         TEXT,
  user_agent      TEXT,
  created_at      TEXT NOT NULL,
  followup_status TEXT NOT NULL DEFAULT 'none'
                  CHECK (followup_status IN ('none','todo','called','resolved','unreachable')),
  followup_note   TEXT,
  followup_by     TEXT,
  followup_at     TEXT,
  theme_tags      TEXT NOT NULL DEFAULT '[]',            -- JSON array of theme ids
  featured        INTEGER NOT NULL DEFAULT 0,            -- [+] selected quote for the report
  kind            TEXT NOT NULL DEFAULT 'live'           -- [+] live | test | demo
                  CHECK (kind IN ('live','test','demo'))
);
-- One response per mobile for real responses; test and demo rows are exempt.
CREATE UNIQUE INDEX ux_responses_mobile_live ON responses(mobile) WHERE kind = 'live';
CREATE INDEX ix_responses_created ON responses(created_at);
CREATE INDEX ix_responses_customer ON responses(customer_id);
CREATE INDEX ix_responses_mobile ON responses(mobile);

CREATE TABLE duplicate_attempts (
  id         INTEGER PRIMARY KEY,
  mobile     TEXT NOT NULL,
  score      INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_duplicate_mobile ON duplicate_attempts(mobile);

CREATE TABLE events (
  id         INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,                              -- random, no personal data
  type       TEXT NOT NULL CHECK (type IN ('view','score_selected','step2_done','submitted')),
  src        TEXT NOT NULL DEFAULT 'direct',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_events_session_type ON events(session_id, type);
CREATE INDEX ix_events_type_created ON events(type, created_at);
