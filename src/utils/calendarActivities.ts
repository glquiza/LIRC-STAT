import { SupabaseClient } from '@supabase/supabase-js';
import { UserProfile } from '../types/lirc';

export interface CalendarActivity {
  id: string;
  title: string;
  description: string;
  date: string; // YYYY-MM-DD
  isWholeDay: boolean; // true = Entire Day "No Classes", false = specific time range
  startTime: string; // 'HH:mm' e.g. '10:00' (when isWholeDay is false)
  endTime: string; // 'HH:mm' e.g. '12:00' (when isWholeDay is false)
  createdAt: string;
  createdBy: string;
  carrierId?: string; // If stored in Supabase user_profiles carrier record
}

export const CALENDAR_STORAGE_KEY = 'lirc_calendar_activities';
export const CALENDAR_DELETED_KEY = 'lirc_calendar_deleted_ids';
export const CLOSED_WEEKDAYS_STORAGE_KEY = 'lirc_calendar_closed_weekdays';
export const CALENDAR_CARRIER_PREFIX = 'CALENDAR_ACTIVITY::';
export const CALENDAR_STAFF_CODE_PREFIX = 'CAL_ACT::';
export const CALENDAR_BROADCAST_CHANNEL = 'lirc_calendar_realtime';
export const CALENDAR_REGISTRY_USERNAME = 'cal_master_registry';
export const CALENDAR_REGISTRY_FULL_NAME = 'CALENDAR_MASTER_REGISTRY';
export const CALENDAR_REGISTRY_STAFF_CODE = 'CAL_REGISTRY';

export interface ClosedWeekdayInfo {
  dayOfWeek: number; // 0=Sun, 1=Mon, ..., 6=Sat
  name: string;
  short: string;
}

export const OPERATING_WEEKDAYS: ClosedWeekdayInfo[] = [
  { dayOfWeek: 1, name: 'Monday', short: 'Mon' },
  { dayOfWeek: 2, name: 'Tuesday', short: 'Tue' },
  { dayOfWeek: 3, name: 'Wednesday', short: 'Wed' },
  { dayOfWeek: 4, name: 'Thursday', short: 'Thu' },
  { dayOfWeek: 5, name: 'Friday', short: 'Fri' },
  { dayOfWeek: 6, name: 'Saturday', short: 'Sat' },
];

export const DAY_OF_WEEK_NAMES: Record<number, string> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

export function getClosedDaysOfWeekFromCache(): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CLOSED_WEEKDAYS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(Number).filter((n) => !isNaN(n) && n >= 0 && n <= 6);
      }
    }
  } catch {
    // ignore
  }
  return [];
}

export function syncClosedDaysLocalStorage(days: number[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CLOSED_WEEKDAYS_STORAGE_KEY, JSON.stringify(days));
  } catch {
    // ignore
  }
}

export function isDayOfWeekClosed(dateStr: string, closedDaysOfWeek?: number[]): boolean {
  const days = closedDaysOfWeek ?? getClosedDaysOfWeekFromCache();
  if (!days || days.length === 0) return false;
  if (!dateStr || !dateStr.includes('-')) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return false;
  const dow = new Date(y, m - 1, d).getDay();
  return days.includes(dow);
}

const INITIAL_DELETED_BLACKLIST = [
  'ecf2d51c-da33-45cd-a4b9-13e8429ec5f7',
  'cf75e302-68c0-4e9c-b283-8a08d746af1c',
  'cal_1795107784200',
  'cal_1795106364083',
  'trst::2026-11-20',
  'test::2026-11-27',
  'trst',
  'test',
];

/**
 * Broadcasts a calendar update or deletion across all active browser tabs/windows.
 */
export function broadcastCalendarChange(type: 'UPDATE' | 'DELETE', payload?: any) {
  if (typeof window === 'undefined') return;
  try {
    const bc = new BroadcastChannel(CALENDAR_BROADCAST_CHANNEL);
    bc.postMessage({ type, payload, timestamp: Date.now() });
    bc.close();
  } catch {
    // ignore if unsupported
  }
}

/**
 * Subscribes to real-time calendar updates across:
 * 1. Supabase Postgres Realtime (WebSockets on `calendar_activities` and `user_profiles`)
 * 2. Cross-tab BroadcastChannel (instant < 5ms sync across tabs)
 * 3. Browser StorageEvent (synchronizing local cache changes)
 * 4. Window Focus event (re-sync when switching back into the application)
 */
