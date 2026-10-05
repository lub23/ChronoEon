import { useCallback, useEffect, useState } from "react";
import type { OperationHistoryRecord, SyncStore } from "@chronoeon/storage";
import type { Locale } from "../domain/entry";
import { useConfirmDialog } from "./ConfirmDialog";

interface Props {
  locale: Locale;
  journal: SyncStore;
  onRestored: () => Promise<void>;
}

const PREVIEW_COUNT = 5;

function fieldLabel(key: string, zh: boolean) {
  const labels: Record<string, [string, string]> = {
    title: ["标题", "Title"], name: ["名称", "Name"], category: ["分类", "Category"], location: ["地点", "Location"],
    note: ["备注", "Note"], amount: ["金额", "Amount"], currency: ["币种", "Currency"], payment: ["支付方式", "Payment"],
    status: ["状态", "Status"], cost: ["成本", "Cost"], disposal: ["处置", "Disposal"], time: ["时间", "Time"],
    date: ["日期", "Date"], all_day: ["全天", "All day"], recurrence: ["重复", "Repeat"], recurring_end: ["重复截止", "Repeat until"],
    priority: ["重要性", "Priority"], urgency: ["紧急性", "Urgency"], tags: ["标签", "Tags"], images: ["照片", "Photos"],
    purchase_entry_id: ["购入账目", "Purchase bill"], sale_entry_id: ["出售账目", "Sale bill"],
    base_url: ["接口地址", "Endpoint"], model: ["模型", "Model"], provider_kind: ["服务", "Provider"], backend: ["类型", "Type"],
    enabled: ["启用", "Enabled"], default_calendar_id: ["默认日历", "Default calendar"], time_scale: ["时间粒度", "Time scale"],
    first_day: ["每周首日", "First day"], theme: ["主题", "Theme"], language: ["语言", "Language"],
  };
  return labels[key]?.[zh ? 0 : 1] ?? key.replace(/_/g, " ");
}

function displayValue(value: unknown, zh: boolean): string {
  if (value == null || value === "") return zh ? "空" : "empty";
  if (Array.isArray(value)) return value.map(item => displayValue(item, zh)).filter(Boolean).join(", ");
  if (typeof value === "boolean") return value ? (zh ? "是" : "yes") : zh ? "否" : "no";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return zh ? "已更改" : "changed";
}

export function OperationHistory({ locale, journal, onRestored }: Props) {
  const zh = locale === "zh";
  const [records, setRecords] = useState<OperationHistoryRecord[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { confirm, dialog } = useConfirmDialog(locale);
  const limit = 100;
  const load = useCallback(async () => setRecords(await journal.history(limit)), [journal]);
  useEffect(() => {
    let active = true;
    const refresh = () => { void journal.history(limit).then(rows => { if (active) setRecords(rows); }).catch(() => { if (active) setError(zh ? "无法读取操作历史" : "Could not load history"); }); };
    refresh();
    const unsubscribe = journal.subscribe(refresh);
    return () => { active = false; unsubscribe(); };
  }, [journal, zh]);
  const run = async (id?: string) => {
    const approved = await confirm({
      title: id ? (zh ? "恢复此次操作前的状态？" : "Restore the state before this change?") : (zh ? "清空操作历史？" : "Clear operation history?"),
      detail: id ? (zh ? "后续修改冲突时不会覆盖数据。恢复也会记录为新操作。" : "Later conflicting edits will not be overwritten. Restoration creates a new history record.") : (zh ? "仅清空历史，不删除当前数据或回收站内容。此操作不可撤销。" : "Current data and the recycle bin are not affected. This cannot be undone."),
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
  const actions = zh ? { create: "新增", update: "修改", delete: "删除", restore: "恢复" } : { create: "Created", update: "Changed", delete: "Deleted", restore: "Restored" };
  const changesFor = (record: OperationHistoryRecord) => {
    if (record.action !== "update" && record.action !== "restore") return [];
    return record.changes.flatMap(change => {
      const keys = [...new Set([...Object.keys(change.before ?? {}), ...Object.keys(change.after ?? {})])];
      return keys.filter(key => key !== "updated_at" && JSON.stringify(change.before?.[key]) !== JSON.stringify(change.after?.[key]))
        .map(key => ({ key, label: fieldLabel(key, zh), before: change.before?.[key], after: change.after?.[key] }));
    });
  };
  const row = (record: OperationHistoryRecord) => {
    const changes = changesFor(record);
    return (
      <li key={record.id}>
        <div className="recovery-copy">
          <strong><i className={`history-action is-${record.action}`}>{actions[record.action]}</i>{record.title || (zh ? "用户数据" : "User data")}</strong>
          <small><time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString(zh ? "zh-CN" : "en-US")}</time></small>
        </div>
        <div className="recovery-changes">
          {changes.length ? changes.map(change => (
            <span key={`${record.id}-${change.key}`}><em>{change.label}</em>{displayValue(change.before, zh)} → {displayValue(change.after, zh)}</span>
          )) : <span>{record.action === "create" ? (zh ? "创建记录" : "Record created") : record.action === "delete" ? (zh ? "移入回收站" : "Moved to recycle bin") : (zh ? "恢复先前状态" : "Prior state restored")}</span>}
        </div>
        <button type="button" className="secondary-button recovery-action" disabled={busy} onClick={() => void run(record.id)}>{zh ? "恢复" : "Restore"}</button>
      </li>
    );
  };
  return <section className="settings-card recovery-card operation-history" aria-label={zh ? "操作历史" : "Operation history"}>
    <header className="recovery-heading">
      <div><h4>{zh ? "操作历史" : "Operation history"}</h4><p className="settings-footnote">{zh ? "保留最近 7 天，仅展示改动字段。" : "Last 7 days; only changed fields are shown."}</p></div>
      {records.length > PREVIEW_COUNT && <button type="button" className="secondary-button" onClick={() => setShowAll(true)}>{zh ? `全部 ${records.length} 项` : `All ${records.length}`}</button>}
    </header>
    {error && <p role="alert">{error}</p>}
    {!records.length && <p className="settings-footnote">{zh ? "暂无操作记录" : "No operation history yet"}</p>}
    <ol className="recovery-list">{records.slice(0, PREVIEW_COUNT).map(row)}</ol>
    {showAll && (
      <div className="settings-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShowAll(false); }}>
        <section className="settings-modal" role="dialog" aria-modal="true" aria-label={zh ? "全部操作历史" : "All operation history"}>
          <header><h4>{zh ? "全部操作历史" : "All operation history"}</h4><div><button type="button" className="danger-button" disabled={busy || !records.length} onClick={() => void run()}>{zh ? "清空历史" : "Clear history"}</button><button type="button" className="secondary-button" onClick={() => setShowAll(false)}>{zh ? "关闭" : "Close"}</button></div></header>
          <ol className="recovery-list">{records.map(row)}</ol>
        </section>
      </div>
    )}
    {dialog}
  </section>;
}
