import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Edit2,
  HelpCircle,
  Layers,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Shield,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LibraryArea, TimeSlotDefinition, UserProfile } from '../types/lirc';
import {
  DAY_OF_WEEK_NAMES,
  OPERATING_WEEKDAYS,
  toggleClosedDayOfWeek,
} from '../utils/calendarActivities';
import {
  deleteTimeSlot,
  determinePeriod,
  fetchTimeSlots,
  formatTime12Hour,
  formatTimeRange,
  getTimeSlotsFromCache,
  saveTimeSlot,
  subscribeToTimeSlotChanges,
} from '../utils/timeSlots';
import {
  removeLibraryArea,
  saveLibraryArea,
  subscribeToAreaChanges,
} from '../utils/areaManagement';
import { CIRCULATION_AREA_ID, isNonStatisticalArea } from '../utils/invitationWorkflow';

interface LibrarianAdvancedSettingsProps {
  profile: UserProfile;
  areas: LibraryArea[];
  onRefreshAreas: () => void;
  closedDaysOfWeek: number[];
  onClosedDaysUpdated: (days: number[]) => void;
  onNotify: (type: 'success' | 'error', message: string) => void;
  timeSlots?: TimeSlotDefinition[];
  onTimeSlotsUpdated?: (slots: TimeSlotDefinition[]) => void;
}

type SettingsSection = 'closures' | 'intervals' | 'areas';

const ACADEMIC_PALETTE = [
  { name: 'Burgundy Crimson', hex: '#A83232' },
  { name: 'Forest Sage', hex: '#2E5A44' },
  { name: 'Academic Gold', hex: '#E7B84B' },
  { name: 'Library Charcoal', hex: '#332F2B' },
  { name: 'Terracotta', hex: '#8F4B38' },
  { name: 'Deep Sage', hex: '#5A6E58' },
  { name: 'Navy Blue', hex: '#1E3A5F' },
  { name: 'Mahogany Red', hex: '#7C2D36' },
  { name: 'Classic Slate', hex: '#4A5568' },
  { name: 'Warm Amber', hex: '#B8860B' },
];