export function subscribeToCalendarChanges(
  supabase: SupabaseClient,
  onChange: (activities: CalendarActivity[], closedDays?: number[]) => void
): () => void {
  let isMounted = true;

  const refresh = async () => {
    if (!isMounted) return;
    try {
      const [fresh, freshClosed] = await Promise.all([
        fetchCalendarActivities(supabase),
        fetchClosedDaysOfWeek(supabase),
      ]);
      if (!isMounted) return;
      onChange(fresh, freshClosed);
    } catch {
      // ignore
    }
  };

  // 1. Supabase Postgres Realtime channel
  const channel = supabase
    .channel(`calendar-sync-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'calendar_activities' },
      () => {
        refresh();
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'calendar_closed_weekdays' },
      () => {
        refresh();
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_profiles' },
      () => {
        refresh();
      }
    )
    .subscribe();

  // 2. Cross-tab BroadcastChannel
  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel(CALENDAR_BROADCAST_CHANNEL);
    bc.onmessage = () => {
      refresh();
    };
  } catch {
    // ignore
  }

  // 3. Storage event listener (fires in other tabs of same origin)
  const handleStorage = (e: StorageEvent) => {
    if (
      e.key === CALENDAR_STORAGE_KEY ||
      e.key === CALENDAR_DELETED_KEY ||
      e.key === CLOSED_WEEKDAYS_STORAGE_KEY
    ) {
      refresh();
    }
  };
  window.addEventListener('storage', handleStorage);

  // 4. Window focus listener (re-sync whenever user switches back to this tab)
  const handleFocus = () => {
    refresh();
  };
  window.addEventListener('focus', handleFocus);

  return () => {
    isMounted = false;
    supabase.removeChannel(channel);
    bc?.close();
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener('focus', handleFocus);
  };
}

/**
 * Returns set of deleted activity identifiers from local storage cache.
 */
export function getDeletedActivityKeys(): Set<string> {
  const set = new Set<string>();
  INITIAL_DELETED_BLACKLIST.forEach((k) => set.add(k.trim().toLowerCase()));
  if (typeof window === 'undefined') return set;
  try {
    const raw = localStorage.getItem(CALENDAR_DELETED_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        arr.forEach((k: string) => {
          if (k && typeof k === 'string') set.add(k.trim().toLowerCase());
        });
      }
    }
  } catch {
    // ignore
  }
  return set;
}

/**
 * Records deleted activity identifiers into local storage to prevent unwanted resurrection.
 */
export function recordDeletedActivityKey(...keys: (string | undefined | null)[]) {
  if (typeof window === 'undefined') return;
  try {
    const current = getDeletedActivityKeys();
    keys.forEach((k) => {
      if (k && typeof k === 'string' && k.trim()) {
        current.add(k.trim().toLowerCase());
      }
    });
    localStorage.setItem(CALENDAR_DELETED_KEY, JSON.stringify(Array.from(current)));
  } catch {
    // ignore
  }
}

/**
 * Un-registers a deleted key if an activity with that identifier is deliberately re-created.
 */
export function unrecordDeletedActivityKey(...keys: (string | undefined | null)[]) {
  if (typeof window === 'undefined') return;
  try {
    const current = getDeletedActivityKeys();
    keys.forEach((k) => {
      if (k && typeof k === 'string' && k.trim()) {
        current.delete(k.trim().toLowerCase());
      }
    });
    localStorage.setItem(CALENDAR_DELETED_KEY, JSON.stringify(Array.from(current)));
  } catch {
    // ignore
  }
}

/**
 * Checks whether a given YYYY-MM-DD date string is a Sunday.
 * Sundays are non-working days for the library (no classes, operations, or student assistant duties).
 */
export function isSundayDate(dateStr: string): boolean {
  if (!dateStr || !dateStr.includes('-')) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return false;
  return new Date(y, m - 1, d).getDay() === 0;
}

// Pre-seeded starter activities for realistic academic planning
export const INITIAL_CALENDAR_ACTIVITIES: CalendarActivity[] = [
  {
    id: 'cal_seed_001',
    title: 'University Convocation & Academic Assembly',
    description: 'Morning university-wide academic assembly. Classes suspended from 10:00 AM to 12:00 PM.',
    date: '2026-11-20',
    isWholeDay: false,
    startTime: '10:00',
    endTime: '12:00',
    createdAt: new Date().toISOString(),
    createdBy: 'Dr. Elena M. Santos (Chief Librarian)',
  },
  {
    id: 'cal_seed_002',
    title: 'National Bonifacio Day (Official Holiday)',
    description: 'Regular national holiday — no classes and administrative offices closed.',
    date: '2026-11-30',
    isWholeDay: true,
    startTime: '08:00',
    endTime: '18:00',
    createdAt: new Date().toISOString(),
    createdBy: 'Dr. Elena M. Santos (Chief Librarian)',
  },
];

/**
 * Checks whether an entire date is marked as "No Classes" / whole-day suspension or temporarily closed weekday.
 */
export function isDateWholeDaySuspended(
  date: string,
  activities: CalendarActivity[],
  closedDaysOfWeek?: number[]
): { isSuspended: boolean; activity?: CalendarActivity; isWeekdayClosed?: boolean; weekdayName?: string } {
  // Check recurring weekday temporary closures first
  const activeClosedDays = closedDaysOfWeek ?? getClosedDaysOfWeekFromCache();
  if (isDayOfWeekClosed(date, activeClosedDays)) {
    const [y, m, d] = date.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    const dayName = DAY_OF_WEEK_NAMES[dow] || 'Weekday';
    return {
      isSuspended: true,
      isWeekdayClosed: true,
      weekdayName: dayName,
      activity: {
        id: `closed_dow_${dow}`,
        title: `Temporarily Closed (Every ${dayName})`,
        description: `Library operations and statistics for every ${dayName} are temporarily suspended by the Admin.`,
        date,
        isWholeDay: true,
        startTime: '08:00',
        endTime: '18:00',
        createdAt: new Date().toISOString(),
        createdBy: 'Library Administration',
      },
    };
  }

  for (const act of activities) {
    if (act.date === date && act.isWholeDay) {
      return { isSuspended: true, activity: act };
    }
  }
  return { isSuspended: false };
}

/**
 * Checks whether a 30-minute interval on a given date is excluded by calendar suspension or weekday closure.
 * Time slots are e.g. '10:00', '10:30', '11:00', '11:30' representing 30-min windows.
 */
export function isSlotExcludedByCalendar(
  date: string,
  slotVal: string,
  activities: CalendarActivity[],
  closedDaysOfWeek?: number[]
): { isExcluded: boolean; activity?: CalendarActivity; isWeekdayClosed?: boolean } {
  const activeClosedDays = closedDaysOfWeek ?? getClosedDaysOfWeekFromCache();
  if (isDayOfWeekClosed(date, activeClosedDays)) {
    const [y, m, d] = date.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    const dayName = DAY_OF_WEEK_NAMES[dow] || 'Weekday';
    return {
      isExcluded: true,
      isWeekdayClosed: true,
      activity: {
        id: `closed_dow_${dow}`,
        title: `Temporarily Closed (Every ${dayName})`,
        description: `Library operations and statistics for every ${dayName} are temporarily suspended by the Admin.`,
        date,
        isWholeDay: true,
        startTime: '08:00',
        endTime: '18:00',
        createdAt: new Date().toISOString(),
        createdBy: 'Library Administration',
      },
    };
  }

  for (const act of activities) {
    if (act.date !== date) continue;
    if (act.isWholeDay) {
      return { isExcluded: true, activity: act };
    }
    const start = act.startTime || '08:00';
    const end = act.endTime || '18:00';
    // Interval [slotVal, next30) falls within excluded [start, end)
    if (slotVal >= start && slotVal < end) {
      return { isExcluded: true, activity: act };
    }
  }
  return { isExcluded: false };
}

/**
 * Returns list of excluded 30-minute interval slots for a given date.
 */
export function getExcludedSlotsForDate(
  date: string,
  activities: CalendarActivity[],
  closedDaysOfWeek?: number[]
): string[] {
  const activeClosedDays = closedDaysOfWeek ?? getClosedDaysOfWeekFromCache();
  if (isDayOfWeekClosed(date, activeClosedDays)) {
    // All 20 standard slots are excluded on temporarily closed weekdays
    return [
      '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
      '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
      '16:00', '16:30', '17:00', '17:30',
    ];
  }

  const matching = activities.filter((a) => a.date === date);
  if (matching.length === 0) return [];

  const wholeDay = matching.find((a) => a.isWholeDay);
  if (wholeDay) {
    // All 20 standard slots are excluded
    return [
      '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
      '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
      '16:00', '16:30', '17:00', '17:30',
    ];
  }

  const excluded = new Set<string>();
  const ALL_SLOTS = [
    '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
    '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
    '16:00', '16:30', '17:00', '17:30',
  ];

  for (const act of matching) {
    const s = act.startTime || '08:00';
    const e = act.endTime || '18:00';
    for (const slot of ALL_SLOTS) {
      if (slot >= s && slot < e) {
        excluded.add(slot);
      }
    }
  }

  return Array.from(excluded).sort();
}

/**
 * Returns human-readable time range string for a calendar activity.
 */
export function formatActivityTimeRange(activity: CalendarActivity): string {
  if (activity.isWholeDay) {
    return 'Whole Day (All Hours Excluded)';
  }
  const formatTime = (hhmm: string) => {
    const [hStr, mStr] = hhmm.split(':');
    let h = parseInt(hStr, 10);
    const m = mStr || '00';
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ampm}`;
  };
  return `${formatTime(activity.startTime)} – ${formatTime(activity.endTime)}`;
}

