import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { OperationHistoryChange, OperationHistoryRecord, SyncStore } from "@chronoeon/storage";
import type { Locale } from "../domain/entry";
import { useConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { useModalDismiss } from "./modalLayer";

interface Props {
  locale: Locale;
  journal: SyncStore;
  onRestored: () => Promise<void>;
  onPreview?: (record: OperationHistoryRecord) => void;
}

const PREVIEW_COUNT = 5;
const INTERNAL_FIELDS = new Set(["id", "$exists", "updated_at", "created_at", "rowid", "builtin", "builtinKey", "builtinSubKeys"]);

interface HistoryDetail {
  id: string;
  scope: string;
  label: string;
  before: unknown;
  after: unknown;
}

function fieldLabel(key: string, zh: boolean) {
  const labels: Record<string, [string, string]> = {
    title: ["标题", "Title"], name: ["名称", "Name"], category: ["分类", "Category"], location: ["地点", "Location"],
    note: ["备注", "Note"], amount: ["金额", "Amount"], currency: ["币种", "Currency"], payment: ["支付方式", "Payment"],
    status: ["状态", "Status"], cost: ["成本", "Cost"], disposal: ["处置", "Disposal"], time: ["时间", "Time"],
    date: ["日期", "Date"], all_day: ["全天", "All day"], recurrence: ["重复", "Repeat"], recurring_end: ["重复截止", "Repeat until"],
    reminder: ["提醒", "Reminder"], start: ["开始", "Start"], end: ["结束", "End"], calendar: ["日历", "Calendar"],
    calendarId: ["日历", "Calendar"], acquired_on: ["获得日期", "Acquired on"], acquired_at: ["获得时间", "Acquired time"],
    sale_amount: ["出售所得", "Sale proceeds"], disposed_on: ["处置日期", "Disposed on"], payload_json: ["设置", "Setting"],
    priority: ["重要性", "Priority"], urgency: ["紧急性", "Urgency"], tags: ["标签", "Tags"], images: ["照片", "Photos"],
    purchase_entry_id: ["购入账目", "Purchase bill"], sale_entry_id: ["出售账目", "Sale bill"],
    base_url: ["接口地址", "Endpoint"], model: ["模型", "Model"], provider_kind: ["服务", "Provider"], backend: ["类型", "Type"],
    enabled: ["启用", "Enabled"], default_calendar_id: ["默认日历", "Default calendar"], time_scale: ["时间粒度", "Time scale"],
    first_day: ["每周首日", "First day"], theme: ["主题", "Theme"], language: ["语言", "Language"],
    start_time: ["开始时间", "Start"], end_time: ["结束时间", "End"], end_date: ["结束日期", "End date"],
    notes: ["备注", "Notes"], acquisition: ["获得方式", "Acquisition"], modality: ["类型", "Type"],
    images_json: ["照片", "Photos"], recurring_days: ["重复日", "Repeat days"],
    calendars: ["日历", "Calendars"], itemCategories: ["物品分类", "Asset categories"],
    defaultCategoryId: ["默认分类", "Default category"], defaultBillCategoryId: ["默认账目分类", "Default bill category"],
    defaultBillSubCategoryId: ["默认子分类", "Default subcategory"], defaultItemCategoryId: ["默认物品分类", "Default asset category"],
    defaultPaymentMethodId: ["默认支付方式", "Default payment"],
  };
  return labels[key]?.[zh ? 0 : 1] ?? key.replace(/_/g, " ");
}

function scopeLabel(table: string, zh: boolean) {
  const labels: Record<string, [string, string]> = {
    device_preferences: ["本机设置", "Device settings"],
    entries: ["条目", "Entry"], items: ["物品", "Asset"], entry_tags: ["标签", "Tag"], attachments: ["附件", "Attachment"],
    attachment_ingest_queue: ["附件导入", "Attachment import"], sync_settings: ["共享设置", "Shared setting"],
    ai_conversations: ["AI 对话", "AI conversation"], ai_messages: ["AI 消息", "AI message"],
  };
  return labels[table]?.[zh ? 0 : 1] ?? table;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || !/^\s*[[{]/.test(value)) return value;
  try { return JSON.parse(value); } catch { return value; }
}

function flattenDetailValue(value: unknown, prefix: string, output: Map<string, unknown>) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flattenDetailValue(child, `${prefix}/${key}`, output);
    return;
  }
  if (Array.isArray(value)) {
    if (!value.length) { output.set(prefix, value); return; }
    value.forEach((child, index) => flattenDetailValue(child, `${prefix}/${index}`, output));
    return;
  }
  output.set(prefix, value);
}

