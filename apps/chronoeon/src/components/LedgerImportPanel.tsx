import { useEffect, useRef, useState } from "react";
import { createDefaultSettings, prepareLedgerReplacement, type LedgerImportPayload, type Locale } from "@chronoeon/domain";
import { LedgerReplacementError, type useSyncService } from "../sync/useSyncService";
import { t } from "../i18n";
import { useConfirmDialog } from "./ConfirmDialog";
import { MotionPresence, createMotionPortal as createPortal } from "./MotionPresence";
import { registerModalDismiss } from "./modalLayer";
import { Icon } from "./Icon";

export function LedgerImportPanel({ locale, service }: { locale: Locale; service: ReturnType<typeof useSyncService> }) {
  const [payload, setPayload] = useState<LedgerImportPayload | null>(null);
  const [notice, setNotice] = useState("");
  const [backup, setBackup] = useState("");
  const [busy, setBusy] = useState(false);
  const [committed, setCommitted] = useState(false);
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const { confirm, dialog } = useConfirmDialog(locale);
  useEffect(() => {
    if (!busy) return;
    const previous = document.activeElement as HTMLElement | null;
    progressRef.current?.focus();
    const dismiss = registerModalDismiss(() => {});
    return () => { dismiss(); previous?.focus({ preventScroll: true }); };
  }, [busy]);
  const amount = (cents: number) => `${payload?.currency ?? ""} ${(cents / 100).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  async function choose(file: File | undefined) {
    if (!file || busyRef.current) return;
    setPayload(null); setNotice(""); setBackup(""); setCommitted(false);
    try {
      if (file.size > 20_000_000) throw new Error("LEDGER_TOO_LARGE");
      const candidate = JSON.parse(await file.text()) as LedgerImportPayload;
      prepareLedgerReplacement(createDefaultSettings(locale), candidate, new Date().toISOString());
      setPayload(candidate);
    } catch { setNotice(t("ledgerInvalid", locale)); }
  }
  async function replace() {
    if (!payload || busyRef.current || service.busy || committed) return;
    busyRef.current = true;
    try {
      const accepted = await confirm({ title: t("ledgerConfirm", locale), detail: t("ledgerConfirmDetail", locale), confirmLabel: t("ledgerReplace", locale), tone: "danger" });
      if (!accepted) return;
      setBusy(true); setNotice("");
      const result = await service.replaceLedger(payload);
      setBackup(result.backupPath); setCommitted(true); setNotice(t("ledgerComplete", locale));
    } catch (error) {
      const replaced = error instanceof LedgerReplacementError && error.ledgerReplaced;
      setCommitted(replaced);
      if (error instanceof LedgerReplacementError && error.backupPath) setBackup(error.backupPath);
      setNotice(t(replaced ? "ledgerFailedAfter" : "ledgerFailedBefore", locale));
    } finally { busyRef.current = false; setBusy(false); }
  }
  return <section className="settings-card ledger-import" aria-label={t("ledgerImport", locale)}>
    <h4>{t("ledgerImport", locale)}</h4>
    <p className="settings-footnote">{t("ledgerImportHelp", locale)}</p>
    <input ref={inputRef} type="file" accept=".json,application/json" hidden aria-label={t("ledgerChoose", locale)} onChange={event => { void choose(event.target.files?.[0]); event.target.value = ""; }} />
    <button type="button" className="secondary-button" disabled={!service.available || service.busy || busy} onClick={() => inputRef.current?.click()}><Icon name="upload" size={14} />{t("ledgerChoose", locale)}</button>
    {payload && <>
      <dl className="sync-usage">
        <div><dt>{t("ledgerBillCount", locale)}</dt><dd>{payload.summary.count}</dd></div>
        <div><dt>{t("ledgerCategoryCount", locale)}</dt><dd>{payload.categories.length} / {payload.categories.reduce((sum, category) => sum + category.sub.length, 0)}</dd></div>
        <div><dt>{t("statsIncome", locale)}</dt><dd>{amount(payload.summary.incomeCents)}</dd></div>
        <div><dt>{t("statsExpense", locale)}</dt><dd>{amount(payload.summary.expenseCents)}</dd></div>
        <div><dt>{t("statsNet", locale)}</dt><dd>{amount(payload.summary.netCents)}</dd></div>
      </dl>
      <p className="settings-footnote">{payload.summary.firstDate} – {payload.summary.lastDate}</p>
      <button type="button" className="danger-button" disabled={!service.available || service.busy || busy || committed} onClick={() => void replace()}>{t("ledgerReplace", locale)}</button>
    </>}
    {notice && <p role="status" className="settings-footnote">{notice}</p>}
    {backup && <p className="settings-footnote ledger-backup-path">{t("ledgerBackup", locale)}: <code>{backup}</code></p>}
    <MotionPresence>{dialog && createPortal(dialog, document.body)}</MotionPresence>
    {busy && createPortal(<div className="ledger-maintenance-backdrop"><div ref={progressRef} className="ledger-maintenance panel" role="alertdialog" aria-modal="true" aria-busy="true" tabIndex={-1} aria-label={t("ledgerImport", locale)} onKeyDown={event => { if (event.key === "Tab" || event.key === "Escape") { event.preventDefault(); event.stopPropagation(); } }}><Icon name="refresh" size={24} /><p>{t("ledgerWorking", locale)}</p></div></div>, document.body)}
  </section>;
}
