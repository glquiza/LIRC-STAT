import { SupabaseClient } from '@supabase/supabase-js';
import { TimeSlotDefinition, UserProfile } from '../types/lirc';

export const TIME_SLOTS_STORAGE_KEY = 'lirc_library_time_slots';
export const TIME_SLOTS_BROADCAST_CHANNEL = 'lirc_time_slots_realtime';

export const DEFAULT_LIBRARY_TIME_SLOTS: TimeSlotDefinition[] = [
  { value: '08:00', label: '8:00 AM', rangeLabel: '8:00 AM - 8:30 AM', hourKey: '08', hourLabel: '8:00 AM - 9:00 AM', period: 'Morning' },
  { value: '08:30', label: '8:30 AM', rangeLabel: '8:30 AM - 9:00 AM', hourKey: '08', hourLabel: '8:00 AM - 9:00 AM', period: 'Morning' },
  { value: '09:00', label: '9:00 AM', rangeLabel: '9:00 AM - 9:30 AM', hourKey: '09', hourLabel: '9:00 AM - 10:00 AM', period: 'Morning' },
  { value: '09:30', label: '9:30 AM', rangeLabel: '9:30 AM - 10:00 AM', hourKey: '09', hourLabel: '9:00 AM - 10:00 AM', period: 'Morning' },
  { value: '10:00', label: '10:00 AM', rangeLabel: '10:00 AM - 10:30 AM', hourKey: '10', hourLabel: '10:00 AM - 11:00 AM', period: 'Morning' },
  { value: '10:30', label: '10:30 AM', rangeLabel: '10:30 AM - 11:00 AM', hourKey: '10', hourLabel: '10:00 AM - 11:00 AM', period: 'Morning' },
  { value: '11:00', label: '11:00 AM', rangeLabel: '11:00 AM - 11:30 AM', hourKey: '11', hourLabel: '11:00 AM - 12:00 PM', period: 'Morning' },
  { value: '11:30', label: '11:30 AM', rangeLabel: '11:30 AM - 12:00 PM', hourKey: '11', hourLabel: '11:00 AM - 12:00 PM', period: 'Morning' },
  { value: '12:00', label: '12:00 PM', rangeLabel: '12:00 PM - 12:30 PM', hourKey: '12', hourLabel: '12:00 PM - 1:00 PM', period: 'Midday' },
  { value: '12:30', label: '12:30 PM', rangeLabel: '12:30 PM - 1:00 PM', hourKey: '12', hourLabel: '12:00 PM - 1:00 PM', period: 'Midday' },
  { value: '13:00', label: '1:00 PM', rangeLabel: '1:00 PM - 1:30 PM', hourKey: '13', hourLabel: '1:00 PM - 2:00 PM', period: 'Afternoon' },
  { value: '13:30', label: '1:30 PM', rangeLabel: '1:30 PM - 2:00 PM', hourKey: '13', hourLabel: '1:00 PM - 2:00 PM', period: 'Afternoon' },
  { value: '14:00', label: '2:00 PM', rangeLabel: '2:00 PM - 2:30 PM', hourKey: '14', hourLabel: '2:00 PM - 3:00 PM', period: 'Afternoon' },
  { value: '14:30', label: '2:30 PM', rangeLabel: '2:30 PM - 3:00 PM', hourKey: '14', hourLabel: '2:00 PM - 3:00 PM', period: 'Afternoon' },
  { value: '15:00', label: '3:00 PM', rangeLabel: '3:00 PM - 3:30 PM', hourKey: '15', hourLabel: '3:00 PM - 4:00 PM', period: 'Afternoon' },
  { value: '15:30', label: '3:30 PM', rangeLabel: '3:30 PM - 4:00 PM', hourKey: '15', hourLabel: '3:00 PM - 4:00 PM', period: 'Afternoon' },
  { value: '16:00', label: '4:00 PM', rangeLabel: '4:00 PM - 4:30 PM', hourKey: '16', hourLabel: '4:00 PM - 5:00 PM', period: 'Afternoon' },
  { value: '16:30', label: '4:30 PM', rangeLabel: '4:30 PM - 5:00 PM', hourKey: '16', hourLabel: '4:00 PM - 5:00 PM', period: 'Late Afternoon' },
  { value: '17:00', label: '5:00 PM', rangeLabel: '5:00 PM - 5:30 PM', hourKey: '17', hourLabel: '5:00 PM - 6:00 PM', period: 'Late Afternoon' },
  { value: '17:30', label: '5:30 PM', rangeLabel: '5:30 PM - 6:00 PM', hourKey: '17', hourLabel: '5:00 PM - 6:00 PM', period: 'Late Afternoon' },
];

let inMemorySlotsCache: TimeSlotDefinition[] = [...DEFAULT_LIBRARY_TIME_SLOTS];

/**
 * Format a 24-hour 'HH:mm' string to friendly 12-hour 'h:mm A'.
 */