function settingChanges(before: unknown, after: unknown, path: string, zh: boolean, output: HistoryDetail[]) {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const push = (old: unknown, next: unknown, label = settingLabel(path, zh)) =>
    output.push({ id: `${path}:${output.length}`, scope: scopeLabel("sync_settings", zh), label, before: old, after: next });
  const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (Array.isArray(before) && Array.isArray(after)) {
    if ([...before, ...after].every(value => object(value) && typeof value.id === "string")) {
      const old = new Map(before.map(value => [value.id, value]));
      const next = new Map(after.map(value => [value.id, value]));
      for (const id of new Set([...old.keys(), ...next.keys()])) {
        const a = old.get(id), b = next.get(id);
        if (!a || !b) push(a?.name, b?.name);
        else {
          const start = output.length;
          settingChanges(a, b, `${path}/${id}`, zh, output);
          for (const detail of output.slice(start)) detail.label = `${b.name ?? a.name} · ${detail.label}`;
        }
      }
      return;
    }
    // Primitive catalogs are sets; insertion/removal must not shift every row.
    push(before.filter(value => !after.includes(value)), after.filter(value => !before.includes(value)));
    return;
  }
  if (object(before) && object(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!INTERNAL_FIELDS.has(key)) settingChanges(before[key], after[key], `${path}/${key}`, zh, output);
    }
    return;
  }
  push(object(before) ? before.name : before, object(after) ? after.name : after);
}

function settingLabel(path: string, zh: boolean) {
  const key = path.split("/").at(-1)?.replaceAll("~1", "/").replaceAll("~0", "~") ?? path;
  const labels: Record<string, [string, string]> = {
    defaultCalendarID: ["默认日历", "Default calendar"], name: ["名称", "Name"], color: ["颜色", "Color"],
    icon: ["图标", "Icon"], categories: ["分类", "Categories"], billCategories: ["账目分类", "Bill categories"],
    currency: ["默认币种", "Currency"], paymentMethods: ["支付方式", "Payment methods"], direction: ["方向", "Direction"],
  };
  return labels[key]?.[zh ? 0 : 1] ?? fieldLabel(key, zh);
}

function displayValue(value: unknown, zh: boolean): string {
  if (value == null || value === "") return zh ? "空" : "empty";
  if (Array.isArray(value)) return value.map(item => displayValue(item, zh)).filter(text => text !== (zh ? "空" : "empty")).join(", ");
  if (typeof value === "boolean") return value ? (zh ? "是" : "yes") : zh ? "否" : "no";
  if (value === "zh") return "中文";
  if (value === "en") return "English";
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value);
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return zh ? "关联记录" : "linked record";
    if (/^attachments\//.test(text)) return text.replace(/^attachments\//, "");
    if (/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(text)) return new Date(text).toLocaleString(zh ? "zh-CN" : "en-US");
    return text;
  }
  return zh ? "已更改" : "changed";
}

function addChangeDetails(change: OperationHistoryChange, recordId: string, zh: boolean, output: HistoryDetail[]) {
  const scope = scopeLabel(change.table, zh);
  if (change.table === "sync_settings") {
    settingChanges(parseJson(change.before?.payload_json), parseJson(change.after?.payload_json), recordId, zh, output);
    return;
  }

  const keys = [...new Set([...Object.keys(change.before ?? {}), ...Object.keys(change.after ?? {})])];
  for (const key of keys) {
    if (INTERNAL_FIELDS.has(key)) continue;
    const before = change.before?.[key];
    const after = change.after?.[key];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    if (key === "tags" || key === "images") {
      output.push({ id: `${recordId}:${change.table}:${key}`, scope, label: fieldLabel(key, zh), before, after });
      continue;
    }
    const oldParts = new Map<string, unknown>();
    const newParts = new Map<string, unknown>();
    flattenDetailValue(parseJson(before), "", oldParts);
    flattenDetailValue(parseJson(after), "", newParts);
    if (oldParts.size > 1 || newParts.size > 1) {
      for (const path of [...new Set([...oldParts.keys(), ...newParts.keys()])]) {
        const old = oldParts.get(path);
        const next = newParts.get(path);
        if (JSON.stringify(old) === JSON.stringify(next)) continue;
        const leaf = path.split("/").at(-1) ?? key;
        output.push({ id: `${recordId}:${change.table}:${key}:${path}`, scope, label: fieldLabel(leaf, zh), before: old, after: next });
      }
    } else {
      output.push({ id: `${recordId}:${change.table}:${key}`, scope, label: fieldLabel(key, zh), before, after });
    }
  }
}

