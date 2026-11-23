import { LIBRARY_TIME_SLOTS, LibraryArea, UserProfile } from '../types/lirc';
import { getTimeSlotsFromCache } from './timeSlots';
import { formatShortDate } from './statistics';

export const BAGGAGE_AREA_ID = 0;
export const SHELVER_AREA_ID = -1;
export const TECHNICAL_AREA_ID = -2;
export const ENTRANCE_EXIT_AREA_ID = -3;
export const CIRCULATION_AREA_ID = -4;

export const CIRCULATION_DUTY_AREA: LibraryArea = {
  id: CIRCULATION_AREA_ID,
  code: 'CIR',
  slug: 'circulation',
  name: 'Circulation',
  description: 'Circulation desk & book lending duty station — student population statistics not required.',
  floor_location: '1st Floor, Main Hall',
  capacity: 0,
  color_hex: '#71865A',
  icon_name: 'Library',
  display_order: 96,
  is_active: true,
};

export const BAGGAGE_DUTY_AREA: LibraryArea = {
  id: BAGGAGE_AREA_ID,
  code: 'BAG',
  slug: 'baggage',
  name: 'Baggage',
  description: 'Baggage counter duty station — student population statistics not required.',
  floor_location: 'Main Entrance / Ground Floor',
  capacity: 0,
  color_hex: '#7D5B06',
  icon_name: 'Briefcase',
  display_order: 97,
  is_active: true,
};

export const SHELVER_DUTY_AREA: LibraryArea = {
  id: SHELVER_AREA_ID,
  code: 'SHL',
  slug: 'shelver',
  name: 'Shelver',
  description: 'Book shelving & stack maintenance duty station — student population statistics not required.',
  floor_location: 'Library Stacks & Book Ranges',
  capacity: 0,
  color_hex: '#4B6B94',
  icon_name: 'BookOpen',
  display_order: 98,
  is_active: true,
};

export const TECHNICAL_DUTY_AREA: LibraryArea = {
  id: TECHNICAL_AREA_ID,
  code: 'TECH',
  slug: 'technical',
  name: 'Technical',
  description: 'Technical services, cataloging & book processing duty station — student population statistics not required.',
  floor_location: 'Technical Services / Cataloging Workroom',
  capacity: 0,
  color_hex: '#5C6B73',
  icon_name: 'Cpu',
  display_order: 99,
  is_active: true,
};

export const ENTRANCE_EXIT_DUTY_AREA: LibraryArea = {
  id: ENTRANCE_EXIT_AREA_ID,
  code: 'ENT',
  slug: 'entrance-exit',
  name: 'Entrance/Exit',
  description: 'Library Entrance & Exit monitoring duty station — student population statistics not required.',
  floor_location: 'Main Lobby / Turnstiles Gate',
  capacity: 0,
  color_hex: '#8A5A44',
  icon_name: 'DoorOpen',
  display_order: 100,
  is_active: true,
};

export const EXEMPT_DUTY_AREAS: LibraryArea[] = [
  CIRCULATION_DUTY_AREA,
  BAGGAGE_DUTY_AREA,
  SHELVER_DUTY_AREA,
  TECHNICAL_DUTY_AREA,
  ENTRANCE_EXIT_DUTY_AREA,
];

export function isNonStatisticalArea(areaIdOrName: number | string): boolean {
  if (typeof areaIdOrName === 'number') {
    return (
      areaIdOrName === CIRCULATION_AREA_ID ||
      areaIdOrName === BAGGAGE_AREA_ID ||
      areaIdOrName === SHELVER_AREA_ID ||
      areaIdOrName === TECHNICAL_AREA_ID ||
      areaIdOrName === ENTRANCE_EXIT_AREA_ID ||
      areaIdOrName <= 0
    );
  }
  const lower = (areaIdOrName || '').trim().toLowerCase();
  return (
    lower.includes('circulation') ||
    lower.includes('baggage') ||
    lower.includes('shelver') ||
    lower.includes('technical') ||
    lower.includes('entrance') ||
    lower.includes('exit') ||
    lower.includes('entrance/exit')
  );
}

export function isBaggageArea(areaIdOrName: number | string): boolean {
  return isNonStatisticalArea(areaIdOrName);
}

export function doesAreaRequireStatistics(areaId: number, areaName: string): boolean {
  if (isNonStatisticalArea(areaId) || isNonStatisticalArea(areaName)) {
    return false;
  }
  return true;
}

export type DayOfWeekSchedule =
  | 'Monday'
  | 'Tuesday'
  | 'Wednesday'
  | 'Thursday'
  | 'Friday'
  | 'Saturday';

export type DayGroup = DayOfWeekSchedule | 'MWF' | 'TTh';

export const DAY_GROUPS: DayGroup[] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export const DAY_GROUP_LABELS: Record<
  DayGroup,
  { label: string; subLabel: string; shortDays: string; days: string[] }
