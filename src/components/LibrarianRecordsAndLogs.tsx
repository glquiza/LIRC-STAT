import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Clock,
  Download,
  Edit3,
  Eye,
  EyeOff,
  Filter,
  Layers,
  Lock,
  Minus,
  Plus,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  ActivityActionType,
  ActivityLog,
  LIBRARY_TIME_SLOTS,
  LibraryArea,
  MissingIntervalItem,
  OccupancyRecord,
  UserProfile,
} from '../types/lirc';
import {
  computeStatisticalReport,
  formatShortDate,
  formatSlotLabel,
  formatSlotRangeLabel,
  formatTimestampPHT,
  getDayOfWeekName,
  getLiteraryAreaColor,
  getTodayPHT,
} from '../utils/statistics';
import { CalendarActivity, formatActivityTimeRange } from '../utils/calendarActivities';

interface LibrarianRecordsAndLogsProps {
  mode: 'records' | 'logs';
  profile?: UserProfile;
  areas: LibraryArea[];
  todayDate: string;
  currentSlot: string | null;
  isOperatingHours: boolean;
  calendarActivities?: CalendarActivity[];
  closedDaysOfWeek?: number[];
  onNotify: (type: 'success' | 'error', message: string) => void;
  onDataMutated: () => void;
}

const PAGE_SIZE = 15;

const ACTION_LABELS: Record<string, { label: string; badge: string }> = {
  occupancy_submitted: { label: 'Completed', badge: 'bg-[#F1F5EE] text-[#455436] border-[#71865A]/40' },
  record_corrected: { label: 'Modified', badge: 'bg-[#FEF9EC] text-[#7D5B06] border-[#E7B84B]/60' },
  record_backfilled: { label: 'Added Missing', badge: 'bg-[#FDF3F3] text-[#A83232] border-[#A83232]/25' },
  session_started: { label: 'Active Session', badge: 'bg-[#F1F5EE] text-[#455436] border-[#71865A]/40' },
  session_ended: { label: 'Exited Area', badge: 'bg-[#FAF5EE] text-[#6E665E] border-[#E6D7C3]' },
  report_generated: { label: 'Report Created', badge: 'bg-[#FEF9EC] text-[#7D5B06] border-[#E7B84B]/60' },
  report_exported: { label: 'Report Exported', badge: 'bg-[#F1F5EE] text-[#455436] border-[#71865A]/40' },
  user_login: { label: 'Signed In', badge: 'bg-[#F1F5EE] text-[#455436] border-[#71865A]/40' },
  user_logout: { label: 'Signed Out', badge: 'bg-[#FAF5EE] text-[#6E665E] border-[#E6D7C3]' },
  staff_created: { label: 'Account Created', badge: 'bg-[#F1F5EE] text-[#455436] border-[#71865A]/40' },
  staff_updated: { label: 'Account Updated', badge: 'bg-[#FEF9EC] text-[#7D5B06] border-[#E7B84B]/60' },
  area_updated: { label: 'Area Updated', badge: 'bg-[#FAF5EE] text-[#332F2B] border-[#E6D7C3]' },
  backup_exported: { label: 'Backup Saved', badge: 'bg-[#FDF3F3] text-[#A83232] border-[#A83232]/25' },
};

/**
 * Detects whether an activity log entry is associated with a class suspension or calendar activity,
 * and formats the Status badge and Details description into clean, human-readable text.
 */
