import { useEffect, useState } from "react";
import { attachmentLabel, type Locale } from "@chronoeon/domain";
import { resolveAttachmentUrl } from "../platform/attachments";
import { t } from "../i18n";
import { Icon } from "./Icon";

interface AttachmentThumbProps {
  locale: Locale;
  reference: string;
}

/** One stored photo: resolves the local bytes lazily and shows a missing/loading state. */
export function AttachmentThumb({ locale, reference }: AttachmentThumbProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    setFailed(false);
    setUrl(null);
    void resolveAttachmentUrl(reference).then((resolved) => {
      if (disposed) return;
      setUrl(resolved);
      if (!resolved) setFailed(true);
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; };
  }, [reference]);

  const label = attachmentLabel(reference);
  if (failed) {
    return <span className="attachment-thumb is-missing" title={`${t("attachmentMissing", locale)} · ${label}`}><Icon name="image" size={18} /><small>{label}</small></span>;
  }
  return url
    ? <img className="attachment-thumb" src={url} alt={label} title={label} loading="lazy" />
    : <span className="attachment-thumb is-loading" aria-label={t("loading", locale)} />;
}
