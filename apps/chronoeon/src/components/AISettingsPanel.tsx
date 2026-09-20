import { useState } from "react";
import type { AIProviderConfig, Locale } from "@chronoeon/domain";
import { fetchAIModels, type AIModelInfo, type AIProviderPreferences } from "../ai/provider";
import { activeAIProvider, normalizeAIBaseUrl } from "../ai/provider";
import { isTauri } from "../platform/desktop";
import { t } from "../i18n";
import { Icon } from "./Icon";

interface AISettingsPanelProps {
  locale: Locale;
  preferences: AIProviderPreferences;
  localKeyStored: boolean;
  remoteKeyStored: boolean;
  onChange: (preferences: AIProviderPreferences) => void;
  onSaveLocalKey: (value: string) => Promise<void>;
  onClearLocalKey: () => Promise<void>;
  onSaveRemoteKey: (value: string) => Promise<void>;
  onClearRemoteKey: () => Promise<void>;
  onTest: () => Promise<void>;
}

export function AISettingsPanel({
  locale, preferences, localKeyStored, remoteKeyStored, onChange,
  onSaveLocalKey, onClearLocalKey, onSaveRemoteKey, onClearRemoteKey, onTest,
}: AISettingsPanelProps) {
  const [keyDrafts, setKeyDrafts] = useState({ remote: "", local: "" });
  const [busy, setBusy] = useState<"key" | "test" | "models" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [models, setModels] = useState<AIModelInfo[] | null>(null);
  const provider = activeAIProvider(preferences);
  const insecure = preferences.backend === "remote" && /^http:\/\//i.test(provider.baseUrl) && !/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::|\/|$)/i.test(provider.baseUrl);

  const patchProvider = (patch: Partial<AIProviderConfig>) => {
    const key = preferences.backend;
    onChange({ ...preferences, [key]: { ...preferences[key], ...patch } });
    setResult(null);
    setModels(null);
  };

  async function saveKey(kind: "remote" | "local") {
    setBusy("key");
    setResult(null);
    try {
      if (kind === "remote") await onSaveRemoteKey(keyDrafts.remote);
      else await onSaveLocalKey(keyDrafts.local);
      setKeyDrafts((current) => ({ ...current, [kind]: "" }));
      setResult({ ok: true, text: t("aiApiKeyStored", locale) });
    } catch (error) {
      setResult({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  async function clearKey(kind: "remote" | "local") {
    setBusy("key");
    setResult(null);
    try {
      if (kind === "remote") await onClearRemoteKey();
      else await onClearLocalKey();
      setKeyDrafts((current) => ({ ...current, [kind]: "" }));
    } catch (error) {
      setResult({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  async function testConnection() {
    setBusy("test");
    setResult(null);
    try {
      normalizeAIBaseUrl(provider.baseUrl);
      await onTest();
      setResult({ ok: true, text: locale === "zh" ? "模型列表可达" : "Model catalog reachable" });
    } catch (error) {
      setResult({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  async function loadModels() {
    setBusy("models");
    setResult(null);
    try {
      const list = await fetchAIModels(provider);
      setModels(list);
      setResult({
        ok: true,
        text: locale === "zh"
          ? `已获取 ${list.length} 个模型`
          : `Loaded ${list.length} models`,
      });
    } catch (error) {
      setModels(null);
      setResult({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <header className="settings-section-heading"><h3>{t("settingsAI", locale)}</h3><p>{t("aiSettingsDetail", locale)}</p></header>
      <div className="settings-card ai-settings-card">
        <label className="settings-toggle-row">
          <span className="settings-option-copy"><strong>{t("aiEnabled", locale)}</strong><small>{t("aiEnabledDetail", locale)}</small></span>
          <span className={preferences.enabled ? "settings-switch is-on" : "settings-switch"} aria-hidden="true"><i /></span>
          <input type="checkbox" checked={preferences.enabled} onChange={(event) => { onChange({ ...preferences, enabled: event.target.checked }); setResult(null); }} aria-label={t("aiEnabled", locale)} />
        </label>
        <div className="settings-option">
          <span className="settings-option-copy"><strong>{t("aiProvider", locale)}</strong><small>{preferences.backend === "remote" ? t("aiRemote", locale) : t("aiLocal", locale)}</small></span>
          <div className="settings-segmented" role="group">
            {(["remote", "local"] as const).map((backend) => <button key={backend} type="button" className={preferences.backend === backend ? "is-active" : ""} onClick={() => { onChange({ ...preferences, backend }); setResult(null); }} aria-pressed={preferences.backend === backend}>{t(backend === "remote" ? "aiRemote" : "aiLocal", locale)}</button>)}
          </div>
        </div>
        <label className="settings-field ai-settings-field">
          <span><strong>{t("aiEndpoint", locale)}</strong><small>{t("aiEndpointHint", locale)}</small></span>
          <input value={provider.baseUrl} onChange={(event) => patchProvider({ baseUrl: event.target.value })} placeholder={preferences.backend === "local" ? "http://127.0.0.1:8080/v1" : "https://…/v1"} inputMode="url" spellCheck={false} />
        </label>
        <label className="settings-field ai-settings-field">
          <span><strong>{t("aiModel", locale)}</strong><small>{locale === "zh" ? "可先读取模型列表" : "Load the model list first"}</small></span>
          <div className="ai-model-controls">
            <input value={provider.model} onChange={(event) => patchProvider({ model: event.target.value })} placeholder="model-name" spellCheck={false} />
            <button type="button" className="secondary-button" disabled={busy !== null || !provider.baseUrl.trim()} onClick={() => void loadModels()}>
              <Icon name="refresh" size={13} />{locale === "zh" ? "获取" : "Load"}
            </button>
          </div>
        </label>
        {preferences.backend === "remote" && (
          <div className="settings-option ai-key-row">
            <span className="settings-option-copy"><strong>{t("aiRemoteApiKey", locale)}</strong><small>{isTauri() ? t(remoteKeyStored ? "aiApiKeyStored" : "aiRemoteApiKeyMissing", locale) : t("aiRemoteApiKeySession", locale)}</small></span>
            <div className="ai-key-controls">
              <input type="password" value={keyDrafts.remote} onChange={(event) => setKeyDrafts((current) => ({ ...current, remote: event.target.value }))} placeholder={remoteKeyStored ? "••••••••" : "X-Api-Key"} autoComplete="new-password" />
              <button type="button" className="secondary-button" disabled={busy !== null || !keyDrafts.remote.trim()} onClick={() => void saveKey("remote")}><Icon name="check" size={13} />{t("aiSaveKey", locale)}</button>
              {(remoteKeyStored || keyDrafts.remote) && <button type="button" className="icon-button" disabled={busy !== null} onClick={() => void clearKey("remote")} title={t("aiClearKey", locale)} aria-label={t("aiClearKey", locale)}><Icon name="close" size={14} /></button>}
            </div>
          </div>
        )}
        {preferences.backend === "local" && (
          <div className="settings-option ai-key-row">
            <span className="settings-option-copy"><strong>{t("aiLocalApiKey", locale)}</strong><small>{isTauri() ? t(localKeyStored ? "aiApiKeyStored" : "aiLocalApiKeyMissing", locale) : t("aiLocalApiKeySession", locale)}</small></span>
            <div className="ai-key-controls">
              <input type="password" value={keyDrafts.local} onChange={(event) => setKeyDrafts((current) => ({ ...current, local: event.target.value }))} placeholder={localKeyStored ? "••••••••" : "Bearer api-key"} autoComplete="new-password" />
              <button type="button" className="secondary-button" disabled={busy !== null || !keyDrafts.local.trim()} onClick={() => void saveKey("local")}><Icon name="check" size={13} />{t("aiSaveKey", locale)}</button>
              {(localKeyStored || keyDrafts.local) && <button type="button" className="icon-button" disabled={busy !== null} onClick={() => void clearKey("local")} title={t("aiClearKey", locale)} aria-label={t("aiClearKey", locale)}><Icon name="close" size={14} /></button>}
            </div>
          </div>
        )}
      </div>
      {insecure && <p className="settings-inline-warning"><Icon name="sparkle" size={13} />{t("aiInsecureEndpoint", locale)}</p>}
      <div className="ai-settings-actions">
        <button type="button" className="secondary-button" disabled={busy !== null || !provider.baseUrl.trim()} onClick={() => void testConnection()}><Icon name="sparkle" size={14} />{t(busy === "test" ? "aiTesting" : "aiTest", locale)}</button>
        {result && <span className={result.ok ? "is-success" : "is-error"} role="status">{result.text}</span>}
      </div>
      {models?.length ? (
        <ul className="ai-model-list" aria-label={t("aiModel", locale)}>
          {models.slice(0, 8).map((model) => (
            <li key={model.id}>
              <button type="button" className={provider.model === model.id ? "is-active" : ""} onClick={() => patchProvider({ model: model.id })}>
                <span>{model.id}</span>
                {provider.model === model.id && <Icon name="check" size={13} />}
              </button>
            </li>
          ))}
          {models.length > 8 && <li className="ai-model-more">+{models.length - 8}</li>}
        </ul>
      ) : null}
    </>
  );
}