/**
 * Parse an activity from a Supabase user_profiles carrier record if present.
 */
export function parseCarrierCalendarActivity(row: {
  id: string;
  full_name: string;
  staff_code: string;
  shift_schedule: string;
}): CalendarActivity | null {
  if (!row.full_name.startsWith(CALENDAR_CARRIER_PREFIX) && !row.staff_code.startsWith(CALENDAR_STAFF_CODE_PREFIX)) {
    return null;
  }

  // Deactivated or removed carrier records must never be parsed as active activities
  if (
    row.shift_schedule === 'REMOVED' ||
    row.full_name.startsWith('REMOVED_') ||
    row.staff_code === 'REMOVED' ||
    row.staff_code.startsWith('REMOVED_')
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(row.shift_schedule);
    if (parsed && parsed.title && parsed.date) {
      return {
        id: parsed.id || `cal_${row.id}`,
        carrierId: row.id,
        title: parsed.title,
        description: parsed.description || '',
        date: parsed.date,
        isWholeDay: Boolean(parsed.isWholeDay),
        startTime: parsed.startTime || '08:00',
        endTime: parsed.endTime || '18:00',
        createdAt: parsed.createdAt || new Date().toISOString(),
        createdBy: parsed.createdBy || 'Librarian',
      };
    }
  } catch {
    // Fallback if not JSON
  }

  const title = row.full_name.replace(CALENDAR_CARRIER_PREFIX, '').trim();
  const parts = row.staff_code.split('::');
  const date = parts[1] || new Date().toISOString().slice(0, 10);
  const timeSpec = parts[2] || 'WHOLE';
  const isWholeDay = timeSpec === 'WHOLE';
  const [start, end] = timeSpec.includes('-') ? timeSpec.split('-') : ['08:00', '18:00'];

  return {
    id: `cal_${row.id}`,
    carrierId: row.id,
    title,
    description: '',
    date,
    isWholeDay,
    startTime: start || '08:00',
    endTime: end || '18:00',
    createdAt: new Date().toISOString(),
    createdBy: 'Librarian',
  };
}

