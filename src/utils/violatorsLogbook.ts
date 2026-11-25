import { SupabaseClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { formatTimestampPHT } from './statistics';

export type TimerStatus = 'stopped' | 'running' | 'paused' | 'completed';

export interface LibraryViolationRecord {
  id: string;
  carrierId?: string;
  violator_name: string;
  student_id: string;
  course: string;
  violation: string;
  recorded_by_id: string | null;
  recorded_by_name: string;
  recorded_by_staff_code?: string;
  timer_duration_seconds: number; // Default 3600 (1 hour)
  remaining_seconds: number;      // Seconds left when stopped/paused
  timer_status: TimerStatus;
  timer_started_at: string | null; // ISO string when current running segment started
  completed_at: string | null;    // ISO string when timer reached zero or marked completed
  notes?: string;
  created_at: string;
  updated_at: string;
}

export const VIOLATORS_STORAGE_KEY = 'lirc_library_violations_v1';
export const VIOLATORS_DELETED_KEY = 'lirc_violators_deleted_ids';
export const VIOLATORS_BROADCAST_CHANNEL = 'lirc_violators_channel';
export const VIOLATORS_CROSS_TAB_CHANNEL = 'lirc_violators_realtime';
export const VIOLATION_CARRIER_PREFIX = 'VIOLATION_CARRIER::';
export const VIOLATION_UPDATE_PREFIX = 'VIOLATION_UPDATE::';
export const VIOLATION_DELETE_PREFIX = 'VIOLATION_DELETE::';
export const VIOLATION_STAFF_CODE_PREFIX = 'VIOL_REC::';
export const DEFAULT_TIMER_DURATION_SECONDS = 3600; // 1 hour

/**
 * Unicode-safe Base64 encoder (handles non-ASCII Philippine student names safely)
 */
export function encodeUnicodeBase64(str: string): string {
  try {
    return btoa(
      encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
        String.fromCharCode(parseInt(p1, 16))
      )
    );
  } catch {
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch {
      return btoa(str);
    }
  }
}

/**
 * Unicode-safe Base64 decoder
 */
export function decodeUnicodeBase64(str: string): string {
  try {
    return decodeURIComponent(
      Array.prototype.map
        .call(atob(str), (c: string) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
  } catch {
    try {
      return decodeURIComponent(escape(atob(str)));
    } catch {
      return atob(str);
    }
  }
}

/**
 * Common library violation categories for quick selection or pill chips
 */
export const COMMON_VIOLATIONS = [
  'Disorderly Conduct / Excessive Noise',
  'Phone Noise',
  'Eating / Drinking in Non-Designated Area',
  'Improper Attire / Failure to Wear School ID',
  'Unauthorized Moving / Reserving of Tables & Chairs',
  'Mutilation or Defacing Library Materials',
  'Refusal to Cooperate with Library Staff / Duty SA',
  'Unauthorized Use of Restricted Library Equipment',
  'Loitering / Sleeping in Reading Areas',
];

/**
 * Calculates accurate remaining seconds using wall-clock timestamp comparison
 * to ensure accuracy across tab backgrounding, minimization, or page reload.
 */
export function calculateEffectiveRemainingSeconds(record: LibraryViolationRecord): number {
  if (record.timer_status === 'completed') return 0;
  if (record.timer_status === 'stopped' || record.timer_status === 'paused') {
    return Math.max(0, record.remaining_seconds);
  }
  if (record.timer_status === 'running' && record.timer_started_at) {
    const elapsed = Math.floor((Date.now() - new Date(record.timer_started_at).getTime()) / 1000);
    const remaining = record.remaining_seconds - elapsed;
    return Math.max(0, remaining);
  }
  return Math.max(0, record.remaining_seconds);
}

/**
 * Resolves the real-time status of a record's timer. If running and countdown reached 0,
 * it returns 'completed'.
 */
export function resolveEffectiveTimerStatus(record: LibraryViolationRecord): TimerStatus {
  if (record.timer_status === 'completed') return 'completed';
  if (record.timer_status === 'running') {
    const remaining = calculateEffectiveRemainingSeconds(record);
    if (remaining <= 0) return 'completed';
    return 'running';
  }
  return record.timer_status;
}

/**
 * Formats seconds into HH:MM:SS or MM:SS
 */
export function formatTimerCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Read cached violations from localStorage
 */
export function getViolationsFromStorage(): LibraryViolationRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(VIOLATORS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[ViolatorsLogbook] Failed to read from localStorage:', err);
    return [];
  }
}

/**
 * Save violations to localStorage and notify other tabs/components
 */
export function saveViolationsToStorage(records: LibraryViolationRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(VIOLATORS_STORAGE_KEY, JSON.stringify(records));
    window.dispatchEvent(new CustomEvent('lirc_violators_updated', { detail: records }));
  } catch (err) {
    console.error('[ViolatorsLogbook] Failed to save to localStorage:', err);
  }
}

