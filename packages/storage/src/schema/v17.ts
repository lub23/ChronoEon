// Geocoder cache for the map view. Every row is rebuildable from the address
// text, so it never joins the sync journal or the operation history. The
// one-off backfill script may create the table before the app upgrades, hence
// IF NOT EXISTS.
export const SCHEMA_V17_SQL = `
CREATE TABLE IF NOT EXISTS location_geocodes (
  address TEXT PRIMARY KEY,
  lng REAL,
  lat REAL,
  score INTEGER,
  level TEXT,
  updated_at TEXT NOT NULL
);
`;