export function formatTime12Hour(time24: string): string {
  if (!time24 || !time24.includes(':')) return time24 || '';
  const [hStr, mStr] = time24.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return time24;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  const displayMinute = m.toString().padStart(2, '0');
  return `${displayHour}:${displayMinute} ${ampm}`;
}

/**
 * Format range label, e.g. "8:00 AM - 8:30 AM"
 */
export function formatTimeRange(startTime: string, endTime: string): string {
  return `${formatTime12Hour(startTime)} - ${formatTime12Hour(endTime)}`;
}

/**
 * Determine operating period category based on start time hour.
 */
export function determinePeriod(startTime: string): 'Morning' | 'Midday' | 'Afternoon' | 'Late Afternoon' | 'Evening' {
  if (!startTime) return 'Morning';
  const hour = parseInt(startTime.split(':')[0], 10);
  if (isNaN(hour)) return 'Morning';
  if (hour < 12) return 'Morning';
  if (hour === 12) return 'Midday';
  if (hour >= 13 && hour < 16) return 'Afternoon';
  if (hour >= 16 && hour < 18) return 'Late Afternoon';
  return 'Evening';
}

/**
 * Generate full TimeSlotDefinition from start and end times.
 */
export function generateTimeSlotDef(startTime: string, endTime: string, customPeriod?: string): TimeSlotDefinition {
  const hourStr = startTime.split(':')[0] || '08';
  const hourNum = parseInt(hourStr, 10);
  const nextHourNum = (hourNum + 1) % 24;
  const hourStartFormatted = formatTime12Hour(`${hourNum.toString().padStart(2, '0')}:00`);
  const hourEndFormatted = formatTime12Hour(`${nextHourNum.toString().padStart(2, '0')}:00`);

  return {
    value: startTime,
    label: formatTime12Hour(startTime),
    rangeLabel: formatTimeRange(startTime, endTime),
    hourKey: hourStr.padStart(2, '0'),
    hourLabel: `${hourStartFormatted} - ${hourEndFormatted}`,
    period: (customPeriod as any) || determinePeriod(startTime),
  };
}

/**
 * Read time slots from local storage cache.
 */
export function getTimeSlotsFromCache(): TimeSlotDefinition[] {
  if (typeof window === 'undefined') return inMemorySlotsCache;
  try {
    const raw = localStorage.getItem(TIME_SLOTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const normalized = parsed.map((s) => ({
          ...s,
          rangeLabel: (s.rangeLabel || '').replace(/\s*–\s*/g, ' - '),
          hourLabel: (s.hourLabel || '').replace(/\s*–\s*/g, ' - '),
        }));
        inMemorySlotsCache = normalized;
        return normalized;
      }
    }
  } catch {
    // fallback to memory
  }
  return inMemorySlotsCache;
}

/**
 * Save time slots to local storage and update memory cache.
 */
export function syncTimeSlotsLocalStorage(slots: TimeSlotDefinition[]) {
  inMemorySlotsCache = slots;
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(TIME_SLOTS_STORAGE_KEY, JSON.stringify(slots));
  } catch {
    // ignore
  }
}

/**
 * Broadcast time slot update across tabs.
 */
function broadcastTimeSlots(slots: TimeSlotDefinition[]) {
  if (typeof window === 'undefined') return;
  try {
    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel(TIME_SLOTS_BROADCAST_CHANNEL);
      channel.postMessage({ type: 'TIME_SLOTS_UPDATED', slots });
      channel.close();
    }
  } catch {
    // BroadcastChannel unsupported
  }
}

/**
 * Fetch time slots from Supabase `public.library_time_slots`.
 * Falls back to local storage and default standard slots if not available.
 */
export async function fetchTimeSlots(supabase: SupabaseClient): Promise<TimeSlotDefinition[]> {
  try {
    const { data, error } = await supabase
      .from('library_time_slots')
      .select('*')
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .order('start_time', { ascending: true });

    if (!error && data && data.length > 0) {
      const mapped: TimeSlotDefinition[] = data.map((row: any) => ({
        value: row.slot_key || row.start_time,
        label: row.label || formatTime12Hour(row.start_time),
        rangeLabel: row.range_label || formatTimeRange(row.start_time, row.end_time),
        hourKey: row.hour_key || row.start_time.split(':')[0],
        hourLabel: row.hour_label || `${formatTime12Hour(row.start_time.split(':')[0] + ':00')} – ${formatTime12Hour((parseInt(row.start_time.split(':')[0], 10) + 1).toString().padStart(2, '0') + ':00')}`,
        period: row.period || determinePeriod(row.start_time),
      }));

      // Sort chronologically by start time value
      mapped.sort((a, b) => a.value.localeCompare(b.value));

      syncTimeSlotsLocalStorage(mapped);
      return mapped;
    }
  } catch (err) {
    console.warn('Could not query library_time_slots, using cached intervals:', err);
  }

  return getTimeSlotsFromCache();
}

