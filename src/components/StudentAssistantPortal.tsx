import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bell,
  Building2,
  Calendar,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit3,
  History,
  Lock,
  Minus,
  Plus,
  PlusCircle,
  Radio,
  RefreshCw,
  Search,
  Send,
  Users,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { gsapFadeIn, gsapStaggerIn, gsapPopIn, gsapButtonPress } from '../utils/animations';
import {
  ActivityLog,
  LIBRARY_TIME_SLOTS,
  LibraryArea,
  MonitoringSession,
  OccupancyRecord,
  ServerClock,
  UserProfile,
} from '../types/lirc';
import {
  formatShortDate,
  formatSlotLabel,
  formatSlotRangeLabel,
  formatTimestampPHT,
  getDayOfWeekName,
  getExpectedSlotsForDate,
  getLiteraryAreaColor,
  getTodayPHT,
  getSlotEndTimeLabel,
  isSlotCompleted,
  getLatestCompletedSlot,
  getCompletedSlotsUpTo,
} from '../utils/statistics';
import { AcademicLayout, NavItem, NotificationItem } from './AcademicLayout';
import { topProgressBar } from './TopProgressBar';
import {
  CalendarActivity,
  fetchCalendarActivities,
  fetchClosedDaysOfWeek,
  formatActivityTimeRange,
  getClosedDaysOfWeekFromCache,
  isDateWholeDaySuspended,
  isSlotExcludedByCalendar,
  subscribeToCalendarChanges,
} from '../utils/calendarActivities';
import { CalendarActivitiesModal } from './CalendarActivitiesModal';
import {
  BAGGAGE_AREA_ID,
  BAGGAGE_DUTY_AREA,
  CIRCULATION_AREA_ID,
  CIRCULATION_DUTY_AREA,
  DayGroup,
  DAY_GROUP_LABELS,
  DAY_GROUPS,
  doesAreaRequireStatistics,
  DutyScheduleAssignment,
  EXEMPT_DUTY_AREAS,
  formatTimeSlotLabel,
  getDayNameForDate,
  isNonStatisticalArea,
  isScheduleMatchingDay,
  parseDutySchedulesFromProfile,
  resolveStudentAssistantDutyStatus,
  SHELVER_AREA_ID,
  SHELVER_DUTY_AREA,
  TECHNICAL_AREA_ID,
  TECHNICAL_DUTY_AREA,
  ENTRANCE_EXIT_AREA_ID,
  ENTRANCE_EXIT_DUTY_AREA,
} from '../utils/invitationWorkflow';
import {
  trackStationDuty,
  untrackStationDuty,
} from '../utils/stationDutyTracking';

interface StudentAssistantPortalProps {
  profile: UserProfile;
  allAreas: LibraryArea[];
  onSignOut: () => void;
}

const PAGE_SIZE = 15;
const LOCAL_RECORD_OVERRIDES_KEY = 'lirc_student_count_overrides_v1';

interface LocalRecordOverride {
  count: number;
  notes?: string;
  updatedAt: string;
}

