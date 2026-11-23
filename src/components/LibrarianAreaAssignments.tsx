import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  Radio,
  Search,
  Shield,
  User,
  Users,
  X,
} from 'lucide-react';
import { LibraryArea, MonitoringSession, ServerClock, UserProfile } from '../types/lirc';
import {
  CIRCULATION_AREA_ID,
  DayGroup,
  DAY_GROUPS,
  DAY_GROUP_LABELS,
  DutyScheduleAssignment,
  EXEMPT_DUTY_AREAS,
  formatTimeSlotLabel,
  getDayGroupForDate,
  isNonStatisticalArea,
  isScheduleMatchingDay,
  parseDutySchedulesFromProfile,
  parseStaffAccount,
} from '../utils/invitationWorkflow';
import { getLiteraryAreaColor } from '../utils/statistics';

export type ShiftDutyStatus = 'Active' | 'Upcoming' | 'Completed' | 'Scheduled' | 'Unassigned';

export interface AssignedAssistantDuty {
  assignment: DutyScheduleAssignment;
  status: ShiftDutyStatus;
  statusLabel: string;
  durationLabel: string;
  hasLiveSession: boolean;
  liveSessionUser?: string;
}

export interface DutyShiftBlock {
  id: string;
  label: string; // e.g. "Duty Shift"
  windowLabel: string; // e.g. "8:00 AM – 6:00 PM"
  windowHours: string; // e.g. "10 hrs"
  startTime: string; // e.g. "08:00"
  endTime: string; // e.g. "18:00"
  durationHours: number;
  status: ShiftDutyStatus;
  statusLabel: string;
  assistants: AssignedAssistantDuty[];
  assignment: DutyScheduleAssignment | null;
  hasLiveSession: boolean;
  liveSessionUser?: string;
}

export function formatDurationHours(startTime: string, endTime: string): string {
  const [sh, sm] = (startTime || '08:00').split(':').map(Number);
  const [eh, em] = (endTime || '13:00').split(':').map(Number);
  const startMins = sh * 60 + (sm || 0);
  const endMins = eh * 60 + (em || 0);
  const diffMins = Math.max(0, endMins - startMins);
  const hrs = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  if (mins === 0) return `${hrs} hr${hrs !== 1 ? 's' : ''}`;
  if (hrs === 0) return `${mins} mins`;
  return `${hrs}h ${mins}m`;
}

interface LibrarianAreaAssignmentsProps {
  areas: LibraryArea[];
  allAreas?: LibraryArea[];
  serverClock: ServerClock | null;
  todayDate: string;
  activeSessions: MonitoringSession[];
  staffProfiles: UserProfile[];
  onOpenDutyScheduleModal?: (studentId?: string) => void;
  onNavigateToArea?: (areaId: number) => void;
  onRefresh?: () => void;
}

