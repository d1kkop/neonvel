-- Neon Velocity database (Cloudflare D1 = SQLite). Same tables as the old Node server.

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL COLLATE NOCASE,
  rating INTEGER NOT NULL,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  provider TEXT,
  provider_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS players_account ON players (provider, provider_id) WHERE provider IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  created INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

-- OAuth sign-ins in progress (state -> provider + where to send the browser back), 10 minutes.
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  ret TEXT NOT NULL,
  created INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS races (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  finished INTEGER NOT NULL,
  result TEXT NOT NULL
);

-- Track records: every driver's fastest checked lap per level (ms).
CREATE TABLE IF NOT EXISTS lap_times (
  player_id TEXT NOT NULL,
  level TEXT NOT NULL,
  ms INTEGER NOT NULL,
  car TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  PRIMARY KEY (player_id, level)
);
CREATE INDEX IF NOT EXISTS lap_times_level ON lap_times (level, ms);

CREATE TABLE IF NOT EXISTS purchases (
  player_id TEXT NOT NULL,
  item TEXT NOT NULL,
  source TEXT NOT NULL,
  ref TEXT,
  created INTEGER NOT NULL,
  PRIMARY KEY (player_id, item)
);