/**
 * Returns set of deleted violation IDs from local storage blacklist.
 */
export function getDeletedViolationIds(): Set<string> {
  const set = new Set<string>();
  if (typeof window === 'undefined') return set;
  try {
    const raw = localStorage.getItem(VIOLATORS_DELETED_KEY);
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
 * Records deleted violation IDs into local blacklist to prevent unwanted resurrection.
 */
export function recordDeletedViolationId(...ids: (string | undefined | null)[]): void {
  if (typeof window === 'undefined') return;
  try {
    const current = getDeletedViolationIds();
    ids.forEach((id) => {
      if (id && typeof id === 'string' && id.trim()) {
        current.add(id.trim().toLowerCase());
      }
    });
    localStorage.setItem(VIOLATORS_DELETED_KEY, JSON.stringify(Array.from(current)));
  } catch {
    // ignore
  }
}

/**
 * Returns count of currently active (running or paused) violation countdowns
 */
export function getActiveViolationsCount(): number {
  const records = getViolationsFromStorage();
  const deleted = getDeletedViolationIds();
  return records.filter((r) => {
    if (deleted.has(r.id.toLowerCase())) return false;
    if (r.carrierId && deleted.has(r.carrierId.toLowerCase())) return false;
    const st = resolveEffectiveTimerStatus(r);
    return st === 'running' || st === 'paused';
  }).length;
}

/**
 * Broadcast event across open tabs and Supabase Realtime channel
 */
export function broadcastViolatorsChange(
  action: 'created' | 'updated' | 'deleted' | 'sync',
  record?: any,
  supabase?: SupabaseClient | null
) {
  if (typeof window !== 'undefined') {
    try {
      const bc = new BroadcastChannel(VIOLATORS_CROSS_TAB_CHANNEL);
      bc.postMessage({ action, record, timestamp: Date.now() });
      bc.close();
    } catch {
      // ignore if unsupported
    }
    window.dispatchEvent(new CustomEvent('lirc_violators_updated', { detail: { action, record } }));
  }

  if (supabase) {
    try {
      const channel = supabase.channel(VIOLATORS_BROADCAST_CHANNEL);
      channel.send({
        type: 'broadcast',
        event: 'violations_updated',
        payload: { action, record, timestamp: Date.now() },
      });
    } catch (err) {
      console.warn('[ViolatorsLogbook] Realtime broadcast warning:', err);
    }
  }
}

/**
 * Parse carrier row from get_login_directory
 */
export function parseCarrierViolationRecord(row: {
  id: string;
  full_name: string;
  staff_code?: string;
}): 
  | { type: 'record'; record: LibraryViolationRecord }
  | { type: 'update'; id: string; updates: Partial<LibraryViolationRecord>; updated_at: string }
  | { type: 'delete'; id: string }
  | null {
  const fn = (row.full_name || '').trim();

  // 1. Check for Tombstone Deletion carrier
  if (fn.startsWith(VIOLATION_DELETE_PREFIX)) {
    const deletedId = fn.slice(VIOLATION_DELETE_PREFIX.length).trim();
    return { type: 'delete', id: deletedId };
  }

  // 2. Check for Timer/Status Update carrier
  if (fn.startsWith(VIOLATION_UPDATE_PREFIX)) {
    try {
      const b64 = fn.slice(VIOLATION_UPDATE_PREFIX.length).trim();
      const json = decodeUnicodeBase64(b64);
      const parsed = JSON.parse(json);
      if (parsed && parsed.id && parsed.updates) {
        return {
          type: 'update',
          id: String(parsed.id),
          updates: parsed.updates,
          updated_at: parsed.updated_at || new Date().toISOString(),
        };
      }
    } catch {
      // ignore
    }
    return null;
  }

  // 3. Check for Base Violation Carrier
  if (fn.startsWith(VIOLATION_CARRIER_PREFIX)) {
    try {
      const b64 = fn.slice(VIOLATION_CARRIER_PREFIX.length).trim();
      const json = decodeUnicodeBase64(b64);
      const parsed = JSON.parse(json);
      if (parsed && parsed.violator_name) {
        return {
          type: 'record',
          record: {
            id: String(parsed.id || row.id),
            carrierId: row.id,
            violator_name: parsed.violator_name || '',
            student_id: parsed.student_id || '',
            course: parsed.course || '',
            violation: parsed.violation || '',
            recorded_by_id: parsed.recorded_by_id || null,
            recorded_by_name: parsed.recorded_by_name || '',
            recorded_by_staff_code: parsed.recorded_by_staff_code || '',
            timer_duration_seconds: Number(parsed.timer_duration_seconds) || DEFAULT_TIMER_DURATION_SECONDS,
            remaining_seconds: Number(parsed.remaining_seconds) ?? DEFAULT_TIMER_DURATION_SECONDS,
            timer_status: (parsed.timer_status as TimerStatus) || 'stopped',
            timer_started_at: parsed.timer_started_at || null,
            completed_at: parsed.completed_at || null,
            notes: parsed.notes || '',
            created_at: parsed.created_at || new Date().toISOString(),
            updated_at: parsed.updated_at || new Date().toISOString(),
          },
        };
      }
    } catch {
      // ignore
    }
    return null;
  }

  return null;
}

/**
 * Persist a violation record as a carrier profile in Supabase user_profiles via register_staff_account
 */
async function persistCarrierRecord(
  record: LibraryViolationRecord,
  supabase: SupabaseClient
): Promise<string | null> {
  try {
    const b64 = encodeUnicodeBase64(JSON.stringify(record));
    const cleanKey = `${record.id.replace(/[^a-zA-Z0-9]/g, '').slice(-8)}_${Date.now().toString().slice(-4)}`;
    const cleanStudentId = record.student_id.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 16);
    const { data: uid, error } = await supabase.rpc('register_staff_account', {
      p_email: `viol_${cleanKey}@lirc.internal`,
      p_username: `viol_${cleanKey}`,
      p_password: 'Password123!',
      p_full_name: `${VIOLATION_CARRIER_PREFIX}${b64}`,
      p_staff_code: `${VIOLATION_STAFF_CODE_PREFIX}${cleanStudentId}`,
      p_role: 'student_assistant',
    });

    if (!error && uid) {
      return String(uid);
    }
  } catch (err) {
    console.warn('[ViolatorsLogbook] persistCarrierRecord warning:', err);
  }
  return null;
}

/**
 * Fetch all violations from Supabase (checking native table first, then carrier profiles in user_profiles directory)
 * Automatically syncs any local unseeded records so both Student Assistant and Librarian see identical data.
 */
export async function fetchViolations(supabase?: SupabaseClient | null): Promise<LibraryViolationRecord[]> {
  const cached = getViolationsFromStorage();
  const deletedIds = getDeletedViolationIds();

  if (!supabase) {
    return cached.filter((r) => !deletedIds.has(r.id.toLowerCase()));
  }

  const recordsMap = new Map<string, LibraryViolationRecord>();
  const updatesList: { id: string; updates: Partial<LibraryViolationRecord>; updated_at: string }[] = [];

  // 1. Try querying Supabase public.library_violations table (if table exists)
  try {
    const { data, error } = await supabase
      .from('library_violations')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && Array.isArray(data) && data.length > 0) {
      data.forEach((d: any) => {
        const item: LibraryViolationRecord = {
          id: String(d.id),
          violator_name: d.violator_name || '',
          student_id: d.student_id || '',
          course: d.course || '',
          violation: d.violation || '',
          recorded_by_id: d.recorded_by_id || null,
          recorded_by_name: d.recorded_by_name || '',
          recorded_by_staff_code: d.recorded_by_staff_code || '',
          timer_duration_seconds: Number(d.timer_duration_seconds) || DEFAULT_TIMER_DURATION_SECONDS,
          remaining_seconds: Number(d.remaining_seconds) ?? DEFAULT_TIMER_DURATION_SECONDS,
          timer_status: (d.timer_status as TimerStatus) || 'stopped',
          timer_started_at: d.timer_started_at || null,
          completed_at: d.completed_at || null,
          notes: d.notes || '',
          created_at: d.created_at || new Date().toISOString(),
          updated_at: d.updated_at || new Date().toISOString(),
        };
        if (!deletedIds.has(item.id.toLowerCase())) {
          recordsMap.set(item.id, item);
        }
      });
    }
  } catch {
    // Database table might not exist in remote instance, proceed to carrier directory
  }

  // 2. Query carriers in public.user_profiles via get_login_directory
  try {
    const { data: dirData, error: dirErr } = await supabase.rpc('get_login_directory');
    if (!dirErr && Array.isArray(dirData)) {
      for (const row of dirData) {
        const parsed = parseCarrierViolationRecord(row);
        if (!parsed) continue;

        if (parsed.type === 'delete') {
          deletedIds.add(parsed.id.toLowerCase());
          recordDeletedViolationId(parsed.id);
          recordsMap.delete(parsed.id);
        } else if (parsed.type === 'record') {
          if (!deletedIds.has(parsed.record.id.toLowerCase()) && (!parsed.record.carrierId || !deletedIds.has(parsed.record.carrierId.toLowerCase()))) {
            const existing = recordsMap.get(parsed.record.id);
            if (!existing || new Date(parsed.record.updated_at).getTime() >= new Date(existing.updated_at).getTime()) {
              recordsMap.set(parsed.record.id, parsed.record);
            }
          }
        } else if (parsed.type === 'update') {
          updatesList.push(parsed);
        }
      }

      // Apply updates chronologically
      updatesList.sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());
      for (const upd of updatesList) {
        const target = recordsMap.get(upd.id);
        if (target) {
          recordsMap.set(upd.id, {
            ...target,
            ...upd.updates,
            updated_at: upd.updated_at,
          });
        }
      }
    }
  } catch (err) {
    console.warn('[ViolatorsLogbook] Carrier directory query warning:', err);
  }

  // 3. Auto-Heal / Seed local records from Student Assistant side that haven't been pushed to Supabase
  const unseededLocal = cached.filter(
    (r) => !deletedIds.has(r.id.toLowerCase()) && !recordsMap.has(r.id)
  );

  if (unseededLocal.length > 0) {
    unseededLocal.forEach((rec) => {
      recordsMap.set(rec.id, rec);
      persistCarrierRecord(rec, supabase).then((carrierId) => {
        if (carrierId) {
          rec.carrierId = carrierId;
          const cur = getViolationsFromStorage();
          saveViolationsToStorage(cur.map((r) => (r.id === rec.id ? { ...r, carrierId } : r)));
        }
      });
    });
  }

  // 4. Final filter & sort
  const result = Array.from(recordsMap.values())
    .filter((r) => !deletedIds.has(r.id.toLowerCase()) && (!r.carrierId || !deletedIds.has(r.carrierId.toLowerCase())))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  saveViolationsToStorage(result);
  return result;
}