function getLocalRecordOverrides(): Record<number, LocalRecordOverride> {
  try {
    const raw = localStorage.getItem(LOCAL_RECORD_OVERRIDES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveLocalRecordOverride(id: number, count: number, notes?: string): void {
  try {
    const map = getLocalRecordOverrides();
    map[id] = { count, notes, updatedAt: new Date().toISOString() };
    localStorage.setItem(LOCAL_RECORD_OVERRIDES_KEY, JSON.stringify(map));
  } catch (err) {
    console.error('Failed to save local record override:', err);
  }
}

function removeLocalRecordOverride(id: number): void {
  try {
    const map = getLocalRecordOverrides();
    if (map[id]) {
      delete map[id];
      localStorage.setItem(LOCAL_RECORD_OVERRIDES_KEY, JSON.stringify(map));
    }
  } catch (err) {
    console.error('Failed to remove local record override:', err);
  }
}

function mergeRecordOverrides(records: OccupancyRecord[]): OccupancyRecord[] {
  const overrides = getLocalRecordOverrides();
  if (Object.keys(overrides).length === 0) return records;
  return records.map((rec) => {
    const ov = overrides[rec.id];
    if (ov) {
      return {
        ...rec,
        occupancy_count: ov.count,
        notes: ov.notes !== undefined ? ov.notes : rec.notes,
        is_corrected: true,
        last_corrected_at: ov.updatedAt,
      };
    }
    return rec;
  });
}

function playGentleChime(): void {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5 note
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5 note
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
  } catch {
    // safely ignore if audio permission is not yet granted
  }
}

export const StudentAssistantPortal: React.FC<StudentAssistantPortalProps> = ({
  profile,
  allAreas,
  onSignOut,
}) => {
  const sortedAreas = useMemo(
    () =>
      [...allAreas]
        .filter((a) => !isNonStatisticalArea(a.name) && a.id !== CIRCULATION_AREA_ID)
        .sort((a, b) => a.display_order - b.display_order)
        .map((a) => ({ ...a, color_hex: getLiteraryAreaColor(a.code, a.color_hex) })),
    [allAreas]
  );

  const assignableDutyAreas = useMemo<LibraryArea[]>(
    () => [...sortedAreas, ...EXEMPT_DUTY_AREAS],
    [sortedAreas]
  );

  // Server-synchronized clock
  const [serverClock, setServerClock] = useState<ServerClock | null>(null);
  const [liveTimeOffsetMs, setLiveTimeOffsetMs] = useState<number>(0);
  const [nowTick, setNowTick] = useState<number>(Date.now());

  const [viewMode, setViewMode] = useState<'areas' | 'schedule' | 'session' | 'history'>('areas');
  const [areaFilterType, setAreaFilterType] = useState<'ALL' | 'STATISTICAL' | 'STATIONS'>('ALL');
  const isInitialSessionCheckRef = useRef<boolean>(true);

  const [activeSessions, setActiveSessions] = useState<MonitoringSession[]>([]);
  const [myActiveSession, setMyActiveSession] = useState<MonitoringSession | null>(null);
  const [startingAreaId, setStartingAreaId] = useState<number | null>(null);
  const [exitingSession, setExitingSession] = useState<boolean>(false);

  const [todayRecords, setTodayRecords] = useState<OccupancyRecord[]>([]);
  const [myTotalSubmissions, setMyTotalSubmissions] = useState<number>(0);
  const [myActivityLogs, setMyActivityLogs] = useState<ActivityLog[]>([]);
  const [loadingDashboard, setLoadingDashboard] = useState<boolean>(true);
  const [myDutySchedules, setMyDutySchedules] = useState<DutyScheduleAssignment[]>(() =>
    parseDutySchedulesFromProfile(profile)
  );
  const [showDutyScheduleModal, setShowDutyScheduleModal] = useState<boolean>(false);
  const [dutyScheduleTab, setDutyScheduleTab] = useState<DayGroup>('Monday');
  const [lastNotifiedScheduleKey, setLastNotifiedScheduleKey] = useState<string>('');
  const [calendarActivities, setCalendarActivities] = useState<CalendarActivity[]>([]);
  const [closedDaysOfWeek, setClosedDaysOfWeek] = useState<number[]>(() => getClosedDaysOfWeekFromCache());
  const [showCalendarModal, setShowCalendarModal] = useState<boolean>(false);

  // Active recording form
  const [studentCount, setStudentCount] = useState<number>(15);
  const [notes, setNotes] = useState<string>('');
  const [fallbackSlot, setFallbackSlot] = useState<string>('17:00');
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Edit Existing Occupancy Record Modal state
  const [editingRecord, setEditingRecord] = useState<OccupancyRecord | null>(null);
  const [editCount, setEditCount] = useState<number>(0);
  const [editReason, setEditReason] = useState<string>('Updated occupancy count');
  const [editNotes, setEditNotes] = useState<string>('');
  const [savingEdit, setSavingEdit] = useState<boolean>(false);

  // Fill Missing Past Slot Modal state
  const [fillingSlot, setFillingSlot] = useState<{ area: LibraryArea; slot: string; date: string } | null>(null);
  const [fillCount, setFillCount] = useState<number>(0);
  const [fillReason, setFillReason] = useState<string>('Recorded missed interval');
  const [fillNotes, setFillNotes] = useState<string>('');
  const [savingFill, setSavingFill] = useState<boolean>(false);

  const openMissingSlotModal = (area: LibraryArea, slot: string, date?: string) => {
    setFillingSlot({ area, slot, date: date || todayDate });
    setFillCount(0);
    setFillReason('Recorded missed interval');
    setFillNotes('');
  };

  // Selected completed interval for submission in active area
  const [selectedCompletedSlot, setSelectedCompletedSlot] = useState<string | null>(null);

  // History filters & pagination
  const [historyStartDate, setHistoryStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d.toISOString().slice(0, 10);
  });
  const [historyEndDate, setHistoryEndDate] = useState<string>(getTodayPHT());
  const [historyAreaFilter, setHistoryAreaFilter] = useState<number | 'ALL'>('ALL');
  const [historyOnlyMine, setHistoryOnlyMine] = useState<boolean>(true);
  const [historySearch, setHistorySearch] = useState<string>('');
  const [historyRecords, setHistoryRecords] = useState<OccupancyRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);
  const [historyPage, setHistoryPage] = useState<number>(1);

  // Direct Inline editing state for Student Assistant
  const [inlineEditId, setInlineEditId] = useState<number | null>(null);
  const [inlineEditCount, setInlineEditCount] = useState<number>(0);
  const [savingInline, setSavingInline] = useState<boolean>(false);

  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  };

  // GSAP animation refs
  const areasGridRef = useRef<HTMLDivElement | null>(null);
  const dutyHeroRef = useRef<HTMLDivElement | null>(null);
  const editModalRef = useRef<HTMLDivElement | null>(null);
  const fillModalRef = useRef<HTMLDivElement | null>(null);
  const scheduleModalRef = useRef<HTMLDivElement | null>(null);

  // GSAP: Stagger in area cards
  useEffect(() => {
    if (viewMode === 'areas' && areasGridRef.current) {
      const cards = areasGridRef.current.querySelectorAll('.sa-area-card');
      if (cards.length > 0) {
        gsapStaggerIn(cards, { stagger: 0.05, y: 14 });
      }
    }
  }, [viewMode, assignableDutyAreas.length, areaFilterType]);

  // GSAP: Modals pop-in
  useEffect(() => {
    if (editingRecord && editModalRef.current) {
      gsapPopIn(editModalRef.current);
    }
  }, [editingRecord]);

  useEffect(() => {
    if (fillingSlot && fillModalRef.current) {
      gsapPopIn(fillModalRef.current);
    }
  }, [fillingSlot]);

  useEffect(() => {
    if (showDutyScheduleModal && scheduleModalRef.current) {
      gsapPopIn(scheduleModalRef.current);
    }
  }, [showDutyScheduleModal]);

  const syncServerClock = useCallback(async () => {
    const reqStart = Date.now();
    const { data, error } = await supabase.rpc('get_server_clock');
    if (!error && data) {
      const clk = data as ServerClock;
      setServerClock(clk);
      const serverMs = new Date(clk.server_utc).getTime();
      if (!Number.isNaN(serverMs)) {
        setLiveTimeOffsetMs(serverMs - reqStart);
      }
      setHistoryEndDate(clk.record_date);
    }
  }, []);

  useEffect(() => {
    syncServerClock();
    const syncTimer = setInterval(syncServerClock, 30000);
    const tickTimer = setInterval(() => setNowTick(Date.now()), 1000);
  return () => {
      clearInterval(syncTimer);
      clearInterval(tickTimer);
    };
  }, [syncServerClock]);

  const syncedDisplayTime = useMemo(() => {
    const dt = new Date(nowTick + liveTimeOffsetMs);
    return dt.toLocaleTimeString('en-US', {
      timeZone: 'Asia/Manila',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }, [nowTick, liveTimeOffsetMs]);

  // Live 30-minute interval countdown calculation (synced with PHT server clock)
  const intervalCountdown = useMemo(() => {
    const dt = new Date(nowTick + liveTimeOffsetMs);
    const manilaParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    }).formatToParts(dt);

    const hour = Number(manilaParts.find((p) => p.type === 'hour')?.value ?? dt.getHours());
    const minute = Number(manilaParts.find((p) => p.type === 'minute')?.value ?? dt.getMinutes());
    const second = Number(manilaParts.find((p) => p.type === 'second')?.value ?? dt.getSeconds());

    const totalMinutes = hour * 60 + minute;
    const isOperatingHours = totalMinutes >= 480 && totalMinutes < 1080; // 8:00 AM to 5:59 PM (closes at exact 6:00 PM)
    const hasAnyIntervalCompleted = totalMinutes >= 510; // 8:30 AM or later

    // Underway interval (currently running, e.g. 08:00 from 8:00 to 8:29 AM)
    const underwayMins = totalMinutes < 480
      ? 480
      : Math.min(1050, Math.floor(totalMinutes / 30) * 30);
    const underwaySlot = `${String(Math.floor(underwayMins / 60)).padStart(2, '0')}:${String(underwayMins % 60).padStart(2, '0')}`;

    // Latest completed interval (the one that concluded and unlocked, e.g. 08:00 at 8:30 AM)
    const latestCompletedSlot = hasAnyIntervalCompleted ? getLatestCompletedSlot(totalMinutes) : null;

    const secondsIntoInterval = (minute % 30) * 60 + second;
    const secondsRemaining = 1800 - secondsIntoInterval;
    const minsLeft = Math.floor(secondsRemaining / 60);
    const secsLeft = secondsRemaining % 60;
    const progressPercent = Math.min(100, Math.max(0, Math.round((secondsIntoInterval / 1800) * 100)));

    // Next completion boundary time
    const nextBoundaryMins = (Math.floor(totalMinutes / 30) + 1) * 30;
    const bH = Math.floor(nextBoundaryMins / 60);
    const bM = nextBoundaryMins % 60;
    const bAmpm = bH >= 12 ? 'PM' : 'AM';
    const bH12 = bH % 12 || 12;
    const nextUnlockTimeFormatted = `${bH12}:${String(bM).padStart(2, '0')} ${bAmpm}`;

    const isDueSoon = isOperatingHours && minsLeft < 5;
    const isFreshSlot = isOperatingHours && minsLeft >= 25;

    const slotMin = minute < 30 ? '00' : '30';
    const currentSlotKey = `${hour < 10 ? '0' : ''}${hour}:${slotMin}`;

    return {
      hour,
      minute,
      second,
      totalMinutes,
      isOperatingHours,
      hasAnyIntervalCompleted,
      underwaySlot,
      latestCompletedSlot,
      nextUnlockTimeFormatted,
      secondsRemaining,
      minsLeft,
      secsLeft,
      progressPercent,
      isDueSoon,
      isFreshSlot,
      currentSlotKey,
      formattedTimeRemaining: `${minsLeft}m ${secsLeft < 10 ? '0' : ''}${secsLeft}s`,
    };
  }, [nowTick, liveTimeOffsetMs]);


  const todayDate = serverClock?.record_date || getTodayPHT();

  // Track shifts where the Student Assistant has clicked "Enter Area" for today
  const [enteredShiftIds, setEnteredShiftIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const key = `lirc_entered_shifts_${profile.id}_${todayDate}`;
      const saved = localStorage.getItem(key);
      if (saved) {
        return new Set(JSON.parse(saved));
      }
    } catch {
      // ignore
    }
    return new Set();
  });

  // Track active station duty area (e.g. Baggage, Circulation, Shelver, Technical, Entrance/Exit) where statistics are exempt
  const [activeStationDutyAreaId, setActiveStationDutyAreaId] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const key = `lirc_active_station_${profile.id}_${todayDate}`;
      const saved = localStorage.getItem(key);
      return saved !== null && saved !== '' ? Number(saved) : null;
    } catch {
      return null;
    }
  });

  // Re-track station duty on initial mount/reload if active
  useEffect(() => {
    if (activeStationDutyAreaId !== null && !myActiveSession) {
      const station = assignableDutyAreas.find((a) => a.id === activeStationDutyAreaId);
      if (station) {
        trackStationDuty(supabase, {
          userId: profile.id,
          userName: profile.full_name,
          staffCode: profile.staff_code,
          areaId: station.id,
          areaName: station.name,
          startedAt: new Date().toISOString(),
        });
      }
    }
  }, [activeStationDutyAreaId, myActiveSession, assignableDutyAreas, profile.id, profile.full_name, profile.staff_code]);

  const markShiftEntered = useCallback(
    (shiftId: string) => {
      setEnteredShiftIds((prev) => {
        const next = new Set(prev);
        next.add(shiftId);
        try {
          const key = `lirc_entered_shifts_${profile.id}_${todayDate}`;
          localStorage.setItem(key, JSON.stringify(Array.from(next)));
        } catch {
          // ignore
        }
        return next;
      });
    },
    [profile.id, todayDate]
  );

  const unmarkShiftEntered = useCallback(
    (shiftIds: string[]) => {
      setEnteredShiftIds((prev) => {
        const next = new Set(prev);
        shiftIds.forEach((id) => next.delete(id));
        try {
          const key = `lirc_entered_shifts_${profile.id}_${todayDate}`;
          localStorage.setItem(key, JSON.stringify(Array.from(next)));
        } catch {
          // ignore
        }
        return next;
      });
    },
    [profile.id, todayDate]
  );

  const loadDashboardData = useCallback(async (silent = false) => {
    if (!silent) setLoadingDashboard(true);
    const [sessionsRes, todayRecsRes, myCountRes, logsRes, profileRes, calList, closedList] = await Promise.all([
      supabase
        .from('monitoring_sessions')
        .select('*')
        .eq('status', 'active')
        .order('started_at', { ascending: false }),
      supabase
        .from('occupancy_records')
        .select('*')
        .eq('record_date', todayDate)
        .order('time_slot', { ascending: true }),
      supabase
        .from('occupancy_records')
        .select('id', { count: 'exact', head: true })
        .eq('recorded_by', profile.id),
      supabase
        .from('activity_logs')
        .select('*')
        .eq('actor_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(12),
      supabase
        .from('user_profiles')
        .select('*')
        .eq('id', profile.id)
        .maybeSingle(),
      fetchCalendarActivities(supabase),
      fetchClosedDaysOfWeek(supabase),
    ]);

    if (calList) {
      setCalendarActivities(calList);
    }
    if (closedList) {
      setClosedDaysOfWeek(closedList);
    }

    if (!profileRes.error && profileRes.data) {
      setMyDutySchedules(parseDutySchedulesFromProfile(profileRes.data as UserProfile));
    }

    if (!sessionsRes.error && sessionsRes.data) {
      const sessList = sessionsRes.data as MonitoringSession[];
      setActiveSessions(sessList);
      const mine = sessList.find((s) => s.user_id === profile.id) || null;
      setMyActiveSession(mine);
      if (isInitialSessionCheckRef.current) {
        isInitialSessionCheckRef.current = false;
        if (mine) {
          setViewMode('session');
        }
      } else if (!mine) {
        setViewMode((prev) => (prev === 'session' ? 'areas' : prev));
      }
    }
    if (!todayRecsRes.error && todayRecsRes.data) {
      setTodayRecords(mergeRecordOverrides(todayRecsRes.data as OccupancyRecord[]));
    }
    if (!myCountRes.error && typeof myCountRes.count === 'number') {
      setMyTotalSubmissions(myCountRes.count);
    }
    if (!logsRes.error && logsRes.data) {
      setMyActivityLogs(logsRes.data as ActivityLog[]);
    }

    if (!silent) setLoadingDashboard(false);
  }, [profile.id, todayDate]);

  useEffect(() => {
    loadDashboardData();
    const pollTimer = setInterval(loadDashboardData, 30000);
    return () => clearInterval(pollTimer);
  }, [loadDashboardData]);

  // Automatic gentle chime and alert when a 30-minute interval completes and unlocks
  const lastChimedCompletedSlotRef = useRef<string | null>(null);
  useEffect(() => {
    if (!intervalCountdown.isOperatingHours) return;
    const completedSlot = intervalCountdown.latestCompletedSlot;
    if (lastChimedCompletedSlotRef.current === null) {
      lastChimedCompletedSlotRef.current = completedSlot || 'none';
      return;
    }
    if (completedSlot && completedSlot !== lastChimedCompletedSlotRef.current) {
      lastChimedCompletedSlotRef.current = completedSlot;
      playGentleChime();
      setToast({
        type: 'success',
        message: `⏱ 30-minute interval completed (${formatSlotRangeLabel(completedSlot)})! Headcount entry is now unlocked.`,
      });
      syncServerClock();
      loadDashboardData();
    }
  }, [
    intervalCountdown.latestCompletedSlot,
    intervalCountdown.isOperatingHours,
    syncServerClock,
    loadDashboardData,
  ]);

  // Real-time synchronization of calendar suspensions & activities for the Student Assistant
  useEffect(() => {
    const unsubscribe = subscribeToCalendarChanges(supabase, (fresh, freshClosed) => {
      setCalendarActivities(fresh);
      if (freshClosed) setClosedDaysOfWeek(freshClosed);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const currentClockHHMM = useMemo(() => {
    if (serverClock?.manila_timestamp) {
      try {
        const dt = new Date(serverClock.manila_timestamp);
        const h = String(dt.getHours()).padStart(2, '0');
        const m = String(dt.getMinutes()).padStart(2, '0');
        return `${h}:${m}`;
      } catch {
        // fallback
      }
    }
    return serverClock?.detected_slot || null;
  }, [serverClock?.manila_timestamp, serverClock?.detected_slot]);

  const dutyStatus = useMemo(
    () =>
      resolveStudentAssistantDutyStatus(
        myDutySchedules,
        todayDate,
        currentClockHHMM,
        enteredShiftIds
      ),
    [myDutySchedules, todayDate, currentClockHHMM, enteredShiftIds]
  );

  // If there is an active monitoring session, automatically ensure this shift is marked entered
  useEffect(() => {
    if (myActiveSession && dutyStatus.currentShift) {
      if (dutyStatus.currentShift.areaId === myActiveSession.area_id) {
        markShiftEntered(dutyStatus.currentShift.id);
      }
    }
  }, [myActiveSession?.area_id, dutyStatus.currentShift?.id, markShiftEntered]);

  // GSAP: Animate Duty Hero Banner on mount / duty change
  useEffect(() => {
    if (dutyHeroRef.current) {
      gsapFadeIn(dutyHeroRef.current, { y: 12, duration: 0.4 });
    }
  }, [
    dutyStatus.currentShiftOccurrence?.statusLabel,
    dutyStatus.upcomingShiftOccurrence?.statusLabel,
    dutyStatus.currentShift?.id,
    viewMode,
  ]);

  // Notify the Student Assistant when they have a next assigned duty or when the Librarian updates it
  useEffect(() => {
    const nextOcc = dutyStatus.nextShiftOccurrence;
    if (!nextOcc) return;
    const sched = nextOcc.assignment;
    const key = `${sched.id}|${sched.areaId}|${nextOcc.dayGroup}|${nextOcc.date}|${sched.startTime}|${sched.endTime}|${sched.updatedAt}`;
    if (key !== lastNotifiedScheduleKey) {
      setLastNotifiedScheduleKey(key);
      const dayLabel = nextOcc.isTomorrow
        ? `Tomorrow (${nextOcc.dayName})`
        : `${DAY_GROUP_LABELS[nextOcc.dayGroup].label} · ${nextOcc.dayName}`;
      showToast(
        'success',
        `Next Assigned Duty: Report to ${sched.areaName} (${dayLabel}) from ${formatTimeSlotLabel(
          sched.startTime
        )} to ${formatTimeSlotLabel(sched.endTime)}.`
      );
    }
  }, [dutyStatus.nextShiftOccurrence, lastNotifiedScheduleKey]);

  const loadHistoryRecords = useCallback(async () => {
    setLoadingHistory(true);
    const { data, error } = await supabase.rpc('get_occupancy_records_range', {
      p_start_date: historyStartDate,
      p_end_date: historyEndDate,
      p_area_id: historyAreaFilter === 'ALL' ? null : historyAreaFilter,
    });
    if (error) {
      showToast('error', `Could not load records: ${error.message}`);
      setLoadingHistory(false);
      return;
    }
    const list = Array.isArray(data) ? (data as OccupancyRecord[]) : [];
    list.sort((a, b) => {
      if (a.record_date !== b.record_date) return b.record_date.localeCompare(a.record_date);
      return b.time_slot.localeCompare(a.time_slot);
    });
    setHistoryRecords(mergeRecordOverrides(list));
    setHistoryPage(1);
    setLoadingHistory(false);
  }, [historyStartDate, historyEndDate, historyAreaFilter]);

  useEffect(() => {
    if (viewMode === 'history') {
      loadHistoryRecords();
    }
  }, [viewMode, loadHistoryRecords]);

  const activeArea = useMemo(
    () => (myActiveSession ? sortedAreas.find((a) => a.id === myActiveSession.area_id) || null : null),
    [myActiveSession, sortedAreas]
  );

  const expectedTodaySlots = useMemo(
    () =>
      getExpectedSlotsForDate(
        todayDate,
        todayDate,
        serverClock?.completed_slot || intervalCountdown.latestCompletedSlot || null,
        intervalCountdown.isOperatingHours
      ),
    [
      todayDate,
      serverClock?.completed_slot,
      intervalCountdown.latestCompletedSlot,
      intervalCountdown.isOperatingHours,
    ]
  );

  const todayLookup = useMemo(() => {
    const byAreaSlot = new Map<string, OccupancyRecord>();
    const byAreaList = new Map<number, OccupancyRecord[]>();
    for (const a of sortedAreas) byAreaList.set(a.id, []);
    for (const r of todayRecords) {
      byAreaSlot.set(`${r.area_id}|${r.time_slot}`, r);
      const arr = byAreaList.get(r.area_id);
      if (arr) arr.push(r);
    }
    return { byAreaSlot, byAreaList };
  }, [todayRecords, sortedAreas]);

  useEffect(() => {
    if (!activeArea) return;
    const firstOpen = LIBRARY_TIME_SLOTS.find(
      (s) => !todayLookup.byAreaSlot.has(`${activeArea.id}|${s.value}`)
    );
    setFallbackSlot(firstOpen ? firstOpen.value : '17:30');
  }, [activeArea, todayLookup]);

  const todayMissingList = useMemo(() => {
    const missing: Array<{ area: LibraryArea; slot: string; slotLabel: string }> = [];
    for (const area of sortedAreas) {
      for (const slot of expectedTodaySlots) {
        if (!todayLookup.byAreaSlot.has(`${area.id}|${slot}`)) {
          missing.push({ area, slot, slotLabel: formatSlotLabel(slot) });
        }
      }
    }
    return missing;
  }, [sortedAreas, expectedTodaySlots, todayLookup]);

  const myTodayCount = useMemo(
    () => todayRecords.filter((r) => r.recorded_by === profile.id).length,
    [todayRecords, profile.id]
  );

  const handleEnterStationArea = useCallback(
    (area: LibraryArea) => {
      // 1. If currently in an active statistical monitoring session, exit it cleanly
      if (myActiveSession) {
        supabase.rpc('exit_monitoring_session', { p_session_id: myActiveSession.id });
        setMyActiveSession(null);
      }

      // 2. Find any matching duty shift for today to mark as entered
      const matchingTodayShift =
        dutyStatus.currentShift?.areaId === area.id
          ? dutyStatus.currentShift
          : dutyStatus.todayShifts.find((s) => s.areaId === area.id && !enteredShiftIds.has(s.id)) ||
            dutyStatus.todayShifts.find((s) => s.areaId === area.id);

      if (matchingTodayShift) {
        markShiftEntered(matchingTodayShift.id);
      }

      // 3. Mark station as actively entered
      setActiveStationDutyAreaId(area.id);
      try {
        const key = `lirc_active_station_${profile.id}_${todayDate}`;
        localStorage.setItem(key, String(area.id));
      } catch {
        // ignore
      }

      // 4. Broadcast & track live presence across network and tabs
      trackStationDuty(supabase, {
        userId: profile.id,
        userName: profile.full_name,
        staffCode: profile.staff_code,
        areaId: area.id,
        areaName: area.name,
        startedAt: new Date().toISOString(),
      });

      showToast(
        'success',
        `Entered ${area.name} station. ${
          matchingTodayShift ? 'Area assignment marked as entered.' : 'Now active on station duty.'
        }`
      );
    },
    [dutyStatus.currentShift, dutyStatus.todayShifts, enteredShiftIds, markShiftEntered, myActiveSession, profile.id, profile.full_name, profile.staff_code, todayDate]
  );

  const handleLeaveStationArea = useCallback(
    (area: LibraryArea) => {
      setActiveStationDutyAreaId(null);
      try {
        const key = `lirc_active_station_${profile.id}_${todayDate}`;
        localStorage.removeItem(key);
      } catch {
        // ignore
      }

      // Untrack live station duty presence across network & tabs
      untrackStationDuty(
        supabase,
        profile.id,
        area.id,
        profile.full_name,
        profile.staff_code,
        area.name
      );

      // Also unmark any entered shifts for this station so it cleanly switches back to "Enter Area"
      const matchingShifts = dutyStatus.todayShifts.filter((s) => s.areaId === area.id);
      if (matchingShifts.length > 0) {
        unmarkShiftEntered(matchingShifts.map((s) => s.id));
      }
      showToast('success', `Exited ${area.name} station duty.`);
    },
    [dutyStatus.todayShifts, profile.id, profile.full_name, profile.staff_code, todayDate, unmarkShiftEntered]
  );

  const handleSelectArea = async (area: LibraryArea) => {
    // If entering an assigned duty area for today, mark the schedule as entered
    if (dutyStatus.currentShift && dutyStatus.currentShift.areaId === area.id) {
      markShiftEntered(dutyStatus.currentShift.id);
    }
    const matchingTodayShift = dutyStatus.todayShifts.find((s) => s.areaId === area.id);
    if (matchingTodayShift) {
      markShiftEntered(matchingTodayShift.id);
    }

    // If this is a non-statistical station, handle station entry instead of starting headcount session
    if (isNonStatisticalArea(area.id) || !doesAreaRequireStatistics(area.id, area.name)) {
      handleEnterStationArea(area);
      return;
    }

    // Clear active station if moving to a statistical area
    if (activeStationDutyAreaId !== null) {
      const prevStation = assignableDutyAreas.find((a) => a.id === activeStationDutyAreaId);
      untrackStationDuty(
        supabase,
        profile.id,
        activeStationDutyAreaId,
        profile.full_name,
        profile.staff_code,
        prevStation?.name || 'Service Station'
      );
      setActiveStationDutyAreaId(null);
      try {
        const key = `lirc_active_station_${profile.id}_${todayDate}`;
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
    }

    setStartingAreaId(area.id);
    const { data, error } = await supabase.rpc('start_monitoring_session', {
      p_area_id: area.id,
    });
    setStartingAreaId(null);

    if (error) {
      showToast('error', `Could not enter area: ${error.message}`);
      return;
    }

    // Clear active station if switching to statistical monitoring session
    setActiveStationDutyAreaId(null);
    try {
      localStorage.removeItem(`lirc_active_station_${profile.id}_${todayDate}`);
    } catch {
      // ignore
    }

    setMyActiveSession(data as MonitoringSession);
    setStudentCount(Math.min(area.capacity, 15));
    setNotes('');
    setViewMode('session');
    showToast('success', `Now monitoring ${area.name}. Click "Exit Area" when finished.`);
    await loadDashboardData();
  };

  const handleExitArea = async () => {
    if (!myActiveSession) {
      setViewMode('areas');
      return;
    }
    setExitingSession(true);
    const areaName = myActiveSession.area_name;
    const { error } = await supabase.rpc('exit_monitoring_session', {
      p_session_id: myActiveSession.id,
    });
    setExitingSession(false);

    if (error) {
      showToast('error', `Could not exit area: ${error.message}`);
      return;
    }

    const exitedAreaId = myActiveSession.area_id;
    setMyActiveSession(null);
    setViewMode('areas');
    const matchingShifts = dutyStatus.todayShifts.filter((s) => s.areaId === exitedAreaId);
    if (matchingShifts.length > 0) {
      unmarkShiftEntered(matchingShifts.map((s) => s.id));
    }
    showToast('success', `Exited ${areaName}. All submitted counts remain saved.`);
    await loadDashboardData();
  };

  // 30-Minute Schedule Interval Logic:
  // Student Assistants can only enter headcount once the 30-minute interval has completed.
  const completedSlotsToday = useMemo(() => {
    if (!intervalCountdown.isOperatingHours) {
      return LIBRARY_TIME_SLOTS.map((s) => s.value);
    }
    if (!intervalCountdown.hasAnyIntervalCompleted) {
      return [];
    }
    return getCompletedSlotsUpTo(intervalCountdown.latestCompletedSlot);
  }, [
    intervalCountdown.isOperatingHours,
    intervalCountdown.hasAnyIntervalCompleted,
    intervalCountdown.latestCompletedSlot,
  ]);

  const areaRecordedCompletedSlots = useMemo(() => {
    if (!activeArea) return [];
    return completedSlotsToday.filter((slot) =>
      todayLookup.byAreaSlot.has(`${activeArea.id}|${slot}`)
    );
  }, [activeArea, completedSlotsToday, todayLookup]);

  const areaPendingCompletedSlots = useMemo(() => {
    if (!activeArea) return [];
    return completedSlotsToday.filter(
      (slot) => !todayLookup.byAreaSlot.has(`${activeArea.id}|${slot}`)
    );
  }, [activeArea, completedSlotsToday, todayLookup]);

  // Target interval to display and record:
  const effectiveTargetSlot = useMemo(() => {
    if (!intervalCountdown.isOperatingHours) {
      return fallbackSlot;
    }
    // Before 8:30 AM: first operating interval (08:00) is underway, so display 08:00
    if (!intervalCountdown.hasAnyIntervalCompleted) {
      return intervalCountdown.underwaySlot || '08:00';
    }
    // If the assistant selected a specific completed slot to submit
    if (
      selectedCompletedSlot &&
      (completedSlotsToday.includes(selectedCompletedSlot) ||
        isSlotCompleted(selectedCompletedSlot, intervalCountdown.totalMinutes))
    ) {
      return selectedCompletedSlot;
    }
    // If there are pending completed slots, default to the latest completed pending slot
    if (areaPendingCompletedSlots.length > 0) {
      return areaPendingCompletedSlots[areaPendingCompletedSlots.length - 1];
    }
    // If all completed slots are recorded, show the latest completed slot
    return intervalCountdown.latestCompletedSlot || intervalCountdown.underwaySlot || '08:00';
  }, [
    intervalCountdown.isOperatingHours,
    intervalCountdown.hasAnyIntervalCompleted,
    intervalCountdown.underwaySlot,
    intervalCountdown.latestCompletedSlot,
    intervalCountdown.totalMinutes,
    fallbackSlot,
    selectedCompletedSlot,
    completedSlotsToday,
    areaPendingCompletedSlots,
  ]);

  const existingRecordForTargetSlot = activeArea
    ? todayLookup.byAreaSlot.get(`${activeArea.id}|${effectiveTargetSlot}`) || null
    : null;

  // Whether headcount entry is locked because the interval is currently underway
  const isSubmissionLocked = useMemo(() => {
    if (!intervalCountdown.isOperatingHours) return false;
    // Before 8:30 AM: interval 8:00–8:30 AM is still running
    if (!intervalCountdown.hasAnyIntervalCompleted) return true;
    // If the currently targeted slot has not concluded yet
    if (!isSlotCompleted(effectiveTargetSlot, intervalCountdown.totalMinutes)) return true;
    // If all completed intervals for this area are already recorded and none selected, lock until next interval completes
    if (!selectedCompletedSlot && areaPendingCompletedSlots.length === 0) return true;
    return false;
  }, [
    intervalCountdown.isOperatingHours,
    intervalCountdown.hasAnyIntervalCompleted,
    intervalCountdown.totalMinutes,
    effectiveTargetSlot,
    selectedCompletedSlot,
    areaPendingCompletedSlots.length,
  ]);

  const handleSubmitOccupancy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeArea || !myActiveSession) return;
    if (isSubmissionLocked) {
      showToast('error', 'Headcount entry is locked until the 30-minute interval has concluded.');
      return;
    }
    if (Number.isNaN(studentCount) || studentCount < 0 || studentCount > 2000) {
      showToast('error', 'Please enter a valid number between 0 and 2,000.');
      return;
    }

    const cleanCount = Math.max(0, Math.round(studentCount));
    const cleanNotes = notes.trim();
    const targetSlotToSubmit = intervalCountdown.isOperatingHours
      ? effectiveTargetSlot
      : fallbackSlot;

    // 1. Instant Optimistic Record for 0ms UI Update
    const tempId = -Date.now();
    const optimisticRecord: OccupancyRecord = {
      id: tempId,
      record_date: todayDate,
      time_slot: targetSlotToSubmit,
      area_id: activeArea.id,
      occupancy_count: cleanCount,
      recorded_by: profile.id,
      recorded_by_name: profile.full_name || 'Staff',
      session_id: myActiveSession?.id || null,
      notes: cleanNotes,
      recorded_at: new Date().toISOString(),
      is_off_hours_entry: !intervalCountdown.isOperatingHours,
      is_corrected: false,
      correction_count: 0,
      last_corrected_by: null,
      last_corrected_by_name: null,
      last_corrected_at: null,
      correction_reason: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // 2. Instantly update UI state so cards and counts reflect immediately (0ms)
    setTodayRecords((prev) => {
      const idx = prev.findIndex(
        (r) => r.area_id === activeArea.id && r.time_slot === targetSlotToSubmit && r.record_date === todayDate
      );
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = optimisticRecord;
        return copy;
      }
      return [...prev, optimisticRecord];
    });
    setHistoryRecords((prev) => [optimisticRecord, ...prev.filter((r) => r.id !== tempId)]);

    // 3. Clear inputs & display success immediately
    setNotes('');
    setSelectedCompletedSlot(null);
    setSubmitting(false);
    showToast(
      'success',
      `Saved ${cleanCount} students for ${activeArea.name} (${formatSlotRangeLabel(targetSlotToSubmit)}).`
    );

    // 4. Asynchronously send network request to Supabase without blocking UI
    (async () => {
      try {
        const { data, error } = await supabase.rpc('submit_occupancy_record', {
          p_area_id: activeArea.id,
          p_occupancy_count: cleanCount,
          p_notes: cleanNotes,
          p_session_id: myActiveSession.id,
          p_fallback_slot: targetSlotToSubmit,
        });

        let savedRecord: OccupancyRecord | null = data as OccupancyRecord;

        if (error) {
          const cleanReason = 'Recorded missing interval';
          const { data: backfillData, error: backfillErr } = await supabase.rpc('admin_backfill_missing_record', {
            p_record_date: todayDate,
            p_time_slot: targetSlotToSubmit,
            p_area_id: activeArea.id,
            p_occupancy_count: cleanCount,
            p_reason: cleanReason,
            p_notes: cleanNotes,
          });

          if (backfillErr) {
            const { data: directData, error: directErr } = await supabase
              .from('occupancy_records')
              .insert({
                record_date: todayDate,
                time_slot: targetSlotToSubmit,
                area_id: activeArea.id,
                occupancy_count: cleanCount,
                recorded_by: profile.id,
                recorded_by_name: profile.full_name,
                session_id: myActiveSession.id,
                notes: cleanNotes,
              })
              .select()
              .single();

            if (directErr) {
              console.error('Failed to submit occupancy record:', error, directErr);
              // Revert optimistic update on failure
              setTodayRecords((prev) => prev.filter((r) => r.id !== tempId));
              setHistoryRecords((prev) => prev.filter((r) => r.id !== tempId));
              showToast('error', error.message || directErr.message);
              return;
            }
            savedRecord = directData as OccupancyRecord;
          } else {
            savedRecord = backfillData as OccupancyRecord;
          }
        }

        if (savedRecord) {
          setTodayRecords((prev) => prev.map((r) => (r.id === tempId ? savedRecord! : r)));
        }
      } catch (err: any) {
        console.error('Network error during submit occupancy:', err);
      } finally {
        loadDashboardData(true);
        syncServerClock();
      }
    })();
  };

  const handleSaveInlineCount = async (recordId: number, countToSave: number) => {
    if (Number.isNaN(countToSave) || countToSave < 0) {
      showToast('error', 'Please enter a valid count (0 or greater).');
      return;
    }
    setSavingInline(true);
    const cleanCount = Math.max(0, Math.round(countToSave));
    const cleanReason = 'Direct count update by Student Assistant';

    // Immediate optimistic update in state and local storage
    setTodayRecords((prev) =>
      prev.map((r) =>
        r.id === recordId
          ? {
              ...r,
              occupancy_count: cleanCount,
              is_corrected: true,
              last_corrected_at: new Date().toISOString(),
            }
          : r
      )
    );
    setHistoryRecords((prev) =>
      prev.map((r) =>
        r.id === recordId
          ? {
              ...r,
              occupancy_count: cleanCount,
              is_corrected: true,
              last_corrected_at: new Date().toISOString(),
            }
          : r
      )
    );
    saveLocalRecordOverride(recordId, cleanCount);

    const { error } = await supabase.rpc('correct_occupancy_record', {
      p_record_id: recordId,
      p_new_count: cleanCount,
      p_reason: cleanReason,
    });

    if (error) {
      const { data: updatedRows, error: directErr } = await supabase
        .from('occupancy_records')
        .update({
          occupancy_count: cleanCount,
          is_corrected: true,
          last_corrected_by: profile.id,
          last_corrected_by_name: profile.full_name,
          last_corrected_at: new Date().toISOString(),
          correction_reason: cleanReason,
          updated_at: new Date().toISOString(),
        })
        .eq('id', recordId)
        .select();

      if (!directErr && updatedRows && updatedRows.length > 0) {
        removeLocalRecordOverride(recordId);
      }
    } else {
      removeLocalRecordOverride(recordId);
    }

    setSavingInline(false);
    setInlineEditId(null);
    showToast('success', `Student count updated to ${cleanCount}.`);
  };

  const openEditRecordModal = (rec: OccupancyRecord) => {
    setEditingRecord(rec);
    setEditCount(rec.occupancy_count);
    setEditReason(rec.correction_reason || 'Updated occupancy count');
    setEditNotes(rec.notes || '');
  };

  const handleSaveEditedRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRecord) return;
    if (Number.isNaN(editCount) || editCount < 0) {
      showToast('error', 'Please enter a valid count (0 or greater).');
      return;
    }

    setSavingEdit(true);
    const cleanCount = Math.max(0, Math.round(editCount));
    const cleanNotes = editNotes.trim();
    const cleanReason = editReason.trim() || 'Direct count update by Student Assistant';

    // Immediate optimistic update in state and local storage
    setTodayRecords((prev) =>
      prev.map((r) =>
        r.id === editingRecord.id
          ? {
              ...r,
              occupancy_count: cleanCount,
              notes: cleanNotes || r.notes,
              is_corrected: true,
              last_corrected_at: new Date().toISOString(),
            }
          : r
      )
    );
    setHistoryRecords((prev) =>
      prev.map((r) =>
        r.id === editingRecord.id
          ? {
              ...r,
              occupancy_count: cleanCount,
              notes: cleanNotes || r.notes,
              is_corrected: true,
              last_corrected_at: new Date().toISOString(),
            }
          : r
      )
    );
    saveLocalRecordOverride(editingRecord.id, cleanCount, cleanNotes);

    const { error } = await supabase.rpc('correct_occupancy_record', {
      p_record_id: editingRecord.id,
      p_new_count: cleanCount,
      p_reason: cleanReason,
      p_notes: cleanNotes,
    });

    if (error) {
      const { data: updatedRows, error: directErr } = await supabase
        .from('occupancy_records')
        .update({
          occupancy_count: cleanCount,
          notes: cleanNotes,
          is_corrected: true,
          correction_count: (editingRecord.correction_count || 0) + 1,
          last_corrected_by: profile.id,
          last_corrected_by_name: profile.full_name,
          last_corrected_at: new Date().toISOString(),
          correction_reason: cleanReason,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingRecord.id)
        .select();

      if (!directErr && updatedRows && updatedRows.length > 0) {
        removeLocalRecordOverride(editingRecord.id);
      }
    } else {
      removeLocalRecordOverride(editingRecord.id);
    }

    setSavingEdit(false);
    const targetAreaName = areaById.get(editingRecord.area_id)?.name || 'Area';
    showToast(
      'success',
      `Updated ${targetAreaName} (${formatSlotLabel(editingRecord.time_slot)}) to ${cleanCount} students.`
    );
    setEditingRecord(null);
    await loadDashboardData();
    if (viewMode === 'history') {
      await loadHistoryRecords();
    }
  };

  const handleSaveMissingSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fillingSlot) return;
    if (Number.isNaN(fillCount) || fillCount < 0 || fillCount > 2000) {
      showToast('error', 'Please enter a valid number between 0 and 2,000.');
      return;
    }

    const cleanCount = Math.max(0, Math.round(fillCount));
    const cleanReason = fillReason.trim() || 'Recorded missed interval';
    const cleanNotes = fillNotes.trim();
    const targetArea = fillingSlot.area;
    const targetSlot = fillingSlot.slot;
    const targetDate = fillingSlot.date;

    // 1. Instant Optimistic Record for 0ms UI Update
    const tempId = -Date.now();
    const optimisticRecord: OccupancyRecord = {
      id: tempId,
      record_date: targetDate,
      time_slot: targetSlot,
      area_id: targetArea.id,
      occupancy_count: cleanCount,
      recorded_by: profile.id,
      recorded_by_name: profile.full_name || 'Staff',
      session_id: myActiveSession?.id || null,
      notes: cleanNotes || cleanReason,
      recorded_at: new Date().toISOString(),
      is_off_hours_entry: !intervalCountdown.isOperatingHours,
      is_corrected: false,
      correction_count: 0,
      last_corrected_by: null,
      last_corrected_by_name: null,
      last_corrected_at: null,
      correction_reason: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // 2. Instantly update UI state so card turns GREEN immediately (0ms)
    setTodayRecords((prev) => {
      const idx = prev.findIndex(
        (r) => r.area_id === targetArea.id && r.time_slot === targetSlot && r.record_date === targetDate
      );
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = optimisticRecord;
        return copy;
      }
      return [...prev, optimisticRecord];
    });

    setHistoryRecords((prev) => [optimisticRecord, ...prev.filter((r) => r.id !== tempId)]);

    // 3. Immediately close modal & show success toast
    setFillingSlot(null);
    setSelectedCompletedSlot(null);
    setSavingFill(false);
    showToast(
      'success',
      `Recorded ${cleanCount} students for ${targetArea.name} (${formatSlotRangeLabel(targetSlot)}).`
    );

    // 4. Asynchronously send network request to Supabase without blocking UI
    (async () => {
      try {
        const { data, error } = await supabase.rpc('admin_backfill_missing_record', {
          p_record_date: targetDate,
          p_time_slot: targetSlot,
          p_area_id: targetArea.id,
          p_occupancy_count: cleanCount,
          p_reason: cleanReason,
          p_notes: cleanNotes,
        });

        let savedRecord: OccupancyRecord | null = data as OccupancyRecord;

        if (error) {
          const { data: directData, error: directErr } = await supabase
            .from('occupancy_records')
            .insert({
              record_date: targetDate,
              time_slot: targetSlot,
              area_id: targetArea.id,
              occupancy_count: cleanCount,
              recorded_by: profile.id,
              recorded_by_name: profile.full_name,
              session_id: myActiveSession?.id || null,
              notes: cleanNotes || cleanReason,
            })
            .select()
            .single();

          if (directErr) {
            console.error('Failed to backfill missing record:', error, directErr);
            // Revert optimistic update on failure
            setTodayRecords((prev) => prev.filter((r) => r.id !== tempId));
            setHistoryRecords((prev) => prev.filter((r) => r.id !== tempId));
            showToast('error', `Failed to save: ${error.message || directErr.message}`);
            return;
          }
          savedRecord = directData as OccupancyRecord;
        }

        if (savedRecord) {
          setTodayRecords((prev) => prev.map((r) => (r.id === tempId ? savedRecord! : r)));
        }
      } catch (err: any) {
        console.error('Network error during backfill:', err);
      } finally {
        loadDashboardData(true);
        if (viewMode === 'history') {
          loadHistoryRecords();
        }
      }
    })();
  };

  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return historyRecords.filter((r) => {
      if (historyOnlyMine && r.recorded_by !== profile.id) return false;
      if (!q) return true;
      const areaName = sortedAreas.find((a) => a.id === r.area_id)?.name || '';
    return (
        r.record_date.includes(q) ||
        areaName.toLowerCase().includes(q) ||
        formatSlotLabel(r.time_slot).toLowerCase().includes(q) ||
        (r.notes || '').toLowerCase().includes(q)
      );
    });
  }, [historyRecords, historyOnlyMine, historySearch, profile.id, sortedAreas]);

  const totalHistoryPages = Math.max(1, Math.ceil(filteredHistory.length / PAGE_SIZE));
  const pagedHistory = useMemo(
    () =>
      filteredHistory.slice((historyPage - 1) * PAGE_SIZE, historyPage * PAGE_SIZE),
    [filteredHistory, historyPage]
  );

  const areaById = useMemo(() => {
    const map = new Map<number, LibraryArea>();
    assignableDutyAreas.forEach((a) => map.set(a.id, a));
    return map;
  }, [assignableDutyAreas]);

  // Sidebar items
  const navItems = useMemo<NavItem[]>(() => {
    const list: NavItem[] = [
      {
        id: 'areas',
        label: 'Library Areas',
        group: 'Monitoring & Duty',
        icon: Building2,
        badge: assignableDutyAreas.length,
        badgeTone: 'sage',
      },
      {
        id: 'schedule',
        label: 'My Duty Schedule',
        group: 'Monitoring & Duty',
        icon: CalendarClock,
        badge: myDutySchedules.length > 0 ? myDutySchedules.length : undefined,
        badgeTone: 'burgundy',
      },
      {
        id: 'calendar_activities',
        label: 'Calendar of Activities',
        group: 'Monitoring & Duty',
        icon: Calendar,
        badge: calendarActivities.length > 0 ? calendarActivities.length : undefined,
        badgeTone: 'mustard',
      },
    ];
    if (myActiveSession && activeArea) {
      list.push({
        id: 'session',
        label: `Active: ${activeArea.name}`,
        group: 'Monitoring & Duty',
        icon: Radio,
        badge: 'Live',
        badgeTone: 'sage',
      });
    }
    list.push({
      id: 'history',
      label: 'My Records',
      group: 'Records & Archive',
      icon: History,
      badge: todayMissingList.length > 0 ? `${todayMissingList.length} missing` : undefined,
      badgeTone: 'mustard',
    });
    return list;
  }, [myActiveSession, activeArea, todayMissingList.length, myDutySchedules.length, calendarActivities.length]);

  const notifications = useMemo<NotificationItem[]>(() => {
    const list: NotificationItem[] = [];
    if (dutyStatus.nextShiftOccurrence) {
      const nextOcc = dutyStatus.nextShiftOccurrence;
      const sched = nextOcc.assignment;
      const isNow = Boolean(
        dutyStatus.currentShift && dutyStatus.currentShift.id === sched.id
      );
      list.push({
        id: `next-duty-${sched.id}`,
        title: isNow
          ? `Active Duty Now: ${sched.areaName}`
          : `Next Assigned Duty: ${sched.areaName}`,
        description: `Next Assigned Area: ${sched.areaName} • Time: ${formatTimeSlotLabel(
          sched.startTime
        )} – ${formatTimeSlotLabel(sched.endTime)} • Day of Week: ${nextOcc.dayName} (${sched.dayGroup})`,
        tone: 'mustard',
        onClick: () => {
          setDutyScheduleTab(sched.dayGroup);
          setShowDutyScheduleModal(true);
        },
      });

      dutyStatus.allWeeklyShifts
        .filter((s) => s.id !== sched.id)
        .slice(0, 4)
        .forEach((s) => {
          list.push({
            id: `upcoming-duty-${s.id}`,
            title: `Assigned Rotation: ${s.areaName} (${DAY_GROUP_LABELS[s.dayGroup].shortDays})`,
            description: `Next Assigned Area: ${s.areaName} • Time: ${formatTimeSlotLabel(
              s.startTime
            )} – ${formatTimeSlotLabel(s.endTime)} • Day of Week: ${DAY_GROUP_LABELS[s.dayGroup].days.join(' / ')} (${s.dayGroup})`,
            tone: 'sage',
            onClick: () => {
              setDutyScheduleTab(s.dayGroup);
              setShowDutyScheduleModal(true);
            },
          });
        });
    }
    if (myActiveSession && activeArea) {
      list.push({
        id: 'active-session',
        title: `Monitoring ${activeArea.name}`,
        description: `${myActiveSession.records_submitted} count(s) submitted in this session.`,
        tone: 'sage',
        onClick: () => setViewMode('session'),
      });
    }
    if (todayMissingList.length > 0) {
      list.push({
        id: 'missing-today',
        title: `${todayMissingList.length} Missing Interval(s) Today`,
        description: 'Click to view unrecorded 30-minute intervals.',
        tone: 'mustard',
        onClick: () => setViewMode('history'),
      });
    }
    return list;
  }, [dutyStatus, myActiveSession, activeArea, todayMissingList.length]);

  const pageTitle =
    viewMode === 'session' && activeArea
      ? `${activeArea.name} — Active Monitoring`
      : viewMode === 'history'
      ? 'Submitted Occupancy Records'
      : viewMode === 'schedule'
      ? 'My Assigned Duty Schedule'
      : 'Library Areas & Duty Stations';

  const breadcrumbs = [
    'LIRC STAT',
    'Student Assistant',
    viewMode === 'session' && activeArea
      ? activeArea.name
      : viewMode === 'history'
      ? 'My Records'
      : viewMode === 'schedule'
      ? 'Duty Schedule'
      : 'Library Areas',
  ];

  const renderAssignedScheduleContent = () => {
    const activeTabShifts = myDutySchedules
      .filter((s) => isScheduleMatchingDay(s.dayGroup, dutyScheduleTab))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    return (
      <div className="space-y-4">
        {/* Day Group Tabs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {DAY_GROUPS.map((group) => {
            const isSelected = dutyScheduleTab === group;
            const groupShifts = myDutySchedules.filter((s) => isScheduleMatchingDay(s.dayGroup, group));
            const isTodayGroup = isScheduleMatchingDay(dutyStatus.todayGroup, group);
            const dotColor =
              group === 'Monday'
                ? 'bg-[#A83232]'
                : group === 'Tuesday'
                ? 'bg-[#E7B84B]'
                : group === 'Wednesday'
                ? 'bg-[#71865A]'
                : group === 'Thursday'
                ? 'bg-[#8F4B38]'
                : group === 'Friday'
                ? 'bg-[#2E5A44]'
                : 'bg-[#332F2B]';

            return (
              <button
                key={group}
                type="button"
                onClick={() => setDutyScheduleTab(group)}
                className={`p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between gap-1.5 ${
                  isSelected
                    ? 'bg-white border-[#A83232] shadow-xs ring-1 ring-[#A83232]'
                    : 'bg-white/70 border-[#D6C3A9] hover:bg-white hover:border-[#A83232]/50'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="text-xs font-bold text-[#332F2B] flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                    {DAY_GROUP_LABELS[group].shortDays}
                    {isTodayGroup && (
                      <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-[#A83232] text-white">
                        Today
                      </span>
                    )}
                  </div>
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold font-stat shrink-0 ${
                      groupShifts.length > 0
                        ? 'bg-[#F1F5EE] text-[#455436] border border-[#C5D3B8]'
                        : 'bg-[#FAF5EE] text-[#6E665E] border border-[#E6D7C3]'
                    }`}
                  >
                    {groupShifts.length}
                  </span>
                </div>
                <div className="text-[11px] font-semibold text-[#6E665E]">
                  {group}
                </div>
              </button>
            );
          })}
        </div>

        {/* Rotation Entries for Active Tab */}
        {activeTabShifts.length === 0 ? (
          <div className="p-8 rounded-xl border border-[#E6D7C3] bg-[#FAF5EE] text-center space-y-1.5">
            <div className="text-sm font-heading font-bold text-[#332F2B]">
              No Duty Rotations for {DAY_GROUP_LABELS[dutyScheduleTab].label}
            </div>
            <p className="text-xs text-[#6E665E]">
              The Librarian has not scheduled any rotations for you on {DAY_GROUP_LABELS[dutyScheduleTab].subLabel}.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {activeTabShifts.map((sched, idx) => {
              const areaObj =
                assignableDutyAreas.find((a) => a.id === sched.areaId) || BAGGAGE_DUTY_AREA;
              const isCurrentActive =
                dutyStatus.currentShift?.id === sched.id &&
                dutyStatus.todayGroup === sched.dayGroup;

              return (
                <div
                  key={sched.id}
                  className={`p-4 rounded-xl border transition flex flex-col justify-between gap-3 ${
                    isCurrentActive
                      ? 'bg-[#FEF9EC] border-[#E7B84B] shadow-xs'
                      : 'bg-white border-[#E6D7C3]'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
                        <span className="font-stat font-bold text-xs text-[#6E665E] shrink-0">
                          #{idx + 1}
                        </span>
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{
                            backgroundColor: areaObj.color_hex || '#A83232',
                          }}
                        />
                        <span className="font-heading font-bold text-base text-[#332F2B] truncate max-w-[200px]" title={sched.areaName}>
                          {sched.areaName}
                        </span>
                      </div>

                      {isCurrentActive && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#A83232] text-white shrink-0">
                          Active Duty Now
                        </span>
                      )}
                    </div>

                    <div className="text-xs font-stat text-[#332F2B] flex flex-wrap items-center gap-1.5 sm:gap-2 pt-0.5">
                      <span className="px-2.5 py-0.5 rounded-md bg-[#FAF5EE] text-[#332F2B] border border-[#D6C3A9] font-semibold whitespace-nowrap">
                        {formatTimeSlotLabel(sched.startTime)} – {formatTimeSlotLabel(sched.endTime)}
                      </span>
                      <span className="hidden sm:inline">·</span>
                      {sched.requiresStatistics ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#F1F5EE] text-[#455436] border border-[#C5D3B8] whitespace-nowrap">
                          <CheckCircle2 className="w-3 h-3 text-[#71865A]" />
                          Stats Required
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FEF9EC] text-[#7D5B06] border border-[#E7B84B] whitespace-normal sm:whitespace-nowrap">
                          {sched.areaName} (No Stats Required)
                        </span>
                      )}
                    </div>

                    {!sched.requiresStatistics ? (
                      <div className="text-xs text-[#7D5B06] bg-[#FAF5EE] px-3 py-1.5 rounded-lg border border-[#E6D7C3] mt-1.5 font-medium leading-relaxed">
                        <strong>{sched.areaName}:</strong> Statistics not required.
                      </div>
                    ) : sched.notes ? (
                      <div className="text-xs text-[#332F2B] bg-[#FAF5EE] px-3 py-1.5 rounded-lg border border-[#E6D7C3] mt-1.5 leading-relaxed">
                        <strong>Note:</strong> {sched.notes}
                      </div>
                    ) : null}

                    <div className="text-[11px] font-stat text-[#6E665E] pt-0.5">
                      Assigned by <strong>{sched.updatedBy}</strong> on{' '}
                      {formatTimestampPHT(sched.updatedAt)}
                    </div>
                  </div>

                  {sched.requiresStatistics && areaObj.id > 0 && (
                    <div className="pt-2 border-t border-[#E6D7C3]/60 flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleSelectArea(areaObj)}
                        className="px-3.5 py-1.5 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition shrink-0 shadow-2xs"
                      >
                        Report to {areaObj.name}
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="p-3.5 rounded-xl bg-[#FAF5EE] border border-[#E6D7C3] flex items-center justify-between text-xs text-[#6E665E]">
          <div className="flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-[#A83232] shrink-0" />
            <span>
              Schedules are managed by the Librarian.
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <AcademicLayout
      profile={profile}
      roleLabel="Student Assistant"
      pageTitle={pageTitle}
      breadcrumbs={breadcrumbs}
      navItems={navItems}
      activeNavId={showCalendarModal ? 'calendar_activities' : viewMode}
      isLoading={loadingDashboard}
      onSelectNav={(id) => {
        if (id === 'calendar_activities') {
          setShowCalendarModal(true);
          return;
        }
        topProgressBar.pulse(380);
        if (id === 'duty_schedule_modal') {
          setShowDutyScheduleModal(true);
          return;
        }
        setViewMode(id as 'areas' | 'schedule' | 'session' | 'history');
      }}
      onSignOut={onSignOut}
      clockDateLabel={formatShortDate(todayDate)}
      clockTimeLabel={syncedDisplayTime}
      isOperatingHours={serverClock?.is_operating_hours}
      notifications={notifications}
      searchValue={viewMode === 'history' ? historySearch : undefined}
      searchPlaceholder="Search area, time, note..."
      onSearchChange={
        viewMode === 'history'
          ? (val) => {
              setHistorySearch(val);
              setHistoryPage(1);
            }
          : undefined
      }
      headerActions={
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => {
              loadDashboardData();
              syncServerClock();
            }}
            className="p-1.5 sm:p-2 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-[#FFFFFF] dark:bg-[#1E1914] hover:bg-[#F5EBDD] dark:hover:bg-[#2A231C] text-[#332F2B] dark:text-[#F0E8DE] transition cursor-pointer shrink-0"
            title="Refresh data"
          >
            <RefreshCw className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${loadingDashboard ? 'animate-spin' : ''}`} />
          </button>
        </div>
      }
    >
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm animate-literary-fade">
          <div
            className={`px-4 py-3 rounded-xl shadow-lg border flex items-start gap-2.5 text-xs font-medium ${
              toast.type === 'success'
                ? 'bg-[#F1F5EE] text-[#455436] border-[#71865A]/40'
                : 'bg-[#FDF3F3] text-[#A83232] border-[#A83232]/30'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-[#71865A] shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-[#A83232] shrink-0 mt-0.5" />
            )}
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* ===================================================================
          VIEW 1: DASHBOARD & 6 LIBRARY AREAS
      =================================================================== */}
      {viewMode === 'areas' && (
        <div className="space-y-6">
          {/* Next Assigned Library Area Notification Card (Shown in Library Areas view) */}
          {/* Assigned Duty Area Overview (Showing Current Duty Area and Next Duty Area) */}
          {dutyStatus.currentShiftOccurrence || dutyStatus.upcomingShiftOccurrence ? (
            <div
              ref={dutyHeroRef}
              className="literary-card p-4 sm:p-5 bg-gradient-to-r from-[#FFFDF8] via-[#FEF9EC] to-[#FDF3DE] dark:from-[#261F12] dark:via-[#20190D] dark:to-[#1A1409] border-[#E7B84B] dark:border-[#E7B84B]/40 shadow-sm space-y-4"
            >
              {/* Header row */}
              <div className="flex items-center justify-between gap-2.5 pb-2.5 border-b border-[#E7B84B]/35 dark:border-[#E7B84B]/20">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#A83232] via-[#942727] to-[#701E1E] text-white flex items-center justify-center shrink-0 shadow-sm shadow-[#A83232]/25">
                    <CalendarClock className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-heading font-bold text-[#332F2B] dark:text-[#F5EFEB] flex items-center gap-2">
                      Duty Schedule Overview
                    </h2>
                    <p className="text-[11px] font-stat text-[#7C6E5F] dark:text-[#A89C8F]">
                      Today: <strong>{dutyStatus.todayDayName || getDayNameForDate(todayDate)}</strong>
                      {dutyStatus.todayGroup && (
                        <span> · {DAY_GROUP_LABELS[dutyStatus.todayGroup].label}</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {/* Two Information Cards: 1. Current Duty Area & Time, 2. Next Duty Area & Time */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4">
                {/* 1. CURRENT DUTY AREA & TIME */}
                <div className="bg-white/95 dark:bg-[#1C1814]/90 rounded-xl p-3.5 sm:p-4 border border-[#E8DCCB] dark:border-[#3D3328] shadow-2xs flex flex-col justify-between gap-3 relative overflow-hidden">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#7C6E5F] dark:text-[#A89C8F] flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            dutyStatus.currentShiftOccurrence ? 'bg-[#71865A] animate-pulse' : 'bg-stone-300'
                          }`}
                        />
                        Current Duty Area
                      </span>
                      {dutyStatus.currentShiftOccurrence ? (
                        (() => {
                          const isCurrentlyEnteredInCurrentArea =
                            (myActiveSession && myActiveSession.area_id === dutyStatus.currentShiftOccurrence.assignment.areaId) ||
                            activeStationDutyAreaId === dutyStatus.currentShiftOccurrence.assignment.areaId;

                          return isCurrentlyEnteredInCurrentArea ? (
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full text-white bg-[#71865A] shadow-2xs font-stat flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                              Active Monitoring
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full text-white bg-gradient-to-r from-[#A83232] to-[#8E2828] shadow-2xs font-stat">
                              {dutyStatus.currentShiftOccurrence.statusLabel}
                            </span>
                          );
                        })()
                      ) : (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full text-[#6E665E] bg-[#FAF5EE] border border-[#E6D7C3]">
                          {dutyStatus.isTodayCompleted ? 'Completed Today' : 'Off Duty'}
                        </span>
                      )}
                    </div>

                    {dutyStatus.currentShiftOccurrence ? (
                      <>
                        <div className="text-base sm:text-lg font-heading font-bold text-[#332F2B] dark:text-[#F2EFE9]">
                          <span className="text-[#A83232] dark:text-[#E25C5C] underline decoration-[#E7B84B] decoration-2 underline-offset-4">
                            {dutyStatus.currentShiftOccurrence.assignment.areaName}
                          </span>
                        </div>
                        <div className="text-xs font-stat text-[#332F2B] dark:text-[#DCD5C9] flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-[#A83232] shrink-0" />
                          <span>
                            <strong>Time:</strong>{' '}
                            {formatTimeSlotLabel(dutyStatus.currentShiftOccurrence.assignment.startTime)} –{' '}
                            {formatTimeSlotLabel(dutyStatus.currentShiftOccurrence.assignment.endTime)}
                          </span>
                        </div>
                        {!dutyStatus.currentShiftOccurrence.assignment.requiresStatistics ? (
                          <div className="text-[11px] text-[#7D5B06] dark:text-[#E7B84B] bg-[#FAF5EE] dark:bg-[#2A2318] px-2.5 py-1 rounded-md border border-[#E6D7C3] dark:border-[#4D3E2A] font-medium leading-relaxed">
                            <strong>{dutyStatus.currentShiftOccurrence.assignment.areaName}:</strong> Station duty · Statistics not required
                          </div>
                        ) : dutyStatus.currentShiftOccurrence.assignment.notes ? (
                          <div className="text-[11px] text-[#6E665E] dark:text-[#A89C8F] line-clamp-1 leading-relaxed">
                            <strong>Note:</strong> {dutyStatus.currentShiftOccurrence.assignment.notes}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <div className="text-sm sm:text-base font-heading font-semibold text-[#6E665E] dark:text-[#A89C8F]">
                          No Active Duty Right Now
                        </div>
                        <p className="text-xs text-[#6E665E] dark:text-[#A89C8F]">
                          {dutyStatus.isTodayCompleted
                            ? 'All scheduled duty shifts for today have been completed.'
                            : 'No duty schedule is active for the current time.'}
                        </p>
                      </>
                    )}
                  </div>
                </div>

                {/* 2. NEXT DUTY AREA & TIME */}
                <div className="bg-white/95 dark:bg-[#1C1814]/90 rounded-xl p-3.5 sm:p-4 border border-[#E8DCCB] dark:border-[#3D3328] shadow-2xs flex flex-col justify-between gap-3 relative overflow-hidden">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#7C6E5F] dark:text-[#A89C8F] flex items-center gap-1.5">
                        <ArrowRight className="w-3.5 h-3.5 text-[#E7B84B]" />
                        Next Duty Area
                      </span>
                      {dutyStatus.upcomingShiftOccurrence ? (
                        dutyStatus.upcomingShiftOccurrence.isTomorrow ? (
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full text-white bg-gradient-to-r from-[#A83232] via-[#942727] to-[#701E1E] ring-1 ring-[#E7B84B]/60 shadow-2xs font-stat">
                            TOMORROW
                          </span>
                        ) : dutyStatus.upcomingShiftOccurrence.isToday ? (
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full text-white bg-[#7D5B06] shadow-2xs font-stat">
                            {dutyStatus.upcomingShiftOccurrence.statusLabel}
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full text-[#7D5B06] bg-[#FAF5EE] border border-[#E6D7C3] font-stat">
                            {dutyStatus.upcomingShiftOccurrence.statusLabel}
                          </span>
                        )
                      ) : (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full text-[#6E665E] bg-[#FAF5EE] border border-[#E6D7C3]">
                          None Scheduled
                        </span>
                      )}
                    </div>

                    {dutyStatus.upcomingShiftOccurrence ? (
                      <>
                        <div className="text-base sm:text-lg font-heading font-bold text-[#332F2B] dark:text-[#F2EFE9] flex items-baseline gap-2">
                          <span className="text-[#332F2B] dark:text-[#F2EFE9]">
                            {dutyStatus.upcomingShiftOccurrence.assignment.areaName}
                          </span>
                          {!dutyStatus.upcomingShiftOccurrence.isToday && (
                            <span className="text-xs font-normal font-sans text-[#7C6E5F] dark:text-[#A89C8F]">
                              ({dutyStatus.upcomingShiftOccurrence.dayName})
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-stat text-[#332F2B] dark:text-[#DCD5C9] flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-[#7C6E5F] shrink-0" />
                          <span>
                            <strong>Time:</strong>{' '}
                            {formatTimeSlotLabel(dutyStatus.upcomingShiftOccurrence.assignment.startTime)} –{' '}
                            {formatTimeSlotLabel(dutyStatus.upcomingShiftOccurrence.assignment.endTime)}
                          </span>
                        </div>
                        {!dutyStatus.upcomingShiftOccurrence.assignment.requiresStatistics ? (
                          <div className="text-[11px] text-[#7D5B06] dark:text-[#E7B84B] bg-[#FAF5EE] dark:bg-[#2A2318] px-2.5 py-1 rounded-md border border-[#E6D7C3] dark:border-[#4D3E2A] font-medium leading-relaxed">
                            <strong>{dutyStatus.upcomingShiftOccurrence.assignment.areaName}:</strong> Station duty · Statistics not required
                          </div>
                        ) : dutyStatus.upcomingShiftOccurrence.assignment.notes ? (
                          <div className="text-[11px] text-[#6E665E] dark:text-[#A89C8F] line-clamp-1 leading-relaxed">
                            <strong>Note:</strong> {dutyStatus.upcomingShiftOccurrence.assignment.notes}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <div className="text-sm sm:text-base font-heading font-semibold text-[#6E665E] dark:text-[#A89C8F]">
                          No Next Duty Scheduled
                        </div>
                        <p className="text-xs text-[#6E665E] dark:text-[#A89C8F]">
                          You have no further duty rotations scheduled for this period.
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="literary-card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#FFFFFF]">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#FAF5EE] border border-[#E6D7C3] flex items-center justify-center text-[#6E665E] shrink-0">
                  <CalendarClock className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-heading font-bold text-[#332F2B]">
                    Duty Notifications
                  </h2>
                  <p className="text-xs text-[#6E665E] mt-0.5">
                    No duty schedule assigned yet. Your schedule will appear here.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Active Session Notice */}
          {myActiveSession && activeArea && (
            <div className="active-session-banner bg-gradient-to-r from-[#F8FAF7] via-[#F1F5EE] to-[#E3EEDC] dark:from-[#182615] dark:via-[#142011] dark:to-[#0F190D] border border-[#71865A]/45 dark:border-[#71865A]/60 rounded-2xl p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors">
              <div className="flex items-center gap-2.5 text-sm text-[#332F2B] dark:text-[#D1E7CA]">
                <span className="w-2.5 h-2.5 rounded-full bg-[#71865A] dark:bg-[#86A870] animate-pulse shrink-0" />
                <span>
                  Active monitoring session in <strong className="text-[#332F2B] dark:text-[#FFFFFF]">{activeArea.name}</strong> (
                  <span className="font-stat font-bold text-[#332F2B] dark:text-[#FFFFFF]">{myActiveSession.records_submitted}</span>{' '}
                  count(s) submitted).
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setViewMode('session')}
                  className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-[#A83232] via-[#942727] to-[#7C1E1E] hover:from-[#942727] hover:to-[#6E1A1A] text-[#FFFFFF] text-xs font-semibold shadow-sm shadow-[#A83232]/25 cursor-pointer transition"
                >
                  Open {activeArea.name}
                </button>
                <button
                  type="button"
                  disabled={exitingSession}
                  onClick={handleExitArea}
                  className="px-3.5 py-2 rounded-xl bg-[#FFFFFF] dark:bg-[#241F1B] border border-[#E6D7C3] dark:border-[#383028] hover:bg-[#FDF3F3] dark:hover:bg-[#332020] hover:text-[#A83232] dark:hover:text-[#E25D5D] text-[#332F2B] dark:text-[#F0E8DE] text-xs font-semibold cursor-pointer transition"
                >
                  Exit Area
                </button>
              </div>
            </div>
          )}



          {/* Active Station Notice (for Service Duty Stations like Baggage, Circulation, etc.) */}
          {activeStationDutyAreaId !== null && !myActiveSession && (() => {
            const stationObj = assignableDutyAreas.find((a) => a.id === activeStationDutyAreaId) || BAGGAGE_DUTY_AREA;
            const matchingShift = dutyStatus.todayShifts.find((s) => s.areaId === stationObj.id);
            return (
              <div className="active-station-banner bg-gradient-to-r from-[#F8FAF7] via-[#F1F5EE] to-[#E3EEDC] dark:from-[#182615] dark:via-[#142011] dark:to-[#0F190D] border border-[#71865A]/45 dark:border-[#71865A]/60 rounded-2xl p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors">
                <div className="flex items-center gap-2.5 text-sm text-[#332F2B] dark:text-[#D1E7CA]">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#71865A] dark:bg-[#86A870] animate-pulse shrink-0" />
                  <span>
                    Active monitoring at <strong className="text-[#332F2B] dark:text-[#FFFFFF]">{stationObj.name}</strong> (
                    {matchingShift ? `${formatTimeSlotLabel(matchingShift.startTime)} – ${formatTimeSlotLabel(matchingShift.endTime)} · ` : ''}
                    Service station duty active).
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1.5 rounded-xl bg-white dark:bg-[#1A1613] text-[#455436] dark:text-[#B2D898] border border-[#71865A]/30 text-xs font-semibold inline-flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-[#71865A] animate-pulse" />
                    Active Monitoring
                  </span>
                  <button
                    type="button"
                    onClick={() => handleLeaveStationArea(stationObj)}
                    className="px-3 py-1.5 rounded-xl bg-[#FFFFFF] dark:bg-[#241F1B] border border-[#E6D7C3] dark:border-[#383028] hover:bg-[#FDF3F3] dark:hover:bg-[#332020] hover:text-[#A83232] dark:hover:text-[#E25D5D] text-[#332F2B] dark:text-[#F0E8DE] text-xs font-semibold cursor-pointer transition"
                  >
                    Leave Station
                  </button>
                </div>
              </div>
            );
          })()}

          {/* 30-Minute Interval Status & Visual Progress Widget */}
          <div className="relative overflow-hidden rounded-2xl p-3.5 sm:p-4 bg-white dark:bg-[#1E1914] border border-[#E6D7C3] dark:border-[#383028] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4 transition-all">
            {/* Left side: Visual Icon + Clean Interval Range + Status Pill */}
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-2xs transition-colors ${
                  !isSubmissionLocked
                    ? 'bg-[#F1F5EE] dark:bg-[#1A2616] text-[#455436] dark:text-[#90D26D] border border-[#71865A]/40'
                    : intervalCountdown.isDueSoon
                    ? 'bg-[#FEF9EC] dark:bg-[#2F210C] text-[#A83232] dark:text-[#F5A3A3] border border-[#A83232]/40'
                    : 'bg-[#FAF5EE] dark:bg-[#25201A] text-[#8C6514] dark:text-[#E7B84B] border border-[#D6C3A9] dark:border-[#42382F]'
                }`}
              >
                {!isSubmissionLocked ? (
                  <CheckCircle2 className="w-5 h-5 text-[#455436] dark:text-[#90D26D]" />
                ) : (
                  <Clock className={`w-5 h-5 ${intervalCountdown.isDueSoon ? 'animate-pulse text-[#A83232] dark:text-[#F5A3A3]' : 'text-[#8C6514] dark:text-[#E7B84B]'}`} />
                )}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-heading font-extrabold text-sm sm:text-base text-[#332F2B] dark:text-[#FFFFFF] tracking-tight">
                    {!isSubmissionLocked
                      ? formatSlotRangeLabel(effectiveTargetSlot)
                      : formatSlotRangeLabel(intervalCountdown.underwaySlot)}
                  </span>
                  {!isSubmissionLocked ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#EBF4E5] dark:bg-[#1B2817] text-[#3B6E22] dark:text-[#90D26D] border border-[#71865A]/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#3B6E22] dark:bg-[#90D26D] animate-ping" />
                      Ready for Entry
                    </span>
                  ) : intervalCountdown.isDueSoon ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#FDF3F3] dark:bg-[#331717] text-[#A83232] dark:text-[#F5A3A3] border border-[#E8BDBD]/60 animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#A83232] dark:bg-[#F5A3A3]" />
                      Unlocking Soon
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#FEF9EC] dark:bg-[#2A2012] text-[#8C6514] dark:text-[#F5D075] border border-[#E7B84B]/40">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#E7B84B]" />
                      In Progress
                    </span>
                  )}
                </div>

                <div className="text-xs text-[#7D7063] dark:text-[#A89C8F] font-medium mt-0.5 flex items-center gap-2">
                  {!isSubmissionLocked ? (
                    <span className="text-[#455436] dark:text-[#90D26D] font-semibold">Headcount entry unlocked</span>
                  ) : (
                    <span>Unlocks at <strong className="font-stat text-[#332F2B] dark:text-[#FFFFFF]">{intervalCountdown.nextUnlockTimeFormatted}</strong></span>
                  )}
                </div>
              </div>
            </div>

            {/* Right side: Visual Progress & Prominent Countdown Box */}
            <div className="flex items-center gap-3 sm:gap-4 md:w-80 shrink-0">
              {/* Progress Bar with Percentage */}
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between text-[11px] font-stat text-[#7D7063] dark:text-[#A89C8F]">
                  <span className="font-medium">Progress</span>
                  <span className="font-bold text-[#332F2B] dark:text-[#FFFFFF]">{intervalCountdown.progressPercent}%</span>
                </div>
                <div className="w-full h-2.5 rounded-full bg-[#EFE6D8] dark:bg-[#2C241E] overflow-hidden p-0.5">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ${
                      !isSubmissionLocked
                        ? 'bg-gradient-to-r from-[#71865A] to-[#455436]'
                        : intervalCountdown.isDueSoon
                        ? 'bg-gradient-to-r from-[#E7B84B] to-[#A83232]'
                        : 'bg-gradient-to-r from-[#8C6514] via-[#B88728] to-[#71865A]'
                    }`}
                    style={{ width: `${intervalCountdown.progressPercent}%` }}
                  />
                </div>
              </div>

              {/* Countdown / Status Box */}
              <div className="shrink-0">
                {!isSubmissionLocked ? (
                  <div className="px-3 py-1.5 rounded-xl bg-[#EBF4E5] dark:bg-[#1B2817] border border-[#71865A]/40 text-[#3B6E22] dark:text-[#90D26D] flex items-center gap-1.5 shadow-2xs">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-xs font-bold font-stat uppercase tracking-wider">Unlocked</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#FAF5EE] dark:bg-[#25201A] border border-[#E6D7C3] dark:border-[#383028] shadow-2xs min-w-[95px]">
                    <Clock className="w-4 h-4 text-[#A83232] dark:text-[#E25D5D] shrink-0" />
                    <div className="flex flex-col text-left">
                      <span className="text-[9px] uppercase font-bold text-[#8C7F72] dark:text-[#8E8275] tracking-wider leading-none">
                        Remaining
                      </span>
                      <span className="font-stat font-extrabold text-sm sm:text-base text-[#A83232] dark:text-[#E25D5D] tracking-tight leading-tight">
                        {intervalCountdown.formattedTimeRemaining}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Areas Filter Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1 pb-1">
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[#F5EBDD] dark:bg-[#25201B] border border-[#E6D7C3] dark:border-[#383028] overflow-x-auto max-w-full">
              <button
                type="button"
                onClick={() => setAreaFilterType('ALL')}
                className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition flex items-center gap-1.5 shrink-0 ${
                  areaFilterType === 'ALL'
                    ? 'bg-white dark:bg-[#1A1613] text-[#A83232] shadow-xs'
                    : 'text-[#8B7355] dark:text-[#A89887] hover:text-[#332F2B] dark:hover:text-[#F0E8DE]'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span><span className="hidden sm:inline">All Areas & Stations</span><span className="sm:hidden">All</span> ({assignableDutyAreas.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setAreaFilterType('STATISTICAL')}
                className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition flex items-center gap-1.5 shrink-0 ${
                  areaFilterType === 'STATISTICAL'
                    ? 'bg-white dark:bg-[#1A1613] text-[#A83232] shadow-xs'
                    : 'text-[#8B7355] dark:text-[#A89887] hover:text-[#332F2B] dark:hover:text-[#F0E8DE]'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span><span className="hidden sm:inline">Reading Areas · Stats Required</span><span className="sm:hidden">Stats Required</span> ({sortedAreas.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setAreaFilterType('STATIONS')}
                className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition flex items-center gap-1.5 shrink-0 ${
                  areaFilterType === 'STATIONS'
                    ? 'bg-white dark:bg-[#1A1613] text-[#A83232] shadow-xs'
                    : 'text-[#8B7355] dark:text-[#A89887] hover:text-[#332F2B] dark:hover:text-[#F0E8DE]'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-[#71865A]" />
                <span><span className="hidden sm:inline">Service Stations · No Stats</span><span className="sm:hidden">Stations</span> ({EXEMPT_DUTY_AREAS.length})</span>
              </button>
            </div>

            <span className="text-xs text-[#8B7355] dark:text-[#A89887] font-stat hidden sm:block">
              Showing{' '}
              <strong className="text-[#332F2B] dark:text-[#F0E8DE]">
                {areaFilterType === 'ALL'
                  ? assignableDutyAreas.length
                  : areaFilterType === 'STATISTICAL'
                  ? sortedAreas.length
                  : EXEMPT_DUTY_AREAS.length}
              </strong>{' '}
              library areas
            </span>
          </div>

          {/* Library Areas Grid Container */}
          <div ref={areasGridRef} className="space-y-6">
            {/* SECTION 1: Monitored Reading Areas (Statistics Required) */}
            {(areaFilterType === 'ALL' || areaFilterType === 'STATISTICAL') && (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-wider text-[#332F2B] dark:text-[#F0E8DE] flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[#A83232]" />
                      Monitored Reading Areas ({sortedAreas.length})
                    </h3>
                    <p className="text-xs text-[#8B7355] dark:text-[#A89887] mt-0.5">
                      Hourly student head-count recording & occupancy monitoring
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sortedAreas.map((area) => {
                    const areaRecsToday = todayLookup.byAreaList.get(area.id) || [];
                    const areaDue = expectedTodaySlots.length;
                    const areaMissing = Math.max(0, areaDue - areaRecsToday.length);
                    const areaMonitors = activeSessions.filter((s) => s.area_id === area.id);
                    const uniqueMonitors = Array.from(
                      new Map(areaMonitors.map((s) => [s.user_id, s])).values()
                    );
                    const hasMonitors = uniqueMonitors.length > 0;
                    const isMine = myActiveSession?.area_id === area.id;
                    const sortedMonitors = [...uniqueMonitors].sort((a, b) => {
                      if (a.user_id === profile.id) return -1;
                      if (b.user_id === profile.id) return 1;
                      return a.user_name.localeCompare(b.user_name);
                    });
                    const latest = areaRecsToday[areaRecsToday.length - 1];
                    const pct = areaDue > 0 ? Math.min(100, Math.round((areaRecsToday.length / areaDue) * 100)) : 100;

                    return (
                      <div
                        key={area.id}
                        className={`sa-area-card literary-card literary-card-hover p-5 flex flex-col justify-between relative overflow-hidden ${
                          isMine ? 'ring-2 ring-[#71865A]' : ''
                        }`}
                      >
                        <div
                          className="h-1.5 w-full absolute top-0 left-0"
                          style={{ backgroundColor: area.color_hex }}
                        />
                        <div>
                          <div className="flex items-start justify-between gap-2 mb-1.5 pt-1">
                            <div className="flex items-center gap-2">
                              <span
                                className="w-3 h-3 rounded-full shrink-0"
                                style={{ backgroundColor: area.color_hex }}
                              />
                              <h2 className="font-heading font-bold text-lg text-[#332F2B] dark:text-[#F0E8DE]">
                                {area.name}
                              </h2>
                            </div>
                          </div>

                          {/* Dedicated Active Monitor Status Strip */}
                          <div className="mb-2.5">
                            {hasMonitors ? (
                              <div
                                className={`flex items-center justify-between text-xs font-medium px-3 py-1.5 rounded-xl border shadow-2xs ${
                                  isMine
                                    ? 'bg-[#F1F5EE] text-[#455436] border-[#71865A]/40'
                                    : 'bg-[#FEF9EC] text-[#7D5B06] border-[#E7B84B]'
                                }`}
                              >
                                <div className="flex items-center gap-2 truncate min-w-0 flex-1 mr-1.5">
                                  <span
                                    className={`w-2 h-2 rounded-full shrink-0 animate-pulse ${
                                      isMine ? 'bg-[#71865A]' : 'bg-[#E7B84B]'
                                    }`}
                                  />
                                  <span
                                    className="truncate"
                                    title={`Actively Monitored by: ${sortedMonitors
                                      .map((m) => (m.user_id === profile.id ? 'You' : m.user_name))
                                      .join(', ')}`}
                                  >
                                    Actively Monitored by{' '}
                                    {sortedMonitors.map((m, idx) => {
                                      const isSelf = m.user_id === profile.id;
                                      return (
                                        <React.Fragment key={m.id || m.user_id}>
                                          {idx > 0 && <span className="text-[#6E665E]">, </span>}
                                          <strong className="text-[#332F2B] font-semibold">
                                            {isSelf ? 'You' : m.user_name}
                                          </strong>
                                        </React.Fragment>
                                      );
                                    })}
                                  </span>
                                </div>
                                <span
                                  className={`text-[10px] uppercase font-bold font-stat shrink-0 ml-1.5 px-1.5 py-0.5 rounded border bg-white ${
                                    isMine
                                      ? 'text-[#71865A] border-[#C5D3B8]'
                                      : 'text-[#7D5B06] border-[#E7B84B]'
                                  }`}
                                >
                                  {sortedMonitors.length > 1 ? `Live (${sortedMonitors.length})` : 'Live'}
                                </span>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between text-xs text-[#6E665E] dark:text-[#A89887] bg-[#FAF5EE] dark:bg-[#25201B] px-3 py-1.5 rounded-xl border border-[#E6D7C3] dark:border-[#383028]">
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-[#D6C3A9]" />
                                  <span>No Active Monitor · Available</span>
                                </div>
                                <span className="text-[10px] font-semibold text-[#8C827A] bg-white dark:bg-[#1A1613] px-1.5 py-0.5 rounded border border-[#E6D7C3] dark:border-[#383028]">
                                  Open
                                </span>
                              </div>
                            )}
                          </div>

                          <p className="text-xs text-[#6E665E] dark:text-[#A89887] mb-1 font-stat">
                            Capacity: {area.capacity} seats
                          </p>
                          <p className="text-xs text-[#6E665E] dark:text-[#A89887] line-clamp-2 mb-3">
                            {area.description}
                          </p>

                          <div className="space-y-1.5 mb-4 pb-3 border-t border-[#E6D7C3] dark:border-[#383028]">
                            <div className="flex items-center justify-between text-xs text-[#332F2B] dark:text-[#F0E8DE] font-stat">
                              <span>
                                Today: <strong>{areaRecsToday.length}</strong>/{areaDue}
                                {areaMissing > 0 && (
                                  <span className="text-[#A83232] font-semibold ml-1">
                                    ({areaMissing} missing)
                                  </span>
                                )}
                              </span>
                              <span className="text-[#6E665E] dark:text-[#A89887]">
                                {latest ? `Latest: ${latest.occupancy_count}` : 'No counts yet'}
                              </span>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-[#F5EBDD] dark:bg-[#25201B] overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{ width: `${pct}%`, backgroundColor: area.color_hex }}
                              />
                            </div>
                          </div>
                        </div>

                        {isMine ? (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setViewMode('session')}
                              className="flex-1 h-10 px-4 rounded-xl bg-[#71865A] hover:bg-[#5E704A] text-[#FFFFFF] text-xs font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm shadow-[#71865A]/25"
                            >
                              <span>Continue Session</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={exitingSession}
                              onClick={handleExitArea}
                              className="h-10 px-3.5 rounded-xl bg-white dark:bg-[#1A1613] hover:bg-[#FDF3F3] dark:hover:bg-[#332020] border border-[#E6D7C3] dark:border-[#383028] hover:border-[#A83232]/40 text-[#6E665E] dark:text-[#A89887] hover:text-[#A83232] dark:hover:text-[#E25D5D] text-xs font-semibold transition cursor-pointer"
                              title="Exit and leave this area"
                            >
                              Leave
                            </button>
                          </div>
                        ) : hasMonitors ? (
                          <button
                            type="button"
                            disabled={startingAreaId === area.id}
                            onClick={() => handleSelectArea(area)}
                            className="w-full h-10 px-4 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-[#FFFFFF] text-xs font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-sm shadow-[#A83232]/20"
                          >
                            {startingAreaId === area.id
                              ? 'Opening...'
                              : sortedMonitors.length > 1
                              ? `Enter Area (${sortedMonitors.length} Active Monitors)`
                              : `Enter Area (Active: ${sortedMonitors[0].user_name.split(' ')[0]})`}
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={startingAreaId === area.id}
                            onClick={() => handleSelectArea(area)}
                            className="w-full h-10 px-4 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-[#FFFFFF] text-xs font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-sm shadow-[#A83232]/20"
                          >
                            {startingAreaId === area.id ? 'Opening...' : 'Enter Area (Start Monitoring)'}
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* SECTION 2: Service Duty Stations (Statistics Not Required) */}
            {(areaFilterType === 'ALL' || areaFilterType === 'STATIONS') && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between px-1">
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-wider text-[#332F2B] dark:text-[#F0E8DE] flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[#71865A]" />
                      Service Duty Stations ({EXEMPT_DUTY_AREAS.length})
                    </h3>
                    <p className="text-xs text-[#8B7355] dark:text-[#A89887] mt-0.5">
                      Baggage counter, circulation desk, and service support duty stations. Click Enter Area to mark your scheduled duty.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {EXEMPT_DUTY_AREAS.map((area) => {
                    const matchingShiftsToday = dutyStatus.todayShifts.filter((s) => s.areaId === area.id);
                    const isCurrentShiftForArea = dutyStatus.currentShift?.areaId === area.id;
                    const isStationActive = activeStationDutyAreaId === area.id;
                    const isEntered = isStationActive;

                    return (
                      <div
                        key={`exempt-area-${area.id}`}
                        className={`sa-area-card literary-card literary-card-hover p-5 flex flex-col justify-between ${
                          isEntered
                            ? 'ring-2 ring-[#71865A]'
                            : isCurrentShiftForArea
                            ? 'ring-2 ring-[#E7B84B]'
                            : ''
                        } relative overflow-hidden`}
                      >
                        <div
                          className="h-1.5 w-full absolute top-0 left-0"
                          style={{ backgroundColor: area.color_hex }}
                        />
                        <div>
                          <div className="flex items-start justify-between gap-2 mb-1.5 pt-1">
                            <div className="flex items-center gap-2">
                              <span
                                className="w-3 h-3 rounded-full shrink-0"
                                style={{ backgroundColor: area.color_hex }}
                              />
                              <h2 className="font-heading font-bold text-lg text-[#332F2B] dark:text-[#F0E8DE]">
                                {area.name}
                              </h2>
                            </div>
                          </div>

                          {/* Dedicated Active Station Status Strip */}
                          <div className="mb-2.5">
                            {isEntered ? (
                              <div className="flex items-center justify-between text-xs font-medium px-3 py-1.5 rounded-xl border shadow-2xs bg-[#F1F5EE] dark:bg-[#182414] text-[#455436] dark:text-[#B2D898] border-[#71865A]/40">
                                <div className="flex items-center gap-2 truncate min-w-0 flex-1 mr-1.5">
                                  <span className="w-2 h-2 rounded-full shrink-0 bg-[#71865A] animate-pulse" />
                                  <span className="truncate">
                                    Active Monitoring · <strong>You are on duty</strong>
                                  </span>
                                </div>
                                <span className="text-[10px] uppercase font-bold font-stat shrink-0 ml-1.5 px-1.5 py-0.5 rounded border bg-white dark:bg-[#1A1613] text-[#71865A] border-[#C5D3B8]">
                                  Live
                                </span>
                              </div>
                            ) : isCurrentShiftForArea ? (
                              <div className="flex items-center justify-between text-xs font-medium px-3 py-1.5 rounded-xl border shadow-2xs bg-[#FEF9EC] dark:bg-[#2A2318] text-[#7D5B06] dark:text-[#E7B84B] border-[#E7B84B]">
                                <div className="flex items-center gap-2 truncate min-w-0 flex-1 mr-1.5">
                                  <span className="w-2 h-2 rounded-full shrink-0 bg-[#E7B84B] animate-pulse" />
                                  <span className="truncate font-semibold">
                                    Current Duty Area ({formatTimeSlotLabel(dutyStatus.currentShift!.startTime)} – {formatTimeSlotLabel(dutyStatus.currentShift!.endTime)})
                                  </span>
                                </div>
                                <span className="text-[10px] uppercase font-bold font-stat shrink-0 ml-1.5 px-1.5 py-0.5 rounded border bg-white dark:bg-[#1A1613] text-[#7D5B06] border-[#E7B84B]">
                                  Assigned Now
                                </span>
                              </div>
                            ) : matchingShiftsToday.length > 0 ? (
                              <div className="flex items-center justify-between text-xs text-[#6E665E] dark:text-[#A89887] bg-[#FAF5EE] dark:bg-[#25201B] px-3 py-1.5 rounded-xl border border-[#E6D7C3] dark:border-[#383028]">
                                <div className="flex items-center gap-2 truncate min-w-0 flex-1 mr-1.5">
                                  <Clock className="w-3 h-3 text-[#A83232] shrink-0" />
                                  <span className="truncate">
                                    Scheduled: {matchingShiftsToday.map((s) => `${formatTimeSlotLabel(s.startTime)} – ${formatTimeSlotLabel(s.endTime)}`).join(', ')}
                                  </span>
                                </div>
                                <span className="text-[10px] font-semibold text-[#8C827A] bg-white dark:bg-[#1A1613] px-1.5 py-0.5 rounded border border-[#E6D7C3] dark:border-[#383028]">
                                  Scheduled
                                </span>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between text-xs text-[#6E665E] dark:text-[#A89887] bg-[#FAF5EE] dark:bg-[#25201B] px-3 py-1.5 rounded-xl border border-[#E6D7C3] dark:border-[#383028]">
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-[#D6C3A9]" />
                                  <span>Duty Station · Ready for Assignment</span>
                                </div>
                                <span className="text-[10px] font-semibold text-[#8C827A] bg-white dark:bg-[#1A1613] px-1.5 py-0.5 rounded border border-[#E6D7C3] dark:border-[#383028]">
                                  Open
                                </span>
                              </div>
                            )}
                          </div>

                          <p className="text-xs text-[#6E665E] dark:text-[#A89887] line-clamp-2 mb-3">
                            {area.description}
                          </p>

                          <div className="space-y-1.5 mb-4 pb-3 border-t border-[#E6D7C3] dark:border-[#383028]">
                            <div className="flex items-center justify-between text-xs text-[#332F2B] dark:text-[#F0E8DE] font-stat pt-1">
                              <span className="flex items-center gap-1 text-[#7D5B06] dark:text-[#E7B84B] font-medium">
                                <CheckCircle2 className="w-3.5 h-3.5 text-[#71865A] shrink-0" />
                                Statistics not required
                              </span>
                              <span className="text-[#6E665E] dark:text-[#A89887]">
                                {matchingShiftsToday.length > 0 ? (
                                  <strong className="text-[#332F2B] dark:text-[#F0E8DE]">
                                    {formatTimeSlotLabel(matchingShiftsToday[0].startTime)} – {formatTimeSlotLabel(matchingShiftsToday[0].endTime)}
                                  </strong>
                                ) : (
                                  'Service Desk'
                                )}
                              </span>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-[#F5EBDD] dark:bg-[#25201B] overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: isEntered ? '100%' : '0%',
                                  backgroundColor: isEntered ? '#71865A' : area.color_hex,
                                }}
                              />
                            </div>
                          </div>
                        </div>

                        {isEntered ? (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-10 px-3 rounded-xl bg-[#F1F5EE] dark:bg-[#182414] border border-[#71865A]/40 text-[#455436] dark:text-[#B2D898] text-xs font-semibold flex items-center justify-center gap-1.5">
                              <Radio className="w-4 h-4 text-[#71865A] animate-pulse" />
                              <span>Active Monitoring · Entered</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleLeaveStationArea(area)}
                              className="h-10 px-3.5 rounded-xl bg-white dark:bg-[#1A1613] hover:bg-[#FDF3F3] dark:hover:bg-[#332020] border border-[#E6D7C3] dark:border-[#383028] hover:border-[#A83232]/40 text-[#6E665E] dark:text-[#A89887] hover:text-[#A83232] dark:hover:text-[#E25D5D] text-xs font-semibold transition cursor-pointer"
                              title="Leave this station"
                            >
                              Leave
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleEnterStationArea(area)}
                            className="w-full h-10 px-4 rounded-xl bg-gradient-to-r from-[#71865A] via-[#5E704A] to-[#4B5A3B] hover:from-[#5E704A] hover:to-[#3E4A31] text-white text-xs font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm shadow-[#71865A]/20"
                          >
                            <span>Enter Area {matchingShiftsToday.length > 0 ? '(Mark Assignment)' : ''}</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Bottom Row: Recent Submissions + Daily Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-7 literary-card p-5">
              <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-[#E6D7C3]">
                <h3 className="text-base font-heading font-bold text-[#332F2B]">
                  Recent Submissions Today
                </h3>
                <button
                  type="button"
                  onClick={() => setViewMode('history')}
                  className="text-xs font-semibold text-[#A83232] hover:underline cursor-pointer"
                >
                  View archive →
                </button>
              </div>

              {todayRecords.length === 0 ? (
                <p className="text-xs text-[#6E665E] py-6 text-center">No submissions today yet.</p>
              ) : (
                <div className="divide-y divide-[#E6D7C3]/60">
                  {[...todayRecords]
                    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))
                    .slice(0, 6)
                    .map((r) => {
                      const area = areaById.get(r.area_id);
                    return (
                        <div key={r.id} className="py-2.5 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2.5">
                            <span
                              className="w-2.5 h-2.5 rounded-full"
                              style={{ backgroundColor: area?.color_hex || '#A83232' }}
                            />
                            <span className="font-semibold text-[#332F2B]">{area?.name}</span>
                            <span className="text-[#6E665E] font-stat">
                              {formatSlotLabel(r.time_slot)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <span className="font-stat font-bold text-[#332F2B]">
                              {r.occupancy_count} students
                            </span>
                            <button
                              type="button"
                              onClick={() => openEditRecordModal(r)}
                              className="px-2.5 py-1 rounded-lg border border-[#E6D7C3] bg-[#FFFFFF] hover:bg-[#A83232] hover:border-[#A83232] hover:text-[#FFFFFF] text-[#332F2B] font-semibold inline-flex items-center gap-1 transition cursor-pointer"
                            >
                              <Edit3 className="w-3 h-3" />
                              Edit
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            <div className="lg:col-span-5 literary-card p-5">
              <h3 className="text-base font-heading font-bold text-[#332F2B] mb-3 pb-2.5 border-b border-[#E6D7C3]">
                Your Daily Activity
              </h3>
              {myActivityLogs.length === 0 ? (
                <p className="text-xs text-[#6E665E] py-6 text-center">No activity logged yet.</p>
              ) : (
                <div className="space-y-2.5 max-h-60 overflow-y-auto">
                  {myActivityLogs.slice(0, 6).map((log) => (
                    <div
                      key={log.id}
                      className="text-xs pb-2.5 border-b border-[#E6D7C3]/60 last:border-0"
                    >
                      <div className="text-[#332F2B]">{log.description}</div>
                      <div className="text-[11px] text-[#6E665E] mt-0.5 font-stat">
                        {formatTimestampPHT(log.created_at)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          VIEW: DEDICATED ASSIGNED DUTY SCHEDULE (CONFIGURED BY LIBRARIANS)
      =================================================================== */}
      {viewMode === 'schedule' && (
        <div className="space-y-6 animate-literary-fade">
          <div className="literary-card p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-[#E6D7C3]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#FDF3F3] border border-[#E8BDBD] flex items-center justify-center text-[#A83232] shrink-0 shadow-2xs">
                  <CalendarClock className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-heading font-bold text-[#332F2B]">
                      Fixed Weekly Area Rotations
                    </h3>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#FAF5EE] text-[#7D5B06] border border-[#E7B84B]">
                      Librarian Assigned
                    </span>
                  </div>
                  <p className="text-xs text-[#6E665E]">
                    Select a schedule pattern (MWF, TTh, Saturday) to review your assigned time slots and duty stations.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="px-3 py-1.5 rounded-xl bg-[#FAF5EE] text-[#332F2B] border border-[#D6C3A9] text-xs font-medium font-stat">
                  Today: <strong>{dutyStatus.todayDayName || getDayNameForDate(todayDate)}</strong>
                  {dutyStatus.todayGroup && (
                    <span className="ml-1.5 text-[#A83232] font-bold">
                      ({DAY_GROUP_LABELS[dutyStatus.todayGroup].label})
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setViewMode('areas')}
                  className="px-3.5 py-1.5 rounded-xl bg-white hover:bg-[#F5EBDD] border border-[#D6C3A9] text-[#332F2B] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition shrink-0 shadow-2xs"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back to Library Areas
                </button>
              </div>
            </div>

            {renderAssignedScheduleContent()}
          </div>
        </div>
      )}

      {/* ===================================================================
          VIEW 2: ACTIVE AREA MONITORING SESSION
      =================================================================== */}
      {viewMode === 'session' && myActiveSession && activeArea && (
        <div className="max-w-4xl mx-auto space-y-5 animate-literary-fade">
          {/* Quick Area Header & Exit Bar */}
          <div className="literary-card p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <span
                className="w-3 h-11 rounded-full shrink-0"
                style={{ backgroundColor: activeArea.color_hex }}
              />
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-heading font-bold text-[#332F2B]">
                    {activeArea.name}
                  </h2>
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#F1F5EE] text-[#455436] border border-[#71865A]/40">
                    Active Session
                  </span>
                </div>
                <p className="text-xs text-[#6E665E] font-stat">
                  Capacity: {activeArea.capacity} seats ·{' '}
                  {myActiveSession.records_submitted} count(s) submitted ·{' '}
                  {(() => {
                    const othersInArea = activeSessions.filter(
                      (s) => s.area_id === activeArea.id && s.user_id !== profile.id
                    );
                    const uniqueOthers = Array.from(
                      new Map(othersInArea.map((s) => [s.user_id, s])).values()
                    );
                    if (uniqueOthers.length > 0) {
                      return (
                        <span>
                          Active Monitors: <strong className="text-[#332F2B] dark:text-[#FFFFFF]">You ({profile.full_name})</strong>
                          {uniqueOthers.map((o) => (
                            <React.Fragment key={o.id || o.user_id}>
                              , <strong className="text-[#332F2B] dark:text-[#FFFFFF]">{o.user_name}</strong>
                            </React.Fragment>
                          ))}
                        </span>
                      );
                    }
                    return (
                      <span>
                        Active Monitor: <strong className="text-[#332F2B] dark:text-[#FFFFFF]">{profile.full_name} (You)</strong>
                      </span>
                    );
                  })()}
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={exitingSession}
              onClick={handleExitArea}
              className="h-10 px-4 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-[#FFFFFF] text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <ArrowLeft className="w-4 h-4" />
              {exitingSession ? 'Exiting...' : 'Exit Area'}
            </button>
          </div>

          {/* Count Submission Card */}
          <div className="literary-card p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#E6D7C3]">
              <div>
                <h2 className="text-lg font-heading font-bold text-[#332F2B]">
                  Record Student Occupancy Count
                </h2>
                <p className="text-xs text-[#6E665E]">
                  Date and 30-minute time interval are synchronized from official server time.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs font-stat">
                <span className="px-3 py-1.5 rounded-lg bg-[#F5EBDD] text-[#332F2B] font-medium border border-[#E6D7C3]">
                  {formatShortDate(todayDate)}
                </span>
                {isSubmissionLocked ? (
                  <span className="px-3 py-1.5 rounded-lg bg-[#FEF9EC] dark:bg-[#2C2210] text-[#7D5B06] dark:text-[#F5D075] font-bold border border-[#E7B84B] flex items-center gap-1.5 shadow-2xs">
                    <Lock className="w-3.5 h-3.5 text-[#E7B84B]" />
                    {formatSlotRangeLabel(effectiveTargetSlot)} (Underway)
                  </span>
                ) : (
                  <span className="px-3 py-1.5 rounded-lg bg-[#F1F5EE] dark:bg-[#1E2B1E] text-[#455436] dark:text-[#A7D49B] font-bold border border-[#71865A]/50 flex items-center gap-1.5 shadow-2xs animate-pulse">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#71865A]" />
                    {formatSlotRangeLabel(effectiveTargetSlot)} (Completed · Open)
                  </span>
                )}
              </div>
            </div>


            {/* Off-Hours Selector when outside 8 AM - 6 PM */}
            {serverClock && !serverClock.is_operating_hours && (
              <div className="off-hours-banner p-3.5 rounded-xl bg-[#FEF9EC] dark:bg-[#251D0F] border border-[#E7B84B] dark:border-[#7D5B06] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs transition-colors">
                <div className="flex items-start gap-2 text-[#332F2B] dark:text-[#F5E6CC]">
                  <AlertTriangle className="w-4 h-4 text-[#7D5B06] dark:text-[#F5D075] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#332F2B] dark:text-[#FFFFFF]">Off-hours testing mode</strong> (operating hours: 8:00 AM – 6:00 PM). Select an open interval below:
                  </span>
                </div>
                <select
                  value={fallbackSlot}
                  onChange={(e) => setFallbackSlot(e.target.value)}
                  className="h-9 px-3 rounded-lg bg-[#FFFFFF] dark:bg-[#1E1914] border border-[#E6D7C3] dark:border-[#4A3C28] text-[#332F2B] dark:text-[#F5EEE6] font-semibold text-xs font-stat focus:outline-none focus:ring-1 focus:ring-[#E7B84B]"
                >
                  {LIBRARY_TIME_SLOTS.map((slot) => {
                    const taken = todayLookup.byAreaSlot.has(`${activeArea.id}|${slot.value}`);
                    return (
                      <option key={slot.value} value={slot.value} className="bg-white dark:bg-[#1E1914] text-[#332F2B] dark:text-[#F5EEE6]">
                        {slot.rangeLabel || slot.label} {taken ? '(Recorded)' : '(Open)'}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

            {/* Calendar Suspension Notice during Active Recording */}
            {(() => {
              const wholeDayInfo = isDateWholeDaySuspended(todayDate, calendarActivities, closedDaysOfWeek);
              const slotExcludedInfo = isSlotExcludedByCalendar(todayDate, effectiveTargetSlot, calendarActivities, closedDaysOfWeek);
              const wholeDay = wholeDayInfo.isSuspended;
              const slotExcluded = slotExcludedInfo.isExcluded;
              if (!wholeDay && !slotExcluded) return null;
              const matchingAct = wholeDayInfo.activity || slotExcludedInfo.activity;

              return (
                <div className="p-3 rounded-xl bg-[#FEF9EC] dark:bg-[#2A200E] border border-[#E7B84B]/60 dark:border-[#7D5B06] flex items-start gap-2.5 text-xs text-[#7D5B06] dark:text-[#F5D075]">
                  <Calendar className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-[#332F2B] dark:text-[#FFFFFF]">
                      Calendar Notice ({wholeDayInfo.isWeekdayClosed ? `Weekly Schedule Closure: Every ${wholeDayInfo.weekdayName || 'Weekday'}` : matchingAct?.title || 'Class Suspension'}):
                    </span>{' '}
                    <span>
                      {wholeDayInfo.isWeekdayClosed
                        ? `Library operations and statistics for every ${wholeDayInfo.weekdayName || 'Weekday'} are temporarily suspended by the Admin. Any records submitted on this day are excluded from statistical calculations.`
                        : wholeDay
                        ? 'Today is marked as No Classes. This entire day is automatically excluded from library statistical calculations.'
                        : `This interval (${formatSlotLabel(effectiveTargetSlot)}) falls during a scheduled suspension (${matchingAct?.startTime || ''} – ${matchingAct?.endTime || ''}) and is excluded from statistical calculations.`}
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Duplicate Locked vs Clean Form */}
            {existingRecordForTargetSlot ? (
              <div className="space-y-4">
                <div className="p-5 rounded-xl bg-[#F1F5EE] dark:bg-[#1E2B1E] border border-[#71865A]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-2xs">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-[#71865A] shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-heading font-bold text-[#332F2B] dark:text-[#FFFFFF]">
                        Already Recorded for {formatSlotRangeLabel(effectiveTargetSlot)}
                      </div>
                      <p className="text-xs text-[#455436] dark:text-[#A7D49B] mt-0.5">
                        <strong className="font-stat">{existingRecordForTargetSlot.occupancy_count} students</strong>{' '}
                        recorded by {existingRecordForTargetSlot.recorded_by_name} at{' '}
                        <span className="font-stat">
                          {formatTimestampPHT(existingRecordForTargetSlot.recorded_at)}
                        </span>
                        . Click <strong>Edit Count</strong> to update this entry or switch areas.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditRecordModal(existingRecordForTargetSlot)}
                      className="h-9 px-4 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-[#FFFFFF] text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-2xs transition"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      Edit Count
                    </button>
                    <button
                      type="button"
                      onClick={handleExitArea}
                      className="h-9 px-4 rounded-xl bg-[#FFFFFF] dark:bg-[#2A231C] border border-[#E6D7C3] dark:border-[#383028] hover:bg-[#F5EBDD] text-[#332F2B] dark:text-[#F0E8DE] text-xs font-semibold cursor-pointer shadow-2xs transition"
                    >
                      Switch Area
                    </button>
                  </div>
                </div>

                {/* Status for underway interval waiting for completion */}
                {intervalCountdown.isOperatingHours && (
                  <div className="p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-[#1E1914] border border-[#E6D7C3] dark:border-[#383028] flex items-center justify-between gap-3 shadow-xs">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-2xl bg-[#FEF9EC] dark:bg-[#2A2012] border border-[#E7B84B]/40 flex items-center justify-center shrink-0 text-[#8C6514] dark:text-[#E7B84B]">
                        <Clock className="w-5 h-5 animate-pulse" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-heading font-extrabold text-sm sm:text-base text-[#332F2B] dark:text-[#FFFFFF] tracking-tight">
                            {formatSlotRangeLabel(intervalCountdown.underwaySlot)}
                          </span>
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#FEF9EC] dark:bg-[#2A2012] text-[#8C6514] dark:text-[#F5D075] border border-[#E7B84B]/40">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#E7B84B]" />
                            In Progress
                          </span>
                        </div>
                        <div className="text-xs text-[#7D7063] dark:text-[#A89C8F] font-medium mt-0.5">
                          Unlocks at <strong className="font-stat text-[#332F2B] dark:text-[#FFFFFF]">{intervalCountdown.nextUnlockTimeFormatted}</strong>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#FAF5EE] dark:bg-[#25201A] border border-[#E6D7C3] dark:border-[#383028] shadow-2xs shrink-0">
                      <Clock className="w-4 h-4 text-[#A83232] dark:text-[#E25D5D] shrink-0" />
                      <div className="flex flex-col text-left">
                        <span className="text-[9px] uppercase font-bold text-[#8C7F72] dark:text-[#8E8275] tracking-wider leading-none">
                          Remaining
                        </span>
                        <span className="font-stat font-extrabold text-sm sm:text-base text-[#A83232] dark:text-[#E25D5D] tracking-tight leading-tight">
                          {intervalCountdown.formattedTimeRemaining}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <form onSubmit={handleSubmitOccupancy} className="space-y-5">
                {/* Underway Interval Lock Notice */}
                {isSubmissionLocked && (
                  <div className="p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-[#1E1914] border border-[#E6D7C3] dark:border-[#383028] space-y-3 shadow-xs">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-2xl bg-[#FEF9EC] dark:bg-[#2A2012] border border-[#E7B84B]/40 flex items-center justify-center shrink-0 text-[#8C6514] dark:text-[#E7B84B]">
                          <Lock className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-heading font-extrabold text-sm sm:text-base text-[#332F2B] dark:text-[#FFFFFF] tracking-tight">
                              {formatSlotRangeLabel(effectiveTargetSlot)}
                            </span>
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#FEF9EC] dark:bg-[#2A2012] text-[#8C6514] dark:text-[#F5D075] border border-[#E7B84B]/40">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#E7B84B]" />
                              In Progress
                            </span>
                          </div>
                          <div className="text-xs text-[#7D7063] dark:text-[#A89C8F] font-medium mt-0.5">
                            Unlocks at <strong className="font-stat text-[#332F2B] dark:text-[#FFFFFF]">{intervalCountdown.nextUnlockTimeFormatted}</strong>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#FAF5EE] dark:bg-[#25201A] border border-[#E6D7C3] dark:border-[#383028] shadow-2xs shrink-0">
                        <Clock className="w-4 h-4 text-[#A83232] dark:text-[#E25D5D] shrink-0" />
                        <div className="flex flex-col text-left">
                          <span className="text-[9px] uppercase font-bold text-[#8C7F72] dark:text-[#8E8275] tracking-wider leading-none">
                            Remaining
                          </span>
                          <span className="font-stat font-extrabold text-sm sm:text-base text-[#A83232] dark:text-[#E25D5D] tracking-tight leading-tight">
                            {intervalCountdown.formattedTimeRemaining}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Visual Progress Bar */}
                    <div className="space-y-1 pt-1 border-t border-[#E6D7C3]/60 dark:border-[#383028]/60">
                      <div className="flex items-center justify-between text-[11px] font-stat text-[#7D7063] dark:text-[#A89C8F]">
                        <span className="font-medium">Interval Progress</span>
                        <span className="font-bold text-[#332F2B] dark:text-[#FFFFFF]">{intervalCountdown.progressPercent}%</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-[#EFE6D8] dark:bg-[#2C241E] overflow-hidden p-0.5">
                        <div
                          className="h-full rounded-full transition-all duration-1000 bg-gradient-to-r from-[#8C6514] via-[#B88728] to-[#71865A]"
                          style={{ width: `${intervalCountdown.progressPercent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Completed Interval Prompt */}
                {!isSubmissionLocked && (
                  <div className="p-3 sm:p-3.5 rounded-2xl bg-[#EBF4E5] dark:bg-[#1B2817] border border-[#71865A]/40 flex items-center justify-between gap-3 text-xs shadow-xs">
                    <div className="flex items-center gap-2.5 text-[#3B6E22] dark:text-[#90D26D]">
                      <CheckCircle2 className="w-4 h-4 text-[#3B6E22] dark:text-[#90D26D] shrink-0" />
                      <span className="font-semibold">
                        Interval completed ({formatSlotRangeLabel(effectiveTargetSlot)}). Ready for headcount submission.
                      </span>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full bg-[#3B6E22] dark:bg-[#457C2A] text-white font-stat font-bold text-[10px] shrink-0 uppercase tracking-wider">
                      Unlocked
                    </span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] mb-2">
                    Number of Students Currently in {activeArea.name} ({formatSlotRangeLabel(effectiveTargetSlot)})
                  </label>
                  <div className={`space-y-3 ${isSubmissionLocked ? 'opacity-50 pointer-events-none' : ''}`}>
                    {/* Stepper Buttons: -5, -1, [Input], +1, +5, +10 */}
                    <div className="flex items-center gap-1 sm:gap-1.5 max-w-full">
                      <button
                        type="button"
                        disabled={isSubmissionLocked}
                        onClick={() => setStudentCount((c) => Math.max(0, c - 5))}
                        className="h-10 sm:h-11 px-2 sm:px-2.5 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-[#FFFFFF] dark:bg-[#1E1914] hover:bg-[#F5EBDD] dark:hover:bg-[#2A231C] text-[#332F2B] dark:text-[#F0E8DE] text-xs font-bold font-stat cursor-pointer transition shadow-2xs disabled:opacity-50 shrink-0"
                        title="Subtract 5 students"
                      >
                        -5
                      </button>
                      <button
                        type="button"
                        disabled={isSubmissionLocked}
                        onClick={() => setStudentCount((c) => Math.max(0, c - 1))}
                        className="w-9 sm:w-11 h-10 sm:h-11 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-[#FFFFFF] dark:bg-[#1E1914] hover:bg-[#F5EBDD] dark:hover:bg-[#2A231C] flex items-center justify-center text-[#332F2B] dark:text-[#F0E8DE] cursor-pointer transition shadow-2xs disabled:opacity-50 shrink-0"
                        aria-label="Decrease count"
                        title="Subtract 1 student"
                      >
                        <Minus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      </button>
                      <input
                        type="number"
                        min={0}
                        max={2000}
                        disabled={isSubmissionLocked}
                        value={studentCount}
                        onChange={(e) => setStudentCount(Math.max(0, Number(e.target.value)))}
                        className="flex-1 max-w-[96px] h-10 sm:h-11 text-center rounded-xl bg-[#FFFFFF] dark:bg-[#1E1914] border border-[#E6D7C3] dark:border-[#383028] text-[#332F2B] dark:text-[#F0E8DE] font-stat font-bold text-xl sm:text-2xl focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232] disabled:bg-gray-100 dark:disabled:bg-gray-900"
                        required
                      />
                      <button
                        type="button"
                        disabled={isSubmissionLocked}
                        onClick={() => setStudentCount((c) => Math.min(2000, c + 1))}
                        className="w-9 sm:w-11 h-10 sm:h-11 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-[#FFFFFF] dark:bg-[#1E1914] hover:bg-[#F5EBDD] dark:hover:bg-[#2A231C] flex items-center justify-center text-[#332F2B] dark:text-[#F0E8DE] cursor-pointer transition shadow-2xs disabled:opacity-50 shrink-0"
                        aria-label="Increase count"
                        title="Add 1 student"
                      >
                        <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      </button>
                      <button
                        type="button"
                        disabled={isSubmissionLocked}
                        onClick={() => setStudentCount((c) => Math.min(2000, c + 5))}
                        className="h-10 sm:h-11 px-2 sm:px-2.5 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-[#FFFFFF] dark:bg-[#1E1914] hover:bg-[#F5EBDD] dark:hover:bg-[#2A231C] text-[#A83232] dark:text-[#E25D5D] text-xs font-bold font-stat cursor-pointer transition shadow-2xs disabled:opacity-50 shrink-0"
                        title="Add 5 students"
                      >
                        +5
                      </button>
                      <button
                        type="button"
                        disabled={isSubmissionLocked}
                        onClick={() => setStudentCount((c) => Math.min(2000, c + 10))}
                        className="h-10 sm:h-11 px-2 sm:px-2.5 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-[#FFFFFF] dark:bg-[#1E1914] hover:bg-[#F5EBDD] dark:hover:bg-[#2A231C] text-[#A83232] dark:text-[#E25D5D] text-xs font-bold font-stat cursor-pointer transition shadow-2xs disabled:opacity-50 shrink-0"
                        title="Add 10 students"
                      >
                        +10
                      </button>
                    </div>

                    {/* Quick Preset Pills */}
                    <div className="flex flex-wrap items-center gap-1.5 font-stat">
                      {[0, 5, 10, 15, 20, 30, activeArea.capacity].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          disabled={isSubmissionLocked}
                          onClick={() => setStudentCount(preset)}
                          className={`px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold border transition cursor-pointer disabled:opacity-50 ${
                            studentCount === preset
                              ? 'bg-[#A83232] text-[#FFFFFF] border-[#A83232]'
                              : 'bg-[#FFFFFF] dark:bg-[#1E1914] text-[#332F2B] dark:text-[#F0E8DE] border-[#E6D7C3] dark:border-[#383028] hover:bg-[#F5EBDD] dark:hover:bg-[#2A231C]'
                          }`}
                        >
                          {preset === activeArea.capacity ? `Max (${preset})` : preset}
                        </button>
                      ))}
                    </div>
                  </div>

                  {studentCount > activeArea.capacity && (
                    <p className="text-xs text-[#7D5B06] mt-2 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Count exceeds seating capacity ({activeArea.capacity}). Please verify before submitting.
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-8">
                    <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] mb-1.5">
                      Observation / Note (Optional)
                    </label>
                    <input
                      type="text"
                      disabled={isSubmissionLocked}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="e.g. Thesis research group or quiet study"
                      className="w-full h-10 px-3.5 rounded-xl bg-[#FFFFFF] dark:bg-[#1E1914] border border-[#E6D7C3] dark:border-[#383028] text-sm text-[#332F2B] dark:text-[#F0E8DE] focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232] disabled:opacity-50"
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <button
                      type="submit"
                      disabled={isSubmissionLocked || submitting}
                      className={`w-full h-10 px-5 rounded-xl font-semibold text-sm shadow-xs transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 ${
                        isSubmissionLocked
                          ? 'bg-[#6E665E] text-[#FAF5EE] cursor-not-allowed'
                          : 'bg-[#A83232] hover:bg-[#8E2828] text-[#FFFFFF]'
                      }`}
                    >
                      {isSubmissionLocked ? (
                        <>
                          <Lock className="w-4 h-4" />
                          <span>Locked Until {intervalCountdown.nextUnlockTimeFormatted}</span>
                        </>
                      ) : submitting ? (
                        <span>Submitting...</span>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          <span>Submit Count</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>

          {/* Today's 30-Min Slots Grid */}
          <div className="literary-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4 pb-3 border-b border-[#E6D7C3] dark:border-[#383028]">
              <div>
                <h3 className="text-base font-heading font-bold text-[#332F2B] dark:text-[#FFFFFF]">
                  Today&apos;s 30-Minute Schedule — {activeArea.name}
                </h3>
                <p className="text-xs text-[#6E665E] dark:text-[#A89C8F]">
                  Click on any completed pending interval to record its student count.
                </p>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-[#6E665E] dark:text-[#A89C8F]">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[#71865A]" /> Completed & Saved
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[#A83232]" /> Completed & Pending
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[#E7B84B]" /> Interval In Progress
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
              {LIBRARY_TIME_SLOTS.map((slot) => {
                const rec = todayLookup.byAreaSlot.get(`${activeArea.id}|${slot.value}`);
                const isUnderway = intervalCountdown.isOperatingHours && slot.value === intervalCountdown.underwaySlot;
                const isCompleted = isSlotCompleted(slot.value, intervalCountdown.totalMinutes);
                const isPendingSubmission = !rec && isCompleted;
                const isCurrent = slot.value === effectiveTargetSlot;

                return (
                  <div
                    key={slot.value}
                    onClick={() => {
                      if (rec) {
                        openEditRecordModal(rec);
                      } else if (isPendingSubmission) {
                        setSelectedCompletedSlot(slot.value);
                        openMissingSlotModal(activeArea, slot.value, todayDate);
                      } else if (isUnderway) {
                        showToast('error', `Interval ${slot.rangeLabel || slot.label} is currently underway. Headcount entry automatically unlocks at ${getSlotEndTimeLabel(slot.value)}.`);
                      } else {
                        showToast('error', `Upcoming interval. Headcounts can only be recorded once completed at ${getSlotEndTimeLabel(slot.value)}.`);
                      }
                    }}
                    className={`p-3 rounded-xl border text-xs transition flex flex-col justify-between gap-2 cursor-pointer ${
                      rec
                        ? 'bg-[#F1F5EE] dark:bg-[#1E2B1E] border-[#71865A]/40'
                        : isPendingSubmission
                        ? isCurrent
                          ? 'bg-[#FDF3F3] dark:bg-[#2D1616] border-[#A83232] ring-2 ring-[#A83232]/30'
                          : 'bg-[#FDF3F3] dark:bg-[#2D1616] border-[#A83232]/50'
                        : isUnderway
                        ? 'bg-[#FEF9EC] dark:bg-[#251D0F] border-[#E7B84B]'
                        : 'bg-[#FFFFFF] dark:bg-[#1E1914] border-[#E6D7C3] dark:border-[#383028] opacity-75'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-stat font-semibold text-[#332F2B] dark:text-[#FFFFFF]">
                        {slot.rangeLabel || slot.label}
                      </span>
                      {rec ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#71865A]" />
                      ) : isPendingSubmission ? (
                        <span className="text-[10px] font-bold text-[#A83232] font-stat uppercase">
                          Due Now
                        </span>
                      ) : isUnderway ? (
                        <span className="text-[10px] font-bold text-[#7D5B06] dark:text-[#F5D075] font-stat uppercase flex items-center gap-1">
                          <Clock className="w-3 h-3 text-[#E7B84B]" />
                          Underway
                        </span>
                      ) : (
                        <span className="text-[10px] text-[#6E665E] dark:text-[#A89C8F] font-stat">Upcoming</span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      {rec ? (
                        <span
                          className="font-stat font-bold text-sm text-[#332F2B] dark:text-[#FFFFFF] inline-flex items-center gap-1.5"
                          title={`${rec.occupancy_count} students`}
                        >
                          {rec.occupancy_count}
                          <Users className="w-3.5 h-3.5 text-[#6E665E]" />
                        </span>
                      ) : isPendingSubmission ? (
                        <span className="font-stat text-[11px] font-bold text-[#A83232]">
                          Ready to log
                        </span>
                      ) : isUnderway ? (
                        <span className="font-stat text-[11px] font-semibold text-[#7D5B06] dark:text-[#F5D075]">
                          Unlocks {getSlotEndTimeLabel(slot.value)}
                        </span>
                      ) : (
                        <span className="font-stat font-bold text-sm text-[#6E665E]">—</span>
                      )}

                      {rec ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditRecordModal(rec);
                          }}
                          className="px-2 py-1 rounded-lg bg-[#FFFFFF] dark:bg-[#1E1914] border border-[#E6D7C3] dark:border-[#383028] hover:bg-[#A83232] hover:border-[#A83232] hover:text-[#FFFFFF] text-[#332F2B] dark:text-[#F0E8DE] text-[11px] font-semibold inline-flex items-center gap-1 transition cursor-pointer shadow-2xs"
                          title={`Edit ${slot.rangeLabel || slot.label} occupancy count`}
                        >
                          <Edit3 className="w-3 h-3" />
                          Edit Count
                        </button>
                      ) : isPendingSubmission ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedCompletedSlot(slot.value);
                            openMissingSlotModal(activeArea, slot.value, todayDate);
                          }}
                          className="px-2.5 py-1 rounded-md bg-[#A83232] hover:bg-[#8E2828] text-white text-[10px] font-semibold cursor-pointer shadow-2xs transition inline-flex items-center gap-1"
                          title={`Log headcount for ${slot.rangeLabel || slot.label}`}
                        >
                          Log Now
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          VIEW 3: MY RECORDS & MISSING INTERVALS
      =================================================================== */}
      {viewMode === 'history' && (
        <div className="space-y-5 animate-literary-fade">
          {/* Missing Intervals Today Banner */}
          {todayMissingList.length > 0 && (
            <div className="p-4 rounded-xl bg-[#FDF3F3] dark:bg-[#2D1616] border border-[#A83232]/40 shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#A83232] animate-pulse" />
                  <h3 className="font-heading font-bold text-sm text-[#A83232] dark:text-[#F5A3A3]">
                    Missing / Unrecorded Intervals Today ({todayMissingList.length})
                  </h3>
                </div>
                <span className="text-xs text-[#6E665E] dark:text-[#A89C8F]">
                  Click Log Now to record any missed interval
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                {todayMissingList.map((m) => (
                  <div
                    key={`${m.area.id}|${m.slot}`}
                    className="p-3 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-white dark:bg-[#1E1914] flex items-center justify-between gap-2 shadow-2xs"
                  >
                    <div>
                      <span className="text-xs font-bold text-[#332F2B] dark:text-[#FFFFFF] block">
                        {m.area.name}
                      </span>
                      <span className="text-[11px] font-stat text-[#A83232] dark:text-[#E25D5D] font-semibold">
                        {formatSlotRangeLabel(m.slot)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => openMissingSlotModal(m.area, m.slot, todayDate)}
                      className="px-2.5 py-1 rounded-lg bg-[#A83232] hover:bg-[#8E2828] text-white text-xs font-semibold cursor-pointer shadow-2xs transition shrink-0"
                    >
                      Log Now
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filter Bar */}
          <div className="literary-card p-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-[#6E665E] mb-1">From</label>
              <input
                type="date"
                value={historyStartDate}
                onChange={(e) => setHistoryStartDate(e.target.value)}
                className="h-9 px-3 rounded-xl bg-[#FFFFFF] border border-[#E6D7C3] text-xs font-stat focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#6E665E] mb-1">To</label>
              <input
                type="date"
                value={historyEndDate}
                onChange={(e) => setHistoryEndDate(e.target.value)}
                className="h-9 px-3 rounded-xl bg-[#FFFFFF] border border-[#E6D7C3] text-xs font-stat focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#6E665E] mb-1">Area</label>
              <select
                value={historyAreaFilter}
                onChange={(e) =>
                  setHistoryAreaFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))
                }
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
            <div className="flex-1 min-w-[160px]">
              <label className="block text-[11px] font-semibold text-[#6E665E] mb-1">Search</label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#6E665E] absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => {
                    setHistorySearch(e.target.value);
                    setHistoryPage(1);
                  }}
                  placeholder="Area, time, note..."
                  className="w-full h-9 pl-8 pr-3 rounded-xl bg-[#FFFFFF] border border-[#E6D7C3] text-xs focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
                />
              </div>
            </div>
            <label className="inline-flex items-center gap-1.5 text-xs text-[#332F2B] py-2 cursor-pointer">
              <input
                type="checkbox"
                checked={historyOnlyMine}
                onChange={(e) => {
                  setHistoryOnlyMine(e.target.checked);
                  setHistoryPage(1);
                }}
              />
              Only my records
            </label>
            <button
              type="button"
              onClick={loadHistoryRecords}
              className="h-9 px-4 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-[#FFFFFF] text-xs font-semibold cursor-pointer"
            >
              Filter
            </button>
          </div>

          {/* Table with Pagination */}
          <div className="literary-card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#E6D7C3] flex items-center justify-between">
              <h2 className="text-base font-heading font-bold text-[#332F2B]">
                Submitted Occupancy Records (<span className="font-stat">{filteredHistory.length}</span>)
              </h2>
              <span className="text-xs text-[#6E665E]">All edits are logged in Activity Logs</span>
            </div>

            {loadingHistory ? (
              <div className="p-10 text-center text-xs text-[#6E665E]">Loading records...</div>
            ) : filteredHistory.length === 0 ? (
              <div className="p-10 text-center text-xs text-[#6E665E]">No records found.</div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#FAF5EE] border-b border-[#E6D7C3] text-[#332F2B]">
                      <tr>
                        <th className="py-3 px-4 font-semibold">Date</th>
                        <th className="py-3 px-4 font-semibold">Time Slot</th>
                        <th className="py-3 px-4 font-semibold">Library Area</th>
                        <th className="py-3 px-4 font-semibold">Count</th>
                        <th className="py-3 px-4 font-semibold">Status</th>
                        <th className="py-3 px-4 font-semibold">Recorded By</th>
                        <th className="py-3 px-4 font-semibold">Note</th>
                        <th className="py-3 px-4 font-semibold text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6D7C3]/60">
                      {pagedHistory.map((rec) => {
                        const area = areaById.get(rec.area_id);
                      return (
                          <tr key={rec.id} className="hover:bg-[#FAF5EE]/70">
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
                            <td className="py-2.5 px-4 font-stat">
                              {inlineEditId === rec.id ? (
                                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    onClick={() => setInlineEditCount((c) => Math.max(0, c - 5))}
                                    className="px-1.5 h-7 rounded-lg border border-[#D6C3A9] bg-white hover:bg-[#F5EBDD] text-[#332F2B] font-bold text-[11px] font-stat cursor-pointer shadow-2xs"
                                    title="Subtract 5"
                                  >
                                    -5
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setInlineEditCount((c) => Math.max(0, c - 1))}
                                    className="w-7 h-7 rounded-lg border border-[#D6C3A9] bg-white hover:bg-[#F5EBDD] flex items-center justify-center text-[#332F2B] font-bold text-xs cursor-pointer shadow-2xs"
                                    title="Decrease count"
                                  >
                                    <Minus className="w-3 h-3" />
                                  </button>
                                  <input
                                    type="number"
                                    min={0}
                                    max={2000}
                                    autoFocus
                                    value={inlineEditCount}
                                    onChange={(e) => setInlineEditCount(Math.max(0, Number(e.target.value)))}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleSaveInlineCount(rec.id, inlineEditCount);
                                      if (e.key === 'Escape') setInlineEditId(null);
                                    }}
                                    className="w-16 h-7 text-center rounded-lg border-2 border-[#A83232] font-stat font-bold text-sm bg-white text-[#332F2B] focus:outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setInlineEditCount((c) => Math.min(2000, c + 1))}
                                    className="w-7 h-7 rounded-lg border border-[#D6C3A9] bg-white hover:bg-[#F5EBDD] flex items-center justify-center text-[#332F2B] font-bold text-xs cursor-pointer shadow-2xs"
                                    title="Increase count"
                                  >
                                    <Plus className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setInlineEditCount((c) => Math.min(2000, c + 5))}
                                    className="px-1.5 h-7 rounded-lg border border-[#D6C3A9] bg-white hover:bg-[#F5EBDD] text-[#A83232] font-bold text-[11px] font-stat cursor-pointer shadow-2xs"
                                    title="Add 5"
                                  >
                                    +5
                                  </button>
                                  <button
                                    type="button"
                                    disabled={savingInline}
                                    onClick={() => handleSaveInlineCount(rec.id, inlineEditCount)}
                                    className="px-2 h-7 rounded-lg bg-[#71865A] hover:bg-[#5E704A] text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer transition shadow-2xs disabled:opacity-50"
                                    title="Save student count"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setInlineEditId(null)}
                                    className="w-7 h-7 rounded-lg border border-[#D6C3A9] bg-white hover:bg-[#F5EBDD] flex items-center justify-center text-[#6E665E] cursor-pointer"
                                    title="Cancel"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <div className="inline-flex items-center gap-1.5 group">
                                  <span className="font-bold text-[#332F2B] text-sm">
                                    {rec.occupancy_count}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setInlineEditId(rec.id);
                                      setInlineEditCount(rec.occupancy_count);
                                    }}
                                    className="opacity-70 group-hover:opacity-100 p-1 rounded-md text-[#A83232] hover:bg-[#FAF5EE] transition cursor-pointer"
                                    title="Directly edit count inline"
                                  >
                                    <Edit3 className="w-3 h-3" />
                                  </button>
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-4 whitespace-nowrap">
                              {rec.is_corrected ? (
                                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#FEF9EC] text-[#7D5B06] border border-[#E7B84B]/60">
                                  Edited
                                </span>
                              ) : (
                                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#F1F5EE] text-[#455436] border border-[#71865A]/40">
                                  Completed
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-[#332F2B] whitespace-nowrap">{rec.recorded_by_name}</td>
                            <td className="py-2.5 px-4 text-[#6E665E]">{rec.notes || '—'}</td>
                            <td className="py-2.5 px-4 text-right whitespace-nowrap">
                              <div className="inline-flex items-center justify-end gap-1.5">
                                {inlineEditId === rec.id ? (
                                  <button
                                    type="button"
                                    onClick={() => setInlineEditId(null)}
                                    className="px-2.5 py-1 rounded-lg border border-[#E6D7C3] bg-white hover:bg-[#F5EBDD] text-[#6E665E] font-semibold text-xs cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setInlineEditId(rec.id);
                                        setInlineEditCount(rec.occupancy_count);
                                      }}
                                      className="px-2.5 py-1 rounded-lg border border-[#D6C3A9] bg-white hover:bg-[#F5EBDD] text-[#332F2B] font-semibold text-xs inline-flex items-center gap-1 cursor-pointer transition shadow-2xs"
                                    >
                                      <Edit3 className="w-3 h-3 text-[#A83232]" />
                                      Edit Count
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Bar */}
                <div className="px-5 py-3 border-t border-[#E6D7C3] bg-[#FAF5EE]/50 flex flex-wrap items-center justify-between gap-2 text-xs text-[#6E665E]">
                  <span className="font-stat">
                    Showing {(historyPage - 1) * PAGE_SIZE + 1}–
                    {Math.min(historyPage * PAGE_SIZE, filteredHistory.length)} of{' '}
                    {filteredHistory.length}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={historyPage <= 1}
                      onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                      className="px-2.5 py-1 rounded-lg border border-[#E6D7C3] bg-[#FFFFFF] hover:bg-[#F5EBDD] text-[#332F2B] font-semibold disabled:opacity-40 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      Prev
                    </button>
                    <span className="px-2 font-stat font-semibold text-[#332F2B]">
                      Page {historyPage} of {totalHistoryPages}
                    </span>
                    <button
                      type="button"
                      disabled={historyPage >= totalHistoryPages}
                      onClick={() => setHistoryPage((p) => Math.min(totalHistoryPages, p + 1))}
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
        </div>
      )}

      {/* ===================================================================
          MODAL 1: EDIT EXISTING OCCUPANCY RECORD
      =================================================================== */}
      {editingRecord && createPortal(
        <div className="fixed inset-0 z-[9999] bg-[#332F2B]/65 dark:bg-black/80 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-4 animate-literary-fade overflow-y-auto">
          <div ref={editModalRef} className="literary-card shadow-2xl max-w-md w-full p-4 sm:p-6 max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-2 mb-4">
              <div>
                <h3 className="text-base sm:text-lg font-heading font-bold text-[#332F2B]">
                  Edit Occupancy Count
                </h3>
                <p className="text-xs text-[#6E665E] mt-0.5 font-stat">
                  {areaById.get(editingRecord.area_id)?.name} ·{' '}
                  {formatShortDate(editingRecord.record_date)} at{' '}
                  {formatSlotRangeLabel(editingRecord.time_slot)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingRecord(null)}
                className="p-1.5 rounded-lg hover:bg-[#F5EBDD] text-[#6E665E] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditedRecord} className="space-y-4">
              <div className="p-3 rounded-xl bg-[#F5EBDD] text-xs text-[#332F2B] flex justify-between items-center">
                <span>Current recorded count:</span>
                <strong className="font-stat text-sm">
                  {editingRecord.occupancy_count} students
                </strong>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#332F2B] mb-1.5">
                  Direct Student Count
                </label>
                <div className="flex items-center gap-1 sm:gap-1.5 max-w-full">
                  <button
                    type="button"
                    onClick={() => setEditCount((c) => Math.max(0, c - 5))}
                    className="h-9 sm:h-10 px-2 sm:px-2.5 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-[#FFFFFF] dark:bg-[#1E1914] hover:bg-[#F5EBDD] dark:hover:bg-[#2A231C] text-[#332F2B] dark:text-[#F0E8DE] font-bold text-xs font-stat cursor-pointer transition shadow-2xs shrink-0"
                    title="Subtract 5"
                  >
                    -5
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditCount((c) => Math.max(0, c - 1))}
                    className="w-8 sm:w-10 h-9 sm:h-10 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-[#FFFFFF] dark:bg-[#1E1914] hover:bg-[#F5EBDD] dark:hover:bg-[#2A231C] flex items-center justify-center text-[#332F2B] dark:text-[#F0E8DE] cursor-pointer transition shadow-2xs shrink-0"
                    title="Subtract 1"
                  >
                    <Minus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </button>
                  <input
                    type="number"
                    min={0}
                    max={2000}
                    required
                    value={editCount}
                    onChange={(e) => setEditCount(Math.max(0, Number(e.target.value)))}
                    className="flex-1 max-w-[80px] sm:max-w-[100px] h-9 sm:h-10 text-center rounded-xl bg-[#FFFFFF] dark:bg-[#1E1914] border border-[#E6D7C3] dark:border-[#383028] text-[#332F2B] dark:text-[#F0E8DE] font-stat font-bold text-lg sm:text-xl focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
                  />
                  <button
                    type="button"
                    onClick={() => setEditCount((c) => Math.min(2000, c + 1))}
                    className="w-8 sm:w-10 h-9 sm:h-10 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-[#FFFFFF] dark:bg-[#1E1914] hover:bg-[#F5EBDD] dark:hover:bg-[#2A231C] flex items-center justify-center text-[#332F2B] dark:text-[#F0E8DE] cursor-pointer transition shadow-2xs shrink-0"
                    title="Add 1"
                  >
                    <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditCount((c) => Math.min(2000, c + 5))}
                    className="h-9 sm:h-10 px-2 sm:px-2.5 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-[#FFFFFF] dark:bg-[#1E1914] hover:bg-[#F5EBDD] dark:hover:bg-[#2A231C] text-[#A83232] dark:text-[#E25D5D] font-bold text-xs font-stat cursor-pointer transition shadow-2xs shrink-0"
                    title="Add 5"
                  >
                    +5
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditCount((c) => Math.min(2000, c + 10))}
                    className="h-9 sm:h-10 px-2 sm:px-2.5 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-[#FFFFFF] dark:bg-[#1E1914] hover:bg-[#F5EBDD] dark:hover:bg-[#2A231C] text-[#A83232] dark:text-[#E25D5D] font-bold text-xs font-stat cursor-pointer transition shadow-2xs shrink-0"
                    title="Add 10"
                  >
                    +10
                  </button>
                </div>

                {/* Quick Presets */}
                <div className="flex flex-wrap items-center gap-1.5 font-stat mt-2">
                  {[0, 5, 10, 20, 35].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setEditCount(preset)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                        editCount === preset
                          ? 'bg-[#A83232] text-white border-[#A83232]'
                          : 'bg-white text-[#332F2B] border-[#E6D7C3] hover:bg-[#FAF5EE]'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                  {(() => {
                    const areaObj = areaById.get(editingRecord.area_id);
                    if (areaObj && areaObj.capacity > 0) {
                      return (
                        <button
                          type="button"
                          onClick={() => setEditCount(areaObj.capacity)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                            editCount === areaObj.capacity
                              ? 'bg-[#A83232] text-white border-[#A83232]'
                              : 'bg-white text-[#332F2B] border-[#E6D7C3] hover:bg-[#FAF5EE]'
                          }`}
                        >
                          Max ({areaObj.capacity})
                        </button>
                      );
                    }
                    return null;
                  })()}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#332F2B] mb-1">
                  Note (Optional)
                </label>
                <input
                  type="text"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Optional remark"
                  className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] border border-[#E6D7C3] text-sm focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingRecord(null)}
                  className="h-9 px-4 rounded-xl border border-[#E6D7C3] bg-[#FFFFFF] text-xs font-semibold text-[#332F2B] hover:bg-[#F5EBDD] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="h-9 px-4 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-[#FFFFFF] text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  {savingEdit ? 'Saving...' : 'Save Student Count'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ===================================================================
          MODAL 2: RECORD MISSING PAST SLOT
      =================================================================== */}
      {fillingSlot && createPortal(
        <div className="fixed inset-0 z-[9999] bg-[#332F2B]/65 dark:bg-black/80 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-4 animate-literary-fade overflow-y-auto">
          <div ref={fillModalRef} className="literary-card shadow-2xl max-w-md w-full p-4 sm:p-6 max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-2 mb-4">
              <div>
                <h3 className="text-base sm:text-lg font-heading font-bold text-[#332F2B]">
                  Record Missing Slot
                </h3>
                <p className="text-xs text-[#6E665E] mt-0.5 font-stat">
                  {fillingSlot.area.name} · {formatShortDate(fillingSlot.date)} at{' '}
                  {formatSlotRangeLabel(fillingSlot.slot)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFillingSlot(null)}
                className="p-1.5 rounded-lg hover:bg-[#F5EBDD] text-[#6E665E] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveMissingSlot} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] mb-1.5">
                  Observed Student Headcount
                </label>
                <div className="flex items-center gap-1 sm:gap-1.5 max-w-full">
                  <button
                    type="button"
                    onClick={() => setFillCount((c) => Math.max(0, c - 5))}
                    className="h-9 sm:h-10 px-2 sm:px-2.5 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-[#FFFFFF] dark:bg-[#1E1914] hover:bg-[#F5EBDD] dark:hover:bg-[#2A231C] text-[#332F2B] dark:text-[#F0E8DE] font-bold text-xs font-stat cursor-pointer transition shadow-2xs shrink-0"
                    title="Subtract 5"
                  >
                    -5
                  </button>
                  <button
                    type="button"
                    onClick={() => setFillCount((c) => Math.max(0, c - 1))}
                    className="w-8 sm:w-10 h-9 sm:h-10 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-[#FFFFFF] dark:bg-[#1E1914] hover:bg-[#F5EBDD] dark:hover:bg-[#2A231C] flex items-center justify-center text-[#332F2B] dark:text-[#F0E8DE] cursor-pointer transition shadow-2xs shrink-0"
                    title="Subtract 1"
                  >
                    <Minus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </button>
                  <input
                    type="number"
                    min={0}
                    max={2000}
                    required
                    value={fillCount}
                    onChange={(e) => setFillCount(Math.max(0, Number(e.target.value)))}
                    className="flex-1 max-w-[80px] sm:max-w-[100px] h-9 sm:h-10 text-center rounded-xl bg-[#FFFFFF] dark:bg-[#1E1914] border border-[#E6D7C3] dark:border-[#383028] text-[#332F2B] dark:text-[#F0E8DE] font-stat font-bold text-lg sm:text-xl focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
                  />
                  <button
                    type="button"
                    onClick={() => setFillCount((c) => Math.min(2000, c + 1))}
                    className="w-8 sm:w-10 h-9 sm:h-10 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-[#FFFFFF] dark:bg-[#1E1914] hover:bg-[#F5EBDD] dark:hover:bg-[#2A231C] flex items-center justify-center text-[#332F2B] dark:text-[#F0E8DE] cursor-pointer transition shadow-2xs shrink-0"
                    title="Add 1"
                  >
                    <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setFillCount((c) => Math.min(2000, c + 5))}
                    className="h-9 sm:h-10 px-2 sm:px-2.5 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-[#FFFFFF] dark:bg-[#1E1914] hover:bg-[#F5EBDD] dark:hover:bg-[#2A231C] text-[#A83232] dark:text-[#E25D5D] font-bold text-xs font-stat cursor-pointer transition shadow-2xs shrink-0"
                    title="Add 5"
                  >
                    +5
                  </button>
                  <button
                    type="button"
                    onClick={() => setFillCount((c) => Math.min(2000, c + 10))}
                    className="h-9 sm:h-10 px-2 sm:px-2.5 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-[#FFFFFF] dark:bg-[#1E1914] hover:bg-[#F5EBDD] dark:hover:bg-[#2A231C] text-[#A83232] dark:text-[#E25D5D] font-bold text-xs font-stat cursor-pointer transition shadow-2xs shrink-0"
                    title="Add 10"
                  >
                    +10
                  </button>
                </div>

                {/* Preset Pills */}
                <div className="flex flex-wrap items-center gap-1.5 mt-2 font-stat">
                  {[0, 5, 10, 15, 20, 30, fillingSlot.area.capacity].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setFillCount(preset)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                        fillCount === preset
                          ? 'bg-[#A83232] text-[#FFFFFF] border-[#A83232]'
                          : 'bg-[#FFFFFF] dark:bg-[#1E1914] text-[#332F2B] dark:text-[#F0E8DE] border-[#E6D7C3] dark:border-[#383028] hover:bg-[#F5EBDD] dark:hover:bg-[#2A231C]'
                      }`}
                    >
                      {preset === fillingSlot.area.capacity ? `Max (${preset})` : preset}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] mb-1">
                  Reason for Backfill
                </label>
                <input
                  type="text"
                  value={fillReason}
                  onChange={(e) => setFillReason(e.target.value)}
                  placeholder="e.g. Recorded missed interval"
                  className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] dark:bg-[#1E1914] border border-[#E6D7C3] dark:border-[#383028] text-[#332F2B] dark:text-[#F0E8DE] text-sm focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] mb-1">
                  Observation / Note (Optional)
                </label>
                <input
                  type="text"
                  value={fillNotes}
                  onChange={(e) => setFillNotes(e.target.value)}
                  placeholder="Optional remark or observation"
                  className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] dark:bg-[#1E1914] border border-[#E6D7C3] dark:border-[#383028] text-[#332F2B] dark:text-[#F0E8DE] text-sm focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#E6D7C3]/60 dark:border-[#383028]">
                <button
                  type="button"
                  onClick={() => setFillingSlot(null)}
                  className="h-9 px-4 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-[#FFFFFF] dark:bg-[#1E1914] text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] hover:bg-[#F5EBDD] dark:hover:bg-[#2A231C] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingFill}
                  className="h-9 px-4 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-[#FFFFFF] text-xs font-semibold cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5 shadow-2xs"
                >
                  {savingFill ? 'Saving...' : 'Save Record'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ===================================================================
          MODAL 3: STUDENT ASSISTANT — VIEW ASSIGNED DUTY SCHEDULE (READ-ONLY)
      =================================================================== */}
      {showDutyScheduleModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-[#332F2B]/65 dark:bg-black/80 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-4 animate-literary-fade overflow-y-auto">
          <div ref={scheduleModalRef} className="literary-card shadow-2xl max-w-2xl w-full max-h-[92vh] sm:max-h-[88vh] flex flex-col relative overflow-hidden">
            <div className="h-1.5 w-full bg-gradient-to-r from-[#A83232] via-[#E7B84B] to-[#71865A] absolute top-0 left-0" />

            <div className="p-3.5 sm:p-5 border-b border-[#E6D7C3] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#FDF3F3] border border-[#E8BDBD] flex items-center justify-center text-[#A83232] shrink-0">
                  <CalendarClock className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base sm:text-lg font-heading font-bold text-[#332F2B] truncate">
                    My Assigned Weekly Duty Schedule
                  </h3>
                  <p className="text-xs text-[#6E665E] truncate">
                    {profile.full_name} (@{profile.username} · {profile.staff_code}) — View your fixed weekly area rotations (MWF, TTh, Saturday)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDutyScheduleModal(false)}
                className="p-1.5 rounded-lg hover:bg-[#F5EBDD] text-[#6E665E] cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 sm:p-5 overflow-y-auto space-y-4">
              {/* Current Duty Area & Next Assigned Duty Overview Cards in Modal */}
              {(dutyStatus.currentShiftOccurrence || dutyStatus.upcomingShiftOccurrence) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Current Duty Area */}
                  {dutyStatus.currentShiftOccurrence && (
                    <div className="p-3.5 rounded-xl bg-[#FEF9EC] border border-[#E7B84B] flex flex-col justify-between gap-2.5">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#A83232] text-white">
                            Current Duty Area
                          </span>
                          <span className="text-[10px] font-stat text-[#7D5B06] font-semibold">
                            {dutyStatus.currentShiftOccurrence.statusLabel}
                          </span>
                        </div>
                        <div className="text-sm font-heading font-bold text-[#332F2B]">
                          {dutyStatus.currentShiftOccurrence.assignment.areaName}
                        </div>
                        <div className="text-xs font-stat text-[#332F2B] flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-[#A83232] shrink-0" />
                          <span>
                            <strong>Time:</strong>{' '}
                            {formatTimeSlotLabel(dutyStatus.currentShiftOccurrence.assignment.startTime)} –{' '}
                            {formatTimeSlotLabel(dutyStatus.currentShiftOccurrence.assignment.endTime)}
                          </span>
                        </div>
                        {!dutyStatus.currentShiftOccurrence.assignment.requiresStatistics ? (
                          <div className="text-[10px] text-[#7D5B06] bg-[#FAF5EE] px-2 py-0.5 rounded border border-[#E6D7C3] font-medium">
                            Station duty (Statistics Not Required)
                          </div>
                        ) : null}
                      </div>

                      {(() => {
                        const targetArea = sortedAreas.find(
                          (a) => a.id === dutyStatus.currentShiftOccurrence?.assignment.areaId
                        );
                        if (targetArea && (!myActiveSession || myActiveSession.area_id !== targetArea.id)) {
                          return (
                            <button
                              type="button"
                              onClick={() => {
                                if (dutyStatus.currentShiftOccurrence) {
                                  markShiftEntered(dutyStatus.currentShiftOccurrence.assignment.id);
                                }
                                setShowDutyScheduleModal(false);
                                handleSelectArea(targetArea);
                              }}
                              className="w-full px-3 py-1.5 rounded-lg bg-[#A83232] hover:bg-[#8E2828] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition shadow-xs"
                            >
                              Enter Area ({targetArea.name})
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  )}

                  {/* Next Duty Area */}
                  {dutyStatus.upcomingShiftOccurrence && (
                    <div className="p-3.5 rounded-xl bg-white border border-[#E8DCCB] flex flex-col justify-between gap-2.5">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#7D5B06] text-white">
                            Next Duty Area
                          </span>
                          <span className="text-[10px] font-stat text-[#6E665E] font-semibold">
                            {dutyStatus.upcomingShiftOccurrence.isTomorrow
                              ? 'Tomorrow'
                              : dutyStatus.upcomingShiftOccurrence.isToday
                              ? dutyStatus.upcomingShiftOccurrence.statusLabel
                              : dutyStatus.upcomingShiftOccurrence.dayName}
                          </span>
                        </div>
                        <div className="text-sm font-heading font-bold text-[#332F2B]">
                          {dutyStatus.upcomingShiftOccurrence.assignment.areaName}
                        </div>
                        <div className="text-xs font-stat text-[#332F2B] flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-[#7C6E5F] shrink-0" />
                          <span>
                            <strong>Time:</strong>{' '}
                            {formatTimeSlotLabel(dutyStatus.upcomingShiftOccurrence.assignment.startTime)} –{' '}
                            {formatTimeSlotLabel(dutyStatus.upcomingShiftOccurrence.assignment.endTime)}
                          </span>
                        </div>
                        {!dutyStatus.upcomingShiftOccurrence.assignment.requiresStatistics ? (
                          <div className="text-[10px] text-[#7D5B06] bg-[#FAF5EE] px-2 py-0.5 rounded border border-[#E6D7C3] font-medium">
                            Station duty (Statistics Not Required)
                          </div>
                        ) : null}
                      </div>

                      {(() => {
                        if (!dutyStatus.upcomingShiftOccurrence.isToday) return null;
                        const targetArea = sortedAreas.find(
                          (a) => a.id === dutyStatus.upcomingShiftOccurrence?.assignment.areaId
                        );
                        if (targetArea && (!myActiveSession || myActiveSession.area_id !== targetArea.id)) {
                          return (
                            <button
                              type="button"
                              onClick={() => {
                                if (dutyStatus.upcomingShiftOccurrence) {
                                  markShiftEntered(dutyStatus.upcomingShiftOccurrence.assignment.id);
                                }
                                setShowDutyScheduleModal(false);
                                handleSelectArea(targetArea);
                              }}
                              className="w-full px-3 py-1.5 rounded-lg bg-white hover:bg-[#FAF5EE] border border-[#A83232]/40 text-[#A83232] text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition shadow-xs"
                            >
                              Enter Area ({targetArea.name})
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  )}
                </div>
              )}

              {/* Weekly Schedule Day Tabs */}
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  {DAY_GROUPS.map((group) => {
                    const isSelected = dutyScheduleTab === group;
                    const groupShifts = myDutySchedules.filter((s) => isScheduleMatchingDay(s.dayGroup, group));
                    const isTodayGroup = isScheduleMatchingDay(dutyStatus.todayGroup, group);
                    const dotColor =
                      group === 'Monday'
                        ? 'bg-[#A83232]'
                        : group === 'Tuesday'
                        ? 'bg-[#E7B84B]'
                        : group === 'Wednesday'
                        ? 'bg-[#71865A]'
                        : group === 'Thursday'
                        ? 'bg-[#8F4B38]'
                        : group === 'Friday'
                        ? 'bg-[#2E5A44]'
                        : 'bg-[#332F2B]';

                    return (
                      <button
                        key={group}
                        type="button"
                        onClick={() => setDutyScheduleTab(group)}
                        className={`p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between gap-1.5 ${
                          isSelected
                            ? 'bg-white border-[#A83232] shadow-xs ring-1 ring-[#A83232]'
                            : 'bg-white/70 border-[#D6C3A9] hover:bg-white hover:border-[#A83232]/50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <div className="text-xs font-bold text-[#332F2B] flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                            {DAY_GROUP_LABELS[group].shortDays}
                            {isTodayGroup && (
                              <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-[#A83232] text-white">
                                Today
                              </span>
                            )}
                          </div>
                          <span
                            className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold font-stat shrink-0 ${
                              groupShifts.length > 0
                                ? 'bg-[#F1F5EE] text-[#455436] border border-[#C5D3B8]'
                                : 'bg-[#FAF5EE] text-[#6E665E] border border-[#E6D7C3]'
                            }`}
                          >
                            {groupShifts.length}
                          </span>
                        </div>
                        <div className="text-[11px] font-semibold text-[#6E665E]">
                          {group}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Tab Rotation Entries */}
                {(() => {
                  const activeTabShifts = myDutySchedules
                    .filter((s) => isScheduleMatchingDay(s.dayGroup, dutyScheduleTab))
                    .sort((a, b) => a.startTime.localeCompare(b.startTime));

                  if (activeTabShifts.length === 0) {
                    return (
                      <div className="p-8 rounded-xl border border-[#E6D7C3] bg-[#FAF5EE] text-center space-y-1.5">
                        <div className="text-sm font-heading font-bold text-[#332F2B]">
                          No Duty Rotations for {DAY_GROUP_LABELS[dutyScheduleTab]?.label || dutyScheduleTab}
                        </div>
                        <p className="text-xs text-[#6E665E]">
                          The Librarian has not scheduled any rotations for you on {DAY_GROUP_LABELS[dutyScheduleTab].subLabel}.
                        </p>
                      </div>
                    );
                  }

                return (
                    <div className="space-y-3">
                      {activeTabShifts.map((sched, idx) => {
                        const areaObj =
                          assignableDutyAreas.find((a) => a.id === sched.areaId) ||
                          BAGGAGE_DUTY_AREA;
                        const isCurrentActive =
                          dutyStatus.currentShift?.id === sched.id &&
                          dutyStatus.todayGroup === sched.dayGroup;

                      return (
                          <div
                            key={sched.id}
                            className={`p-4 rounded-xl border transition ${
                              isCurrentActive
                                ? 'bg-[#FEF9EC] border-[#E7B84B] shadow-xs'
                                : 'bg-white border-[#E6D7C3]'
                            }`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-stat font-bold text-xs text-[#6E665E]">
                                    #{idx + 1}
                                  </span>
                                  <span
                                    className="w-2.5 h-2.5 rounded-full shrink-0"
                                    style={{
                                      backgroundColor: areaObj.color_hex || '#A83232',
                                    }}
                                  />
                                  <span className="font-heading font-bold text-base text-[#332F2B]">
                                    {sched.areaName}
                                  </span>
                                  {isCurrentActive && (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#A83232] text-white">
                                      Active Duty Right Now
                                    </span>
                                  )}
                                </div>

                                <div className="text-xs font-stat text-[#332F2B] flex flex-wrap items-center gap-2 pt-0.5">
                                  <span className="px-2.5 py-0.5 rounded-md bg-[#FAF5EE] text-[#332F2B] border border-[#D6C3A9] font-semibold">
                                    {formatTimeSlotLabel(sched.startTime)} –{' '}
                                    {formatTimeSlotLabel(sched.endTime)}
                                  </span>
                                  <span>·</span>
                                  {sched.requiresStatistics ? (
                                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#F1F5EE] text-[#455436] border border-[#C5D3B8]">
                                      <CheckCircle2 className="w-3 h-3 text-[#71865A]" />
                                      Stats Required
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FEF9EC] text-[#7D5B06] border border-[#E7B84B]">
                                      {sched.areaName} (No Stats Required)
                                    </span>
                                  )}
                                </div>

                                {!sched.requiresStatistics ? (
                                  <div className="text-xs text-[#7D5B06] bg-[#FAF5EE] px-3 py-1.5 rounded-lg border border-[#E6D7C3] mt-2 font-medium">
                                    <strong>{sched.areaName}:</strong> Statistics not required.
                                  </div>
                                ) : sched.notes ? (
                                  <div className="text-xs text-[#332F2B] bg-[#FAF5EE] px-3 py-1.5 rounded-lg border border-[#E6D7C3] mt-2">
                                    <strong>Note:</strong> {sched.notes}
                                  </div>
                                ) : null}

                                <div className="text-[11px] font-stat text-[#6E665E] pt-1">
                                  Updated by <strong>{sched.updatedBy}</strong> on{' '}
                                  {formatTimestampPHT(sched.updatedAt)}
                                </div>
                              </div>

                              {sched.requiresStatistics && areaObj.id > 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowDutyScheduleModal(false);
                                    handleSelectArea(areaObj);
                                  }}
                                  className="px-3.5 py-2 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition shrink-0"
                                >
                                  Monitor {areaObj.name}
                                  <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>

            <div className="p-4 border-t border-[#E6D7C3] dark:border-[#383028] bg-[#FAF5EE] dark:bg-[#1C1814] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-[#6E665E] dark:text-[#A6998C]">
                <Lock className="w-3.5 h-3.5 text-[#A83232] dark:text-[#E25D5D] shrink-0" />
                <span>
                  Managed by Librarian.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowDutyScheduleModal(false)}
                className="px-4 py-2 rounded-xl bg-[#332F2B] dark:bg-[#251F1B] hover:bg-[#1E1B18] text-white text-xs font-semibold cursor-pointer transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Calendar of Activities Modal for Student Assistants (Read-Only) */}
      <CalendarActivitiesModal
        isOpen={showCalendarModal}
        onClose={() => setShowCalendarModal(false)}
        profile={profile}
        activities={calendarActivities}
        onActivitiesUpdated={(updated) => setCalendarActivities(updated)}
        closedDaysOfWeek={closedDaysOfWeek}
        onClosedDaysUpdated={(updated) => setClosedDaysOfWeek(updated)}
        todayDate={todayDate}
      />
    </AcademicLayout>
  );
};