/**
 * Fetch calendar activities from Supabase (checking native table first, then Master Registry, then directory carriers).
 * Supabase is the single source of truth: deleted items in the database are purged from local storage.
 */
export async function fetchCalendarActivities(supabase: SupabaseClient): Promise<CalendarActivity[]> {
  const deletedKeys = getDeletedActivityKeys();

  const isDeleted = (item: CalendarActivity) => {
    const t = (item.title || '').trim().toLowerCase();
    if (deletedKeys.has(item.id.toLowerCase())) return true;
    if (item.carrierId && deletedKeys.has(item.carrierId.toLowerCase())) return true;
    if (deletedKeys.has(t)) return true;
    const key = `${t}::${item.date}`;
    if (deletedKeys.has(key)) return true;
    return false;
  };

  // 1. Try querying Supabase public.calendar_activities table (if table exists)
  try {
    const { data, error } = await supabase
      .from('calendar_activities')
      .select('*')
      .order('activity_date', { ascending: false });

    if (!error && Array.isArray(data) && data.length > 0) {
      const itemsMap = new Map<string, CalendarActivity>();
      data.forEach((row: any) => {
        const item: CalendarActivity = {
          id: String(row.id),
          carrierId: String(row.id),
          title: row.title,
          description: row.description || '',
          date: row.activity_date,
          isWholeDay: Boolean(row.is_whole_day),
          startTime: row.start_time || '08:00',
          endTime: row.end_time || '18:00',
          createdAt: row.created_at || new Date().toISOString(),
          createdBy: row.created_by_name || 'Librarian',
        };
        if (!isDeleted(item)) {
          itemsMap.set(item.id, item);
        }
      });

      const res = Array.from(itemsMap.values()).sort((a, b) => b.date.localeCompare(a.date));
      syncLocalStorage(res);
      return res;
    }
  } catch {
    // Database table might not exist, proceed to directory registry
  }

  // 2. Query directory carriers in user_profiles via get_login_directory
  try {
    const { data: dirData, error: dirError } = await supabase.rpc('get_login_directory');
    if (!dirError && Array.isArray(dirData)) {
      // First check for Master Registry carrier
      const registryRow = dirData.find(
        (r: any) =>
          r.username === CALENDAR_REGISTRY_USERNAME ||
          r.full_name === CALENDAR_REGISTRY_FULL_NAME ||
          r.staff_code === CALENDAR_REGISTRY_STAFF_CODE
      );

      if (registryRow && registryRow.shift_schedule && registryRow.shift_schedule !== 'REMOVED') {
        try {
          const parsed = JSON.parse(registryRow.shift_schedule);
          if (parsed && Array.isArray(parsed.activities)) {
            if (Array.isArray(parsed.deletedKeys)) {
              recordDeletedActivityKey(...parsed.deletedKeys);
            }
            const currentDeleted = getDeletedActivityKeys();
            const cleanActs: CalendarActivity[] = parsed.activities.filter((a: CalendarActivity) => {
              const t = (a.title || '').trim().toLowerCase();
              if (currentDeleted.has(a.id.toLowerCase())) return false;
              if (a.carrierId && currentDeleted.has(a.carrierId.toLowerCase())) return false;
              if (currentDeleted.has(t)) return false;
              if (currentDeleted.has(`${t}::${a.date}`)) return false;
              return true;
            });
            cleanActs.sort((a, b) => b.date.localeCompare(a.date));
            syncLocalStorage(cleanActs);
            return cleanActs;
          }
        } catch {
          // ignore parse error and fall through
        }
      }

      // Fallback: parse individual carrier accounts in user_profiles
      const carrierMap = new Map<string, CalendarActivity>();
      dirData.forEach((row: any) => {
        const parsed = parseCarrierCalendarActivity({
          id: row.id,
          full_name: row.full_name || '',
          staff_code: row.staff_code || '',
          shift_schedule: row.shift_schedule || '',
        });
        if (parsed && !isDeleted(parsed)) {
          const duplicate = Array.from(carrierMap.values()).some(
            (a) =>
              a.title.trim().toLowerCase() === parsed.title.trim().toLowerCase() &&
              a.date === parsed.date
          );
          if (!duplicate) {
            carrierMap.set(parsed.id, parsed);
          }
        }
      });
      if (carrierMap.size > 0) {
        const res = Array.from(carrierMap.values()).sort((a, b) => b.date.localeCompare(a.date));
        syncLocalStorage(res);
        return res;
      }
    }
  } catch {
    // ignore
  }

  // 3. Fallback when network is completely offline: load from local storage
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem(CALENDAR_STORAGE_KEY);
      if (saved) {
        const arr = JSON.parse(saved) as CalendarActivity[];
        if (Array.isArray(arr) && arr.length > 0) {
          const offlineList = arr.filter((a) => !isDeleted(a));
          return offlineList.sort((a, b) => b.date.localeCompare(a.date));
        }
      }
    } catch {
      // ignore
    }
  }

  // 4. Initial default seeds if everything else is empty
  const initial = INITIAL_CALENDAR_ACTIVITIES.filter((a) => !isDeleted(a));
  syncLocalStorage(initial);
  return initial;
}