export const LibrarianAdvancedSettings: React.FC<LibrarianAdvancedSettingsProps> = ({
  profile,
  areas,
  onRefreshAreas,
  closedDaysOfWeek,
  onClosedDaysUpdated,
  onNotify,
  timeSlots: initialTimeSlots,
  onTimeSlotsUpdated,
}) => {
  const [activeSection, setActiveSection] = useState<SettingsSection>('closures');

  // ---------------------------------------------------------------------------
  // 1. WEEKLY DAY CLOSURE STATE
  // ---------------------------------------------------------------------------
  const [togglingDay, setTogglingDay] = useState<number | null>(null);
  const [closureReasonModalDay, setClosureReasonModalDay] = useState<number | null>(null);
  const [closureReasonText, setClosureReasonText] = useState<string>('');

  const handleToggleWeekday = async (dayOfWeek: number, currentlyClosed: boolean, reason = '') => {
    setTogglingDay(dayOfWeek);
    const dayName = DAY_OF_WEEK_NAMES[dayOfWeek] || `Day ${dayOfWeek}`;
    const nextIsClosed = !currentlyClosed;

    try {
      const updated = await toggleClosedDayOfWeek(supabase, dayOfWeek, nextIsClosed, profile, reason);
      onClosedDaysUpdated(updated);
      onNotify(
        'success',
        nextIsClosed
          ? `Every ${dayName} temporarily closed. Data recorded on this day is excluded from statistical calculations.`
          : `Every ${dayName} reopened. Standard operating schedule resumed.`
      );
    } catch (err: any) {
      onNotify('error', `Failed to update ${dayName} status: ${err?.message || 'Error occurred'}`);
    } finally {
      setTogglingDay(null);
      setClosureReasonModalDay(null);
      setClosureReasonText('');
    }
  };

  // ---------------------------------------------------------------------------
  // 2. TIME INTERVAL MANAGEMENT STATE
  // ---------------------------------------------------------------------------
  const [slotsList, setSlotsList] = useState<TimeSlotDefinition[]>(() =>
    initialTimeSlots && initialTimeSlots.length > 0 ? initialTimeSlots : getTimeSlotsFromCache()
  );
  const [slotSearch, setSlotSearch] = useState<string>('');

  // Add / Edit Interval Modal
  const [showSlotModal, setShowSlotModal] = useState<boolean>(false);
  const [editingSlotKey, setEditingSlotKey] = useState<string | null>(null);
  const [slotStartTime, setSlotStartTime] = useState<string>('18:00');
  const [slotEndTime, setSlotEndTime] = useState<string>('18:30');
  const [slotPeriod, setSlotPeriod] = useState<string>('Evening');
  const [savingSlot, setSavingSlot] = useState<boolean>(false);
  const [deletingSlotKey, setDeletingSlotKey] = useState<string | null>(null);

  // Sync slots whenever initialTimeSlots prop updates
  useEffect(() => {
    if (initialTimeSlots && initialTimeSlots.length > 0) {
      setSlotsList(initialTimeSlots);
    }
  }, [initialTimeSlots]);

  // Fallback initial load if initialTimeSlots was not supplied
  useEffect(() => {
    if (initialTimeSlots && initialTimeSlots.length > 0) return;
    let mounted = true;
    async function loadFallbackSlots() {
      try {
        const data = await fetchTimeSlots(supabase);
        if (mounted && data.length > 0) {
          setSlotsList(data);
          onTimeSlotsUpdated?.(data);
        }
      } catch (err) {
        console.warn('Fallback fetch time slots:', err);
      }
    }
    loadFallbackSlots();
  }, [initialTimeSlots, onTimeSlotsUpdated]);

  const filteredSlots = useMemo(() => {
    const q = slotSearch.trim().toLowerCase();
    if (!q) return slotsList;
    return slotsList.filter(
      (s) =>
        s.value.toLowerCase().includes(q) ||
        s.label.toLowerCase().includes(q) ||
        s.rangeLabel.toLowerCase().includes(q) ||
        s.period.toLowerCase().includes(q)
    );
  }, [slotsList, slotSearch]);

  const openAddSlotModal = () => {
    setEditingSlotKey(null);
    // Find next sensible time slot based on last slot
    const lastSlot = slotsList[slotsList.length - 1];
    let nextStart = '18:00';
    let nextEnd = '18:30';
    if (lastSlot && lastSlot.value.includes(':')) {
      const [h, m] = lastSlot.value.split(':').map(Number);
      const total = h * 60 + m + 30;
      const sh = Math.floor(total / 60) % 24;
      const sm = total % 60;
      const eh = Math.floor((total + 30) / 60) % 24;
      const em = (total + 30) % 60;
      nextStart = `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`;
      nextEnd = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
    }
    setSlotStartTime(nextStart);
    setSlotEndTime(nextEnd);
    setSlotPeriod(determinePeriod(nextStart));
    setShowSlotModal(true);
  };

  const openEditSlotModal = (slot: TimeSlotDefinition) => {
    setEditingSlotKey(slot.value);
    const start = slot.value;
    let end = '18:30';
    if (slot.rangeLabel && slot.rangeLabel.includes('–')) {
      const parts = slot.rangeLabel.split('–').map((p) => p.trim());
      // attempt parsing end time from 12h
      const endPart = parts[1];
      if (endPart) {
        const match = endPart.match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (match) {
          let eh = parseInt(match[1], 10);
          const em = parseInt(match[2], 10);
          const ampm = match[3].toUpperCase();
          if (ampm === 'PM' && eh < 12) eh += 12;
          if (ampm === 'AM' && eh === 12) eh = 0;
          end = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
        }
      }
    } else {
      const [h, m] = start.split(':').map(Number);
      const total = h * 60 + m + 30;
      end = `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    }
    setSlotStartTime(start);
    setSlotEndTime(end);
    setSlotPeriod(slot.period);
    setShowSlotModal(true);
  };

  const handleSaveSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slotStartTime || !slotEndTime) {
      onNotify('error', 'Please provide valid start and end times for the interval.');
      return;
    }

    const [sh, sm] = slotStartTime.split(':').map(Number);
    const [eh, em] = slotEndTime.split(':').map(Number);
    const startMins = sh * 60 + sm;
    const endMins = eh * 60 + em;

    if (endMins <= startMins) {
      onNotify('error', 'Interval end time must be after the start time.');
      return;
    }

    setSavingSlot(true);
    try {
      const updated = await saveTimeSlot(
        supabase,
        {
          startTime: slotStartTime,
          endTime: slotEndTime,
          period: slotPeriod as any,
        },
        profile
      );

      setSlotsList(updated);
      onTimeSlotsUpdated?.(updated);
      onNotify(
        'success',
        `Time interval ${formatTimeRange(slotStartTime, slotEndTime)} saved. Available for duty scheduling and statistics.`
      );
      setShowSlotModal(false);
    } catch (err: any) {
      onNotify('error', `Failed to save interval: ${err?.message || 'Error occurred'}`);
    } finally {
      setSavingSlot(false);
    }
  };

  const handleDeleteSlot = async (slot: TimeSlotDefinition) => {
    if (
      !window.confirm(
        `Are you sure you want to remove the time interval "${slot.rangeLabel}" (${slot.value})?\n\nIf occupancy records exist for this interval, it will be deactivated to preserve institutional historical reports.`
      )
    ) {
      return;
    }

    setDeletingSlotKey(slot.value);
    try {
      const updated = await deleteTimeSlot(supabase, slot.value, profile);
      setSlotsList(updated);
      onTimeSlotsUpdated?.(updated);
      onNotify('success', `Time interval ${slot.rangeLabel} removed.`);
    } catch (err: any) {
      onNotify('error', `Failed to remove time interval: ${err?.message || 'Error occurred'}`);
    } finally {
      setDeletingSlotKey(null);
    }
  };

  // ---------------------------------------------------------------------------
  // 3. LIBRARY AREA MANAGEMENT STATE
  // ---------------------------------------------------------------------------
  const [areaSearch, setAreaSearch] = useState<string>('');
  const [showAreaModal, setShowAreaModal] = useState<boolean>(false);
  const [editingArea, setEditingArea] = useState<LibraryArea | null>(null);

  // Form fields for Area
  const [areaName, setAreaName] = useState<string>('');
  const [areaCode, setAreaCode] = useState<string>('');
  const [areaCapacity, setAreaCapacity] = useState<number>(60);
  const [areaFloor, setAreaFloor] = useState<string>('1st Floor, Main Hall');
  const [areaDescription, setAreaDescription] = useState<string>('');
  const [areaColor, setAreaColor] = useState<string>('#2E5A44');
  const [savingArea, setSavingArea] = useState<boolean>(false);
  const [deletingAreaId, setDeletingAreaId] = useState<number | null>(null);

  // Subscribe to real-time area changes across tabs
  useEffect(() => {
    const unsubscribe = subscribeToAreaChanges(supabase, () => {
      onRefreshAreas();
    });
    return () => {
      unsubscribe();
    };
  }, [onRefreshAreas]);

  const activeLibraryAreas = useMemo(() => {
    return areas
      .filter((a) => !isNonStatisticalArea(a.name) && a.id !== CIRCULATION_AREA_ID && a.is_active !== false)
      .sort((a, b) => a.display_order - b.display_order);
  }, [areas]);

  const filteredAreas = useMemo(() => {
    const q = areaSearch.trim().toLowerCase();
    if (!q) return activeLibraryAreas;
    return activeLibraryAreas.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.description && a.description.toLowerCase().includes(q))
    );
  }, [activeLibraryAreas, areaSearch]);

  const openAddAreaModal = () => {
    setEditingArea(null);
    setAreaName('');
    setAreaCode('');
    setAreaCapacity(60);
    setAreaFloor('Main Library');
    setAreaDescription('');
    setAreaColor('#2E5A44');
    setShowAreaModal(true);
  };

  const openEditAreaModal = (area: LibraryArea) => {
    setEditingArea(area);
    setAreaName(area.name);
    setAreaCode(area.code);
    setAreaCapacity(area.capacity);
    setAreaFloor(area.floor_location || 'Main Library');
    setAreaDescription(area.description || '');
    setAreaColor(area.color_hex || '#2E5A44');
    setShowAreaModal(true);
  };

  const handleSaveArea = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = areaName.trim();
    if (!cleanName) {
      onNotify('error', 'Please enter a valid area name.');
      return;
    }

    let cleanCode = (editingArea?.code || areaCode || '').trim().toUpperCase();
    if (!cleanCode) {
      // Auto-generate 3-4 letter uppercase code from name
      cleanCode = cleanName
        .split(' ')
        .map((w) => w[0])
        .join('')
        .slice(0, 4)
        .toUpperCase();
      if (cleanCode.length < 2) {
        cleanCode = cleanName.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase();
      }
      if (!cleanCode) cleanCode = 'AREA';
    }

    setSavingArea(true);
    try {
      await saveLibraryArea(
        supabase,
        {
          id: editingArea?.id,
          name: cleanName,
          code: cleanCode,
          capacity: Math.max(1, Math.min(2000, Number(areaCapacity) || 60)),
          floor_location: editingArea?.floor_location || areaFloor.trim() || 'Main Library',
          description: areaDescription.trim(),
          color_hex: areaColor,
          is_active: true,
        },
        profile
      );

      onRefreshAreas();
      onNotify(
        'success',
        editingArea
          ? `Library area "${cleanName}" updated successfully.`
          : `New library area "${cleanName}" added. Reflected in Duty Schedules and Area Assignments.`
      );
      setShowAreaModal(false);
    } catch (err: any) {
      onNotify('error', `Failed to save library area: ${err?.message || 'Error occurred'}`);
    } finally {
      setSavingArea(false);
    }
  };

  const handleDeleteArea = async (area: LibraryArea) => {
    if (
      !window.confirm(
        `Are you sure you want to remove the library area "${area.name}" (${area.code})?\n\nIf this area has historical attendance records or past duty sessions, it will be safely deactivated to preserve institutional statistics integrity.`
      )
    ) {
      return;
    }

    setDeletingAreaId(area.id);
    try {
      const result = await removeLibraryArea(supabase, area, profile);
      onRefreshAreas();
      onNotify('success', result.message);
    } catch (err: any) {
      onNotify('error', `Failed to remove area: ${err?.message || 'Error occurred'}`);
    } finally {
      setDeletingAreaId(null);
    }
  };

  return (
    <div className="space-y-6 animate-literary-fade">
      {/* =====================================================================
          HEADER & SECTION TAB SELECTOR
      ===================================================================== */}
      <div className="literary-card p-5 sm:p-6 bg-gradient-to-r from-white via-[#FAF5EE] to-white dark:from-[#1C1814] dark:via-[#241F1A] dark:to-[#1C1814] border-[#E6D7C3] dark:border-[#383028] shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-[#FDF3F3] dark:bg-[#331717] border border-[#E8BDBD] dark:border-[#6B2A2A] flex items-center justify-center text-[#A83232] dark:text-[#E25D5D] shadow-2xs shrink-0">
              <SlidersHorizontal className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-heading font-bold text-[#332F2B] dark:text-[#F0E8DE]">
                  Advanced Settings &amp; System Configuration
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#FEF9EC] dark:bg-[#332512] text-[#7D5B06] dark:text-[#F5D075] border border-[#E7B84B]/50">
                  Librarian Administrator
                </span>
              </div>
              <p className="text-xs sm:text-sm text-[#6E665E] dark:text-[#A6998C] mt-1 max-w-2xl">
                Centralized institutional configuration for weekly operating schedule closures, dynamic 30-minute time intervals, and library monitored areas.
              </p>
            </div>
          </div>

          {/* Section Pill Switcher */}
          <div className="flex items-center p-1 rounded-2xl bg-white dark:bg-[#1A1612] border border-[#E6D7C3] dark:border-[#383028] shadow-2xs self-start lg:self-center">
            <button
              type="button"
              onClick={() => setActiveSection('closures')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 cursor-pointer transition ${
                activeSection === 'closures'
                  ? 'bg-[#A83232] text-white shadow-2xs'
                  : 'text-[#6E665E] dark:text-[#A6998C] hover:text-[#332F2B] dark:hover:text-white'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Weekly Day Closures</span>
              {closedDaysOfWeek.length > 0 && (
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                    activeSection === 'closures'
                      ? 'bg-white text-[#A83232]'
                      : 'bg-[#A83232] text-white'
                  }`}
                >
                  {closedDaysOfWeek.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveSection('intervals')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 cursor-pointer transition ${
                activeSection === 'intervals'
                  ? 'bg-[#A83232] text-white shadow-2xs'
                  : 'text-[#6E665E] dark:text-[#A6998C] hover:text-[#332F2B] dark:hover:text-white'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Time Intervals</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  activeSection === 'intervals'
                    ? 'bg-white/20 text-white'
                    : 'bg-[#FAF5EE] dark:bg-[#25201A] text-[#6E665E] dark:text-[#A6998C]'
                }`}
              >
                {slotsList.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSection('areas')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 cursor-pointer transition ${
                activeSection === 'areas'
                  ? 'bg-[#A83232] text-white shadow-2xs'
                  : 'text-[#6E665E] dark:text-[#A6998C] hover:text-[#332F2B] dark:hover:text-white'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Library Areas</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  activeSection === 'areas'
                    ? 'bg-white/20 text-white'
                    : 'bg-[#FAF5EE] dark:bg-[#25201A] text-[#6E665E] dark:text-[#A6998C]'
                }`}
              >
                {activeLibraryAreas.length}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* =====================================================================
          SECTION 1: WEEKLY DAY CLOSURE
      ===================================================================== */}
      {activeSection === 'closures' && (
        <div className="space-y-5 animate-literary-fade">
          {/* Institutional Advisory Notice */}
          <div className="literary-card p-4 sm:p-5 bg-gradient-to-r from-[#FFFDF8] via-[#FEF9EC] to-[#FAF5EE] dark:from-[#261F12] dark:via-[#1F1910] dark:to-[#1A1409] border-[#E7B84B]/60 dark:border-[#E7B84B]/40 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-start gap-3">
              <Calendar className="w-5 h-5 text-[#B88412] dark:text-[#E7B84B] shrink-0 mt-0.5" />
              <div>
                <div className="font-heading font-bold text-sm text-[#332F2B] dark:text-[#F0E8DE] flex items-center gap-2">
                  <span>Recurring Operating Schedule &amp; Day Closures</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#FEF9EC] dark:bg-[#332512] text-[#7D5B06] dark:text-[#F5D075] border border-[#E7B84B]/40">
                    Automatic Statistical Exclusion
                  </span>
                </div>
                <p className="text-[#6E665E] dark:text-[#A6998C] mt-1 leading-relaxed">
                  Temporarily close specific days of the week (Monday through Saturday) for sanitation, building maintenance, or institutional scheduling. 
                  When closed, the system <strong>automatically excludes all data recorded on that day from statistical reports, calculations, and expected interval requirements</strong>. 
                  The Librarian may reopen any day whenever necessary with zero loss of historical records.
                </p>
              </div>
            </div>
            {closedDaysOfWeek.length > 0 ? (
              <span className="shrink-0 px-3 py-1.5 rounded-xl bg-[#FDF3F3] dark:bg-[#331717] border border-[#E8BDBD] text-[#A83232] dark:text-[#F5A3A3] text-xs font-bold text-center">
                {closedDaysOfWeek.length} {closedDaysOfWeek.length === 1 ? 'Day' : 'Days'} Temporarily Closed
              </span>
            ) : (
              <span className="shrink-0 px-3 py-1.5 rounded-xl bg-[#F1F5EE] dark:bg-[#182414] border border-[#71865A]/40 text-[#455436] dark:text-[#B2D898] text-xs font-bold text-center">
                All 6 Operating Days Open
              </span>
            )}
          </div>

          {/* 6 Operating Days Cards Grid (Monday to Saturday) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {OPERATING_WEEKDAYS.map((wd) => {
              const isClosed = closedDaysOfWeek.includes(wd.dayOfWeek);
              const isBusy = togglingDay === wd.dayOfWeek;

              return (
                <div
                  key={wd.dayOfWeek}
                  className={`literary-card p-5 border transition-all duration-200 flex flex-col justify-between gap-4 ${
                    isClosed
                      ? 'bg-gradient-to-b from-[#FDF8F8] to-[#FDF3F3] dark:from-[#251818] dark:to-[#1E1414] border-[#E8BDBD] dark:border-[#6B2A2A] shadow-xs'
                      : 'bg-white dark:bg-[#1C1814] border-[#E6D7C3] dark:border-[#383028] hover:border-[#D6C3A9]'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-8 h-8 rounded-xl bg-[#FAF5EE] dark:bg-[#25201A] border border-[#E6D7C3] dark:border-[#383028] flex items-center justify-center font-heading font-bold text-xs text-[#A83232] dark:text-[#E25D5D]">
                          {wd.short}
                        </span>
                        <div>
                          <h3 className="text-base font-heading font-bold text-[#332F2B] dark:text-[#F0E8DE]">
                            Every {wd.name}
                          </h3>
                          <span className="text-[11px] text-[#6E665E] dark:text-[#A6998C]">
                            Weekly recurring schedule
                          </span>
                        </div>
                      </div>

                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                          isClosed
                            ? 'bg-[#FDF3F3] dark:bg-[#331717] text-[#A83232] dark:text-[#F5A3A3] border-[#E8BDBD]'
                            : 'bg-[#F1F5EE] dark:bg-[#182414] text-[#455436] dark:text-[#B2D898] border-[#71865A]/40'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isClosed ? 'bg-[#A83232] animate-pulse' : 'bg-[#71865A]'
                          }`}
                        />
                        {isClosed ? 'Temporarily Closed' : 'Operating Normally'}
                      </span>
                    </div>

                    <p className="text-xs text-[#6E665E] dark:text-[#A6998C] mt-2 leading-relaxed">
                      {isClosed
                        ? `Library operations for Every ${wd.name} are suspended. Any recorded headcount on ${wd.name}s is excluded from statistical averages, daily totals, and KPI reports.`
                        : `Standard library service and student count tracking active on ${wd.name}s. Included in all statistical averages and KPI computations.`}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-[#E6D7C3]/60 dark:border-[#383028] flex items-center justify-between gap-2">
                    <span className="text-[11px] font-stat text-[#6E665E] dark:text-[#A6998C]">
                      {isClosed ? 'Exclusion Active' : 'Operating 8AM–6PM'}
                    </span>

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => {
                        if (isClosed) {
                          handleToggleWeekday(wd.dayOfWeek, true);
                        } else {
                          // prompt for optional reason or toggle
                          setClosureReasonModalDay(wd.dayOfWeek);
                          setClosureReasonText('');
                        }
                      }}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition shadow-2xs disabled:opacity-50 ${
                        isClosed
                          ? 'border border-[#71865A] bg-[#F1F5EE] dark:bg-[#182414] text-[#455436] dark:text-[#B2D898] hover:bg-[#71865A] hover:text-white'
                          : 'border border-[#E8BDBD] bg-[#FDF3F3] dark:bg-[#331717] text-[#A83232] dark:text-[#F5A3A3] hover:bg-[#A83232] hover:text-white'
                      }`}
                    >
                      {isBusy ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : isClosed ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : (
                        <Clock className="w-3.5 h-3.5" />
                      )}
                      <span>{isClosed ? `Reopen ${wd.short}` : `Temporarily Close ${wd.short}`}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =====================================================================
          SECTION 2: TIME INTERVAL MANAGEMENT
      ===================================================================== */}
      {activeSection === 'intervals' && (
        <div className="space-y-5 animate-literary-fade">
          <div className="literary-card overflow-hidden">
            <div className="p-5 border-b border-[#E6D7C3] dark:border-[#383028] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-heading font-bold text-[#332F2B] dark:text-[#F0E8DE] flex items-center gap-2">
                  <span>Operating Time Intervals</span>
                  <span className="text-xs font-stat font-semibold px-2 py-0.5 rounded-full bg-[#FAF5EE] dark:bg-[#25201A] text-[#A83232] dark:text-[#E25D5D] border border-[#E6D7C3] dark:border-[#383028]">
                    {slotsList.length} Active Intervals
                  </span>
                </h2>
                <p className="text-xs text-[#6E665E] dark:text-[#A6998C] mt-0.5">
                  Configure 30-minute intervals for library headcount monitoring, Student Assistant duty schedules, and reports.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-[#6E665E] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={slotSearch}
                    onChange={(e) => setSlotSearch(e.target.value)}
                    placeholder="Search interval, period..."
                    className="pl-8 pr-3 py-1.5 rounded-xl bg-white dark:bg-[#201B17] border border-[#D6C3A9] dark:border-[#383028] text-xs text-[#332F2B] dark:text-[#F0E8DE] w-48 sm:w-56"
                  />
                </div>

                <button
                  type="button"
                  onClick={openAddSlotModal}
                  className="px-3.5 py-1.5 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition shadow-2xs"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add New Interval</span>
                </button>
              </div>
            </div>

            {slotsList.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#6E665E] dark:text-[#A6998C]">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto text-[#A83232] mb-2" />
                Loading library time intervals...
              </div>
            ) : filteredSlots.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#6E665E] dark:text-[#A6998C]">
                No time intervals found matching &ldquo;{slotSearch}&rdquo;.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#FAF5EE] dark:bg-[#221D18] border-b border-[#E6D7C3] dark:border-[#383028] text-[#332F2B] dark:text-[#F0E8DE]">
                    <tr>
                      <th className="py-3 px-4 font-semibold whitespace-nowrap">Order / Time Slot</th>
                      <th className="py-3 px-4 font-semibold whitespace-nowrap">30-Min Range Label</th>
                      <th className="py-3 px-4 font-semibold whitespace-nowrap">Hourly Bracket</th>
                      <th className="py-3 px-4 font-semibold whitespace-nowrap">Period Category</th>
                      <th className="py-3 px-4 font-semibold whitespace-nowrap">Status</th>
                      <th className="py-3 px-4 font-semibold text-right whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6D7C3]/60 dark:divide-[#383028]/60 bg-white dark:bg-[#1C1814]">
                    {filteredSlots.map((slot, index) => (
                      <tr
                        key={slot.value}
                        className="hover:bg-[#FAF5EE]/70 dark:hover:bg-[#25201A] transition-colors"
                      >
                        <td className="py-3 px-4 font-semibold text-[#332F2B] dark:text-[#F0E8DE] whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-lg bg-[#FAF5EE] dark:bg-[#25201A] border border-[#E6D7C3] dark:border-[#383028] flex items-center justify-center font-mono text-[10px] text-[#6E665E] dark:text-[#A6998C]">
                              {index + 1}
                            </span>
                            <span className="font-mono font-bold text-[#A83232] dark:text-[#E25D5D]">
                              {slot.value}
                            </span>
                            <span className="text-[#6E665E] dark:text-[#A6998C] font-normal">
                              ({slot.label})
                            </span>
                          </div>
                        </td>

                        <td className="py-3 px-4 font-semibold text-[#332F2B] dark:text-[#F0E8DE] whitespace-nowrap">
                          <span className="px-2.5 py-1 rounded-md bg-[#FAF5EE] dark:bg-[#25201A] border border-[#E6D7C3] dark:border-[#383028] font-stat">
                            {slot.rangeLabel}
                          </span>
                        </td>

                        <td className="py-3 px-4 text-[#6E665E] dark:text-[#A6998C] whitespace-nowrap">
                          {slot.hourLabel}
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                              slot.period === 'Morning'
                                ? 'bg-[#FEF9EC] dark:bg-[#261E10] text-[#7D5B06] dark:text-[#F5D075] border-[#E7B84B]/40'
                                : slot.period === 'Midday'
                                ? 'bg-[#FDF3F3] dark:bg-[#2E1616] text-[#A83232] dark:text-[#F5A3A3] border-[#E8BDBD]'
                                : slot.period === 'Afternoon'
                                ? 'bg-[#F1F5EE] dark:bg-[#142211] text-[#455436] dark:text-[#B2D898] border-[#71865A]/40'
                                : slot.period === 'Late Afternoon'
                                ? 'bg-[#FAF5EE] dark:bg-[#201C18] text-[#8F4B38] dark:text-[#E89380] border-[#D6C3A9]'
                                : 'bg-[#F5F2F8] dark:bg-[#1C1625] text-[#58406E] dark:text-[#CEBDE4] border-[#C8BCD6]'
                            }`}
                          >
                            {slot.period}
                          </span>
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#F1F5EE] dark:bg-[#182414] text-[#455436] dark:text-[#B2D898] border border-[#71865A]/40">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#71865A]" />
                            Active
                          </span>
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditSlotModal(slot)}
                              className="px-2.5 py-1 rounded-lg border border-[#D6C3A9] dark:border-[#383028] bg-white dark:bg-[#201B17] hover:bg-[#FAF5EE] dark:hover:bg-[#25201A] text-[#332F2B] dark:text-[#F0E8DE] font-semibold cursor-pointer transition"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={deletingSlotKey === slot.value}
                              onClick={() => handleDeleteSlot(slot)}
                              className="px-2.5 py-1 rounded-lg border border-[#E8BDBD] dark:border-[#6B2A2A] bg-[#FDF3F3] dark:bg-[#331717] hover:bg-[#A83232] hover:text-white text-[#A83232] dark:text-[#F5A3A3] font-semibold inline-flex items-center gap-1 cursor-pointer transition disabled:opacity-40"
                              title={`Remove ${slot.rangeLabel}`}
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Remove</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          SECTION 3: LIBRARY AREA MANAGEMENT
      ===================================================================== */}
      {activeSection === 'areas' && (
        <div className="space-y-5 animate-literary-fade">
          <div className="literary-card p-5">
            <div className="mb-4 pb-3 border-b border-[#E6D7C3] dark:border-[#383028] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-heading font-bold text-[#332F2B] dark:text-[#F0E8DE] flex items-center gap-2">
                  <span>Monitored Library Areas</span>
                  <span className="text-xs font-stat font-semibold px-2 py-0.5 rounded-full bg-[#FAF5EE] dark:bg-[#25201A] text-[#A83232] dark:text-[#E25D5D] border border-[#E6D7C3] dark:border-[#383028]">
                    {activeLibraryAreas.length} Areas
                  </span>
                </h2>
                <p className="text-xs text-[#6E665E] dark:text-[#A6998C] mt-0.5">
                  Configure monitored reading halls, seating capacities, color badges, and study areas. Changes automatically update Area Assignments and Duty Schedules.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-[#6E665E] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={areaSearch}
                    onChange={(e) => setAreaSearch(e.target.value)}
                    placeholder="Search library area..."
                    className="pl-8 pr-3 py-1.5 rounded-xl bg-white dark:bg-[#201B17] border border-[#D6C3A9] dark:border-[#383028] text-xs text-[#332F2B] dark:text-[#F0E8DE] w-48 sm:w-56"
                  />
                </div>

                <button
                  type="button"
                  onClick={openAddAreaModal}
                  className="px-3.5 py-1.5 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition shadow-2xs"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add New Library Area</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredAreas.map((area) => (
                <div
                  key={area.id}
                  className="p-4 rounded-xl border border-[#E6D7C3] dark:border-[#383028] bg-[#FAF5EE]/60 dark:bg-[#201B17] hover:border-[#D6C3A9] dark:hover:border-[#4A3C28] transition-all flex flex-col justify-between gap-3 shadow-2xs"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="w-4 h-4 rounded-full shrink-0 shadow-2xs"
                          style={{ backgroundColor: area.color_hex || '#A83232' }}
                          title={area.color_hex}
                        />
                        <div>
                          <h3 className="font-heading font-bold text-base text-[#332F2B] dark:text-[#F0E8DE]">
                            {area.name}
                          </h3>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] font-semibold text-[#6E665E] dark:text-[#A6998C] block uppercase tracking-wider">
                          Capacity
                        </span>
                        <span className="text-base font-stat font-bold text-[#A83232] dark:text-[#E25D5D]">
                          {area.capacity} seats
                        </span>
                      </div>
                    </div>

                    {area.description && (
                      <p className="text-xs text-[#6E665E] dark:text-[#A6998C] mt-2 line-clamp-2 leading-relaxed">
                        {area.description}
                      </p>
                    )}
                  </div>

                  <div className="pt-3 border-t border-[#E6D7C3]/60 dark:border-[#383028] flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => openEditAreaModal(area)}
                      className="px-3 py-1.5 rounded-lg border border-[#D6C3A9] dark:border-[#383028] bg-white dark:bg-[#25201A] hover:bg-[#FAF5EE] text-[#332F2B] dark:text-[#F0E8DE] text-xs font-semibold inline-flex items-center gap-1 cursor-pointer transition"
                    >
                      <Edit2 className="w-3 h-3 text-[#6E665E] dark:text-[#A6998C]" />
                      <span>Edit</span>
                    </button>

                    <button
                      type="button"
                      disabled={deletingAreaId === area.id}
                      onClick={() => handleDeleteArea(area)}
                      className="px-3 py-1.5 rounded-lg border border-[#E8BDBD] dark:border-[#6B2A2A] bg-[#FDF3F3] dark:bg-[#331717] hover:bg-[#A83232] hover:text-white text-[#A83232] dark:text-[#F5A3A3] text-xs font-semibold inline-flex items-center gap-1 cursor-pointer transition disabled:opacity-40"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Remove</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: ADD / EDIT TIME INTERVAL
      ===================================================================== */}
      {showSlotModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-[#332F2B]/65 dark:bg-black/80 backdrop-blur-[2px] flex items-center justify-center p-4 animate-literary-fade">
          <div className="literary-card shadow-2xl max-w-lg w-full relative overflow-hidden bg-white dark:bg-[#1C1814] border border-[#E6D7C3] dark:border-[#383028]">
            <div className="h-1.5 w-full bg-gradient-to-r from-[#A83232] via-[#E7B84B] to-[#71865A] absolute top-0 left-0" />

            <div className="p-5 border-b border-[#E6D7C3] dark:border-[#383028] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#FDF3F3] dark:bg-[#331717] border border-[#E8BDBD] flex items-center justify-center text-[#A83232] dark:text-[#E25D5D]">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-heading font-bold text-[#332F2B] dark:text-[#F0E8DE]">
                    {editingSlotKey ? 'Edit Time Interval' : 'Add New Operating Time Interval'}
                  </h3>
                  <p className="text-xs text-[#6E665E] dark:text-[#A6998C]">
                    Extend or configure 30-minute library duty intervals.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSlotModal(false)}
                className="p-1.5 rounded-lg hover:bg-[#FAF5EE] dark:hover:bg-[#25201A] text-[#6E665E] dark:text-[#A6998C] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveSlot} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] mb-1">
                    Start Time (24h)
                  </label>
                  <input
                    type="time"
                    required
                    value={slotStartTime}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSlotStartTime(val);
                      setSlotPeriod(determinePeriod(val));
                      // auto suggest end time = start + 30m
                      if (val.includes(':')) {
                        const [h, m] = val.split(':').map(Number);
                        const total = h * 60 + m + 30;
                        const eh = Math.floor(total / 60) % 24;
                        const em = total % 60;
                        setSlotEndTime(`${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-[#FAF5EE] dark:bg-[#25201A] border border-[#D6C3A9] dark:border-[#383028] text-xs font-mono font-semibold text-[#332F2B] dark:text-[#F0E8DE]"
                  />
                  <span className="text-[10px] text-[#6E665E] dark:text-[#A6998C] mt-0.5 block">
                    Displays as: {formatTime12Hour(slotStartTime)}
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] mb-1">
                    End Time (24h)
                  </label>
                  <input
                    type="time"
                    required
                    value={slotEndTime}
                    onChange={(e) => setSlotEndTime(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#FAF5EE] dark:bg-[#25201A] border border-[#D6C3A9] dark:border-[#383028] text-xs font-mono font-semibold text-[#332F2B] dark:text-[#F0E8DE]"
                  />
                  <span className="text-[10px] text-[#6E665E] dark:text-[#A6998C] mt-0.5 block">
                    Displays as: {formatTime12Hour(slotEndTime)}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] mb-1">
                  Operating Period Category
                </label>
                <select
                  value={slotPeriod}
                  onChange={(e) => setSlotPeriod(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#FAF5EE] dark:bg-[#25201A] border border-[#D6C3A9] dark:border-[#383028] text-xs text-[#332F2B] dark:text-[#F0E8DE]"
                >
                  <option value="Morning">Morning (8:00 AM – 11:59 AM)</option>
                  <option value="Midday">Midday (12:00 PM – 12:59 PM)</option>
                  <option value="Afternoon">Afternoon (1:00 PM – 3:59 PM)</option>
                  <option value="Late Afternoon">Late Afternoon (4:00 PM – 5:59 PM)</option>
                  <option value="Evening">Evening (6:00 PM onwards)</option>
                </select>
              </div>

              {/* Live Preview Box */}
              <div className="p-3.5 rounded-xl bg-[#FEF9EC] dark:bg-[#261E10] border border-[#E7B84B]/40 text-xs">
                <span className="font-semibold text-[#7D5B06] dark:text-[#F5D075] block mb-1">
                  Interval Live Preview
                </span>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-heading font-bold text-sm text-[#332F2B] dark:text-[#F0E8DE]">
                    {formatTimeRange(slotStartTime, slotEndTime)}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white dark:bg-[#1A1409] text-[#A83232] dark:text-[#E25D5D] border border-[#E7B84B]/30">
                    Key: {slotStartTime}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#FAF5EE] dark:bg-[#332512] text-[#7D5B06] dark:text-[#F5D075]">
                    {slotPeriod}
                  </span>
                </div>
                <p className="text-[11px] text-[#6E665E] dark:text-[#A6998C] mt-1.5">
                  Newly configured intervals are immediately available in Student Assistant duty schedules and headcount submission forms.
                </p>
              </div>

              <div className="pt-3 border-t border-[#E6D7C3] dark:border-[#383028] flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowSlotModal(false)}
                  className="px-4 py-2 rounded-xl border border-[#D6C3A9] dark:border-[#383028] text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] hover:bg-[#FAF5EE] dark:hover:bg-[#25201A] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingSlot}
                  className="px-5 py-2 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition shadow-2xs disabled:opacity-50"
                >
                  {savingSlot ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>{editingSlotKey ? 'Update Interval' : 'Add Interval'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* =====================================================================
          MODAL: ADD / EDIT LIBRARY AREA
      ===================================================================== */}
      {showAreaModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-[#332F2B]/65 dark:bg-black/80 backdrop-blur-[2px] flex items-center justify-center p-4 animate-literary-fade">
          <div className="literary-card shadow-2xl max-w-lg w-full relative overflow-hidden bg-white dark:bg-[#1C1814] border border-[#E6D7C3] dark:border-[#383028]">
            <div className="h-1.5 w-full bg-gradient-to-r from-[#A83232] via-[#E7B84B] to-[#71865A] absolute top-0 left-0" />

            <div className="p-5 border-b border-[#E6D7C3] dark:border-[#383028] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#FDF3F3] dark:bg-[#331717] border border-[#E8BDBD] flex items-center justify-center text-[#A83232] dark:text-[#E25D5D]">
                  <BookOpen className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-heading font-bold text-[#332F2B] dark:text-[#F0E8DE]">
                    {editingArea ? 'Edit Monitored Library Area' : 'Add New Library Area'}
                  </h3>
                  <p className="text-xs text-[#6E665E] dark:text-[#A6998C]">
                    Changes automatically reflect in Duty Schedule and Area Assignments.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAreaModal(false)}
                className="p-1.5 rounded-lg hover:bg-[#FAF5EE] dark:hover:bg-[#25201A] text-[#6E665E] dark:text-[#A6998C] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveArea} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] mb-1">
                  Area Name *
                </label>
                <input
                  type="text"
                  required
                  value={areaName}
                  onChange={(e) => setAreaName(e.target.value)}
                  placeholder="e.g. Graduate Research Hall"
                  className="w-full px-3 py-2 rounded-xl bg-[#FAF5EE] dark:bg-[#25201A] border border-[#D6C3A9] dark:border-[#383028] text-xs text-[#332F2B] dark:text-[#F0E8DE]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] mb-1">
                  Seating Capacity *
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  max={2000}
                  value={areaCapacity}
                  onChange={(e) => setAreaCapacity(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl bg-[#FAF5EE] dark:bg-[#25201A] border border-[#D6C3A9] dark:border-[#383028] text-xs font-stat font-bold text-[#332F2B] dark:text-[#F0E8DE]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] mb-1.5">
                  Academic Color Swatch
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  {ACADEMIC_PALETTE.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setAreaColor(c.hex)}
                      className={`w-7 h-7 rounded-full transition-transform cursor-pointer relative ${
                        areaColor === c.hex
                          ? 'ring-2 ring-offset-2 ring-[#A83232] scale-110 shadow-xs'
                          : 'hover:scale-105'
                      }`}
                      style={{ backgroundColor: c.hex }}
                      title={`${c.name} (${c.hex})`}
                    >
                      {areaColor === c.hex && (
                        <Check className="w-3.5 h-3.5 text-white absolute inset-0 m-auto" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] mb-1">
                  Description / Purpose
                </label>
                <textarea
                  rows={2}
                  value={areaDescription}
                  onChange={(e) => setAreaDescription(e.target.value)}
                  placeholder="General study tables, thesis collections, reading lounge..."
                  className="w-full px-3 py-2 rounded-xl bg-[#FAF5EE] dark:bg-[#25201A] border border-[#D6C3A9] dark:border-[#383028] text-xs text-[#332F2B] dark:text-[#F0E8DE]"
                />
              </div>

              <div className="pt-3 border-t border-[#E6D7C3] dark:border-[#383028] flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowAreaModal(false)}
                  className="px-4 py-2 rounded-xl border border-[#D6C3A9] dark:border-[#383028] text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] hover:bg-[#FAF5EE] dark:hover:bg-[#25201A] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingArea}
                  className="px-5 py-2 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition shadow-2xs disabled:opacity-50"
                >
                  {savingArea ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>{editingArea ? 'Update Library Area' : 'Create Library Area'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* =====================================================================
          MODAL: WEEKDAY CLOSURE REASON PROMPT
      ===================================================================== */}
      {closureReasonModalDay !== null && createPortal(
        <div className="fixed inset-0 z-[9999] bg-[#332F2B]/65 dark:bg-black/80 backdrop-blur-[2px] flex items-center justify-center p-4 animate-literary-fade">
          <div className="literary-card shadow-2xl max-w-md w-full relative overflow-hidden bg-white dark:bg-[#1C1814] border border-[#E6D7C3] dark:border-[#383028]">
            <div className="h-1.5 w-full bg-[#A83232] absolute top-0 left-0" />

            <div className="p-5 border-b border-[#E6D7C3] dark:border-[#383028] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#FDF3F3] dark:bg-[#331717] border border-[#E8BDBD] flex items-center justify-center text-[#A83232] dark:text-[#E25D5D]">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-heading font-bold text-[#332F2B] dark:text-[#F0E8DE]">
                    Temporarily Close Every {DAY_OF_WEEK_NAMES[closureReasonModalDay]}?
                  </h3>
                  <p className="text-xs text-[#6E665E] dark:text-[#A6998C]">
                    Statistical calculations will exclude all data on this weekday.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setClosureReasonModalDay(null)}
                className="p-1.5 rounded-lg hover:bg-[#FAF5EE] dark:hover:bg-[#25201A] text-[#6E665E] dark:text-[#A6998C] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="p-3.5 rounded-xl bg-[#FDF3F3] dark:bg-[#331717] border border-[#E8BDBD] text-[#A83232] dark:text-[#F5A3A3] flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>
                  Closing <strong>Every {DAY_OF_WEEK_NAMES[closureReasonModalDay]}</strong> will automatically exclude all past and upcoming {DAY_OF_WEEK_NAMES[closureReasonModalDay]} attendance entries from statistical averages, daily charts, and KPI reports. You can reopen this weekday at any time.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] mb-1">
                  Reason for closure (optional)
                </label>
                <input
                  type="text"
                  value={closureReasonText}
                  onChange={(e) => setClosureReasonText(e.target.value)}
                  placeholder="e.g. Scheduled general library sanitation"
                  className="w-full px-3 py-2 rounded-xl bg-[#FAF5EE] dark:bg-[#25201A] border border-[#D6C3A9] dark:border-[#383028] text-xs text-[#332F2B] dark:text-[#F0E8DE]"
                />
              </div>

              <div className="pt-3 border-t border-[#E6D7C3] dark:border-[#383028] flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setClosureReasonModalDay(null)}
                  className="px-4 py-2 rounded-xl border border-[#D6C3A9] dark:border-[#383028] text-xs font-semibold text-[#332F2B] dark:text-[#F0E8DE] hover:bg-[#FAF5EE] dark:hover:bg-[#25201A] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleWeekday(closureReasonModalDay, false, closureReasonText)}
                  className="px-5 py-2 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition shadow-2xs"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>Confirm Temporary Closure</span>
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