> = {
  Monday: {
    label: 'Monday Schedule',
    subLabel: 'Every Monday',
    shortDays: 'Mon',
    days: ['Monday'],
  },
  Tuesday: {
    label: 'Tuesday Schedule',
    subLabel: 'Every Tuesday',
    shortDays: 'Tue',
    days: ['Tuesday'],
  },
  Wednesday: {
    label: 'Wednesday Schedule',
    subLabel: 'Every Wednesday',
    shortDays: 'Wed',
    days: ['Wednesday'],
  },
  Thursday: {
    label: 'Thursday Schedule',
    subLabel: 'Every Thursday',
    shortDays: 'Thu',
    days: ['Thursday'],
  },
  Friday: {
    label: 'Friday Schedule',
    subLabel: 'Every Friday',
    shortDays: 'Fri',
    days: ['Friday'],
  },
  Saturday: {
    label: 'Saturday Schedule',
    subLabel: 'Every Saturday',
    shortDays: 'Sat',
    days: ['Saturday'],
  },
  MWF: {
    label: 'MWF Schedule',
    subLabel: 'Monday, Wednesday, Friday',
    shortDays: 'Mon / Wed / Fri',
    days: ['Monday', 'Wednesday', 'Friday'],
  },
  TTh: {
    label: 'TTh Schedule',
    subLabel: 'Tuesday, Thursday',
    shortDays: 'Tue / Thu',
    days: ['Tuesday', 'Thursday'],
  },
};

export const DAY_GROUP_ORDER: Record<DayGroup, number> = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  MWF: 7,
  TTh: 8,
};

