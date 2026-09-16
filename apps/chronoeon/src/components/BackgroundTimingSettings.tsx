import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../domain/entry";
import { backgroundStatus, openBackgroundSettings, type BackgroundStatus } from "../platform/background";
import { t } from "../i18n";

/** Explicit OS controls rather than hidden keep-alive/battery-exemption tricks. */
export function BackgroundTimingSettings({ locale }: { locale: Locale }) {
  const [status, setStatus] = useState<BackgroundStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(async () => {
    try { setStatus(await backgroundStatus()); setFailed(false); } catch { setFailed(true); }
  }, []);
  useEffect(() => {
    void refresh();
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [refresh]);
  const open = (target: "alarms" | "battery") => { void openBackgroundSettings(target).catch(() => setFailed(true)); };
  return <div className="settings-card background-timing-settings">
    <div className="settings-option-copy"><strong>{t("backgroundTiming", locale)}</strong><small>{t("backgroundTimingDetail", locale)}</small></div>
    {failed ? <p className="background-timing-warning" role="status">{t("backgroundUnavailable", locale)}<button type="button" className="secondary-button" onClick={() => void refresh()}>{t("retry", locale)}</button></p>
      : !status ? <small>{t("backgroundChecking", locale)}</small>
      : <>
        <div className="background-timing-status" role="status"><span>{t(status.timerRunning ? "backgroundTimerRunning" : "backgroundTimerIdle", locale)}</span><span>{t(status.exactAlarms ? "backgroundAlarmsReady" : "backgroundAlarmsNeeded", locale)}</span></div>
        {!status.exactAlarms && <button type="button" className="secondary-button" onClick={() => open("alarms")}>{t("backgroundAllowAlarms", locale)}</button>}
        {status.batteryRestricted && <p className="background-timing-warning">{t("backgroundBatteryRestricted", locale)}</p>}
      </>}
    <div className="settings-option"><small>{t("backgroundTimingLimit", locale)}</small><button type="button" className="secondary-button" onClick={() => open("battery")}>{t("backgroundBatterySettings", locale)}</button></div>
  </div>;
}
