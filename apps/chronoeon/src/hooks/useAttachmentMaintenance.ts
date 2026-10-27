import { useEffect, useRef } from "react";
import type { SyncStore } from "@chronoeon/storage";
import { isTauri } from "../platform/desktop";
import { pruneUnreferencedAttachments } from "../platform/attachments";

/** Run independently of sync. Recovery retains removed photos for seven days;
 * the additional file-age guard protects imports that have not yet been saved. */
export function useAttachmentMaintenance(journal: SyncStore | null, paused = false) {
  const pausedRef = useRef(paused); pausedRef.current = paused;
  useEffect(() => {
    if (!journal || !isTauri()) return;
    let disposed = false;
    let running = false;
    const collect = async () => {
      if (disposed || running || pausedRef.current) return;
      running = true;
      try {
        await journal.maintainAttachments(hashes => pruneUnreferencedAttachments(hashes, 24 * 60 * 60 * 1000, true));
      } catch (error) { console.warn("Attachment maintenance failed", error); }
      finally { running = false; }
    };
    const boot = setTimeout(() => void collect(), 30_000);
    const interval = setInterval(() => void collect(), 60 * 60 * 1000);
    return () => { disposed = true; clearTimeout(boot); clearInterval(interval); };
  }, [journal]);
}
