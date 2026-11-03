import { normalizeAddress } from "@chronoeon/domain";
import type { PersistencePort } from "../persistence/PersistencePort";
import { runDatabaseOperation } from "../persistence/coordinator";

export interface GeocodeRow {
  address: string;
  lng: number | null;
  lat: number | null;
  /** Geocoder confidence; `-1` marks an address the user excluded from the map. */
  score: number | null;
  level: string | null;
  updatedAt: string;
}

interface StoredRow { address: string; lng: number | null; lat: number | null; score: number | null; level: string | null; updated_at: string }

/** Disposable geocoder cache: every row can be rebuilt from the address text. */
export class GeocodeStore {
  constructor(private readonly db: PersistencePort) {}

  all(): Promise<GeocodeRow[]> {
    return runDatabaseOperation(this.db, async () =>
      (await this.db.select<StoredRow>("SELECT address, lng, lat, score, level, updated_at FROM location_geocodes"))
        .map((row) => ({ address: row.address, lng: row.lng, lat: row.lat, score: row.score, level: row.level, updatedAt: row.updated_at })));
  }

  put(row: Omit<GeocodeRow, "updatedAt"> & { updatedAt?: string }): Promise<void> {
    return runDatabaseOperation(this.db, () => this.db.execute(
      `INSERT INTO location_geocodes(address, lng, lat, score, level, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET lng = excluded.lng, lat = excluded.lat, score = excluded.score, level = excluded.level, updated_at = excluded.updated_at`,
      [normalizeAddress(row.address), row.lng, row.lat, row.score, row.level, row.updatedAt ?? new Date().toISOString()],
    ));
  }

  remove(address: string): Promise<void> {
    return runDatabaseOperation(this.db, () => this.db.execute("DELETE FROM location_geocodes WHERE address = ?", [normalizeAddress(address)]));
  }
}
