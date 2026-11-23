import {
  AreaStatisticalSummary,
  ComputedStatisticalReport,
  DailyStatisticalRow,
  HOURLY_BRACKETS,
  HourlyStatisticalRow,
  LIBRARY_TIME_SLOTS,
  LibraryArea,
  MissingIntervalItem,
  MonthlyStatisticalRow,
  OccupancyRecord,
  ReportPeriodType,
  SlotStatisticalRow,
  TimeSlotDefinition,
} from '../types/lirc';
import { getTimeSlotsFromCache } from './timeSlots';
import {
  CalendarActivity,
  getClosedDaysOfWeekFromCache,
  isDateWholeDaySuspended,
  isSlotExcludedByCalendar,
} from './calendarActivities';

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const LITERARY_AREA_COLORS: Record<string, string> = {
  FIL: '#A83232',  // Primary Burgundy Red
  READ: '#2E5A44', // Reading Area (Forest Sage Green)
  REA: '#2E5A44',  // Reading Area alias
  CIR: '#71865A',  // Circulation (Sage Green)
  PER: '#E7B84B',  // Mustard Yellow
  LC: '#332F2B',   // Dark Charcoal
  DR: '#8F4B38',   // Warm Academic Terracotta
  REF: '#5A6E58',  // Deep Academic Sage
};

export function getLiteraryAreaColor(code?: string, fallbackHex?: string): string {
  if (code && LITERARY_AREA_COLORS[code.toUpperCase()]) {
    return LITERARY_AREA_COLORS[code.toUpperCase()];
  }
  return fallbackHex || '#A83232';
}

export function formatSlotLabel(slot: string, customSlots?: TimeSlotDefinition[]): string {
  const activeSlots = customSlots || getTimeSlotsFromCache();
  const found = activeSlots.find((s) => s.value === slot);
  return found ? found.label : slot;
}

export function formatSlotRangeLabel(slot: string, customSlots?: TimeSlotDefinition[]): string {
  if (!slot) return '—';
  const cleanSlot = slot.trim();
  const activeSlots = customSlots || getTimeSlotsFromCache();
  const found = activeSlots.find((s) => s.value === cleanSlot || s.label === cleanSlot);
  if (found) return found.rangeLabel;

  const match = cleanSlot.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    const h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const pad = (n: number) => String(n).padStart(2, '0');
    const startStr = `${pad(h)}:${pad(m)}`;
    const f = activeSlots.find((s) => s.value === startStr);
    if (f) return f.rangeLabel;

    let endH = h;
    let endM = m + 30;
    if (endM >= 60) {
      endH = (endH + 1) % 24;
      endM = endM - 60;
    }
    const fmt = (hr: number, min: number) => {
      const ampm = hr >= 12 ? 'PM' : 'AM';
      const hr12 = hr % 12 || 12;
      return `${hr12}:${pad(min)} ${ampm}`;
    };
    return `${fmt(h, m)} – ${fmt(endH, endM)}`;
  }

  return cleanSlot;
}

