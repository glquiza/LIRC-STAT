export interface LibraryArea {
  id: number;
  code: string;
  slug: string;
  name: string;
  description: string;
  floor_location: string;
  capacity: number;
  color_hex: string;
  icon_name: string;
  display_order: number;
  is_active: boolean;
}

export type StaffRole = 'librarian' | 'student_assistant';

export interface UserProfile {
  id: string;
  email: string;
  username: string;
  full_name: string;
  staff_code: string;
  role: StaffRole;
  assigned_area_id: number | null;
  shift_schedule: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LoginDirectoryItem {
  id: string;
  username: string;
  email: string;
  full_name: string;
  staff_code: string;
  role: StaffRole;
  shift_schedule: string;
}

export interface ServerClock {
  server_utc: string;
  manila_timestamp: string;
  record_date: string; // YYYY-MM-DD
  display_date: string;
  display_time: string;
  detected_slot: string | null; // '08:00'..'17:30' or null if off-hours (underway slot)
  underway_slot?: string | null; // Currently running 30-min slot
  completed_slot?: string | null; // Latest concluded 30-min slot eligible for recording
  is_interval_completed?: boolean; // Whether at least one interval has concluded today
  is_operating_hours: boolean;
  seconds_until_next_slot: number;
  timezone: string;
}

export interface MonitoringSession {
  id: number;
  user_id: string;
  user_name: string;
  staff_code: string;
  area_id: number;
  area_name: string;
  status: 'active' | 'completed';
  started_at: string;
  ended_at: string | null;
  records_submitted: number;
  created_at: string;
}

export interface OccupancyRecord {
  id: number;
  record_date: string; // YYYY-MM-DD
  time_slot: string;   // '08:00' to '17:30'
  area_id: number;
  occupancy_count: number;
  recorded_by: string | null;
  recorded_by_name: string;
  session_id: number | null;
  notes: string;
  recorded_at: string;
  is_off_hours_entry: boolean;
  is_corrected: boolean;
  correction_count: number;
  last_corrected_by: string | null;
  last_corrected_by_name: string | null;
  last_corrected_at: string | null;
  correction_reason: string | null;
  created_at: string;
  updated_at: string;
}

export type ActivityActionType =
  | 'occupancy_submitted'
  | 'record_corrected'
  | 'record_backfilled'
  | 'session_started'
  | 'session_ended'
  | 'report_generated'
  | 'report_exported'
  | 'user_login'
  | 'user_logout'
  | 'staff_created'
  | 'staff_updated'
  | 'area_updated'
  | 'backup_exported';

export interface ActivityLog {
  id: number;
  action_type: ActivityActionType;
  actor_id: string | null;
  actor_name: string;
  actor_role: string;
  area_id: number | null;
  area_name: string | null;
  target_type: string | null;
  target_id: string | null;
  description: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type ReportPeriodType = 'daily' | 'monthly' | 'range';

export interface SavedReport {
  id: number;
  report_type: ReportPeriodType;
  start_date: string;
  end_date: string;
  report_year: number;
  report_month: number;
  report_title: string;
  total_occupancy: number;
  total_days_recorded: number;
  total_missing_slots: number;
  top_area_name: string;
  export_format: string;
  generated_by: string | null;
  generated_by_name: string;
  remarks: string;
  created_at: string;
}

export interface TimeSlotDefinition {
  value: string;      // '08:00'
  label: string;      // '8:00 AM'
  rangeLabel: string; // '8:00 AM - 8:30 AM'
  hourKey: string;    // '08'
  hourLabel: string;  // '8:00 AM - 9:00 AM'
  period: 'Morning' | 'Midday' | 'Afternoon' | 'Late Afternoon';
}

export const LIBRARY_TIME_SLOTS: TimeSlotDefinition[] = [
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

export interface HourlyBracketDefinition {
  hourKey: string;
  label: string;
  shortLabel: string;
  slots: string[];
}

export const HOURLY_BRACKETS: HourlyBracketDefinition[] = [
  { hourKey: '08', label: '8:00 AM - 9:00 AM', shortLabel: '8-9 AM', slots: ['08:00', '08:30'] },
  { hourKey: '09', label: '9:00 AM - 10:00 AM', shortLabel: '9-10 AM', slots: ['09:00', '09:30'] },
  { hourKey: '10', label: '10:00 AM - 11:00 AM', shortLabel: '10-11 AM', slots: ['10:00', '10:30'] },
  { hourKey: '11', label: '11:00 AM - 12:00 PM', shortLabel: '11-12 PM', slots: ['11:00', '11:30'] },
  { hourKey: '12', label: '12:00 PM - 1:00 PM', shortLabel: '12-1 PM', slots: ['12:00', '12:30'] },
  { hourKey: '13', label: '1:00 PM - 2:00 PM', shortLabel: '1-2 PM', slots: ['13:00', '13:30'] },
  { hourKey: '14', label: '2:00 PM - 3:00 PM', shortLabel: '2-3 PM', slots: ['14:00', '14:30'] },
  { hourKey: '15', label: '3:00 PM - 4:00 PM', shortLabel: '3-4 PM', slots: ['15:00', '15:30'] },
  { hourKey: '16', label: '4:00 PM - 5:00 PM', shortLabel: '4-5 PM', slots: ['16:00', '16:30'] },
  { hourKey: '17', label: '5:00 PM - 6:00 PM', shortLabel: '5-6 PM', slots: ['17:00', '17:30'] },
];

export interface AreaStatisticalSummary {
  area: LibraryArea;
  totalOccupancy: number;
  dailyAverage: number;
  slotAverage: number;
  peakCount: number;
  peakDate: string;
  peakSlot: string;
  recordedSlotsCount: number;
  expectedSlotsCount: number;
  missingSlotsCount: number;
  completionRate: number;
  sharePercent: number;
  utilizationPercent: number;
}

export interface HourlyStatisticalRow {
  hourKey: string;
  label: string;
  shortLabel: string;
  areaTotals: Record<number, number>;
  areaAverages: Record<number, number>;
  totalOccupancy: number;
  averagePerSlot: number;
  entriesCount: number;
}

export interface DailyStatisticalRow {
  date: string;
  formattedDate: string;
  dayOfWeek: string;
  areaTotals: Record<number, number>;
  dailyTotal: number;
  slotsRecorded: number;
  expectedSlots: number;
  missingSlots: number;
}

export interface MonthlyStatisticalRow {
  yearMonth: string; // 'YYYY-MM'
  label: string;     // 'November 2026'
  areaTotals: Record<number, number>;
  monthlyTotal: number;
  operatingDays: number;
  dailyAverage: number;
  slotsRecorded: number;
}

export interface SlotStatisticalRow {
  slot: string;
  label: string;
  period: string;
  areaTotals: Record<number, number>;
  areaAverages: Record<number, number>;
  totalAcrossAreas: number;
  averageAcrossDays: number;
  isExcluded?: boolean;
  exclusionReason?: string;
}

export interface MissingIntervalItem {
  date: string;
  formattedDate: string;
  timeSlot: string;
  timeSlotLabel: string;
  areaId: number;
  areaName: string;
  areaCode: string;
  areaColor: string;
}

export interface ComputedStatisticalReport {
  reportType: ReportPeriodType;
  startDate: string;
  endDate: string;
  reportTitle: string;
  periodLabel: string;
  generatedAt: string;
  overallTotal: number;
  totalOperatingDays: number;
  totalSlotEntries: number;
  expectedTotalSlots: number;
  missingSlotsCount: number;
  completionRate: number;
  dailyAverageOccupancy: number;
  correctedRecordsCount: number;
  peakHour: { label: string; total: number } | null;
  peakDay: { date: string; formattedDate: string; total: number } | null;
  peakArea: { areaName: string; total: number; sharePercent: number } | null;
  areaSummaries: AreaStatisticalSummary[];
  hourlyBreakdown: HourlyStatisticalRow[];
  dailyBreakdown: DailyStatisticalRow[];
  monthlyBreakdown: MonthlyStatisticalRow[];
  slotBreakdown: SlotStatisticalRow[];
  missingIntervals: MissingIntervalItem[];
  rawRecords: OccupancyRecord[];
}
