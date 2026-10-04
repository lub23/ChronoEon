import { useCallback, useEffect, useState } from "react";
import type { OperationHistoryRecord, SyncStore } from "@chronoeon/storage";
import type { Locale } from "../domain/entry";
import { useConfirmDialog } from "./ConfirmDialog";

interface Props {
  locale: Locale;
  journal: SyncStore;
  onRestored: () => Promise<void>;
}

export function OperationHistory({ locale, journal, onRestored }: Props) {
  const zh = locale === "zh";
  const [records, setRecords] = useState<OperationHistoryRecord[]>([]);
  const [offset, setOffset] = useState(0);
  const limit = 30;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { confirm, dialog } = useConfirmDialog(locale);
  const load = useCallback(async () => setRecords(await journal.history(limit, offset)), [journal, offset]);
  useEffect(() => {
    let active = true;
    const refresh = () => { void journal.history(limit, offset).then(rows => { if (active) setRecords(rows); }).catch(() => { if (active) setError(zh ? "无法读取操作历史" : "Could not load history"); }); };
    refresh();
    const unsubscribe = journal.subscribe(refresh);
    return () => { active = false; unsubscribe(); };
  }, [journal, offset, zh]);
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
      setError(message.includes("HISTORY_CHANGED") ? (zh ? "数据已有后续修改，未覆盖。请检查当前记录。" : "This data changed later. Nothing was overwritten; review the current record.")
        : message.includes("HISTORY_EXPIRED") ? (zh ? "该历史已过期，请刷新后重试。" : "This history has expired. Refresh and try again.")
        : (zh ? "操作失败，数据未恢复。请重试。" : "The operation failed. Please try again."));
    } finally { setBusy(false); }
  };
  const actions = zh ? { create: "新增", update: "修改", delete: "删除", restore: "恢复" } : { create: "Created", update: "Changed", delete: "Deleted", restore: "Restored" };
  const fieldLabels: Record<string, [string, string]> = {
    title: ["标题", "Title"], category: ["分类", "Category"], location: ["地点", "Location"], note: ["备注", "Note"],
    amount: ["金额", "Amount"], currency: ["币种", "Currency"], payment: ["支付方式", "Payment"], status: ["状态", "Status"],
    name: ["名称", "Name"], cost: ["成本", "Cost"], disposal: ["处置", "Disposal"], purchase_entry_id: ["购入账目", "Purchase bill"],
    sale_entry_id: ["出售账目", "Sale bill"],
  };
  const compactChanges = (record: OperationHistoryRecord) => record.changes.flatMap(change => {
    const keys = [...new Set([...Object.keys(change.before ?? {}), ...Object.keys(change.after ?? {})])];
    return keys.filter(key => JSON.stringify(change.before?.[key as keyof typeof change.before]) !== JSON.stringify(change.after?.[key as keyof typeof change.after]))
      .map(key => ({ key, label: fieldLabels[key]?.[zh ? 0 : 1] ?? key, before: change.before?.[key as keyof typeof change.before], after: change.after?.[key as keyof typeof change.after] }));
  });
  const compactValue = (value: unknown) => value == null ? (zh ? "空" : "empty") : typeof value === "string" ? value : JSON.stringify(value);
  return <section className="settings-card operation-history" aria-label={zh ? "操作历史" : "Operation history"}>
    <header className="operation-history-heading"><div><h4>{zh ? "操作历史" : "Operation history"}</h4><p className="settings-footnote">{zh ? "保留最近 7 天；独立于回收站和同步快照。" : "Last 7 days, independent of the recycle bin and sync snapshots."}</p></div>
      <button type="button" className="secondary-button" disabled={busy || !records.length} onClick={() => void run()}>{zh ? "清空历史" : "Clear history"}</button></header>
    {error && <p role="alert">{error}</p>}
    {!records.length && <p className="settings-footnote">{zh ? "暂无操作记录" : "No operation history yet"}</p>}
    <ol className="operation-history-list">{records.map(record => <li key={record.id}>
      <div className="operation-history-row"><div><small>{actions[record.action]} · <time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString(zh ? "zh-CN" : "en-US")}</time></small><strong>{record.title || (zh ? "用户数据" : "User data")}</strong></div>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void run(record.id)}>{zh ? "恢复" : "Restore"}</button></div>
      <details><summary>{zh ? "变动内容" : "What changed"} ({compactChanges(record).length})</summary>{compactChanges(record).map((change, index) => (
        <div className="operation-history-diff" key={index}><strong>{change.label}</strong><span><em>{compactValue(change.before)}</em> → <b>{compactValue(change.after)}</b></span></div>
      ))}</details>
    </li>)}</ol>
    {(offset > 0 || records.length === limit) && <nav aria-label={zh ? "历史分页" : "History pages"}>
      <button className="secondary-button" type="button" disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>{zh ? "上一页" : "Previous"}</button>
      <button className="secondary-button" type="button" disabled={busy || records.length < limit} onClick={() => setOffset(offset + limit)}>{zh ? "下一页" : "Next"}</button>
    </nav>}
    {dialog}
  </section>;
}
