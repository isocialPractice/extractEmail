// Wraps @jhauga/getDate to provide {{ dates.* }} placeholder values
// for use in task filter patterns via filterHelper.

// @ts-ignore - third-party module has no bundled type definitions
import { getDate } from '@jhauga/getdate';

/**
 * Returns a map of all supported {{ dates.* }} placeholder keys to their
 * current values, resolved using @jhauga/getDate.
 */
export function getDateValues(): Record<string, string> {
  const base = getDate({ year: true, month: true, day: true, lastYear: true, lastMonth: true });

  const nextYearResult = getDate({ nextYear: true });
  const lastQuarterResult = getDate({ lastQuarter: true });
  const quarterResult = getDate({ quarter: true });

  const abbrMonth = getDate({ month: true, abbreviated: true });
  const abbrLastMonth = getDate({ lastMonth: true, abbreviated: true });

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
