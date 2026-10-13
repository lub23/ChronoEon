import { useRef, useState } from "react";
import { createEntryId, type AIProviderConfig, type Locale } from "@chronoeon/domain";
import {
  AI_PROVIDER_PRESETS, DEFAULT_AI_PROVIDER, deleteAIProviderCredentials, fetchAIModels,
  normalizeAIBaseUrl, readAIProviderCredentials, saveAIProviderCredentials,
  type AIProviderCredentials, type AIProviderPreferences, type AIProviderPreset, type AIProviderProfile,
} from "../ai/provider";
import { isTauri } from "../platform/desktop";
import { t } from "../i18n";
import { GlassSelect } from "./GlassSelect";
import { Icon } from "./Icon";
import { useConfirmDialog } from "./ConfirmDialog";

interface Props {
  locale: Locale;
  preferences: AIProviderPreferences;
  onChange: (preferences: AIProviderPreferences) => void;
  onTest: (provider: AIProviderConfig) => Promise<void>;
}

export function AISettingsPanel({ locale, preferences, onChange, onTest }: Props) {
  const zh = locale === "zh";
  const [draft, setDraft] = useState<AIProviderProfile | null>(null);
  const [credentials, setCredentials] = useState<AIProviderCredentials>({ apiKey: "", headers: [] });
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const busyRef = useRef(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const latest = useRef(preferences);
  latest.current = preferences;
  const { confirm, dialog } = useConfirmDialog(locale);
  const patch = (change: Partial<AIProviderProfile>) => { setDraft(value => value ? { ...value, ...change } : null); setModels([]); setResult(null); };
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
    const profile = { ...draft, name: draft.name.trim(), model: draft.model.trim(), baseUrl: normalizeAIBaseUrl(draft.baseUrl) };
    if (!profile.name || !profile.model) throw new Error(zh ? "请输入名称和模型。" : "Name and model are required.");
    await saveAIProviderCredentials(profile.id, credentials);
    const current = latest.current;
    const providers = current.providers.some(value => value.id === profile.id)
      ? current.providers.map(value => value.id === profile.id ? profile : value) : [...current.providers, profile];
    onChange({ ...current, providers, activeProviderId: current.activeProviderId === profile.id ? null : current.activeProviderId });
    setDraft(null);
    setResult({ ok: true, text: zh ? "已保存，激活前会测试连接。" : "Saved. Activation tests the connection." });
  });
  const activate = (profile: AIProviderProfile) => void run(profile.id, async () => {
    await onTest(profile);
    onChange({ ...latest.current, enabled: true, activeProviderId: profile.id });
    setResult({ ok: true, text: zh ? `已激活 ${profile.name}` : `${profile.name} is active` });
  });
  const remove = (profile: AIProviderProfile) => void run(profile.id, async () => {
    if (!await confirm({ title: zh ? "删除服务？" : "Delete provider?", detail: profile.name, tone: "danger", confirmLabel: t("delete", locale) })) return;
    await deleteAIProviderCredentials(profile.id);
    const current = latest.current;
    onChange({ ...current, providers: current.providers.filter(value => value.id !== profile.id), activeProviderId: current.activeProviderId === profile.id ? null : current.activeProviderId });
    if (draft?.id === profile.id) setDraft(null);
  });

  return <>
    <header className="settings-section-heading ai-provider-heading">
      <h3>{zh ? "AI 服务" : "Providers"}</h3>
      <button type="button" className="secondary-button" disabled={Boolean(busy) || Boolean(draft)} onClick={add}><Icon name="plus" size={14} />{zh ? "添加服务" : "Add"}</button>
    </header>
    <p className="settings-footnote">{isTauri()
      ? (zh ? "服务配置仅用于本机，密钥和请求头加密保存。" : "Device-only. Keys and headers are stored securely.")
      : (zh ? "浏览器中的密钥和请求头仅保留到页面关闭。" : "Browser keys and headers last only for this session.")}</p>
    <ul className="ai-provider-list">
      {preferences.providers.map(profile => <li key={profile.id}>
        <button type="button" className="icon-button ai-provider-activate" disabled={Boolean(busy) || Boolean(draft)}
          aria-label={`${zh ? "激活" : "Activate"} ${profile.name}`} aria-pressed={preferences.activeProviderId === profile.id}
          title={preferences.activeProviderId === profile.id ? (zh ? "已激活" : "Active") : (zh ? "测试并激活" : "Test & activate")}
          onClick={() => activate(profile)}><Icon name={preferences.activeProviderId === profile.id ? "check" : "play"} size={15} /></button>
        <div className="ai-provider-copy"><strong>{profile.name}</strong><small>{profile.model}</small><small>{profile.baseUrl}</small></div>
        <button type="button" className="icon-button" disabled={Boolean(busy)} aria-label={`${t("edit", locale)} ${profile.name}`} title={t("edit", locale)} onClick={() => edit(profile)}><Icon name="edit" size={14} /></button>
        <button type="button" className="icon-button" disabled={Boolean(busy)} aria-label={`${t("delete", locale)} ${profile.name}`} title={t("delete", locale)} onClick={() => remove(profile)}><Icon name="trash" size={14} /></button>
      </li>)}
    </ul>
    {!preferences.providers.length && !draft && <p className="settings-footnote">{zh ? "尚未添加 AI 服务" : "No providers"}</p>}
    {draft && <form className="ai-provider-form" onSubmit={event => { event.preventDefault(); save(); }}>
      <fieldset disabled={Boolean(busy)}>
        <label className="settings-field"><span>{zh ? "类型" : "Type"}</span>
          <GlassSelect value={draft.preset} ariaLabel={zh ? "服务类型" : "Provider type"}
            options={Object.entries(AI_PROVIDER_PRESETS).map(([value, preset]) => ({ value, label: value === "local" && zh ? "自定义本地模型" : preset.name }))}
            onChange={value => { const preset = AI_PROVIDER_PRESETS[value as AIProviderPreset]; patch({ ...preset, preset: value as AIProviderPreset }); }} />
        </label>
        <label className="settings-field"><span>{zh ? "名称" : "Name"}</span><input required value={draft.name} onChange={event => patch({ name: event.target.value })} /></label>
        <label className="settings-field"><span>{zh ? "API 地址" : "API URL"}</span><input required type="url" spellCheck={false} value={draft.baseUrl} onChange={event => patch({ baseUrl: event.target.value })} placeholder="https://example.com/v1" /></label>
        <label className="settings-field"><span>{zh ? "密钥" : "API key"}</span><input type="password" autoComplete="new-password" value={credentials.apiKey} onChange={event => setCredentials(current => ({ ...current, apiKey: event.target.value }))} /></label>
        <div className="ai-provider-headers">
          <header><strong>{zh ? "请求头" : "Headers"}</strong><button type="button" className="icon-button" title={zh ? "添加请求头" : "Add header"} aria-label={zh ? "添加请求头" : "Add header"} disabled={credentials.headers.length >= 10} onClick={() => setCredentials(current => ({ ...current, headers: [...current.headers, { name: "", value: "" }] }))}><Icon name="plus" size={14} /></button></header>
          {credentials.headers.map((header, index) => <div key={index} className="ai-header-row">
            <input value={header.name} placeholder="X-Header" aria-label={zh ? "请求头名称" : "Header name"} spellCheck={false} onChange={event => setCredentials(current => ({ ...current, headers: current.headers.map((row, i) => i === index ? { ...row, name: event.target.value } : row) }))} />
            <input type="password" value={header.value} aria-label={zh ? "请求头值" : "Header value"} spellCheck={false} autoComplete="new-password" onChange={event => setCredentials(current => ({ ...current, headers: current.headers.map((row, i) => i === index ? { ...row, value: event.target.value } : row) }))} />
            <button type="button" className="icon-button" title={t("delete", locale)} aria-label={t("delete", locale)} onClick={() => setCredentials(current => ({ ...current, headers: current.headers.filter((_, i) => i !== index) }))}><Icon name="close" size={14} /></button>
          </div>)}
        </div>
        <label className="settings-field"><span>{zh ? "模型" : "Model"}</span><div className="ai-model-controls">
          <input required value={draft.model} onChange={event => setDraft({ ...draft, model: event.target.value })} spellCheck={false} />
          <button type="button" className="icon-button" title={zh ? "获取模型" : "Load models"} aria-label={zh ? "获取模型" : "Load models"} disabled={!draft.baseUrl.trim()} onClick={() => void run("models", async () => setModels((await fetchAIModels(draft, undefined, credentials)).map(model => model.id)))}><Icon name="refresh" size={14} /></button>
        </div></label>
        {models.length > 0 && <ul className="ai-model-list">{models.map(model => <li key={model}><button type="button" onClick={() => setDraft({ ...draft, model })} className={draft.model === model ? "is-active" : ""}>{model}</button></li>)}</ul>}
        <footer><button type="button" className="secondary-button" onClick={() => setDraft(null)}>{t("cancel", locale)}</button><button type="submit" className="primary-action"><Icon name="check" size={14} />{t("save", locale)}</button></footer>
      </fieldset>
    </form>}
    {busy && <p role="status" className="settings-footnote">{zh ? "处理中…" : "Working…"}</p>}
    {result && <p role={result.ok ? "status" : "alert"} className={`settings-footnote ${result.ok ? "is-success" : "is-error"}`}>{result.text}</p>}
    <div className="ai-parsing-settings">
      {(["capture", "ask"] as const).map(surface => <div className="settings-option" key={surface}>
        <strong>{t(surface === "capture" ? "quickNote" : "aiChatTitle", locale)}</strong>
        <div className="settings-segmented" role="group" aria-label={t(surface === "capture" ? "quickNote" : "aiChatTitle", locale)}>
          <button type="button" disabled={surface !== "capture"} className={surface === "capture" ? "is-active" : ""} aria-pressed={surface === "capture"}>{zh ? "离线解析" : "Offline"}</button>
          <button type="button" disabled={surface !== "ask"} className={surface === "ask" ? "is-active" : ""} aria-pressed={surface === "ask"}>{zh ? "AI 解析" : "AI"}</button>
        </div>
      </div>)}
      <label className="settings-toggle-row"><span className="settings-option-copy"><strong>{t("aiAskThinking", locale)}</strong></span>
        <span className={preferences.ask.thinking ? "settings-switch is-on" : "settings-switch"} aria-hidden="true"><i /></span>
        <input type="checkbox" checked={preferences.ask.thinking} onChange={event => onChange({ ...preferences, ask: { ...preferences.ask, thinking: event.target.checked } })} aria-label={t("aiAskThinking", locale)} />
      </label>
    </div>
    {dialog}
  </>;
}
