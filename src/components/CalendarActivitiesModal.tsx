import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit2,
  Grid,
  Info,
  List,
  Lock,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { UserProfile } from '../types/lirc';
import {
  CalendarActivity,
  DAY_OF_WEEK_NAMES,
  fetchCalendarActivities,
  fetchClosedDaysOfWeek,
  formatActivityTimeRange,
  getClosedDaysOfWeekFromCache,
  isDayOfWeekClosed,
  isSundayDate,
  OPERATING_WEEKDAYS,
  persistCalendarActivity,
  removeCalendarActivity,
  subscribeToCalendarChanges,
  toggleClosedDayOfWeek,
} from '../utils/calendarActivities';
import { formatShortDate } from '../utils/statistics';
import { gsapPopIn } from '../utils/animations';

interface CalendarActivitiesModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
  activities: CalendarActivity[];
  onActivitiesUpdated: (updated: CalendarActivity[]) => void;
  todayDate: string;
  onNotify?: (type: 'success' | 'error', message: string) => void;
  closedDaysOfWeek?: number[];
  onClosedDaysUpdated?: (updated: number[]) => void;
}

const MONTH_NAMES = [
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

const WEEKDAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export const CalendarActivitiesModal: React.FC<CalendarActivitiesModalProps> = ({
  isOpen,
  onClose,
  profile,
  activities,
  onActivitiesUpdated,
  todayDate,
  onNotify,
  closedDaysOfWeek,
  onClosedDaysUpdated,
}) => {
  const isLibrarian = profile.role === 'librarian';
  const modalRef = useRef<HTMLDivElement | null>(null);

  // Closed weekdays state (e.g. [1] = every Monday closed)
  const [closedDays, setClosedDays] = useState<number[]>(() => closedDaysOfWeek ?? getClosedDaysOfWeekFromCache());
  const [togglingDay, setTogglingDay] = useState<number | null>(null);

  useEffect(() => {
    if (closedDaysOfWeek) setClosedDays(closedDaysOfWeek);
  }, [closedDaysOfWeek]);

  // Parse today's year and month
  const [initYear, initMonth] = useMemo(() => {
    if (todayDate && todayDate.includes('-')) {
      const [y, m] = todayDate.split('-').map(Number);
      return [y, m - 1]; // 0-indexed month
    }
    const now = new Date();
    return [now.getFullYear(), now.getMonth()];
  }, [todayDate]);

  // Calendar View State: Year & Month
  const [viewYear, setViewYear] = useState<number>(initYear);
  const [viewMonth, setViewMonth] = useState<number>(initMonth);

  // Selected Day State (Defaults to todayDate)
  const [selectedDate, setSelectedDate] = useState<string>(todayDate);

  // View Display Mode: 'calendar' (Huge Grid) vs 'agenda' (List)
  const [displayMode, setDisplayMode] = useState<'calendar' | 'agenda'>('calendar');

  // Search & Filter state for Agenda view
  const [filterType, setFilterType] = useState<'ALL' | 'WHOLE_DAY' | 'TIME_RANGE' | 'UPCOMING'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Form mode: null = viewing, 'create' | 'edit' = form active
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form inputs
  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [formDate, setFormDate] = useState<string>(todayDate);
  const [isWholeDay, setIsWholeDay] = useState<boolean>(true);
  const [startTime, setStartTime] = useState<string>('10:00');
  const [endTime, setEndTime] = useState<string>('12:00');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Sync year and month when modal opens
  useEffect(() => {
    if (isOpen) {
      if (todayDate && todayDate.includes('-')) {
        const [y, m] = todayDate.split('-').map(Number);
        setViewYear(y);
        setViewMonth(m - 1);
        setSelectedDate(todayDate);
      }
      setFormMode(null);
      setEditingId(null);
      setFormError(null);
      if (modalRef.current) {
        gsapPopIn(modalRef.current, { scale: 0.96, duration: 0.28 });
      }
    }
  }, [isOpen, todayDate]);

  // Real-time synchronization while modal is open (WebSocket + BroadcastChannel + Poll safety net)
  useEffect(() => {
    if (!isOpen) return;

    // Immediately fetch latest authoritative activities & closed weekdays upon modal open
    fetchCalendarActivities(supabase).then((fresh) => {
      onActivitiesUpdated(fresh);
    });
    fetchClosedDaysOfWeek(supabase).then((freshClosed) => {
      setClosedDays(freshClosed);
      onClosedDaysUpdated?.(freshClosed);
    });

    // Subscribe to cross-tab BroadcastChannel & Supabase Realtime changes
    const unsubscribe = subscribeToCalendarChanges(supabase, (fresh, freshClosed) => {
      onActivitiesUpdated(fresh);
      if (freshClosed) {
        setClosedDays(freshClosed);
        onClosedDaysUpdated?.(freshClosed);
      }
    });

    // Safety polling net (every 3.5 seconds while open) to guarantee instant reflection even if socket hiccups
    const pollTimer = setInterval(() => {
      fetchCalendarActivities(supabase).then((fresh) => {
        onActivitiesUpdated(fresh);
      });
      fetchClosedDaysOfWeek(supabase).then((freshClosed) => {
        setClosedDays(freshClosed);
        onClosedDaysUpdated?.(freshClosed);
      });
    }, 3500);

    return () => {
      unsubscribe();
      clearInterval(pollTimer);
    };
  }, [isOpen, onActivitiesUpdated, onClosedDaysUpdated]);

  // Handler for closing or reopening a specific weekday (Admin only)
  const handleToggleWeekdayClosure = async (dayOfWeek: number, close: boolean) => {
    if (!isLibrarian) return;
    const dayName = DAY_OF_WEEK_NAMES[dayOfWeek] || `Day ${dayOfWeek}`;
    if (close) {
      const confirmClose = window.confirm(
        `Temporarily close every ${dayName}?\n\nWhen closed, all headcount submissions and library attendance data on every ${dayName} will be automatically excluded from statistical calculations and reports until you reopen it.`
      );
      if (!confirmClose) return;
    }

    setTogglingDay(dayOfWeek);
    try {
      const updatedDays = await toggleClosedDayOfWeek(supabase, dayOfWeek, close, profile);
      setClosedDays(updatedDays);
      onClosedDaysUpdated?.(updatedDays);
      onNotify?.(
        'success',
        close
          ? `Every ${dayName} has been temporarily closed. Data on this day is now excluded from statistical reports.`
          : `Every ${dayName} has been reopened. Operations and attendance data on this day are now included in reports.`
      );
    } catch (err: any) {
      onNotify?.('error', `Failed to update schedule: ${err?.message || 'Error occurred'}`);
    } finally {
      setTogglingDay(null);
    }
  };

  // Month navigation handlers
  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleGoToToday = () => {
    if (todayDate && todayDate.includes('-')) {
      const [y, m] = todayDate.split('-').map(Number);
      setViewYear(y);
      setViewMonth(m - 1);
      setSelectedDate(todayDate);
    }
  };

  // Generate the 35 or 42 grid cells for the huge calendar
  const calendarCells = useMemo(() => {
    const firstDayOfMonth = new Date(viewYear, viewMonth, 1);
    const startDayOfWeek = firstDayOfMonth.getDay(); // 0 = Sunday
    const daysInCurrentMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const cells: {
      dateStr: string;
      dayNumber: number;
      isCurrentMonth: boolean;
      isToday: boolean;
      isSelected: boolean;
      isSunday: boolean;
      isWeekdayClosed: boolean;
      weekdayName: string;
      activities: CalendarActivity[];
      isWholeDay: boolean;
    }[] = [];

    // Helper to evaluate weekday closure
    const getCellClosure = (dStr: string) => {
      const [cy, cm, cd] = dStr.split('-').map(Number);
      const dow = new Date(cy, (cm || 1) - 1, cd || 1).getDay();
      return {
        isWeekdayClosed: closedDays.includes(dow),
        weekdayName: DAY_OF_WEEK_NAMES[dow] || '',
      };
    };

    // Previous month padding days
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const prevM = viewMonth === 0 ? 11 : viewMonth - 1;
      const prevY = viewMonth === 0 ? viewYear - 1 : viewYear;
      const dateStr = `${prevY}-${String(prevM + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayActs = activities.filter((a) => a.date === dateStr);
      const { isWeekdayClosed, weekdayName } = getCellClosure(dateStr);
      cells.push({
        dateStr,
        dayNumber: d,
        isCurrentMonth: false,
        isToday: dateStr === todayDate,
        isSelected: dateStr === selectedDate,
        isSunday: isSundayDate(dateStr),
        isWeekdayClosed,
        weekdayName,
        activities: dayActs,
        isWholeDay: dayActs.some((a) => a.isWholeDay),
      });
    }

    // Current month days
    for (let d = 1; d <= daysInCurrentMonth; d++) {
      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayActs = activities.filter((a) => a.date === dateStr);
      const { isWeekdayClosed, weekdayName } = getCellClosure(dateStr);
      cells.push({
        dateStr,
        dayNumber: d,
        isCurrentMonth: true,
        isToday: dateStr === todayDate,
        isSelected: dateStr === selectedDate,
        isSunday: isSundayDate(dateStr),
        isWeekdayClosed,
        weekdayName,
        activities: dayActs,
        isWholeDay: dayActs.some((a) => a.isWholeDay),
      });
    }

    // Next month padding to fill remaining 7-day grid slots (35 or 42 cells total)
    const totalCells = cells.length > 35 ? 42 : 35;
    const remaining = totalCells - cells.length;
    for (let d = 1; d <= remaining; d++) {
      const nextM = viewMonth === 11 ? 0 : viewMonth + 1;
      const nextY = viewMonth === 11 ? viewYear + 1 : viewYear;
      const dateStr = `${nextY}-${String(nextM + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayActs = activities.filter((a) => a.date === dateStr);
      const { isWeekdayClosed, weekdayName } = getCellClosure(dateStr);
      cells.push({
        dateStr,
        dayNumber: d,
        isCurrentMonth: false,
        isToday: dateStr === todayDate,
        isSelected: dateStr === selectedDate,
        isSunday: isSundayDate(dateStr),
        isWeekdayClosed,
        weekdayName,
        activities: dayActs,
        isWholeDay: dayActs.some((a) => a.isWholeDay),
      });
    }

    return cells;
  }, [viewYear, viewMonth, activities, todayDate, selectedDate, closedDays]);

  // Click on any day cell
  const handleSelectDay = (dateStr: string, isCurrentMonth: boolean) => {
    setSelectedDate(dateStr);
    if (!isCurrentMonth) {
      const [y, m] = dateStr.split('-').map(Number);
      setViewYear(y);
      setViewMonth(m - 1);
    }
    if (formMode === 'create') {
      setFormDate(dateStr);
    }
  };

  // Open Create Form (Librarian only)
  const handleOpenCreateForm = (targetDate?: string) => {
    if (!isLibrarian) return;
    const dateToUse = targetDate || selectedDate || todayDate;
    if (isSundayDate(dateToUse)) {
      setFormError('Sundays are regular non-working days (the library is closed). Suspensions cannot be scheduled on Sundays.');
      return;
    }
    setFormMode('create');
    setEditingId(null);
    setTitle('');
    setDescription('');
    setFormDate(dateToUse);
    setIsWholeDay(true);
    setStartTime('10:00');
    setEndTime('12:00');
    setFormError(null);
  };

  // Open Edit Form (Librarian only)
  const handleOpenEditForm = (item: CalendarActivity) => {
    if (!isLibrarian) return;
    setFormMode('edit');
    setEditingId(item.id);
    setTitle(item.title);
    setDescription(item.description || '');
    setFormDate(item.date);
    setIsWholeDay(item.isWholeDay);
    setStartTime(item.startTime || '10:00');
    setEndTime(item.endTime || '12:00');
    setFormError(null);
  };

  const handleCancelForm = () => {
    setFormMode(null);
    setEditingId(null);
    setFormError(null);
  };

  // Save Activity Form Submission (Librarian only)
  const handleSaveActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLibrarian) return;
    setFormError(null);

    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setFormError('Please enter an activity or suspension title.');
      return;
    }

    if (!formDate) {
      setFormError('Please select a specific date.');
      return;
    }

    if (isSundayDate(formDate)) {
      setFormError('Sundays are regular non-working days (library is closed). Class suspensions cannot be assigned on Sundays.');
      return;
    }

    if (!isWholeDay) {
      if (!startTime || !endTime) {
        setFormError('Please select both starting and ending hours.');
        return;
      }
      if (startTime >= endTime) {
        setFormError('Start time must be strictly earlier than end time (e.g. 10:00 AM - 12:00 PM).');
        return;
      }
    }

    setSaving(true);
    try {
      const existing = editingId ? activities.find((a) => a.id === editingId) : null;
      const activityPayload: CalendarActivity = {
        id: editingId || `cal_${Date.now()}`,
        carrierId: existing?.carrierId,
        title: cleanTitle,
        description: description.trim(),
        date: formDate,
        isWholeDay,
        startTime: isWholeDay ? '08:00' : startTime,
        endTime: isWholeDay ? '18:00' : endTime,
        createdAt: existing?.createdAt || new Date().toISOString(),
        createdBy: existing?.createdBy || profile.full_name,
      };

      const saved = await persistCalendarActivity(supabase, activityPayload, profile);

      const nextList = editingId
        ? activities.map((a) => (a.id === editingId ? saved : a))
        : [saved, ...activities.filter((a) => a.id !== saved.id)];

      nextList.sort((a, b) => b.date.localeCompare(a.date));
      onActivitiesUpdated(nextList);

      // Keep focus on the date just saved
      setSelectedDate(formDate);
      const [y, m] = formDate.split('-').map(Number);
      setViewYear(y);
      setViewMonth(m - 1);

      setFormMode(null);
      setEditingId(null);
    } catch (err: any) {
      setFormError(err.message || 'Failed to save calendar activity. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Delete Activity (Librarian only)
  const handleDeleteActivity = async (item: CalendarActivity) => {
    if (!isLibrarian) return;
    if (
      !window.confirm(
        `Are you sure you want to remove "${item.title}" (${item.date})?\n\nThis date or time period will resume regular library statistics calculations.`
      )
    ) {
      return;
    }

    setDeletingId(item.id);
    try {
      // Immediate optimistic update: remove all matching instances from current state
      const nextList = activities.filter((a) => {
        if (a.id === item.id) return false;
        if (item.carrierId && a.carrierId === item.carrierId) return false;
        if (
          a.title.trim().toLowerCase() === item.title.trim().toLowerCase() &&
          a.date === item.date
        ) {
          return false;
        }
        return true;
      });
      onActivitiesUpdated(nextList);

      await removeCalendarActivity(supabase, item);

      onNotify?.('success', `Removed class suspension: "${item.title}"`);
    } catch (err: any) {
      onNotify?.('error', `Failed to remove class suspension: ${err?.message || 'Error occurred'}`);
    } finally {
      setDeletingId(null);
    }
  };

  // Filtered activities for the list / agenda view
  const filteredActivities = useMemo(() => {
    return activities.filter((item) => {
      if (filterType === 'WHOLE_DAY' && !item.isWholeDay) return false;
      if (filterType === 'TIME_RANGE' && item.isWholeDay) return false;
      if (filterType === 'UPCOMING' && item.date < todayDate) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = item.title.toLowerCase().includes(q);
        const matchDesc = (item.description || '').toLowerCase().includes(q);
        const matchDate = item.date.includes(q);
        if (!matchTitle && !matchDesc && !matchDate) return false;
      }
      return true;
    });
  }, [activities, filterType, searchQuery, todayDate]);

  // Activities specifically on the selected date
  const selectedDateActivities = useMemo(() => {
    return activities.filter((a) => a.date === selectedDate);
  }, [activities, selectedDate]);

  // Formatted date label for selected day
  const selectedDateFullLabel = useMemo(() => {
    if (!selectedDate || !selectedDate.includes('-')) return selectedDate;
    const [y, m, d] = selectedDate.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    return dateObj.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }, [selectedDate]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] w-screen h-screen bg-[#14100D]/80 dark:bg-black/90 backdrop-blur-[4px] flex items-center justify-center p-2 sm:p-4 animate-literary-fade"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={modalRef}
        className="literary-card bg-[#FFFFFF] dark:bg-[#1C1814] border border-[#E6D7C3] dark:border-[#383028] shadow-2xl w-full max-w-7xl h-[94vh] max-h-[960px] flex flex-col relative overflow-hidden rounded-3xl"
      >
        {/* Academic Accent Stripe */}
        <div className="h-1.5 w-full bg-gradient-to-r from-[#A83232] via-[#E7B84B] to-[#71865A] absolute top-0 left-0 z-20" />

        {/* =====================================================================
            MODAL HEADER: Title, Role Badge, View Mode & Close
        ===================================================================== */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-[#E6D7C3] dark:border-[#383028] flex flex-wrap items-center justify-between gap-3 bg-[#FAF5EE]/70 dark:bg-[#181512]/90 relative z-10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-[#FDF3F3] dark:bg-[#2C1414] border border-[#E8BDBD] dark:border-[#5C2424] flex items-center justify-center text-[#A83232] dark:text-[#E25D5D] shrink-0 shadow-xs">
              <Calendar className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg md:text-xl font-heading font-bold text-[#332F2B] dark:text-[#F0E8DE] truncate">
                  Calendar of Activities
                </h2>
                {isLibrarian ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#FEF9EC] dark:bg-[#2C2210] text-[#7D5B06] dark:text-[#F5D075] border border-[#E7B84B]/50 shrink-0">
                    <ShieldCheck className="w-3 h-3 text-[#B88412]" />
                    <span>Librarian</span>
                    <span className="hidden sm:inline">· Full Edit Access</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#F1F5EE] dark:bg-[#182414] text-[#455436] dark:text-[#B2D898] border border-[#71865A]/40 shrink-0">
                    <Lock className="w-3 h-3 text-[#71865A]" />
                    <span>Student Assistant</span>
                    <span className="hidden sm:inline">· Read-Only</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-[#6E665E] dark:text-[#A6998C] truncate mt-0.5 hidden sm:block">
                Interactive academic calendar. Click any day to view scheduled events or declare class suspensions.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Toggle: Grid Calendar vs Agenda List */}
            <div className="flex items-center p-0.5 rounded-xl bg-white dark:bg-[#241F1A] border border-[#E6D7C3] dark:border-[#383028] shadow-2xs">
              <button
                type="button"
                onClick={() => setDisplayMode('calendar')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer ${
                  displayMode === 'calendar'
                    ? 'bg-[#A83232] text-white shadow-2xs'
                    : 'text-[#6E665E] dark:text-[#A6998C] hover:text-[#332F2B] dark:hover:text-white'
                }`}
                title="Full Month Calendar Grid"
              >
                <Grid className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Calendar Grid</span>
              </button>
              <button
                type="button"
                onClick={() => setDisplayMode('agenda')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer ${
                  displayMode === 'agenda'
                    ? 'bg-[#A83232] text-white shadow-2xs'
                    : 'text-[#6E665E] dark:text-[#A6998C] hover:text-[#332F2B] dark:hover:text-white'
                }`}
                title="Agenda / List View"
              >
                <List className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Agenda List</span>
              </button>
            </div>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-[#6E665E] dark:text-[#A6998C] hover:text-[#332F2B] dark:hover:text-white hover:bg-[#FAF5EE] dark:hover:bg-[#25201B] transition cursor-pointer"
              aria-label="Close Calendar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* =====================================================================
            CALENDAR NAVIGATION & LEGEND STRIP
        ===================================================================== */}
        {displayMode === 'calendar' && (
          <div className="px-3 sm:px-6 py-2 sm:py-2.5 border-b border-[#E6D7C3] dark:border-[#383028] flex flex-wrap items-center justify-between gap-2 sm:gap-3 bg-[#FFFFFF] dark:bg-[#1C1814]">
            {/* Month & Year Navigator */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="p-1 sm:p-1.5 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-white dark:bg-[#221D18] hover:bg-[#FAF5EE] dark:hover:bg-[#2A231C] text-[#332F2B] dark:text-[#F0E8DE] transition cursor-pointer shadow-2xs"
                title="Previous Month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="px-2 sm:px-3 py-1 text-sm sm:text-lg font-heading font-bold text-[#332F2B] dark:text-[#F0E8DE] min-w-[130px] sm:min-w-[170px] text-center select-none">
                {MONTH_NAMES[viewMonth]} {viewYear}
              </div>

              <button
                type="button"
                onClick={handleNextMonth}
                className="p-1 sm:p-1.5 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-white dark:bg-[#221D18] hover:bg-[#FAF5EE] dark:hover:bg-[#2A231C] text-[#332F2B] dark:text-[#F0E8DE] transition cursor-pointer shadow-2xs"
                title="Next Month"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={handleGoToToday}
                className="ml-1 sm:ml-2 px-2 sm:px-3 py-1 rounded-xl border border-[#D6C3A9] dark:border-[#42382F] bg-[#FAF5EE] dark:bg-[#25201A] hover:bg-[#F5EBDD] dark:hover:bg-[#2F271F] text-[#332F2B] dark:text-[#F0E8DE] text-xs font-semibold transition cursor-pointer"
              >
                Today
              </button>
            </div>

            {/* Legend Indicators */}
            <div className="hidden sm:flex flex-wrap items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#A83232] shrink-0" />
                <span className="text-[#6E665E] dark:text-[#A6998C]">No Classes (Whole Day)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#E7B84B] shrink-0" />
                <span className="text-[#6E665E] dark:text-[#A6998C]">Partial Hours Excluded</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#A83232] border border-white dark:border-[#383028] shadow-2xs" />
                <span className="text-[#6E665E] dark:text-[#A6998C]">Temporarily Closed Day</span>
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            WEEKLY OPERATING SCHEDULE STATUS (Configured in Advanced Settings)
        ===================================================================== */}
        {closedDays.length > 0 && (
          <div className="px-4 sm:px-6 py-2 border-b border-[#E6D7C3] dark:border-[#383028] bg-[#FDF8F8] dark:bg-[#1E1414] flex flex-wrap items-center justify-between gap-2.5 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#A83232] animate-pulse shrink-0" />
              <span className="font-heading font-bold text-[#A83232] dark:text-[#F5A3A3]">
                Weekly Day Closures Active ({closedDays.length}):
              </span>
              <span className="text-[#6E665E] dark:text-[#A6998C]">
                {closedDays.map((d) => OPERATING_WEEKDAYS.find((w) => w.dayOfWeek === d)?.name || `Day ${d}`).join(', ')} (Data excluded from statistics)
              </span>
            </div>
            <span className="text-[11px] text-[#A83232] dark:text-[#F5A3A3] font-medium hidden sm:inline">
              Managed in Advanced Settings
            </span>
          </div>
        )}

        {/* =====================================================================
            CALENDAR BODY: HUGE GRID (LEFT) + DAY INSPECTOR / EDITOR (RIGHT)
        ===================================================================== */}
        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
          {displayMode === 'calendar' ? (
            <>
              {/* LEFT COLUMN: HUGE MONTHLY CALENDAR GRID */}
              <div className="flex-1 overflow-y-auto p-3 sm:p-5 flex flex-col bg-[#FAF7F2]/60 dark:bg-[#161310]/80">
                {/* 7 Weekday Headers */}
                <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-2 select-none">
                  {WEEKDAY_NAMES.map((w, idx) => {
                    const isClosed = closedDays.includes(idx);
                    return (
                      <div
                        key={w}
                        className={`text-center py-1.5 text-[11px] font-bold tracking-wider rounded-lg flex flex-col items-center justify-center gap-0.5 ${
                          isClosed
                            ? 'text-[#A83232] dark:text-[#F5A3A3] bg-[#FDF3F3] dark:bg-[#331717] border border-[#E8BDBD] dark:border-[#5C2424] shadow-2xs'
                            : idx === 0 || idx === 6
                            ? 'text-[#A83232] dark:text-[#E25D5D] bg-[#FDF3F3]/60 dark:bg-[#2C1414]/40'
                            : 'text-[#6E665E] dark:text-[#A6998C] bg-white/60 dark:bg-[#1E1A16]/50'
                        }`}
                      >
                        <span>{w}</span>
                        {isClosed && (
                          <>
                            <span className="hidden sm:inline text-[9px] font-black uppercase text-[#A83232] dark:text-[#F5A3A3] leading-none">
                              [Closed]
                            </span>
                            <span className="sm:hidden text-[8px] font-bold text-[#A83232] dark:text-[#F5A3A3] leading-none">
                              ✕
                            </span>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* The Huge Month Grid (35 or 42 Day Cells) */}
                <div className="grid grid-cols-7 gap-1 sm:gap-2 flex-1 auto-rows-fr">
                  {calendarCells.map((cell) => {
                    const hasActs = cell.activities.length > 0;
                    return (
                      <button
                        type="button"
                        key={cell.dateStr}
                        onClick={() => handleSelectDay(cell.dateStr, cell.isCurrentMonth)}
                        className={`group relative text-left rounded-xl sm:rounded-2xl p-1 sm:p-2.5 border transition-all duration-150 flex flex-col justify-between cursor-pointer min-h-[56px] sm:min-h-[92px] lg:min-h-[105px] overflow-hidden ${
                          cell.isSelected
                            ? 'ring-2 ring-[#A83232] border-[#A83232] bg-[#FFF8F0] dark:bg-[#2A1D13] shadow-md z-10'
                            : cell.isWeekdayClosed
                            ? 'bg-[#FFF5F5] dark:bg-[#281414] border-[#E8BDBD] dark:border-[#5C2424] hover:border-[#A83232] shadow-2xs'
                            : cell.isSunday
                            ? 'bg-[#FAF5EE]/75 dark:bg-[#1A1613]/70 border-[#E6D7C3]/60 dark:border-[#2C241E] hover:border-[#D6C3A9]'
                            : cell.isCurrentMonth
                            ? 'bg-white dark:bg-[#1E1915] border-[#E6D7C3] dark:border-[#383028] shadow-2xs hover:border-[#A83232]/50 hover:bg-[#FFFDF8] dark:hover:bg-[#25201A]'
                            : 'bg-[#FAF5EE]/40 dark:bg-[#171411]/50 border-transparent text-[#A6998C] dark:text-[#5C5348] opacity-60 hover:opacity-100 hover:border-[#D6C3A9]'
                        }`}
                      >
                        {/* Day Cell Top Bar: Date Number & Badges */}
                        <div className="flex items-center justify-between w-full">
                          <span
                            className={`inline-flex items-center justify-center font-stat font-bold text-xs sm:text-sm rounded-full transition-colors ${
                              cell.isToday
                                ? 'w-5 h-5 sm:w-7 sm:h-7 bg-[#A83232] text-white shadow-xs text-[11px] sm:text-sm'
                                : cell.isSelected
                                ? 'text-[#A83232] dark:text-[#F5A3A3] font-black'
                                : cell.isWeekdayClosed
                                ? 'text-[#A83232] dark:text-[#F5A3A3] font-black'
                                : cell.isSunday
                                ? 'text-[#8C7F72] dark:text-[#7D7063]'
                                : cell.isCurrentMonth
                                ? 'text-[#332F2B] dark:text-[#F0E8DE]'
                                : 'text-[#8C7F72] dark:text-[#6E645A]'
                            }`}
                          >
                            {cell.dayNumber}
                          </span>

                          <div className="flex items-center gap-1">
                            {cell.isWeekdayClosed ? (
                              <span
                                className="text-[9px] font-bold text-[#A83232] dark:text-[#F5A3A3] uppercase px-1 sm:px-1.5 py-0.5 rounded bg-[#FDF3F3] dark:bg-[#381616] border border-[#E8BDBD]/60 flex items-center gap-1"
                                title={`Library is temporarily closed on every ${cell.weekdayName}`}
                              >
                                <ShieldAlert className="w-2.5 h-2.5 shrink-0" />
                                <span className="hidden sm:inline">Closed</span>
                              </span>
                            ) : cell.isSunday ? (
                              <span className="hidden sm:inline text-[9px] font-bold text-[#8C7F72] dark:text-[#7D7063] uppercase px-1 py-0.5 rounded bg-[#F0E6D8]/60 dark:bg-[#241F1A]">
                                Closed
                              </span>
                            ) : null}
                            {/* Suspension Indicator Dots */}
                            {hasActs && (
                              <span className="hidden sm:flex items-center gap-1">
                                {cell.isWholeDay ? (
                                  <span className="w-2 h-2 rounded-full bg-[#A83232] animate-pulse" title="Whole Day Suspension" />
                                ) : (
                                  <span className="w-2 h-2 rounded-full bg-[#E7B84B]" title="Partial Time Range Excluded" />
                                )}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Activity Chips inside the Day Cell */}
                        <div className="mt-0.5 sm:mt-1 space-y-1 w-full overflow-hidden flex-1">
                          {cell.isWeekdayClosed && (
                            <div
                              className="hidden sm:flex truncate px-1.5 py-0.5 rounded-md text-[10px] font-bold leading-tight bg-[#FDF3F3] dark:bg-[#331717] text-[#A83232] dark:text-[#F5A3A3] border border-[#E8BDBD]/70 items-center gap-1"
                              title={`Library is temporarily closed on every ${cell.weekdayName}`}
                            >
                              <span>🚫</span>
                              <span>Closed: Every {cell.weekdayName.slice(0, 3)}</span>
                            </div>
                          )}

                          {cell.activities.slice(0, 2).map((act) => (
                            <div
                              key={act.id}
                              className={`hidden sm:block truncate px-1.5 py-0.5 rounded-md text-[10px] font-semibold leading-tight ${
                                act.isWholeDay
                                  ? 'bg-[#FDF3F3] dark:bg-[#331717] text-[#A83232] dark:text-[#F5A3A3] border border-[#E8BDBD]/60'
                                  : 'bg-[#FEF9EC] dark:bg-[#2C2210] text-[#7D5B06] dark:text-[#F5D075] border border-[#E7B84B]/40'
                              }`}
                              title={`${act.title} ${act.isWholeDay ? '(Whole Day)' : `(${formatActivityTimeRange(act)})`}`}
                            >
                              {act.isWholeDay ? '🚫 ' : '⏰ '}
                              {act.title}
                            </div>
                          ))}

                          {cell.activities.length > 2 && (
                            <div className="hidden sm:block text-[9px] font-bold text-[#6E665E] dark:text-[#A6998C] px-1">
                              +{cell.activities.length - 2} more
                            </div>
                          )}

                          {/* Mobile Dot Indicators (< sm screens) */}
                          <div className="flex sm:hidden items-center justify-center gap-1 mt-1 flex-wrap">
                            {cell.isWeekdayClosed && (
                              <span className="w-1.5 h-1.5 rounded-full bg-[#A83232]" title="Closed Day" />
                            )}
                            {cell.activities.map((act) => (
                              <span
                                key={act.id}
                                className={`w-1.5 h-1.5 rounded-full ${act.isWholeDay ? 'bg-[#A83232]' : 'bg-[#E7B84B]'}`}
                                title={act.title}
                              />
                            ))}
                          </div>
                        </div>

                        {/* Subtle Librarian Add Hint on Hover */}
                        {isLibrarian && !hasActs && !cell.isSunday && !cell.isWeekdayClosed && (
                          <div className="text-[10px] text-[#A83232] dark:text-[#E25D5D] opacity-0 group-hover:opacity-100 transition-opacity font-semibold pt-0.5 text-right w-full hidden sm:block">
                            + Add
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* RIGHT COLUMN: DAY INSPECTOR & LIBRARIAN EDIT PANEL */}
              <div className="w-full lg:w-[380px] xl:w-[420px] border-t lg:border-t-0 lg:border-l border-[#E6D7C3] dark:border-[#383028] bg-[#FFFFFF] dark:bg-[#1C1814] flex flex-col shrink-0 overflow-y-auto max-h-[50vh] lg:max-h-none">
                {/* Day Inspector Header */}
                <div className="p-4 sm:p-5 border-b border-[#E6D7C3] dark:border-[#383028] bg-[#FAF5EE]/50 dark:bg-[#191512]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#A83232] dark:text-[#E25D5D]">
                      Selected Date Details
                    </span>
                    {selectedDate === todayDate && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#A83232] text-white">
                        TODAY
                      </span>
                    )}
                  </div>
                  <h3 className="text-base sm:text-lg font-heading font-bold text-[#332F2B] dark:text-[#F0E8DE] mt-0.5">
                    {selectedDateFullLabel}
                  </h3>
                  <div className="text-xs text-[#6E665E] dark:text-[#A6998C] font-stat mt-0.5">
                    {selectedDate}
                  </div>
                </div>

                {/* Day Content: Form (if active) OR Activities List for Selected Day */}
                <div className="p-4 sm:p-5 flex-1 space-y-4">
                  {/* FORM MODE: Declare / Edit Suspension (Librarian Only) */}
                  {formMode && isLibrarian ? (
                    <form onSubmit={handleSaveActivity} className="space-y-4 animate-literary-fade">
                      <div className="p-4 rounded-2xl bg-[#FAF5EE] dark:bg-[#241F1A] border border-[#E6D7C3] dark:border-[#383028] space-y-3.5 shadow-2xs">
                        <div className="flex items-center justify-between pb-2 border-b border-[#E6D7C3] dark:border-[#383028]">
                          <div className="text-xs font-heading font-bold text-[#332F2B] dark:text-[#F0E8DE] flex items-center gap-1.5">
                            <ShieldAlert className="w-3.5 h-3.5 text-[#A83232] dark:text-[#E25D5D]" />
                            <span>{formMode === 'create' ? 'Declare Class Suspension' : 'Edit Calendar Entry'}</span>
                          </div>
                          <button
                            type="button"
                            onClick={handleCancelForm}
                            className="text-xs text-[#6E665E] dark:text-[#A6998C] hover:text-[#A83232] font-semibold cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>

                        {formError && (
                          <div className="p-2.5 rounded-xl bg-[#FDF3F3] dark:bg-[#331818] border border-[#A83232]/30 text-xs text-[#A83232] dark:text-[#F5A3A3] flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                            <span>{formError}</span>
                          </div>
                        )}

                        {/* Title Input */}
                        <div>
                          <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] mb-1">
                            Activity Title / Reason <span className="text-[#A83232]">*</span>
                          </label>
                          <input
                            type="text"
                            required
                            autoFocus
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="e.g. University Convocation, Typhoon Suspension"
                            className="w-full h-9 px-3 rounded-xl bg-white dark:bg-[#181411] border border-[#E6D7C3] dark:border-[#42382F] text-xs text-[#332F2B] dark:text-[#F0E8DE] focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
                          />
                        </div>

                        {/* Date Picker (Preset to Selected Day) */}
                        <div>
                          <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] mb-1">
                            Date <span className="text-[#A83232]">*</span>
                          </label>
                          <input
                            type="date"
                            required
                            value={formDate}
                            onChange={(e) => {
                              const val = e.target.value;
                              setFormDate(val);
                              if (isSundayDate(val)) {
                                setFormError('Cannot assign suspension: Selected date is a Sunday (regular non-working day).');
                              } else if (formError?.includes('Sunday')) {
                                setFormError(null);
                              }
                            }}
                            className={`w-full h-9 px-3 rounded-xl bg-white dark:bg-[#181411] border text-xs font-stat text-[#332F2B] dark:text-[#F0E8DE] ${
                              isSundayDate(formDate)
                                ? 'border-[#A83232] ring-1 ring-[#A83232]'
                                : 'border-[#E6D7C3] dark:border-[#42382F]'
                            }`}
                          />
                          {isSundayDate(formDate) && (
                            <p className="text-[11px] text-[#A83232] dark:text-[#F5A3A3] font-semibold mt-1 flex items-center gap-1">
                              <AlertCircle className="w-3 h-3 shrink-0" />
                              Sundays are non-working days. Please select Monday–Saturday.
                            </p>
                          )}
                        </div>

                        {/* Scope Toggle: Whole Day vs Partial */}
                        <div>
                          <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] mb-1.5">
                            Scope of Suspension
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setIsWholeDay(true)}
                              className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                                isWholeDay
                                  ? 'bg-[#FEF9EC] dark:bg-[#2C2210] border-[#E7B84B] ring-1 ring-[#E7B84B]/50'
                                  : 'bg-white dark:bg-[#181411] border-[#E6D7C3] dark:border-[#42382F]'
                              }`}
                            >
                              <div className="text-xs font-bold text-[#332F2B] dark:text-[#F0E8DE]">
                                Whole Day
                              </div>
                              <div className="text-[10px] text-[#6E665E] dark:text-[#A6998C]">
                                Entire 8 AM–6 PM
                              </div>
                            </button>

                            <button
                              type="button"
                              onClick={() => setIsWholeDay(false)}
                              className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                                !isWholeDay
                                  ? 'bg-[#FEF9EC] dark:bg-[#2C2210] border-[#E7B84B] ring-1 ring-[#E7B84B]/50'
                                  : 'bg-white dark:bg-[#181411] border-[#E6D7C3] dark:border-[#42382F]'
                              }`}
                            >
                              <div className="text-xs font-bold text-[#332F2B] dark:text-[#F0E8DE]">
                                Specific Hours
                              </div>
                              <div className="text-[10px] text-[#6E665E] dark:text-[#A6998C]">
                                Partial interval
                              </div>
                            </button>
                          </div>
                        </div>

                        {/* Partial Time Selection */}
                        {!isWholeDay && (
                          <div className="p-2.5 rounded-xl bg-white dark:bg-[#181411] border border-[#E7B84B]/60 space-y-2">
                            <div className="flex items-center gap-1 text-[11px] font-bold text-[#7D5B06] dark:text-[#F5D075]">
                              <Clock className="w-3 h-3" />
                              <span>Set Excluded Time Period:</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div>
                                <label className="block text-[10px] text-[#6E665E] dark:text-[#A6998C] mb-1">
                                  Start:
                                </label>
                                <select
                                  value={startTime}
                                  onChange={(e) => setStartTime(e.target.value)}
                                  className="w-full h-8 px-2 rounded-lg bg-[#FAF5EE] dark:bg-[#241F1A] border border-[#E6D7C3] dark:border-[#42382F] text-xs font-stat text-[#332F2B] dark:text-[#F0E8DE]"
                                >
                                  <option value="08:00">8:00 AM</option>
                                  <option value="08:30">8:30 AM</option>
                                  <option value="09:00">9:00 AM</option>
                                  <option value="09:30">9:30 AM</option>
                                  <option value="10:00">10:00 AM</option>
                                  <option value="10:30">10:30 AM</option>
                                  <option value="11:00">11:00 AM</option>
                                  <option value="11:30">11:30 AM</option>
                                  <option value="12:00">12:00 PM</option>
                                  <option value="12:30">12:30 PM</option>
                                  <option value="13:00">1:00 PM</option>
                                  <option value="13:30">1:30 PM</option>
                                  <option value="14:00">2:00 PM</option>
                                  <option value="14:30">2:30 PM</option>
                                  <option value="15:00">3:00 PM</option>
                                  <option value="15:30">3:30 PM</option>
                                  <option value="16:00">4:00 PM</option>
                                  <option value="16:30">4:30 PM</option>
                                  <option value="17:00">5:00 PM</option>
                                </select>
                              </div>

                              <div>
                                <label className="block text-[10px] text-[#6E665E] dark:text-[#A6998C] mb-1">
                                  Resume:
                                </label>
                                <select
                                  value={endTime}
                                  onChange={(e) => setEndTime(e.target.value)}
                                  className="w-full h-8 px-2 rounded-lg bg-[#FAF5EE] dark:bg-[#241F1A] border border-[#E6D7C3] dark:border-[#42382F] text-xs font-stat text-[#332F2B] dark:text-[#F0E8DE]"
                                >
                                  <option value="09:00">9:00 AM</option>
                                  <option value="09:30">9:30 AM</option>
                                  <option value="10:00">10:00 AM</option>
                                  <option value="10:30">10:30 AM</option>
                                  <option value="11:00">11:00 AM</option>
                                  <option value="11:30">11:30 AM</option>
                                  <option value="12:00">12:00 PM</option>
                                  <option value="12:30">12:30 PM</option>
                                  <option value="13:00">1:00 PM</option>
                                  <option value="13:30">1:30 PM</option>
                                  <option value="14:00">2:00 PM</option>
                                  <option value="14:30">2:30 PM</option>
                                  <option value="15:00">3:00 PM</option>
                                  <option value="15:30">3:30 PM</option>
                                  <option value="16:00">4:00 PM</option>
                                  <option value="16:30">4:30 PM</option>
                                  <option value="17:00">5:00 PM</option>
                                  <option value="17:30">5:30 PM</option>
                                  <option value="18:00">6:00 PM</option>
                                </select>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Description Notes */}
                        <div>
                          <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] mb-1">
                            Memorandum / Notes (Optional)
                          </label>
                          <textarea
                            rows={2}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="e.g. Declared by University Admin"
                            className="w-full p-2.5 rounded-xl bg-white dark:bg-[#181411] border border-[#E6D7C3] dark:border-[#42382F] text-xs text-[#332F2B] dark:text-[#F0E8DE] focus:outline-none focus:ring-1 focus:ring-[#A83232]"
                          />
                        </div>

                        {/* Save / Cancel buttons */}
                        <div className="flex items-center justify-between pt-1">
                          <div>
                            {formMode === 'edit' && editingId && (
                              <button
                                type="button"
                                disabled={deletingId === editingId}
                                onClick={() => {
                                  const itemToDel = activities.find((a) => a.id === editingId);
                                  if (itemToDel) {
                                    handleDeleteActivity(itemToDel);
                                    handleCancelForm();
                                  }
                                }}
                                className="h-8 px-2.5 rounded-xl border border-[#A83232]/30 bg-[#FDF3F3] text-[#A83232] hover:bg-[#A83232] hover:text-white text-xs font-semibold cursor-pointer inline-flex items-center gap-1 transition disabled:opacity-50"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Delete</span>
                              </button>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={handleCancelForm}
                              className="h-8 px-3.5 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-white dark:bg-[#1C1814] text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              disabled={saving || isSundayDate(formDate)}
                              className="h-8 px-4 rounded-xl bg-gradient-to-r from-[#A83232] via-[#942727] to-[#7C1E1E] hover:from-[#942727] hover:to-[#6E1A1A] text-white text-xs font-semibold cursor-pointer shadow-sm shadow-[#A83232]/25 disabled:opacity-50 inline-flex items-center gap-1.5"
                            >
                              {saving ? 'Saving...' : formMode === 'create' ? 'Save Entry' : 'Update Entry'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </form>
                  ) : (
                    /* NORMAL VIEW: Activities for Selected Day */
                    <div className="space-y-3">
                      {/* RECURRING WEEKDAY CLOSURE NOTICE */}
                      {isDayOfWeekClosed(selectedDate, closedDays) && (
                        <div className="p-3.5 rounded-2xl bg-[#FFF5F5] dark:bg-[#281414] border border-[#E8BDBD] dark:border-[#5C2424] space-y-2.5 shadow-2xs">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-xs font-bold text-[#A83232] dark:text-[#F5A3A3]">
                              <ShieldAlert className="w-4 h-4 shrink-0" />
                              <span>Temporarily Closed: Every {DAY_OF_WEEK_NAMES[new Date(selectedDate + 'T00:00:00').getDay()]}</span>
                            </div>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-[#A83232] text-white shrink-0">
                              CLOSED
                            </span>
                          </div>
                          <p className="text-[11px] text-[#6E665E] dark:text-[#A6998C] leading-relaxed">
                            Library operations for every {DAY_OF_WEEK_NAMES[new Date(selectedDate + 'T00:00:00').getDay()]} are currently suspended by the Admin. All data recorded on this date is automatically excluded from statistical calculations and reports.
                          </p>
                          {isLibrarian && (
                            <button
                              type="button"
                              onClick={() => handleToggleWeekdayClosure(new Date(selectedDate + 'T00:00:00').getDay(), false)}
                              disabled={togglingDay !== null}
                              className="w-full py-2 px-3 rounded-xl bg-[#2E5A44] hover:bg-[#244736] text-white font-semibold text-xs inline-flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs disabled:opacity-50"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Reopen Every {DAY_OF_WEEK_NAMES[new Date(selectedDate + 'T00:00:00').getDay()]}
                            </button>
                          )}
                        </div>
                      )}

                      {selectedDateActivities.length === 0 ? (
                        isSundayDate(selectedDate) ? (
                          <div className="p-6 text-center rounded-2xl bg-[#FAF5EE] dark:bg-[#241F1A] border border-[#E6D7C3] dark:border-[#383028] space-y-3">
                            <div className="w-10 h-10 rounded-full bg-[#F5EBDD] dark:bg-[#2C241E] text-[#8C7F72] dark:text-[#A6998C] flex items-center justify-center mx-auto">
                              <Lock className="w-5 h-5 opacity-80" />
                            </div>
                            <div>
                              <div className="text-xs font-heading font-bold text-[#332F2B] dark:text-[#F0E8DE]">
                                Sunday — Non-Working Day
                              </div>
                              <div className="text-[10px] font-bold text-[#A83232] dark:text-[#E25D5D] uppercase tracking-wider mt-0.5">
                                Library Closed
                              </div>
                            </div>
                            <p className="text-[11px] text-[#6E665E] dark:text-[#A6998C] leading-relaxed">
                              Every Sunday has no work or classes. No library operations or student assistant duty shifts are scheduled. Suspensions are not applicable and cannot be assigned on Sundays.
                            </p>
                            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-[#181411] border border-[#E6D7C3] dark:border-[#383028] text-[11px] font-semibold text-[#8C7F72] dark:text-[#A6998C]">
                              <Info className="w-3.5 h-3.5 text-[#A83232]" />
                              <span>Regular weekly non-working day</span>
                            </div>
                          </div>
                        ) : isDayOfWeekClosed(selectedDate, closedDays) ? null : (
                          <div className="p-6 text-center rounded-2xl bg-[#FAF5EE] dark:bg-[#241F1A] border border-[#E6D7C3] dark:border-[#383028] space-y-2">
                            <CheckCircle2 className="w-8 h-8 text-[#71865A] mx-auto opacity-70" />
                            <div className="text-xs font-bold text-[#332F2B] dark:text-[#F0E8DE]">
                              Regular Library Operating Day
                            </div>
                            <p className="text-[11px] text-[#6E665E] dark:text-[#A6998C] leading-relaxed">
                              No class suspensions or excluded time periods are scheduled for this date. Standard library occupancy statistics apply.
                            </p>

                            {isLibrarian && (
                              <button
                                type="button"
                                onClick={() => handleOpenCreateForm(selectedDate)}
                                className="mt-2 px-3.5 py-2 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shadow-sm shadow-[#A83232]/20"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>Declare Suspension for this Day</span>
                              </button>
                            )}
                          </div>
                        )
                      ) : (
                        <>
                          <div className="flex items-center justify-between pb-1">
                            <span className="text-xs font-bold text-[#332F2B] dark:text-[#F0E8DE]">
                              {selectedDateActivities.length} Scheduled Suspension(s)
                            </span>
                            {isLibrarian && !isSundayDate(selectedDate) && (
                              <button
                                type="button"
                                onClick={() => handleOpenCreateForm(selectedDate)}
                                className="text-xs text-[#A83232] dark:text-[#E25D5D] hover:underline font-bold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Plus className="w-3 h-3" />
                                Add Another
                              </button>
                            )}
                          </div>

                          {isSundayDate(selectedDate) && (
                            <div className="p-2.5 rounded-xl bg-[#FEF9EC] dark:bg-[#2C2210] border border-[#E7B84B]/60 text-xs text-[#7D5B06] dark:text-[#F5D075] flex items-start gap-2">
                              <Info className="w-4 h-4 shrink-0 mt-0.5 text-[#B88412]" />
                              <span>Sundays are regular non-working days (library closed). You may remove any suspension entries assigned to Sundays.</span>
                            </div>
                          )}

                          {selectedDateActivities.map((item) => (
                            <div
                              key={item.id}
                              className="p-3.5 rounded-2xl bg-[#FAF5EE] dark:bg-[#241F1A] border border-[#E6D7C3] dark:border-[#383028] space-y-2 relative shadow-2xs"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <span
                                    className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                      item.isWholeDay
                                        ? 'bg-[#FEF9EC] dark:bg-[#2C2210] text-[#7D5B06] dark:text-[#F5D075] border border-[#E7B84B]/50'
                                        : 'bg-[#F1F5EE] dark:bg-[#182414] text-[#455436] dark:text-[#B2D898] border border-[#71865A]/40'
                                    }`}
                                  >
                                    {item.isWholeDay ? (
                                      '🚫 Whole Day — No Classes'
                                    ) : (
                                      <>
                                        <Clock className="w-3 h-3" />
                                        {formatActivityTimeRange(item)}
                                      </>
                                    )}
                                  </span>
                                  <h4 className="text-sm font-heading font-bold text-[#332F2B] dark:text-[#F0E8DE] mt-1">
                                    {item.title}
                                  </h4>
                                </div>

                                {/* Librarian Actions: Edit & Delete */}
                                {isLibrarian && (
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => handleOpenEditForm(item)}
                                      className="p-1.5 rounded-lg border border-[#E6D7C3] dark:border-[#383028] bg-white dark:bg-[#181411] text-[#332F2B] dark:text-[#F0E8DE] hover:text-[#A83232] cursor-pointer"
                                      title="Edit entry"
                                    >
                                      <Edit2 className="w-3 h-3" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={deletingId === item.id}
                                      onClick={() => handleDeleteActivity(item)}
                                      className="p-1.5 rounded-lg border border-[#E6D7C3] dark:border-[#383028] bg-white dark:bg-[#181411] text-[#A83232] hover:bg-[#FDF3F3] cursor-pointer disabled:opacity-50"
                                      title="Delete entry"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                )}
                              </div>

                              {item.description && (
                                <p className="text-xs text-[#6E665E] dark:text-[#A6998C] leading-relaxed">
                                  {item.description}
                                </p>
                              )}

                              <div className="pt-1 border-t border-[#E6D7C3]/60 dark:border-[#383028] flex items-center justify-between text-[10px] text-[#6E665E] dark:text-[#8C7F72]">
                                <span>By: {item.createdBy}</span>
                                <span className="text-[#71865A] dark:text-[#92B577] font-semibold flex items-center gap-0.5">
                                  <CheckCircle2 className="w-3 h-3" /> Excluded from statistics
                                </span>
                              </div>
                            </div>
                          ))}
                        </>
                      )}

                      {/* Educational Policy Notice in Side Inspector */}
                      <div className="p-3 rounded-xl bg-[#F1F5EE]/80 dark:bg-[#182414] border border-[#71865A]/40 text-[11px] text-[#455436] dark:text-[#B2D898] flex items-start gap-2">
                        <Info className="w-3.5 h-3.5 text-[#71865A] dark:text-[#92B577] shrink-0 mt-0.5" />
                        <span>
                          Dates and time periods with no classes are automatically excluded from missing interval penalties.
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            /* ===================================================================
                AGENDA / LIST VIEW (Search, Filter, Table of All Activities)
            =================================================================== */
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              {/* RECURRING DAY CLOSURES ACTIVE BANNER */}
              {closedDays.length > 0 && (
                <div className="p-3.5 rounded-2xl bg-[#FDF3F3] dark:bg-[#331717] border border-[#E8BDBD] dark:border-[#5C2424] flex flex-wrap items-center justify-between gap-2.5 shadow-2xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <ShieldAlert className="w-5 h-5 text-[#A83232] dark:text-[#F5A3A3] shrink-0" />
                    <div>
                      <div className="text-xs font-bold text-[#A83232] dark:text-[#F5A3A3]">
                        Recurring Day Closures Active ({closedDays.length}): {closedDays.map((d) => DAY_OF_WEEK_NAMES[d]).join(', ')}
                      </div>
                      <div className="text-[11px] text-[#6E665E] dark:text-[#A6998C]">
                        All attendance data recorded on these days of the week is automatically excluded from statistical reports.
                      </div>
                    </div>
                  </div>
                  {isLibrarian && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {closedDays.map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => handleToggleWeekdayClosure(d, false)}
                          disabled={togglingDay !== null}
                          className="px-2.5 py-1 rounded-lg bg-[#2E5A44] hover:bg-[#244736] text-white text-[11px] font-bold inline-flex items-center gap-1 transition cursor-pointer shadow-2xs disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          Reopen {OPERATING_WEEKDAYS.find((w) => w.dayOfWeek === d)?.name || `Day ${d}`}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-full sm:w-60">
                    <Search className="w-3.5 h-3.5 text-[#6E665E] dark:text-[#A6998C] absolute left-3 top-2.5 pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search activities..."
                      className="w-full h-8 pl-8 pr-3 rounded-xl bg-white dark:bg-[#241F1A] border border-[#E6D7C3] dark:border-[#383028] text-xs text-[#332F2B] dark:text-[#F0E8DE] focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center gap-1 bg-[#FAF5EE] dark:bg-[#241F1A] p-1 rounded-xl border border-[#E6D7C3] dark:border-[#383028] text-xs">
                    {(['ALL', 'UPCOMING', 'WHOLE_DAY', 'TIME_RANGE'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setFilterType(t)}
                        className={`px-2.5 py-1 rounded-lg font-semibold text-[11px] transition cursor-pointer ${
                          filterType === t
                            ? 'bg-[#A83232] text-white shadow-2xs'
                            : 'text-[#6E665E] dark:text-[#A6998C] hover:text-[#332F2B]'
                        }`}
                      >
                        {t === 'ALL'
                          ? 'All'
                          : t === 'UPCOMING'
                          ? 'Upcoming'
                          : t === 'WHOLE_DAY'
                          ? 'Whole Day'
                          : 'Time Range'}
                      </button>
                    ))}
                  </div>
                </div>

                {isLibrarian && (
                  <button
                    type="button"
                    onClick={() => {
                      setDisplayMode('calendar');
                      const initialDate = isSundayDate(todayDate) ? '' : todayDate;
                      handleOpenCreateForm(initialDate);
                    }}
                    className="h-8 px-3.5 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Class Suspension</span>
                  </button>
                )}
              </div>

              {/* List of Entries */}
              <div className="space-y-2.5">
                {filteredActivities.length === 0 ? (
                  <div className="p-8 text-center rounded-2xl bg-[#FAF5EE] dark:bg-[#241F1A] border border-[#E6D7C3] dark:border-[#383028]">
                    <Calendar className="w-8 h-8 text-[#A6998C] mx-auto mb-2 opacity-50" />
                    <div className="text-sm font-heading font-bold text-[#332F2B] dark:text-[#F0E8DE]">
                      No activities match filter
                    </div>
                  </div>
                ) : (
                  filteredActivities.map((item) => {
                    const isSun = isSundayDate(item.date);
                    return (
                    <div
                      key={item.id}
                      className="p-4 rounded-2xl border bg-white dark:bg-[#221D19] border-[#E6D7C3] dark:border-[#383028] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs hover:shadow-xs transition"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-stat font-bold text-[#332F2B] dark:text-[#F0E8DE]">
                            {formatShortDate(item.date)} ({item.date})
                          </span>
                          {isSun && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#FAF5EE] dark:bg-[#2A231C] text-[#8C7F72] dark:text-[#A6998C] border border-[#E6D7C3] dark:border-[#383028]">
                              Sunday (Non-Working Day)
                            </span>
                          )}
                          {item.isWholeDay ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#FEF9EC] dark:bg-[#2C2210] text-[#7D5B06] dark:text-[#F5D075] border border-[#E7B84B]/50">
                              Whole Day — No Classes
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#F1F5EE] dark:bg-[#182414] text-[#455436] dark:text-[#B2D898] border border-[#71865A]/40 font-stat">
                              {formatActivityTimeRange(item)}
                            </span>
                          )}
                        </div>
                        <h4 className="text-sm font-heading font-bold text-[#332F2B] dark:text-[#F0E8DE]">
                          {item.title}
                        </h4>
                        {item.description && (
                          <p className="text-xs text-[#6E665E] dark:text-[#A6998C]">
                            {item.description}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDate(item.date);
                            const [y, m] = item.date.split('-').map(Number);
                            setViewYear(y);
                            setViewMonth(m - 1);
                            setDisplayMode('calendar');
                          }}
                          className="px-3 py-1.5 rounded-xl border border-[#D6C3A9] dark:border-[#42382F] bg-[#FAF5EE] dark:bg-[#25201A] text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] hover:bg-[#F5EBDD] cursor-pointer"
                        >
                          View in Calendar
                        </button>
                        {isLibrarian && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedDate(item.date);
                                const [y, m] = item.date.split('-').map(Number);
                                setViewYear(y);
                                setViewMonth(m - 1);
                                setDisplayMode('calendar');
                                handleOpenEditForm(item);
                              }}
                              className="p-1.5 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-white dark:bg-[#181411] text-[#332F2B] hover:text-[#A83232] cursor-pointer"
                              title="Edit"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={deletingId === item.id}
                              onClick={() => handleDeleteActivity(item)}
                              className="p-1.5 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-white dark:bg-[#181411] text-[#A83232] hover:bg-[#FDF3F3] cursor-pointer disabled:opacity-50"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* =====================================================================
            MODAL FOOTER: Summary Statistics & Close Button
        ===================================================================== */}
        <div className="px-4 sm:px-6 py-3 border-t border-[#E6D7C3] dark:border-[#383028] bg-[#FAF5EE]/70 dark:bg-[#171411] flex flex-wrap items-center justify-between gap-3 relative z-10">
          <div className="text-xs text-[#6E665E] dark:text-[#A6998C] flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-[#B88412] shrink-0" />
            <span>
              {activities.length} activity entries recorded · {activities.filter((a) => a.date >= todayDate).length} upcoming scheduled event(s)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-5 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-white dark:bg-[#1F1B17] hover:bg-[#FAF5EE] dark:hover:bg-[#28221D] text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] transition cursor-pointer shadow-2xs"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
