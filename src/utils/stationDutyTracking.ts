import { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

export interface StationDutyPresence {
  userId: string;
  userName: string;
  staffCode: string;
  areaId: number;
  areaName: string;
  startedAt: string;
}

export const STATION_DUTY_STORAGE_KEY = 'lirc_active_station_duty_sessions';
export const STATION_DUTY_BROADCAST_CHANNEL = 'lirc_station_duty_broadcast';
export const STATION_DUTY_PRESENCE_CHANNEL = 'lirc_station_duty_presence';

/**
 * Retrieves the currently active station duty sessions cached in local storage.
 */
export function getStoredStationDutySessions(): StationDutyPresence[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STATION_DUTY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (s) => s && typeof s.userId === 'string' && typeof s.areaId === 'number'
      );
    }
  } catch {
    // ignore
  }
  return [];
}

/**
 * Stores or updates an active station duty session in local storage.
 */
export function storeStationDutySession(session: StationDutyPresence) {
  if (typeof window === 'undefined') return;
  try {
    const current = getStoredStationDutySessions();
    const filtered = current.filter(
      (s) => s.userId !== session.userId && s.areaId !== session.areaId
    );
    filtered.push(session);
    localStorage.setItem(STATION_DUTY_STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // ignore
  }
}

/**
 * Removes an active station duty session for a user/area from local storage.
 */
export function removeStoredStationDutySession(userId: string, areaId?: number) {
  if (typeof window === 'undefined') return;
  try {
    const current = getStoredStationDutySessions();
    const filtered = current.filter((s) => {
      if (s.userId !== userId) return true;
      if (typeof areaId === 'number' && s.areaId !== areaId) return true;
      return false;
    });
    localStorage.setItem(STATION_DUTY_STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // ignore
  }
}

/**
 * Cross-tab local broadcast channel sender for instant same-browser notification.
 */
export function broadcastStationDutyLocal(
  action: 'ENTER' | 'LEAVE',
  session: StationDutyPresence
) {
  if (typeof window === 'undefined') return;
  try {
    const bc = new BroadcastChannel(STATION_DUTY_BROADCAST_CHANNEL);
    bc.postMessage({ action, session, timestamp: Date.now() });
    bc.close();
  } catch {
    // ignore
  }
}

let activePresenceChannel: RealtimeChannel | null = null;

/**
 * Activates real-time presence tracking when a student assistant enters a service duty station.
 */
export async function trackStationDuty(
  supabase: SupabaseClient,
  session: StationDutyPresence
) {
  storeStationDutySession(session);
  broadcastStationDutyLocal('ENTER', session);

  try {
    if (!activePresenceChannel) {
      activePresenceChannel = supabase.channel(STATION_DUTY_PRESENCE_CHANNEL, {
        config: { presence: { key: session.userId } },
      });
    }

    if (activePresenceChannel.state !== 'joined') {
      await new Promise<void>((resolve) => {
        activePresenceChannel!.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            resolve();
          }
        });
      });
    }

    await activePresenceChannel.track({
      userId: session.userId,
      userName: session.userName,
      staffCode: session.staffCode,
      areaId: session.areaId,
      areaName: session.areaName,
      startedAt: session.startedAt,
    });

    await activePresenceChannel.send({
      type: 'broadcast',
      event: 'station_change',
      payload: { action: 'ENTER', session },
    });
  } catch (err) {
    console.warn('Could not track station duty on Supabase presence:', err);
  }
}

/**
 * Untracks real-time presence when a student assistant exits or leaves a service duty station.
 */
export async function untrackStationDuty(
  supabase: SupabaseClient,
  userId: string,
  areaId: number,
  userName: string,
  staffCode: string,
  areaName: string
) {
  removeStoredStationDutySession(userId, areaId);
  const exitSession: StationDutyPresence = {
    userId,
    userName,
    staffCode,
    areaId,
    areaName,
    startedAt: '',
  };
  broadcastStationDutyLocal('LEAVE', exitSession);

  try {
    if (activePresenceChannel) {
      await activePresenceChannel.untrack();
      await activePresenceChannel.send({
        type: 'broadcast',
        event: 'station_change',
        payload: { action: 'LEAVE', session: exitSession },
      });
    }
  } catch (err) {
    console.warn('Could not untrack station duty on Supabase presence:', err);
  }
}

