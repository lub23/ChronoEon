import { useId, useRef, useState } from "react";
import { createEntryId, type AIProviderConfig, type Locale } from "@chronoeon/domain";
import {
  AI_PROVIDER_PRESETS, DEFAULT_AI_PROVIDER, deleteAIProviderCredentials, fetchAIModels,
  normalizeAICustomHeaders, normalizeAIBaseUrl, readAIProviderCredentials, saveAIProviderCredentials,
  type AIProviderCredentials, type AIProviderPreferences, type AIProviderPreset, type AIProviderProfile,
} from "../ai/provider";
import { isTauri } from "../platform/desktop";
import { t } from "../i18n";
import { GlassSelect } from "./GlassSelect";
import { Icon } from "./Icon";
import { SecretInput } from "./SecretInput";
import { useConfirmDialog } from "./ConfirmDialog";

interface Props {
  locale: Locale;
  preferences: AIProviderPreferences;
  onChange: (preferences: AIProviderPreferences) => void;
  onTest: (provider: AIProviderConfig) => Promise<void>;
}

export function AISettingsPanel({ locale, preferences, onChange, onTest }: Props) {
  const headerSuggestions = useId();
  const [draft, setDraft] = useState<AIProviderProfile | null>(null);
  const [credentials, setCredentials] = useState<AIProviderCredentials>({ apiKey: "", headers: [] });
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const busyRef = useRef(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const latest = useRef(preferences);
  latest.current = preferences;
  const { confirm, dialog } = useConfirmDialog(locale);
  const patch = (change: Partial<AIProviderProfile>) => { setDraft(value => value ? { ...value, ...change } : null); if (change.baseUrl !== undefined || change.preset !== undefined) setModels([]); setResult(null); };
  const run = async (key: string, action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(key); setResult(null);
    try { await action(); }
    catch (error) { setResult({ ok: false, text: error instanceof Error ? error.message : String(error) }); }
    finally { busyRef.current = false; setBusy(""); }
  };
  const add = () => {
    setDraft({ ...DEFAULT_AI_PROVIDER, ...AI_PROVIDER_PRESETS.compatible, id: createEntryId(), name: "", preset: "compatible" });
    setCredentials({ apiKey: "", headers: [] }); setModels([]); setResult(null);
  };
  const edit = (profile: AIProviderProfile) => void run(profile.id, async () => {
    const secret = await readAIProviderCredentials(profile.id);
    setDraft({ ...profile }); setCredentials(secret); setModels([]);
  });
  const save = () => void run("save", async () => {
    if (!draft) return;
    if (!draft.name.trim() || !draft.model.trim() || !draft.baseUrl.trim()) throw new Error(t("aiProviderNameRequired", locale));
    const normalizedHeaders = normalizeAICustomHeaders(credentials.headers);
    if (normalizedHeaders.length !== credentials.headers.length) throw new Error(t("aiHeadersInvalid", locale));
    let baseUrl: string;
    try { baseUrl = normalizeAIBaseUrl(draft.baseUrl); }
    catch { throw new Error(t("aiEndpointInvalid", locale)); }
    const profile = { ...draft, name: draft.name.trim(), model: draft.model.trim(), baseUrl };
    await saveAIProviderCredentials(profile.id, credentials);
    const current = latest.current;
    const providers = current.providers.some(value => value.id === profile.id)
      ? current.providers.map(value => value.id === profile.id ? profile : value) : [...current.providers, profile];
    onChange({ ...current, providers, activeProviderId: current.activeProviderId === profile.id ? null : current.activeProviderId });
    setDraft(null);
    setResult({ ok: true, text: t("aiProviderSaved", locale) });
  });
  const activate = (profile: AIProviderProfile) => void run(profile.id, async () => {
    await onTest(profile);
    onChange({ ...latest.current, enabled: true, activeProviderId: profile.id });
    setResult({ ok: true, text: `${profile.name} ${t("aiProviderIsActive", locale)}` });
  });
  const remove = (profile: AIProviderProfile) => void run(profile.id, async () => {
    if (!await confirm({ title: t("aiProviderDeleteTitle", locale), detail: profile.name, tone: "danger", confirmLabel: t("delete", locale) })) return;
    await deleteAIProviderCredentials(profile.id);
    const current = latest.current;
    onChange({ ...current, providers: current.providers.filter(value => value.id !== profile.id), activeProviderId: current.activeProviderId === profile.id ? null : current.activeProviderId });
    if (draft?.id === profile.id) setDraft(null);
  });

  const editor = draft && <form className="ai-provider-form" onSubmit={event => { event.preventDefault(); save(); }}>
      <fieldset disabled={Boolean(busy)}>
        <label className="settings-field"><span>{t("aiProviderType", locale)}</span>
          <GlassSelect value={draft.preset} ariaLabel={t("aiProviderTypeLabel", locale)}
            options={Object.entries(AI_PROVIDER_PRESETS).map(([value, preset]) => ({ value, label: value === "local" ? t("aiProviderLocalCustom", locale) : preset.name }))}
            onChange={value => { const preset = AI_PROVIDER_PRESETS[value as AIProviderPreset]; patch({ preset: value as AIProviderPreset, kind: preset.kind, name: draft.name || preset.name, baseUrl: draft.baseUrl || preset.baseUrl }); }} />
        </label>
        <label className="settings-field"><span>{t("aiProviderName", locale)}<span className="required-mark" aria-hidden="true"> *</span></span><input required value={draft.name} onChange={event => patch({ name: event.target.value })} /></label>
        <label className="settings-field"><span>{t("aiProviderUrl", locale)}<span className="required-mark" aria-hidden="true"> *</span></span><input required type="url" spellCheck={false} value={draft.baseUrl} onChange={event => patch({ baseUrl: event.target.value })} placeholder="https://example.com/v1" /></label>
        <label className="settings-field"><span>{t("aiProviderKey", locale)}</span><SecretInput locale={locale} ariaLabel={t("aiProviderKey", locale)} value={credentials.apiKey} onChange={apiKey => setCredentials(current => ({ ...current, apiKey }))} /></label>
        <datalist id={headerSuggestions}>{["Authorization", "Content-Type", "Accept", "X-API-Key", "api-key", "OpenAI-Organization", "OpenAI-Project", "HTTP-Referer", "X-Title"].map(name => <option key={name} value={name} />)}</datalist>
        <div className="ai-provider-headers">
          <header><strong>{t("aiProviderHeaders", locale)}</strong><button type="button" className="icon-button" title={t("aiAddHeader", locale)} aria-label={t("aiAddHeader", locale)} disabled={credentials.headers.length >= 10} onClick={() => setCredentials(current => ({ ...current, headers: [...current.headers, { name: "", value: "" }] }))}><Icon name="plus" size={14} /></button></header>
          {credentials.headers.map((header, index) => <div key={index} className="ai-header-row">
            <input list={headerSuggestions} required value={header.name} placeholder="X-Header" aria-label={t("aiHeaderName", locale)} spellCheck={false} onChange={event => setCredentials(current => ({ ...current, headers: current.headers.map((row, i) => i === index ? { ...row, name: event.target.value } : row) }))} />
            <SecretInput locale={locale} ariaLabel={t("aiHeaderValue", locale)} value={header.value} onChange={value => setCredentials(current => ({ ...current, headers: current.headers.map((row, i) => i === index ? { ...row, value } : row) }))} />
            <button type="button" className="icon-button" title={t("delete", locale)} aria-label={t("delete", locale)} onClick={() => setCredentials(current => ({ ...current, headers: current.headers.filter((_, i) => i !== index) }))}><Icon name="close" size={14} /></button>
          </div>)}
        </div>
        <label className="settings-field"><span>{t("aiModel", locale)}<span className="required-mark" aria-hidden="true"> *</span></span><div className="ai-model-controls">
          {models.length ? <GlassSelect value={draft.model} ariaLabel={t("aiModel", locale)} options={[...new Set([draft.model, ...models].filter(Boolean))].map(value => ({ value, label: value }))} onChange={model => setDraft({ ...draft, model })} />
            : <input required value={draft.model} onChange={event => setDraft({ ...draft, model: event.target.value })} spellCheck={false} />}
          <button type="button" className="icon-button" title={t("aiProviderLoadModels", locale)} aria-label={t("aiProviderLoadModels", locale)} disabled={!draft.baseUrl.trim()} onClick={() => void run("models", async () => { const values = [...new Set((await fetchAIModels(draft, undefined, credentials)).map(model => model.id))]; setModels(values); if (values.length && !values.includes(draft.model)) setDraft(current => current ? { ...current, model: values[0] } : null); })}><Icon name="refresh" size={14} /></button>
        </div></label>

        <footer><button type="button" className="secondary-button" onClick={() => setDraft(null)}>{t("cancel", locale)}</button><button type="submit" className="primary-action"><Icon name="check" size={14} />{t("save", locale)}</button></footer>
      </fieldset>
    </form>;

  return <>
    <header className="settings-section-heading ai-provider-heading">
      <h3>{t("aiProvidersHeading", locale)}</h3>
      <button type="button" className="secondary-button" disabled={Boolean(busy) || Boolean(draft)} onClick={add}><Icon name="plus" size={14} />{t("aiProviderAdd", locale)}</button>
    </header>
    <p className="settings-footnote">{isTauri()
      ? t("aiProviderDeviceOnly", locale)
      : t("aiProviderBrowserSession", locale)}</p>
    <ul className="ai-provider-list">
      {preferences.providers.map(profile => <li key={profile.id}>
        <div className="ai-provider-row">
        <button type="button" className="icon-button ai-provider-activate" disabled={Boolean(busy) || Boolean(draft)}
          aria-label={`${t("aiProviderActivate", locale)} ${profile.name}`} aria-pressed={preferences.activeProviderId === profile.id}
          title={preferences.activeProviderId === profile.id ? t("aiProviderActive", locale) : t("aiProviderTestActivate", locale)}
          onClick={() => activate(profile)}><Icon name={preferences.activeProviderId === profile.id ? "check" : "play"} size={15} /></button>
        <div className="ai-provider-copy"><strong>{profile.name}</strong><small>{profile.model}</small><small>{profile.baseUrl}</small></div>
        <button type="button" className="icon-button" disabled={Boolean(busy)} aria-label={`${t("edit", locale)} ${profile.name}`} title={t("edit", locale)} onClick={() => edit(profile)}><Icon name="edit" size={14} /></button>
        <button type="button" className="icon-button" disabled={Boolean(busy)} aria-label={`${t("delete", locale)} ${profile.name}`} title={t("delete", locale)} onClick={() => remove(profile)}><Icon name="trash" size={14} /></button>
        </div>
        {draft?.id === profile.id && editor}
      </li>)}
    </ul>
    {!preferences.providers.length && !draft && <p className="settings-footnote">{t("aiProviderEmpty", locale)}</p>}
    {draft && !preferences.providers.some(profile => profile.id === draft.id) && editor}

    {busy && <p role="status" className="settings-footnote">{t("aiProviderWorking", locale)}</p>}
    {result && <p role={result.ok ? "status" : "alert"} className={`settings-footnote ${result.ok ? "is-success" : "is-error"}`}>{result.text}</p>}
    <div className="ai-parsing-settings">
      <div className="settings-option"><span className="settings-option-copy"><strong>{t("quickNote", locale)}</strong><small>{t("aiCaptureRouting", locale)}</small></span></div>
      <div className="settings-option"><span className="settings-option-copy"><strong>{t("aiChatTitle", locale)}</strong><small>{t("aiAskRouting", locale)}</small></span></div>
      <label className="settings-toggle-row"><span className="settings-option-copy"><strong>{t("aiAskThinking", locale)}</strong></span>
        <span className={preferences.ask.thinking ? "settings-switch is-on" : "settings-switch"} aria-hidden="true"><i /></span>
        <input type="checkbox" checked={preferences.ask.thinking} onChange={event => onChange({ ...preferences, ask: { ...preferences.ask, thinking: event.target.checked } })} aria-label={t("aiAskThinking", locale)} />
      </label>
    </div>
    {dialog}
  </>;
}