export const LibrarianAreaAssignments: React.FC<LibrarianAreaAssignmentsProps> = ({
  areas,
  allAreas,
  serverClock,
  todayDate,
  activeSessions,
  staffProfiles,
  onOpenDutyScheduleModal,
  onNavigateToArea,
}) => {
  // Day group switcher: TODAY (dynamic based on clock) vs MWF vs TTh vs Saturday
  const [selectedDayGroupTab, setSelectedDayGroupTab] = useState<'TODAY' | DayGroup>('TODAY');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modal area view (opens when an area card is clicked)
  const [modalArea, setModalArea] = useState<LibraryArea | null>(null);

  // Determine current clock time
  const currentClockHHMM = useMemo(() => {
    if (serverClock?.detected_slot) {
      return serverClock.detected_slot;
    }
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
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }, [serverClock?.detected_slot, serverClock?.manila_timestamp]);

  // Determine today's day group from date (MWF, TTh, Saturday, or null if Sunday)
  const todayDayGroup = useMemo(() => getDayGroupForDate(todayDate), [todayDate]);
  const isSunday = todayDayGroup === null;

  // Active day group being viewed
  const effectiveDayGroup: DayGroup = useMemo(() => {
    if (selectedDayGroupTab === 'TODAY') {
      return todayDayGroup || 'Monday';
    }
    return selectedDayGroupTab;
  }, [selectedDayGroupTab, todayDayGroup]);

  const isViewingLiveToday = selectedDayGroupTab === 'TODAY' && !isSunday;

  // Extract all student assistant profiles and their duty schedules
  const allDutySchedules = useMemo(() => {
    const schedules: DutyScheduleAssignment[] = [];

    staffProfiles.forEach((profile) => {
      if (
        profile.shift_schedule === 'REMOVED' ||
        profile.full_name.startsWith('CALENDAR_ACTIVITY::') ||
        (profile.staff_code || '').startsWith('CAL_ACT::') ||
        (profile.username || '').startsWith('cal_')
      ) {
        return;
      }
      const parsed = parseStaffAccount(profile);
      if (parsed.approvalStatus === 'approved' && profile.role === 'student_assistant' && profile.is_active) {
        const parsedSchedules = parseDutySchedulesFromProfile(profile, parsed.displayStaffCode);
        parsedSchedules.forEach((s) => schedules.push(s));
      }
    });

    return schedules;
  }, [staffProfiles]);

  // Master list of all available library areas (Statistical reading halls + Service stations)
  const masterAreasList = useMemo(() => {
    const combined: LibraryArea[] = [];
    const seenIds = new Set<number>();

    // 1. Add all statistical areas
    const sortedStatistical = [...areas]
      .filter((a) => !isNonStatisticalArea(a.name) && a.id !== CIRCULATION_AREA_ID)
      .sort((a, b) => a.display_order - b.display_order)
      .map((a) => ({ ...a, color_hex: getLiteraryAreaColor(a.code, a.color_hex) }));

    sortedStatistical.forEach((a) => {
      if (!seenIds.has(a.id)) {
        seenIds.add(a.id);
        combined.push(a);
      }
    });

    // 2. Add exempt duty stations (Circulation, Baggage, Shelver, Technical, Entrance/Exit)
    EXEMPT_DUTY_AREAS.forEach((a) => {
      if (!seenIds.has(a.id)) {
        seenIds.add(a.id);
        combined.push(a);
      }
    });

    // 3. Add any additional areas passed via allAreas
    if (allAreas) {
      allAreas.forEach((a) => {
        if (!seenIds.has(a.id)) {
          seenIds.add(a.id);
          combined.push({
            ...a,
            color_hex: getLiteraryAreaColor(a.code, a.color_hex),
          });
        }
      });
    }

    return combined;
  }, [areas, allAreas]);

  // Filtered areas based on search input
  const filteredAreas = useMemo(() => {
    if (!searchQuery.trim()) return masterAreasList;
    const q = searchQuery.toLowerCase().trim();

    return masterAreasList.filter((area) => {
      const matchName = area.name.toLowerCase().includes(q) || area.code.toLowerCase().includes(q);
      const matchLocation = (area.floor_location || '').toLowerCase().includes(q);

      // Also search if any assigned student assistant in this area matches query
      const matchAssistant = allDutySchedules.some(
        (s) =>
          s.areaId === area.id &&
          isScheduleMatchingDay(s.dayGroup, effectiveDayGroup) &&
          (s.studentAssistantName.toLowerCase().includes(q) ||
            s.studentAssistantCode.toLowerCase().includes(q))
      );

      return matchName || matchLocation || matchAssistant;
    });
  }, [masterAreasList, searchQuery, allDutySchedules, effectiveDayGroup]);

  // Compute whole day duty hours (8:00 AM – 6:00 PM) for any specific area
  const getWholeDayScheduleForArea = (area: LibraryArea): {
    shifts: DutyShiftBlock[];
    totalHoursCovered: number;
    activeNowAssistants: AssignedAssistantDuty[];
    nextUpcomingAssistants: AssignedAssistantDuty[];
    activeNowAssistant: DutyScheduleAssignment | null;
    nextUpcomingAssistant: DutyScheduleAssignment | null;
    uniqueAssistants: DutyScheduleAssignment[];
  } => {
    // Standard library operating hours: 8:00 AM – 6:00 PM
    const matchingSchedules = allDutySchedules
      .filter((s) => s.areaId === area.id && isScheduleMatchingDay(s.dayGroup, effectiveDayGroup))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    const areaActiveSessions = activeSessions.filter((sess) => sess.area_id === area.id);

    // Helper to compute individual assistant status
    const resolveAssistantStatus = (
      sched: DutyScheduleAssignment,
      isLiveInArea: boolean
    ): { status: ShiftDutyStatus; label: string } => {
      if (isLiveInArea) {
        return { status: 'Active', label: 'Active On Duty' };
      }
      if (!isViewingLiveToday) {
        return { status: 'Scheduled', label: 'Scheduled' };
      }
      if (currentClockHHMM >= sched.startTime && currentClockHHMM < sched.endTime) {
        return { status: 'Active', label: 'Active On Duty' };
      }
      if (currentClockHHMM < sched.startTime) {
        return { status: 'Upcoming', label: `Starts at ${formatTimeSlotLabel(sched.startTime)}` };
      }
      return { status: 'Completed', label: 'Duty Completed' };
    };

    // Build all assigned duties for the area on this day
    const allDuties: AssignedAssistantDuty[] = matchingSchedules.map((s) => {
      const isLiveInArea = areaActiveSessions.some((sess) => sess.user_id === s.studentAssistantId);
      const st = resolveAssistantStatus(s, isLiveInArea);
      return {
        assignment: s,
        status: st.status,
        statusLabel: st.label,
        durationLabel: formatDurationHours(s.startTime, s.endTime),
        hasLiveSession: isLiveInArea,
        liveSessionUser: areaActiveSessions.find((sess) => sess.user_id === s.studentAssistantId)?.user_name,
      };
    });

    const resolveShiftStatus = (
      assistants: AssignedAssistantDuty[]
    ): { status: ShiftDutyStatus; label: string } => {
      if (assistants.length === 0) {
        return { status: 'Unassigned', label: 'No Assignment' };
      }
      if (!isViewingLiveToday) {
        return { status: 'Scheduled', label: 'Scheduled' };
      }
      if (assistants.some((a) => a.status === 'Active')) {
        return { status: 'Active', label: 'Active On Duty' };
      }
      if (assistants.some((a) => a.status === 'Upcoming')) {
        const firstUpcoming = assistants.find((a) => a.status === 'Upcoming');
        return {
          status: 'Upcoming',
          label: firstUpcoming?.statusLabel || 'Upcoming',
        };
      }
      if (assistants.every((a) => a.status === 'Completed')) {
        return { status: 'Completed', label: 'Duty Completed' };
      }
      return { status: 'Scheduled', label: 'Scheduled' };
    };

    const isSaturday = effectiveDayGroup === 'Saturday';
    const shiftStartTime = '08:00';
    const shiftEndTime = isSaturday ? '13:00' : '18:00';
    const shiftWindowLabel = isSaturday ? '8:00 AM – 1:00 PM' : '8:00 AM – 6:00 PM';
    const shiftWindowHours = isSaturday ? '5 hrs' : '10 hrs';
    const shiftDurationHours = isSaturday ? 5 : 10;

    const dutyShiftStatus = resolveShiftStatus(allDuties);

    // Combined single Duty Shift covering the day's duty hours
    const shifts: DutyShiftBlock[] = [
      {
        id: `${area.id}-duty-shift`,
        label: 'Duty Shift',
        windowLabel: shiftWindowLabel,
        windowHours: shiftWindowHours,
        startTime: shiftStartTime,
        endTime: shiftEndTime,
        durationHours: shiftDurationHours,
        status: dutyShiftStatus.status,
        statusLabel: dutyShiftStatus.label,
        assistants: allDuties,
        assignment: allDuties[0]?.assignment || null,
        hasLiveSession: allDuties.some((a) => a.hasLiveSession),
        liveSessionUser: allDuties.find((a) => a.hasLiveSession)?.liveSessionUser,
      },
    ];

    // Compute total covered hours
    let totalCovered = 0;
    matchingSchedules.forEach((s) => {
      const [sh, sm] = (s.startTime || '08:00').split(':').map(Number);
      const [eh, em] = (s.endTime || '13:00').split(':').map(Number);
      const startMins = sh * 60 + (sm || 0);
      const endMins = eh * 60 + (em || 0);
      const diff = Math.max(0, endMins - startMins);
      totalCovered += Math.round((diff / 60) * 10) / 10;
    });

    const allAssistants = allDuties;
    const activeNowAssistants = allAssistants.filter((a) => a.status === 'Active');
    const nextUpcomingAssistants = allAssistants.filter((a) => a.status === 'Upcoming');

    const uniqueAssistantsMap = new Map<string, DutyScheduleAssignment>();
    matchingSchedules.forEach((s) => {
      uniqueAssistantsMap.set(s.studentAssistantId, s);
    });
    const uniqueAssistants = Array.from(uniqueAssistantsMap.values());

    return {
      shifts,
      totalHoursCovered: totalCovered,
      activeNowAssistants,
      nextUpcomingAssistants,
      activeNowAssistant: activeNowAssistants[0]?.assignment || null,
      nextUpcomingAssistant: nextUpcomingAssistants[0]?.assignment || null,
      uniqueAssistants,
    };
  };

  // Navigate next/prev area in modal
  const handleNavigateModalArea = (direction: 'next' | 'prev') => {
    if (!modalArea) return;
    const currentIndex = masterAreasList.findIndex((a) => a.id === modalArea.id);
    if (currentIndex === -1) return;

    let nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex >= masterAreasList.length) nextIndex = 0;
    if (nextIndex < 0) nextIndex = masterAreasList.length - 1;

    const target = masterAreasList[nextIndex];
    setModalArea(target);
  };

  return (
    <div className="space-y-6 animate-literary-fade pb-12">
      {/* ===================================================================
          1. HEADER & SIMPLE DAY SELECTOR
      =================================================================== */}
      <div className="bg-[#FAF6F0] dark:bg-[#1A1613] p-5 md:p-6 rounded-2xl border border-[#E6D7C3] dark:border-[#383028] shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-stat font-semibold tracking-wide bg-[#A83232]/10 text-[#A83232] border border-[#A83232]/20 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#A83232] animate-pulse" />
                Live Area Schedule Directory
              </span>
              <span className="text-xs text-[#8B7355] dark:text-[#A89887]">
                Current Time: <strong className="text-[#332F2B] dark:text-[#F0E8DE] font-stat">{formatTimeSlotLabel(currentClockHHMM)}</strong>
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-serif font-bold text-[#332F2B] dark:text-[#F0E8DE]">
              Area Assignments & Duty Hours
            </h1>
            <p className="text-xs md:text-sm text-[#8B7355] dark:text-[#A89887] mt-0.5">
              Click any library area below to instantly see the whole day duty hours and who is assigned.
            </p>
          </div>

          {/* Quick Schedule Management Action */}
          {onOpenDutyScheduleModal && (
            <button
              type="button"
              onClick={() => onOpenDutyScheduleModal()}
              className="px-4 py-2 rounded-xl bg-[#A83232] hover:bg-[#8F2626] text-white text-xs font-semibold shadow-xs hover:shadow transition flex items-center gap-2 cursor-pointer self-start md:self-auto shrink-0"
            >
              <Calendar className="w-4 h-4" />
              <span>Manage Duty Schedules</span>
            </button>
          )}
        </div>

        {/* Day Group Switcher Tabs */}
        <div className="mt-5 pt-4 border-t border-[#E6D7C3] dark:border-[#383028] flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-[#F5EBDD] dark:bg-[#25201B] border border-[#E6D7C3] dark:border-[#383028]">
            <button
              type="button"
              onClick={() => setSelectedDayGroupTab('TODAY')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition flex items-center gap-1.5 ${
                selectedDayGroupTab === 'TODAY'
                  ? 'bg-white dark:bg-[#1A1613] text-[#A83232] shadow-xs'
                  : 'text-[#8B7355] dark:text-[#A89887] hover:text-[#332F2B] dark:hover:text-[#F0E8DE]'
              }`}
            >
              <Radio className="w-3.5 h-3.5 text-[#A83232]" />
              <span>Today (Live: {todayDayGroup ? todayDayGroup : 'Sunday Closed'})</span>
            </button>

            {DAY_GROUPS.map((day) => (
              <button
                key={day}
                type="button"
                onClick={() => setSelectedDayGroupTab(day)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition flex items-center gap-1.5 ${
                  selectedDayGroupTab === day
                    ? 'bg-white dark:bg-[#1A1613] text-[#A83232] shadow-xs'
                    : 'text-[#8B7355] dark:text-[#A89887] hover:text-[#332F2B] dark:hover:text-[#F0E8DE]'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>{day}</span>
              </button>
            ))}
          </div>

          {/* Quick Search Input */}
          <div className="relative min-w-[240px]">
            <Search className="w-3.5 h-3.5 text-[#8B7355] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search area or assistant name..."
              className="w-full pl-8 pr-7 py-1.5 rounded-xl text-xs bg-white dark:bg-[#25201B] border border-[#E6D7C3] dark:border-[#383028] text-[#332F2B] dark:text-[#F0E8DE] placeholder-[#8B7355]/60 focus:outline-hidden focus:ring-1 focus:ring-[#A83232]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[#8B7355] hover:text-[#332F2B]"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Sunday Warning Alert if today is Sunday */}
        {isSunday && selectedDayGroupTab === 'TODAY' && (
          <div className="mt-4 p-3 rounded-xl bg-[#FDF8E8] dark:bg-[#2A2315] border border-[#E7B84B]/40 text-[#7D5B06] dark:text-[#E7B84B] flex items-center gap-3 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#B8860B]" />
            <div>
              <strong>Library Closed Today (Sunday):</strong> Regular student assistant duty monitoring is closed on Sundays. Previewing the standard <strong>Monday-Wednesday-Friday (MWF)</strong> duty schedule below.
            </div>
          </div>
        )}
      </div>

      {/* ===================================================================
          2. CLICKABLE AREAS GRID (CLICK AN AREA TO VIEW WHOLE DAY DUTY)
      =================================================================== */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#8B7355] dark:text-[#A89887]">
            Select an Area to View Duty Hours ({filteredAreas.length} Areas Available)
          </h2>
          <span className="text-xs text-[#8B7355] italic">
            Click any area card to view full day duty hours
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
          {filteredAreas.map((area) => {
            const isSelected = modalArea?.id === area.id;
            const scheduleInfo = getWholeDayScheduleForArea(area);
            const colorHex = area.color_hex || getLiteraryAreaColor(area.code);
            const isStatistical = !isNonStatisticalArea(area.id) && !isNonStatisticalArea(area.name);

            // Determine primary status label
            let statusText = 'No Assignment';
            let statusBadgeClass =
              'bg-[#FAF6F0] dark:bg-[#25201B] text-[#8B7355] border-[#E6D7C3] dark:border-[#383028]';

            if (scheduleInfo.activeNowAssistants.length > 1) {
              statusText = `${scheduleInfo.activeNowAssistants.length} On Duty`;
              statusBadgeClass = 'bg-[#E6EFE0] text-[#3B4D29] border-[#C5D3B8]';
            } else if (scheduleInfo.activeNowAssistants.length === 1) {
              statusText = `On Duty: ${scheduleInfo.activeNowAssistants[0].assignment.studentAssistantName.split(' ')[0]}`;
              statusBadgeClass = 'bg-[#E6EFE0] text-[#3B4D29] border-[#C5D3B8]';
            } else if (scheduleInfo.nextUpcomingAssistants.length > 0) {
              statusText = `Next: ${scheduleInfo.nextUpcomingAssistants[0].assignment.studentAssistantName.split(' ')[0]}`;
              statusBadgeClass = 'bg-[#FAF0D4] text-[#7D5B06] border-[#E7B84B]/40';
            } else if (scheduleInfo.uniqueAssistants.length > 0) {
              statusText = `${scheduleInfo.uniqueAssistants.length} Assigned`;
              statusBadgeClass = 'bg-[#FAF6F0] text-[#332F2B] border-[#E6D7C3]';
            }

            return (
              <div
                key={`area-card-${area.id}`}
                onClick={() => setModalArea(area)}
                className={`relative overflow-hidden p-4 pt-5 rounded-2xl border text-left cursor-pointer transition-all flex flex-col justify-between group ${
                  isSelected
                    ? 'bg-white dark:bg-[#1E1915] border-[#A83232] shadow-md ring-2 ring-[#A83232]/20'
                    : 'bg-white dark:bg-[#1A1613] border-[#E6D7C3] dark:border-[#383028] hover:border-[#A83232]/60 hover:shadow-sm'
                }`}
              >
                {/* Top Color Accent Bar */}
                <div
                  className="h-2 w-full absolute top-0 left-0 transition-all duration-300 group-hover:h-2.5"
                  style={{ backgroundColor: colorHex }}
                />

                <div>
                  {/* Top: Status Pill */}
                  <div className="flex items-center justify-end gap-2 mb-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border flex items-center gap-1 ${statusBadgeClass}`}
                    >
                      {scheduleInfo.activeNowAssistants.length > 0 && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#71865A] animate-pulse" />
                      )}
                      <span className="truncate max-w-[140px]">{statusText}</span>
                    </span>
                  </div>

                  {/* Centered & Larger Area Name */}
                  <div className="my-3 text-center">
                    <h3 className="text-lg sm:text-xl font-serif font-bold text-[#332F2B] dark:text-[#F0E8DE] group-hover:text-[#A83232] transition-colors leading-snug">
                      {area.name}
                    </h3>
                  </div>
                </div>

                {/* Bottom: Quick Duty Summary & Click Indicator */}
                <div className="mt-3.5 pt-2.5 border-t border-[#E6D7C3]/60 dark:border-[#383028]/60 flex items-center justify-between text-xs">
                  <span className="text-[11px] text-[#8B7355]">
                    {isStatistical ? `${area.capacity} seats` : 'Duty Station'}
                  </span>
                  <span className="text-[11px] font-semibold text-[#A83232] group-hover:underline flex items-center gap-0.5">
                    <span>View Duty Hours</span>
                    <span>→</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ===================================================================
          WHOLE DAY DUTY HOURS MODAL (OPENS ON AREA CLICK)
      =================================================================== */}
      {modalArea &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs animate-literary-fade"
            onClick={() => setModalArea(null)}
          >
            <div
              className="bg-[#FAF6F0] dark:bg-[#1A1613] w-full max-w-2xl rounded-3xl border border-[#E6D7C3] dark:border-[#383028] shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-pop-in"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Accent Strip */}
              <div
                className="h-2 w-full"
                style={{ backgroundColor: modalArea.color_hex || getLiteraryAreaColor(modalArea.code) }}
              />

              {/* Modal Header */}
              <div className="p-5 sm:p-6 border-b border-[#E6D7C3] dark:border-[#383028] bg-white dark:bg-[#1E1915] flex items-center justify-between">
                <div className="flex items-center gap-3.5">
                  <div
                    className="w-11 h-11 rounded-2xl flex items-center justify-center text-white shadow-sm shrink-0"
                    style={{ backgroundColor: modalArea.color_hex || getLiteraryAreaColor(modalArea.code) }}
                  >
                    <Clock className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-serif font-bold text-[#332F2B] dark:text-[#F0E8DE]">
                        {modalArea.name}
                      </h2>
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-[#FAF6F0] dark:bg-[#25201B] text-[#A83232] border border-[#E6D7C3] dark:border-[#383028]">
                        {effectiveDayGroup} Schedule
                      </span>
                    </div>
                    <div className="text-xs text-[#8B7355] mt-0.5">
                      <span>
                        {!isNonStatisticalArea(modalArea.id)
                          ? `Capacity: ${modalArea.capacity} students`
                          : 'Library Service Station'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Close Button */}
                <button
                  type="button"
                  onClick={() => setModalArea(null)}
                  className="p-2 rounded-xl text-[#8B7355] hover:text-[#332F2B] dark:hover:text-[#F0E8DE] hover:bg-[#F5EBDD] dark:hover:bg-[#25201B] transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Body: Scrollable whole day schedule */}
              <div className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1">
                {/* Operating Hours Summary */}
                <div className="p-3.5 rounded-xl bg-white dark:bg-[#201B17] border border-[#E6D7C3] dark:border-[#383028] flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2 text-xs">
                    <Clock className="w-4 h-4 text-[#A83232]" />
                    <span className="font-semibold text-[#332F2B] dark:text-[#F0E8DE]">
                      Full Day Duty: {effectiveDayGroup === 'Saturday' ? '8:00 AM – 1:00 PM' : '8:00 AM – 6:00 PM'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-[#8B7355]">
                      Rotation: <strong>{effectiveDayGroup}</strong>
                    </span>
                    <span className="text-[#8B7355]">•</span>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#FAF6F0] dark:bg-[#25201B] text-[#A83232] border border-[#E6D7C3] dark:border-[#383028]">
                      {(() => {
                        const sched = getWholeDayScheduleForArea(modalArea);
                        const count = sched.uniqueAssistants.length;
                        return count === 0
                          ? 'No Assistants Assigned'
                          : `${count} Student Assistant${count > 1 ? 's' : ''} Assigned`;
                      })()}
                    </span>
                  </div>
                </div>

                {/* The Shifts */}
                {(() => {
                  const schedule = getWholeDayScheduleForArea(modalArea);

                  return (
                    <div className="space-y-4">
                      {schedule.shifts.map((shift) => {
                        return (
                          <div
                            key={shift.id}
                            className={`p-4 sm:p-5 rounded-2xl border transition-all ${
                              shift.status === 'Active'
                                ? 'bg-[#F1F5EE] dark:bg-[#1D2A1C] border-[#C5D3B8] dark:border-[#2E5A44] shadow-xs'
                                : shift.status === 'Upcoming'
                                ? 'bg-[#FDFBF7] dark:bg-[#25201A] border-[#E7B84B]/40'
                                : 'bg-white dark:bg-[#201B17] border-[#E6D7C3] dark:border-[#383028]'
                            }`}
                          >
                            {/* Shift Header */}
                            <div className="flex items-center justify-between pb-3 border-b border-[#E6D7C3]/60 dark:border-[#383028]/60">
                              <div>
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7355]">
                                  {shift.label}
                                </span>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <Clock className="w-3.5 h-3.5 text-[#A83232]" />
                                  <strong className="text-sm font-stat text-[#332F2B] dark:text-[#F0E8DE]">
                                    {shift.windowLabel}
                                  </strong>
                                  <span className="text-xs text-[#8B7355]">({shift.windowHours})</span>
                                </div>
                              </div>

                              <div>
                                {shift.status === 'Active' && (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#E6EFE0] text-[#3B4D29] border border-[#C5D3B8]">
                                    <span className="w-2 h-2 rounded-full bg-[#71865A] animate-pulse" />
                                    Active On Duty
                                    {shift.assistants.filter((a) => a.status === 'Active').length > 1
                                      ? ` (${shift.assistants.filter((a) => a.status === 'Active').length})`
                                      : ''}
                                  </span>
                                )}

                                {shift.status === 'Upcoming' && (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#FAF0D4] text-[#7D5B06] border border-[#E7B84B]/40">
                                    <Clock className="w-3 h-3 text-[#B8860B]" />
                                    Upcoming
                                  </span>
                                )}

                                {shift.status === 'Completed' && (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#FAF6F0] dark:bg-[#25201B] text-[#8B7355] border border-[#E6D7C3]">
                                    Completed
                                  </span>
                                )}

                                {shift.status === 'Scheduled' && (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#F5EBDD] text-[#332F2B]">
                                    Scheduled
                                  </span>
                                )}

                                {shift.status === 'Unassigned' && (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#FAF6F0] text-[#8B7355] border border-[#E6D7C3]">
                                    Unassigned
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Assistants Details: supports MULTIPLE assistants */}
                            <div className="pt-3.5 space-y-3">
                              {shift.assistants.length > 0 ? (
                                <div className="space-y-3">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-[#8B7355] uppercase tracking-wider font-semibold">
                                      {shift.assistants.length === 1
                                        ? 'Assigned Student Assistant'
                                        : `Assigned Student Assistants (${shift.assistants.length})`}
                                    </span>
                                    {onOpenDutyScheduleModal && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setModalArea(null);
                                          onOpenDutyScheduleModal();
                                        }}
                                        className="text-[11px] font-semibold text-[#A83232] hover:underline inline-flex items-center gap-1 cursor-pointer"
                                      >
                                        <Plus className="w-3 h-3" />
                                        <span>Assign Another Assistant</span>
                                      </button>
                                    )}
                                  </div>

                                  {shift.assistants.map((ast, astIdx) => {
                                    const s = ast.assignment;
                                    const initials = s.studentAssistantName
                                      .split(' ')
                                      .map((n) => n[0])
                                      .slice(0, 2)
                                      .join('')
                                      .toUpperCase();

                                    return (
                                      <div
                                        key={s.id || `ast-${astIdx}`}
                                        className="p-3.5 rounded-xl bg-white/95 dark:bg-[#1E1914] border border-[#E6D7C3] dark:border-[#383028] shadow-2xs space-y-2.5"
                                      >
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                                          <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-[#A83232]/10 text-[#A83232] border border-[#A83232]/30 flex items-center justify-center font-serif font-bold text-xs shrink-0">
                                              {initials}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                              <h4 className="text-sm sm:text-base font-semibold text-[#332F2B] dark:text-[#F0E8DE] truncate">
                                                {s.studentAssistantName}
                                              </h4>
                                              <p className="text-xs text-[#8B7355] font-stat">
                                                {s.studentAssistantCode}
                                              </p>
                                            </div>
                                          </div>

                                          {/* Time and Individual Status Badge */}
                                          <div className="flex items-center gap-2 self-start sm:self-auto">
                                            <div className="text-xs font-stat text-[#332F2B] dark:text-[#F0E8DE] bg-[#FAF6F0] dark:bg-[#25201B] px-2.5 py-1 rounded-lg border border-[#E6D7C3] dark:border-[#383028] flex items-center gap-1.5">
                                              <Clock className="w-3 h-3 text-[#A83232]" />
                                              <span>
                                                {formatTimeSlotLabel(s.startTime)} – {formatTimeSlotLabel(s.endTime)}
                                              </span>
                                              <span className="text-[#8B7355] text-[11px]">
                                                ({ast.durationLabel})
                                              </span>
                                            </div>

                                            {ast.status === 'Active' && (
                                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E6EFE0] text-[#3B4D29] border border-[#C5D3B8] shrink-0">
                                                Active
                                              </span>
                                            )}
                                            {ast.status === 'Upcoming' && (
                                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FAF0D4] text-[#7D5B06] border border-[#E7B84B]/40 shrink-0">
                                                Upcoming
                                              </span>
                                            )}
                                            {ast.status === 'Completed' && (
                                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FAF6F0] text-[#8B7355] border border-[#E6D7C3] shrink-0">
                                                Completed
                                              </span>
                                            )}
                                            {ast.status === 'Scheduled' && (
                                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#F5EBDD] text-[#332F2B] shrink-0">
                                                Scheduled
                                              </span>
                                            )}
                                          </div>
                                        </div>

                                        {/* Live monitoring indicator if assistant has active session */}
                                        {ast.hasLiveSession && (
                                          <div className="p-2 rounded-lg bg-[#E6EFE0] border border-[#C5D3B8] flex items-center justify-between text-xs text-[#3B4D29]">
                                            <div className="flex items-center gap-1.5">
                                              <Radio className="w-3.5 h-3.5 text-[#71865A] animate-pulse" />
                                              <span className="font-semibold">Live Monitoring Active</span>
                                            </div>
                                            <span className="text-[11px] opacity-80">Present in Area</span>
                                          </div>
                                        )}

                                        {s.notes && (
                                          <p className="text-xs text-[#8B7355] italic bg-[#FAF6F0]/60 dark:bg-[#1A1613] px-2.5 py-1 rounded-md border border-[#E6D7C3]/50">
                                            "{s.notes}"
                                          </p>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="py-4 text-center">
                                  <User className="w-7 h-7 text-[#8B7355]/40 mx-auto mb-1" />
                                  <h4 className="text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE]">
                                    No Student Assistant Assigned
                                  </h4>
                                  <p className="text-[11px] text-[#8B7355] mt-0.5">
                                    No assistant is scheduled for this duty shift on {effectiveDayGroup}.
                                  </p>
                                  {onOpenDutyScheduleModal && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setModalArea(null);
                                        onOpenDutyScheduleModal();
                                      }}
                                      className="mt-2.5 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#A83232] text-white hover:bg-[#8F2626] transition cursor-pointer"
                                    >
                                      <Plus className="w-3.5 h-3.5" />
                                      <span>Assign Assistant</span>
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {/* Modal Footer: Prev / Next Area Navigation */}
              <div className="p-4 sm:p-5 border-t border-[#E6D7C3] dark:border-[#383028] bg-white dark:bg-[#1E1915] flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => handleNavigateModalArea('prev')}
                  className="px-3 py-1.5 rounded-xl border border-[#D6C3A9] dark:border-[#383028] bg-[#FAF6F0] dark:bg-[#25201B] hover:bg-[#F5EBDD] text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] transition flex items-center gap-1 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Previous Area</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleNavigateModalArea('next')}
                  className="px-3 py-1.5 rounded-xl border border-[#D6C3A9] dark:border-[#383028] bg-[#FAF6F0] dark:bg-[#25201B] hover:bg-[#F5EBDD] text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] transition flex items-center gap-1 cursor-pointer"
                >
                  <span>Next Area</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