/**
 * Save (insert or update) a time interval in Supabase.
 */
export async function saveTimeSlot(
  supabase: SupabaseClient,
  slotDef: {
    startTime: string;
    endTime: string;
    period?: 'Morning' | 'Midday' | 'Afternoon' | 'Late Afternoon' | 'Evening';
  },
  profile: UserProfile
): Promise<TimeSlotDefinition[]> {
  const fullDef = generateTimeSlotDef(slotDef.startTime, slotDef.endTime, slotDef.period);

  // Try RPC first
  try {
    const { error: rpcErr } = await supabase.rpc('manage_library_time_slot', {
      p_slot_key: fullDef.value,
      p_label: fullDef.label,
      p_range_label: fullDef.rangeLabel,
      p_start_time: slotDef.startTime,
      p_end_time: slotDef.endTime,
      p_hour_key: fullDef.hourKey,
      p_hour_label: fullDef.hourLabel,
      p_period: fullDef.period,
      p_display_order: parseInt(fullDef.value.replace(':', ''), 10),
      p_is_active: true,
    });

    if (rpcErr) {
      // Fallback direct table upsert
      await supabase.from('library_time_slots').upsert(
        {
          slot_key: fullDef.value,
          label: fullDef.label,
          range_label: fullDef.rangeLabel,
          start_time: slotDef.startTime,
          end_time: slotDef.endTime,
          hour_key: fullDef.hourKey,
          hour_label: fullDef.hourLabel,
          period: fullDef.period,
          display_order: parseInt(fullDef.value.replace(':', ''), 10),
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'slot_key' }
      );
    }
  } catch (err) {
    console.warn('Direct database slot persist encountered issue, saving to local state:', err);
  }

  // Update local cache
  const current = getTimeSlotsFromCache();
  const existingIdx = current.findIndex((s) => s.value === fullDef.value);
  let updated: TimeSlotDefinition[];
  if (existingIdx >= 0) {
    updated = current.map((s, idx) => (idx === existingIdx ? fullDef : s));
  } else {
    updated = [...current, fullDef];
  }
  updated.sort((a, b) => a.value.localeCompare(b.value));

  syncTimeSlotsLocalStorage(updated);
  broadcastTimeSlots(updated);

  // Attempt to log audit trail
  try {
    await supabase.rpc('log_client_activity', {
      p_action_type: 'staff_updated',
      p_description: `${profile.full_name} configured time interval: ${fullDef.rangeLabel} (${fullDef.value})`,
      p_target_type: 'time_slot',
      p_target_id: fullDef.value,
    });
  } catch {
    // non-fatal
  }

  return updated;
}

/**
 * Remove (or soft-deactivate) a time interval.
 */
export async function deleteTimeSlot(
  supabase: SupabaseClient,
  slotKey: string,
  profile: UserProfile
): Promise<TimeSlotDefinition[]> {
  try {
    const { error: rpcErr } = await supabase.rpc('delete_library_time_slot', {
      p_slot_key: slotKey,
    });

    if (rpcErr) {
      // Direct soft-deactivate fallback
      await supabase
        .from('library_time_slots')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('slot_key', slotKey);
    }
  } catch (err) {
    console.warn('Database slot deletion warning:', err);
  }

  const current = getTimeSlotsFromCache();
  const updated = current.filter((s) => s.value !== slotKey);
  syncTimeSlotsLocalStorage(updated);
  broadcastTimeSlots(updated);

  try {
    await supabase.rpc('log_client_activity', {
      p_action_type: 'staff_updated',
      p_description: `${profile.full_name} removed time interval: ${slotKey}`,
      p_target_type: 'time_slot',
      p_target_id: slotKey,
    });
  } catch {
    // non-fatal
  }

  return updated;
}

/**
 * Subscribe to realtime updates on library time slots.
 */
export function subscribeToTimeSlotChanges(
  supabase: SupabaseClient,
  callback: (slots: TimeSlotDefinition[]) => void
): () => void {
  // BroadcastChannel listener for cross-tab sync
  let channel: BroadcastChannel | null = null;
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    try {
      channel = new BroadcastChannel(TIME_SLOTS_BROADCAST_CHANNEL);
      channel.onmessage = (event) => {
        if (event.data?.type === 'TIME_SLOTS_UPDATED' && Array.isArray(event.data.slots)) {
          callback(event.data.slots);
        }
      };
    } catch {
      // ignore
    }
  }

  // Supabase Realtime Postgres Changes
  const channelName = `lirc_time_slots_${Math.random().toString(36).substring(2, 9)}`;
  const sub = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'library_time_slots' },
      async () => {
        const fresh = await fetchTimeSlots(supabase);
        callback(fresh);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(sub);
    channel?.close();
  };
}
