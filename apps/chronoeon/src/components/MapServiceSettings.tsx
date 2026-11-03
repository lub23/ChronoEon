import { PlaceManager } from "./PlaceManager";
import { GEOCODE_ENDPOINTS, GEOCODE_PROVIDERS, type GeocodeProvider, type Locale } from "@chronoeon/domain";
import { t } from "../i18n";
import { GlassSelect } from "./GlassSelect";
import { SecretInput } from "./SecretInput";
import type { AppPreferences } from "./SettingsDialog";

interface Props {
  locale: Locale;
  preferences: AppPreferences;
  /** How many places the geocoder cache knows and how many are still queued. */
  geocodeStatus?: { cached: number; pending: number };
  onChange: (patch: Partial<AppPreferences>) => void;
}

/**
 * Which service turns the places in records into coordinates. Credentials and
 * the endpoint are device-local, like the AI providers beneath them; the
 * endpoint shows its default so the request is never a mystery.
 */
export function MapServiceSettings({ locale, preferences, geocodeStatus, onChange }: Props) {
  const provider: GeocodeProvider = preferences.geocodeProvider ?? "apihz";
  const stored = provider === "amap" ? preferences.amapEndpoint : preferences.apihzEndpoint;
  const endpoint = stored || GEOCODE_ENDPOINTS[provider];
  const setEndpoint = (value: string) => onChange(provider === "amap" ? { amapEndpoint: value.trim() } : { apihzEndpoint: value.trim() });
  return (
    <>
      <header className="settings-section-heading">
        <h3>{t("mapServiceHeading", locale)}</h3>
        <p>{t("mapServiceDetail", locale)}</p>
      </header>
      <div className="settings-card ai-settings-card map-service-card">
        <label className="settings-field ai-settings-field"><span><strong>{t("mapProvider", locale)}</strong></span>
          <GlassSelect value={provider} ariaLabel={t("mapProvider", locale)}
            options={GEOCODE_PROVIDERS.map((value) => ({ value, label: t(value === "amap" ? "mapProviderAmap" : "mapProviderApihz", locale) }))}
            onChange={(value) => onChange({ geocodeProvider: value as GeocodeProvider })} />
        </label>
        <label className="settings-field ai-settings-field"><span><strong>{t("mapEndpoint", locale)}</strong></span>
          <input type="url" value={endpoint} spellCheck={false} autoComplete="off" aria-label={t("mapEndpoint", locale)}
            onChange={(event) => setEndpoint(event.target.value)}
            onBlur={(event) => { if (event.target.value.trim() === GEOCODE_ENDPOINTS[provider]) setEndpoint(""); }} />
        </label>
        {provider === "amap" ? (
          <label className="settings-field ai-settings-field"><span><strong>{t("mapAmapKey", locale)}</strong><small>{t("mapAmapKeyHint", locale)}</small></span>
            <SecretInput locale={locale} ariaLabel={t("mapAmapKey", locale)} value={preferences.amapKey ?? ""} onChange={(value) => onChange({ amapKey: value.trim() })} />
          </label>
        ) : (
          <>
            <label className="settings-field ai-settings-field"><span><strong>{t("mapApiId", locale)}</strong><small>{t("mapApiIdHint", locale)}</small></span>
              <input type="text" value={preferences.geocodeApiId ?? ""} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-label={t("mapApiId", locale)} placeholder="id"
                onChange={(event) => onChange({ geocodeApiId: event.target.value.trim() })} />
            </label>
            <label className="settings-field ai-settings-field"><span><strong>{t("mapApiKey", locale)}</strong></span>
              <SecretInput locale={locale} ariaLabel={t("mapApiKey", locale)} value={preferences.geocodeApiKey ?? ""} onChange={(value) => onChange({ geocodeApiKey: value.trim() })} />
            </label>
          </>
        )}
        {geocodeStatus && <p className="settings-footnote">{t("mapApiStatus", locale).replace("{count}", String(geocodeStatus.cached)).replace("{pending}", String(geocodeStatus.pending))}</p>}
        <p className="settings-footnote">{locale === "zh" ? "GPS 仅自动读取设备坐标并本地匹配 250 米内可信历史地点；点击 GPS 才查询名称；配置高德后提供 250 米内最多 5 个 POI 候选，否则 Android 使用系统 Geocoder，桌面使用 BigDataCloud（免费、公平使用、无固定月上限；通常只到行政区）。接口盒子名称查询按 20 次/分钟限速；高德配额以账户控制台为准。" : "GPS automatically reads device coordinates and matches trusted history within 250 m locally. Names are queried only on click: Amap offers up to 5 POIs within 250 m when configured; otherwise Android system Geocoder; desktop BigDataCloud (free, fair use, no fixed monthly cap; usually administrative names). Apihz lookups are spaced to 20/min. Amap quotas depend on your account."}</p>
        <PlaceManager locale={locale} />
      </div>
    </>
  );
}
