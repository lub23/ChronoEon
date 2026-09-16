import { validateState, type EntityState, type FieldVersion, type Json } from "./protocol";

/** A register's causal stamp is shared by every field written in that operation.
 * Store/export it once, not 30 copies per row. This is still logical JSONL. */
interface PackedState {
  entity: EntityState["entity"]; id: string; revision: number; clock: EntityState["clock"];
  versions: Array<Omit<FieldVersion, "value" | "base">>;
  fields: Record<string, Array<[number, Json, Json?]>>;
}
export function packState(state: EntityState): PackedState {
  const versions: PackedState["versions"] = []; const indices = new Map<string, number>();
  const fields: PackedState["fields"] = {};
  for (const [field, candidates] of Object.entries(state.fields)) fields[field] = candidates.map((candidate) => {
    let index = indices.get(candidate.operationId);
    if (index === undefined) {
      index = versions.length; indices.set(candidate.operationId, index);
      const { value: _value, base: _base, ...stamp } = candidate; versions.push(stamp);
    }
    return candidate.base === null ? [index, candidate.value] : [index, candidate.value, candidate.base];
  });
  return { entity: state.entity, id: state.id, revision: state.revision, clock: state.clock, versions, fields };
}
export function unpackState(value: unknown): EntityState {
  const packed = value as PackedState;
  if (!packed || !Array.isArray(packed.versions) || !packed.fields || typeof packed.fields !== "object") throw new Error("Invalid snapshot state");
  const fields: EntityState["fields"] = {};
  for (const [field, candidates] of Object.entries(packed.fields)) {
    if (["__proto__", "constructor", "prototype"].includes(field) || !Array.isArray(candidates)) throw new Error("Invalid snapshot field");
    fields[field] = candidates.map((candidate) => {
      if (!Array.isArray(candidate) || candidate.length < 2 || candidate.length > 3 || !Number.isSafeInteger(candidate[0]) || !packed.versions[candidate[0]]) throw new Error("Invalid snapshot version");
      return { ...packed.versions[candidate[0]], value: candidate[1], base: candidate[2] ?? null };
    });
  }
  const state = { entity: packed.entity, id: packed.id, revision: packed.revision, clock: packed.clock, fields };
  validateState(state); return state;
}
