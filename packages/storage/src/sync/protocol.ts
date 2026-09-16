import { merge } from "node-diff3";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type EntityKind = "entry" | "attachment" | "conversation" | "message" | "settings";
export type Clock = Record<string, number>;
export type EntityData = Record<string, Json>;
export interface SyncOperation {
  version: 1;
  operationId: string;
  deviceId: string;
  sequence: number;
  revision: number;
  timestamp: string;
  entity: EntityKind;
  id: string;
  op: "create" | "update" | "delete" | "attachment.add" | "attachment.remove";
  /** Causal context is essential: revision/timestamp alone cannot detect concurrent edits. */
  context: Clock;
  data: EntityData;
  base: EntityData;
}
export interface FieldVersion {
  operationId: string; deviceId: string; sequence: number; revision: number;
  timestamp: string; context: Clock; value: Json; base: Json;
}
export interface EntityState {
  entity: EntityKind; id: string; revision: number; clock: Clock;
  fields: Record<string, FieldVersion[]>;
}
export interface SyncConflict {
  entity: EntityKind; id: string; field: string; versions: FieldVersion[]; clock: Clock;
}
export const SETTINGS_ID = "00000000-0000-5000-8000-000000000001";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KINDS = new Set(["entry", "attachment", "conversation", "message", "settings"]);
const EXISTS = "$exists";
const TAG = "$tag:";
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function equal(left: unknown, right: unknown): boolean { return stableJson(left) === stableJson(right); }
function covers(clock: Clock, version: Pick<FieldVersion, "deviceId" | "sequence">): boolean { return (clock[version.deviceId] ?? 0) >= version.sequence; }
function combineClock(left: Clock, right: Clock): Clock {
  const result = { ...left };
  for (const [device, sequence] of Object.entries(right)) result[device] = Math.max(result[device] ?? 0, sequence);
  return result;
}
function order(left: FieldVersion, right: FieldVersion): number {
  return left.revision - right.revision || left.timestamp.localeCompare(right.timestamp) || left.deviceId.localeCompare(right.deviceId) || left.sequence - right.sequence;
}
function mergeVersions(left: FieldVersion[], right: FieldVersion[]): FieldVersion[] {
  const unique = [...new Map([...left, ...right].map((version) => [version.operationId, version])).values()];
  return unique.filter((version) => !unique.some((other) => other.operationId !== version.operationId && covers(other.context, version))).sort(order);
}
/** Multi-value registers converge regardless of delivery order, retries or clock skew. */
export function mergeEntity(left: EntityState | undefined, right: EntityState): EntityState {
  if (left && (left.id !== right.id || left.entity !== right.entity)) throw new Error("Sync entity identity mismatch");
  const fields = { ...left?.fields };
  for (const [field, versions] of Object.entries(right.fields)) fields[field] = mergeVersions(fields[field] ?? [], versions);
  return { entity: right.entity, id: right.id, revision: Math.max(left?.revision ?? 0, right.revision), clock: combineClock(left?.clock ?? {}, right.clock), fields };
}
export function applyOperation(state: EntityState | undefined, operation: SyncOperation): EntityState {
  const fields: EntityState["fields"] = {};
  for (const [field, value] of Object.entries(operation.data)) fields[field] = [{
    operationId: operation.operationId, deviceId: operation.deviceId, sequence: operation.sequence,
    revision: operation.revision, timestamp: operation.timestamp, context: operation.context,
    value, base: operation.base[field] ?? null,
  }];
  return mergeEntity(state, { entity: operation.entity, id: operation.id, revision: operation.revision,
    clock: { ...operation.context, [operation.deviceId]: operation.sequence }, fields });
}
/** Tags are independent add-wins set members, not one competing array. */
export function flattenData(data: EntityData | null): EntityData {
  if (!data) return { [EXISTS]: false };
  const result: EntityData = { ...data, [EXISTS]: true }; delete result.id;
  if (Array.isArray(data.tags)) {
    delete result.tags;
    for (const tag of data.tags) if (typeof tag === "string") result[TAG + tag] = true;
  }
  return result;
}
export function fieldValue(field: string, versions: FieldVersion[]): { value: Json; conflict: boolean } {
  if (!versions.length) return { value: null, conflict: false };
  const unique = [...new Map(versions.map((version) => [stableJson(version.value), version.value])).values()];
  if (unique.length === 1) return { value: unique[0], conflict: false };
  // Derived timestamps are not user content. Clock order still owns causality.
  if (field === "updated_at" || field === "created_at") {
    const sorted = unique.map(String).sort(); return { value: field === "created_at" ? sorted[0] : sorted.at(-1)!, conflict: false };
  }
  if (field.startsWith(TAG)) return { value: unique.includes(true), conflict: false };
  // Three-way, line-aware diary merge only when a shared base is available.
  // AI message content and Todo status never receive this text policy.
  if (field === "note" && unique.every((value) => typeof value === "string")
    && versions.every((version) => typeof version.base === "string" && version.base === versions[0].base)) {
    let value = String(versions[0].value);
    for (const version of versions.slice(1)) {
      const result = merge(value.split("\n"), String(version.base).split("\n"), String(version.value).split("\n"));
      if (result.conflict) return { value: String(versions.at(-1)!.value), conflict: true };
      value = result.result.join("\n");
    }
    return { value, conflict: false };
  }
  // A concurrent delete/edit keeps the item visible AND keeps the tombstone.
  // Only an explicit resolution can discard either candidate.
  return { value: field === EXISTS ? unique.includes(true) : versions.at(-1)!.value, conflict: true };
}
export function materialize(state: EntityState): { data: EntityData | null; conflicts: SyncConflict[] } {
  const data: EntityData = {}; const conflicts: SyncConflict[] = [];
  let exists = true; const tags: string[] = [];
  for (const [field, versions] of Object.entries(state.fields)) {
    const result = fieldValue(field, versions);
    if (result.conflict) conflicts.push({ entity: state.entity, id: state.id, field, versions, clock: state.clock });
    if (field === EXISTS) exists = result.value === true;
    else if (field.startsWith(TAG)) { if (result.value === true) tags.push(field.slice(TAG.length)); }
    else data[field] = result.value;
  }
  if (state.entity === "entry") data.tags = tags.sort();
  return { data: exists ? data : null, conflicts: exists ? conflicts : [] };
}
export function localPatch(state: EntityState | undefined, data: EntityData | null): { data: EntityData; base: EntityData } {
  const previous = state ? flattenData(materialize(state).data) : {};
  const next = flattenData(data); const patch: EntityData = {}; const base: EntityData = {};
  const fields = data === null ? [EXISTS] : new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const field of fields) {
    const before = previous[field] ?? (field.startsWith(TAG) ? false : null);
    const after = next[field] ?? (field.startsWith(TAG) ? false : null);
    if (!equal(before, after)) { patch[field] = after; base[field] = before; }
  }
  if (Object.keys(patch).length) { patch[EXISTS] = data !== null; base[EXISTS] = previous[EXISTS] ?? false; }
  return { data: patch, base };
}
function validClock(value: unknown): value is Clock {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.entries(value).every(([key, sequence]) => UUID.test(key) && Number.isSafeInteger(sequence) && Number(sequence) >= 0);
}
export function validateOperation(value: unknown): asserts value is SyncOperation {
  const op = value as SyncOperation;
  if (!op || op.version !== 1 || !UUID.test(op.operationId) || !UUID.test(op.id) || !UUID.test(op.deviceId)
    || !KINDS.has(op.entity) || !["create", "update", "delete", "attachment.add", "attachment.remove"].includes(op.op)
    || !Number.isSafeInteger(op.revision) || op.revision < 1 || !Number.isSafeInteger(op.sequence) || op.sequence < 1
    || !Number.isFinite(Date.parse(op.timestamp)) || !validClock(op.context)
    || (op.context[op.deviceId] ?? 0) >= op.sequence
    || !op.data || !op.base || Array.isArray(op.data) || typeof op.data !== "object" || typeof op.base !== "object"
    || op.data[EXISTS] !== !(op.op === "delete" || op.op === "attachment.remove")) throw new Error("Invalid sync operation");
  for (const field of Object.keys(op.data)) if (["__proto__", "constructor", "prototype"].includes(field)) throw new Error("Invalid sync field");
}
export function validateState(value: unknown): asserts value is EntityState {
  const state = value as EntityState;
  if (!state || !UUID.test(state.id) || !KINDS.has(state.entity) || !validClock(state.clock)
    || !Number.isSafeInteger(state.revision) || state.revision < 1 || !state.fields || !state.fields[EXISTS]) throw new Error("Invalid snapshot entity");
  for (const [field, versions] of Object.entries(state.fields)) {
    if (["__proto__", "constructor", "prototype"].includes(field) || !Array.isArray(versions) || !versions.length) throw new Error("Invalid snapshot field");
    for (const version of versions) {
      validateOperation({ version: 1, ...version, entity: state.entity, id: state.id,
        op: field === EXISTS && version.value === false ? "delete" : "update", data: { [EXISTS]: true, [field]: version.value }, base: { [field]: version.base } });
      if (!covers(state.clock, version)) throw new Error("Snapshot clock does not cover its fields");
    }
  }
}