export function formatShortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dateObj = new Date(y, m - 1, d);
  return dateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatTimestampPHT(isoStr: string | null | undefined): string {
  if (!isoStr) return '—';
  const dt = new Date(isoStr);
  if (Number.isNaN(dt.getTime())) return isoStr;
  return dt.toLocaleString('en-US', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function getDayOfWeekName(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return '';
  const dateObj = new Date(y, m - 1, d);
  return dateObj.toLocaleDateString('en-US', { weekday: 'short' });
}

export function getMonthDateRange(year: number, month: number): { startDate: string; endDate: string } {
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  const dd = String(lastDay).padStart(2, '0');
  return {
    startDate: `${year}-${mm}-01`,
    endDate: `${year}-${mm}-${dd}`,
  };
}

export function getTodayPHT(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now);
}

export function getSlotEndMinutes(slot: string): number {
  const [h, m] = slot.split(':').map(Number);
  return (h || 0) * 60 + (m || 0) + 30;
}

export function getSlotEndTimeLabel(slot: string): string {
  const endMins = getSlotEndMinutes(slot);
  const h = Math.floor(endMins / 60);
  const m = endMins % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function isSlotCompleted(slot: string, totalMinutes: number): boolean {
  return totalMinutes >= getSlotEndMinutes(slot);
}

export function getLatestCompletedSlot(totalMinutes: number): string | null {
  if (totalMinutes < 510) return null; // Before 8:30 AM: no operating interval has completed
  const completedMins = Math.min(1050, (Math.floor(totalMinutes / 30) - 1) * 30);
  const ch = Math.floor(completedMins / 60);
  const cm = completedMins % 60;
  return `${String(ch).padStart(2, '0')}:${String(cm).padStart(2, '0')}`;
}

export function getCompletedSlotsUpTo(
  latestCompletedSlot: string | null,
  customSlots?: TimeSlotDefinition[]
): string[] {
  if (!latestCompletedSlot) return [];
  const activeSlots = customSlots && customSlots.length > 0 ? customSlots : getTimeSlotsFromCache();
  const idx = activeSlots.findIndex((s) => s.value === latestCompletedSlot);
  if (idx < 0) return [];
  return activeSlots.slice(0, idx + 1).map((s) => s.value);
}

/**
 * Determine which 30-minute intervals should already have been recorded for a given date.
 * - Past dates: all active slots (e.g. 8:00 AM - 6:00 PM)
 * - Future dates: 0 slots
 * - Today: ONLY intervals that have COMPLETED (e.g. 8:00 AM - 8:30 AM is only expected at 8:30 AM onwards).
 */
export function getExpectedSlotsForDate(
  dateStr: string,
  todayDateStr: string,
  currentSlotValue: string | null,
  isOperatingHours: boolean,
  customSlots?: TimeSlotDefinition[]
): string[] {
  const activeSlots = customSlots && customSlots.length > 0 ? customSlots : getTimeSlotsFromCache();

  if (dateStr > todayDateStr) return [];
  if (dateStr < todayDateStr) return activeSlots.map((s) => s.value);

  const now = new Date();
  const manilaParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const nowHour = Number(manilaParts.find((p) => p.type === 'hour')?.value ?? now.getHours());
  const nowMin = Number(manilaParts.find((p) => p.type === 'minute')?.value ?? now.getMinutes());
  const nowTotal = nowHour * 60 + nowMin;

  const firstSlotEnd = activeSlots.length > 0 ? getSlotEndMinutes(activeSlots[0].value) : 510;
  const lastSlotEnd = activeSlots.length > 0 ? getSlotEndMinutes(activeSlots[activeSlots.length - 1].value) : 1080;

  // For today: check if any operating interval has concluded
  if (nowTotal < firstSlotEnd) {
    // First 30-min interval is still underway, not completed yet
    return [];
  }
  if (nowTotal >= lastSlotEnd) {
    // All operating intervals have completed
    return activeSlots.map((s) => s.value);
  }

  // During operating hours: only slots that have finished are expected
  let effectiveCompleted = currentSlotValue;
  if (effectiveCompleted) {
    const endMins = getSlotEndMinutes(effectiveCompleted);
    // If the passed slot hasn't reached its conclusion time, use the latest completed slot
    if (nowTotal < endMins) {
      effectiveCompleted = getLatestCompletedSlot(nowTotal);
    }
  } else {
    effectiveCompleted = getLatestCompletedSlot(nowTotal);
  }

  if (!effectiveCompleted) return [];
  const idx = activeSlots.findIndex((s) => s.value === effectiveCompleted);
  return idx >= 0 ? activeSlots.slice(0, idx + 1).map((s) => s.value) : [];
}

/**
 * Enumerate operating dates (Mon–Sat) in [startDate, endDate] up to today,
 * OR any date that actually has records (including Sundays if logged).
 */
export function getOperatingDatesInRange(
  startDate: string,
  endDate: string,
  recordedDates: Set<string>,
  todayDateStr: string,
  closedDaysOfWeek?: number[]
): string[] {
  const dates = new Set<string>();
  recordedDates.forEach((d) => {
    if (d >= startDate && d <= endDate) dates.add(d);
  });

  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  if (!sy || !ey) return Array.from(dates).sort();

  const cur = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  const maxLoop = 400; // safety guard
  let count = 0;

  const activeClosedDays = closedDaysOfWeek ?? getClosedDaysOfWeekFromCache();

  while (cur <= end && count < maxLoop) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    const iso = `${y}-${m}-${d}`;
    const dow = cur.getDay(); // 0=Sun
    const isClosedWeekday = activeClosedDays.includes(dow);

    // Include Mon-Sat up to today (or if single-day mode, always include that date if <= today)
    // Exclude dates falling on temporarily closed weekdays in multi-day range
    if (iso <= todayDateStr && (dow !== 0 || startDate === endDate) && (!isClosedWeekday || startDate === endDate)) {
      dates.add(iso);
    }
    cur.setDate(cur.getDate() + 1);
    count++;
  }

  return Array.from(dates).sort();
}

/**
 * LIRC STAT Automated Statistical Computation Engine:
 * Supports Specific Date, Month, or Custom Date Range.
 * Computes:
 * 1. Overall recorded occupancy across all 6 library areas
 * 2. Area-level totals, averages, peaks, utilization & missing slots
 * 3. Hourly occupancy summaries (8-9 AM ... 5-6 PM)
 * 4. Daily occupancy totals matrix (Date x 6 Areas)
 * 5. Monthly occupancy totals (when applicable)
 * 6. 30-Minute time-slot distribution (20 slots)
 * 7. Missing occupancy records list
 */
export function computeStatisticalReport(params: {
  reportType: ReportPeriodType;
  startDate: string;
  endDate: string;
  areas: LibraryArea[];
  records: OccupancyRecord[];
  todayDate?: string;
  currentSlot?: string | null;
  isOperatingHours?: boolean;
  calendarActivities?: CalendarActivity[];
  closedDaysOfWeek?: number[];
  timeSlots?: TimeSlotDefinition[];
}): ComputedStatisticalReport {
  const {
    reportType,
    startDate,
    endDate,
    areas,
    records,
    todayDate = getTodayPHT(),
    currentSlot = null,
    isOperatingHours = false,
    calendarActivities = [],
    closedDaysOfWeek = getClosedDaysOfWeekFromCache(),
    timeSlots,
  } = params;

  const activeSlots = timeSlots && timeSlots.length > 0 ? timeSlots : getTimeSlotsFromCache();
  const sortedAreas = [...areas].sort((a, b) => a.display_order - b.display_order);

  // Build period label and title
  let periodLabel = `${formatShortDate(startDate)} – ${formatShortDate(endDate)}`;
  let reportTitle = `LIRC STAT Custom Period Statistical Report (${periodLabel})`;

  if (reportType === 'daily' || startDate === endDate) {
    periodLabel = `${formatShortDate(startDate)} (${getDayOfWeekName(startDate)})`;
    reportTitle = `LIRC STAT Daily Occupancy Statistical Report — ${periodLabel}`;
    const wholeDayCheck = isDateWholeDaySuspended(startDate, calendarActivities, closedDaysOfWeek);
    if (wholeDayCheck.isSuspended && wholeDayCheck.activity) {
      reportTitle += wholeDayCheck.isWeekdayClosed
        ? ` [${wholeDayCheck.activity.title}]`
        : ` [No Classes: ${wholeDayCheck.activity.title}]`;
    }
  } else if (reportType === 'monthly') {
    const [y, m] = startDate.split('-').map(Number);
    const monthName = MONTH_NAMES[(m || 1) - 1] || 'Month';
    periodLabel = `${monthName} ${y}`;
    reportTitle = `LIRC STAT Monthly Occupancy Statistical Report — ${periodLabel}`;
  }

  const recordedDates = new Set<string>();
  const existingKeySet = new Set<string>();
  for (const r of records) {
    recordedDates.add(r.record_date);
    existingKeySet.add(`${r.record_date}|${r.time_slot}|${r.area_id}`);
  }

  const rawOperatingDates = getOperatingDatesInRange(startDate, endDate, recordedDates, todayDate, closedDaysOfWeek);
  // Multi-day reports exclude entire days marked as No Classes or temporarily closed weekdays from the operating schedule
  const operatingDates = rawOperatingDates.filter((d) => {
    if (startDate === endDate) return true;
    const { isSuspended } = isDateWholeDaySuspended(d, calendarActivities, closedDaysOfWeek);
    return !isSuspended;
  });
  const totalOperatingDays = operatingDates.length;

  // Missing Intervals Detection
  const missingIntervals: MissingIntervalItem[] = [];
  const expectedByArea = new Map<number, number>();
  const expectedByDate = new Map<string, number>();
  sortedAreas.forEach((a) => expectedByArea.set(a.id, 0));

  for (const d of operatingDates) {
    const { isSuspended } = isDateWholeDaySuspended(d, calendarActivities, closedDaysOfWeek);
    // If the entire day is suspended or closed, 0 slots expected
    const rawExpectedSlots = isSuspended
      ? []
      : getExpectedSlotsForDate(d, todayDate, currentSlot, isOperatingHours, activeSlots);

    // Automatically exclude slots falling within suspended or closed periods
    const expectedSlots = rawExpectedSlots.filter((slotVal) => {
      const { isExcluded } = isSlotExcludedByCalendar(d, slotVal, calendarActivities, closedDaysOfWeek);
      return !isExcluded;
    });

    expectedByDate.set(d, expectedSlots.length * sortedAreas.length);

    for (const area of sortedAreas) {
      expectedByArea.set(area.id, (expectedByArea.get(area.id) || 0) + expectedSlots.length);
      for (const slotVal of expectedSlots) {
        if (!existingKeySet.has(`${d}|${slotVal}|${area.id}`)) {
          missingIntervals.push({
            date: d,
            formattedDate: formatShortDate(d),
            timeSlot: slotVal,
            timeSlotLabel: formatSlotRangeLabel(slotVal),
            areaId: area.id,
            areaName: area.name,
            areaCode: area.code,
            areaColor: getLiteraryAreaColor(area.code, area.color_hex),
          });
        }
      }
    }
  }

  // Sort missing intervals newest date first, then chronological slot
  missingIntervals.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    if (a.timeSlot !== b.timeSlot) return a.timeSlot.localeCompare(b.timeSlot);
    return a.areaName.localeCompare(b.areaName);
  });

  // Daily breakdown accumulator
  const dailyMap = new Map<string, DailyStatisticalRow>();
  for (const date of operatingDates) {
    const areaTotals: Record<number, number> = {};
    for (const area of sortedAreas) areaTotals[area.id] = 0;
    dailyMap.set(date, {
      date,
      formattedDate: formatShortDate(date),
      dayOfWeek: getDayOfWeekName(date),
      areaTotals,
      dailyTotal: 0,
      slotsRecorded: 0,
      expectedSlots: expectedByDate.get(date) || 0,
      missingSlots: expectedByDate.get(date) || 0,
    });
  }

  // Monthly breakdown accumulator
  const monthlyMap = new Map<
    string,
    {
      yearMonth: string;
      label: string;
      areaTotals: Record<number, number>;
      monthlyTotal: number;
      datesSet: Set<string>;
      slotsRecorded: number;
    }
  >();

  // Area accumulators
  const areaAccum = new Map<
    number,
    {
      totalOccupancy: number;
      recordedSlotsCount: number;
      peakCount: number;
      peakDate: string;
      peakSlot: string;
      datesActive: Set<string>;
    }
  >();
  for (const area of sortedAreas) {
    areaAccum.set(area.id, {
      totalOccupancy: 0,
      recordedSlotsCount: 0,
      peakCount: 0,
      peakDate: '—',
      peakSlot: '—',
      datesActive: new Set<string>(),
    });
  }

  // Hourly accumulators
  const hourAccum = new Map<
    string,
    {
      areaTotals: Record<number, number>;
      areaCounts: Record<number, number>;
      totalOccupancy: number;
      entriesCount: number;
    }
  >();
  for (const bracket of HOURLY_BRACKETS) {
    const areaTotals: Record<number, number> = {};
    const areaCounts: Record<number, number> = {};
    for (const area of sortedAreas) {
      areaTotals[area.id] = 0;
      areaCounts[area.id] = 0;
    }
    hourAccum.set(bracket.hourKey, {
      areaTotals,
      areaCounts,
      totalOccupancy: 0,
      entriesCount: 0,
    });
  }

  // 30-Min slot accumulators
  const slotAccum = new Map<
    string,
    {
      areaTotals: Record<number, number>;
      areaCounts: Record<number, number>;
      totalAcrossAreas: number;
      daysWithSlot: Set<string>;
    }
  >();
  for (const slotDef of activeSlots) {
    const areaTotals: Record<number, number> = {};
    const areaCounts: Record<number, number> = {};
    for (const area of sortedAreas) {
      areaTotals[area.id] = 0;
      areaCounts[area.id] = 0;
    }
    slotAccum.set(slotDef.value, {
      areaTotals,
      areaCounts,
      totalAcrossAreas: 0,
      daysWithSlot: new Set<string>(),
    });
  }

  let overallTotal = 0;
  let correctedRecordsCount = 0;

  for (const rec of records) {
    // Automatically exclude records that fall on suspended dates, intervals, or closed weekdays
    const { isExcluded } = isSlotExcludedByCalendar(rec.record_date, rec.time_slot, calendarActivities, closedDaysOfWeek);
    if (isExcluded) {
      // Historical data remains preserved in the database, but excluded from statistical computations
      continue;
    }

    const count = Number(rec.occupancy_count) || 0;
    overallTotal += count;
    if (rec.is_corrected) correctedRecordsCount++;

    // Daily update
    const dRow = dailyMap.get(rec.record_date);
    if (dRow) {
      dRow.areaTotals[rec.area_id] = (dRow.areaTotals[rec.area_id] || 0) + count;
      dRow.dailyTotal += count;
      dRow.slotsRecorded += 1;
      dRow.missingSlots = Math.max(0, dRow.expectedSlots - dRow.slotsRecorded);
    }

    // Monthly update
    const ym = rec.record_date.slice(0, 7);
    if (!monthlyMap.has(ym)) {
      const [yy, mm] = ym.split('-').map(Number);
      const areaTotals: Record<number, number> = {};
      for (const area of sortedAreas) areaTotals[area.id] = 0;
      monthlyMap.set(ym, {
        yearMonth: ym,
        label: `${MONTH_NAMES[(mm || 1) - 1]} ${yy}`,
        areaTotals,
        monthlyTotal: 0,
        datesSet: new Set<string>(),
        slotsRecorded: 0,
      });
    }
    const mAcc = monthlyMap.get(ym)!;
    mAcc.areaTotals[rec.area_id] = (mAcc.areaTotals[rec.area_id] || 0) + count;
    mAcc.monthlyTotal += count;
    mAcc.datesSet.add(rec.record_date);
    mAcc.slotsRecorded += 1;

    // Area update
    const aAcc = areaAccum.get(rec.area_id);
    if (aAcc) {
      aAcc.totalOccupancy += count;
      aAcc.recordedSlotsCount += 1;
      aAcc.datesActive.add(rec.record_date);
      if (count > aAcc.peakCount) {
        aAcc.peakCount = count;
        aAcc.peakDate = formatShortDate(rec.record_date);
        aAcc.peakSlot = formatSlotLabel(rec.time_slot);
      }
    }

    // Hourly update
    const hourKey = rec.time_slot.slice(0, 2);
    const hAcc = hourAccum.get(hourKey);
    if (hAcc) {
      hAcc.areaTotals[rec.area_id] = (hAcc.areaTotals[rec.area_id] || 0) + count;
      hAcc.areaCounts[rec.area_id] = (hAcc.areaCounts[rec.area_id] || 0) + 1;
      hAcc.totalOccupancy += count;
      hAcc.entriesCount += 1;
    }

    // 30-min slot update
    const sAcc = slotAccum.get(rec.time_slot);
    if (sAcc) {
      sAcc.areaTotals[rec.area_id] = (sAcc.areaTotals[rec.area_id] || 0) + count;
      sAcc.areaCounts[rec.area_id] = (sAcc.areaCounts[rec.area_id] || 0) + 1;
      sAcc.totalAcrossAreas += count;
      sAcc.daysWithSlot.add(rec.record_date);
    }
  }

  const dailyBreakdown = Array.from(dailyMap.values());

  // Monthly breakdown finalized
  const monthlyBreakdown: MonthlyStatisticalRow[] = Array.from(monthlyMap.values())
    .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
    .map((m) => ({
      yearMonth: m.yearMonth,
      label: m.label,
      areaTotals: m.areaTotals,
      monthlyTotal: m.monthlyTotal,
      operatingDays: m.datesSet.size,
      dailyAverage: m.datesSet.size > 0 ? Math.round(m.monthlyTotal / m.datesSet.size) : 0,
      slotsRecorded: m.slotsRecorded,
    }));

  // Area summaries finalized
  const areaSummaries: AreaStatisticalSummary[] = sortedAreas.map((area) => {
    const acc = areaAccum.get(area.id)!;
    const expectedSlotsCount = expectedByArea.get(area.id) || 0;
    const missingSlotsCount = Math.max(0, expectedSlotsCount - acc.recordedSlotsCount);
    const daysCount = acc.datesActive.size || totalOperatingDays || 1;
    const dailyAverage = acc.datesActive.size > 0 ? Math.round(acc.totalOccupancy / daysCount) : 0;
    const slotAverage =
      acc.recordedSlotsCount > 0
        ? Number((acc.totalOccupancy / acc.recordedSlotsCount).toFixed(1))
        : 0;
    const sharePercent =
      overallTotal > 0 ? Number(((acc.totalOccupancy / overallTotal) * 100).toFixed(1)) : 0;
    const utilizationPercent =
      area.capacity > 0 && acc.recordedSlotsCount > 0
        ? Math.min(100, Math.round((slotAverage / area.capacity) * 100))
        : 0;
    const completionRate =
      expectedSlotsCount > 0
        ? Math.min(100, Math.round((acc.recordedSlotsCount / expectedSlotsCount) * 100))
        : 100;

    return {
      area: {
        ...area,
        color_hex: getLiteraryAreaColor(area.code, area.color_hex),
      },
      totalOccupancy: acc.totalOccupancy,
      dailyAverage,
      slotAverage,
      peakCount: acc.peakCount,
      peakDate: acc.peakDate,
      peakSlot: acc.peakSlot,
      recordedSlotsCount: acc.recordedSlotsCount,
      expectedSlotsCount,
      missingSlotsCount,
      completionRate,
      sharePercent,
      utilizationPercent,
    };
  });

  // Hourly breakdown finalized
  const hourlyBreakdown: HourlyStatisticalRow[] = HOURLY_BRACKETS.map((b) => {
    const acc = hourAccum.get(b.hourKey)!;
    const areaAverages: Record<number, number> = {};
    for (const area of sortedAreas) {
      const c = acc.areaCounts[area.id] || 0;
      areaAverages[area.id] = c > 0 ? Math.round(acc.areaTotals[area.id] / c) : 0;
    }
    return {
      hourKey: b.hourKey,
      label: b.label,
      shortLabel: b.shortLabel,
      areaTotals: acc.areaTotals,
      areaAverages,
      totalOccupancy: acc.totalOccupancy,
      averagePerSlot: acc.entriesCount > 0 ? Math.round(acc.totalOccupancy / acc.entriesCount) : 0,
      entriesCount: acc.entriesCount,
    };
  });

  // 30-min slot breakdown finalized
  const slotBreakdown: SlotStatisticalRow[] = activeSlots.map((slotDef) => {
    const acc = slotAccum.get(slotDef.value)!;
    const areaAverages: Record<number, number> = {};
    for (const area of sortedAreas) {
      const c = acc.areaCounts[area.id] || 0;
      areaAverages[area.id] = c > 0 ? Math.round(acc.areaTotals[area.id] / c) : 0;
    }
    const dayCount = acc.daysWithSlot.size || 1;
    return {
      slot: slotDef.value,
      label: slotDef.label,
      period: slotDef.period,
      areaTotals: acc.areaTotals,
      areaAverages,
      totalAcrossAreas: acc.totalAcrossAreas,
      averageAcrossDays: acc.daysWithSlot.size > 0 ? Math.round(acc.totalAcrossAreas / dayCount) : 0,
    };
  });

  // Peaks
  let peakDay: { date: string; formattedDate: string; total: number } | null = null;
  for (const dRow of dailyBreakdown) {
    if (dRow.dailyTotal > 0 && (!peakDay || dRow.dailyTotal > peakDay.total)) {
      peakDay = { date: dRow.date, formattedDate: dRow.formattedDate, total: dRow.dailyTotal };
    }
  }

  let peakArea: { areaName: string; total: number; sharePercent: number } | null = null;
  for (const aSum of areaSummaries) {
    if (aSum.totalOccupancy > 0 && (!peakArea || aSum.totalOccupancy > peakArea.total)) {
      peakArea = {
        areaName: aSum.area.name,
        total: aSum.totalOccupancy,
        sharePercent: aSum.sharePercent,
      };
    }
  }

  let peakHour: { label: string; total: number } | null = null;
  for (const hRow of hourlyBreakdown) {
    if (hRow.totalOccupancy > 0 && (!peakHour || hRow.totalOccupancy > peakHour.total)) {
      peakHour = { label: hRow.label, total: hRow.totalOccupancy };
    }
  }

  const expectedTotalSlots = Array.from(expectedByArea.values()).reduce((a, b) => a + b, 0);
  const missingSlotsCount = missingIntervals.length;
  const completionRate =
    expectedTotalSlots > 0
      ? Math.min(100, Math.round((records.length / expectedTotalSlots) * 100))
      : 100;
  const dailyAverageOccupancy =
    totalOperatingDays > 0 ? Math.round(overallTotal / totalOperatingDays) : 0;

  return {
    reportType,
    startDate,
    endDate,
    reportTitle,
    periodLabel,
    generatedAt: new Date().toLocaleString('en-US', {
      timeZone: 'Asia/Manila',
      dateStyle: 'medium',
      timeStyle: 'short',
    }),
    overallTotal,
    totalOperatingDays,
    totalSlotEntries: records.length,
    expectedTotalSlots,
    missingSlotsCount,
    completionRate,
    dailyAverageOccupancy,
    correctedRecordsCount,
    peakHour,
    peakDay,
    peakArea,
    areaSummaries,
    hourlyBreakdown,
    dailyBreakdown,
    monthlyBreakdown,
    slotBreakdown,
    missingIntervals,
    rawRecords: records,
  };
}
