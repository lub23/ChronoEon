/**
 * Minimal ambient types for `lunar-javascript`, which ships plain JavaScript.
 * Only the members ChronoEon actually calls are declared, so an unexpected API
 * change surfaces as a type error rather than as silent `any` usage.
 */
declare module "lunar-javascript" {
  export interface LunarDate {
    getDayInChinese(): string;
    getMonthInChinese(): string;
    getFestivals(): string[];
  }

  export interface SolarDate {
    getLunar(): LunarDate;
    getFestivals(): string[];
  }

  export const Solar: {
    fromDate(date: Date): SolarDate;
  };

  export const Lunar: {
    fromDate(date: Date): LunarDate;
  };

  export const HolidayUtil: {
    getHolidays(year: number, month?: number): unknown[];
  };
}
