import type { Locale } from "../../domain/entry";
import { localeTag } from "../../i18n";

export function formatMessageTime(value: string, locale: Locale): string {
  const date = new Date(value);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString(localeTag[locale], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleString(localeTag[locale], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}