/**
 * Persist a new or edited calendar activity to Supabase and local storage.
 */
export async function persistCalendarActivity(
  supabase: SupabaseClient,
  activity: CalendarActivity,
  actor: UserProfile
): Promise<CalendarActivity> {
  if (isSundayDate(activity.date)) {
    throw new Error('Cannot assign a suspension on a Sunday because Sundays are regular non-working days (library closed).');
  }

  let savedItem = { ...activity };

  // Un-record from deleted keys if re-creating or editing
  unrecordDeletedActivityKey(
    activity.id,
    activity.carrierId,
    activity.title.trim().toLowerCase(),
    `${activity.title.trim().toLowerCase()}::${activity.date}`
  );

  // 1. Try native table insert/update if exists
  try {
    const tablePayload = {
      title: activity.title,
      description: activity.description || '',
      activity_date: activity.date,
      is_whole_day: activity.isWholeDay,
      start_time: activity.isWholeDay ? '08:00' : activity.startTime,
      end_time: activity.isWholeDay ? '18:00' : activity.endTime,
      created_by: actor.id,
      created_by_name: actor.full_name,
    };

    if (activity.carrierId && !activity.carrierId.startsWith('cal_')) {
      const { data, error } = await supabase
        .from('calendar_activities')
        .update(tablePayload)
        .eq('id', activity.carrierId)
        .select()
        .single();
      if (!error && data) {
        savedItem.carrierId = String(data.id);
      }
    } else {
      const { data, error } = await supabase
        .from('calendar_activities')
        .insert(tablePayload)
        .select()
        .single();
      if (!error && data) {
        savedItem.id = String(data.id);
        savedItem.carrierId = String(data.id);
      }
    }
  } catch {
    // Fall back to carrier in user_profiles
  }

  // 2. Update local storage cache
  let updatedList: CalendarActivity[] = [];
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem(CALENDAR_STORAGE_KEY);
      const list: CalendarActivity[] = saved ? JSON.parse(saved) : [];
      const idx = list.findIndex((a) => a.id === savedItem.id);
      if (idx >= 0) {
        list[idx] = savedItem;
      } else {
        list.unshift(savedItem);
      }
      updatedList = list.sort((a, b) => b.date.localeCompare(a.date));
      syncLocalStorage(updatedList);
    } catch {
      updatedList = [savedItem];
    }
  } else {
    updatedList = [savedItem];
  }

  // 3. Sync to Master Registry Carrier in user_profiles
  try {
    const { data: dirData } = await supabase.rpc('get_login_directory');
    const registryRow = Array.isArray(dirData)
      ? dirData.find(
          (r: any) =>
            r.username === CALENDAR_REGISTRY_USERNAME ||
            r.full_name === CALENDAR_REGISTRY_FULL_NAME ||
            r.staff_code === CALENDAR_REGISTRY_STAFF_CODE
        )
      : null;

    const registryPayload = JSON.stringify({
      activities: updatedList,
      deletedKeys: Array.from(getDeletedActivityKeys()),
      closedDaysOfWeek: getClosedDaysOfWeekFromCache(),
      updatedAt: new Date().toISOString(),
    });

    if (registryRow) {
      await supabase.rpc('admin_update_staff_account', {
        p_user_id: registryRow.id,
        p_full_name: CALENDAR_REGISTRY_FULL_NAME,
        p_username: CALENDAR_REGISTRY_USERNAME,
        p_staff_code: CALENDAR_REGISTRY_STAFF_CODE,
        p_role: 'student_assistant',
        p_assigned_area_id: null,
        p_shift_schedule: registryPayload,
        p_is_active: true,
        p_new_password: null,
      });
    } else {
      await supabase.rpc('admin_create_staff_account', {
        p_email: 'cal_registry@lirc.local',
        p_username: CALENDAR_REGISTRY_USERNAME,
        p_password: 'Password123!',
        p_full_name: CALENDAR_REGISTRY_FULL_NAME,
        p_staff_code: CALENDAR_REGISTRY_STAFF_CODE,
        p_role: 'student_assistant',
        p_assigned_area_id: null,
        p_shift_schedule: registryPayload,
      });
    }
  } catch {
    // ignore
  }

  // 4. Also maintain individual carrier profile in user_profiles
  try {
    const carrierPayload = JSON.stringify({
      id: savedItem.id,
      title: savedItem.title,
      description: savedItem.description,
      date: savedItem.date,
      isWholeDay: savedItem.isWholeDay,
      startTime: savedItem.startTime,
      endTime: savedItem.endTime,
      createdBy: actor.full_name,
      createdAt: savedItem.createdAt,
    });

    const timeCode = savedItem.isWholeDay ? 'WHOLE' : `${savedItem.startTime}-${savedItem.endTime}`;
    const staffCode = `${CALENDAR_STAFF_CODE_PREFIX}${savedItem.date}::${timeCode}`;
    const fullName = `${CALENDAR_CARRIER_PREFIX}${savedItem.title.slice(0, 80)}`;

    if (savedItem.carrierId && !savedItem.carrierId.startsWith('cal_')) {
      await supabase.rpc('admin_update_staff_account', {
        p_user_id: savedItem.carrierId,
        p_full_name: fullName,
        p_username: `cal_${savedItem.carrierId.replace(/-/g, '').slice(0, 8)}`,
        p_staff_code: staffCode,
        p_role: 'student_assistant',
        p_assigned_area_id: null,
        p_shift_schedule: carrierPayload,
        p_is_active: true,
        p_new_password: null,
      });
    } else {
      const cleanKey = savedItem.id.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
      const { data: newUid, error: createErr } = await supabase.rpc('admin_create_staff_account', {
        p_email: `cal_${cleanKey}@lirc.local`,
        p_username: `cal_${cleanKey}`,
        p_password: 'Password123!',
        p_full_name: fullName,
        p_staff_code: staffCode,
        p_role: 'student_assistant',
        p_assigned_area_id: null,
        p_shift_schedule: carrierPayload,
      });
      if (!createErr && newUid) {
        savedItem.carrierId = newUid;
      }
    }
  } catch {
    // carrier fallback
  }

  // 5. Broadcast real-time change across tabs and windows
  broadcastCalendarChange('UPDATE', savedItem);

  return savedItem;
}

