import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  FileText,
  FileType2,
  History,
  LayoutDashboard,
  Radio,
  RefreshCw,
  Settings,
  Shield,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  UserCheck,
  Users,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { gsapFadeIn, gsapStaggerIn } from '../utils/animations';
import {
  CalendarActivity,
  cleanupBlacklistedCarriersIfLibrarian,
  DAY_OF_WEEK_NAMES,
  fetchCalendarActivities,
  fetchClosedDaysOfWeek,
  getClosedDaysOfWeekFromCache,
  isDateWholeDaySuspended,
  subscribeToCalendarChanges,
} from '../utils/calendarActivities';
import { CalendarActivitiesModal } from './CalendarActivitiesModal';
import { ViolatorsLogbook } from './ViolatorsLogbook';
import { getActiveViolationsCount, subscribeToViolations } from '../utils/violatorsLogbook';
import {
  ComputedStatisticalReport,
  LIBRARY_TIME_SLOTS,
  LibraryArea,
  MonitoringSession,
  OccupancyRecord,
  ReportPeriodType,
  SavedReport,
  ServerClock,
  TimeSlotDefinition,
  UserProfile,
} from '../types/lirc';
import {
  computeStatisticalReport,
  formatShortDate,
  formatTimestampPHT,
  getDayOfWeekName,
  getExpectedSlotsForDate,
  getLiteraryAreaColor,
  getMonthDateRange,
  getTodayPHT,
  MONTH_NAMES,
} from '../utils/statistics';
import {
  exportStatisticalReportToExcel,
  exportStatisticalReportToPDF,
  exportStatisticalReportToWord,
} from '../utils/reportExporters';
import {
  AreaComparisonChart,
  DailyTrendChart,
  HourlyOccupancyChart,
  MonthlySummaryChart,
} from './Charts';
import { LibrarianRecordsAndLogs } from './LibrarianRecordsAndLogs';
import { LibrarianAdminPanel } from './LibrarianAdminPanel';
import { LibrarianAreaAssignments } from './LibrarianAreaAssignments';
import { LibrarianAdvancedSettings } from './LibrarianAdvancedSettings';
import { AcademicLayout, NavItem, NotificationItem } from './AcademicLayout';
import { topProgressBar } from './TopProgressBar';
import {
  CIRCULATION_AREA_ID,
  DutyScheduleAssignment,
  EXEMPT_DUTY_AREAS,
  formatTimeSlotLabel,
  getDayGroupForDate,
  isNonStatisticalArea,
  isScheduleMatchingDay,
  parseDutySchedulesFromProfile,
  parseStaffAccount,
} from '../utils/invitationWorkflow';
import {
  subscribeToStationDuty,
  StationDutyPresence,
} from '../utils/stationDutyTracking';
import {
  fetchTimeSlots,
  getTimeSlotsFromCache,
  subscribeToTimeSlotChanges,
} from '../utils/timeSlots';

interface LibrarianDashboardProps {
  profile: UserProfile;
  areas: LibraryArea[];
  onSignOut: () => void;
  onRefreshAreas: () => void;
}

type LibrarianTab = 'dashboard' | 'assignments' | 'reports' | 'records' | 'logs' | 'manage' | 'settings' | 'violators';

