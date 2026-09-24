import { useEffect, useState } from "react";
import type { AIProviderConfig, Locale } from "@chronoeon/domain";
import {
  activeAIProvider,
  fetchAIModels,
  normalizeAIBaseUrl,
  type AICustomHeader,
  type AIModelInfo,
  type AIProviderChoice,
  type AIProviderPreferences,
} from "../ai/provider";
import { isTauri } from "../platform/desktop";
import { t } from "../i18n";
import { Icon } from "./Icon";

interface AISettingsPanelProps {
  locale: Locale;
  preferences: AIProviderPreferences;
  localKeyStored: boolean;
  remoteKeyStored: boolean;
  localHeaders: AICustomHeader[];
  onChange: (preferences: AIProviderPreferences) => void;
  onSaveLocalKey: (value: string) => Promise<void>;
  onClearLocalKey: () => Promise<void>;
  onSaveRemoteKey: (value: string) => Promise<void>;
  onClearRemoteKey: () => Promise<void>;
  onSaveLocalHeaders: (headers: AICustomHeader[]) => Promise<AICustomHeader[]>;
  onTest: (provider: AIProviderConfig) => Promise<void>;
}

/**
 * 随心问's endpoint form. Local compatible endpoints can require Bearer auth
 * and custom headers; 随心记 does not use an endpoint at all.
 */
