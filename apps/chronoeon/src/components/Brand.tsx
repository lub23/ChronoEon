import type { Locale } from "../domain/entry";
import { t } from "../i18n";

export function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <span className={small ? "brand-mark brand-mark--small" : "brand-mark"} aria-hidden="true">
      <img src="/app-icon.png" alt="" />
    </span>
  );
}

export function Brand({ locale, compact = false, dragRegion = false }: { locale: Locale; compact?: boolean; dragRegion?: boolean }) {
  return (
    <div className={compact ? "brand brand--compact" : "brand"} data-tauri-drag-region={dragRegion ? "true" : undefined}>
      <BrandMark small={compact} />
      <div className="brand-copy">
        <strong>{t("productName", locale)}</strong>
        {!compact && <span>{t("productTagline", locale)}</span>}
      </div>
    </div>
  );
}
