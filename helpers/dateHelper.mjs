// extractEmailTasks/helpers/dateHelper.mjs
// Wraps @jhauga/getDate to provide {{ dates.* }} placeholder values
// for use in task filter patterns via filterHelper.mjs.

import { getDate } from '@jhauga/getdate';

/**
 * Returns a map of all supported {{ dates.* }} placeholder keys to their
 * current values, resolved using @jhauga/getDate.
 *
 * Supported placeholders:
 *   {{ dates.year }}           Current 4-digit year         e.g. "2026"
 *   {{ dates.lastYear }}       Previous 4-digit year        e.g. "2025"
 *   {{ dates.nextYear }}       Next 4-digit year            e.g. "2027"
 *   {{ dates.month }}          Current month name           e.g. "March"
 *   {{ dates.lastMonth }}      Previous month name          e.g. "February"
 *   {{ dates.month.abbr }}     Abbreviated current month    e.g. "Mar"
 *   {{ dates.lastMonth.abbr }} Abbreviated previous month   e.g. "Feb"
 *   {{ dates.day }}            Current day of month         e.g. "03"
 *   {{ dates.quarter }}        Current quarter number       e.g. "1"
 *   {{ dates.lastQuarter }}    Previous quarter number      e.g. "4"
 *   {{ dates.year.short }}     2-digit current year         e.g. "26"
 *
 * @returns {Object.<string, string>}
 */
export function getDateValues() {
  // Base call: year, month, day, lastYear, lastMonth
  const base = getDate({ year: true, month: true, day: true, lastYear: true, lastMonth: true });

  // Independent options require separate calls (they bypass other options)
  const nextYearResult = getDate({ nextYear: true });
  const lastQuarterResult = getDate({ lastQuarter: true });
  const quarterResult = getDate({ quarter: true });

  // Abbreviated month names
  const abbrMonth = getDate({ month: true, abbreviated: true });
  const abbrLastMonth = getDate({ lastMonth: true, abbreviated: true });

  // 2-digit year
  const shortYear = getDate({ year: true, twoDigit: true });

  return {
    'dates.year':           String(base.year         || ''),
    'dates.lastYear':       String(base.lastYear      || ''),
    'dates.nextYear':       String(nextYearResult.nextYear  || ''),
    'dates.month':          String(base.month         || ''),
    'dates.lastMonth':      String(base.lastMonth     || ''),
    'dates.month.abbr':     String(abbrMonth.month    || ''),
    'dates.lastMonth.abbr': String(abbrLastMonth.lastMonth || ''),
    'dates.day':            String(base.day           || ''),
    'dates.quarter':        String(quarterResult.quarter    || ''),
    'dates.lastQuarter':    String(lastQuarterResult.lastQuarter || ''),
    'dates.year.short':     String(shortYear.year     || ''),
  };
}