/**
 * Add a new violation record
 */
export async function createViolation(
  payload: {
    violator_name: string;
    student_id: string;
    course: string;
    violation: string;
    recorded_by_id: string | null;
    recorded_by_name: string;
    recorded_by_staff_code?: string;
    timer_duration_seconds?: number;
    notes?: string;
  },
  supabase?: SupabaseClient | null
): Promise<LibraryViolationRecord> {
  const duration = payload.timer_duration_seconds || DEFAULT_TIMER_DURATION_SECONDS;
  const now = new Date().toISOString();
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `viol_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const newRecord: LibraryViolationRecord = {
    id,
    violator_name: payload.violator_name.trim(),
    student_id: payload.student_id.trim().toUpperCase(),
    course: payload.course.trim().toUpperCase(),
    violation: payload.violation.trim(),
    recorded_by_id: payload.recorded_by_id || null,
    recorded_by_name: payload.recorded_by_name.trim(),
    recorded_by_staff_code: payload.recorded_by_staff_code || '',
    timer_duration_seconds: duration,
    remaining_seconds: duration,
    timer_status: 'stopped',
    timer_started_at: null,
    completed_at: null,
    notes: payload.notes || '',
    created_at: now,
    updated_at: now,
  };

  // Immediate local update for zero-latency UI
  const current = getViolationsFromStorage();
  const updated = [newRecord, ...current.filter((r) => r.id !== id)];
  saveViolationsToStorage(updated);

  // Broadcast immediate change across tabs
  broadcastViolatorsChange('created', newRecord, supabase);

  if (supabase) {
    // 1. Try native table insert (if table exists)
    try {
      await supabase.from('library_violations').insert([
        {
          id: newRecord.id,
          violator_name: newRecord.violator_name,
          student_id: newRecord.student_id,
          course: newRecord.course,
          violation: newRecord.violation,
          recorded_by_id: newRecord.recorded_by_id,
          recorded_by_name: newRecord.recorded_by_name,
          recorded_by_staff_code: newRecord.recorded_by_staff_code,
          timer_duration_seconds: newRecord.timer_duration_seconds,
          remaining_seconds: newRecord.remaining_seconds,
          timer_status: newRecord.timer_status,
          timer_started_at: newRecord.timer_started_at,
          completed_at: newRecord.completed_at,
          notes: newRecord.notes,
        },
      ]);
    } catch {
      // ignore
    }

    // 2. Persist to carrier profile in user_profiles
    persistCarrierRecord(newRecord, supabase).then((carrierId) => {
      if (carrierId) {
        newRecord.carrierId = carrierId;
        const cur = getViolationsFromStorage();
        saveViolationsToStorage(cur.map((r) => (r.id === newRecord.id ? { ...r, carrierId } : r)));
      }
    });
  }

  return newRecord;
}

/**
 * Update an existing violation timer state (play, pause, complete, or duration change)
 */
export async function updateViolationTimer(
  id: string,
  updates: Partial<LibraryViolationRecord>,
  supabase?: SupabaseClient | null
): Promise<LibraryViolationRecord | null> {
  const current = getViolationsFromStorage();
  const index = current.findIndex((r) => r.id === id);
  if (index === -1) return null;

  const target = current[index];
  const updatedRecord: LibraryViolationRecord = {
    ...target,
    ...updates,
    updated_at: new Date().toISOString(),
  };

  current[index] = updatedRecord;
  saveViolationsToStorage(current);

  // Broadcast immediate change
  broadcastViolatorsChange('updated', updatedRecord, supabase);

  if (supabase) {
    // 1. Try native table update
    try {
      const dbPayload: any = {
        updated_at: updatedRecord.updated_at,
      };
      if (updates.timer_status !== undefined) dbPayload.timer_status = updates.timer_status;
      if (updates.remaining_seconds !== undefined) dbPayload.remaining_seconds = updates.remaining_seconds;
      if (updates.timer_started_at !== undefined) dbPayload.timer_started_at = updates.timer_started_at;
      if (updates.completed_at !== undefined) dbPayload.completed_at = updates.completed_at;
      if (updates.notes !== undefined) dbPayload.notes = updates.notes;

      await supabase.from('library_violations').update(dbPayload).eq('id', id);
    } catch {
      // ignore
    }

    // 2. Persist update carrier record via register_staff_account
    try {
      const updatePayload = {
        id,
        updates,
        updated_at: updatedRecord.updated_at,
      };
      const b64 = encodeUnicodeBase64(JSON.stringify(updatePayload));
      const cleanKey = `${id.replace(/[^a-zA-Z0-9]/g, '').slice(-8)}_${Date.now().toString().slice(-4)}`;
      await supabase.rpc('register_staff_account', {
        p_email: `vupd_${cleanKey}@lirc.internal`,
        p_username: `vupd_${cleanKey}`,
        p_password: 'Password123!',
        p_full_name: `${VIOLATION_UPDATE_PREFIX}${b64}`,
        p_staff_code: `VIOL_UPD::${id.slice(0, 16)}`,
        p_role: 'student_assistant',
      });
    } catch {
      // ignore
    }
  }

  return updatedRecord;
}

/**
 * Remove a violation record
 */
export async function removeViolation(
  id: string,
  supabase?: SupabaseClient | null,
  carrierId?: string
): Promise<boolean> {
  // 1. Mark as deleted locally
  recordDeletedViolationId(id);
  if (carrierId) recordDeletedViolationId(carrierId);

  const current = getViolationsFromStorage();
  const targetRecord = current.find((r) => r.id === id);
  const resolvedCarrierId = carrierId || targetRecord?.carrierId;
  if (resolvedCarrierId) recordDeletedViolationId(resolvedCarrierId);

  const updated = current.filter((r) => r.id !== id);
  saveViolationsToStorage(updated);

  // 2. Broadcast local cross-tab change
  broadcastViolatorsChange('deleted', { id }, supabase);

  // 3. Remote persistence
  if (supabase) {
    // Native table delete fallback
    try {
      await supabase.from('library_violations').delete().eq('id', id);
    } catch {
      // ignore
    }

    // If user is Librarian and carrier account exists, delete it directly
    if (resolvedCarrierId && !resolvedCarrierId.startsWith('viol_')) {
      try {
        await supabase.rpc('admin_delete_staff_account', { p_user_id: resolvedCarrierId });
      } catch {
        // ignore
      }
    }

    // Always register a tombstone deletion carrier so all clients filter this record out
    try {
      const cleanKey = `${id.replace(/[^a-zA-Z0-9]/g, '').slice(-8)}_${Date.now().toString().slice(-4)}`;
      await supabase.rpc('register_staff_account', {
        p_email: `vdel_${cleanKey}@lirc.internal`,
        p_username: `vdel_${cleanKey}`,
        p_password: 'Password123!',
        p_full_name: `${VIOLATION_DELETE_PREFIX}${id}`,
        p_staff_code: `VIOL_DEL::${id.slice(0, 16)}`,
        p_role: 'student_assistant',
      });
    } catch {
      // ignore
    }
  }

  return true;
}

/**
 * Subscribe to realtime updates across clients
 */
export function subscribeToViolations(
  supabase: SupabaseClient | null | undefined,
  onUpdate: () => void
): () => void {
  // Listen to local window events
  const localHandler = () => onUpdate();
  window.addEventListener('lirc_violators_updated', localHandler);
  window.addEventListener('storage', localHandler);
  window.addEventListener('focus', localHandler);

  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel(VIOLATORS_CROSS_TAB_CHANNEL);
    bc.onmessage = () => onUpdate();
  } catch {
    // ignore
  }

  let supabaseChannel: any = null;
  if (supabase) {
    try {
      supabaseChannel = supabase
        .channel(VIOLATORS_BROADCAST_CHANNEL)
        .on('broadcast', { event: 'violations_updated' }, () => {
          onUpdate();
        })
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'library_violations' },
          () => {
            onUpdate();
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'user_profiles' },
          () => {
            onUpdate();
          }
        )
        .subscribe();
    } catch (err) {
      console.warn('[ViolatorsLogbook] Supabase subscription failed:', err);
    }
  }

  return () => {
    window.removeEventListener('lirc_violators_updated', localHandler);
    window.removeEventListener('storage', localHandler);
    window.removeEventListener('focus', localHandler);
    bc?.close();
    if (supabaseChannel && supabase) {
      try {
        void supabase.removeChannel(supabaseChannel);
      } catch {
        // ignore
      }
    }
  };
}

/**
 * Helper to sanitize filenames
 */
function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-]+/g, '_');
}

/**
 * 1. EXCEL EXPORT (.xlsx)
 */
export function exportViolationsToExcel(
  records: LibraryViolationRecord[],
  preparedBy: string
): void {
  const wb = XLSX.utils.book_new();

  const totalViolations = records.length;
  const runningCount = records.filter((r) => resolveEffectiveTimerStatus(r) === 'running').length;
  const completedCount = records.filter((r) => resolveEffectiveTimerStatus(r) === 'completed').length;
  const pausedCount = records.filter((r) => resolveEffectiveTimerStatus(r) === 'paused').length;
  const stoppedCount = records.filter((r) => resolveEffectiveTimerStatus(r) === 'stopped').length;

  const headerRows: (string | number)[][] = [
    ['LIRC MANAGEMENT SYSTEM – LEARNING & INFORMATION RESOURCE CENTER'],
    ['VIOLATORS LOGBOOK & ONE-HOUR MONITORING REGISTRY'],
    [`Generated Date: ${new Date().toLocaleString()}`, '', `Prepared By: ${preparedBy}`],
    [],
    ['EXECUTIVE SUMMARY'],
    ['Total Violations Logged', totalViolations],
    ['Currently Active / Running 1-Hour Timers', runningCount],
    ['Completed 1-Hour Monitoring Periods', completedCount],
    ['Paused Timers', pausedCount],
    ['Pending / Stopped Timers', stoppedCount],
    [],
    [
      'No.',
      'Date & Time Recorded',
      'Student Name',
      'Student ID',
      'Course / Program',
      'Violation Details',
      'Recorded By (Student Assistant)',
      'Timer Status',
      'Remaining Time',
      'Completion Timestamp',
      'Notes',
    ],
  ];

  records.forEach((rec, idx) => {
    const effStatus = resolveEffectiveTimerStatus(rec);
    const effRemaining = calculateEffectiveRemainingSeconds(rec);
    const statusLabel =
      effStatus === 'completed'
        ? 'COMPLETED'
        : effStatus === 'running'
        ? 'RUNNING'
        : effStatus === 'paused'
        ? 'PAUSED'
        : 'STOPPED';

    headerRows.push([
      idx + 1,
      formatTimestampPHT(rec.created_at),
      rec.violator_name,
      rec.student_id,
      rec.course,
      rec.violation,
      rec.recorded_by_name || 'Student Assistant',
      statusLabel,
      effStatus === 'completed' ? '00:00 (Done)' : formatTimerCountdown(effRemaining),
      rec.completed_at ? formatTimestampPHT(rec.completed_at) : (effStatus === 'completed' ? 'Completed' : 'Pending'),
      rec.notes || '',
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(headerRows);

  ws['!cols'] = [
    { wch: 6 },  // No.
    { wch: 22 }, // Date & Time
    { wch: 26 }, // Student Name
    { wch: 16 }, // Student ID
    { wch: 18 }, // Course
    { wch: 38 }, // Violation Details
    { wch: 28 }, // Recorded By
    { wch: 16 }, // Timer Status
    { wch: 18 }, // Remaining Time
    { wch: 22 }, // Completion Timestamp
    { wch: 30 }, // Notes
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Violators Logbook');

  const fileName = `LIRC_Violators_Logbook_${sanitizeFileName(new Date().toISOString().slice(0, 10))}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

/**
 * 2. PDF EXPORT (.pdf)
 */
export function exportViolationsToPDF(
  records: LibraryViolationRecord[],
  preparedBy: string
): void {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const totalViolations = records.length;
  const runningCount = records.filter((r) => resolveEffectiveTimerStatus(r) === 'running').length;
  const completedCount = records.filter((r) => resolveEffectiveTimerStatus(r) === 'completed').length;

  // Header banner matching academic palette
  doc.setFillColor(168, 50, 50); // Burgundy #A83232
  doc.rect(0, 0, 297, 24, 'F');

  doc.setFillColor(231, 184, 75); // Mustard #E7B84B gold accent bar
  doc.rect(0, 24, 297, 2, 'F');

  // Title text
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text('LIRC MANAGEMENT SYSTEM — LEARNING & INFORMATION RESOURCE CENTER', 14, 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('VIOLATORS LOGBOOK & 1-HOUR MONITORING REGISTRY REPORT', 14, 18);

  // Metadata block
  doc.setFontSize(8.5);
  doc.setTextColor(70, 70, 70);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 32);
  doc.text(`Prepared By: ${preparedBy} (LIRC Staff)`, 14, 37);

  doc.text(
    `Total Logged: ${totalViolations}  |  Active Timers: ${runningCount}  |  Completed: ${completedCount}`,
    200,
    32
  );

  // Table columns
  const tableHeaders = [
    '#',
    'Date / Time',
    'Violator Name',
    'Student ID',
    'Course',
    'Violation Details',
    'Recorded By',
    'Timer Status',
    'Remaining',
  ];

  const tableRows = records.map((rec, index) => {
    const effStatus = resolveEffectiveTimerStatus(rec);
    const effRemaining = calculateEffectiveRemainingSeconds(rec);
    const statusText =
      effStatus === 'completed'
        ? 'COMPLETED'
        : effStatus === 'running'
        ? 'RUNNING'
        : effStatus === 'paused'
        ? 'PAUSED'
        : 'STOPPED';

    return [
      (index + 1).toString(),
      formatTimestampPHT(rec.created_at),
      rec.violator_name,
      rec.student_id,
      rec.course,
      rec.violation,
      rec.recorded_by_name || 'Student Assistant',
      statusText,
      effStatus === 'completed' ? 'Completed' : formatTimerCountdown(effRemaining),
    ];
  });

  autoTable(doc, {
    head: [tableHeaders],
    body: tableRows,
    startY: 42,
    margin: { left: 14, right: 14 },
    theme: 'grid',
    headStyles: {
      fillColor: [168, 50, 50],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
      halign: 'center',
    },
    styles: {
      fontSize: 8,
      cellPadding: 2.2,
      textColor: [40, 40, 40],
      overflow: 'linebreak',
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 26 },
      2: { cellWidth: 38, fontStyle: 'bold' },
      3: { cellWidth: 24, halign: 'center' },
      4: { cellWidth: 22, halign: 'center' },
      5: { cellWidth: 64 },
      6: { cellWidth: 38 },
      7: { cellWidth: 24, halign: 'center' },
      8: { cellWidth: 23, halign: 'center', fontStyle: 'bold' },
    },
    alternateRowStyles: {
      fillColor: [249, 246, 240], // Light parchment tint
    },
    didDrawPage: (data) => {
      // Footer page numbering
      const str = `Page ${doc.getNumberOfPages()} — LIRC Violators Logbook Registry`;
      doc.setFontSize(8);
      doc.setTextColor(130, 130, 130);
      doc.text(str, 14, 204);
    },
  });

  const fileName = `LIRC_Violators_Logbook_${sanitizeFileName(new Date().toISOString().slice(0, 10))}.pdf`;
  doc.save(fileName);
}

