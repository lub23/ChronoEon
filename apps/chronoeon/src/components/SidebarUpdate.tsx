import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../domain/entry";
import { t, type MessageKey } from "../i18n";
import { isTauri, readAppVersion } from "../platform/desktop";
import { checkForAppUpdate, downloadAppUpdate, installAppUpdate, openUpdatePage, type AppUpdate } from "../platform/update";
import { Icon } from "./Icon";

interface SidebarUpdateProps {
  locale: Locale;
  collapsed: boolean;
}

type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest" }
  | { kind: "available"; update: AppUpdate }
  | { kind: "downloading" }
  | { kind: "installing" }
  | { kind: "failed" };

const stateMessages: Record<Exclude<UpdateState["kind"], "idle" | "available">, MessageKey> = {
  checking: "updateChecking",
  latest: "updateLatest",
  downloading: "updateDownloading",
  installing: "updateInstalling",
  failed: "updateFailed",
};

/** The running version, plus a real update check that ends at the installer. */
export function SidebarUpdate({ locale, collapsed }: SidebarUpdateProps) {
  const [version, setVersion] = useState("");
  const [state, setState] = useState<UpdateState>({ kind: "idle" });
  const supported = isTauri();

  useEffect(() => {
    let current = true;
    void readAppVersion().then((value) => { if (current) setVersion(value); });
    return () => { current = false; };
  }, []);

  const check = useCallback(async () => {
    if (!supported) return;
    setState({ kind: "checking" });
    try {
      const update = await checkForAppUpdate(version || await readAppVersion());
      setState(update ? { kind: "available", update } : { kind: "latest" });
    } catch (error) {
      console.warn("Update check failed", error);
      setState({ kind: "failed" });
    }
  }, [supported, version]);

  const install = useCallback(async (update: AppUpdate) => {
    // A release without an asset for this platform still tells the user where
    // to get it; the app never guesses an installer.
    if (!update.url) {
      try {
        await openUpdatePage(update.pageUrl);
        setState({ kind: "installing" });
      } catch (error) {
        console.warn("Could not open the release page", error);
        setState({ kind: "failed" });
      }
      return;
    }
    setState({ kind: "downloading" });
    try {
      const path = await downloadAppUpdate(update);
      setState({ kind: "installing" });
      await installAppUpdate(path);
    } catch (error) {
      console.warn("Update install failed", error);
      setState({ kind: "failed" });
    }
  }, []);

  const busy = state.kind === "checking" || state.kind === "downloading" || state.kind === "installing";
  const note = state.kind === "available"
    ? t("updateAvailable", locale).replace("{version}", state.update.version)
    : state.kind === "idle" ? "" : t(stateMessages[state.kind], locale);

  return (
    <div className={collapsed ? "sidebar-update is-collapsed" : "sidebar-update"}>
      <button
        type="button"
        className={state.kind === "available" ? "sidebar-utility is-accent" : "sidebar-utility"}
        onClick={() => { void check(); }}
        disabled={!supported || busy}
        aria-label={t("checkUpdate", locale)}
        title={supported ? t("checkUpdate", locale) : t("updateNeedsApp", locale)}
      >
        <Icon name="refresh" size={15} />
        {!collapsed && <span>{t("checkUpdate", locale)}</span>}
      </button>
      {!collapsed && note && <p className="sidebar-update-note" role="status">{note}</p>}
      {state.kind === "available" && (
        <button type="button" className="sidebar-update-install" onClick={() => { void install(state.update); }}>
          <Icon name="download" size={13} />
          {t("updateInstall", locale)}
        </button>
      )}
      {!collapsed && (
        <p className="sidebar-version">
          <span>{t("productName", locale)}</span>
          {version && <b>{t("versionNumber", locale).replace("{version}", version)}</b>}
        </p>
      )}
    </div>
  );
}
