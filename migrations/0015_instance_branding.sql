-- Instance-wide site name and logo. One row. Null name and logo mean the Oxen Studio defaults.
CREATE TABLE IF NOT EXISTS instance_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  site_name TEXT,
  logo_key TEXT,
  logo_type TEXT,
  updated_at INTEGER NOT NULL
);