export function getDayGroupForDate(dateStr: string): DayGroup | null {
  const [y, m, d] = (dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay(); // 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
  if (day === 1) return 'Monday';
  if (day === 2) return 'Tuesday';
  if (day === 3) return 'Wednesday';
  if (day === 4) return 'Thursday';
  if (day === 5) return 'Friday';
  if (day === 6) return 'Saturday';
  return null;
}

/**
 * Check if a schedule's day group matches a target day, supporting both
 * individual days and backward-compatible legacy MWF / TTh groupings.
 */
export function isScheduleMatchingDay(
  scheduleDay: DayGroup | string | null | undefined,
  targetDay: DayGroup | string | null | undefined
): boolean {
  if (!scheduleDay || !targetDay) return false;
  if (scheduleDay === targetDay) return true;

  if (scheduleDay === 'MWF') {
    return (
      targetDay === 'Monday' ||
      targetDay === 'Wednesday' ||
      targetDay === 'Friday' ||
      targetDay === 'MWF'
    );
  }
  if (scheduleDay === 'TTh') {
    return (
      targetDay === 'Tuesday' ||
      targetDay === 'Thursday' ||
      targetDay === 'TTh'
    );
  }
  if (targetDay === 'MWF') {
    return (
      scheduleDay === 'Monday' ||
      scheduleDay === 'Wednesday' ||
      scheduleDay === 'Friday'
    );
  }
  if (targetDay === 'TTh') {
    return (
      scheduleDay === 'Tuesday' ||
      scheduleDay === 'Thursday'
    );
  }

  return false;
}

export function getDayNameForDate(dateStr: string): string {
  const [y, m, d] = (dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(y, m - 1, d);
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return names[dt.getDay()] || '';
}

export interface InvitationCodeRecord {
  id: string;
  code: string;
  label: string;
  createdAt: string;
  createdBy: string;
  isActive: boolean;
}

export type RegistrationApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface DutyScheduleAssignment {
  id: string;
  studentAssistantId: string;
  studentAssistantName: string;
  studentAssistantUsername: string;
  studentAssistantCode: string;
  areaId: number;
  areaName: string;
  requiresStatistics: boolean;
  dayGroup: DayGroup; // 'MWF' | 'TTh' | 'Saturday'
  dutyDate?: string; // Optional legacy YYYY-MM-DD or resolved date
  startTime: string; // HH:mm (e.g. "08:00")
  endTime: string; // HH:mm (e.g. "10:00")
  notes: string;
  updatedAt: string; // ISO timestamp
  updatedBy: string; // Librarian full name
}

export interface ParsedStaffAccount {
  profile: UserProfile;
  isInviteCarrier: boolean;
  isCalendarCarrier?: boolean;
  isRemoved: boolean;
  isRegistrationRequest: boolean;
  approvalStatus: RegistrationApprovalStatus;
  displayStaffCode: string;
  inviteCode: string | null;
  courseDepartment: string;
  dutySchedules: DutyScheduleAssignment[];
  scheduleSummary: string;
}

const INVITE_PREFIX = 'INVITE_CODE::';
const PENDING_PREFIX = 'PENDING_REQ::';
const APPROVED_PREFIX = 'APPROVED_REQ::';
const REJECTED_PREFIX = 'REJECTED_REQ::';
const DUTY_SCHEDULES_PREFIX = 'DUTY_SCHEDULES_JSON::';

export function formatTimeSlotLabel(hhmm: string): string {
  const slots = getTimeSlotsFromCache();
  const found = slots.find((s) => s.value === hhmm) || LIBRARY_TIME_SLOTS.find((s) => s.value === hhmm);
  if (found) return found.label;
  const [hStr, mStr] = (hhmm || '').split(':');
  const h = Number(hStr);
  const m = Number(mStr || 0);
  if (Number.isNaN(h)) return hhmm;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export function formatTimeSlotRange(hhmm: string): string {
  const slots = getTimeSlotsFromCache();
  const found = slots.find((s) => s.value === hhmm) || LIBRARY_TIME_SLOTS.find((s) => s.value === hhmm);
  if (found) return found.rangeLabel;
  return formatTimeSlotLabel(hhmm);
}

export function generateRandomInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `LIRC-${suffix}`;
}

export function encodeInviteCodeCarrier(params: {
  code: string;
  label: string;
  createdBy: string;
}) {
  const cleanCode = params.code.trim().toUpperCase();
  const cleanLabel = (params.label.trim() || 'Student Assistant Registration').replace(/\|/g, '-');
  const createdAt = new Date().toISOString();
  const cleanCreator = (params.createdBy.trim() || 'Librarian').replace(/\|/g, '-');

  return {
    full_name: `${INVITE_PREFIX}${cleanCode}`,
    staff_code: `${cleanCode}|${cleanLabel}|${createdAt}|${cleanCreator}`,
    shift_schedule: 'INVITE_CODE',
  };
}

export function parseInviteCodeCarrier(row: {
  id: string;
  full_name: string;
  staff_code: string;
  shift_schedule: string;
  is_active?: boolean;
}): InvitationCodeRecord | null {
  if (row.shift_schedule !== 'INVITE_CODE' && !row.full_name.startsWith(INVITE_PREFIX)) {
    return null;
  }
  const parts = (row.staff_code || '').split('|');
  const code = (parts[0] || row.full_name.replace(INVITE_PREFIX, '') || '').trim().toUpperCase();

  if (!code) return null;

  return {
    id: row.id,
    code,
    label: parts[1] || 'Student Assistant Registration',
    createdAt: parts[2] || new Date().toISOString(),
    createdBy: parts[3] || 'Librarian',
    isActive: row.is_active !== false,
  };
}

export function encodeRegistrationStaffCode(params: {
  status: RegistrationApprovalStatus;
  studentId: string;
  inviteCode: string;
  courseDepartment: string;
}): string {
  const prefix =
    params.status === 'pending'
      ? PENDING_PREFIX
      : params.status === 'rejected'
      ? REJECTED_PREFIX
      : APPROVED_PREFIX;

  const cleanId = (params.studentId.trim() || 'SA-2026').replace(/::/g, '-');
  const cleanCode = params.inviteCode.trim().toUpperCase().replace(/::/g, '-');
  const cleanCourse = (params.courseDepartment.trim() || 'Student Assistant').replace(/::/g, '-');

  return `${prefix}${cleanId}::${cleanCode}::${cleanCourse}`;
}

export function encodeDutySchedulesToShiftColumn(schedules: DutyScheduleAssignment[]): string {
  const sorted = [...schedules].sort((a, b) => {
    if (a.dayGroup !== b.dayGroup) {
      return (DAY_GROUP_ORDER[a.dayGroup] || 99) - (DAY_GROUP_ORDER[b.dayGroup] || 99);
    }
    return a.startTime.localeCompare(b.startTime);
  });
  return `${DUTY_SCHEDULES_PREFIX}${JSON.stringify(sorted)}`;
}

export function parseDutySchedulesFromProfile(
  profile: UserProfile,
  displayStaffCode?: string
): DutyScheduleAssignment[] {
  const raw = profile.shift_schedule || '';
  if (!raw.startsWith(DUTY_SCHEDULES_PREFIX)) {
    return generateFallbackDutySchedules(profile, displayStaffCode);
  }
  try {
    const jsonStr = raw.slice(DUTY_SCHEDULES_PREFIX.length);
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return generateFallbackDutySchedules(profile, displayStaffCode);
    return parsed.flatMap((item) => {
      const areaId = Number(item.areaId ?? 0);
      let defaultAreaName = 'Library Area';
      if (areaId === CIRCULATION_AREA_ID) defaultAreaName = 'Circulation';
      else if (areaId === BAGGAGE_AREA_ID) defaultAreaName = 'Baggage';
      else if (areaId === SHELVER_AREA_ID) defaultAreaName = 'Shelver';
      else if (areaId === TECHNICAL_AREA_ID) defaultAreaName = 'Technical';
      else if (areaId === ENTRANCE_EXIT_AREA_ID) defaultAreaName = 'Entrance/Exit';
      const areaName = String(item.areaName || defaultAreaName);
      const requiresStatistics =
        isNonStatisticalArea(areaId) || isNonStatisticalArea(areaName)
          ? false
          : typeof item.requiresStatistics === 'boolean'
          ? item.requiresStatistics
          : doesAreaRequireStatistics(areaId, areaName);

      // Support dayGroup with backward compatibility for legacy dutyDate & legacy MWF/TTh
      let rawDay = (item.dayGroup || (item.dutyDate ? getDayGroupForDate(item.dutyDate) : 'Monday')) as DayGroup;
      if (!rawDay || (!DAY_GROUPS.includes(rawDay) && rawDay !== 'MWF' && rawDay !== 'TTh')) {
        rawDay = 'Monday';
      }

      const createAssignment = (dGroup: DayGroup, idSuffix?: string): DutyScheduleAssignment => ({
        id: String(
          idSuffix
            ? `${item.id || profile.id}-${idSuffix}`
            : item.id || `${profile.id}-${dGroup.toLowerCase()}-${item.startTime}`
        ),
        studentAssistantId: profile.id,
        studentAssistantName: profile.full_name,
        studentAssistantUsername: profile.username,
        studentAssistantCode: displayStaffCode || profile.staff_code,
        areaId,
        areaName,
        requiresStatistics,
        dayGroup: dGroup,
        dutyDate: String(item.dutyDate || ''),
        startTime: String(item.startTime || '08:00'),
        endTime: String(item.endTime || '10:00'),
        notes: String(item.notes || ''),
        updatedAt: String(item.updatedAt || profile.updated_at || profile.created_at),
        updatedBy: String(item.updatedBy || 'Librarian'),
      });

      if (rawDay === 'MWF') {
        return [
          createAssignment('Monday', `mon-${item.startTime}`),
          createAssignment('Wednesday', `wed-${item.startTime}`),
          createAssignment('Friday', `fri-${item.startTime}`),
        ];
      }
      if (rawDay === 'TTh') {
        return [
          createAssignment('Tuesday', `tue-${item.startTime}`),
          createAssignment('Thursday', `thu-${item.startTime}`),
        ];
      }

      return [createAssignment(rawDay)];
    });
  } catch {
    return generateFallbackDutySchedules(profile, displayStaffCode);
  }
}

export function generateFallbackDutySchedules(
  profile: UserProfile,
  displayStaffCode?: string
): DutyScheduleAssignment[] {
  if (
    profile.role !== 'student_assistant' ||
    profile.shift_schedule === 'REMOVED' ||
    profile.full_name.startsWith('CALENDAR_ACTIVITY::') ||
    (profile.staff_code || '').startsWith('CAL_ACT::') ||
    (profile.username || '').startsWith('cal_')
  ) {
    return [];
  }

  const staffCode = displayStaffCode || profile.staff_code || 'SA-2026';
  const name = profile.full_name || '';
  const username = profile.username || '';

  const expandShifts = (
    baseShifts: Array<{
      idKey: string;
      areaId: number;
      areaName: string;
      dayGroup: DayGroup;
      startTime: string;
      endTime: string;
      notes: string;
    }>
  ): DutyScheduleAssignment[] => {
    return baseShifts.flatMap((shift) => {
      const daysToAssign: DayGroup[] =
        shift.dayGroup === 'MWF'
          ? ['Monday', 'Wednesday', 'Friday']
          : shift.dayGroup === 'TTh'
          ? ['Tuesday', 'Thursday']
          : [shift.dayGroup];

      return daysToAssign.map((d) => ({
        id: `${profile.id}-${shift.idKey}-${d.toLowerCase()}`,
        studentAssistantId: profile.id,
        studentAssistantName: profile.full_name,
        studentAssistantUsername: profile.username,
        studentAssistantCode: staffCode,
        areaId: shift.areaId,
        areaName: shift.areaName,
        requiresStatistics: doesAreaRequireStatistics(shift.areaId, shift.areaName),
        dayGroup: d,
        dutyDate: '',
        startTime: shift.startTime,
        endTime: shift.endTime,
        notes: shift.notes,
        updatedAt: profile.created_at || '',
        updatedBy: 'LIRC Administration',
      }));
    });
  };

  // 1. Maria Clara Reyes (SA-2026-101)
  if (staffCode === 'SA-2026-101' || username === 'sa_maria' || name.includes('Maria Clara')) {
    return expandShifts([
      {
        idKey: 'flp-0800',
        areaId: 1,
        areaName: 'Filipiniana',
        dayGroup: 'MWF',
        startTime: '08:00',
        endTime: '13:00',
        notes: 'Morning Filipiniana duty shift',
      },
      {
        idKey: 'sat-flp-0800',
        areaId: 1,
        areaName: 'Filipiniana',
        dayGroup: 'Saturday',
        startTime: '08:00',
        endTime: '13:00',
        notes: 'Saturday Morning Filipiniana shift',
      },
    ]);
  }

  // 2. Juanito Pelaez (SA-2026-102)
  if (staffCode === 'SA-2026-102' || username === 'sa_juanito' || name.includes('Juanito')) {
    return expandShifts([
      {
        idKey: 'flp-1300',
        areaId: 1,
        areaName: 'Filipiniana',
        dayGroup: 'MWF',
        startTime: '13:00',
        endTime: '18:00',
        notes: 'Afternoon Filipiniana duty shift',
      },
      {
        idKey: 'read-1300',
        areaId: 2,
        areaName: 'Reading Area',
        dayGroup: 'TTh',
        startTime: '13:00',
        endTime: '18:00',
        notes: 'Afternoon Reading Area shift',
      },
      {
        idKey: 'sat-flp-1300',
        areaId: 1,
        areaName: 'Filipiniana',
        dayGroup: 'Saturday',
        startTime: '13:00',
        endTime: '18:00',
        notes: 'Saturday Afternoon Filipiniana shift',
      },
    ]);
  }

  // 3. Isagani Sandoval (SA-2026-103)
  if (staffCode === 'SA-2026-103' || username === 'sa_isagani' || name.includes('Isagani')) {
    return expandShifts([
      {
        idKey: 'per-0800',
        areaId: 3,
        areaName: 'Periodicals',
        dayGroup: 'MWF',
        startTime: '08:00',
        endTime: '13:00',
        notes: 'Morning Periodicals study hall duty',
      },
      {
        idKey: 'read-0800',
        areaId: 2,
        areaName: 'Reading Area',
        dayGroup: 'TTh',
        startTime: '08:00',
        endTime: '13:00',
        notes: 'Morning Reading Area duty',
      },
      {
        idKey: 'sat-per-0800',
        areaId: 3,
        areaName: 'Periodicals',
        dayGroup: 'Saturday',
        startTime: '08:00',
        endTime: '13:00',
        notes: 'Saturday Morning Periodicals duty',
      },
    ]);
  }

  // 4. Paulita Gomez (SA-2026-104)
  if (staffCode === 'SA-2026-104' || username === 'sa_paulita' || name.includes('Paulita')) {
    return expandShifts([
      {
        idKey: 'read-0800',
        areaId: 2,
        areaName: 'Reading Area',
        dayGroup: 'MWF',
        startTime: '08:00',
        endTime: '13:00',
        notes: 'Morning Main Reading Hall duty',
      },
      {
        idKey: 'lc-0800',
        areaId: 4,
        areaName: 'Learning Commons',
        dayGroup: 'TTh',
        startTime: '08:00',
        endTime: '13:00',
        notes: 'Morning Learning Commons duty',
      },
      {
        idKey: 'sat-read-0800',
        areaId: 2,
        areaName: 'Reading Area',
        dayGroup: 'Saturday',
        startTime: '08:00',
        endTime: '13:00',
        notes: 'Saturday Morning Reading Area duty',
      },
    ]);
  }

  // 5. Basilio Santiago (SA-2026-105)
  if (staffCode === 'SA-2026-105' || username === 'sa_basilio' || name.includes('Basilio')) {
    return expandShifts([
      {
        idKey: 'read-1300',
        areaId: 2,
        areaName: 'Reading Area',
        dayGroup: 'MWF',
        startTime: '13:00',
        endTime: '18:00',
        notes: 'Afternoon Main Reading Hall duty',
      },
      {
        idKey: 'disc-1300',
        areaId: 5,
        areaName: 'Discussion Rooms',
        dayGroup: 'TTh',
        startTime: '13:00',
        endTime: '18:00',
        notes: 'Afternoon Discussion Rooms duty',
      },
      {
        idKey: 'sat-disc-1300',
        areaId: 5,
        areaName: 'Discussion Rooms',
        dayGroup: 'Saturday',
        startTime: '13:00',
        endTime: '18:00',
        notes: 'Saturday Afternoon Discussion Rooms duty',
      },
    ]);
  }

  // 6. Juliana De Dios (SA-2026-106)
  if (staffCode === 'SA-2026-106' || username === 'sa_juliana' || name.includes('Juliana')) {
    return expandShifts([
      {
        idKey: 'lc-0800',
        areaId: 4,
        areaName: 'Learning Commons',
        dayGroup: 'MWF',
        startTime: '08:00',
        endTime: '13:00',
        notes: 'Morning Learning Commons duty',
      },
      {
        idKey: 'ref-0800',
        areaId: 6,
        areaName: 'Reference',
        dayGroup: 'TTh',
        startTime: '08:00',
        endTime: '13:00',
        notes: 'Morning Reference Section duty',
      },
      {
        idKey: 'sat-lc-0800',
        areaId: 4,
        areaName: 'Learning Commons',
        dayGroup: 'Saturday',
        startTime: '08:00',
        endTime: '13:00',
        notes: 'Saturday Morning Learning Commons duty',
      },
    ]);
  }

  // 7. General fallback for any other student assistant who has assigned_area_id or text shift
  if (profile.assigned_area_id) {
    const rawShift = profile.shift_schedule || '';
    const isAfternoon = rawShift.includes('Afternoon') || rawShift.includes('1:00 PM');
    const start = isAfternoon ? '13:00' : '08:00';
    const end = isAfternoon ? '18:00' : '13:00';
    return expandShifts([
      {
        idKey: 'auto-mwf',
        areaId: profile.assigned_area_id,
        areaName: 'Assigned Library Station',
        dayGroup: 'MWF',
        startTime: start,
        endTime: end,
        notes: 'Assigned duty rotation',
      },
      {
        idKey: 'auto-tth',
        areaId: profile.assigned_area_id,
        areaName: 'Assigned Library Station',
        dayGroup: 'TTh',
        startTime: start,
        endTime: end,
        notes: 'Assigned duty rotation',
      },
    ]);
  }

  return [];
}

export function formatDutyScheduleSummary(schedules: DutyScheduleAssignment[]): string {
  if (!schedules || schedules.length === 0) {
    return 'No duty schedule assigned';
  }
  const parts: string[] = [];
  const days: DayGroup[] = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'MWF',
    'TTh',
  ];

  for (const day of days) {
    const daySchedules = schedules.filter((s) => s.dayGroup === day);
    if (daySchedules.length > 0) {
      const areas = Array.from(new Set(daySchedules.map((s) => s.areaName))).join(', ');
      const label = DAY_GROUP_LABELS[day]?.shortDays || day;
      parts.push(
        `${label} (${daySchedules.length} slot${daySchedules.length > 1 ? 's' : ''}: ${areas})`
      );
    }
  }

  return parts.join(' | ') || `${schedules.length} assigned rotation block(s)`;
}

export function checkDutyScheduleConflict(params: {
  existingSchedules: DutyScheduleAssignment[];
  studentAssistantId: string;
  dayGroup: DayGroup;
  startTime: string;
  endTime: string;
  excludeScheduleIds?: string[];
}): DutyScheduleAssignment | null {
  const excluded = new Set(params.excludeScheduleIds || []);
  for (const sched of params.existingSchedules) {
    if (excluded.has(sched.id)) {
      continue;
    }
    if (
      sched.studentAssistantId === params.studentAssistantId &&
      isScheduleMatchingDay(sched.dayGroup, params.dayGroup)
    ) {
      // Overlap check: [startA, endA) overlaps [startB, endB) iff startA < endB && endA > startB
      // Note: back-to-back shifts like 08:00-10:00 and 10:00-11:30 do NOT overlap (10:00 < 10:00 is false)
      if (params.startTime < sched.endTime && params.endTime > sched.startTime) {
        return sched;
      }
    }
  }
  return null;
}

export interface DutyShiftOccurrence {
  assignment: DutyScheduleAssignment;
  date: string; // YYYY-MM-DD
  dayName: string; // 'Monday', 'Friday', etc.
  dayGroup: DayGroup;
  isToday: boolean;
  isTomorrow?: boolean;
  isTodayCompleted?: boolean;
  daysUntil?: number;
  statusLabel: string;
}

export interface ResolvedDutyStatus {
  currentShift: DutyScheduleAssignment | null;
  currentShiftOccurrence: DutyShiftOccurrence | null;
  nextShift: DutyScheduleAssignment | null;
  nextShiftOccurrence: DutyShiftOccurrence | null;
  upcomingShiftOccurrence: DutyShiftOccurrence | null;
  nextRotationAfterCurrent: DutyScheduleAssignment | null;
  todayShifts: DutyScheduleAssignment[];
  todayGroup: DayGroup | null;
  todayDayName: string;
  isTodayCompleted?: boolean;
  mwfShifts: DutyScheduleAssignment[];
  tthShifts: DutyScheduleAssignment[];
  saturdayShifts: DutyScheduleAssignment[];
  allWeeklyShifts: DutyScheduleAssignment[];
}

export function resolveStudentAssistantDutyStatus(
  schedules: DutyScheduleAssignment[],
  todayDate: string,
  currentHHMM?: string | null,
  enteredShiftIds?: Set<string> | string[]
): ResolvedDutyStatus {
  const mwfShifts = schedules
    .filter((s) => isScheduleMatchingDay(s.dayGroup, 'MWF'))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const tthShifts = schedules
    .filter((s) => isScheduleMatchingDay(s.dayGroup, 'TTh'))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const saturdayShifts = schedules
    .filter((s) => isScheduleMatchingDay(s.dayGroup, 'Saturday'))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const todayGroup = getDayGroupForDate(todayDate);
  const todayDayName = getDayNameForDate(todayDate);
  const todayShifts = todayGroup
    ? schedules
        .filter((s) => isScheduleMatchingDay(s.dayGroup, todayGroup))
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
    : [];

  const nowTime = currentHHMM || '08:00';
  const enteredSet = new Set(
    Array.isArray(enteredShiftIds) ? enteredShiftIds : Array.from(enteredShiftIds || [])
  );

  // Helper to look ahead 1 to 7 days for the next scheduled shift on a future working day
  const findFutureShiftOccurrence = (startOffset = 1): DutyShiftOccurrence | null => {
    const [y, m, d] = (todayDate || '').split('-').map(Number);
    if (!y || !m || !d) return null;
    for (let offset = startOffset; offset <= 7; offset++) {
      const checkDt = new Date(y, m - 1, d + offset);
      const yStr = checkDt.getFullYear();
      const mStr = String(checkDt.getMonth() + 1).padStart(2, '0');
      const dStr = String(checkDt.getDate()).padStart(2, '0');
      const checkDateStr = `${yStr}-${mStr}-${dStr}`;
      const group = getDayGroupForDate(checkDateStr);
      if (!group) continue;

      const dayAssignments = schedules
        .filter((s) => isScheduleMatchingDay(s.dayGroup, group))
        .sort((a, b) => a.startTime.localeCompare(b.startTime));

      if (dayAssignments.length > 0) {
        const first = dayAssignments[0];
        const isTomorrow = offset === 1;
        return {
          assignment: first,
          date: checkDateStr,
          dayName: getDayNameForDate(checkDateStr),
          dayGroup: group,
          isToday: false,
          isTomorrow,
          isTodayCompleted: false,
          daysUntil: offset,
          statusLabel: isTomorrow
            ? 'TOMORROW'
            : `Next: ${getDayNameForDate(checkDateStr)} (${group})`,
        };
      }
    }
    return null;
  };

  let assignedCurrentShift: DutyScheduleAssignment | null = null;
  let nextRotationAfterAssigned: DutyScheduleAssignment | null = null;
  let currentShiftOccurrence: DutyShiftOccurrence | null = null;
  let upcomingShiftOccurrence: DutyShiftOccurrence | null = null;
  let isTodayCompleted = false;

  if (todayShifts.length > 0 && todayGroup) {
    const firstShift = todayShifts[0];
    const lastShift = todayShifts[todayShifts.length - 1];

    if (nowTime < firstShift.startTime) {
      // Current time is before the first shift of today
      assignedCurrentShift = firstShift;
      nextRotationAfterAssigned = todayShifts[1] || null;
      isTodayCompleted = false;

      currentShiftOccurrence = {
        assignment: assignedCurrentShift,
        date: todayDate,
        dayName: todayDayName,
        dayGroup: todayGroup,
        isToday: true,
        isTomorrow: false,
        isTodayCompleted: false,
        daysUntil: 0,
        statusLabel: 'Upcoming Today',
      };

      if (nextRotationAfterAssigned) {
        upcomingShiftOccurrence = {
          assignment: nextRotationAfterAssigned,
          date: todayDate,
          dayName: todayDayName,
          dayGroup: todayGroup,
          isToday: true,
          isTomorrow: false,
          isTodayCompleted: false,
          daysUntil: 0,
          statusLabel: `Starts at ${formatTimeSlotLabel(nextRotationAfterAssigned.startTime)}`,
        };
      } else {
        upcomingShiftOccurrence = findFutureShiftOccurrence(1);
      }
    } else if (nowTime >= lastShift.endTime) {
      // Current time is past all scheduled shifts for today
      isTodayCompleted = true;
      assignedCurrentShift = null;
      currentShiftOccurrence = null;
      upcomingShiftOccurrence = findFutureShiftOccurrence(1);
    } else {
      // Current time is during today's duty hours:
      // Find the shift currently in progress (nowTime >= s.startTime && nowTime < s.endTime)
      // Or if in a gap between shifts, pick the next upcoming shift today
      let currentIdx = todayShifts.findIndex(
        (s) => nowTime >= s.startTime && nowTime < s.endTime
      );

      if (currentIdx === -1) {
        currentIdx = todayShifts.findIndex((s) => s.startTime > nowTime);
      }

      if (currentIdx !== -1) {
        assignedCurrentShift = todayShifts[currentIdx];
        nextRotationAfterAssigned = todayShifts[currentIdx + 1] || null;

        const isBeforeStart = nowTime < assignedCurrentShift.startTime;
        const hasEntered = enteredSet.has(assignedCurrentShift.id);
        const statusLabel = isBeforeStart
          ? 'Upcoming Today'
          : hasEntered
          ? 'Active Duty (Entered)'
          : 'Active Duty Now';

        currentShiftOccurrence = {
          assignment: assignedCurrentShift,
          date: todayDate,
          dayName: todayDayName,
          dayGroup: todayGroup,
          isToday: true,
          isTomorrow: false,
          isTodayCompleted: false,
          daysUntil: 0,
          statusLabel,
        };

        if (nextRotationAfterAssigned) {
          upcomingShiftOccurrence = {
            assignment: nextRotationAfterAssigned,
            date: todayDate,
            dayName: todayDayName,
            dayGroup: todayGroup,
            isToday: true,
            isTomorrow: false,
            isTodayCompleted: false,
            daysUntil: 0,
            statusLabel: `Starts at ${formatTimeSlotLabel(nextRotationAfterAssigned.startTime)}`,
          };
        } else {
          upcomingShiftOccurrence = findFutureShiftOccurrence(1);
        }
      } else {
        isTodayCompleted = true;
        assignedCurrentShift = null;
        currentShiftOccurrence = null;
        upcomingShiftOccurrence = findFutureShiftOccurrence(1);
      }
    }
  } else {
    // Today has no shifts (e.g. Sunday or non-duty day)
    assignedCurrentShift = null;
    currentShiftOccurrence = null;
    upcomingShiftOccurrence = findFutureShiftOccurrence(1);
  }

  // Fallback to first available schedule if none resolved
  if (!upcomingShiftOccurrence && !currentShiftOccurrence && schedules.length > 0) {
    const first = schedules[0];
    upcomingShiftOccurrence = {
      assignment: first,
      date: todayDate,
      dayName:
        first.dayGroup === 'Saturday'
          ? 'Saturday'
          : first.dayGroup === 'TTh'
          ? 'Tuesday / Thursday'
          : 'Monday / Wednesday / Friday',
      dayGroup: first.dayGroup,
      isToday: false,
      isTomorrow: false,
      isTodayCompleted,
      daysUntil: 0,
      statusLabel: 'Scheduled Duty',
    };
  }

  const nextShiftOccurrence = currentShiftOccurrence || upcomingShiftOccurrence;

  return {
    currentShift: assignedCurrentShift,
    currentShiftOccurrence,
    nextShift: nextRotationAfterAssigned,
    nextShiftOccurrence,
    upcomingShiftOccurrence,
    nextRotationAfterCurrent: nextRotationAfterAssigned,
    todayShifts,
    todayGroup,
    todayDayName,
    isTodayCompleted,
    mwfShifts,
    tthShifts,
    saturdayShifts,
    allWeeklyShifts: schedules,
  };
}

export function parseStaffAccount(profile: UserProfile): ParsedStaffAccount {
  const rawCode = profile.staff_code || '';
  const isInviteCarrier =
    profile.shift_schedule === 'INVITE_CODE' || profile.full_name.startsWith(INVITE_PREFIX);
  const isCalendarCarrier =
    profile.full_name.startsWith('CALENDAR_ACTIVITY::') ||
    rawCode.startsWith('CAL_ACT::') ||
    (profile.username || '').startsWith('cal_');
  const isRemoved = profile.shift_schedule === 'REMOVED' || isCalendarCarrier;

  let isRegistrationRequest = false;
  let approvalStatus: RegistrationApprovalStatus = 'approved';
  let displayStaffCode = profile.staff_code;
  let inviteCode: string | null = null;
  let courseDepartment = '';

  if (rawCode.startsWith(PENDING_PREFIX)) {
    const rest = rawCode.slice(PENDING_PREFIX.length);
    const [studentId, invCode, courseDept] = rest.split('::');
    isRegistrationRequest = true;
    approvalStatus = 'pending';
    displayStaffCode = studentId || 'SA-PENDING';
    inviteCode = invCode || null;
    courseDepartment = courseDept || 'Student Assistant Applicant';
  } else if (rawCode.startsWith(REJECTED_PREFIX)) {
    const rest = rawCode.slice(REJECTED_PREFIX.length);
    const [studentId, invCode, courseDept] = rest.split('::');
    isRegistrationRequest = true;
    approvalStatus = 'rejected';
    displayStaffCode = studentId || 'SA-REJECTED';
    inviteCode = invCode || null;
    courseDepartment = courseDept || 'Student Assistant Applicant';
  } else if (rawCode.startsWith(APPROVED_PREFIX)) {
    const rest = rawCode.slice(APPROVED_PREFIX.length);
    const [studentId, invCode, courseDept] = rest.split('::');
    isRegistrationRequest = true;
    approvalStatus = 'approved';
    displayStaffCode = studentId || 'SA-2026';
    inviteCode = invCode || null;
    courseDepartment = courseDept || 'Student Assistant';
  }

  const dutySchedules = parseDutySchedulesFromProfile(profile, displayStaffCode);
  const scheduleSummary =
    profile.role === 'librarian'
      ? '8:00 AM - 6:00 PM (Full Administration)'
      : formatDutyScheduleSummary(dutySchedules);

  return {
    profile,
    isInviteCarrier,
    isCalendarCarrier,
    isRemoved,
    isRegistrationRequest,
    approvalStatus,
    displayStaffCode,
    inviteCode,
    courseDepartment,
    dutySchedules,
    scheduleSummary,
  };
}
