import { memo } from "react";
import type { AiMessageRecord } from "@chronoeon/storage";
import type { Locale } from "../domain/entry";
import { t } from "../i18n";
import { Icon } from "./Icon";
import { renderChatMarkdown } from "./ChatMarkdown";
import { formatMessageTime } from "./chat/format";
import { MODE_ICONS, type ChatMode } from "./chat/mode";

interface ChatMessageRowProps {
  message: AiMessageRecord;
  mode: ChatMode;
  locale: Locale;
  copied: boolean;
  copyFailed: boolean;
  onCopy: (message: AiMessageRecord) => void;
  onOpenEntry: (entryId: string) => void;
}

/** A finished message never changes while the user types the next one. Keep the
 *  markdown parse and the whole bubble behind an identity check; the composer's
 *  draft state must not re-render every previous turn. */
export const ChatMessageRow = memo(function ChatMessageRow({ message, mode, locale, copied, copyFailed, onCopy, onOpenEntry }: ChatMessageRowProps) {
  return (
    <div className={`chat-message chat-message--${message.role}`}>
      <span className={message.role === "user" ? "chat-avatar is-user" : "chat-avatar is-assistant"} aria-hidden="true">
        <Icon name={message.role === "user" ? "day" : MODE_ICONS[mode]} size={13} />
      </span>
      <div className="chat-bubble">
        {message.reasoningContent && (
          <details className="chat-reasoning">
            <summary>{t("aiChatShowThinking", locale)}</summary>
            <div>{renderChatMarkdown(message.reasoningContent)}</div>
          </details>
        )}
        <div className="chat-rich">{renderChatMarkdown(message.content)}</div>
        <footer className="chat-meta">
          <time>{formatMessageTime(message.createdAt, locale)}</time>
          {message.role === "assistant" && (
            <>
              <button type="button" className="chat-meta-action" onClick={() => onCopy(message)}>
                <Icon name={copied ? "check" : "copy"} size={12} />
                {copied ? t("copied", locale) : t("copy", locale)}
              </button>
              {copyFailed && <span className="chat-copy-error">{t("aiCopyFailed", locale)}</span>}
              {message.proposedEntryId && (
                <button type="button" className="chat-meta-action is-accent" onClick={() => onOpenEntry(message.proposedEntryId!)}>
                  <Icon name="arrow-right" size={12} />{t("aiChatOpenEntry", locale)}
                </button>
              )}
            </>
          )}
        </footer>
      </div>
    </div>
  );
});