/**
 * Thoroughly removes a calendar activity entry across all persistence layers:
 * 1. Master Registry Carrier in `public.user_profiles` (instantly updates all clients via Realtime)
 * 2. Deactivates individual carrier accounts in `public.user_profiles`
 * 3. Native Supabase table `public.calendar_activities`
 * 4. Deleted identifiers blacklist in local storage (prevents auto-reseed or carrier resurrection)
 * 5. Local storage activity cache
 * 6. Cross-tab BroadcastChannel for instant < 5ms sync
 */
export async function removeCalendarActivity(
  supabase: SupabaseClient,
  activityOrId: CalendarActivity | string,
  maybeCarrierId?: string,
  maybeTitle?: string,
  maybeDate?: string
): Promise<void> {
  let id = '';
  let carrierId: string | undefined = undefined;
  let title = '';
  let date = '';

  if (typeof activityOrId === 'object' && activityOrId !== null) {
    id = activityOrId.id || '';
    carrierId = activityOrId.carrierId;
    title = activityOrId.title || '';
    date = activityOrId.date || '';
  } else {
    id = String(activityOrId);
    carrierId = maybeCarrierId;
    title = maybeTitle || '';
    date = maybeDate || '';
  }

  // If title or date are missing, resolve them from local storage cache
  if ((!title || !date) && typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem(CALENDAR_STORAGE_KEY);
      if (saved) {
        const list: CalendarActivity[] = JSON.parse(saved);
        const found = list.find((a) => a.id === id || (carrierId && a.carrierId === carrierId));
        if (found) {
          if (!title) title = found.title;
          if (!date) date = found.date;
          if (!carrierId) carrierId = found.carrierId;
        }
      }
    } catch {
      // ignore
    }
  }

  const titleLow = title.trim().toLowerCase();

  // 1. Record in deleted keys set so it never resurrects
  recordDeletedActivityKey(
    id,
    carrierId,
    titleLow,
    title && date ? `${titleLow}::${date}` : undefined
  );

  // 2. Remove from local storage cache immediately
  let remainingList: CalendarActivity[] = [];
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem(CALENDAR_STORAGE_KEY);
      if (saved) {
        const list: CalendarActivity[] = JSON.parse(saved);
        remainingList = list.filter((a) => {
          if (a.id === id) return false;
          if (carrierId && a.carrierId === carrierId) return false;
          if (
            title &&
            date &&
            a.title.trim().toLowerCase() === titleLow &&
            a.date === date
          ) {
            return false;
          }
          if (title && a.title.trim().toLowerCase() === titleLow) {
            return false;
          }
          return true;
        });
        syncLocalStorage(remainingList);
      }
    } catch {
      // ignore
    }
  }

  // 3. Update Master Registry Carrier in user_profiles (triggers Postgres change event for all clients)
  try {
    const { data: dirData } = await supabase.rpc('get_login_directory');
    const registryRow = Array.isArray(dirData)
      ? dirData.find(
          (r: any) =>
            r.username === CALENDAR_REGISTRY_USERNAME ||
            r.full_name === CALENDAR_REGISTRY_FULL_NAME ||
            r.staff_code === CALENDAR_REGISTRY_STAFF_CODE
        )
      : null;

    const registryPayload = JSON.stringify({
      activities: remainingList,
      deletedKeys: Array.from(getDeletedActivityKeys()),
      updatedAt: new Date().toISOString(),
    });

    if (registryRow) {
      await supabase.rpc('admin_update_staff_account', {
        p_user_id: registryRow.id,
        p_full_name: CALENDAR_REGISTRY_FULL_NAME,
        p_username: CALENDAR_REGISTRY_USERNAME,
        p_staff_code: CALENDAR_REGISTRY_STAFF_CODE,
        p_role: 'student_assistant',
        p_assigned_area_id: null,
        p_shift_schedule: registryPayload,
        p_is_active: true,
        p_new_password: null,
      });
    } else {
      await supabase.rpc('admin_create_staff_account', {
        p_email: 'cal_registry@lirc.local',
        p_username: CALENDAR_REGISTRY_USERNAME,
        p_password: 'Password123!',
        p_full_name: CALENDAR_REGISTRY_FULL_NAME,
        p_staff_code: CALENDAR_REGISTRY_STAFF_CODE,
        p_role: 'student_assistant',
        p_assigned_area_id: null,
        p_shift_schedule: registryPayload,
      });
    }
  } catch {
    // ignore
  }

  // 4. Remove from native table public.calendar_activities in Supabase (if exists)
  const uuidsToDelete = new Set<string>();
  if (carrierId && !carrierId.startsWith('cal_')) uuidsToDelete.add(carrierId);
  if (id && !id.startsWith('cal_')) uuidsToDelete.add(id);

  for (const uid of uuidsToDelete) {
    try {
      await supabase.from('calendar_activities').delete().eq('id', uid);
    } catch {
      // ignore
    }
  }

  if (title && date) {
    try {
      await supabase
        .from('calendar_activities')
        .delete()
        .match({ title, activity_date: date });
    } catch {
      // ignore
    }
  }

  // 5. Deactivate matching individual carriers in user_profiles using get_login_directory
  try {
    const { data: dirData } = await supabase.rpc('get_login_directory');
    if (Array.isArray(dirData)) {
      for (const carrier of dirData) {
        if (
          carrier.username === CALENDAR_REGISTRY_USERNAME ||
          carrier.full_name === CALENDAR_REGISTRY_FULL_NAME
        ) {
          continue;
        }

        const isMatch =
          carrier.id === id ||
          carrier.id === carrierId ||
          (carrier.full_name && carrier.full_name.includes(title)) ||
          (carrier.shift_schedule && carrier.shift_schedule.includes(`"title":"${title}"`)) ||
          (titleLow && carrier.full_name?.toLowerCase().includes(`::${titleLow}`)) ||
          (titleLow && carrier.full_name?.toLowerCase().includes(titleLow)) ||
          (date && carrier.staff_code?.includes(date));

        if (isMatch) {
          recordDeletedActivityKey(carrier.id);
          try {
            await supabase.rpc('admin_update_staff_account', {
              p_user_id: carrier.id,
              p_full_name: `REMOVED_${Date.now()}`,
              p_username: `removed_${carrier.id.replace(/-/g, '').slice(0, 8)}_${Date.now().toString().slice(-4)}`,
              p_staff_code: 'REMOVED',
              p_role: 'student_assistant',
              p_assigned_area_id: null,
              p_shift_schedule: 'REMOVED',
              p_is_active: false,
              p_new_password: null,
            });
          } catch {
            // ignore
          }
        }
      }
    }
  } catch {
    // ignore
  }

  // 6. Broadcast real-time change across tabs and windows
  broadcastCalendarChange('DELETE', { id, carrierId, title, date });
}