export const LibrarianDashboard: React.FC<LibrarianDashboardProps> = ({
  profile,
  areas,
  onSignOut,
  onRefreshAreas,
}) => {
  const [activeTab, setActiveTab] = useState<LibrarianTab>('dashboard');
  const [activeViolatorsCount, setActiveViolatorsCount] = useState<number>(() => getActiveViolationsCount());

  const sortedAreas = useMemo(
    () =>
      [...areas]
        .filter((a) => !isNonStatisticalArea(a.name) && a.id !== CIRCULATION_AREA_ID)
        .sort((a, b) => a.display_order - b.display_order)
        .map((a) => ({ ...a, color_hex: getLiteraryAreaColor(a.code, a.color_hex) })),
    [areas]
  );

  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  }, []);

  const [serverClock, setServerClock] = useState<ServerClock | null>(null);
  const todayDate = serverClock?.record_date || getTodayPHT();

  const syncClock = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_server_clock');
    if (!error && data) {
      setServerClock(data as ServerClock);
    }
  }, []);

  useEffect(() => {
    syncClock();
    const timer = setInterval(syncClock, 30000);
    return () => clearInterval(timer);
  }, [syncClock]);

  // Dashboard state
  const [selectedDate, setSelectedDate] = useState<string>(getTodayPHT());
  const [dailyRecords, setDailyRecords] = useState<OccupancyRecord[]>([]);
  const [loadingDaily, setLoadingDaily] = useState<boolean>(true);
  const [activeSessions, setActiveSessions] = useState<MonitoringSession[]>([]);
  const [activeStationDuties, setActiveStationDuties] = useState<StationDutyPresence[]>([]);
  const [pendingRegistrationsCount, setPendingRegistrationsCount] = useState<number>(0);
  const [staffProfiles, setStaffProfiles] = useState<UserProfile[]>([]);
  const [manageOpenDutyModal, setManageOpenDutyModal] = useState<boolean>(false);
  const [managePreselectStudentId, setManagePreselectStudentId] = useState<string | null>(null);
  const [selectedAreaFilter, setSelectedAreaFilter] = useState<number | 'ALL'>('ALL');
  const [multiMonthReport, setMultiMonthReport] = useState<ComputedStatisticalReport | null>(null);
  const [timeSlots, setTimeSlots] = useState<TimeSlotDefinition[]>(() => getTimeSlotsFromCache());

  // Subscribe to real-time service station duty tracking (cross-network presence & broadcast)
  useEffect(() => {
    const unsubscribe = subscribeToStationDuty(supabase, (sessions) => {
      setActiveStationDuties(sessions);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // Sync dynamic time slots from Supabase & BroadcastChannel
  useEffect(() => {
    let mounted = true;
    async function loadDynamicSlots() {
      const data = await fetchTimeSlots(supabase);
      if (mounted) setTimeSlots(data);
    }
    loadDynamicSlots();

    const unsubscribe = subscribeToTimeSlotChanges(supabase, (fresh) => {
      if (mounted) setTimeSlots(fresh);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const currentClockHHMM = useMemo(() => {
    if (serverClock?.detected_slot) return serverClock.detected_slot;
    if (serverClock?.manila_timestamp) {
      try {
        const dt = new Date(serverClock.manila_timestamp);
        const h = String(dt.getHours()).padStart(2, '0');
        const m = String(dt.getMinutes()).padStart(2, '0');
        return `${h}:${m}`;
      } catch {
        // ignore
      }
    }
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }, [serverClock?.detected_slot, serverClock?.manila_timestamp]);

  const todayDayGroup = useMemo(() => getDayGroupForDate(todayDate) || 'Monday', [todayDate]);

  const allDutySchedules = useMemo(() => {
    const schedules: DutyScheduleAssignment[] = [];
    staffProfiles.forEach((p) => {
      if (
        p.shift_schedule === 'REMOVED' ||
        p.full_name.startsWith('CALENDAR_ACTIVITY::') ||
        (p.staff_code || '').startsWith('CAL_ACT::') ||
        (p.username || '').startsWith('cal_')
      ) {
        return;
      }
      const parsed = parseStaffAccount(p);
      if (parsed.approvalStatus === 'approved' && p.role === 'student_assistant' && p.is_active) {
        const list = parseDutySchedulesFromProfile(p, parsed.displayStaffCode);
        list.forEach((s) => schedules.push(s));
      }
    });
    return schedules;
  }, [staffProfiles]);

  const allActiveMonitors = useMemo(() => {
    const list: Array<{
      key: string;
      areaId: number;
      areaName: string;
      userName: string;
      staffCode?: string;
      isStatistical: boolean;
    }> = [];

    activeSessions.forEach((s) => {
      list.push({
        key: `stat-${s.id}-${s.area_id}-${s.user_id}`,
        areaId: s.area_id,
        areaName: s.area_name,
        userName: s.user_name,
        staffCode: s.staff_code,
        isStatistical: true,
      });
    });

    activeStationDuties.forEach((s) => {
      if (!list.some((m) => m.userName.toLowerCase() === s.userName.toLowerCase() && m.areaId === s.areaId)) {
        list.push({
          key: `station-${s.userId}-${s.areaId}`,
          areaId: s.areaId,
          areaName: s.areaName,
          userName: s.userName,
          staffCode: s.staffCode,
          isStatistical: false,
        });
      }
    });

    return list;
  }, [activeSessions, activeStationDuties]);

  // Reports state (Single Date | Month | Date Range)
  const initialToday = getTodayPHT();
  const [initYear, initMonth] = initialToday.split('-').map(Number);

  const [reportMode, setReportMode] = useState<ReportPeriodType>('monthly');
  const [reportSingleDate, setReportSingleDate] = useState<string>(initialToday);
  const [reportYear, setReportYear] = useState<number>(initYear || 2026);
  const [reportMonth, setReportMonth] = useState<number>(initMonth || 11);
  const [reportRangeStart, setReportRangeStart] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 13);
    return d.toISOString().slice(0, 10);
  });
  const [reportRangeEnd, setReportRangeEnd] = useState<string>(initialToday);

  const [generatedReport, setGeneratedReport] = useState<ComputedStatisticalReport | null>(null);
  const [generatingReport, setGeneratingReport] = useState<boolean>(false);
  const [exportingWord, setExportingWord] = useState<boolean>(false);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [reportTableTab, setReportTableTab] = useState<
    'areas' | 'hourly' | 'daily' | 'monthly' | 'slots'
  >('areas');

  // Calendar of Activities state (Class Suspensions & Excluded Time Management)
  const [calendarActivities, setCalendarActivities] = useState<CalendarActivity[]>([]);
  const [closedDaysOfWeek, setClosedDaysOfWeek] = useState<number[]>(() => getClosedDaysOfWeekFromCache());
  const [showCalendarModal, setShowCalendarModal] = useState<boolean>(false);

  // GSAP animation refs
  const kpiGridRef = useRef<HTMLDivElement | null>(null);
  const areasGridRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (serverClock?.record_date) {
      setSelectedDate((prev) => (prev === initialToday ? serverClock.record_date : prev));
      setReportSingleDate((prev) => (prev === initialToday ? serverClock.record_date : prev));
      setReportRangeEnd((prev) => (prev === initialToday ? serverClock.record_date : prev));
    }
  }, [serverClock?.record_date, initialToday]);

  const fetchOverviewData = useCallback(async () => {
    setLoadingDaily(true);
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const histStart = ninetyDaysAgo.toISOString().slice(0, 10);

    const [dayRes, sessRes, histRes, staffRes, calList, closedList] = await Promise.all([
      supabase
        .from('occupancy_records')
        .select('*')
        .eq('record_date', selectedDate)
        .order('time_slot', { ascending: true }),
      supabase
        .from('monitoring_sessions')
        .select('*')
        .eq('status', 'active')
        .order('started_at', { ascending: false }),
      supabase.rpc('get_occupancy_records_range', {
        p_start_date: histStart,
        p_end_date: todayDate,
        p_area_id: null,
      }),
      supabase.from('user_profiles').select('*'),
      fetchCalendarActivities(supabase),
      fetchClosedDaysOfWeek(supabase),
    ]);

    if (!dayRes.error && dayRes.data) setDailyRecords(dayRes.data as OccupancyRecord[]);
    if (!sessRes.error && sessRes.data) setActiveSessions(sessRes.data as MonitoringSession[]);
    if (calList) setCalendarActivities(calList);
    if (closedList) setClosedDaysOfWeek(closedList);
    if (!staffRes.error && staffRes.data) {
      const profiles = staffRes.data as UserProfile[];
      setStaffProfiles(profiles);
      const pendingCount = profiles.filter((u) => {
        if (u.shift_schedule === 'REMOVED') return false;
        return parseStaffAccount(u).approvalStatus === 'pending';
      }).length;
      setPendingRegistrationsCount(pendingCount);
    }
    if (!histRes.error && Array.isArray(histRes.data) && sortedAreas.length > 0) {
      setMultiMonthReport(
        computeStatisticalReport({
          reportType: 'range',
          startDate: histStart,
          endDate: todayDate,
          areas: sortedAreas,
          records: histRes.data as OccupancyRecord[],
          todayDate,
          currentSlot: serverClock?.detected_slot || null,
          isOperatingHours: serverClock?.is_operating_hours || false,
          calendarActivities: calList,
          closedDaysOfWeek: closedList ?? closedDaysOfWeek,
        })
      );
    }

    setLoadingDaily(false);
  }, [selectedDate, todayDate, sortedAreas, serverClock]);

  const fetchSavedReports = useCallback(async () => {
    const { data } = await supabase
      .from('saved_reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(6);
    if (data) setSavedReports(data as SavedReport[]);
  }, []);

  const handleGenerateReport = useCallback(
    async (opts?: {
      mode?: ReportPeriodType;
      singleDate?: string;
      year?: number;
      month?: number;
      startDate?: string;
      endDate?: string;
      persistLog?: boolean;
    }) => {
      if (sortedAreas.length === 0) return;
      const mode = opts?.mode || reportMode;
      let startDate = '';
      let endDate = '';

      if (mode === 'daily') {
        const d = opts?.singleDate || reportSingleDate;
        startDate = d;
        endDate = d;
      } else if (mode === 'monthly') {
        const y = opts?.year || reportYear;
        const m = opts?.month || reportMonth;
        const rng = getMonthDateRange(y, m);
        startDate = rng.startDate;
        endDate = rng.endDate;
      } else {
        startDate = opts?.startDate || reportRangeStart;
        endDate = opts?.endDate || reportRangeEnd;
        if (startDate > endDate) {
          showToast('error', 'Start date must be on or before end date.');
          return;
        }
      }

      setGeneratingReport(true);
      const { data, error } = await supabase.rpc('get_occupancy_records_range', {
        p_start_date: startDate,
        p_end_date: endDate,
        p_area_id: null,
      });

      if (error) {
        showToast('error', `Could not generate report: ${error.message}`);
        setGeneratingReport(false);
        return;
      }

      const records = Array.isArray(data) ? (data as OccupancyRecord[]) : [];
      const computed = computeStatisticalReport({
        reportType: mode,
        startDate,
        endDate,
        areas: sortedAreas,
        records,
        todayDate,
        currentSlot: serverClock?.detected_slot || null,
        isOperatingHours: serverClock?.is_operating_hours || false,
        calendarActivities,
        closedDaysOfWeek,
        timeSlots,
      });

      setGeneratedReport(computed);
      setGeneratingReport(false);

      if (opts?.persistLog) {
        const [ry, rm] = startDate.split('-').map(Number);
        await Promise.all([
          supabase.from('saved_reports').insert({
            report_type: mode,
            start_date: startDate,
            end_date: endDate,
            report_year: ry || 2026,
            report_month: rm || 1,
            report_title: computed.reportTitle,
            total_occupancy: computed.overallTotal,
            total_days_recorded: computed.totalOperatingDays,
            total_missing_slots: computed.missingSlotsCount,
            top_area_name: computed.peakArea?.areaName || 'N/A',
            export_format: 'preview',
            generated_by: profile.id,
            generated_by_name: profile.full_name,
            remarks: `${computed.totalSlotEntries} slots recorded`,
          }),
          supabase.rpc('log_client_activity', {
            p_action_type: 'report_generated',
            p_description: `${profile.full_name} generated report for ${computed.periodLabel}`,
            p_target_type: 'statistical_report',
            p_metadata: {
              report_type: mode,
              start_date: startDate,
              end_date: endDate,
              overall_total: computed.overallTotal,
            },
          }),
        ]);
        fetchSavedReports();
        showToast('success', `Report ready for ${computed.periodLabel}.`);
      }
    },
    [
      sortedAreas,
      reportMode,
      reportSingleDate,
      reportYear,
      reportMonth,
      reportRangeStart,
      reportRangeEnd,
      todayDate,
      serverClock,
      calendarActivities,
      closedDaysOfWeek,
      timeSlots,
      profile.id,
      profile.full_name,
      fetchSavedReports,
      showToast,
    ]
  );

  useEffect(() => {
    fetchOverviewData();
  }, [fetchOverviewData]);

  // Real-time synchronization of calendar suspensions & activities for the Librarian
  useEffect(() => {
    // Purge any lingering blacklisted carriers from Supabase database
    cleanupBlacklistedCarriersIfLibrarian(supabase);

    const unsubscribe = subscribeToCalendarChanges(supabase, (fresh, freshClosed) => {
      setCalendarActivities(fresh);
      if (freshClosed) setClosedDaysOfWeek(freshClosed);
    });

    const unsubViolations = subscribeToViolations(supabase, () => {
      setActiveViolatorsCount(getActiveViolationsCount());
    });

    return () => {
      unsubscribe();
      unsubViolations();
    };
  }, []);

  useEffect(() => {
    if (sortedAreas.length > 0 && !generatedReport) {
      handleGenerateReport({
        mode: 'monthly',
        year: reportYear,
        month: reportMonth,
        persistLog: false,
      });
      fetchSavedReports();
    }
  }, [sortedAreas, generatedReport, handleGenerateReport, reportYear, reportMonth, fetchSavedReports]);

  const dailyComputed = useMemo(
    () =>
      computeStatisticalReport({
        reportType: 'daily',
        startDate: selectedDate,
        endDate: selectedDate,
        areas: sortedAreas,
        records: dailyRecords,
        todayDate,
        currentSlot: serverClock?.detected_slot || null,
        isOperatingHours: serverClock?.is_operating_hours || false,
        calendarActivities,
        closedDaysOfWeek,
        timeSlots,
      }),
    [selectedDate, sortedAreas, dailyRecords, todayDate, serverClock, calendarActivities, closedDaysOfWeek, timeSlots]
  );

  // GSAP: Animate KPI cards and Area cards on tab switch / data update
  useEffect(() => {
    if (activeTab === 'dashboard') {
      if (kpiGridRef.current) {
        const cards = kpiGridRef.current.querySelectorAll('.lib-kpi-card');
        if (cards.length > 0) {
          gsapStaggerIn(cards, { stagger: 0.06, y: 14 });
        }
      }
      if (areasGridRef.current) {
        const cards = areasGridRef.current.querySelectorAll('.lib-area-card');
        if (cards.length > 0) {
          gsapStaggerIn(cards, { stagger: 0.05, y: 16, delay: 0.1 });
        }
      }
    }
  }, [activeTab, dailyComputed.overallTotal]);

  const dailySlotAreaMap = useMemo(() => {
    const map = new Map<string, OccupancyRecord>();
    dailyRecords.forEach((r) => map.set(`${r.time_slot}|${r.area_id}`, r));
    return map;
  }, [dailyRecords]);

  const expectedSlotsSelectedDate = useMemo(
    () =>
      getExpectedSlotsForDate(
        selectedDate,
        todayDate,
        serverClock?.detected_slot || null,
        serverClock?.is_operating_hours || false
      ),
    [selectedDate, todayDate, serverClock]
  );

  const logReportExport = async (
    format: 'XLSX' | 'PDF' | 'DOCX' | 'CSV' | 'PRINT',
    rep: ComputedStatisticalReport
  ) => {
    await supabase.rpc('log_client_activity', {
      p_action_type: 'report_exported',
      p_description: `${profile.full_name} exported ${rep.periodLabel} report (${format})`,
      p_target_type: 'report_export',
      p_metadata: { format, period: rep.periodLabel, start_date: rep.startDate, end_date: rep.endDate },
    });
  };

  // Sidebar navigation items
  const navItems: NavItem[] = useMemo(
    () => [
      {
        id: 'dashboard',
        label: 'Overview Dashboard',
        group: 'Analytics & Reporting',
        icon: LayoutDashboard,
      },
      {
        id: 'assignments',
        label: 'Area Assignments',
        group: 'Analytics & Reporting',
        icon: UserCheck,
      },
      {
        id: 'reports',
        label: 'Statistical Reports',
        group: 'Analytics & Reporting',
        icon: FileText,
      },
      {
        id: 'records',
        label: 'Historical Records',
        group: 'Records & Administration',
        icon: History,
        badge: dailyComputed.missingSlotsCount > 0 ? dailyComputed.missingSlotsCount : undefined,
        badgeTone: 'mustard',
      },
      {
        id: 'violators',
        label: 'Violators Logbook',
        group: 'Records & Administration',
        icon: ShieldAlert,
        badge: activeViolatorsCount > 0 ? `${activeViolatorsCount} active` : undefined,
        badgeTone: 'burgundy',
      },
      {
        id: 'calendar_activities',
        label: 'Calendar of Activities',
        group: 'Records & Administration',
        icon: Calendar,
        badge: calendarActivities.length > 0 ? calendarActivities.length : undefined,
        badgeTone: 'mustard',
      },
      {
        id: 'logs',
        label: 'Activity Logs',
        group: 'Records & Administration',
        icon: Activity,
      },
      {
        id: 'settings',
        label: 'Advanced Settings',
        group: 'Records & Administration',
        icon: SlidersHorizontal,
        badge: closedDaysOfWeek.length > 0 ? `${closedDaysOfWeek.length} Closed` : undefined,
        badgeTone: 'mustard',
      },
      {
        id: 'manage',
        label: 'Staff Accounts & Backup',
        group: 'Records & Administration',
        icon: Settings,
        badge: pendingRegistrationsCount > 0 ? pendingRegistrationsCount : undefined,
        badgeTone: 'mustard',
      },
    ],
    [dailyComputed.missingSlotsCount, pendingRegistrationsCount, calendarActivities.length, closedDaysOfWeek.length, activeViolatorsCount]
  );

  // Notifications dropdown
  const notifications: NotificationItem[] = useMemo(() => {
    const items: NotificationItem[] = [];
    if (pendingRegistrationsCount > 0) {
      items.push({
        id: 'pending-registrations',
        title: `${pendingRegistrationsCount} Pending Student Assistant Registration(s)`,
        description:
          'Click to review submitted invitation codes and approve or reject registration requests.',
        tone: 'mustard',
        onClick: () => setActiveTab('manage'),
      });
    }
    if (allActiveMonitors.length > 0) {
      items.push({
        id: 'active-sessions',
        title: `${allActiveMonitors.length} Active Area / Station Monitor(s)`,
        description: allActiveMonitors
          .map((s) => `${s.areaName} (${s.userName.split(' ')[0]})`)
          .join(', '),
        tone: 'sage',
        onClick: () => setActiveTab('dashboard'),
      });
    }
    if (dailyComputed.missingSlotsCount > 0) {
      items.push({
        id: 'missing-slots',
        title: `${dailyComputed.missingSlotsCount} Missing 30-Min Interval(s)`,
        description: `Click to review and backfill missing slots for ${formatShortDate(selectedDate)}.`,
        tone: 'mustard',
        onClick: () => setActiveTab('records'),
      });
    }
    if (dailyComputed.peakArea && dailyComputed.overallTotal > 0) {
      items.push({
        id: 'peak-area',
        title: `Peak Area: ${dailyComputed.peakArea.areaName}`,
        description: `${dailyComputed.peakArea.sharePercent}% of total occupancy (${dailyComputed.peakArea.total.toLocaleString()} students).`,
        tone: 'sage',
        onClick: () => setActiveTab('reports'),
      });
    }
    return items;
  }, [pendingRegistrationsCount, allActiveMonitors, dailyComputed, selectedDate]);

  const pageMeta = useMemo(() => {
    switch (activeTab) {
      case 'dashboard':
        return {
          title: `Occupancy Overview — ${formatShortDate(selectedDate)} (${getDayOfWeekName(selectedDate)})`,
          subtitle:
            allActiveMonitors.length > 0
              ? `Live: ${allActiveMonitors
                  .map((s) => `${s.areaName} (${s.userName.split(' ')[0]})`)
                  .join(', ')}`
              : 'Real-time occupancy across monitored areas and service stations',
          breadcrumbs: ['Librarian', 'Dashboard'],
        };
      case 'assignments':
        return {
          title: 'Area Assignments & Duty Rosters',
          subtitle:
            'Real-time student assistant duty allocations across all library areas',
          breadcrumbs: ['Librarian', 'Area Assignments'],
        };
      case 'reports':
        return {
          title: 'Statistical Reports & Exports',
          subtitle:
            'Generate reports (Excel, PDF, Word, CSV)',
          breadcrumbs: ['Librarian', 'Reports'],
        };
      case 'records':
        return {
          title: 'Historical Records & Missing Intervals',
          subtitle:
            'Inspect intervals and backfill missing records',
          breadcrumbs: ['Librarian', 'Records'],
        };
      case 'violators':
        return {
          title: 'Violators Logbook & 1-Hour Monitoring',
          subtitle:
            'Track library violations, monitor active timers, and export institutional reports',
          breadcrumbs: ['Librarian', 'Violators Logbook'],
        };
      case 'logs':
        return {
          title: 'Activity & Audit Logs',
          subtitle:
            'System activity and audit trail',
          breadcrumbs: ['Librarian', 'Logs'],
        };
      case 'settings':
        return {
          title: 'Advanced Settings',
          subtitle: 'Weekly operating closures, time intervals & monitored areas',
          breadcrumbs: ['Librarian', 'Advanced Settings'],
        };
      case 'manage':
        return {
          title: 'Staff Accounts & Backup',
          subtitle: 'Manage accounts, duty schedules and institutional backups',
          breadcrumbs: ['Librarian', 'Staff & Backup'],
        };
    }
  }, [activeTab, selectedDate, activeSessions]);

  const dashboardHeaderActions = (
    <div className="flex items-center gap-1.5 sm:gap-2">
      {activeTab === 'dashboard' && (
        <div className="hidden sm:flex items-center gap-2">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-[#D6C3A9] dark:border-[#383028] bg-white dark:bg-[#1A1613] text-xs font-stat font-semibold text-[#332F2B] dark:text-[#F0E8DE]"
          />
          <button
            type="button"
            onClick={() => setSelectedDate(todayDate)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition ${
              selectedDate === todayDate
                ? 'bg-[#A83232] text-white'
                : 'bg-white dark:bg-[#1A1613] border border-[#E6D7C3] dark:border-[#383028] text-[#332F2B] dark:text-[#F0E8DE] hover:bg-[#F5EBDD] dark:hover:bg-[#25201B]'
            }`}
          >
            Today
          </button>
        </div>
      )}

      {activeTab === 'dashboard' && (
        <button
          type="button"
          onClick={fetchOverviewData}
          className="p-1.5 sm:p-2 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-white dark:bg-[#1A1613] hover:bg-[#F5EBDD] dark:hover:bg-[#25201B] text-[#332F2B] dark:text-[#F0E8DE] cursor-pointer transition shrink-0"
          title="Refresh data"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingDaily ? 'animate-spin' : ''}`} />
        </button>
      )}
    </div>
  );

  return (
    <AcademicLayout
      profile={profile}
      roleLabel="Librarian"
      pageTitle={pageMeta.title}
      pageSubtitle={pageMeta.subtitle}
      breadcrumbs={pageMeta.breadcrumbs}
      navItems={navItems}
      activeNavId={showCalendarModal ? 'calendar_activities' : activeTab}
      isLoading={loadingDaily}
      onSelectNav={(id) => {
        if (id === 'calendar_activities') {
          setShowCalendarModal(true);
          return;
        }
        topProgressBar.pulse(380);
        setActiveTab(id as LibrarianTab);
      }}
      onSignOut={onSignOut}
      clockDateLabel={serverClock?.display_date || formatShortDate(todayDate)}
      clockTimeLabel={serverClock?.display_time || '8:00 AM – 6:00 PM'}
      isOperatingHours={serverClock?.is_operating_hours ?? true}
      notifications={notifications}
      headerActions={dashboardHeaderActions}
    >
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm animate-literary-fade">
          <div
            className={`px-4 py-3 rounded-xl shadow-lg border flex items-start gap-2.5 text-xs font-medium ${
              toast.type === 'success'
                ? 'bg-[#F1F5EE] text-[#455436] border-[#C5D3B8]'
                : 'bg-[#FDF3F3] text-[#A83232] border-[#E8BDBD]'
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
          TAB 1: DASHBOARD (OVERVIEW + INSIGHTS + CHARTS + DAILY MATRIX)
      =================================================================== */}
      {activeTab === 'dashboard' && (
        <div className="space-y-4 sm:space-y-6 animate-literary-fade">
          {/* Mobile Date Filter Bar */}
          <div className="flex sm:hidden items-center justify-between gap-2 p-2.5 rounded-xl bg-white dark:bg-[#1A1613] border border-[#E6D7C3] dark:border-[#383028] shadow-2xs">
            <span className="text-xs font-semibold text-[#6E665E] dark:text-[#A89887] shrink-0">Date:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="flex-1 h-9 px-2.5 rounded-lg border border-[#D6C3A9] dark:border-[#383028] bg-[#FAF5EE] dark:bg-[#241F1A] text-xs font-stat font-semibold text-[#332F2B] dark:text-[#F0E8DE]"
            />
            <button
              type="button"
              onClick={() => setSelectedDate(todayDate)}
              className={`h-9 px-3 rounded-lg text-xs font-semibold shrink-0 cursor-pointer transition ${
                selectedDate === todayDate
                  ? 'bg-[#A83232] text-white'
                  : 'bg-[#FAF5EE] dark:bg-[#241F1A] border border-[#E6D7C3] dark:border-[#383028] text-[#332F2B] dark:text-[#F0E8DE]'
              }`}
            >
              Today
            </button>
          </div>

          {/* 4 KPI Stat Cards */}
          <div ref={kpiGridRef} className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="lib-kpi-card literary-card p-3.5 sm:p-5 relative overflow-hidden shadow-xs">
              <div className="h-1.5 w-full bg-gradient-to-r from-[#A83232] via-[#C96C32] to-[#E7B84B] absolute top-0 left-0" />
              <div className="text-[11px] sm:text-xs font-medium text-[#6E665E]">Total Occupancy</div>
              <div className="text-xl sm:text-3xl font-stat font-bold text-[#332F2B] mt-1">
                {dailyComputed.overallTotal.toLocaleString()}
              </div>
              <div className="text-[10px] sm:text-xs text-[#6E665E] mt-0.5 truncate">Across all 6 library areas</div>
            </div>

            <div className="lib-kpi-card literary-card p-3.5 sm:p-5 relative overflow-hidden shadow-xs">
              <div className="h-1.5 w-full bg-gradient-to-r from-[#E7B84B] to-[#F5C75A] absolute top-0 left-0" />
              <div className="text-[11px] sm:text-xs font-medium text-[#6E665E]">Most Occupied Area</div>
              <div className="text-lg sm:text-2xl font-heading font-bold text-[#A83232] mt-1 truncate">
                {dailyComputed.peakArea?.areaName || '—'}
              </div>
              <div className="text-[10px] sm:text-xs font-stat text-[#6E665E] mt-0.5 truncate">
                {dailyComputed.peakArea
                  ? `${dailyComputed.peakArea.sharePercent}% of total`
                  : 'No data'}
              </div>
            </div>

            <div className="lib-kpi-card literary-card p-3.5 sm:p-5 relative overflow-hidden shadow-xs">
              <div className="h-1.5 w-full bg-gradient-to-r from-[#71865A] to-[#8FA872] absolute top-0 left-0" />
              <div className="text-[11px] sm:text-xs font-medium text-[#6E665E]">Peak Operating Hour</div>
              <div className="text-base sm:text-xl font-stat font-bold text-[#332F2B] mt-1.5 truncate">
                {dailyComputed.peakHour?.label || '—'}
              </div>
              <div className="text-[10px] sm:text-xs font-stat text-[#6E665E] mt-0.5 truncate">
                {dailyComputed.peakHour
                  ? `${dailyComputed.peakHour.total.toLocaleString()} students`
                  : 'No data'}
              </div>
            </div>

            <div className="lib-kpi-card literary-card p-3.5 sm:p-5 relative overflow-hidden shadow-xs">
              <div className="h-1.5 w-full bg-gradient-to-r from-[#332F2B] to-[#5C544E] absolute top-0 left-0" />
              <div className="text-[11px] sm:text-xs font-medium text-[#6E665E]">Missing Intervals</div>
              <div className="text-xl sm:text-3xl font-stat font-bold text-[#A83232] mt-1">
                {dailyComputed.missingSlotsCount}
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('records')}
                className="text-[11px] sm:text-xs font-semibold text-[#A83232] hover:underline mt-0.5 cursor-pointer block truncate"
              >
                Review &amp; resolve →
              </button>
            </div>
          </div>

          {/* Active Monitoring Roster Banner */}
          {allActiveMonitors.length > 0 ? (
            <div className="literary-card p-4 bg-gradient-to-r from-[#F8FAF7] via-[#F1F5EE] to-[#E8F0E2] dark:from-[#182515] dark:via-[#141F11] dark:to-[#10190E] border border-[#71865A]/45 dark:border-[#71865A]/50 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#71865A] animate-pulse shrink-0" />
                <span className="text-[#332F2B] dark:text-[#F0E8DE] font-semibold">
                  {allActiveMonitors.length} Area{allActiveMonitors.length > 1 ? 's' : ''} Actively Monitored Now:
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {allActiveMonitors.map((m) => (
                    <span
                      key={m.key}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-white dark:bg-[#241F1B] border border-[#C5D3B8] dark:border-[#383028] text-[#332F2B] dark:text-[#F0E8DE] text-xs font-medium shadow-2xs"
                    >
                      <strong className="text-[#455436] dark:text-[#92B577] font-semibold">{m.areaName}:</strong>
                      <span>{m.userName}</span>
                      {!m.isStatistical && (
                        <span className="text-[10px] bg-[#F5EBDD] dark:bg-[#332A22] text-[#8B7355] dark:text-[#CBBBB0] px-1.5 py-0.2 rounded font-stat">
                          Station Duty
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
              <span className="text-[11px] font-stat font-semibold text-[#71865A] dark:text-[#92B577] bg-white dark:bg-[#201C18] px-2.5 py-0.5 rounded-full border border-[#C5D3B8] dark:border-[#383028]">
                Real-Time Live Sync
              </span>
            </div>
          ) : (
            <div className="literary-card px-4 py-3 bg-[#FAF5EE] dark:bg-[#201B17] border border-[#E6D7C3] dark:border-[#383028] flex items-center justify-between text-xs text-[#6E665E] dark:text-[#A89887]">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-[#8C827A]" />
                <span>No Student Assistants are currently actively monitoring library areas or service stations.</span>
              </div>
              <span className="text-[11px] font-semibold text-[#8C827A]">All Areas &amp; Stations Idle</span>
            </div>
          )}

          {/* Statistical Monitored Library Areas */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-heading font-bold text-base text-[#332F2B] dark:text-[#F0E8DE] flex items-center gap-2">
                  <span>Statistical Monitored Areas ({dailyComputed.areaSummaries.length})</span>
                  <span className="text-xs font-stat font-normal text-[#6E665E] dark:text-[#A89887]">
                    — Headcount Occupancy &amp; Seat Utilization Tracking
                  </span>
                </h3>
              </div>
            </div>

            <div ref={areasGridRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {dailyComputed.areaSummaries.map((item) => {
                const areaSessions = activeSessions.filter((s) => s.area_id === item.area.id);
                const uniqueAreaSessions = Array.from(
                  new Map(areaSessions.map((s) => [s.user_id, s])).values()
                );
                return (
                  <div
                    key={item.area.id}
                    className="lib-area-card literary-card literary-card-hover p-5 flex flex-col justify-between relative overflow-hidden"
                  >
                    <div
                      className="h-1 w-full absolute top-0 left-0"
                      style={{ backgroundColor: item.area.color_hex }}
                    />
                    <div>
                      <div className="flex items-center justify-between mb-2 pt-1">
                        <span className="font-heading font-bold text-base text-[#332F2B] dark:text-[#F0E8DE] flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: item.area.color_hex }}
                          />
                          {item.area.name}
                        </span>
                        <span className="text-xs font-stat font-semibold text-[#6E665E] dark:text-[#A89887]">
                          {item.sharePercent}%
                        </span>
                      </div>

                      {/* Prominent Active Monitor Strip */}
                      <div className="mb-3">
                        {uniqueAreaSessions.length > 0 ? (
                          <div className="flex items-center justify-between text-xs font-medium text-[#455436] dark:text-[#B2D898] bg-[#F1F5EE] dark:bg-[#182414] px-3 py-1.5 rounded-xl border border-[#71865A]/40 shadow-2xs">
                            <div className="flex items-center gap-2 truncate min-w-0 flex-1 mr-1.5">
                              <span className="w-2 h-2 rounded-full bg-[#71865A] animate-pulse shrink-0" />
                              <span
                                className="truncate"
                                title={`Actively Monitored by: ${uniqueAreaSessions.map((s) => s.user_name).join(', ')}`}
                              >
                                Actively Monitored by{' '}
                                {uniqueAreaSessions.map((s, idx) => (
                                  <React.Fragment key={s.id || s.user_id}>
                                    {idx > 0 && <span className="text-[#6E665E]">, </span>}
                                    <strong className="text-[#332F2B] dark:text-[#F0E8DE] font-semibold">
                                      {s.user_name}
                                    </strong>
                                  </React.Fragment>
                                ))}
                              </span>
                            </div>
                            <span className="text-[10px] uppercase font-bold text-[#71865A] dark:text-[#B2D898] font-stat shrink-0 ml-1.5 bg-white dark:bg-[#1A1613] px-1.5 py-0.5 rounded border border-[#C5D3B8]">
                              {uniqueAreaSessions.length > 1 ? `Live (${uniqueAreaSessions.length})` : 'Live'}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between text-xs text-[#6E665E] dark:text-[#A89887] bg-[#FAF5EE] dark:bg-[#25201B] px-3 py-1.5 rounded-xl border border-[#E6D7C3] dark:border-[#383028]">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-[#D6C3A9]" />
                              <span>No Active Monitor</span>
                            </div>
                            <span className="text-[10px] font-semibold text-[#8C827A] bg-white dark:bg-[#1A1613] px-1.5 py-0.5 rounded border border-[#E6D7C3] dark:border-[#383028]">
                              Idle
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-baseline justify-between mb-3">
                        <span className="text-2xl font-stat font-bold text-[#332F2B] dark:text-[#F0E8DE]">
                          {item.totalOccupancy.toLocaleString()}
                        </span>
                        <span className="text-xs font-stat text-[#6E665E] dark:text-[#A89887]">
                          Peak {item.peakCount} ({item.peakSlot})
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1.5 pt-2.5 border-t border-[#E6D7C3] dark:border-[#383028]">
                      <div className="text-[11px] font-stat text-[#6E665E] dark:text-[#A89887] flex items-center justify-between">
                        <span>
                          {item.recordedSlotsCount}/{item.expectedSlotsCount} slots ·{' '}
                          {item.utilizationPercent}% seat util.
                        </span>
                        {item.missingSlotsCount > 0 ? (
                          <span className="text-[#A83232] font-semibold">
                            {item.missingSlotsCount} missing
                          </span>
                        ) : (
                          <span className="text-[#71865A] dark:text-[#92B577] font-semibold">Complete</span>
                        )}
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-[#F5EBDD] dark:bg-[#25201B] overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${item.completionRate}%`,
                            backgroundColor: item.area.color_hex,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Service Duty Stations (No Statistics Required) */}
          <div className="space-y-3 pt-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="font-heading font-bold text-base text-[#332F2B] dark:text-[#F0E8DE] flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[#71865A] dark:text-[#92B577]" />
                  <span>Service Duty Stations ({EXEMPT_DUTY_AREAS.length})</span>
                  <span className="text-xs font-stat font-semibold text-[#71865A] dark:text-[#92B577] bg-[#F1F5EE] dark:bg-[#1E2618] border border-[#C5D3B8] dark:border-[#334226] px-2 py-0.5 rounded-full ml-1">
                    No Statistics Required
                  </span>
                </h3>
                <p className="text-xs text-[#8B7355] dark:text-[#A89887] mt-0.5">
                  Real-time active monitoring presence and student assistant duty coverage for baggage, circulation, shelving, and service operations.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('assignments')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-[#241F1B] border border-[#E6D7C3] dark:border-[#383028] hover:border-[#D6C3A9] text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] shadow-2xs hover:bg-[#FAF5EE] dark:hover:bg-[#2C2520] transition cursor-pointer self-start sm:self-auto"
              >
                <Users className="w-3.5 h-3.5 text-[#71865A] dark:text-[#92B577]" />
                <span>Manage Duty Rosters</span>
                <ArrowUpRight className="w-3.5 h-3.5 text-[#8C827A]" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {EXEMPT_DUTY_AREAS.map((area) => {
                const liveStationMonitors = activeStationDuties.filter(
                  (s) => s.areaId === area.id || s.areaName.toLowerCase().includes(area.name.toLowerCase())
                );
                const liveAreaSessions = activeSessions.filter(
                  (s) => s.area_id === area.id || s.area_name.toLowerCase().includes(area.name.toLowerCase())
                );
                const activeMonitorNames = Array.from(
                  new Set([
                    ...liveStationMonitors.map((s) => s.userName),
                    ...liveAreaSessions.map((s) => s.user_name),
                  ])
                );
                const isActivelyMonitoredLive = activeMonitorNames.length > 0;

                const todaySchedulesForArea = allDutySchedules
                  .filter((s) => s.areaId === area.id && isScheduleMatchingDay(s.dayGroup, todayDayGroup))
                  .sort((a, b) => a.startTime.localeCompare(b.startTime));

                const scheduledNowAssistants = todaySchedulesForArea.filter(
                  (s) => currentClockHHMM >= s.startTime && currentClockHHMM < s.endTime
                );

                let totalCoveredHours = 0;
                todaySchedulesForArea.forEach((s) => {
                  const [sh, sm] = (s.startTime || '08:00').split(':').map(Number);
                  const [eh, em] = (s.endTime || '13:00').split(':').map(Number);
                  const diff = Math.max(0, (eh * 60 + (em || 0)) - (sh * 60 + (sm || 0)));
                  totalCoveredHours += Math.round((diff / 60) * 10) / 10;
                });

                return (
                  <div
                    key={`service-station-${area.id}`}
                    className="lib-area-card literary-card literary-card-hover p-5 flex flex-col justify-between relative overflow-hidden"
                  >
                    <div
                      className="h-1 w-full absolute top-0 left-0"
                      style={{ backgroundColor: area.color_hex }}
                    />
                    <div>
                      <div className="flex items-center justify-between mb-2 pt-1">
                        <span className="font-heading font-bold text-base text-[#332F2B] dark:text-[#F0E8DE] flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: area.color_hex }}
                          />
                          {area.name}
                        </span>
                        <span className="text-[11px] font-stat font-semibold text-[#6E665E] dark:text-[#A89887] bg-[#F5EBDD] dark:bg-[#25201B] px-2 py-0.5 rounded-md">
                          Service Station
                        </span>
                      </div>

                      {/* Prominent Active Monitor Strip */}
                      <div className="mb-3">
                        {isActivelyMonitoredLive ? (
                          <div className="flex items-center justify-between text-xs font-medium text-[#455436] dark:text-[#B2D898] bg-[#F1F5EE] dark:bg-[#182414] px-3 py-1.5 rounded-xl border border-[#71865A]/40 shadow-2xs">
                            <div className="flex items-center gap-2 truncate min-w-0 flex-1 mr-1.5">
                              <span className="w-2 h-2 rounded-full bg-[#71865A] animate-pulse shrink-0" />
                              <span
                                className="truncate"
                                title={`Actively Monitored by: ${activeMonitorNames.join(', ')}`}
                              >
                                Actively Monitored by{' '}
                                {activeMonitorNames.map((name, idx) => (
                                  <React.Fragment key={idx}>
                                    {idx > 0 && <span className="text-[#6E665E]">, </span>}
                                    <strong className="text-[#332F2B] dark:text-[#F0E8DE] font-semibold">
                                      {name}
                                    </strong>
                                  </React.Fragment>
                                ))}
                              </span>
                            </div>
                            <span className="text-[10px] uppercase font-bold text-[#71865A] dark:text-[#B2D898] font-stat shrink-0 ml-1.5 bg-white dark:bg-[#1A1613] px-1.5 py-0.5 rounded border border-[#C5D3B8]">
                              {activeMonitorNames.length > 1 ? `Live (${activeMonitorNames.length})` : 'Live'}
                            </span>
                          </div>
                        ) : scheduledNowAssistants.length > 0 ? (
                          <div className="flex items-center justify-between text-xs font-medium text-[#7D5B06] dark:text-[#E7B84B] bg-[#FEF9EC] dark:bg-[#2A2318] px-3 py-1.5 rounded-xl border border-[#E7B84B]/50 shadow-2xs">
                            <div className="flex items-center gap-2 truncate min-w-0 flex-1 mr-1.5">
                              <span className="w-2 h-2 rounded-full bg-[#E7B84B] animate-pulse shrink-0" />
                              <span className="truncate">
                                Scheduled On Duty:{' '}
                                {scheduledNowAssistants.map((a, idx) => (
                                  <React.Fragment key={a.id || idx}>
                                    {idx > 0 && <span>, </span>}
                                    <strong className="text-[#332F2B] dark:text-[#F0E8DE] font-semibold">
                                      {a.studentAssistantName}
                                    </strong>{' '}
                                    <span className="text-[11px] font-normal opacity-85">
                                      ({formatTimeSlotLabel(a.startTime)} – {formatTimeSlotLabel(a.endTime)})
                                    </span>
                                  </React.Fragment>
                                ))}
                              </span>
                            </div>
                            <span className="text-[10px] uppercase font-bold text-[#7D5B06] dark:text-[#E7B84B] font-stat shrink-0 ml-1.5 bg-white dark:bg-[#1A1613] px-1.5 py-0.5 rounded border border-[#E7B84B]/40">
                              Assigned Now
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between text-xs text-[#6E665E] dark:text-[#A89887] bg-[#FAF5EE] dark:bg-[#25201B] px-3 py-1.5 rounded-xl border border-[#E6D7C3] dark:border-[#383028]">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-[#D6C3A9]" />
                              <span>No Active Monitor</span>
                            </div>
                            <span className="text-[10px] font-semibold text-[#8C827A] bg-white dark:bg-[#1A1613] px-1.5 py-0.5 rounded border border-[#E6D7C3] dark:border-[#383028]">
                              Idle
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="space-y-1.5 pt-2.5 border-t border-[#E6D7C3] dark:border-[#383028]">
                      <div className="text-[11px] font-stat text-[#6E665E] dark:text-[#A89887] flex items-center justify-between">
                        <span>
                          {totalCoveredHours > 0 ? `${totalCoveredHours} hrs scheduled today` : 'Unassigned'}
                        </span>
                        <span className="text-[#71865A] dark:text-[#92B577] font-semibold">
                          No Statistics Required
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-[#F5EBDD] dark:bg-[#25201B] overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: totalCoveredHours > 0 ? '100%' : '0%',
                            backgroundColor: area.color_hex,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Visual Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-5">
              <AreaComparisonChart
                areaSummaries={dailyComputed.areaSummaries}
                periodLabel={formatShortDate(selectedDate)}
              />
            </div>
            <div className="lg:col-span-7">
              <HourlyOccupancyChart
                hourlyBreakdown={dailyComputed.hourlyBreakdown}
                periodLabel={formatShortDate(selectedDate)}
                peakHourLabel={dailyComputed.peakHour?.label}
              />
            </div>
          </div>

          {multiMonthReport && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              <div className="lg:col-span-7">
                <DailyTrendChart
                  dailyBreakdown={multiMonthReport.dailyBreakdown.slice(-20)}
                  periodLabel="Recent Operating Days"
                  overallTotal={multiMonthReport.overallTotal}
                />
              </div>
              <div className="lg:col-span-5">
                <MonthlySummaryChart monthlyBreakdown={multiMonthReport.monthlyBreakdown} />
              </div>
            </div>
          )}

          {/* Daily 30-Minute Breakdown Table */}
          <div className="literary-card overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E6D7C3] flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-heading font-bold text-[#332F2B]">
                  30-Minute Schedule Ledger — {formatShortDate(selectedDate)}
                </h2>
                <p className="text-xs text-[#6E665E]">
                  8:00 AM to 6:00 PM across all six library collections
                </p>
              </div>
              <select
                value={selectedAreaFilter}
                onChange={(e) =>
                  setSelectedAreaFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))
                }
                className="px-3 py-1.5 rounded-xl bg-white border border-[#D6C3A9] text-xs font-medium text-[#332F2B]"
              >
                <option value="ALL">All 6 Areas</option>
                {sortedAreas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#FAF5EE] border-b border-[#E6D7C3] text-[#332F2B]">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Time Interval</th>
                    {sortedAreas
                      .filter((a) => selectedAreaFilter === 'ALL' || a.id === selectedAreaFilter)
                      .map((area) => (
                        <th key={area.id} className="py-3 px-4 font-semibold text-right">
                          {area.name}
                        </th>
                      ))}
                    <th className="py-3 px-4 font-semibold text-right bg-[#F5EBDD]/60">
                      Interval Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6D7C3]/60 bg-white">
                  {LIBRARY_TIME_SLOTS.map((slot) => {
                    const visibleAreas = sortedAreas.filter(
                      (a) => selectedAreaFilter === 'ALL' || a.id === selectedAreaFilter
                    );
                    const isDue = expectedSlotsSelectedDate.includes(slot.value);
                    let rowSum = 0;
                    return (
                      <tr key={slot.value} className="hover:bg-[#FAF5EE]/70 transition-colors">
                        <td className="py-2.5 px-4 font-stat font-semibold text-[#332F2B] whitespace-nowrap">
                          {slot.rangeLabel || slot.label}
                        </td>
                        {visibleAreas.map((area) => {
                          const rec = dailySlotAreaMap.get(`${slot.value}|${area.id}`);
                          if (rec) rowSum += rec.occupancy_count;
                          return (
                            <td key={area.id} className="py-2.5 px-4 text-right font-stat">
                              {rec ? (
                                <span className="font-semibold text-[#332F2B]">
                                  {rec.occupancy_count}
                                </span>
                              ) : isDue ? (
                                <button
                                  type="button"
                                  onClick={() => setActiveTab('records')}
                                  className="text-[11px] font-sans font-semibold text-[#A83232] hover:underline cursor-pointer"
                                >
                                  Missing
                                </button>
                              ) : (
                                <span className="text-[#C8B9A6]">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="py-2.5 px-4 text-right font-stat font-bold text-[#A83232] bg-[#FAF5EE]/60">
                          {rowSum.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-[#332F2B] text-white font-bold">
                    <td className="py-3 px-4">Daily Total</td>
                    {sortedAreas
                      .filter((a) => selectedAreaFilter === 'ALL' || a.id === selectedAreaFilter)
                      .map((area) => {
                        const stat = dailyComputed.areaSummaries.find((s) => s.area.id === area.id);
                        return (
                          <td key={area.id} className="py-3 px-4 text-right font-stat">
                            {(stat?.totalOccupancy || 0).toLocaleString()}
                          </td>
                        );
                      })}
                    <td className="py-3 px-4 text-right text-[#E7B84B] font-stat">
                      {dailyComputed.overallTotal.toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          TAB 1.5: AREA ASSIGNMENTS (REAL-TIME DUTY ROSTERS ACROSS ALL AREAS)
      =================================================================== */}
      {activeTab === 'assignments' && (
        <LibrarianAreaAssignments
          areas={sortedAreas}
          allAreas={areas}
          serverClock={serverClock}
          todayDate={todayDate}
          activeSessions={activeSessions}
          staffProfiles={staffProfiles}
          onOpenDutyScheduleModal={(studentId?: string) => {
            setManagePreselectStudentId(studentId || null);
            setManageOpenDutyModal(true);
            setActiveTab('manage');
          }}
          onNavigateToArea={(areaId) => {
            setSelectedAreaFilter(areaId);
            setActiveTab('dashboard');
          }}
          onRefresh={fetchOverviewData}
        />
      )}

      {/* ===================================================================
          TAB 2: REPORTS & EXPORTS
      =================================================================== */}
      {activeTab === 'reports' && (
        <div className="space-y-6 animate-literary-fade">
          {/* Report Builder Bar */}
          <div className="literary-card p-5 space-y-4 no-print">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-heading font-bold text-[#332F2B]">
                  Configure Report Period
                </h2>
                <p className="text-xs text-[#6E665E] mt-0.5">
                  Select a single date, month, or custom date range to compute statistics and export.
                </p>
              </div>

              <div className="flex items-center gap-1 bg-[#F5EBDD] p-1 rounded-xl border border-[#E6D7C3]">
                {(
                  [
                    { id: 'daily', label: 'Single Date' },
                    { id: 'monthly', label: 'Monthly' },
                    { id: 'range', label: 'Date Range' },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setReportMode(m.id)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition ${
                      reportMode === m.id
                        ? 'bg-[#A83232] text-white shadow-xs'
                        : 'text-[#6E665E] hover:text-[#332F2B]'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-end justify-between gap-3 pt-3 border-t border-[#E6D7C3]">
              <div className="flex flex-wrap items-end gap-3">
                {reportMode === 'daily' && (
                  <div>
                    <label className="block text-[11px] font-semibold text-[#6E665E] mb-1">
                      Date
                    </label>
                    <input
                      type="date"
                      value={reportSingleDate}
                      onChange={(e) => setReportSingleDate(e.target.value)}
                      className="px-3 py-2 rounded-xl bg-white border border-[#D6C3A9] text-xs font-stat font-semibold text-[#332F2B]"
                    />
                  </div>
                )}

                {reportMode === 'monthly' && (
                  <>
                    <div>
                      <label className="block text-[11px] font-semibold text-[#6E665E] mb-1">
                        Month
                      </label>
                      <select
                        value={reportMonth}
                        onChange={(e) => setReportMonth(Number(e.target.value))}
                        className="px-3 py-2 rounded-xl bg-white border border-[#D6C3A9] text-xs font-semibold text-[#332F2B]"
                      >
                        {MONTH_NAMES.map((mName, idx) => (
                          <option key={mName} value={idx + 1}>
                            {mName}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-[#6E665E] mb-1">
                        Year
                      </label>
                      <select
                        value={reportYear}
                        onChange={(e) => setReportYear(Number(e.target.value))}
                        className="px-3 py-2 rounded-xl bg-white border border-[#D6C3A9] text-xs font-stat font-semibold text-[#332F2B]"
                      >
                        {[2025, 2026, 2027].map((yr) => (
                          <option key={yr} value={yr}>
                            {yr}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                {reportMode === 'range' && (
                  <>
                    <div>
                      <label className="block text-[11px] font-semibold text-[#6E665E] mb-1">
                        From
                      </label>
                      <input
                        type="date"
                        value={reportRangeStart}
                        onChange={(e) => setReportRangeStart(e.target.value)}
                        className="px-3 py-2 rounded-xl bg-white border border-[#D6C3A9] text-xs font-stat font-semibold text-[#332F2B]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-[#6E665E] mb-1">
                        To
                      </label>
                      <input
                        type="date"
                        value={reportRangeEnd}
                        onChange={(e) => setReportRangeEnd(e.target.value)}
                        className="px-3 py-2 rounded-xl bg-white border border-[#D6C3A9] text-xs font-stat font-semibold text-[#332F2B]"
                      />
                    </div>
                  </>
                )}

                <button
                  type="button"
                  disabled={generatingReport}
                  onClick={() => handleGenerateReport({ persistLog: true })}
                  className="px-5 py-2 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-white text-xs font-semibold cursor-pointer disabled:opacity-50 transition"
                >
                  {generatingReport ? 'Generating...' : 'Generate Report'}
                </button>
              </div>

              {/* Export Toolbar */}
              {generatedReport && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      exportStatisticalReportToExcel(generatedReport, profile.full_name);
                      await logReportExport('XLSX', generatedReport);
                      showToast('success', 'Downloaded Excel (.xlsx) report.');
                    }}
                    className="px-3.5 py-2 rounded-xl bg-[#71865A] hover:bg-[#5E7149] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    Excel
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      exportStatisticalReportToPDF(generatedReport, profile.full_name);
                      await logReportExport('PDF', generatedReport);
                      showToast('success', 'Downloaded PDF (.pdf) report with charts.');
                    }}
                    className="px-3.5 py-2 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition"
                  >
                    <FileType2 className="w-3.5 h-3.5" />
                    PDF
                  </button>
                  <button
                    type="button"
                    disabled={exportingWord}
                    onClick={async () => {
                      setExportingWord(true);
                      try {
                        await exportStatisticalReportToWord(generatedReport, profile.full_name);
                        await logReportExport('DOCX', generatedReport);
                        showToast('success', 'Downloaded Word (.docx) report with charts.');
                      } finally {
                        setExportingWord(false);
                      }
                    }}
                    className="px-3.5 py-2 rounded-xl bg-[#332F2B] hover:bg-[#1E1B18] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    {exportingWord ? 'Building...' : 'Word'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {generatedReport && (
            <>
              {/* Report KPIs */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="literary-card p-5 relative overflow-hidden">
                  <div className="h-1 w-full bg-[#A83232] absolute top-0 left-0" />
                  <div className="text-xs font-medium text-[#6E665E]">Overall Occupancy</div>
                  <div className="text-2xl font-stat font-bold text-[#332F2B] mt-1">
                    {generatedReport.overallTotal.toLocaleString()}
                  </div>
                  <div className="text-xs text-[#6E665E]">{generatedReport.periodLabel}</div>
                </div>
                <div className="literary-card p-5 relative overflow-hidden">
                  <div className="h-1 w-full bg-[#71865A] absolute top-0 left-0" />
                  <div className="text-xs font-medium text-[#6E665E]">Daily Average</div>
                  <div className="text-2xl font-stat font-bold text-[#332F2B] mt-1">
                    {generatedReport.dailyAverageOccupancy.toLocaleString()}
                  </div>
                  <div className="text-xs font-stat text-[#6E665E]">
                    {generatedReport.totalOperatingDays} operating day(s)
                  </div>
                </div>
                <div className="literary-card p-5 relative overflow-hidden">
                  <div className="h-1 w-full bg-[#E7B84B] absolute top-0 left-0" />
                  <div className="text-xs font-medium text-[#6E665E]">Top Area / Peak Hour</div>
                  <div className="text-base font-heading font-bold text-[#A83232] mt-1.5 truncate">
                    {generatedReport.peakArea?.areaName || '—'}
                  </div>
                  <div className="text-xs font-stat text-[#6E665E] truncate">
                    {generatedReport.peakHour?.label || '—'}
                  </div>
                </div>
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <div className="lg:col-span-5">
                  <AreaComparisonChart
                    areaSummaries={generatedReport.areaSummaries}
                    periodLabel={generatedReport.periodLabel}
                  />
                </div>
                <div className="lg:col-span-7">
                  <HourlyOccupancyChart
                    hourlyBreakdown={generatedReport.hourlyBreakdown}
                    periodLabel={generatedReport.periodLabel}
                    peakHourLabel={generatedReport.peakHour?.label}
                  />
                </div>
              </div>

              {/* Statistical Tables */}
              <div className="literary-card overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#E6D7C3] flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-heading font-bold text-[#332F2B]">
                    Report Ledger — {generatedReport.periodLabel}
                  </h2>
                  <div className="flex flex-wrap items-center gap-1 bg-[#F5EBDD] p-1 rounded-xl border border-[#E6D7C3] no-print">
                    {(
                      [
                        { id: 'areas', label: 'By Area' },
                        { id: 'hourly', label: 'Hourly' },
                        { id: 'daily', label: 'Daily' },
                        { id: 'monthly', label: 'Monthly' },
                        { id: 'slots', label: '30-Min Slots' },
                      ] as const
                    ).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setReportTableTab(t.id)}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer transition ${
                          reportTableTab === t.id
                            ? 'bg-[#A83232] text-white shadow-xs'
                            : 'text-[#6E665E] hover:text-[#332F2B]'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {reportTableTab === 'areas' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#FAF5EE] border-b border-[#E6D7C3] text-[#332F2B]">
                        <tr>
                          <th className="py-3 px-4 font-semibold">Library Area</th>
                          <th className="py-3 px-4 font-semibold text-right">Recorded</th>
                          <th className="py-3 px-4 font-semibold text-right">Daily Avg</th>
                          <th className="py-3 px-4 font-semibold text-right">Seat Util.</th>
                          <th className="py-3 px-4 font-semibold text-right">Peak Count</th>
                          <th className="py-3 px-4 font-semibold text-right">Total</th>
                          <th className="py-3 px-4 font-semibold text-right">Share</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E6D7C3]/60 bg-white">
                        {generatedReport.areaSummaries.map((item) => (
                          <tr key={item.area.id} className="hover:bg-[#FAF5EE]/70 transition-colors">
                            <td className="py-2.5 px-4 font-semibold text-[#332F2B]">
                              <span
                                className="inline-block w-2.5 h-2.5 rounded-full mr-2"
                                style={{ backgroundColor: item.area.color_hex }}
                              />
                              {item.area.name}
                            </td>
                            <td className="py-2.5 px-4 text-right font-stat">
                              {item.recordedSlotsCount}
                            </td>
                            <td className="py-2.5 px-4 text-right font-stat">
                              {item.dailyAverage.toLocaleString()}
                            </td>
                            <td className="py-2.5 px-4 text-right font-stat">
                              {item.utilizationPercent}%
                            </td>
                            <td className="py-2.5 px-4 text-right font-stat">
                              {item.peakCount} ({item.peakSlot})
                            </td>
                            <td className="py-2.5 px-4 text-right font-stat font-bold text-[#A83232]">
                              {item.totalOccupancy.toLocaleString()}
                            </td>
                            <td className="py-2.5 px-4 text-right font-stat">
                              {item.sharePercent}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-[#332F2B] text-white font-bold">
                          <td className="py-3 px-4">Overall Total</td>
                          <td className="py-3 px-4 text-right font-stat">
                            {generatedReport.totalSlotEntries.toLocaleString()}
                          </td>
                          <td className="py-3 px-4 text-right font-stat">
                            {generatedReport.dailyAverageOccupancy.toLocaleString()}
                          </td>
                          <td className="py-3 px-4 text-right">—</td>
                          <td className="py-3 px-4 text-right">—</td>
                          <td className="py-3 px-4 text-right text-[#E7B84B] font-stat">
                            {generatedReport.overallTotal.toLocaleString()}
                          </td>
                          <td className="py-3 px-4 text-right font-stat">100%</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {reportTableTab === 'hourly' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#FAF5EE] border-b border-[#E6D7C3] text-[#332F2B]">
                        <tr>
                          <th className="py-3 px-4 font-semibold">Hour</th>
                          {generatedReport.areaSummaries.map((s) => (
                            <th key={s.area.id} className="py-3 px-4 font-semibold text-right">
                              {s.area.name}
                            </th>
                          ))}
                          <th className="py-3 px-4 font-semibold text-right bg-[#F5EBDD]/60">
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E6D7C3]/60 bg-white">
                        {generatedReport.hourlyBreakdown.map((h) => (
                          <tr key={h.hourKey} className="hover:bg-[#FAF5EE]/70 transition-colors">
                            <td className="py-2.5 px-4 font-stat font-semibold text-[#332F2B] whitespace-nowrap">
                              {h.label}
                            </td>
                            {generatedReport.areaSummaries.map((s) => (
                              <td key={s.area.id} className="py-2.5 px-4 text-right font-stat">
                                {(h.areaTotals[s.area.id] || 0).toLocaleString()}
                              </td>
                            ))}
                            <td className="py-2.5 px-4 text-right font-stat font-bold text-[#A83232] bg-[#FAF5EE]/60">
                              {h.totalOccupancy.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {reportTableTab === 'daily' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#FAF5EE] border-b border-[#E6D7C3] text-[#332F2B]">
                        <tr>
                          <th className="py-3 px-4 font-semibold">Date</th>
                          {generatedReport.areaSummaries.map((s) => (
                            <th key={s.area.id} className="py-3 px-4 font-semibold text-right">
                              {s.area.name}
                            </th>
                          ))}
                          <th className="py-3 px-4 font-semibold text-right bg-[#F5EBDD]/60">
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E6D7C3]/60 bg-white">
                        {generatedReport.dailyBreakdown.map((d) => (
                          <tr key={d.date} className="hover:bg-[#FAF5EE]/70 transition-colors">
                            <td className="py-2.5 px-4 font-semibold text-[#332F2B] whitespace-nowrap">
                              {d.formattedDate} ({d.dayOfWeek})
                            </td>
                            {generatedReport.areaSummaries.map((s) => (
                              <td key={s.area.id} className="py-2.5 px-4 text-right font-stat">
                                {(d.areaTotals[s.area.id] || 0).toLocaleString()}
                              </td>
                            ))}
                            <td className="py-2.5 px-4 text-right font-stat font-bold text-[#A83232] bg-[#FAF5EE]/60">
                              {d.dailyTotal.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {reportTableTab === 'monthly' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#FAF5EE] border-b border-[#E6D7C3] text-[#332F2B]">
                        <tr>
                          <th className="py-3 px-4 font-semibold">Month</th>
                          <th className="py-3 px-4 font-semibold text-right">Days</th>
                          {generatedReport.areaSummaries.map((s) => (
                            <th key={s.area.id} className="py-3 px-4 font-semibold text-right">
                              {s.area.name}
                            </th>
                          ))}
                          <th className="py-3 px-4 font-semibold text-right bg-[#F5EBDD]/60">
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E6D7C3]/60 bg-white">
                        {generatedReport.monthlyBreakdown.map((m) => (
                          <tr key={m.yearMonth} className="hover:bg-[#FAF5EE]/70 transition-colors">
                            <td className="py-2.5 px-4 font-semibold text-[#332F2B]">{m.label}</td>
                            <td className="py-2.5 px-4 text-right font-stat">{m.operatingDays}</td>
                            {generatedReport.areaSummaries.map((s) => (
                              <td key={s.area.id} className="py-2.5 px-4 text-right font-stat">
                                {(m.areaTotals[s.area.id] || 0).toLocaleString()}
                              </td>
                            ))}
                            <td className="py-2.5 px-4 text-right font-stat font-bold text-[#A83232] bg-[#FAF5EE]/60">
                              {m.monthlyTotal.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {reportTableTab === 'slots' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#FAF5EE] border-b border-[#E6D7C3] text-[#332F2B]">
                        <tr>
                          <th className="py-3 px-4 font-semibold">Time Slot</th>
                          {generatedReport.areaSummaries.map((s) => (
                            <th key={s.area.id} className="py-3 px-4 font-semibold text-right">
                              {s.area.name}
                            </th>
                          ))}
                          <th className="py-3 px-4 font-semibold text-right bg-[#F5EBDD]/60">
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E6D7C3]/60 bg-white">
                        {generatedReport.slotBreakdown.map((sRow) => (
                          <tr key={sRow.slot} className="hover:bg-[#FAF5EE]/70 transition-colors">
                            <td className="py-2.5 px-4 font-stat font-semibold text-[#332F2B]">
                              {sRow.label}
                            </td>
                            {generatedReport.areaSummaries.map((s) => (
                              <td key={s.area.id} className="py-2.5 px-4 text-right font-stat">
                                {(sRow.areaTotals[s.area.id] || 0).toLocaleString()}
                              </td>
                            ))}
                            <td className="py-2.5 px-4 text-right font-stat font-bold text-[#A83232] bg-[#FAF5EE]/60">
                              {sRow.totalAcrossAreas.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Recent Saved Reports */}
              {savedReports.length > 0 && (
                <div className="literary-card p-5 no-print">
                  <h3 className="text-base font-heading font-bold text-[#332F2B] mb-3">
                    Recently Generated Reports
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {savedReports.map((rep) => (
                      <button
                        key={rep.id}
                        type="button"
                        onClick={() => {
                          setReportMode(rep.report_type);
                          setReportRangeStart(rep.start_date);
                          setReportRangeEnd(rep.end_date);
                          setReportSingleDate(rep.start_date);
                          setReportYear(rep.report_year);
                          setReportMonth(rep.report_month);
                          handleGenerateReport({
                            mode: rep.report_type,
                            singleDate: rep.start_date,
                            year: rep.report_year,
                            month: rep.report_month,
                            startDate: rep.start_date,
                            endDate: rep.end_date,
                            persistLog: false,
                          });
                        }}
                        className="text-left p-3.5 rounded-xl border border-[#E6D7C3] bg-[#FAF5EE]/60 hover:border-[#A83232] hover:bg-[#F5EBDD] transition cursor-pointer"
                      >
                        <div className="text-xs font-semibold text-[#332F2B] truncate">
                          {rep.report_title}
                        </div>
                        <div className="text-sm font-stat font-bold text-[#A83232] mt-1">
                          {Number(rep.total_occupancy).toLocaleString()} students
                        </div>
                        <div className="text-[11px] font-stat text-[#6E665E] mt-0.5">
                          {formatTimestampPHT(rep.created_at)}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ===================================================================
          TAB 3 & 4: RECORDS & ACTIVITY LOGS
      =================================================================== */}
      {(activeTab === 'records' || activeTab === 'logs') && (
        <LibrarianRecordsAndLogs
          mode={activeTab}
          profile={profile}
          areas={sortedAreas}
          todayDate={todayDate}
          currentSlot={serverClock?.detected_slot || null}
          isOperatingHours={serverClock?.is_operating_hours || false}
          calendarActivities={calendarActivities}
          closedDaysOfWeek={closedDaysOfWeek}
          onNotify={showToast}
          onDataMutated={() => {
            fetchOverviewData();
            handleGenerateReport({ persistLog: false });
          }}
        />
      )}

      {/* ===================================================================
          TAB: VIOLATORS LOGBOOK & 1-HOUR MONITORING REGISTRY
      =================================================================== */}
      {activeTab === 'violators' && (
        <div className="space-y-6 animate-literary-fade">
          <ViolatorsLogbook
            mode="librarian"
            profile={profile}
            onRecordCountChange={setActiveViolatorsCount}
          />
        </div>
      )}

      {/* ===================================================================
          TAB 5: MANAGE (STAFF ACCOUNTS & BACKUP)
      =================================================================== */}
      {activeTab === 'manage' && (
        <LibrarianAdminPanel
          currentUserId={profile.id}
          currentUserName={profile.full_name}
          areas={sortedAreas}
          onRefreshAreas={onRefreshAreas}
          onNotify={showToast}
          onPendingCountChange={setPendingRegistrationsCount}
          initialOpenDutyScheduleModal={manageOpenDutyModal}
          initialDutyStudentId={managePreselectStudentId}
          onDutyScheduleModalClose={() => {
            setManageOpenDutyModal(false);
            setManagePreselectStudentId(null);
          }}
        />
      )}

      {/* ===================================================================
          TAB 6: ADVANCED SETTINGS (WEEKLY CLOSURES, TIME INTERVALS, AREAS)
      =================================================================== */}
      {activeTab === 'settings' && (
        <LibrarianAdvancedSettings
          profile={profile}
          areas={areas}
          onRefreshAreas={onRefreshAreas}
          closedDaysOfWeek={closedDaysOfWeek}
          onClosedDaysUpdated={(updatedDays) => {
            setClosedDaysOfWeek(updatedDays);
            handleGenerateReport({ persistLog: false });
          }}
          onNotify={showToast}
          timeSlots={timeSlots}
          onTimeSlotsUpdated={(freshSlots) => {
            setTimeSlots(freshSlots);
          }}
        />
      )}

      {/* Calendar of Activities Management Modal */}
      <CalendarActivitiesModal
        isOpen={showCalendarModal}
        onClose={() => setShowCalendarModal(false)}
        profile={profile}
        activities={calendarActivities}
        onActivitiesUpdated={(updated) => {
          setCalendarActivities(updated);
          handleGenerateReport({ persistLog: false });
        }}
        closedDaysOfWeek={closedDaysOfWeek}
        onClosedDaysUpdated={(updatedDays) => {
          setClosedDaysOfWeek(updatedDays);
          handleGenerateReport({ persistLog: false });
        }}
        onNotify={showToast}
        todayDate={todayDate}
      />
    </AcademicLayout>
  );
};