/**
 * Subscribes to station duty changes across:
 * 1. Supabase Realtime Presence (cross-device sync across entire library network)
 * 2. Supabase Realtime Broadcast (instant server-pushed events)
 * 3. Browser BroadcastChannel (instant < 5ms sync across tabs)
 * 4. Browser StorageEvent (local cache sync)
 */
export function subscribeToStationDuty(
  supabase: SupabaseClient,
  onChange: (sessions: StationDutyPresence[]) => void
): () => void {
  let isMounted = true;

  const consolidateAndNotify = (presenceMap?: Record<string, any[]>) => {
    if (!isMounted) return;
    const combinedMap = new Map<string, StationDutyPresence>();

    // 1. Load stored sessions
    const stored = getStoredStationDutySessions();
    stored.forEach((s) => {
      combinedMap.set(`${s.userId}|${s.areaId}`, s);
    });

    // 2. Load presence state if provided
    if (presenceMap) {
      Object.values(presenceMap).forEach((entries) => {
        if (Array.isArray(entries)) {
          entries.forEach((item) => {
            if (item && item.userId && typeof item.areaId === 'number') {
              combinedMap.set(`${item.userId}|${item.areaId}`, {
                userId: item.userId,
                userName: item.userName || 'Student Assistant',
                staffCode: item.staffCode || '',
                areaId: item.areaId,
                areaName: item.areaName || 'Service Station',
                startedAt: item.startedAt || new Date().toISOString(),
              });
            }
          });
        }
      });
    }

    onChange(Array.from(combinedMap.values()));
  };

  // Initial notify from stored cache
  consolidateAndNotify();

  // 1. Supabase Realtime presence & broadcast channel
  const presenceChannel = supabase.channel(
    `station-sync-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    {
      config: { presence: { key: 'viewer' } },
    }
  );

  presenceChannel
    .on('presence', { event: 'sync' }, () => {
      if (!isMounted) return;
      const state = presenceChannel.presenceState();
      consolidateAndNotify(state);
    })
    .on('broadcast', { event: 'station_change' }, (event) => {
      if (!isMounted) return;
      const payload = event?.payload;
      if (payload?.session) {
        if (payload.action === 'ENTER') {
          storeStationDutySession(payload.session);
        } else if (payload.action === 'LEAVE') {
          removeStoredStationDutySession(payload.session.userId, payload.session.areaId);
        }
        consolidateAndNotify(presenceChannel.presenceState());
      }
    })
    .subscribe();

  // 2. Cross-tab BroadcastChannel
  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel(STATION_DUTY_BROADCAST_CHANNEL);
    bc.onmessage = (event) => {
      if (!isMounted) return;
      const data = event.data;
      if (data?.session) {
        if (data.action === 'ENTER') {
          storeStationDutySession(data.session);
        } else if (data.action === 'LEAVE') {
          removeStoredStationDutySession(data.session.userId, data.session.areaId);
        }
        consolidateAndNotify(presenceChannel.presenceState());
      }
    };
  } catch {
    // ignore
  }

  // 3. Storage event listener
  const handleStorage = (e: StorageEvent) => {
    if (e.key === STATION_DUTY_STORAGE_KEY) {
      consolidateAndNotify(presenceChannel.presenceState());
    }
  };
  window.addEventListener('storage', handleStorage);

  // 4. Focus event listener
  const handleFocus = () => {
    consolidateAndNotify(presenceChannel.presenceState());
  };
  window.addEventListener('focus', handleFocus);

  return () => {
    isMounted = false;
    supabase.removeChannel(presenceChannel);
    bc?.close();
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener('focus', handleFocus);
  };
}