/**
 * Automatically purges legacy/blacklisted carriers from user_profiles if current user is a librarian.
 */
export async function cleanupBlacklistedCarriersIfLibrarian(supabase: SupabaseClient): Promise<void> {
  const deleted = getDeletedActivityKeys();
  try {
    const { data: dirData } = await supabase.rpc('get_login_directory');
    if (!Array.isArray(dirData)) return;

    for (const carrier of dirData) {
      if (
        carrier.username === CALENDAR_REGISTRY_USERNAME ||
        carrier.full_name === CALENDAR_REGISTRY_FULL_NAME
      ) {
        continue;
      }

      const isCarrier =
        carrier.full_name?.startsWith(CALENDAR_CARRIER_PREFIX) ||
        carrier.staff_code?.startsWith(CALENDAR_STAFF_CODE_PREFIX);

      if (!isCarrier) continue;

      const title = carrier.full_name?.replace(CALENDAR_CARRIER_PREFIX, '').trim().toLowerCase();
      const shouldPurge =
        deleted.has(carrier.id.toLowerCase()) ||
        (title && deleted.has(title)) ||
        title === 'trst' ||
        title === 'test';

      if (shouldPurge) {
        try {
          await supabase.rpc('admin_update_staff_account', {
            p_user_id: carrier.id,
            p_full_name: `REMOVED_${Date.now()}`,
            p_username: `removed_${carrier.id.replace(/-/g, '').slice(0, 8)}_${Date.now().toString().slice(-4)}`,
            p_staff_code: 'REMOVED',
            p_role: 'student_assistant',
            p_assigned_area_id: null,
            p_shift_schedule: 'REMOVED',
            p_is_active: false,
            p_new_password: null,
          });
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
}

function syncLocalStorage(activities: CalendarActivity[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(activities));
  } catch {
    // ignore
  }
}

/**
 * Fetches the currently closed days of the week (e.g. [1] for every Monday).
 * Priority: native table public.calendar_closed_weekdays -> carrier registry -> local storage
 */
export async function fetchClosedDaysOfWeek(supabase: SupabaseClient): Promise<number[]> {
  // 1. Try querying native table
  try {
    const { data, error } = await supabase
      .from('calendar_closed_weekdays')
      .select('day_of_week')
      .eq('is_closed', true);

    if (!error && Array.isArray(data)) {
      const days = data.map((r: any) => Number(r.day_of_week)).filter((n) => !isNaN(n) && n >= 0 && n <= 6);
      syncClosedDaysLocalStorage(days);
      return days;
    }
  } catch {
    // Table might not exist yet or network issue
  }

  // 2. Query master registry carrier in user_profiles
  try {
    const { data: dirData, error: dirError } = await supabase.rpc('get_login_directory');
    if (!dirError && Array.isArray(dirData)) {
      const registryRow = dirData.find(
        (r: any) =>
          r.username === CALENDAR_REGISTRY_USERNAME ||
          r.full_name === CALENDAR_REGISTRY_FULL_NAME ||
          r.staff_code === CALENDAR_REGISTRY_STAFF_CODE
      );

      if (registryRow && registryRow.shift_schedule && registryRow.shift_schedule !== 'REMOVED') {
        try {
          const parsed = JSON.parse(registryRow.shift_schedule);
          if (parsed && Array.isArray(parsed.closedDaysOfWeek)) {
            const days = parsed.closedDaysOfWeek.map(Number).filter((n: number) => !isNaN(n) && n >= 0 && n <= 6);
            syncClosedDaysLocalStorage(days);
            return days;
          }
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }

  // 3. Fallback to localStorage cache
  return getClosedDaysOfWeekFromCache();
}

/**
 * Temporarily close or reopen a specific recurring day of the week (e.g. day 1 = Monday).
 * When closed, all attendance data recorded on that day is automatically excluded from
 * statistical reports and calculations.
 */
export async function toggleClosedDayOfWeek(
  supabase: SupabaseClient,
  dayOfWeek: number,
  isClosed: boolean,
  actor: UserProfile,
  reason: string = ''
): Promise<number[]> {
  const dayName = DAY_OF_WEEK_NAMES[dayOfWeek] || `Day ${dayOfWeek}`;

  // 1. Calculate next list of closed days
  const currentDays = getClosedDaysOfWeekFromCache();
  const nextDays = isClosed
    ? Array.from(new Set([...currentDays, dayOfWeek])).sort((a, b) => a - b)
    : currentDays.filter((d) => d !== dayOfWeek).sort((a, b) => a - b);

  // 2. Optimistic local cache & cross-tab BroadcastChannel update
  syncClosedDaysLocalStorage(nextDays);
  broadcastCalendarChange('UPDATE', { closedDaysOfWeek: nextDays });

  // 3. Try stored procedure RPC toggle_calendar_closed_weekday
  let rpcSuccess = false;
  try {
    const { error } = await supabase.rpc('toggle_calendar_closed_weekday', {
      p_day_of_week: dayOfWeek,
      p_is_closed: isClosed,
      p_reason: reason || (isClosed ? `Temporarily closed by ${actor.full_name}` : `Reopened by ${actor.full_name}`),
    });
    if (!error) rpcSuccess = true;
  } catch {
    // ignore
  }

  // Fallback direct table upsert if RPC was not present
  if (!rpcSuccess) {
    try {
      await supabase.from('calendar_closed_weekdays').upsert({
        day_of_week: dayOfWeek,
        day_name: dayName,
        is_closed: isClosed,
        reason: reason || '',
        updated_at: new Date().toISOString(),
        updated_by: actor.id,
        updated_by_name: actor.full_name,
      });
    } catch {
      // ignore
    }
  }

  // 4. Synchronize to Master Registry Carrier in user_profiles
  try {
    const { data: dirData } = await supabase.rpc('get_login_directory');
    const registryRow = Array.isArray(dirData)
      ? dirData.find(
          (r: any) =>
            r.username === CALENDAR_REGISTRY_USERNAME ||
            r.full_name === CALENDAR_REGISTRY_FULL_NAME ||
            r.staff_code === CALENDAR_REGISTRY_STAFF_CODE
        )
      : null;

    let existingActivities: CalendarActivity[] = [];
    let existingDeleted: string[] = [];
    if (registryRow && registryRow.shift_schedule) {
      try {
        const p = JSON.parse(registryRow.shift_schedule);
        if (Array.isArray(p.activities)) existingActivities = p.activities;
        if (Array.isArray(p.deletedKeys)) existingDeleted = p.deletedKeys;
      } catch {
        // ignore
      }
    }

    const registryPayload = JSON.stringify({
      activities: existingActivities,
      deletedKeys: existingDeleted,
      closedDaysOfWeek: nextDays,
      updatedAt: new Date().toISOString(),
    });

    if (registryRow) {
      await supabase.rpc('admin_update_staff_account', {
        p_user_id: registryRow.id,
        p_full_name: CALENDAR_REGISTRY_FULL_NAME,
        p_username: CALENDAR_REGISTRY_USERNAME,
        p_staff_code: CALENDAR_REGISTRY_STAFF_CODE,
        p_role: 'student_assistant',
        p_assigned_area_id: null,
        p_shift_schedule: registryPayload,
        p_is_active: true,
        p_new_password: null,
      });
    }
  } catch {
    // ignore
  }

  return nextDays;
}