export function parseCalendarLogDetails(
  log: ActivityLog,
  calendarActivities: CalendarActivity[] = []
): {
  isCalendar: boolean;
  badgeLabel: string;
  badgeClass: string;
  details: string;
} {
  const desc = log.description || '';
  const actionTypeStr = (log.action_type || '') as string;
  const staffCode = (log.metadata?.staff_code || '') as string;
  const username = (log.metadata?.username || '') as string;

  const isCalendar =
    desc.includes('CALENDAR_ACTIVITY::') ||
    desc.includes('CAL_ACT::') ||
    desc.includes('@cal_') ||
    actionTypeStr === 'calendar_suspension' ||
    actionTypeStr === 'calendar_updated' ||
    actionTypeStr === 'calendar_removed' ||
    staffCode.startsWith('CAL_ACT::') ||
    username.startsWith('cal_');

  if (!isCalendar) {
    const meta = ACTION_LABELS[log.action_type] || {
      label: log.action_type.replace(/_/g, ' '),
      badge: 'bg-[#FAF5EE] text-[#332F2B] border-[#E6D7C3]',
    };
    return {
      isCalendar: false,
      badgeLabel: meta.label,
      badgeClass: meta.badge,
      details: desc,
    };
  }

  // Determine action verb
  let actionVerb = 'Declared class suspension';
  if (actionTypeStr === 'staff_updated' || actionTypeStr === 'calendar_updated' || desc.includes('updated')) {
    actionVerb = 'Updated class suspension';
  } else if (actionTypeStr === 'staff_deleted' || actionTypeStr === 'calendar_removed' || desc.includes('deleted') || desc.includes('removed')) {
    actionVerb = 'Removed class suspension';
  }

  // Extract raw title from description:
  // e.g. "DR. MARIA LORENA ABANGAN created student_assistant account for CALENDAR_ACTIVITY::SUNDAY WAY DUTY (@cal_cal1795105709418)"
  let extractedTitle = '';
  if (desc.includes('CALENDAR_ACTIVITY::')) {
    const after = desc.split('CALENDAR_ACTIVITY::')[1] || '';
    extractedTitle = after.split(/\s*\(@cal_|\s*\(|$/)[0].trim();
  } else if (desc.includes('account for ')) {
    const after = desc.split('account for ')[1] || '';
    extractedTitle = after.split(/\s*\(@cal_|\s*\(|$/)[0].trim();
  }

  // Try to match with active calendar activities
  const matched = calendarActivities.find((a) => {
    if (extractedTitle && a.title.toLowerCase().trim() === extractedTitle.toLowerCase().trim()) return true;
    if (log.target_id && a.carrierId === log.target_id) return true;
    if (a.title && desc.includes(a.title)) return true;
    return false;
  });

  let cleanDetails = '';
  if (matched) {
    const dateFormatted = formatShortDate(matched.date);
    const scopeLabel = matched.isWholeDay ? 'Whole Day' : formatActivityTimeRange(matched);
    cleanDetails = `${actionVerb}: "${matched.title}" on ${dateFormatted} (${scopeLabel})`;
    if (matched.description) {
      cleanDetails += ` — Note: ${matched.description}`;
    }
  } else if (extractedTitle) {
    // If activity was deleted or not in active array, check staff_code for date
    let datePart = '';
    if (staffCode.startsWith('CAL_ACT::')) {
      const parts = staffCode.split('::');
      if (parts[1]) {
        datePart = ` on ${formatShortDate(parts[1])}`;
      }
    }
    const scopeHint = desc.includes('WHOLE') || staffCode.includes('WHOLE') ? 'Whole Day' : 'Class suspension';
    cleanDetails = `${actionVerb}${datePart}: "${extractedTitle}" (${scopeHint})`;
  } else {
    cleanDetails = `${actionVerb}: Academic calendar event`;
  }

  return {
    isCalendar: true,
    badgeLabel: 'Class Suspension',
    badgeClass: 'bg-[#FEF2F2] text-[#991B1B] border-[#F87171]/40',
    details: cleanDetails,
  };
}

const DELETED_RECORDS_KEY = 'lirc_deleted_occupancy_records';
const DELETED_LOGS_KEY = 'lirc_deleted_activity_logs';

export function getDeletedRecordIds(): Set<number> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(DELETED_RECORDS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(Number) : []);
  } catch {
    return new Set();
  }
}

export function recordDeletedRecordId(id: number) {
  if (typeof window === 'undefined') return;
  try {
    const set = getDeletedRecordIds();
    set.add(id);
    localStorage.setItem(DELETED_RECORDS_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // ignore
  }
}

export function getDeletedLogIds(): Set<number> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(DELETED_LOGS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(Number) : []);
  } catch {
    return new Set();
  }
}

export function recordDeletedLogId(id: number) {
  if (typeof window === 'undefined') return;
  try {
    const set = getDeletedLogIds();
    set.add(id);
    localStorage.setItem(DELETED_LOGS_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // ignore
  }
}

export function getPHTDayRangeIso(dateStr: string) {
  // ISO boundaries for the entire PHT calendar day (UTC+8)
  const start = new Date(`${dateStr}T00:00:00+08:00`).toISOString();
  const end = new Date(`${dateStr}T23:59:59.999+08:00`).toISOString();
  return { start, end };
}

export interface DeleteModalTarget {
  type: 'single_record' | 'batch_records' | 'single_log' | 'batch_logs';
  title: string;
  subtitle: string;
  details: string;
  ids: number[];
}

export const LibrarianRecordsAndLogs: React.FC<LibrarianRecordsAndLogsProps> = ({
  mode,
  profile,
  areas,
  todayDate,
  currentSlot,
  isOperatingHours,
  calendarActivities = [],
  closedDaysOfWeek = [],
  onNotify,
  onDataMutated,
}) => {
  const sortedAreas = useMemo(
    () =>
      [...areas]
        .sort((a, b) => a.display_order - b.display_order)
        .map((a) => ({ ...a, color_hex: getLiteraryAreaColor(a.code, a.color_hex) })),
    [areas]
  );
  const areaById = useMemo(() => {
    const map = new Map<number, LibraryArea>();
    sortedAreas.forEach((a) => map.set(a.id, a));
    return map;
  }, [sortedAreas]);

  // Records filters & pagination
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState<string>(todayDate || getTodayPHT());
  const [areaFilter, setAreaFilter] = useState<number | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'CORRECTED' | 'ANOMALY'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [records, setRecords] = useState<OccupancyRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState<boolean>(false);
  const [recordsSubTab, setRecordsSubTab] = useState<'submitted' | 'missing'>('submitted');
  const [recordsPage, setRecordsPage] = useState<number>(1);
  const [missingPage, setMissingPage] = useState<number>(1);

  // Backfill modal
  const [backfillTarget, setBackfillTarget] = useState<MissingIntervalItem | null>(null);
  const [backfillCount, setBackfillCount] = useState<number>(0);
  const [backfillReason, setBackfillReason] = useState<string>('');
  const [backfillNotes, setBackfillNotes] = useState<string>('');
  const [savingBackfill, setSavingBackfill] = useState<boolean>(false);

  // Logs state & pagination
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState<boolean>(false);
  const [logActionFilter, setLogActionFilter] = useState<ActivityActionType | 'ALL'>('ALL');
  const [logSearch, setLogSearch] = useState<string>('');
  const [logsPage, setLogsPage] = useState<number>(1);

  // Selection & Delete State
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<number>>(new Set());
  const [selectedLogIds, setSelectedLogIds] = useState<Set<number>>(new Set());
  const [deleteModal, setDeleteModal] = useState<DeleteModalTarget | null>(null);
  const [verifyPassword, setVerifyPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);

  // Dedicated Batch Deletion Dialogs
  const [showRecordBatchModal, setShowRecordBatchModal] = useState<boolean>(false);
  const [recordBatchTab, setRecordBatchTab] = useState<'date' | 'date_time' | 'filtered'>('date');
  const [recordBatchDate, setRecordBatchDate] = useState<string>(() => todayDate || getTodayPHT());
  const [recordBatchSlot, setRecordBatchSlot] = useState<string>('08:00');
  const [recordBatchAreaId, setRecordBatchAreaId] = useState<number | 'ALL'>('ALL');
  const [recordBatchCandidates, setRecordBatchCandidates] = useState<number[]>([]);
  const [loadingRecordCandidates, setLoadingRecordCandidates] = useState<boolean>(false);

  const [showLogBatchModal, setShowLogBatchModal] = useState<boolean>(false);
  const [logBatchTab, setLogBatchTab] = useState<'date' | 'range' | 'older' | 'filtered'>('date');
  const [logBatchDate, setLogBatchDate] = useState<string>(() => todayDate || getTodayPHT());
  const [logBatchStartDate, setLogBatchStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [logBatchEndDate, setLogBatchEndDate] = useState<string>(() => todayDate || getTodayPHT());
  const [logBatchDaysOlder, setLogBatchDaysOlder] = useState<number>(30);
  const [logBatchActionFilter, setLogBatchActionFilter] = useState<ActivityActionType | 'ALL'>('ALL');
  const [logBatchCandidates, setLogBatchCandidates] = useState<number[]>([]);
  const [loadingLogCandidates, setLoadingLogCandidates] = useState<boolean>(false);

  const loadHistoricalRecords = useCallback(async () => {
    setLoadingRecords(true);
    const { data, error } = await supabase.rpc('get_occupancy_records_range', {
      p_start_date: startDate,
      p_end_date: endDate,
      p_area_id: areaFilter === 'ALL' ? null : areaFilter,
    });
    if (error) {
      onNotify('error', `Could not load records: ${error.message}`);
      setLoadingRecords(false);
      return;
    }
    const deletedSet = getDeletedRecordIds();
    const rawList = Array.isArray(data) ? (data as OccupancyRecord[]) : [];
    const list = rawList.filter((r) => !deletedSet.has(r.id));
    list.sort((a, b) => {
      if (a.record_date !== b.record_date) return b.record_date.localeCompare(a.record_date);
      return b.time_slot.localeCompare(a.time_slot);
    });
    setRecords(list);
    setRecordsPage(1);
    setMissingPage(1);
    setLoadingRecords(false);
  }, [startDate, endDate, areaFilter, onNotify]);

  const loadActivityLogs = useCallback(async () => {
    setLoadingLogs(true);
    let query = supabase
      .from('activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (logActionFilter !== 'ALL' && (logActionFilter as string) !== 'calendar_suspension') {
      query = query.eq('action_type', logActionFilter);
    }
    const { data, error } = await query;
    if (error) {
      onNotify('error', `Could not load activity logs: ${error.message}`);
      setLoadingLogs(false);
      return;
    }
    const deletedSet = getDeletedLogIds();
    const rawList = (data || []) as ActivityLog[];
    const list = rawList.filter((l) => !deletedSet.has(l.id));
    setLogs(list);
    setLogsPage(1);
    setLoadingLogs(false);
  }, [logActionFilter, onNotify]);

  useEffect(() => {
    if (mode === 'records') {
      loadHistoricalRecords();
    } else {
      loadActivityLogs();
    }
  }, [mode, loadHistoricalRecords, loadActivityLogs]);

  const missingIntervals = useMemo(() => {
    const targetAreas =
      areaFilter === 'ALL' ? sortedAreas : sortedAreas.filter((a) => a.id === areaFilter);
    const computed = computeStatisticalReport({
      reportType: 'range',
      startDate,
      endDate,
      areas: targetAreas,
      records,
      todayDate,
      currentSlot,
      isOperatingHours,
      calendarActivities,
      closedDaysOfWeek,
    });
    return computed.missingIntervals;
  }, [areaFilter, sortedAreas, startDate, endDate, records, todayDate, currentSlot, isOperatingHours, calendarActivities, closedDaysOfWeek]);

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return records.filter((r) => {
      const area = areaById.get(r.area_id);
      const isAnomaly = r.occupancy_count === 0 || (area ? r.occupancy_count > area.capacity : false);
      if (statusFilter === 'CORRECTED' && !r.is_corrected) return false;
      if (statusFilter === 'ANOMALY' && !isAnomaly) return false;
      if (!q) return true;
      return (
        r.record_date.includes(q) ||
        (area?.name || '').toLowerCase().includes(q) ||
        formatSlotRangeLabel(r.time_slot).toLowerCase().includes(q) ||
        formatSlotLabel(r.time_slot).toLowerCase().includes(q) ||
        (r.recorded_by_name || '').toLowerCase().includes(q) ||
        (r.notes || '').toLowerCase().includes(q)
      );
    });
  }, [records, statusFilter, searchQuery, areaById]);

  const filteredLogs = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    return logs
      .filter((l) => {
        const parsed = parseCalendarLogDetails(l, calendarActivities);
        if ((logActionFilter as string) === 'calendar_suspension') {
          return parsed.isCalendar;
        }
        if (logActionFilter === 'staff_created' || logActionFilter === 'staff_updated') {
          if (parsed.isCalendar) return false;
        }
        return true;
      })
      .filter((l) => {
        if (!q) return true;
        const parsed = parseCalendarLogDetails(l, calendarActivities);
        return (
          l.actor_name.toLowerCase().includes(q) ||
          l.description.toLowerCase().includes(q) ||
          parsed.details.toLowerCase().includes(q) ||
          parsed.badgeLabel.toLowerCase().includes(q) ||
          (l.area_name || '').toLowerCase().includes(q)
        );
      });
  }, [logs, logSearch, logActionFilter, calendarActivities]);

  const totalRecordPages = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
  const pagedRecords = useMemo(
    () => filteredRecords.slice((recordsPage - 1) * PAGE_SIZE, recordsPage * PAGE_SIZE),
    [filteredRecords, recordsPage]
  );

  const totalMissingPages = Math.max(1, Math.ceil(missingIntervals.length / PAGE_SIZE));
  const pagedMissing = useMemo(
    () => missingIntervals.slice((missingPage - 1) * PAGE_SIZE, missingPage * PAGE_SIZE),
    [missingIntervals, missingPage]
  );

  const totalLogPages = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
  const pagedLogs = useMemo(
    () => filteredLogs.slice((logsPage - 1) * PAGE_SIZE, logsPage * PAGE_SIZE),
    [filteredLogs, logsPage]
  );

  const handleExportFilteredCSV = () => {
    const headers = ['Date', 'Time Slot', 'Library Area', 'Count', 'Recorded By', 'Corrected', 'Notes'];
    const rows = filteredRecords.map((r) => [
      r.record_date,
      formatSlotRangeLabel(r.time_slot),
      areaById.get(r.area_id)?.name || `Area #${r.area_id}`,
      r.occupancy_count,
      `"${(r.recorded_by_name || '').replace(/"/g, '""')}"`,
      r.is_corrected ? 'Yes' : 'No',
      `"${(r.notes || '').replace(/"/g, '""')}"`,
    ]);
    const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `LIRC_STAT_Filtered_Records_${startDate}_to_${endDate}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    onNotify('success', `Exported ${filteredRecords.length} records to CSV.`);
  };

  const handleExportSelectedRecordsCSV = () => {
    if (selectedRecordIds.size === 0) return;
    const selectedList = filteredRecords.filter((r) => selectedRecordIds.has(r.id));
    const headers = ['Date', 'Time Slot', 'Library Area', 'Count', 'Recorded By', 'Corrected', 'Notes'];
    const rows = selectedList.map((r) => [
      r.record_date,
      formatSlotRangeLabel(r.time_slot),
      areaById.get(r.area_id)?.name || `Area #${r.area_id}`,
      r.occupancy_count,
      `"${(r.recorded_by_name || '').replace(/"/g, '""')}"`,
      r.is_corrected ? 'Yes' : 'No',
      `"${(r.notes || '').replace(/"/g, '""')}"`,
    ]);
    const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `LIRC_STAT_Selected_${selectedList.length}_Records.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    onNotify('success', `Exported ${selectedList.length} selected records to CSV.`);
  };

  const handleExportSelectedLogsCSV = () => {
    if (selectedLogIds.size === 0) return;
    const selectedList = filteredLogs.filter((l) => selectedLogIds.has(l.id));
    const headers = ['Timestamp (PHT)', 'Action Type', 'Staff Member', 'Role', 'Description'];
    const rows = selectedList.map((l) => [
      formatTimestampPHT(l.created_at),
      l.action_type,
      `"${(l.actor_name || '').replace(/"/g, '""')}"`,
      l.actor_role,
      `"${(l.description || '').replace(/"/g, '""')}"`,
    ]);
    const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `LIRC_STAT_Selected_${selectedList.length}_Logs.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    onNotify('success', `Exported ${selectedList.length} selected activity logs to CSV.`);
  };

  const handleSubmitBackfill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!backfillTarget) return;
    setSavingBackfill(true);
    const { error } = await supabase.rpc('admin_backfill_missing_record', {
      p_record_date: backfillTarget.date,
      p_time_slot: backfillTarget.timeSlot,
      p_area_id: backfillTarget.areaId,
      p_occupancy_count: Math.round(backfillCount),
      p_reason: backfillReason.trim(),
      p_notes: backfillNotes.trim(),
    });
    setSavingBackfill(false);

    if (error) {
      onNotify('error', error.message);
      return;
    }

    onNotify('success', 'Missing interval recorded and saved to Activity Logs.');
    setBackfillTarget(null);
    setBackfillReason('');
    setBackfillNotes('');
    await loadHistoricalRecords();
    onDataMutated();
  };

  // Record selection helpers
  const isAllRecordsOnPageSelected = useMemo(() => {
    if (pagedRecords.length === 0) return false;
    return pagedRecords.every((r) => selectedRecordIds.has(r.id));
  }, [pagedRecords, selectedRecordIds]);

  const toggleRecordSelect = (id: number) => {
    setSelectedRecordIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllRecordsOnPage = () => {
    if (isAllRecordsOnPageSelected) {
      setSelectedRecordIds((prev) => {
        const next = new Set(prev);
        pagedRecords.forEach((r) => next.delete(r.id));
        return next;
      });
    } else {
      setSelectedRecordIds((prev) => {
        const next = new Set(prev);
        pagedRecords.forEach((r) => next.add(r.id));
        return next;
      });
    }
  };

  const clearRecordSelection = () => setSelectedRecordIds(new Set());
  const selectAllFilteredRecords = () => {
    setSelectedRecordIds(new Set(filteredRecords.map((r) => r.id)));
  };

  // Log selection helpers
  const isAllLogsOnPageSelected = useMemo(() => {
    if (pagedLogs.length === 0) return false;
    return pagedLogs.every((l) => selectedLogIds.has(l.id));
  }, [pagedLogs, selectedLogIds]);

  const toggleLogSelect = (id: number) => {
    setSelectedLogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllLogsOnPage = () => {
    if (isAllLogsOnPageSelected) {
      setSelectedLogIds((prev) => {
        const next = new Set(prev);
        pagedLogs.forEach((l) => next.delete(l.id));
        return next;
      });
    } else {
      setSelectedLogIds((prev) => {
        const next = new Set(prev);
        pagedLogs.forEach((l) => next.add(l.id));
        return next;
      });
    }
  };

  const clearLogSelection = () => setSelectedLogIds(new Set());
  const selectAllFilteredLogs = () => {
    setSelectedLogIds(new Set(filteredLogs.map((l) => l.id)));
  };

  // Dynamic candidate detection for Record Batch Delete Modal
  useEffect(() => {
    if (!showRecordBatchModal) return;
    let isCancelled = false;

    const fetchRecordCandidates = async () => {
      setLoadingRecordCandidates(true);
      if (recordBatchTab === 'filtered') {
        setRecordBatchCandidates(filteredRecords.map((r) => r.id));
        setLoadingRecordCandidates(false);
        return;
      }

      let query = supabase.from('occupancy_records').select('id');
      query = query.eq('record_date', recordBatchDate);
      if (recordBatchTab === 'date_time') {
        query = query.eq('time_slot', recordBatchSlot);
      }
      if (recordBatchAreaId !== 'ALL') {
        query = query.eq('area_id', recordBatchAreaId);
      }

      const { data, error } = await query;
      if (isCancelled) return;
      if (error) {
        setRecordBatchCandidates([]);
      } else {
        const deletedSet = getDeletedRecordIds();
        const validIds = (data || []).map((r: any) => Number(r.id)).filter((id) => !deletedSet.has(id));
        setRecordBatchCandidates(validIds);
      }
      setLoadingRecordCandidates(false);
    };

    fetchRecordCandidates();
    return () => {
      isCancelled = true;
    };
  }, [
    showRecordBatchModal,
    recordBatchTab,
    recordBatchDate,
    recordBatchSlot,
    recordBatchAreaId,
    filteredRecords,
  ]);

  // Dynamic candidate detection for Activity Log Batch Delete Modal
  useEffect(() => {
    if (!showLogBatchModal) return;
    let isCancelled = false;

    const fetchLogCandidates = async () => {
      setLoadingLogCandidates(true);
      if (logBatchTab === 'filtered') {
        setLogBatchCandidates(filteredLogs.map((l) => l.id));
        setLoadingLogCandidates(false);
        return;
      }

      let query = supabase.from('activity_logs').select('id');
      if (logBatchTab === 'date') {
        const { start, end } = getPHTDayRangeIso(logBatchDate);
        query = query.gte('created_at', start).lte('created_at', end);
      } else if (logBatchTab === 'range') {
        const start = new Date(`${logBatchStartDate}T00:00:00+08:00`).toISOString();
        const end = new Date(`${logBatchEndDate}T23:59:59.999+08:00`).toISOString();
        query = query.gte('created_at', start).lte('created_at', end);
      } else if (logBatchTab === 'older') {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - logBatchDaysOlder);
        query = query.lte('created_at', cutoff.toISOString());
      }

      if (logBatchActionFilter !== 'ALL') {
        query = query.eq('action_type', logBatchActionFilter);
      }

      const { data, error } = await query;
      if (isCancelled) return;
      if (error) {
        setLogBatchCandidates([]);
      } else {
        const deletedSet = getDeletedLogIds();
        const validIds = (data || []).map((l: any) => Number(l.id)).filter((id) => !deletedSet.has(id));
        setLogBatchCandidates(validIds);
      }
      setLoadingLogCandidates(false);
    };

    fetchLogCandidates();
    return () => {
      isCancelled = true;
    };
  }, [
    showLogBatchModal,
    logBatchTab,
    logBatchDate,
    logBatchStartDate,
    logBatchEndDate,
    logBatchDaysOlder,
    logBatchActionFilter,
    filteredLogs,
  ]);

  // Delete Prompt Handlers
  const promptDeleteSingleRecord = (rec: OccupancyRecord) => {
    const area = areaById.get(rec.area_id);
    setDeleteModal({
      type: 'single_record',
      title: 'Delete Occupancy Record',
      subtitle: `Permanently delete record #${rec.id}?`,
      details: `${formatShortDate(rec.record_date)} · ${formatSlotRangeLabel(rec.time_slot)} · ${area?.name || 'Area'} · Count: ${rec.occupancy_count}`,
      ids: [rec.id],
    });
    setVerifyPassword('');
    setShowPassword(false);
    setVerifyError(null);
  };

  const promptDeleteBatchRecords = () => {
    if (selectedRecordIds.size === 0) return;
    const count = selectedRecordIds.size;
    setDeleteModal({
      type: 'batch_records',
      title: 'Delete Selected Records',
      subtitle: `Permanently delete ${count} occupancy record${count > 1 ? 's' : ''}?`,
      details: `${count} record${count > 1 ? 's' : ''} currently selected. This action cannot be undone.`,
      ids: Array.from(selectedRecordIds),
    });
    setVerifyPassword('');
    setShowPassword(false);
    setVerifyError(null);
  };

  const promptBatchDeleteRecordsByDate = async (targetDate: string) => {
    const deletedSet = getDeletedRecordIds();
    // Query all records for that date from supabase to be exhaustive
    const { data } = await supabase
      .from('occupancy_records')
      .select('id, record_date, time_slot, area_id, occupancy_count')
      .eq('record_date', targetDate);
    const valid = (data || []).filter((r: any) => !deletedSet.has(Number(r.id)));

    if (valid.length === 0) {
      onNotify('error', `No occupancy records found for date ${targetDate}.`);
      return;
    }

    setDeleteModal({
      type: 'batch_records',
      title: 'Delete All Records on Date',
      subtitle: `Permanently delete ${valid.length} record${valid.length > 1 ? 's' : ''} on ${formatShortDate(targetDate)}?`,
      details: `Date: ${targetDate} (${getDayOfWeekName(targetDate)}). Permanently deletes all area submissions recorded on this date.`,
      ids: valid.map((r: any) => Number(r.id)),
    });
    setVerifyPassword('');
    setShowPassword(false);
    setVerifyError(null);
  };

  const promptBatchDeleteRecordsByTimeSlot = async (targetDate: string, targetSlot: string) => {
    const deletedSet = getDeletedRecordIds();
    const { data } = await supabase
      .from('occupancy_records')
      .select('id, record_date, time_slot, area_id, occupancy_count')
      .eq('record_date', targetDate)
      .eq('time_slot', targetSlot);
    const valid = (data || []).filter((r: any) => !deletedSet.has(Number(r.id)));

    if (valid.length === 0) {
      onNotify('error', `No records found on ${targetDate} at ${formatSlotRangeLabel(targetSlot)}.`);
      return;
    }

    setDeleteModal({
      type: 'batch_records',
      title: 'Delete All Records for Time Slot',
      subtitle: `Permanently delete ${valid.length} record${valid.length > 1 ? 's' : ''} at ${formatSlotRangeLabel(targetSlot)}?`,
      details: `Date: ${targetDate} · Time: ${formatSlotRangeLabel(targetSlot)} across all library areas.`,
      ids: valid.map((r: any) => Number(r.id)),
    });
    setVerifyPassword('');
    setShowPassword(false);
    setVerifyError(null);
  };

  const promptDeleteSingleLog = (log: ActivityLog) => {
    const parsed = parseCalendarLogDetails(log, calendarActivities);
    setDeleteModal({
      type: 'single_log',
      title: 'Delete Activity Log',
      subtitle: `Permanently remove activity log #${log.id}?`,
      details: `${formatTimestampPHT(log.created_at)} · ${log.actor_name} · ${parsed.badgeLabel}: ${parsed.details}`,
      ids: [log.id],
    });
    setVerifyPassword('');
    setShowPassword(false);
    setVerifyError(null);
  };

  const promptDeleteBatchLogs = () => {
    if (selectedLogIds.size === 0) return;
    const count = selectedLogIds.size;
    setDeleteModal({
      type: 'batch_logs',
      title: 'Delete Selected Activity Logs',
      subtitle: `Permanently remove ${count} activity log${count > 1 ? 's' : ''}?`,
      details: `${count} activity log${count > 1 ? 's' : ''} currently selected. This action cannot be undone.`,
      ids: Array.from(selectedLogIds),
    });
    setVerifyPassword('');
    setShowPassword(false);
    setVerifyError(null);
  };

  const promptBatchDeleteLogsByDate = async (targetDate: string) => {
    const { start, end } = getPHTDayRangeIso(targetDate);
    const { data } = await supabase
      .from('activity_logs')
      .select('id')
      .gte('created_at', start)
      .lte('created_at', end);
    const deleted = getDeletedLogIds();
    const validIds = (data || []).map((l: any) => Number(l.id)).filter((id) => !deleted.has(id));

    if (validIds.length === 0) {
      onNotify('error', `No activity logs found for date ${targetDate}.`);
      return;
    }

    setDeleteModal({
      type: 'batch_logs',
      title: 'Delete All Logs on Date',
      subtitle: `Permanently delete ${validIds.length} activity log${validIds.length > 1 ? 's' : ''} on ${formatShortDate(targetDate)}?`,
      details: `Date: ${targetDate} (${getDayOfWeekName(targetDate)}). Permanently purges ${validIds.length} audit entry/entries.`,
      ids: validIds,
    });
    setVerifyPassword('');
    setShowPassword(false);
    setVerifyError(null);
  };

  const handleConfirmDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deleteModal) return;

    if (!verifyPassword.trim()) {
      setVerifyError('Please enter your password to authorize deletion.');
      return;
    }

    setIsVerifying(true);
    setVerifyError(null);

    // Identify librarian auth email
    let email = profile?.email;
    if (!email) {
      const { data: authData } = await supabase.auth.getUser();
      email = authData?.user?.email;
    }

    if (!email) {
      setIsVerifying(false);
      setVerifyError('Unable to identify active librarian account. Please re-login.');
      return;
    }

    // Verify password against Supabase Auth
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password: verifyPassword.trim(),
    });

    if (authError) {
      setIsVerifying(false);
      setVerifyError('Incorrect password. Verification failed.');
      return;
    }

    // Password verified! Execute deletion
    try {
      const idsToDelete = deleteModal.ids;
      if (deleteModal.type === 'single_record' || deleteModal.type === 'batch_records') {
        if (idsToDelete.length === 1) {
          const id = idsToDelete[0];
          const { error: rpcErr } = await supabase.rpc('admin_delete_occupancy_record', {
            p_record_id: id,
          });
          if (rpcErr) {
            await supabase.from('occupancy_records').delete().eq('id', id);
          }
          recordDeletedRecordId(id);
        } else {
          // Attempt batch RPC
          const { error: rpcErr } = await supabase.rpc('admin_batch_delete_occupancy_records', {
            p_record_ids: idsToDelete,
          });
          if (rpcErr) {
            // Direct delete in chunks of 100
            for (let i = 0; i < idsToDelete.length; i += 100) {
              const chunk = idsToDelete.slice(i, i + 100);
              await supabase.from('occupancy_records').delete().in('id', chunk);
            }
          }
          idsToDelete.forEach((id) => recordDeletedRecordId(id));
        }

        setSelectedRecordIds((prev) => {
          const next = new Set(prev);
          idsToDelete.forEach((id) => next.delete(id));
          return next;
        });

        onNotify(
          'success',
          `Successfully deleted ${idsToDelete.length} occupancy record${idsToDelete.length > 1 ? 's' : ''}.`
        );
        setDeleteModal(null);
        setVerifyPassword('');
        setShowRecordBatchModal(false);
        await loadHistoricalRecords();
        onDataMutated();
      } else {
        if (idsToDelete.length === 1) {
          const id = idsToDelete[0];
          const { error: rpcErr } = await supabase.rpc('admin_delete_activity_log', {
            p_log_id: id,
          });
          if (rpcErr) {
            await supabase.from('activity_logs').delete().eq('id', id);
          }
          recordDeletedLogId(id);
        } else {
          // Attempt batch RPC
          const { error: rpcErr } = await supabase.rpc('admin_batch_delete_activity_logs', {
            p_log_ids: idsToDelete,
          });
          if (rpcErr) {
            // Direct delete in chunks of 100
            for (let i = 0; i < idsToDelete.length; i += 100) {
              const chunk = idsToDelete.slice(i, i + 100);
              await supabase.from('activity_logs').delete().in('id', chunk);
            }
          }
          idsToDelete.forEach((id) => recordDeletedLogId(id));
        }

        setSelectedLogIds((prev) => {
          const next = new Set(prev);
          idsToDelete.forEach((id) => next.delete(id));
          return next;
        });

        onNotify(
          'success',
          `Successfully deleted ${idsToDelete.length} activity log${idsToDelete.length > 1 ? 's' : ''}.`
        );
        setDeleteModal(null);
        setVerifyPassword('');
        setShowLogBatchModal(false);
        await loadActivityLogs();
        onDataMutated();
      }
    } catch (err: any) {
      setVerifyError(err.message || 'An error occurred during deletion.');
    } finally {
      setIsVerifying(false);
    }
  };

  const renderPasswordVerificationModal = () => {
    if (!deleteModal) return null;

    return createPortal(
      <div className="fixed inset-0 z-[9999] bg-[#332F2B]/65 dark:bg-black/80 backdrop-blur-[2px] flex items-center justify-center p-4 animate-literary-fade">
        <div className="literary-card shadow-2xl max-w-md w-full p-6 border-2 border-[#A83232]/30 bg-[#FFFFFF] dark:bg-[#1E1B18]">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FEF2F2] dark:bg-[#3D1414] border border-[#F87171]/40 flex items-center justify-center text-[#A83232] shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-heading font-bold text-[#332F2B] dark:text-[#FAF5EE]">
                  {deleteModal.title}
                </h3>
                <p className="text-xs text-[#A83232] font-semibold mt-0.5">
                  Librarian Verification Required
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={isVerifying}
              onClick={() => {
                setDeleteModal(null);
                setVerifyPassword('');
                setVerifyError(null);
              }}
              className="p-1.5 rounded-lg hover:bg-[#F5EBDD] dark:hover:bg-[#2A2420] text-[#6E665E] dark:text-[#A89F91] cursor-pointer disabled:opacity-40"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mb-4 p-3 rounded-xl bg-[#FAF5EE] dark:bg-[#26201B] border border-[#E6D7C3] dark:border-[#3D342C] space-y-1.5">
            <p className="text-xs font-semibold text-[#332F2B] dark:text-[#FAF5EE]">
              {deleteModal.subtitle}
            </p>
            <p className="text-[11px] text-[#6E665E] dark:text-[#A89F91] leading-relaxed break-words font-stat">
              {deleteModal.details}
            </p>
          </div>

          <div className="mb-4 p-3 rounded-xl bg-[#FEF2F2] dark:bg-[#3D1414]/50 border border-[#FCA5A5]/40 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-[#A83232] shrink-0 mt-0.5" />
            <p className="text-[11px] text-[#991B1B] dark:text-[#FCA5A5] leading-relaxed">
              This action permanently deletes this data from the registry. Please confirm your identity by entering your librarian password below.
            </p>
          </div>

          <form onSubmit={handleConfirmDelete} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#FAF5EE] mb-1.5 flex items-center justify-between">
                <span>Enter Your Password</span>
                <span className="text-[10px] text-[#6E665E] dark:text-[#A89F91] font-normal">
                  {profile?.email || 'Librarian account'}
                </span>
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#6E665E] dark:text-[#A89F91] absolute left-3 top-3" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoFocus
                  value={verifyPassword}
                  onChange={(e) => {
                    setVerifyPassword(e.target.value);
                    if (verifyError) setVerifyError(null);
                  }}
                  placeholder="Your librarian password..."
                  className="w-full h-10 pl-9 pr-10 rounded-xl bg-[#FFFFFF] dark:bg-[#151210] border border-[#E6D7C3] dark:border-[#3D342C] text-xs font-medium text-[#332F2B] dark:text-[#FAF5EE] focus:outline-none focus:ring-2 focus:ring-[#A83232]/30 focus:border-[#A83232]"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-3 text-[#6E665E] dark:text-[#A89F91] hover:text-[#332F2B] dark:hover:text-[#FAF5EE]"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {verifyError && (
                <div className="mt-2 p-2.5 rounded-lg bg-[#FEF2F2] dark:bg-[#3D1414] border border-[#F87171] text-[#991B1B] dark:text-[#FCA5A5] text-xs font-medium flex items-center gap-2 animate-literary-fade">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>{verifyError}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E6D7C3] dark:border-[#3D342C]">
              <button
                type="button"
                disabled={isVerifying}
                onClick={() => {
                  setDeleteModal(null);
                  setVerifyPassword('');
                  setVerifyError(null);
                }}
                className="h-9 px-4 rounded-xl border border-[#E6D7C3] dark:border-[#3D342C] bg-[#FFFFFF] dark:bg-[#26201B] text-xs font-semibold text-[#332F2B] dark:text-[#FAF5EE] hover:bg-[#F5EBDD] dark:hover:bg-[#2A2420] cursor-pointer disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isVerifying || !verifyPassword.trim()}
                className="h-9 px-4 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-[#FFFFFF] text-xs font-semibold cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5 shadow-sm"
              >
                {isVerifying ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    Authorize & Delete
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>,
      document.body
    );
  };

  const renderRecordBatchModal = () => {
    if (!showRecordBatchModal) return null;

    const areaName =
      recordBatchAreaId === 'ALL'
        ? 'All Areas'
        : areaById.get(recordBatchAreaId as number)?.name || `Area #${recordBatchAreaId}`;

    const handleProceedToVerification = () => {
      if (recordBatchCandidates.length === 0) return;
      let title = 'Batch Delete Occupancy Records';
      let subtitle = `Permanently delete ${recordBatchCandidates.length} occupancy record(s)?`;
      let details = '';

      if (recordBatchTab === 'date') {
        details = `Date: ${recordBatchDate} (${getDayOfWeekName(recordBatchDate)}) · Area: ${areaName} · Total: ${recordBatchCandidates.length} record(s)`;
      } else if (recordBatchTab === 'date_time') {
        details = `Date: ${recordBatchDate} · Time: ${formatSlotRangeLabel(recordBatchSlot)} · Area: ${areaName} · Total: ${recordBatchCandidates.length} record(s)`;
      } else {
        details = `Current Filter: ${startDate} to ${endDate} · Area: ${areaFilter === 'ALL' ? 'All Areas' : areaById.get(areaFilter as number)?.name} · Status: ${statusFilter} · Total: ${recordBatchCandidates.length} record(s)`;
      }

      setDeleteModal({
        type: 'batch_records',
        title,
        subtitle,
        details,
        ids: recordBatchCandidates,
      });
      setShowRecordBatchModal(false);
      setVerifyPassword('');
      setShowPassword(false);
      setVerifyError(null);
    };

    return createPortal(
      <div className="fixed inset-0 z-[9998] bg-[#332F2B]/65 dark:bg-black/80 backdrop-blur-[2px] flex items-center justify-center p-4 animate-literary-fade">
        <div className="literary-card shadow-2xl max-w-lg w-full p-6 border-2 border-[#A83232]/30 bg-[#FFFFFF] dark:bg-[#1E1B18] space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FEF2F2] dark:bg-[#3D1414] border border-[#F87171]/40 flex items-center justify-center text-[#A83232] shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-heading font-bold text-[#332F2B] dark:text-[#FAF5EE]">
                  Batch Delete Occupancy Records
                </h3>
                <p className="text-xs text-[#6E665E] dark:text-[#A89887] mt-0.5">
                  Select criteria to purge multiple occupancy records simultaneously.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowRecordBatchModal(false)}
              className="p-1.5 rounded-lg hover:bg-[#F5EBDD] dark:hover:bg-[#2A2420] text-[#6E665E] dark:text-[#A89887] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Mode Switcher */}
          <div className="grid grid-cols-3 gap-1 bg-[#F5EBDD] dark:bg-[#2A2420] p-1 rounded-xl text-xs font-semibold">
            <button
              type="button"
              onClick={() => setRecordBatchTab('date')}
              className={`py-2 px-2 rounded-lg transition text-center cursor-pointer ${
                recordBatchTab === 'date'
                  ? 'bg-[#A83232] text-white shadow-xs'
                  : 'text-[#6E665E] dark:text-[#A89887] hover:text-[#332F2B] dark:hover:text-[#FAF5EE]'
              }`}
            >
              By Date
            </button>
            <button
              type="button"
              onClick={() => setRecordBatchTab('date_time')}
              className={`py-2 px-2 rounded-lg transition text-center cursor-pointer ${
                recordBatchTab === 'date_time'
                  ? 'bg-[#A83232] text-white shadow-xs'
                  : 'text-[#6E665E] dark:text-[#A89887] hover:text-[#332F2B] dark:hover:text-[#FAF5EE]'
              }`}
            >
              By Date & Time
            </button>
            <button
              type="button"
              onClick={() => setRecordBatchTab('filtered')}
              className={`py-2 px-2 rounded-lg transition text-center cursor-pointer ${
                recordBatchTab === 'filtered'
                  ? 'bg-[#A83232] text-white shadow-xs'
                  : 'text-[#6E665E] dark:text-[#A89887] hover:text-[#332F2B] dark:hover:text-[#FAF5EE]'
              }`}
            >
              Current Filter
            </button>
          </div>

          {/* Form Content */}
          <div className="space-y-3.5 pt-1">
            {recordBatchTab === 'date' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#FAF5EE] mb-1">
                    Select Target Date
                  </label>
                  <input
                    type="date"
                    value={recordBatchDate}
                    onChange={(e) => setRecordBatchDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] dark:bg-[#151210] border border-[#E6D7C3] dark:border-[#3D342C] text-xs font-stat focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#FAF5EE] mb-1">
                    Library Area
                  </label>
                  <select
                    value={recordBatchAreaId}
                    onChange={(e) =>
                      setRecordBatchAreaId(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))
                    }
                    className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] dark:bg-[#151210] border border-[#E6D7C3] dark:border-[#3D342C] text-xs focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
                  >
                    <option value="ALL">All Areas (Entire Library)</option>
                    {sortedAreas.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {recordBatchTab === 'date_time' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#FAF5EE] mb-1">
                      Select Date
                    </label>
                    <input
                      type="date"
                      value={recordBatchDate}
                      onChange={(e) => setRecordBatchDate(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] dark:bg-[#151210] border border-[#E6D7C3] dark:border-[#3D342C] text-xs font-stat focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#FAF5EE] mb-1">
                      Time Slot
                    </label>
                    <select
                      value={recordBatchSlot}
                      onChange={(e) => setRecordBatchSlot(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] dark:bg-[#151210] border border-[#E6D7C3] dark:border-[#3D342C] text-xs font-stat font-semibold focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
                    >
                      {LIBRARY_TIME_SLOTS.map((slot) => (
                        <option key={slot.value} value={slot.value}>
                          {formatSlotRangeLabel(slot.value)} ({slot.value})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#FAF5EE] mb-1">
                    Library Area
                  </label>
                  <select
                    value={recordBatchAreaId}
                    onChange={(e) =>
                      setRecordBatchAreaId(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))
                    }
                    className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] dark:bg-[#151210] border border-[#E6D7C3] dark:border-[#3D342C] text-xs focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
                  >
                    <option value="ALL">All Areas (Entire Library)</option>
                    {sortedAreas.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {recordBatchTab === 'filtered' && (
              <div className="p-3 rounded-xl bg-[#FAF5EE] dark:bg-[#25201B] border border-[#E6D7C3] dark:border-[#3D342C] text-xs space-y-1.5">
                <div className="flex justify-between text-[#6E665E] dark:text-[#A89887]">
                  <span>Date Range:</span>
                  <strong className="text-[#332F2B] dark:text-[#FAF5EE] font-stat">
                    {startDate} to {endDate}
                  </strong>
                </div>
                <div className="flex justify-between text-[#6E665E] dark:text-[#A89887]">
                  <span>Area Filter:</span>
                  <strong className="text-[#332F2B] dark:text-[#FAF5EE]">
                    {areaFilter === 'ALL' ? 'All Areas' : areaById.get(areaFilter as number)?.name}
                  </strong>
                </div>
                <div className="flex justify-between text-[#6E665E] dark:text-[#A89887]">
                  <span>Status Filter:</span>
                  <strong className="text-[#332F2B] dark:text-[#FAF5EE]">{statusFilter}</strong>
                </div>
              </div>
            )}

            {/* Candidates Result Preview */}
            <div className="p-3.5 rounded-xl bg-[#FEF2F2] dark:bg-[#3D1414]/50 border border-[#FCA5A5]/60 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#A83232] shrink-0" />
                <span className="text-xs font-semibold text-[#991B1B] dark:text-[#FCA5A5]">
                  {loadingRecordCandidates
                    ? 'Scanning matching records...'
                    : `${recordBatchCandidates.length} occupancy record${recordBatchCandidates.length === 1 ? '' : 's'} identified`}
                </span>
              </div>
              <span className="font-stat text-sm font-bold text-[#A83232]">
                {loadingRecordCandidates ? '...' : recordBatchCandidates.length}
              </span>
            </div>

            <p className="text-[11px] text-[#6E665E] dark:text-[#A89887] leading-relaxed">
              Upon continuing, you will be prompted to authorize this deletion with your librarian password. This action cannot be reversed.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E6D7C3] dark:border-[#3D342C]">
            <button
              type="button"
              onClick={() => setShowRecordBatchModal(false)}
              className="h-9 px-4 rounded-xl border border-[#E6D7C3] dark:border-[#3D342C] bg-[#FFFFFF] dark:bg-[#26201B] text-xs font-semibold text-[#332F2B] dark:text-[#FAF5EE] hover:bg-[#F5EBDD] dark:hover:bg-[#2A2420] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={loadingRecordCandidates || recordBatchCandidates.length === 0}
              onClick={handleProceedToVerification}
              className="h-9 px-4 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-[#FFFFFF] text-xs font-semibold cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5 shadow-sm"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Continue to Authorization ({recordBatchCandidates.length})
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  };

  const renderLogBatchModal = () => {
    if (!showLogBatchModal) return null;

    const handleProceedToVerification = () => {
      if (logBatchCandidates.length === 0) return;
      let title = 'Batch Delete Activity Logs';
      let subtitle = `Permanently delete ${logBatchCandidates.length} activity log(s)?`;
      let details = '';

      if (logBatchTab === 'date') {
        details = `Date: ${logBatchDate} (${getDayOfWeekName(logBatchDate)}) · Action: ${logBatchActionFilter} · Total: ${logBatchCandidates.length} log(s)`;
      } else if (logBatchTab === 'range') {
        details = `Date Range: ${logBatchStartDate} to ${logBatchEndDate} · Action: ${logBatchActionFilter} · Total: ${logBatchCandidates.length} log(s)`;
      } else if (logBatchTab === 'older') {
        details = `Retention Purge: Logs older than ${logBatchDaysOlder} days · Total: ${logBatchCandidates.length} log(s)`;
      } else {
        details = `Current View: Action: ${logActionFilter} · Search: "${logSearch || 'None'}" · Total: ${logBatchCandidates.length} log(s)`;
      }

      setDeleteModal({
        type: 'batch_logs',
        title,
        subtitle,
        details,
        ids: logBatchCandidates,
      });
      setShowLogBatchModal(false);
      setVerifyPassword('');
      setShowPassword(false);
      setVerifyError(null);
    };

    return createPortal(
      <div className="fixed inset-0 z-[9998] bg-[#332F2B]/65 dark:bg-black/80 backdrop-blur-[2px] flex items-center justify-center p-4 animate-literary-fade">
        <div className="literary-card shadow-2xl max-w-lg w-full p-6 border-2 border-[#A83232]/30 bg-[#FFFFFF] dark:bg-[#1E1B18] space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FEF2F2] dark:bg-[#3D1414] border border-[#F87171]/40 flex items-center justify-center text-[#A83232] shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-heading font-bold text-[#332F2B] dark:text-[#FAF5EE]">
                  Batch Delete Activity Logs
                </h3>
                <p className="text-xs text-[#6E665E] dark:text-[#A89887] mt-0.5">
                  Purge audit trail logs by date, date range, or retention period.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowLogBatchModal(false)}
              className="p-1.5 rounded-lg hover:bg-[#F5EBDD] dark:hover:bg-[#2A2420] text-[#6E665E] dark:text-[#A89887] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Mode Switcher */}
          <div className="grid grid-cols-4 gap-1 bg-[#F5EBDD] dark:bg-[#2A2420] p-1 rounded-xl text-xs font-semibold">
            <button
              type="button"
              onClick={() => setLogBatchTab('date')}
              className={`py-2 px-1 rounded-lg transition text-center cursor-pointer ${
                logBatchTab === 'date'
                  ? 'bg-[#A83232] text-white shadow-xs'
                  : 'text-[#6E665E] dark:text-[#A89887] hover:text-[#332F2B] dark:hover:text-[#FAF5EE]'
              }`}
            >
              By Date
            </button>
            <button
              type="button"
              onClick={() => setLogBatchTab('range')}
              className={`py-2 px-1 rounded-lg transition text-center cursor-pointer ${
                logBatchTab === 'range'
                  ? 'bg-[#A83232] text-white shadow-xs'
                  : 'text-[#6E665E] dark:text-[#A89887] hover:text-[#332F2B] dark:hover:text-[#FAF5EE]'
              }`}
            >
              Date Range
            </button>
            <button
              type="button"
              onClick={() => setLogBatchTab('older')}
              className={`py-2 px-1 rounded-lg transition text-center cursor-pointer ${
                logBatchTab === 'older'
                  ? 'bg-[#A83232] text-white shadow-xs'
                  : 'text-[#6E665E] dark:text-[#A89887] hover:text-[#332F2B] dark:hover:text-[#FAF5EE]'
              }`}
            >
              Older Than
            </button>
            <button
              type="button"
              onClick={() => setLogBatchTab('filtered')}
              className={`py-2 px-1 rounded-lg transition text-center cursor-pointer ${
                logBatchTab === 'filtered'
                  ? 'bg-[#A83232] text-white shadow-xs'
                  : 'text-[#6E665E] dark:text-[#A89887] hover:text-[#332F2B] dark:hover:text-[#FAF5EE]'
              }`}
            >
              Current View
            </button>
          </div>

          {/* Form Content */}
          <div className="space-y-3.5 pt-1">
            {logBatchTab === 'date' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#FAF5EE] mb-1">
                    Select Date
                  </label>
                  <input
                    type="date"
                    value={logBatchDate}
                    onChange={(e) => setLogBatchDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] dark:bg-[#151210] border border-[#E6D7C3] dark:border-[#3D342C] text-xs font-stat focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#FAF5EE] mb-1">
                    Activity Type
                  </label>
                  <select
                    value={logBatchActionFilter}
                    onChange={(e) => setLogBatchActionFilter(e.target.value as any)}
                    className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] dark:bg-[#151210] border border-[#E6D7C3] dark:border-[#3D342C] text-xs focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
                  >
                    <option value="ALL">All Activities</option>
                    <option value="calendar_suspension">Class Suspensions</option>
                    <option value="occupancy_submitted">Completed Submissions</option>
                    <option value="record_corrected">Modified Records</option>
                    <option value="record_backfilled">Added Missing</option>
                    <option value="session_started">Active Sessions</option>
                    <option value="session_ended">Exited Area</option>
                    <option value="user_login">Signed In</option>
                    <option value="user_logout">Signed Out</option>
                  </select>
                </div>
              </div>
            )}

            {logBatchTab === 'range' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#FAF5EE] mb-1">
                      From Date
                    </label>
                    <input
                      type="date"
                      value={logBatchStartDate}
                      onChange={(e) => setLogBatchStartDate(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] dark:bg-[#151210] border border-[#E6D7C3] dark:border-[#3D342C] text-xs font-stat focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#FAF5EE] mb-1">
                      To Date
                    </label>
                    <input
                      type="date"
                      value={logBatchEndDate}
                      onChange={(e) => setLogBatchEndDate(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] dark:bg-[#151210] border border-[#E6D7C3] dark:border-[#3D342C] text-xs font-stat focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#FAF5EE] mb-1">
                    Activity Type
                  </label>
                  <select
                    value={logBatchActionFilter}
                    onChange={(e) => setLogBatchActionFilter(e.target.value as any)}
                    className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] dark:bg-[#151210] border border-[#E6D7C3] dark:border-[#3D342C] text-xs focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
                  >
                    <option value="ALL">All Activities</option>
                    <option value="calendar_suspension">Class Suspensions</option>
                    <option value="occupancy_submitted">Completed Submissions</option>
                    <option value="record_corrected">Modified Records</option>
                    <option value="record_backfilled">Added Missing</option>
                    <option value="session_started">Active Sessions</option>
                    <option value="session_ended">Exited Area</option>
                    <option value="user_login">Signed In</option>
                    <option value="user_logout">Signed Out</option>
                  </select>
                </div>
              </div>
            )}

            {logBatchTab === 'older' && (
              <div className="space-y-3">
                <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#FAF5EE] mb-1">
                  Purge Logs Older Than
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[7, 14, 30, 90].map((days) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => setLogBatchDaysOlder(days)}
                      className={`py-2 rounded-xl border text-xs font-stat font-semibold transition cursor-pointer ${
                        logBatchDaysOlder === days
                          ? 'border-[#A83232] bg-[#A83232] text-white'
                          : 'border-[#E6D7C3] dark:border-[#3D342C] bg-[#FFFFFF] dark:bg-[#25201B] text-[#332F2B] dark:text-[#FAF5EE] hover:bg-[#FAF5EE]'
                      }`}
                    >
                      {days} Days
                    </button>
                  ))}
                </div>
              </div>
            )}

            {logBatchTab === 'filtered' && (
              <div className="p-3 rounded-xl bg-[#FAF5EE] dark:bg-[#25201B] border border-[#E6D7C3] dark:border-[#3D342C] text-xs space-y-1.5">
                <div className="flex justify-between text-[#6E665E] dark:text-[#A89887]">
                  <span>Action Filter:</span>
                  <strong className="text-[#332F2B] dark:text-[#FAF5EE]">
                    {logActionFilter === 'ALL' ? 'All Activities' : logActionFilter}
                  </strong>
                </div>
                <div className="flex justify-between text-[#6E665E] dark:text-[#A89887]">
                  <span>Search Term:</span>
                  <strong className="text-[#332F2B] dark:text-[#FAF5EE]">
                    {logSearch ? `"${logSearch}"` : 'None'}
                  </strong>
                </div>
              </div>
            )}

            {/* Candidates Result Preview */}
            <div className="p-3.5 rounded-xl bg-[#FEF2F2] dark:bg-[#3D1414]/50 border border-[#FCA5A5]/60 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#A83232] shrink-0" />
                <span className="text-xs font-semibold text-[#991B1B] dark:text-[#FCA5A5]">
                  {loadingLogCandidates
                    ? 'Scanning matching logs...'
                    : `${logBatchCandidates.length} activity log${logBatchCandidates.length === 1 ? '' : 's'} identified`}
                </span>
              </div>
              <span className="font-stat text-sm font-bold text-[#A83232]">
                {loadingLogCandidates ? '...' : logBatchCandidates.length}
              </span>
            </div>

            <p className="text-[11px] text-[#6E665E] dark:text-[#A89887] leading-relaxed">
              Upon continuing, you will be prompted to authorize this deletion with your librarian password. This action cannot be reversed.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E6D7C3] dark:border-[#3D342C]">
            <button
              type="button"
              onClick={() => setShowLogBatchModal(false)}
              className="h-9 px-4 rounded-xl border border-[#E6D7C3] dark:border-[#3D342C] bg-[#FFFFFF] dark:bg-[#26201B] text-xs font-semibold text-[#332F2B] dark:text-[#FAF5EE] hover:bg-[#F5EBDD] dark:hover:bg-[#2A2420] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={loadingLogCandidates || logBatchCandidates.length === 0}
              onClick={handleProceedToVerification}
              className="h-9 px-4 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-[#FFFFFF] text-xs font-semibold cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5 shadow-sm"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Continue to Authorization ({logBatchCandidates.length})
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  };

  if (mode === 'logs') {
    return (
      <div className="space-y-5 animate-literary-fade">
        <div className="literary-card p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-heading font-bold text-[#332F2B]">
              Activity Logs
            </h2>
            <p className="text-xs text-[#6E665E] mt-0.5">
              Registry of occupancy submissions and staff actions.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={logActionFilter}
              onChange={(e) => setLogActionFilter(e.target.value as any)}
              className="h-9 px-3 rounded-xl bg-[#FFFFFF] border border-[#E6D7C3] text-xs font-medium text-[#332F2B] focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
            >
              <option value="ALL">All Activities</option>
              <option value="calendar_suspension">Class Suspensions</option>
              <option value="occupancy_submitted">Completed Submissions</option>
              <option value="record_corrected">Modified Records</option>
              <option value="record_backfilled">Added Missing</option>
              <option value="session_started">Active Sessions</option>
              <option value="session_ended">Exited Area</option>
              <option value="report_generated">Report Created</option>
              <option value="report_exported">Report Exported</option>
              <option value="user_login">Signed In</option>
              <option value="user_logout">Signed Out</option>
              <option value="staff_created">Staff Accounts Created</option>
              <option value="staff_updated">Staff Accounts Updated</option>
              <option value="backup_exported">Backup Saved</option>
            </select>

            <div className="relative w-full sm:w-48">
              <Search className="w-3.5 h-3.5 text-[#6E665E] absolute left-3 top-2.5" />
              <input
                type="text"
                value={logSearch}
                onChange={(e) => {
                  setLogSearch(e.target.value);
                  setLogsPage(1);
                }}
                placeholder="Search logs..."
                className="h-9 pl-8 pr-3 rounded-xl bg-[#FFFFFF] border border-[#E6D7C3] text-xs w-full focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
              />
            </div>

            <button
              type="button"
              onClick={() => setShowLogBatchModal(true)}
              className="h-9 px-3.5 rounded-xl border border-[#A83232]/30 bg-[#FDF3F3] hover:bg-[#A83232] text-[#A83232] hover:text-[#FFFFFF] text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              title="Batch delete activity logs by date, retention period, or filter"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Batch Delete...</span>
            </button>

            <button
              type="button"
              onClick={loadActivityLogs}
              className="p-2 rounded-xl border border-[#E6D7C3] bg-[#FFFFFF] hover:bg-[#F5EBDD] text-[#332F2B] cursor-pointer"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingLogs ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Multi-select Floating Action Dock for Logs */}
        {selectedLogIds.size > 0 && (
          <div className="sticky bottom-4 z-40 bg-[#FFFFFF]/95 dark:bg-[#1E1914]/95 backdrop-blur-md border border-[#A83232]/50 p-2.5 sm:p-3.5 rounded-2xl flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 animate-literary-fade shadow-xl">
            <div className="flex items-center gap-2 sm:gap-2.5">
              <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-xl bg-[#A83232] text-white flex items-center justify-center text-xs font-stat font-bold shadow-2xs">
                {selectedLogIds.size}
              </span>
              <span className="text-xs font-semibold text-[#991B1B] dark:text-[#FCA5A5]">
                {selectedLogIds.size} selected
              </span>
              {selectedLogIds.size < filteredLogs.length && (
                <button
                  type="button"
                  onClick={selectAllFilteredLogs}
                  className="hidden sm:inline-block text-xs text-[#A83232] dark:text-[#FCA5A5] underline font-semibold hover:opacity-80 cursor-pointer ml-1"
                >
                  Select all {filteredLogs.length} matching logs
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap w-full sm:w-auto">
              <button
                type="button"
                onClick={handleExportSelectedLogsCSV}
                className="flex-1 sm:flex-initial px-2.5 sm:px-3 py-1.5 rounded-xl border border-[#D6C3A9] dark:border-[#4A3C28] bg-white dark:bg-[#26201B] hover:bg-[#FAF5EE] dark:hover:bg-[#332A20] text-xs font-semibold text-[#332F2B] dark:text-[#FAF5EE] inline-flex items-center justify-center gap-1.5 cursor-pointer transition shadow-2xs"
                title="Export selected logs as CSV"
              >
                <Download className="w-3.5 h-3.5 text-[#8C6514] dark:text-[#E7B84B]" />
                <span>Export</span>
              </button>
              <button
                type="button"
                onClick={promptDeleteBatchLogs}
                className="flex-1 sm:flex-initial px-2.5 sm:px-3.5 py-1.5 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-[#FFFFFF] text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-xs cursor-pointer transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete ({selectedLogIds.size})</span>
              </button>
              <button
                type="button"
                onClick={clearLogSelection}
                className="p-1.5 rounded-xl border border-[#E6D7C3] dark:border-[#3D342C] bg-[#FFFFFF] dark:bg-[#26201B] text-[#6E665E] hover:text-[#332F2B] dark:text-[#FAF5EE] hover:bg-[#FAF5EE] cursor-pointer transition shrink-0"
                title="Clear selection"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <div className="literary-card overflow-hidden">
          {loadingLogs ? (
            <div className="p-10 text-center text-xs text-[#6E665E]">Loading activity logs...</div>
          ) : filteredLogs.length === 0 ? (
            <div className="p-10 text-center text-xs text-[#6E665E]">No activity logs found.</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#FAF5EE] border-b border-[#E6D7C3] text-[#332F2B]">
                    <tr>
                      <th className="py-3 px-3 w-10 text-center">
                        <button
                          type="button"
                          onClick={toggleSelectAllLogsOnPage}
                          className="text-[#6E665E] hover:text-[#A83232] inline-flex items-center justify-center cursor-pointer"
                          title={isAllLogsOnPageSelected ? 'Deselect all on page' : 'Select all on page'}
                        >
                          {isAllLogsOnPageSelected ? (
                            <CheckSquare className="w-4 h-4 text-[#A83232]" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </th>
                      <th className="py-3 px-4 font-semibold">Timestamp (PHT)</th>
                      <th className="py-3 px-4 font-semibold">Status / Activity</th>
                      <th className="py-3 px-4 font-semibold">Staff Member</th>
                      <th className="py-3 px-4 font-semibold">Details</th>
                      <th className="py-3 px-4 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6D7C3]/60">
                    {pagedLogs.map((log) => {
                      const parsed = parseCalendarLogDetails(log, calendarActivities);
                      const isSelected = selectedLogIds.has(log.id);
                      const logDatePht = log.created_at ? log.created_at.slice(0, 10) : '';
                      return (
                        <tr
                          key={log.id}
                          className={`hover:bg-[#FAF5EE]/70 ${isSelected ? 'bg-[#FAF5EE]/80' : ''}`}
                        >
                          <td className="py-2.5 px-3 text-center">
                            <button
                              type="button"
                              onClick={() => toggleLogSelect(log.id)}
                              className="text-[#6E665E] hover:text-[#A83232] inline-flex items-center justify-center cursor-pointer"
                            >
                              {isSelected ? (
                                <CheckSquare className="w-4 h-4 text-[#A83232]" />
                              ) : (
                                <Square className="w-4 h-4" />
                              )}
                            </button>
                          </td>
                          <td className="py-2.5 px-4 text-[#6E665E] whitespace-nowrap font-stat">
                            {formatTimestampPHT(log.created_at)}
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${parsed.badgeClass}`}
                            >
                              {parsed.badgeLabel}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 font-semibold text-[#332F2B] whitespace-nowrap">
                            {log.actor_name}
                          </td>
                          <td className="py-2.5 px-4 text-[#332F2B] leading-relaxed">
                            {parsed.details}
                          </td>
                          <td className="py-2.5 px-4 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => promptDeleteSingleLog(log)}
                              className="p-1.5 rounded-lg border border-transparent hover:border-[#FCA5A5] hover:bg-[#FEF2F2] dark:hover:bg-[#3D1414] text-[#6E665E] hover:text-[#A83232] transition cursor-pointer"
                              title="Delete this activity log"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="px-5 py-3 border-t border-[#E6D7C3] bg-[#FAF5EE]/50 flex flex-wrap items-center justify-between gap-2 text-xs text-[#6E665E]">
                <span className="font-stat">
                  Showing {(logsPage - 1) * PAGE_SIZE + 1}–
                  {Math.min(logsPage * PAGE_SIZE, filteredLogs.length)} of {filteredLogs.length}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={logsPage <= 1}
                    onClick={() => setLogsPage((p) => Math.max(1, p - 1))}
                    className="px-2.5 py-1 rounded-lg border border-[#E6D7C3] bg-[#FFFFFF] hover:bg-[#F5EBDD] text-[#332F2B] font-semibold disabled:opacity-40 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Prev
                  </button>
                  <span className="px-2 font-stat font-semibold text-[#332F2B]">
                    Page {logsPage} of {totalLogPages}
                  </span>
                  <button
                    type="button"
                    disabled={logsPage >= totalLogPages}
                    onClick={() => setLogsPage((p) => Math.min(totalLogPages, p + 1))}
                    className="px-2.5 py-1 rounded-lg border border-[#E6D7C3] bg-[#FFFFFF] hover:bg-[#F5EBDD] text-[#332F2B] font-semibold disabled:opacity-40 inline-flex items-center gap-1 cursor-pointer"
                  >
                    Next
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {renderLogBatchModal()}
        {renderPasswordVerificationModal()}
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-literary-fade">
      {/* Header + Filters */}
      <div className="literary-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-heading font-bold text-[#332F2B]">
              Historical Occupancy Records
            </h2>
            <p className="text-xs text-[#6E665E] mt-0.5">
              Review submissions and resolve missing intervals.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-[#F5EBDD] p-1 rounded-xl border border-[#E6D7C3]">
              <button
                type="button"
                onClick={() => setRecordsSubTab('submitted')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  recordsSubTab === 'submitted'
                    ? 'bg-[#A83232] text-[#FFFFFF] shadow-xs'
                    : 'text-[#6E665E] hover:text-[#332F2B]'
                }`}
              >
                Submitted (<span className="font-stat">{filteredRecords.length}</span>)
              </button>
              <button
                type="button"
                onClick={() => setRecordsSubTab('missing')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  recordsSubTab === 'missing'
                    ? 'bg-[#A83232] text-[#FFFFFF] shadow-xs'
                    : 'text-[#6E665E] hover:text-[#332F2B]'
                }`}
              >
                Missing (<span className="font-stat">{missingIntervals.length}</span>)
              </button>
            </div>

            {recordsSubTab === 'submitted' && (
              <>
                <button
                  type="button"
                  onClick={() => setShowRecordBatchModal(true)}
                  className="h-9 px-3.5 rounded-xl border border-[#A83232]/30 bg-[#FDF3F3] hover:bg-[#A83232] text-[#A83232] hover:text-[#FFFFFF] text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                  title="Batch delete occupancy records by date, time slot, or filter"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Batch Delete...</span>
                </button>
                {filteredRecords.length > 0 && (
                  <button
                    type="button"
                    onClick={handleExportFilteredCSV}
                    className="h-9 px-3.5 rounded-xl border border-[#E6D7C3] bg-[#FFFFFF] hover:bg-[#F5EBDD] text-[#A83232] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export CSV
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 pt-3 border-t border-[#E6D7C3]">
          <div>
            <label className="block text-[11px] font-semibold text-[#6E665E] mb-1">From</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-9 px-3 rounded-xl bg-[#FFFFFF] border border-[#E6D7C3] text-xs font-stat focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#6E665E] mb-1">To</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-9 px-3 rounded-xl bg-[#FFFFFF] border border-[#E6D7C3] text-xs font-stat focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#6E665E] mb-1">Area</label>
            <select
              value={areaFilter}
              onChange={(e) => setAreaFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
              className="h-9 px-3 rounded-xl bg-[#FFFFFF] border border-[#E6D7C3] text-xs focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
            >
              <option value="ALL">All Areas</option>
              {sortedAreas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#6E665E] mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as 'ALL' | 'CORRECTED' | 'ANOMALY');
                setRecordsPage(1);
              }}
              className="h-9 px-3 rounded-xl bg-[#FFFFFF] border border-[#E6D7C3] text-xs focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
            >
              <option value="ALL">All Records</option>
              <option value="CORRECTED">Corrected</option>
              <option value="ANOMALY">Anomalies (0 or &gt; Cap)</option>
            </select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-[11px] font-semibold text-[#6E665E] mb-1">Search</label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#6E665E] absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setRecordsPage(1);
                }}
                placeholder="Name, time, note..."
                className="w-full h-9 pl-8 pr-3 rounded-xl bg-[#FFFFFF] border border-[#E6D7C3] text-xs focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={loadHistoricalRecords}
            className="h-9 px-4 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-[#FFFFFF] text-xs font-semibold cursor-pointer"
          >
            Apply
          </button>
        </div>
      </div>

      {/* Modal: Record Missing Interval */}
      {backfillTarget && createPortal(
        <div className="fixed inset-0 z-[9999] bg-[#332F2B]/65 dark:bg-black/80 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-4 animate-literary-fade">
          <div className="literary-card shadow-2xl max-w-md w-full p-4 sm:p-6 max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-2 mb-4">
              <div>
                <h3 className="text-lg font-heading font-bold text-[#332F2B]">
                  Record Missing Interval
                </h3>
                <p className="text-xs text-[#6E665E] mt-0.5 font-stat">
                  {backfillTarget.areaName} · {backfillTarget.formattedDate} at{' '}
                  {backfillTarget.timeSlotLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBackfillTarget(null)}
                className="p-1 rounded-lg hover:bg-[#F5EBDD] text-[#6E665E] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitBackfill} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#332F2B] mb-1.5">
                  Student Count
                </label>
                <div className="flex items-center justify-center gap-1 sm:gap-1.5">
                  <button
                    type="button"
                    onClick={() => setBackfillCount((c) => Math.max(0, c - 5))}
                    className="h-10 px-2 sm:px-2.5 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-white dark:bg-[#1E1914] hover:bg-[#F5EBDD] dark:hover:bg-[#2A231C] text-[#332F2B] dark:text-[#F0E8DE] font-bold text-xs font-stat cursor-pointer transition shadow-2xs shrink-0"
                    title="Subtract 5"
                  >
                    -5
                  </button>
                  <button
                    type="button"
                    onClick={() => setBackfillCount((c) => Math.max(0, c - 1))}
                    className="w-9 sm:w-10 h-10 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-white dark:bg-[#1E1914] hover:bg-[#F5EBDD] dark:hover:bg-[#2A231C] flex items-center justify-center text-[#332F2B] dark:text-[#F0E8DE] cursor-pointer transition shadow-2xs shrink-0"
                    title="Subtract 1"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <input
                    type="number"
                    min={0}
                    max={2000}
                    required
                    value={backfillCount}
                    onChange={(e) => setBackfillCount(Number(e.target.value))}
                    className="flex-1 min-w-[50px] max-w-[96px] h-10 text-center rounded-xl bg-[#FFFFFF] dark:bg-[#1E1914] border border-[#E6D7C3] dark:border-[#383028] text-[#332F2B] dark:text-[#F0E8DE] text-sm font-stat font-bold focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
                  />
                  <button
                    type="button"
                    onClick={() => setBackfillCount((c) => Math.min(2000, c + 1))}
                    className="w-9 sm:w-10 h-10 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-white dark:bg-[#1E1914] hover:bg-[#F5EBDD] dark:hover:bg-[#2A231C] flex items-center justify-center text-[#332F2B] dark:text-[#F0E8DE] cursor-pointer transition shadow-2xs shrink-0"
                    title="Add 1"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setBackfillCount((c) => Math.min(2000, c + 5))}
                    className="h-10 px-2 sm:px-2.5 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-white dark:bg-[#1E1914] hover:bg-[#F5EBDD] dark:hover:bg-[#2A231C] text-[#A83232] dark:text-[#E25D5D] font-bold text-xs font-stat cursor-pointer transition shadow-2xs shrink-0"
                    title="Add 5"
                  >
                    +5
                  </button>
                  <button
                    type="button"
                    onClick={() => setBackfillCount((c) => Math.min(2000, c + 10))}
                    className="h-10 px-2 sm:px-2.5 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-white dark:bg-[#1E1914] hover:bg-[#F5EBDD] dark:hover:bg-[#2A231C] text-[#A83232] dark:text-[#E25D5D] font-bold text-xs font-stat cursor-pointer transition shadow-2xs shrink-0"
                    title="Add 10"
                  >
                    +10
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#332F2B] mb-1">
                  Reason (Logged in Audit Trail)
                </label>
                <input
                  type="text"
                  required
                  minLength={3}
                  value={backfillReason}
                  onChange={(e) => setBackfillReason(e.target.value)}
                  placeholder="e.g. Entered from desk backup tally"
                  className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] border border-[#E6D7C3] text-sm focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#332F2B] mb-1">
                  Note (Optional)
                </label>
                <input
                  type="text"
                  value={backfillNotes}
                  onChange={(e) => setBackfillNotes(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] border border-[#E6D7C3] text-sm focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setBackfillTarget(null)}
                  className="h-9 px-4 rounded-xl border border-[#E6D7C3] bg-[#FFFFFF] text-xs font-semibold text-[#332F2B] hover:bg-[#F5EBDD] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingBackfill}
                  className="h-9 px-4 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-[#FFFFFF] text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  {savingBackfill ? 'Saving...' : 'Save Record'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Multi-select Action Bar for Records */}
      {recordsSubTab === 'submitted' && selectedRecordIds.size > 0 && (
        <div className="sticky bottom-4 z-40 bg-[#FFFFFF]/95 dark:bg-[#1E1914]/95 backdrop-blur-md border border-[#A83232]/50 p-2.5 sm:p-3.5 rounded-2xl flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 animate-literary-fade shadow-xl">
          <div className="flex items-center gap-2 sm:gap-2.5">
            <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-xl bg-[#A83232] text-white flex items-center justify-center text-xs font-stat font-bold shadow-2xs">
              {selectedRecordIds.size}
            </span>
            <span className="text-xs font-semibold text-[#991B1B] dark:text-[#FCA5A5]">
              {selectedRecordIds.size} selected
            </span>
            {selectedRecordIds.size < filteredRecords.length && (
              <button
                type="button"
                onClick={selectAllFilteredRecords}
                className="hidden sm:inline-block ml-1 text-xs text-[#A83232] dark:text-[#FCA5A5] underline font-semibold hover:opacity-80 cursor-pointer"
              >
                Select all {filteredRecords.length} matching records
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap w-full sm:w-auto">
            <button
              type="button"
              onClick={handleExportSelectedRecordsCSV}
              className="flex-1 sm:flex-initial px-2.5 sm:px-3 py-1.5 rounded-xl border border-[#D6C3A9] dark:border-[#4A3C28] bg-white dark:bg-[#26201B] hover:bg-[#FAF5EE] dark:hover:bg-[#332A20] text-xs font-semibold text-[#332F2B] dark:text-[#FAF5EE] inline-flex items-center justify-center gap-1.5 cursor-pointer transition shadow-2xs"
              title="Export selected records as CSV"
            >
              <Download className="w-3.5 h-3.5 text-[#8C6514] dark:text-[#E7B84B]" />
              <span>Export</span>
            </button>
            <button
              type="button"
              onClick={promptDeleteBatchRecords}
              className="flex-1 sm:flex-initial px-2.5 sm:px-3.5 py-1.5 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-[#FFFFFF] text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-xs cursor-pointer transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete ({selectedRecordIds.size})</span>
            </button>
            <button
              type="button"
              onClick={clearRecordSelection}
              className="p-1.5 rounded-xl border border-[#E6D7C3] dark:border-[#3D342C] bg-[#FFFFFF] dark:bg-[#26201B] text-[#6E665E] hover:text-[#332F2B] dark:text-[#FAF5EE] hover:bg-[#FAF5EE] cursor-pointer transition shrink-0"
              title="Clear selection"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {recordsSubTab === 'submitted' ? (
        <div className="literary-card overflow-hidden">
          {loadingRecords ? (
            <div className="p-10 text-center text-xs text-[#6E665E]">Loading records...</div>
          ) : filteredRecords.length === 0 ? (
            <div className="p-10 text-center text-xs text-[#6E665E]">No records found.</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#FAF5EE] border-b border-[#E6D7C3] text-[#332F2B]">
                    <tr>
                      <th className="py-3 px-3 w-10 text-center">
                        <button
                          type="button"
                          onClick={toggleSelectAllRecordsOnPage}
                          className="text-[#6E665E] hover:text-[#A83232] inline-flex items-center justify-center cursor-pointer"
                          title={isAllRecordsOnPageSelected ? 'Deselect all on page' : 'Select all on page'}
                        >
                          {isAllRecordsOnPageSelected ? (
                            <CheckSquare className="w-4 h-4 text-[#A83232]" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </th>
                      <th className="py-3 px-4 font-semibold">Date</th>
                      <th className="py-3 px-4 font-semibold whitespace-nowrap">Time Slot</th>
                      <th className="py-3 px-4 font-semibold whitespace-nowrap">Library Area</th>
                      <th className="py-3 px-4 font-semibold whitespace-nowrap">Count</th>
                      <th className="py-3 px-4 font-semibold whitespace-nowrap">Status</th>
                      <th className="py-3 px-4 font-semibold whitespace-nowrap">Recorded By</th>
                      <th className="py-3 px-4 font-semibold whitespace-nowrap">Note / Reason</th>
                      <th className="py-3 px-4 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6D7C3]/60">
                    {pagedRecords.map((rec) => {
                      const area = areaById.get(rec.area_id);
                      const overCap = area ? rec.occupancy_count > area.capacity : false;
                      const isSelected = selectedRecordIds.has(rec.id);
                      return (
                        <tr
                          key={rec.id}
                          className={`hover:bg-[#FAF5EE]/70 ${isSelected ? 'bg-[#FAF5EE]/80' : ''}`}
                        >
                          <td className="py-2.5 px-3 text-center">
                            <button
                              type="button"
                              onClick={() => toggleRecordSelect(rec.id)}
                              className="text-[#6E665E] hover:text-[#A83232] inline-flex items-center justify-center cursor-pointer"
                            >
                              {isSelected ? (
                                <CheckSquare className="w-4 h-4 text-[#A83232]" />
                              ) : (
                                <Square className="w-4 h-4" />
                              )}
                            </button>
                          </td>
                          <td className="py-2.5 px-4 font-stat font-medium text-[#332F2B] whitespace-nowrap">
                            {formatShortDate(rec.record_date)} ({getDayOfWeekName(rec.record_date)})
                          </td>
                          <td className="py-2.5 px-4 font-stat font-semibold text-[#A83232] whitespace-nowrap">
                            {formatSlotRangeLabel(rec.time_slot)}
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5 font-medium text-[#332F2B]">
                              <span
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: area?.color_hex || '#A83232' }}
                              />
                              {area?.name}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 font-stat font-bold text-[#332F2B]">
                            {rec.occupancy_count}
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            {overCap ? (
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#FDF3F3] text-[#A83232] border border-[#A83232]/30">
                                Over Capacity
                              </span>
                            ) : rec.is_corrected ? (
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#FEF9EC] text-[#7D5B06] border border-[#E7B84B]/60">
                                Modified
                              </span>
                            ) : (
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#F1F5EE] text-[#455436] border border-[#71865A]/40">
                                Completed
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-[#332F2B] whitespace-nowrap">{rec.recorded_by_name}</td>
                          <td className="py-2.5 px-4 text-[#6E665E]">
                            {rec.is_corrected ? (
                              <span className="text-[#7D5B06]">
                                <strong className="font-semibold">Reason:</strong> {rec.correction_reason}
                              </span>
                            ) : (
                              rec.notes || '—'
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => promptDeleteSingleRecord(rec)}
                              className="p-1.5 rounded-lg border border-transparent hover:border-[#FCA5A5] hover:bg-[#FEF2F2] dark:hover:bg-[#3D1414] text-[#6E665E] hover:text-[#A83232] transition cursor-pointer"
                              title="Delete this occupancy record"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="px-5 py-3 border-t border-[#E6D7C3] bg-[#FAF5EE]/50 flex flex-wrap items-center justify-between gap-2 text-xs text-[#6E665E]">
                <span className="font-stat">
                  Showing {(recordsPage - 1) * PAGE_SIZE + 1}–
                  {Math.min(recordsPage * PAGE_SIZE, filteredRecords.length)} of{' '}
                  {filteredRecords.length}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={recordsPage <= 1}
                    onClick={() => setRecordsPage((p) => Math.max(1, p - 1))}
                    className="px-2.5 py-1 rounded-lg border border-[#E6D7C3] bg-[#FFFFFF] hover:bg-[#F5EBDD] text-[#332F2B] font-semibold disabled:opacity-40 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Prev
                  </button>
                  <span className="px-2 font-stat font-semibold text-[#332F2B]">
                    Page {recordsPage} of {totalRecordPages}
                  </span>
                  <button
                    type="button"
                    disabled={recordsPage >= totalRecordPages}
                    onClick={() => setRecordsPage((p) => Math.min(totalRecordPages, p + 1))}
                    className="px-2.5 py-1 rounded-lg border border-[#E6D7C3] bg-[#FFFFFF] hover:bg-[#F5EBDD] text-[#332F2B] font-semibold disabled:opacity-40 inline-flex items-center gap-1 cursor-pointer"
                  >
                    Next
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="literary-card overflow-hidden">
          {missingIntervals.length === 0 ? (
            <div className="p-10 text-center text-[#71865A] text-xs font-semibold">
              No missing intervals in this date range!
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#FAF5EE] border-b border-[#E6D7C3] text-[#332F2B]">
                    <tr>
                      <th className="py-3 px-4 font-semibold">Date</th>
                      <th className="py-3 px-4 font-semibold">Missing Time Slot</th>
                      <th className="py-3 px-4 font-semibold">Library Area</th>
                      <th className="py-3 px-4 font-semibold">Status</th>
                      <th className="py-3 px-4 font-semibold text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6D7C3]/60">
                    {pagedMissing.map((m) => (
                      <tr key={`${m.date}-${m.timeSlot}-${m.areaId}`} className="hover:bg-[#FAF5EE]/70">
                        <td className="py-2.5 px-4 font-stat font-medium text-[#332F2B]">
                          {m.formattedDate} ({getDayOfWeekName(m.date)})
                        </td>
                        <td className="py-2.5 px-4 font-stat font-semibold text-[#A83232] whitespace-nowrap">
                          {m.timeSlotLabel}
                        </td>
                        <td className="py-2.5 px-4">
                          <span className="inline-flex items-center gap-1.5 font-medium text-[#332F2B]">
                            <span
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: m.areaColor }}
                            />
                            {m.areaName}
                          </span>
                        </td>
                        <td className="py-2.5 px-4">
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#FDF3F3] text-[#A83232] border border-[#A83232]/30">
                            Missing Record
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setBackfillTarget(m);
                              setBackfillCount(10);
                              setBackfillReason('');
                              setBackfillNotes('');
                            }}
                            className="px-2.5 py-1 rounded-lg border border-[#A83232]/30 bg-[#FDF3F3] hover:bg-[#A83232] text-[#A83232] hover:text-[#FFFFFF] font-semibold inline-flex items-center gap-1 transition cursor-pointer"
                          >
                            <PlusCircle className="w-3 h-3" />
                            Add Record
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="px-5 py-3 border-t border-[#E6D7C3] bg-[#FAF5EE]/50 flex flex-wrap items-center justify-between gap-2 text-xs text-[#6E665E]">
                <span className="font-stat">
                  Showing {(missingPage - 1) * PAGE_SIZE + 1}–
                  {Math.min(missingPage * PAGE_SIZE, missingIntervals.length)} of{' '}
                  {missingIntervals.length}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={missingPage <= 1}
                    onClick={() => setMissingPage((p) => Math.max(1, p - 1))}
                    className="px-2.5 py-1 rounded-lg border border-[#E6D7C3] bg-[#FFFFFF] hover:bg-[#F5EBDD] text-[#332F2B] font-semibold disabled:opacity-40 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Prev
                  </button>
                  <span className="px-2 font-stat font-semibold text-[#332F2B]">
                    Page {missingPage} of {totalMissingPages}
                  </span>
                  <button
                    type="button"
                    disabled={missingPage >= totalMissingPages}
                    onClick={() => setMissingPage((p) => Math.min(totalMissingPages, p + 1))}
                    className="px-2.5 py-1 rounded-lg border border-[#E6D7C3] bg-[#FFFFFF] hover:bg-[#F5EBDD] text-[#332F2B] font-semibold disabled:opacity-40 inline-flex items-center gap-1 cursor-pointer"
                  >
                    Next
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {renderRecordBatchModal()}
      {renderPasswordVerificationModal()}
    </div>
  );
};