function historyChanges(record: OperationHistoryRecord, zh: boolean): HistoryDetail[] {
  if (record.action === "delete" || record.action === "create") return [];
  const details: HistoryDetail[] = [];
  for (const change of record.changes) {
    // Child-row maintenance is required for safe undo, not a separate user edit.
    if (["attachment_ingest_queue", "ai_messages"].includes(change.table)) continue;
    if (record.subject && ["entries", "items"].includes(change.table) && change.key[0] !== record.subject.value.id) continue;
    addChangeDetails(change, record.id, zh, details);
  }
  return details;
}

function recordTitle(record: OperationHistoryRecord, zh: boolean) {
  if (record.changes.some(change => change.table === "device_preferences")) return zh ? "本机设置" : "Device settings";
  if (record.changes.some(change => change.table === "sync_settings")) return zh ? "共享设置" : "Shared settings";
  return record.title || (zh ? "用户数据" : "User data");
}

function HistoryCard({ record, locale, details, busy, defaultOpen, onRestore, onPreview }: {
  record: OperationHistoryRecord;
  locale: Locale;
  details: HistoryDetail[];
  busy: boolean;
  defaultOpen?: boolean;
  onRestore: (id: string) => void;
  onPreview?: (record: OperationHistoryRecord) => void;
}) {
  const zh = locale === "zh";
  const [open, setOpen] = useState(Boolean(defaultOpen) || (details.length > 0 && details.length <= 2));
  const actions = zh
    ? { create: "新增", update: "修改", delete: "删除", restore: "恢复" }
    : { create: "Created", update: "Changed", delete: "Deleted", restore: "Restored" };
  const multipleScopes = new Set(details.map(detail => detail.scope)).size > 1;
  const row = record.changes.find(change => change.table === "entries" || change.table === "items");
  const data = row?.after ?? row?.before;
  const date = [data?.date ?? data?.acquired_on, data?.start_time ?? data?.acquired_at].filter(Boolean).join(" ");
  const note = data?.note ?? data?.notes;
  const toggleLabel = open ? (zh ? "收起细节" : "Hide details") : zh ? "展开细节" : "Show details";

  return (
    <li className="history-card">
      <header className="history-card-head">
        <strong><i className={`history-action is-${record.action}`}>{actions[record.action]}</i>
          {record.subject && onPreview ? <button type="button" className="history-title" onClick={() => onPreview(record)}>{recordTitle(record, zh)}</button> : recordTitle(record, zh)}
        </strong>
        <small>
          <time dateTime={record.createdAt} title={new Date(record.createdAt).toLocaleString(zh ? "zh-CN" : "en-US")}>{new Date(record.createdAt).toLocaleString(zh ? "zh-CN" : "en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</time>
        </small>
      </header>
      <div className="history-summary">
        <small>{date && <span>{date}</span>}{note ? <span className="history-note" title={String(note)}>{String(note)}</span> : null}</small>
        <div className="history-card-foot">
          {details.length > 0 && <button type="button" className="icon-button history-details-toggle" title={toggleLabel} aria-label={toggleLabel} aria-expanded={open} onClick={() => setOpen(current => !current)}><Icon name={open ? "chevron-up" : "chevron-down"} size={14} /></button>}
          {!record.changes.some(change => change.table === "device_preferences") && <button type="button" className="icon-button recovery-action" title={zh ? "撤销操作" : "Undo"} aria-label={zh ? "撤销操作" : "Undo"} disabled={busy} onClick={() => onRestore(record.id)}><Icon name="refresh" size={14} /></button>}
        </div>
      </div>
      {open && details.length > 0 && (
        <div className="history-details">
          {details.map(detail => (
            <div className="history-diff" key={detail.id}>
              <span className="history-field">{detail.label}{multipleScopes ? ` · ${detail.scope}` : ""}</span>
              <div className="history-values">
                <del>{displayValue(detail.before, zh)}</del>
                <i aria-hidden="true">→</i>
                <ins>{displayValue(detail.after, zh)}</ins>
              </div>
            </div>
          ))}
          {!details.length && <p>{zh ? "没有可显示的字段变化" : "No field changes to show"}</p>}
        </div>
      )}
    </li>
  );
}

export function OperationHistory({ locale, journal, onRestored, onPreview }: Props) {
  const zh = locale === "zh";
  const [records, setRecords] = useState<OperationHistoryRecord[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [limit, setLimit] = useState(100);
  const { confirm, dialog } = useConfirmDialog(locale);
  const load = useCallback(async () => {
    const rows: OperationHistoryRecord[] = [];
    for (let offset = 0; offset < limit; offset += 100) {
      const page = await journal.history(100, offset);
      rows.push(...page);
      if (page.length < 100) break;
    }
    setRecords(rows);
  }, [journal, limit]);
  useModalDismiss(event => { event.preventDefault(); setShowAll(false); }, showAll);

  useEffect(() => {
    let active = true;
    const refresh = () => { if (active) void load().catch(() => { if (active) setError(zh ? "无法读取操作历史" : "Could not load history"); }); };
    refresh();
    const unsubscribe = journal.subscribe(refresh);
    return () => { active = false; unsubscribe(); };
  }, [journal, zh, load]);

  const run = async (id?: string) => {
    const approved = await confirm({
      title: id ? (zh ? "恢复此次操作前的状态？" : "Restore the state before this change?") : (zh ? "清空操作历史？" : "Clear operation history?"),
      detail: id ? (zh ? "后续修改冲突时不会覆盖数据。恢复也会记录为新操作。" : "Later conflicting edits will not be overwritten. Restoration creates a new history record.") : (zh ? "不影响当前数据。清空后无法再撤销历史操作。" : "Current data is unaffected. Cleared changes can no longer be undone."),
      confirmLabel: id ? (zh ? "恢复" : "Restore") : (zh ? "清空历史" : "Clear history"),
      tone: id ? "normal" : "danger",
    });
    if (!approved) return;
    setBusy(true); setError("");
    try {
      if (id) { await journal.restoreHistory(id); await onRestored(); }
      else await journal.clearHistory();
      await load();
    } catch (reason) {
      const message = String(reason);
      setError(message.includes("HISTORY_CHANGED") ? (zh ? "数据已有后续修改，未覆盖。" : "This data changed later. Nothing was overwritten.")
        : message.includes("HISTORY_EXPIRED") ? (zh ? "该历史已过期。" : "This history has expired.")
        : (zh ? "操作失败，数据未恢复。" : "The operation failed. Nothing was restored."));
    } finally { setBusy(false); }
  };

  const card = (record: OperationHistoryRecord, defaultOpen = false) => (
    <HistoryCard key={record.id} record={record} locale={locale} details={historyChanges(record, zh)}
      busy={busy} defaultOpen={defaultOpen} onRestore={id => void run(id)} onPreview={onPreview} />
  );

  return <section className="settings-card recovery-card operation-history" aria-label={zh ? "操作历史" : "Operation history"}>
    <header className="recovery-heading">
      <div><h4>{zh ? "操作历史" : "History"}</h4><p className="settings-footnote">{zh ? "仅保留在本机 7 天，不同步；与快照独立。" : "On this device for 7 days. Not synced; independent of snapshots."}</p></div>
      {records.length > 0 && <button type="button" className="secondary-button" onClick={() => setShowAll(true)}>{zh ? "查看全部" : "View all"}</button>}
    </header>
    {error && <p role="alert">{error}</p>}
    {!records.length && <p className="settings-footnote">{zh ? "暂无操作记录" : "No operation history yet"}</p>}
    <ol className="recovery-list">{records.slice(0, PREVIEW_COUNT).map(record => card(record))}</ol>
    {showAll && createPortal(
      <div className="settings-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShowAll(false); }}>
        <section className="settings-modal" role="dialog" aria-modal="true" aria-label={zh ? "全部操作历史" : "All operation history"}>
          <header><h4>{zh ? "全部操作历史" : "All operation history"}</h4><div><button type="button" className="danger-button" disabled={busy || !records.length} onClick={() => void run()}>{zh ? "清空历史" : "Clear history"}</button><button type="button" className="secondary-button" onClick={() => setShowAll(false)}>{zh ? "关闭" : "Close"}</button></div></header>
          <ol className="recovery-list">{records.map(record => card(record))}{records.length >= limit && <li><button type="button" className="secondary-button" onClick={() => setLimit(value => value + 100)}>{zh ? "更早的操作" : "Load earlier"}</button></li>}</ol>
        </section>
      </div>, document.body
    )}
    {dialog}
  </section>;
}
