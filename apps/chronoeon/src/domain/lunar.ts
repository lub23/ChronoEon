import { HolidayUtil, Solar } from "lunar-javascript";
import type { Locale } from "./entry";

/** Shared lunar calculations. All platforms honor the same display preference. */

export interface LunarInfo {
  /** Lunar day, or the month name on the first day of a lunar month. */
  lunarDay: string;
  lunarMonth: string;
  lunarDateStr: string;
  lunarFestivals: string[];
  solarFestivals: string[];
  holidayName: string | null;
  /** True for a make-up working day (调休上班). */
  isWorkday: boolean;
  /** True when the date is an actual public holiday. */
  isHoliday: boolean;
}

const cache = new Map<string, LunarInfo | null>();

function isoOf(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function getLunarInfo(date: Date): LunarInfo | null {
  const key = isoOf(date);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  let info: LunarInfo | null = null;
  try {
    const solar = Solar.fromDate(date);
    const lunar = solar.getLunar();
    const lunarDay = lunar.getDayInChinese() as string;
    const lunarMonth = lunar.getMonthInChinese() as string;
    const lunarDateStr = `${lunarMonth}月${lunarDay}`;

    let holidayName: string | null = null;
    let isWorkday = false;
    try {
      const holidays = HolidayUtil.getHolidays(date.getFullYear(), date.getMonth() + 1);
      for (const holiday of holidays) {
        // lunar-javascript exposes each record through the undocumented `_p`
        // field; there is no day-keyed public lookup, so read it defensively.
        const record = (holiday as { _p?: { day?: string; name?: string; work?: boolean } })._p;
        if (record && record.day === key) {
          holidayName = record.name ?? null;
          isWorkday = Boolean(record.work);
          break;
        }
      }
    } catch {
      // The holiday table does not cover far-future years; ignore.
    }

    info = {
      lunarDay: lunarDay === "初一" ? lunarDateStr : lunarDay,
      lunarMonth,
      lunarDateStr,
      lunarFestivals: (lunar.getFestivals() as string[]) ?? [],
      solarFestivals: (solar.getFestivals() as string[]) ?? [],
      holidayName,
      isWorkday,
      isHoliday: Boolean(holidayName) && !isWorkday
    };
  } catch {
    info = null;
  }

  // Bounded so scrolling years of calendar never grows without limit.
  if (cache.size > 2_000) cache.clear();
  cache.set(key, info);
  return info;
}

/**
 * Short label for a calendar cell. Festivals win over holidays, which win over
 * the plain lunar day, so the densest information appears in limited space.
 */
export function lunarCellLabel(date: Date): string {
  const info = getLunarInfo(date);
  if (!info) return "";
  if (info.lunarFestivals.length > 0) return info.lunarFestivals[0];
  if (info.solarFestivals.length > 0) return info.solarFestivals[0];
  if (info.isHoliday && info.holidayName) return info.holidayName;
  return info.lunarDay;
}

/** Full accessible description, e.g. `腊月初十 · 春节`. */
export function lunarDescription(date: Date): string {
  const info = getLunarInfo(date);
  if (!info) return "";
  const extras = [...info.lunarFestivals, ...info.solarFestivals];
  if (info.holidayName) extras.push(info.isWorkday ? `${info.holidayName}（调休）` : info.holidayName);
  return [info.lunarDateStr, ...new Set(extras)].join(" · ");
}

export type LunarPreference = "auto" | "always" | "never";

/**
 * `auto` follows the interface language, which is what a Chinese-language user
 * expects without touching settings, while remaining overridable in both
 * directions.
 */
export function shouldShowLunar(preference: LunarPreference, locale: Locale): boolean {
  if (preference === "never") return false;
  if (preference === "always") return true;
  return locale === "zh";
}
