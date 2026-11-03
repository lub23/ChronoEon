// Saved fixes (including manual points and exclusions) are user data, not a
// disposable cache. The normalized address is their shared natural identity.
// Keep the entire fix in one register so concurrent devices cannot mix the
// longitude of one position with the latitude of another.
const data = (row: string) => `json_object('fix', json_array(${row}.lng, ${row}.lat, ${row}.score, ${row}.level), 'updated_at', ${row}.updated_at)`;
export const SCHEMA_V19_SQL = `
${["INSERT", "UPDATE"].map(event => `
CREATE TRIGGER sync_location_geocodes_${event.toLowerCase()} AFTER ${event} ON location_geocodes
WHEN (SELECT applying FROM sync_control WHERE id=1)=0
BEGIN
  INSERT INTO sync_changes(entity,entity_id,data_json) VALUES ('place',NEW.address,${data("NEW")})
  ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json,changed_at=excluded.changed_at;
END;`).join("\n")}
CREATE TRIGGER sync_location_geocodes_delete AFTER DELETE ON location_geocodes
WHEN (SELECT applying FROM sync_control WHERE id=1)=0
BEGIN
  INSERT INTO sync_changes(entity,entity_id,data_json) VALUES ('place',OLD.address,NULL)
  ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json,changed_at=excluded.changed_at;
END;
INSERT INTO sync_changes(entity,entity_id,data_json)
SELECT 'place',p.address,${data("p")} FROM location_geocodes p WHERE 1
ON CONFLICT(entity,entity_id) DO UPDATE SET data_json=excluded.data_json,changed_at=excluded.changed_at;
`;