function AIEndpointFields({ locale, choice, onChange, onTest }: {
  locale: Locale;
  choice: AIProviderChoice;
  onChange: (choice: AIProviderChoice) => void;
  onTest: (provider: AIProviderConfig) => Promise<void>;
}) {
  const [busy, setBusy] = useState<"test" | "models" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [models, setModels] = useState<AIModelInfo[] | null>(null);
  const provider = activeAIProvider(choice);
  const insecure = choice.backend === "remote"
    && /^http:\/\//i.test(provider.baseUrl)
    && !/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::|\/|$)/i.test(provider.baseUrl);

  const patch = (next: Partial<AIProviderConfig>) => {
    onChange({ ...choice, [choice.backend]: { ...provider, ...next } });
    setResult(null);
    setModels(null);
  };

  async function run(kind: "test" | "models") {
    setBusy(kind);
    setResult(null);
    try {
      normalizeAIBaseUrl(provider.baseUrl);
      if (kind === "test") {
        await onTest(provider);
        setResult({ ok: true, text: t("aiTestOk", locale) });
      } else {
        const list = await fetchAIModels(provider);
        setModels(list);
        setResult({
          ok: true,
          text: (locale === "zh" ? "已获取 {count} 个模型" : "Loaded {count} models").replace("{count}", String(list.length)),
        });
      }
    } catch (error) {
      if (kind === "models") setModels(null);
      setResult({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="settings-option">
        <span className="settings-option-copy"><strong>{t("aiProvider", locale)}</strong><small>{choice.backend === "remote" ? t("aiRemote", locale) : t("aiLocal", locale)}</small></span>
        <div className="settings-segmented" role="group">
          {(["remote", "local"] as const).map((backend) => (
            <button
              key={backend}
              type="button"
              className={choice.backend === backend ? "is-active" : ""}
              onClick={() => { onChange({ ...choice, backend }); setResult(null); setModels(null); }}
              aria-pressed={choice.backend === backend}
            >
              {t(backend === "remote" ? "aiRemote" : "aiLocal", locale)}
            </button>
          ))}
        </div>
      </div>
      <label className="settings-field ai-settings-field">
        <span><strong>{t("aiEndpoint", locale)}</strong><small>{t("aiEndpointHint", locale)}</small></span>
        <input value={provider.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} placeholder={choice.backend === "local" ? "http://127.0.0.1:8080/v1" : "https://…/v1"} inputMode="url" spellCheck={false} />
      </label>
      <label className="settings-field ai-settings-field">
        <span><strong>{t("aiModel", locale)}</strong><small>{locale === "zh" ? "可先读取模型列表" : "Load the model list first"}</small></span>
        <div className="ai-model-controls">
          <input value={provider.model} onChange={(event) => patch({ model: event.target.value })} placeholder="model-name" spellCheck={false} />
          <button type="button" className="secondary-button" disabled={busy !== null || !provider.baseUrl.trim()} onClick={() => void run("models")}>
            <Icon name="refresh" size={13} />{locale === "zh" ? "获取" : "Load"}
          </button>
        </div>
      </label>
      <div className="ai-settings-actions">
        <button type="button" className="secondary-button" disabled={busy !== null || !provider.baseUrl.trim()} onClick={() => void run("test")}><Icon name="sparkle" size={14} />{t(busy === "test" ? "aiTesting" : "aiTest", locale)}</button>
        {result && <span className={result.ok ? "is-success" : "is-error"} role="status">{result.text}</span>}
      </div>
      {insecure && <p className="settings-inline-warning"><Icon name="sparkle" size={13} />{t("aiInsecureEndpoint", locale)}</p>}
      {models?.length ? (
        <ul className="ai-model-list" aria-label={t("aiModel", locale)}>
          {models.slice(0, 8).map((model) => (
            <li key={model.id}>
              <button type="button" className={provider.model === model.id ? "is-active" : ""} onClick={() => patch({ model: model.id })}>
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

export function AISettingsPanel({
  locale, preferences, localKeyStored, remoteKeyStored, onChange,
  localHeaders, onSaveLocalKey, onClearLocalKey, onSaveRemoteKey, onClearRemoteKey,
  onSaveLocalHeaders, onTest,
}: AISettingsPanelProps) {
  const [keyDrafts, setKeyDrafts] = useState({ remote: "", local: "" });
  const [headerDrafts, setHeaderDrafts] = useState<AICustomHeader[]>(localHeaders);
  const [busy, setBusy] = useState<"key" | "headers" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const ask = preferences.ask;

  useEffect(() => { setHeaderDrafts(localHeaders); }, [localHeaders]);

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

  async function saveHeaders() {
    setBusy("headers");
    setResult(null);
    try {
      const saved = await onSaveLocalHeaders(headerDrafts);
      setHeaderDrafts(saved);
      setResult({ ok: true, text: t("aiHeadersStored", locale) });
    } catch (error) {
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
      </div>

      <header className="settings-section-heading settings-subheading"><h3>{t("aiChatTitle", locale)}</h3><p>{t("aiAskDetail", locale)}</p></header>
      <div className="settings-card ai-settings-card">
        <AIEndpointFields locale={locale} choice={ask} onChange={(choice) => { onChange({ ...preferences, ask: { ...ask, ...choice } }); setResult(null); }} onTest={onTest} />
        {ask.backend === "remote" && (
          <div className="settings-option ai-key-row">
            <span className="settings-option-copy"><strong>{t("aiRemoteApiKey", locale)}</strong><small>{isTauri() ? t(remoteKeyStored ? "aiApiKeyStored" : "aiRemoteApiKeyMissing", locale) : t("aiRemoteApiKeySession", locale)}</small></span>
            <div className="ai-key-controls">
              <input type="password" value={keyDrafts.remote} onChange={(event) => setKeyDrafts((current) => ({ ...current, remote: event.target.value }))} placeholder={remoteKeyStored ? "••••••••" : "sk-..."} autoComplete="new-password" />
              <button type="button" className="secondary-button" disabled={busy !== null || !keyDrafts.remote.trim()} onClick={() => void saveKey("remote")}><Icon name="check" size={13} />{t("aiSaveKey", locale)}</button>
              {(remoteKeyStored || keyDrafts.remote) && <button type="button" className="icon-button" disabled={busy !== null} onClick={() => void clearKey("remote")} title={t("aiClearKey", locale)} aria-label={t("aiClearKey", locale)}><Icon name="close" size={14} /></button>}
            </div>
          </div>
        )}
        {ask.backend === "local" && (
          <div className="settings-option ai-key-row">
            <span className="settings-option-copy"><strong>{t("aiLocalApiKey", locale)}</strong><small>{isTauri() ? t(localKeyStored ? "aiApiKeyStored" : "aiLocalApiKeyMissing", locale) : t("aiLocalApiKeySession", locale)}</small></span>
            <div className="ai-key-controls">
              <input type="password" value={keyDrafts.local} onChange={(event) => setKeyDrafts((current) => ({ ...current, local: event.target.value }))} placeholder={localKeyStored ? "••••••••" : "sk-..."} autoComplete="new-password" />
              <button type="button" className="secondary-button" disabled={busy !== null || !keyDrafts.local.trim()} onClick={() => void saveKey("local")}><Icon name="check" size={13} />{t("aiSaveKey", locale)}</button>
              {(localKeyStored || keyDrafts.local) && <button type="button" className="icon-button" disabled={busy !== null} onClick={() => void clearKey("local")} title={t("aiClearKey", locale)} aria-label={t("aiClearKey", locale)}><Icon name="close" size={14} /></button>}
            </div>
          </div>
        )}
        {ask.backend === "local" && (
          <div className="settings-option ai-key-row">
            <span className="settings-option-copy">
              <strong>{t("aiLocalCustomHeaders", locale)}</strong>
              <small>{t("aiLocalCustomHeadersDetail", locale)}</small>
            </span>
            <div className="ai-header-list">
              {headerDrafts.map((header, index) => (
                <div className="ai-header-row" key={index}>
                  <input value={header.name} placeholder={t("aiHeaderName", locale)} spellCheck={false}
                    aria-label={t("aiHeaderName", locale)}
                    onChange={(event) => setHeaderDrafts((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, name: event.target.value } : row))} />
                  <input value={header.value} placeholder={t("aiHeaderValue", locale)} spellCheck={false}
                    aria-label={t("aiHeaderValue", locale)}
                    onChange={(event) => setHeaderDrafts((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, value: event.target.value } : row))} />
                  <button type="button" className="icon-button" disabled={busy !== null}
                    title={t("aiRemoveHeader", locale)} aria-label={t("aiRemoveHeader", locale)}
                    onClick={() => setHeaderDrafts((current) => current.filter((_, rowIndex) => rowIndex !== index))}>
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ))}
              <div className="ai-header-actions">
                <button type="button" className="secondary-button" disabled={busy !== null || headerDrafts.length >= 10} onClick={() => setHeaderDrafts((current) => [...current, { name: "", value: "" }])}>
                  <Icon name="plus" size={13} />{t("aiAddHeader", locale)}
                </button>
                <button type="button" className="secondary-button" disabled={busy !== null} onClick={() => void saveHeaders()}>
                  <Icon name="check" size={13} />{t("aiSaveHeaders", locale)}
                </button>
              </div>
            </div>
          </div>
        )}
        <label className="settings-toggle-row">
          <span className="settings-option-copy"><strong>{t("aiAskThinking", locale)}</strong><small>{t("aiAskThinkingDetail", locale)}</small></span>
          <span className={ask.thinking ? "settings-switch is-on" : "settings-switch"} aria-hidden="true"><i /></span>
          <input type="checkbox" checked={ask.thinking} onChange={(event) => onChange({ ...preferences, ask: { ...ask, thinking: event.target.checked } })} aria-label={t("aiAskThinking", locale)} />
        </label>
        {result && <p className={result.ok ? "settings-footnote is-success" : "settings-footnote is-error"} role="status">{result.text}</p>}
      </div>

      <header className="settings-section-heading settings-subheading"><h3>{t("quickNote", locale)}</h3><p>{t("aiCaptureDetail", locale)}</p></header>
      <div className="settings-card ai-settings-card">
        <div className="settings-option">
          <span className="settings-option-copy">
            <strong>{t("aiCaptureMode", locale)}</strong>
            <small>{t("aiCaptureOfflineDetail", locale)}</small>
          </span>
          <span className="settings-segmented"><button type="button" className="is-active" disabled>{t("aiCaptureOffline", locale)}</button></span>
        </div>
      </div>
    </>
  );
}
