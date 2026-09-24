import { useEffect, useMemo, useRef, useState } from "react";
import { resolveAttachmentUrl } from "../platform/attachments";

/**
 * Resolve stored attachment references into displayable URLs, once each.
 *
 * Local attachment paths have to go through the validated native reader, so
 * resolution is asynchronous and cached for the lifetime of the app: a month
 * grid can reference the same photo from several entries, and re-reading it on
 * every render would put a file read in the paint path. Unreadable references
 * are cached as an empty string so a missing file is not retried per render.
 */
export function useAttachmentUrls(references: readonly string[]): Record<string, string> {
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const pending = useRef(new Set<string>());
  // The caller rebuilds its reference list on every render; keying the memo on
  // the joined references keeps the effect dependencies stable.
  const signature = references.join("\u0000");
  const list = useMemo(() => [...new Set(signature ? signature.split("\u0000") : [])], [signature]);

  useEffect(() => {
    const missing = list.filter((reference) => !(reference in resolved) && !pending.current.has(reference));
    if (!missing.length) return;
    let disposed = false;
    missing.forEach((reference) => pending.current.add(reference));
    void Promise.all(missing.map(async (reference) => {
      const url = await resolveAttachmentUrl(reference).catch(() => null);
      return [reference, url] as const;
    })).then((pairs) => {
      pairs.forEach(([reference]) => pending.current.delete(reference));
      if (disposed) return;
      setResolved((current) => {
        const next = { ...current };
        for (const [reference, url] of pairs) next[reference] = url ?? "";
        return next;
      });
    });
    return () => {
      disposed = true;
      // React StrictMode deliberately runs an effect setup/cleanup/setup cycle.
      // Releasing this attempt lets the second setup retry instead of seeing a
      // permanently "pending" URL whose first result was correctly discarded.
      missing.forEach((reference) => pending.current.delete(reference));
    };
  }, [list, resolved]);

  return resolved;
}
