import { useEffect, useState } from "react";
import type { Locale } from "../../domain/entry";
import { t } from "../../i18n";
import { Icon } from "../Icon";
import type { ChatProcess as ChatProcessModel } from "./process";

interface ChatProcessProps {
  process: ChatProcessModel;
  busy: boolean;
  locale: Locale;
  /** Model reasoning streamed for the step that is running right now. */
  reasoning?: string;
  /** A ticking clock from the parent keeps the live durations moving. */
  now: number;
}

const seconds = (from: number, to: number) => `${Math.max(0, (to - from) / 1000).toFixed(1)}s`;

/** The step list of one reply: open while it runs, folded to a single line
 *  once the answer is in, and always available to unfold again. */
export function ChatProcess({ process, busy, locale, reasoning, now }: ChatProcessProps) {
  busy = busy && process.endedAt === undefined;
  const [open, setOpen] = useState(busy);
  useEffect(() => { setOpen(busy); }, [busy, process.startedAt]);
  const active = process.steps.find((step) => step.status === "active");
  const end = process.endedAt ?? now;
  return (
    <details className={busy ? "chat-process is-live" : "chat-process"} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span className="chat-process-state" aria-hidden="true">{busy ? <i /> : <Icon name="check" size={11} />}</span>
        <strong>{busy ? t(active?.label ?? "aiStagePrepare", locale) : t("aiProcessDone", locale)}</strong>
        <small>
          {busy
            ? `${Math.floor((now - process.startedAt) / 1000)}s`
            : t("aiProcessSummary", locale).replace("{count}", String(process.steps.length)).replace("{seconds}", ((end - process.startedAt) / 1000).toFixed(1))}
        </small>
        <span className="chat-process-chevron" aria-hidden="true"><Icon name="chevron-down" size={12} /></span>
      </summary>
      <ol className="chat-process-steps">
        {process.steps.map((step) => (
          <li key={step.id} className={`chat-process-step is-${step.status}`}>
            <i className="chat-process-mark" aria-hidden="true" />
            <div className="chat-process-body">
              <span className="chat-process-label">
                {t(step.label, locale)}
                {step.detail && <small>{step.detail}</small>}
              </span>
              {step.status === "active" && reasoning && (
                <details className="chat-process-reasoning" open>
                  <summary>{t("aiStageThinking", locale)}</summary>
                  <p className="chat-stream-text">{reasoning}</p>
                </details>
              )}
              {step.result && step.result.entries.length > 0 && (
                <details className="chat-process-entries">
                  <summary>{t("aiProcessShowEntries", locale).replace("{count}", String(step.result.entries.length))}</summary>
                  <ul className="chat-tool-items">
                    {step.result.entries.slice(0, 20).map((entry) => (
                      <li key={entry.id}>
                        <i style={{ background: entry.color }} aria-hidden="true" />
                        <span>
                          <strong>{entry.title}</strong>
                          <small>{entry.date}{entry.start ? ` · ${entry.start}` : ` · ${t("allDay", locale)}`}</small>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {step.result.entries.length > 20 && <p className="chat-tool-more">{t("aiToolMoreItems", locale).replace("{count}", String(step.result.entries.length - 20))}</p>}
                </details>
              )}
            </div>
            <time>{seconds(step.startedAt, step.endedAt ?? now)}</time>
          </li>
        ))}
      </ol>
    </details>
  );
}
