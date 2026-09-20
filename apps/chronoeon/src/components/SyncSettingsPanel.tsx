import { useEffect, useRef, useState } from "react";
import { MotionPresence, createMotionPortal as createPortal } from "./MotionPresence";
import { useConfirmDialog } from "./ConfirmDialog";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import type { Entry, Locale } from "../domain/entry";
import type { SyncConflict } from "@chronoeon/storage";
import type { useSyncService } from "../sync/useSyncService";
import { formatBytes, syncConfigured, type SyncConfig, type SyncMode } from "../sync/types";
import { localeTag, t, type MessageKey } from "../i18n";
import { Icon } from "./Icon";

interface Props { locale: Locale; config: SyncConfig; onChange: (config: SyncConfig) => void; service: ReturnType<typeof useSyncService>; entries: Entry[] }
const errors: Record<string, MessageKey> = {
  SYNC_OFFLINE: "syncOffline",
  SYNC_USE_EMPTY_REMOTE: "syncUseEmptyRemote", SYNC_DIFFERENT_DATASET: "syncDifferentDataset",
  SYNC_WEBDAV_CAS_REQUIRED: "syncWebdavCasRequired", SYNC_HTTPS_REQUIRED: "syncHttpsRequired",
  SYNC_ATTACHMENT_MISSING: "syncAttachmentMissing", SYNC_CHECKSUM_FAILED: "syncChecksumFailed",
  SYNC_REMOTE_BUSY: "syncRemoteBusy", SYNC_ENTITY_TOO_LARGE: "syncEntityTooLarge",
  SYNC_FORBIDDEN: "syncForbidden", SYNC_UNAUTHORIZED: "syncUnauthorized",
};
function fieldLabel(conflict: SyncConflict, locale: Locale): string {
  const labels: Record<string, MessageKey> = { $exists: "syncExistence", title: "title", note: "note", status: "syncTodoStatus", content: "syncMessageContent" };
  return labels[conflict.field] ? t(labels[conflict.field], locale) : `${t("syncField", locale)}: ${conflict.field}`;
}
export function SyncSettingsPanel({ locale, config, onChange, service, entries }: Props) {
  const [notice, setNotice] = useState("");
  const { confirm, dialog } = useConfirmDialog(locale);
  const [rebuilding, setRebuilding] = useState(false);
  const rebuildPending = useRef(false);
  const [resolving, setResolving] = useState("");
  const [missingBusy, setMissingBusy] = useState("");
  const set = (patch: Partial<SyncConfig>) => { onChange({ ...config, ...patch }); setNotice(""); };
  const pasteToken = async () => {
    try { const token = (await readText()).trim(); if (token) set({ gitToken: token }); else setNotice(t("syncPasteEmpty", locale)); }
    catch { setNotice(t("syncPasteFailed", locale)); }
  };
  async function rebuildSnapshot() {
    if (rebuildPending.current || service.busy || !service.available || !syncConfigured(config)) return;
    rebuildPending.current = true;
    setRebuilding(true);
    setNotice("");
    try {
      const accepted = await confirm({ title: t("syncRebuildConfirm", locale), detail: t("syncRebuildConfirmDetail", locale), confirmLabel: t("syncRebuildSnapshot", locale), tone: "danger" });
      if (!accepted) return;
      const result = await service.rebuildSnapshot();
      setNotice(t(result?.ok && result.snapshotCreated ? "syncRebuildDone" : "syncRebuildFailed", locale));
    } catch { setNotice(t("syncRebuildFailed", locale)); }
    finally { rebuildPending.current = false; setRebuilding(false); }
  }
  // Storage figures are measured when the panel opens and after each sync run.
  const { refreshUsage, available } = service;
  useEffect(() => { if (available) void refreshUsage(); }, [available, refreshUsage, service.status?.lastSuccess]);
  const nextSnapshot = service.status?.nextSnapshotAt;
  const snapshotDue = nextSnapshot && Date.parse(nextSnapshot) <= Date.now();
  const error = service.result && !service.result.ok ? service.result : null;
  return <>
    <header className="settings-section-heading"><h3>{t("settingsSync", locale)}</h3><p>{t("syncDetail", locale)}</p></header>
    <div className="settings-card ai-settings-card">
      <div className="settings-option">
        <span className="settings-option-copy"><strong>{t("syncMode", locale)}</strong></span>
        <div className="settings-segmented" role="group" aria-label={t("syncMode", locale)}>
          {(["git", "webdav"] as SyncMode[]).map((mode) => <button type="button" key={mode} aria-pressed={config.mode === mode}
            className={config.mode === mode ? "is-active" : ""} onClick={() => set({ mode })}>{t(mode === "git" ? "syncGit" : "syncWebdav", locale)}</button>)}
        </div>
      </div>
      {config.mode === "git" ? <>
        <label className="settings-field ai-settings-field"><span><strong>{t("gitRemote", locale)}</strong><small>{t("gitRemoteHint", locale)}</small></span>
          <input value={config.gitRemote} placeholder="https://gitee.com/…/chronoeon-sync.git" spellCheck={false} inputMode="url" onChange={(event) => set({ gitRemote: event.target.value })} /></label>
        <label className="settings-field ai-settings-field"><span><span className="settings-label-row"><strong>{t("gitToken", locale)}</strong>
          <button type="button" className="icon-button subtle paste-token-button" aria-label={t("syncPasteToken", locale)} onClick={() => void pasteToken()}><Icon name="clipboard" size={13} /></button></span><small>{t("gitTokenHint", locale)}</small></span>
          <input type="password" value={config.gitToken} autoComplete="off" spellCheck={false} onChange={(event) => set({ gitToken: event.target.value })} /></label>
      </> : <>
        <label className="settings-field ai-settings-field"><span><strong>{t("webdavUrl", locale)}</strong><small>{t("webdavUrlHint", locale)}</small></span>
          <input value={config.webdavUrl} placeholder="https://cloud.example.com/dav/ChronoEon/" inputMode="url" spellCheck={false} onChange={(event) => set({ webdavUrl: event.target.value })} /></label>
        <label className="settings-field ai-settings-field"><span><strong>{t("webdavUser", locale)}</strong></span>
          <input value={config.webdavUsername} autoComplete="username" onChange={(event) => set({ webdavUsername: event.target.value })} /></label>
        <label className="settings-field ai-settings-field"><span><strong>{t("webdavPass", locale)}</strong></span>
          <input type="password" value={config.webdavPassword} autoComplete="current-password" onChange={(event) => set({ webdavPassword: event.target.value })} /></label>
      </>}
    </div>
    <div className="ai-settings-actions sync-actions">
      <button type="button" className="secondary-button" disabled={service.busy || rebuilding || !service.available || !syncConfigured(config)} onClick={() => void service.run()}>
        <Icon name="refresh" size={14} />{t(service.busy ? "syncWorking" : "syncNow", locale)}
      </button>
      <button type="button" className="secondary-button sync-rebuild-button" disabled={service.busy || rebuilding || !service.available || !syncConfigured(config)} onClick={() => void rebuildSnapshot()}>
        <Icon name="refresh" size={14} />{t("syncRebuildSnapshot", locale)}
      </button>
      {service.status && <span role="status">{t("syncPending", locale)}: {service.status.pending} · {t("syncConflicts", locale)}: {service.status.conflicts}</span>}
    </div>
    <div className="sync-snapshot-schedule">
      <p className="settings-footnote"><strong>{t("syncNextSnapshot", locale)}: </strong>{nextSnapshot
        ? <time dateTime={nextSnapshot}>{new Date(nextSnapshot).toLocaleString(localeTag[locale])}</time>
        : t("syncSnapshotFirst", locale)}</p>
      {snapshotDue && <p className="settings-footnote" role="status">{t("syncSnapshotDue", locale)}</p>}
      <p className="settings-footnote">{t("syncSnapshotRetention", locale)}</p>
    </div>
    <MotionPresence>{dialog && createPortal(dialog, document.body)}</MotionPresence>
    {service.status?.lastSuccess && <p className="settings-footnote">{t("syncLastSuccess", locale)}: {new Date(service.status.lastSuccess).toLocaleString(localeTag[locale])}</p>}
    {service.usage && <dl className="sync-usage" aria-label={t("syncStorageUsage", locale)}>
      <div><dt>{t(config.mode === "git" ? "syncStorageRepository" : "syncStorageRepositoryWebdav", locale)}</dt><dd>{formatBytes(service.usage.syncCacheBytes, locale)}</dd></div>
      <div><dt>{t("syncStoragePhotos", locale)}</dt><dd>{formatBytes(service.usage.attachmentBytes, locale)}</dd></div>
      <div><dt>{t("syncStorageDatabase", locale)}</dt><dd>{formatBytes(service.usage.databaseBytes, locale)}</dd></div>
      <div className="sync-usage-total"><dt>{t("syncStorageTotal", locale)}</dt><dd>{formatBytes(service.usage.syncCacheBytes + service.usage.attachmentBytes + service.usage.databaseBytes, locale)}</dd></div>
    </dl>}
    {error && <div role="status" className={error.code === "SYNC_OFFLINE" ? "settings-footnote" : "sync-error"}>
      <p>{t(errors[error.code] ?? "syncFailedSafe", locale)}</p>
      {error.code !== "SYNC_OFFLINE" && <details><summary>{t("syncErrorDetails", locale)}</summary><pre>{error.message}</pre></details>}
    </div>}
    {service.status && service.status.failures > 0 && <p className="settings-footnote">{t("syncRetryAt", locale)}: {new Date(service.status.nextAttempt).toLocaleTimeString(localeTag[locale])}</p>}
    {notice && <p role="status" className="settings-footnote">{notice}</p>}
    {service.missingAttachments.length > 0 && (
      <section className="sync-missing-list" aria-label={t("syncMissingPhotos", locale)}>
        <header>
          <div>
            <h4>{t("syncMissingPhotos", locale)} · {service.missingAttachments.length}</h4>
            <p>{t("syncMissingPhotosHelp", locale)}</p>
          </div>
          <button
            type="button"
            className="secondary-button"
            disabled={Boolean(missingBusy)}
            onClick={async () => {
              setMissingBusy("all");
              try {
                await service.clearMissingAttachments();
                setNotice(t("syncMissingPhotosCleared", locale));
              } catch {
                setNotice(t("syncFailedSafe", locale));
              } finally {
                setMissingBusy("");
              }
            }}
          >
            <Icon name="trash" size={14} />{t("syncClearMissingPhotos", locale)}
          </button>
        </header>
        <ul>
          {service.missingAttachments.map((item) => (
            <li key={item.attachmentId}>
              <span>
                <strong>{item.entryTitle || t("categoryUntitled", locale)}</strong>
                <small>{item.entryDate} · {item.sourcePath ? t("syncMissingLocalPhoto", locale) : t("syncMissingRemotePhoto", locale)}</small>
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={Boolean(missingBusy)}
                onClick={async () => {
                  setMissingBusy(item.attachmentId);
                  try {
                    await service.removeMissingAttachment(item.attachmentId);
                    setNotice(t("syncMissingPhotoRemoved", locale));
                  } catch {
                    setNotice(t("syncFailedSafe", locale));
                  } finally {
                    setMissingBusy("");
                  }
                }}
              >
                {t("syncRemoveMissingPhoto", locale)}
              </button>
            </li>
          ))}
        </ul>
      </section>
    )}
    <p className="settings-footnote">{t("syncDataNote", locale)}</p>
    {config.mode === "webdav" && <p className="settings-footnote">{t("syncWebdavRetention", locale)}</p>}
    {service.conflicts.length > 0 && <section className="sync-conflict-list" aria-label={t("syncConflicts", locale)}>
      <h4>{t("syncConflicts", locale)}</h4><p>{t("syncConflictHelp", locale)}</p>
      {service.conflicts.map((conflict) => {
        const key = `${conflict.entity}/${conflict.id}/${conflict.field}`;
        const title = entries.find((entry) => entry.id === conflict.id)?.title ?? `${conflict.entity} · ${conflict.id.slice(0, 8)}`;
        return <article className="sync-conflict" key={key}>
          <strong>{title} · {fieldLabel(conflict, locale)}</strong>
          <div>{conflict.versions.map((version) => <section key={version.operationId}>
            <small>{new Date(version.timestamp).toLocaleString(localeTag[locale])} · {version.deviceId.slice(0, 8)}</small>
            <pre>{conflict.field === "$exists" ? t(version.value ? "syncKeepItem" : "syncDeleteItem", locale) : typeof version.value === "string" ? version.value : JSON.stringify(version.value, null, 2)}</pre>
            <button type="button" className="secondary-button" disabled={service.busy || Boolean(resolving)} onClick={async () => {
              setResolving(key); setNotice("");
              try { await service.resolve(conflict, version.operationId); }
              catch (error) { setNotice(t(error instanceof Error && error.message === "SYNC_CONFLICT_CHANGED" ? "syncConflictChanged" : "syncFailedSafe", locale)); }
              finally { setResolving(""); }
            }}>{t("syncUseVersion", locale)}</button>
          </section>)}</div>
        </article>;
      })}
    </section>}
  </>;
}