/**
 * 3. WORD DOCUMENT EXPORT (.docx)
 */
export async function exportViolationsToWord(
  records: LibraryViolationRecord[],
  preparedBy: string
): Promise<void> {
  const totalViolations = records.length;
  const runningCount = records.filter((r) => resolveEffectiveTimerStatus(r) === 'running').length;
  const completedCount = records.filter((r) => resolveEffectiveTimerStatus(r) === 'completed').length;
  const pausedCount = records.filter((r) => resolveEffectiveTimerStatus(r) === 'paused').length;

  const border = {
    top: { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' },
    left: { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' },
    right: { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' },
  };

  const makeCell = (
    text: string,
    isHeader = false,
    alignRight = false,
    bold = false,
    customColor?: string
  ) =>
    new TableCell({
      borders: border,
      shading: isHeader ? { fill: 'A83232', type: ShadingType.CLEAR } : undefined,
      children: [
        new Paragraph({
          alignment: alignRight ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: [
            new TextRun({
              text,
              bold: isHeader || bold,
              color: isHeader ? 'FFFFFF' : customColor || '1F2937',
              size: isHeader ? 19 : 17,
              font: 'Calibri',
            }),
          ],
        }),
      ],
    });

  const tableRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        makeCell('No.', true),
        makeCell('Date / Time', true),
        makeCell('Student Name', true),
        makeCell('Student ID', true),
        makeCell('Course', true),
        makeCell('Violation Details', true),
        makeCell('Recorded By', true),
        makeCell('Timer Status', true),
        makeCell('Remaining Time', true),
      ],
    }),
    ...records.map((rec, idx) => {
      const effStatus = resolveEffectiveTimerStatus(rec);
      const effRemaining = calculateEffectiveRemainingSeconds(rec);
      const statusText =
        effStatus === 'completed'
          ? 'COMPLETED'
          : effStatus === 'running'
          ? 'RUNNING'
          : effStatus === 'paused'
          ? 'PAUSED'
          : 'STOPPED';

      return new TableRow({
        children: [
          makeCell((idx + 1).toString(), false, false, false),
          makeCell(formatTimestampPHT(rec.created_at)),
          makeCell(rec.violator_name, false, false, true),
          makeCell(rec.student_id),
          makeCell(rec.course),
          makeCell(rec.violation),
          makeCell(rec.recorded_by_name || 'Student Assistant'),
          makeCell(
            statusText,
            false,
            false,
            true,
            effStatus === 'completed' ? '16A34A' : effStatus === 'running' ? 'A83232' : 'D97706'
          ),
          makeCell(
            effStatus === 'completed' ? 'Completed (00:00)' : formatTimerCountdown(effRemaining),
            false,
            false,
            true
          ),
        ],
      });
    }),
  ];

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [
              new TextRun({
                text: 'LIRC MANAGEMENT SYSTEM — LEARNING & INFORMATION RESOURCE CENTER',
                bold: true,
                size: 26,
                color: 'A83232',
                font: 'Calibri',
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 120 },
            children: [
              new TextRun({
                text: 'VIOLATORS LOGBOOK & ONE-HOUR MONITORING REGISTRY REPORT',
                bold: true,
                size: 20,
                color: '374151',
                font: 'Calibri',
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 160 },
            children: [
              new TextRun({
                text: `Generated: ${new Date().toLocaleString()}  |  Prepared By: ${preparedBy}  |  Total Records: ${totalViolations}`,
                size: 18,
                color: '6B7280',
                font: 'Calibri',
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 140 },
            children: [
              new TextRun({
                text: `Summary: ${runningCount} Active Countdown(s)  •  ${completedCount} Completed  •  ${pausedCount} Paused`,
                bold: true,
                size: 18,
                color: '1F2937',
                font: 'Calibri',
              }),
            ],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: tableRows,
          }),
          new Paragraph({
            spacing: { before: 360, after: 60 },
            children: [
              new TextRun({
                text: 'Official Certified Report:',
                size: 18,
                color: '4B5563',
                font: 'Calibri',
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: preparedBy,
                bold: true,
                size: 20,
                color: '111827',
                font: 'Calibri',
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'Librarian / Staff In-Charge, Learning & Information Resource Center (LIRC)',
                size: 18,
                color: '6B7280',
                font: 'Calibri',
              }),
            ],
          }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `LIRC_Violators_Logbook_${sanitizeFileName(new Date().toISOString().slice(0, 10))}.docx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
