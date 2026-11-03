import { useRef, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { OperationHistoryChange, OperationHistoryRecord, SyncStore } from "@chronoeon/storage";
import type { ChronoEonSettings, Locale } from "../domain/entry";
import { calendarDisplayName, categoryLabel, paymentMethodLabel, t, type MessageKey } from "../i18n";
import { reminderLabels } from "./entryFieldLabels";
import { useConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { useFocusTrap, useModalDismiss } from "./modalLayer";

interface Props {
  locale: Locale;
  journal: SyncStore;
  /** Resolves catalog ids (categories, payment methods, calendars) to their names. */
  settings?: ChronoEonSettings;
  onRestored: () => Promise<void>;
  onPreview?: (record: OperationHistoryRecord) => void;
}

const PREVIEW_COUNT = 5;
const INTERNAL_FIELDS = new Set(["id", "$exists", "updated_at", "created_at", "rowid", "builtin", "builtinKey", "builtinSubKeys", "color", "title_zh", "entry_id", "conversation_id", "sha256"]);

interface HistoryDetail {
  id: string;
  scope: string;
  field: string;
  label: string;
  before: unknown;
  after: unknown;
  /** How many rows of a batch carried this exact change. */
  count?: number;
}

function fieldLabel(key: string, zh: boolean) {
  const labels: Record<string, [string, string]> = {
    title: ["标题", "Title"], name: ["名称", "Name"], category: ["分类", "Category"], location: ["地点", "Location"],
    note: ["备注", "Note"], amount: ["金额", "Amount"], currency: ["币种", "Currency"], payment: ["支付方式", "Payment"],
    status: ["状态", "Status"], cost: ["成本", "Cost"], disposal: ["处置", "Disposal"], time: ["时间", "Time"],
    date: ["日期", "Date"], all_day: ["全天", "All day"], recurrence: ["重复", "Repeat"], recurring_end: ["重复截止", "Repeat until"],
    reminder: ["提醒", "Reminder"], start: ["开始", "Start"], end: ["结束", "End"], calendar: ["日历", "Calendar"],
    calendarId: ["日历", "Calendar"], acquired_on: ["获得日期", "Acquired on"], acquired_at: ["获得时间", "Acquired time"],
    sale_amount: ["出售所得", "Sale proceeds"], disposed_on: ["处置日期", "Disposed on"], disposed_at: ["处置时间", "Disposed at"], tags_json: ["标签", "Tags"], payload_json: ["设置", "Setting"],
    priority: ["重要性", "Priority"], urgency: ["紧急性", "Urgency"], tags: ["标签", "Tags"], images: ["照片", "Photos"],
    purchase_entry_id: ["购入账目", "Purchase bill"], sale_entry_id: ["出售账目", "Sale bill"],
    base_url: ["接口地址", "Endpoint"], model: ["模型", "Model"], provider_kind: ["服务", "Provider"], backend: ["类型", "Type"],
    enabled: ["启用", "Enabled"], default_calendar_id: ["默认日历", "Default calendar"], time_scale: ["时间粒度", "Time scale"],
    first_day: ["每周首日", "First day"], theme: ["主题", "Theme"], language: ["语言", "Language"],
    start_time: ["开始时间", "Start"], end_time: ["结束时间", "End"], end_date: ["结束日期", "End date"],
    notes: ["备注", "Notes"], acquisition: ["获得方式", "Acquisition"], modality: ["类型", "Type"], kind: ["类型", "Type"],
    images_json: ["照片", "Photos"], recurring_days: ["重复日", "Repeat days"], done_at: ["完成时间", "Done at"], cancelled_at: ["取消时间", "Cancelled at"],
    recurrence_exceptions: ["单次状态", "Occurrence status"], recurrence_moves: ["单次改期", "Occurrence moves"],
    calendars: ["日历", "Calendars"], itemCategories: ["物品分类", "Asset categories"],
    defaultCategoryId: ["默认分类", "Default category"], defaultBillCategoryId: ["默认账目分类", "Default bill category"],
    defaultBillSubCategoryId: ["默认子分类", "Default subcategory"], defaultItemCategoryId: ["默认物品分类", "Default asset category"],
    defaultPaymentMethodId: ["默认支付方式", "Default payment"], budgetMonthly: ["月预算", "Monthly budget"], balance: ["余额", "Balance"],
    caption: ["图注", "Caption"], sort: ["顺序", "Order"], tag: ["标签", "Tag"], position: ["顺序", "Order"], archived_at: ["归档", "Archived"],
    content: ["内容", "Content"], role: ["角色", "Role"], mode: ["模式", "Mode"],
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
  const field = path.split("/").at(-1)?.replaceAll("~1", "/").replaceAll("~0", "~") ?? path;
  const push = (old: unknown, next: unknown, label = settingLabel(path, zh)) =>
    output.push({ id: `${path}:${output.length}`, scope: scopeLabel("sync_settings", zh), field, label, before: old, after: next });
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
    amount: ["余额", "Balance"], at: ["更新时间", "Updated at"],
  };
  return labels[key]?.[zh ? 0 : 1] ?? fieldLabel(key, zh);
}

const STATUS_KEYS: Record<string, MessageKey> = { open: "statusOpen", "in-progress": "statusInProgress", done: "statusDone", cancelled: "statusCancelled" };
const KIND_KEYS: Record<string, MessageKey> = { task: "task", event: "event", bill: "bill", idea: "idea" };
const RECURRENCE_KEYS: Record<string, MessageKey> = { daily: "recurrenceDaily", weekly: "recurrenceWeekly", monthly: "recurrenceMonthly", yearly: "recurrenceYearly" };
const ACQUISITION_KEYS: Record<string, MessageKey> = { purchase: "itemPurchase", gift: "itemGift", windfall: "itemWindfall" };
const DISPOSAL_KEYS: Record<string, MessageKey> = { sold: "itemSold", lost: "itemLost", discarded: "itemDiscarded" };

/** Values are stored as ids and enums; the card speaks in the catalog's names. */
function displayValue(field: string, value: unknown, locale: Locale, settings?: ChronoEonSettings): string {
  const zh = locale === "zh";
  const empty = zh ? "空" : "empty";
  if (value == null || value === "") return empty;
  if (Array.isArray(value)) return value.map(item => displayValue(field, item, locale, settings)).filter(text => text !== empty).join(", ") || empty;
  if (typeof value === "boolean") return value ? (zh ? "是" : "yes") : zh ? "否" : "no";
  if (typeof value === "number" && (field === "all_day" || field === "enabled")) return value ? (zh ? "是" : "yes") : zh ? "否" : "no";
  if (typeof value !== "string" && typeof value !== "number") return zh ? "已更改" : "changed";
  const text = String(value);
  switch (field) {
    case "category": return categoryLabel(text, locale, undefined, settings);
    case "payment": case "defaultPaymentMethodId": {
      const method = settings?.calendars.flatMap(calendar => calendar.paymentMethods).find(candidate => candidate.id === text);
      return method?.name ?? paymentMethodLabel(text, locale);
    }
    case "status": return STATUS_KEYS[text] ? t(STATUS_KEYS[text], locale) : text;
    case "modality": case "kind": return KIND_KEYS[text] ? t(KIND_KEYS[text], locale) : text;
    case "priority": case "urgency": return text === "high" ? t("priorityHigh", locale) : text === "low" ? t("priorityLow", locale) : t("priorityNormal", locale);
    case "recurrence": return text === "none" ? (zh ? "不重复" : "None") : RECURRENCE_KEYS[text] ? t(RECURRENCE_KEYS[text], locale) : text;
    case "reminder": return text === "none" ? (zh ? "不提醒" : "None") : (reminderLabels as Record<string, MessageKey>)[text] ? t((reminderLabels as Record<string, MessageKey>)[text], locale) : text;
    case "calendar": case "calendarId": case "defaultCalendarID": {
      const calendar = settings?.calendars.find(candidate => candidate.id === text);
      return calendar ? calendarDisplayName(calendar.name, locale) : calendarDisplayName(text, locale);
    }
    case "acquisition": return ACQUISITION_KEYS[text] ? t(ACQUISITION_KEYS[text], locale) : text;
    case "disposal": return DISPOSAL_KEYS[text] ? t(DISPOSAL_KEYS[text], locale) : text;
    case "language": return text === "zh" ? "中文" : text === "en" ? "English" : text;
    case "recurring_days": return text;
    default: break;
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return zh ? "关联记录" : "linked record";
  if (/^attachments\//.test(text)) return text.replace(/^attachments\//, "").slice(0, 12);
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(text)) return new Date(text).toLocaleString(zh ? "zh-CN" : "en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  if (field === "images_json" || field === "recurrence_exceptions" || field === "recurrence_moves") return zh ? "已更改" : "changed";
  return text;
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
    if (key === "tags" || key === "images" || key === "images_json" || key === "recurring_days") {
      output.push({ id: `${recordId}:${change.table}:${key}`, scope, field: key, label: fieldLabel(key, zh), before, after });
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
        output.push({ id: `${recordId}:${change.table}:${key}:${path}`, scope, field: leaf, label: fieldLabel(leaf, zh), before: old, after: next });
      }
    } else {
      output.push({ id: `${recordId}:${change.table}:${key}`, scope, field: key, label: fieldLabel(key, zh), before, after });
    }
  }
}

interface HistorySummary { details: HistoryDetail[]; rows: number; titles: string[] }

/** One card per operation. A batch edit lists each distinct field change once,
 *  with how many records it touched, instead of only the first record. */
function summarizeRecord(record: OperationHistoryRecord, zh: boolean): HistorySummary {
  const subjects = record.changes.filter(change => change.table === "entries" || change.table === "items");
  const titles = [...new Set(subjects.map(change => String((change.after ?? change.before)?.title ?? (change.after ?? change.before)?.name ?? "")).filter(Boolean))];
  if (record.action === "delete" || record.action === "create") return { details: [], rows: subjects.length, titles };
  const edited = subjects.filter(change => change.before && change.after);
  if (edited.length > 1) {
    const groups = new Map<string, HistoryDetail>();
    for (const change of edited) {
      const details: HistoryDetail[] = [];
      addChangeDetails(change, record.id, zh, details);
      for (const detail of details) {
        const key = `${detail.scope}|${detail.label}|${JSON.stringify(detail.before)}|${JSON.stringify(detail.after)}`;
        const group = groups.get(key);
        if (group) group.count = (group.count ?? 1) + 1;
        else groups.set(key, { ...detail, id: key, count: 1 });
      }
    }
    return { details: [...groups.values()].sort((left, right) => (right.count ?? 0) - (left.count ?? 0)), rows: edited.length, titles };
  }
  const details: HistoryDetail[] = [];
  for (const change of record.changes) {
    // Child-row maintenance is required for safe undo, not a separate user edit.
    if (["attachment_ingest_queue", "ai_messages"].includes(change.table)) continue;
    if (record.subject && ["entries", "items"].includes(change.table) && change.key[0] !== record.subject.value.id) continue;
    addChangeDetails(change, record.id, zh, details);
  }
  return { details, rows: Math.max(1, edited.length), titles };
}

function recordTitle(record: OperationHistoryRecord, summary: HistorySummary, locale: Locale) {
  if (record.changes.some(change => change.table === "device_preferences")) return t("historyDeviceSettings", locale);
  if (record.changes.some(change => change.table === "sync_settings")) return t("historySharedSettings", locale);
  if (summary.rows > 1) return t("historyBatch", locale).replace("{count}", String(summary.rows));
  return record.title || t("historyUserData", locale);
}

function HistoryCard({ record, locale, settings, summary, busy, defaultOpen, onRestore, onPreview }: {
  record: OperationHistoryRecord;
  locale: Locale;
  settings?: ChronoEonSettings;
  summary: HistorySummary;
  busy: boolean;
  defaultOpen?: boolean;
  onRestore: (id: string) => void;
  onPreview?: (record: OperationHistoryRecord) => void;
}) {
  const zh = locale === "zh";
  const { details } = summary;
  const [open, setOpen] = useState(Boolean(defaultOpen) || (details.length > 0 && details.length <= 3));
  const actions = {
    create: t("historyActionCreate", locale), update: t("historyActionUpdate", locale),
    delete: t("historyActionDelete", locale), restore: t("historyActionRestore", locale),
  } as const;
  const multipleScopes = new Set(details.map(detail => detail.scope)).size > 1;
  const row = record.changes.find(change => change.table === "entries" || change.table === "items");
  const data = row?.after ?? row?.before;
  const batch = summary.rows > 1;
  const date = batch ? "" : [data?.date ?? data?.acquired_on, data?.start_time ?? data?.acquired_at].filter(Boolean).join(" ");
  const note = batch ? "" : data?.note ?? data?.notes;
  const kind = typeof data?.modality === "string" ? displayValue("modality", data.modality, locale, settings) : row?.table === "items" ? t("items", locale) : "";
  const toggleLabel = open ? t("historyHideDetails", locale) : t("historyShowDetails", locale);
  const batchTitles = batch ? `${summary.titles.slice(0, 3).join(zh ? "、" : ", ")}${summary.titles.length > 3 ? ` ${t("historyMore", locale).replace("{count}", String(summary.titles.length - 3))}` : ""}` : "";
  const canUndo = !record.changes.some(change => change.table === "device_preferences");

  return (
    <li className={`history-card is-${record.action}${batch ? " is-batch" : ""}`}>
      <header className="history-card-head">
        <strong>
          <i className={`history-action is-${record.action}`}>{actions[record.action]}</i>
          {kind && !batch && <em className="history-kind">{kind}</em>}
          {record.subject && onPreview && !batch
            ? <button type="button" className="history-title" onClick={() => onPreview(record)} title={t("historyShowDetails", locale)}>{recordTitle(record, summary, locale)}</button>
            : <span className="history-title-text">{recordTitle(record, summary, locale)}</span>}
        </strong>
        <small>
          <time dateTime={record.createdAt} title={new Date(record.createdAt).toLocaleString(zh ? "zh-CN" : "en-US")}>{new Date(record.createdAt).toLocaleString(zh ? "zh-CN" : "en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</time>
        </small>
      </header>
      <div className="history-summary">
        <small>
          {date && <span>{date}</span>}
          {note ? <span className="history-note" title={String(note)}>{String(note)}</span> : null}
          {batchTitles && <span className="history-note" title={summary.titles.join("\n")}>{batchTitles}</span>}
        </small>
        <div className="history-card-foot">
          {details.length > 0 && <button type="button" className="icon-button history-details-toggle" title={toggleLabel} aria-label={toggleLabel} aria-expanded={open} onClick={() => setOpen(current => !current)}><Icon name={open ? "chevron-up" : "chevron-down"} size={14} /></button>}
          {canUndo && <button type="button" className="icon-button recovery-action" title={t("historyUndo", locale)} aria-label={t("historyUndo", locale)} disabled={busy} onClick={() => onRestore(record.id)}><Icon name="refresh" size={14} /></button>}
        </div>
      </div>
      {open && details.length > 0 && (
        <div className="history-details">
          {details.map(detail => (
            <div className="history-diff" key={detail.id}>
              <span className="history-field">{detail.label}{multipleScopes ? ` · ${detail.scope}` : ""}</span>
              <div className="history-values">
                <del>{displayValue(detail.field, detail.before, locale, settings)}</del>
                <i aria-hidden="true">→</i>
                <ins>{displayValue(detail.field, detail.after, locale, settings)}</ins>
                {batch && (detail.count ?? 1) > 0 && <b className="history-count" title={t("historyBatch", locale).replace("{count}", String(detail.count))}>×{detail.count}</b>}
              </div>
            </div>
          ))}
          {!details.length && <p>{t("historyNoChanges", locale)}</p>}
        </div>
      )}
    </li>
  );
}

export function OperationHistory({ locale, journal, settings, onRestored, onPreview }: Props) {
  const [records, setRecords] = useState<OperationHistoryRecord[]>([]);
  const [showAll, setShowAll] = useState(false);
  const allRef = useRef<HTMLElement>(null);
  useFocusTrap(allRef, showAll);
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
    const refresh = () => { if (active) void load().catch(() => { if (active) setError(t("historyLoadFailed", locale)); }); };
    refresh();
    const unsubscribe = journal.subscribe(refresh);
    return () => { active = false; unsubscribe(); };
  }, [journal, locale, load]);

  const run = async (id?: string) => {
    const approved = await confirm({
      title: id ? t("historyRestoreTitle", locale) : t("historyClearTitle", locale),
      detail: id ? t("historyRestoreDetail", locale) : t("historyClearDetail", locale),
      confirmLabel: id ? t("historyRestore", locale) : t("historyClear", locale),
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
      setError(message.includes("HISTORY_CHANGED") ? t("historyChanged", locale)
        : message.includes("HISTORY_EXPIRED") ? t("historyExpired", locale)
        : t("historyFailed", locale));
    } finally { setBusy(false); }
  };

  const card = (record: OperationHistoryRecord, defaultOpen = false) => (
    <HistoryCard key={record.id} record={record} locale={locale} settings={settings} summary={summarizeRecord(record, locale === "zh")}
      busy={busy} defaultOpen={defaultOpen} onRestore={id => void run(id)} onPreview={onPreview} />
  );

  return <section className="settings-card recovery-card operation-history" aria-label={t("historyTitle", locale)}>
    <header className="recovery-heading">
      <div><h4>{t("historyTitle", locale)}</h4><p className="settings-footnote">{t("historyDetail", locale)}</p></div>
      {records.length > 0 && <button type="button" className="secondary-button" onClick={() => setShowAll(true)}>{t("historyViewAll", locale)}</button>}
    </header>
    {error && <p role="alert">{error}</p>}
    {!records.length && <p className="settings-footnote">{t("historyEmpty", locale)}</p>}
    <ol className="recovery-list">{records.slice(0, PREVIEW_COUNT).map(record => card(record))}</ol>
    {showAll && createPortal(
      <div className="settings-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShowAll(false); }}>
        <section ref={allRef} className="settings-modal" role="dialog" aria-modal="true" aria-label={t("historyAllTitle", locale)}>
          <header><h4>{t("historyAllTitle", locale)}</h4><div><button type="button" className="danger-button" disabled={busy || !records.length} onClick={() => void run()}>{t("historyClear", locale)}</button><button type="button" className="secondary-button" onClick={() => setShowAll(false)}>{t("historyClose", locale)}</button></div></header>
          <ol className="recovery-list">{records.map(record => card(record))}{records.length >= limit && <li><button type="button" className="secondary-button" onClick={() => setLimit(value => value + 100)}>{t("historyEarlier", locale)}</button></li>}</ol>
        </section>
      </div>, document.body
    )}
    {dialog}
  </section>;
}
