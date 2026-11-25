import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Edit3,
  KeyRound,
  Plus,
  Search,
  Trash2,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LIBRARY_TIME_SLOTS, LibraryArea, StaffRole, UserProfile } from '../types/lirc';
import { downloadJsonBackup } from '../utils/reportExporters';
import {
  formatShortDate,
  formatTimestampPHT,
  getDayOfWeekName,
  getLiteraryAreaColor,
  getTodayPHT,
} from '../utils/statistics';
import {
  BAGGAGE_AREA_ID,
  BAGGAGE_DUTY_AREA,
  checkDutyScheduleConflict,
  CIRCULATION_AREA_ID,
  CIRCULATION_DUTY_AREA,
  DayGroup,
  DAY_GROUP_LABELS,
  DAY_GROUP_ORDER,
  DAY_GROUPS,
  doesAreaRequireStatistics,
  DutyScheduleAssignment,
  encodeDutySchedulesToShiftColumn,
  encodeInviteCodeCarrier,
  encodeRegistrationStaffCode,
  EXEMPT_DUTY_AREAS,
  formatTimeSlotLabel,
  generateRandomInviteCode,
  InvitationCodeRecord,
  isCarrierProfile,
  isCalendarCarrierProfile,
  isNonStatisticalArea,
  isViolationsCarrierProfile,
  ParsedStaffAccount,
  parseInviteCodeCarrier,
  parseStaffAccount,
  SHELVER_AREA_ID,
  SHELVER_DUTY_AREA,
  TECHNICAL_AREA_ID,
  TECHNICAL_DUTY_AREA,
  ENTRANCE_EXIT_AREA_ID,
  ENTRANCE_EXIT_DUTY_AREA,
} from '../utils/invitationWorkflow';

interface LibrarianAdminPanelProps {
  currentUserId?: string;
  currentUserName?: string;
  areas: LibraryArea[];
  onRefreshAreas: () => void;
  onNotify: (type: 'success' | 'error', message: string) => void;
  onPendingCountChange?: (count: number) => void;
  initialOpenDutyScheduleModal?: boolean;
  initialDutyStudentId?: string | null;
  onDutyScheduleModalClose?: () => void;
}

interface DraftDutyBlock {
  tempId: string;
  existingId?: string;
  startTime: string;
  endTime: string;
  areaId: number;
  notes: string;
}

function getNextTimeSlotAfter(slotVal: string, steps = 3): string {
  const idx = LIBRARY_TIME_SLOTS.findIndex((s) => s.value === slotVal);
  if (idx === -1) return '12:00';
  const targetIdx = Math.min(LIBRARY_TIME_SLOTS.length - 1, idx + steps);
  return LIBRARY_TIME_SLOTS[targetIdx].value;
}

export const LibrarianAdminPanel: React.FC<LibrarianAdminPanelProps> = ({
  currentUserId,
  currentUserName = 'Librarian',
  areas,
  onRefreshAreas,
  onNotify,
  onPendingCountChange,
  initialOpenDutyScheduleModal,
  initialDutyStudentId,
  onDutyScheduleModalClose,
}) => {
  const sortedAreas = useMemo(
    () =>
      [...areas]
        .filter((a) => !isNonStatisticalArea(a.name) && a.id !== CIRCULATION_AREA_ID)
        .sort((a, b) => a.display_order - b.display_order)
        .map((a) => ({ ...a, color_hex: getLiteraryAreaColor(a.code, a.color_hex) })),
    [areas]
  );

  // All assignable duty areas: 6 Statistical Library Areas + Exempt Stations (Baggage, Shelver, Technical)
  const assignableDutyAreas = useMemo<LibraryArea[]>(
    () => [...sortedAreas, ...EXEMPT_DUTY_AREAS],
    [sortedAreas]
  );

  const [rawProfiles, setRawProfiles] = useState<UserProfile[]>([]);
  const [loadingStaff, setLoadingStaff] = useState<boolean>(true);
  const [staffSearch, setStaffSearch] = useState<string>('');

  // Invitation Code Generator state
  const [newInviteLabel, setNewInviteLabel] = useState<string>('');
  const [generatingInvite, setGeneratingInvite] = useState<boolean>(false);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [revokingCodeId, setRevokingCodeId] = useState<string | null>(null);

  // Registration Request Review state
  const [requestFilter, setRequestFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>(
    'pending'
  );
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);

  // Dedicated "Duty Schedule Management" Modal state (Individual Weekly Schedules: Monday through Saturday)
  const [showDutyScheduleModal, setShowDutyScheduleModal] = useState<boolean>(false);
  const [dutyStudentId, setDutyStudentId] = useState<string>('');
  const [dutyDayGroup, setDutyDayGroup] = useState<DayGroup>('Monday');
  const [draftBlocks, setDraftBlocks] = useState<DraftDutyBlock[]>([]);
  const [dutyConflictError, setDutyConflictError] = useState<string | null>(null);
  const [savingDutySchedule, setSavingDutySchedule] = useState<boolean>(false);

  useEffect(() => {
    if (initialOpenDutyScheduleModal) {
      if (initialDutyStudentId) {
        setDutyStudentId(initialDutyStudentId);
      }
      setShowDutyScheduleModal(true);
      onDutyScheduleModalClose?.();
    }
  }, [initialOpenDutyScheduleModal, initialDutyStudentId, onDutyScheduleModalClose]);

  // Duty Schedule Modal Filters
  const [filterScheduleStudentId, setFilterScheduleStudentId] = useState<string>('ALL');
  const [filterScheduleAreaId, setFilterScheduleAreaId] = useState<number | 'ALL'>('ALL');
  const [filterScheduleDayGroup, setFilterScheduleDayGroup] = useState<DayGroup | 'ALL'>('ALL');

  // Staff Account Modals state
  const [editingStaff, setEditingStaff] = useState<UserProfile | null>(null);
  const [editPassword, setEditPassword] = useState<string>('');
  const [updatingStaff, setUpdatingStaff] = useState<boolean>(false);
  const [deletingStaff, setDeletingStaff] = useState<UserProfile | null>(null);
  const [removingStaff, setRemovingStaff] = useState<boolean>(false);
  const [exportingBackup, setExportingBackup] = useState<boolean>(false);

  const fetchStaffAccounts = useCallback(async () => {
    setLoadingStaff(true);
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) {
      setRawProfiles(data as UserProfile[]);
    }
    setLoadingStaff(false);
  }, []);

  useEffect(() => {
    fetchStaffAccounts();
  }, [fetchStaffAccounts]);

  // Separate raw user_profiles into:
  // 1) Active Invitation Code carriers
  // 2) Student Assistant Registration Requests (pending / approved / rejected)
  // 3) Active / Approved Staff & Student Assistant Accounts
  // 4) Approved Student Assistants eligible for Duty Schedule Assignment
  // 5) Flat list of all Duty Schedule Assignments across all approved Student Assistants
  const {
    invitationCodes,
    registrationRequests,
    activeStaffAccounts,
    approvedStudentAssistants,
    allDutySchedules,
  } = useMemo(() => {
    const codes: InvitationCodeRecord[] = [];
    const requests: ParsedStaffAccount[] = [];
    const staff: ParsedStaffAccount[] = [];
    const approvedSAs: ParsedStaffAccount[] = [];
    const schedules: DutyScheduleAssignment[] = [];

    rawProfiles.forEach((profile) => {
      // First check for invitation code carrier
      const inviteCarrier = parseInviteCodeCarrier(profile);
      if (inviteCarrier) {
        if (inviteCarrier.isActive) {
          codes.push(inviteCarrier);
        }
        return;
      }

      // Filter out all removed profiles and all sync carrier records (calendar, violations, internal)
      if (
        profile.shift_schedule === 'REMOVED' ||
        isCarrierProfile(profile)
      ) {
        return;
      }

      const parsed = parseStaffAccount(profile);
      if (
        parsed.isRemoved ||
        parsed.isViolationsCarrier ||
        parsed.isCalendarCarrier ||
        parsed.isInviteCarrier
      ) {
        return;
      }

      if (parsed.isRegistrationRequest) {
        requests.push(parsed);
      }

      if (parsed.approvalStatus === 'approved') {
        const normalizedItem: ParsedStaffAccount = {
          ...parsed,
          profile: {
            ...profile,
            staff_code: parsed.displayStaffCode,
          },
        };
        staff.push(normalizedItem);

        if (profile.role === 'student_assistant' && profile.is_active) {
          approvedSAs.push(normalizedItem);
          parsed.dutySchedules.forEach((sched) => {
            schedules.push(sched);
          });
        }
      }
    });

    staff.sort((a, b) => {
      if (a.profile.role !== b.profile.role) {
        return a.profile.role === 'librarian' ? -1 : 1;
      }
      return a.displayStaffCode.localeCompare(b.displayStaffCode);
    });

    approvedSAs.sort((a, b) => a.profile.full_name.localeCompare(b.profile.full_name));

    schedules.sort((a, b) => {
      if (a.dayGroup !== b.dayGroup) {
        return (DAY_GROUP_ORDER[a.dayGroup] || 99) - (DAY_GROUP_ORDER[b.dayGroup] || 99);
      }
      if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
      return a.studentAssistantName.localeCompare(b.studentAssistantName);
    });

    return {
      invitationCodes: codes,
      registrationRequests: requests,
      activeStaffAccounts: staff,
      approvedStudentAssistants: approvedSAs,
      allDutySchedules: schedules,
    };
  }, [rawProfiles]);

  useEffect(() => {
    if (
      approvedStudentAssistants.length > 0 &&
      !approvedStudentAssistants.some((sa) => sa.profile.id === dutyStudentId)
    ) {
      setDutyStudentId(approvedStudentAssistants[0].profile.id);
    }
  }, [approvedStudentAssistants, dutyStudentId]);

  const pendingRequestsCount = useMemo(
    () => registrationRequests.filter((r) => r.approvalStatus === 'pending').length,
    [registrationRequests]
  );

  useEffect(() => {
    onPendingCountChange?.(pendingRequestsCount);
  }, [pendingRequestsCount, onPendingCountChange]);

  const filteredRequests = useMemo(() => {
    if (requestFilter === 'all') return registrationRequests;
    return registrationRequests.filter((r) => r.approvalStatus === requestFilter);
  }, [registrationRequests, requestFilter]);

  const filteredStaff = useMemo(() => {
    const q = staffSearch.trim().toLowerCase();
    if (!q) return activeStaffAccounts;
    return activeStaffAccounts.filter(
      (item) =>
        item.profile.full_name.toLowerCase().includes(q) ||
        item.profile.username.toLowerCase().includes(q) ||
        item.displayStaffCode.toLowerCase().includes(q) ||
        item.profile.role.toLowerCase().includes(q) ||
        item.scheduleSummary.toLowerCase().includes(q)
    );
  }, [activeStaffAccounts, staffSearch]);

  const filteredDutySchedules = useMemo(() => {
    return allDutySchedules.filter((s) => {
      if (filterScheduleStudentId !== 'ALL' && s.studentAssistantId !== filterScheduleStudentId) {
        return false;
      }
      if (filterScheduleAreaId !== 'ALL' && s.areaId !== filterScheduleAreaId) {
        return false;
      }
      if (filterScheduleDayGroup !== 'ALL' && s.dayGroup !== filterScheduleDayGroup) {
        return false;
      }
      return true;
    });
  }, [allDutySchedules, filterScheduleStudentId, filterScheduleAreaId, filterScheduleDayGroup]);

  // Count how many registration requests used each invitation code
  const codeUsageCountMap = useMemo(() => {
    const map = new Map<string, number>();
    registrationRequests.forEach((req) => {
      if (req.inviteCode) {
        map.set(req.inviteCode, (map.get(req.inviteCode) || 0) + 1);
      }
    });
    return map;
  }, [registrationRequests]);

  const defaultAreaId = useMemo(() => {
    const periodicals = sortedAreas.find((a) => a.name.toLowerCase().includes('periodical'));
    return periodicals?.id || sortedAreas[0]?.id || 1;
  }, [sortedAreas]);

  // Load draft blocks for a selected student assistant and day group
  const loadStudentDayGroupBlocks = (studentId: string, dayGroup: DayGroup) => {
    setDutyConflictError(null);
    const existing = allDutySchedules.filter(
      (s) => s.studentAssistantId === studentId && s.dayGroup === dayGroup
    );
    if (existing.length > 0) {
      setDraftBlocks(
        existing.map((s) => ({
          tempId: `edit_${s.id}`,
          existingId: s.id,
          startTime: s.startTime,
          endTime: s.endTime,
          areaId: s.areaId,
          notes: s.notes || '',
        }))
      );
    } else {
      setDraftBlocks([
        {
          tempId: `draft_${Date.now()}_1`,
          startTime: '08:00',
          endTime: '10:00',
          areaId: defaultAreaId,
          notes: '',
        },
      ]);
    }
  };

  // Open Duty Schedule Modal (optionally pre-selecting a specific Student Assistant)
  const openDutyScheduleModal = (preselectStudentId?: string) => {
    setDutyConflictError(null);
    const targetId =
      preselectStudentId ||
      dutyStudentId ||
      (approvedStudentAssistants[0]?.profile.id ?? '');

    setDutyStudentId(targetId);
    setDutyDayGroup('Monday');
    setFilterScheduleStudentId(preselectStudentId ? preselectStudentId : 'ALL');

    loadStudentDayGroupBlocks(targetId, 'Monday');
    setShowDutyScheduleModal(true);
  };

  const handleSelectStudentInBuilder = (studentId: string) => {
    setDutyStudentId(studentId);
    loadStudentDayGroupBlocks(studentId, dutyDayGroup);
  };

  const handleSelectDayGroupInBuilder = (dayGroup: DayGroup) => {
    setDutyDayGroup(dayGroup);
    loadStudentDayGroupBlocks(dutyStudentId, dayGroup);
  };

  // Add another time block row to the current daily rotation builder
  const handleAddDraftBlockRow = () => {
    setDutyConflictError(null);
    setDraftBlocks((prev) => {
      const last = prev[prev.length - 1];
      const nextStart = last ? last.endTime : '08:00';
      const safeStart = nextStart >= '18:00' ? '16:00' : nextStart;
      const nextEnd = getNextTimeSlotAfter(safeStart, 3);
      return [
        ...prev,
        {
          tempId: `draft_${Date.now()}_${prev.length + 1}`,
          startTime: safeStart,
          endTime: nextEnd > safeStart ? nextEnd : '18:00',
          areaId: defaultAreaId,
          notes: '',
        },
      ];
    });
  };


  // Load existing saved blocks for a specific Student Assistant + DayGroup into the builder for editing
  const handleEditScheduleRow = (sched: DutyScheduleAssignment) => {
    setDutyConflictError(null);
    setDutyStudentId(sched.studentAssistantId);
    setDutyDayGroup(sched.dayGroup);
    loadStudentDayGroupBlocks(sched.studentAssistantId, sched.dayGroup);
  };

  const handleUpdateDraftBlock = (
    tempId: string,
    patch: Partial<Omit<DraftDutyBlock, 'tempId'>>
  ) => {
    setDutyConflictError(null);
    setDraftBlocks((prev) => {
      const idx = prev.findIndex((r) => r.tempId === tempId);
      if (idx === -1) return prev;

      const nextBlocks = prev.map((row) => (row.tempId === tempId ? { ...row, ...patch } : row));

      // Automatically connect the starting time to end time:
      // When current row's End Time changes: automatically update next row's Start Time to match
      if (patch.endTime && idx < nextBlocks.length - 1) {
        const currentEnd = patch.endTime;
        const nextRow = nextBlocks[idx + 1];
        let newNextEnd = nextRow.endTime;
        if (newNextEnd <= currentEnd) {
          newNextEnd = getNextTimeSlotAfter(currentEnd, 2);
          if (newNextEnd <= currentEnd) newNextEnd = '18:00';
        }
        nextBlocks[idx + 1] = {
          ...nextRow,
          startTime: currentEnd,
          endTime: newNextEnd,
        };
      }

      // When current row's Start Time changes: automatically update previous row's End Time to match
      if (patch.startTime && idx > 0) {
        const currentStart = patch.startTime;
        const prevRow = nextBlocks[idx - 1];
        nextBlocks[idx - 1] = {
          ...prevRow,
          endTime: currentStart,
        };
      }

      return nextBlocks;
    });
  };

  const handleRemoveDraftBlock = (tempId: string) => {
    setDutyConflictError(null);
    setDraftBlocks((prev) => (prev.length > 1 ? prev.filter((r) => r.tempId !== tempId) : prev));
  };

  // Save all draft blocks for the selected Student Assistant & DayGroup
  const handleSaveDutySchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setDutyConflictError(null);

    const targetSA = approvedStudentAssistants.find((sa) => sa.profile.id === dutyStudentId);
    if (!targetSA) {
      setDutyConflictError('Please select a registered and approved Student Assistant.');
      return;
    }

    if (draftBlocks.length === 0) {
      setDutyConflictError('Please add at least one time period and area assignment.');
      return;
    }

    // 1. Validate each draft row's start < end and check internal overlaps between rows in the builder
    for (let i = 0; i < draftBlocks.length; i++) {
      const blockA = draftBlocks[i];
      if (blockA.startTime >= blockA.endTime) {
        setDutyConflictError(
          `Row #${i + 1}: End time (${formatTimeSlotLabel(
            blockA.endTime
          )}) must be after start time (${formatTimeSlotLabel(blockA.startTime)}).`
        );
        return;
      }

      for (let j = i + 1; j < draftBlocks.length; j++) {
        const blockB = draftBlocks[j];
        if (blockA.startTime < blockB.endTime && blockA.endTime > blockB.startTime) {
          const areaA =
            assignableDutyAreas.find((a) => a.id === Number(blockA.areaId))?.name || 'Area';
          const areaB =
            assignableDutyAreas.find((a) => a.id === Number(blockB.areaId))?.name || 'Area';
          setDutyConflictError(
            `Schedule Conflict in Form: Row #${i + 1} (${areaA}, ${formatTimeSlotLabel(
              blockA.startTime
            )} - ${formatTimeSlotLabel(blockA.endTime)}) overlaps with Row #${
              j + 1
            } (${areaB}, ${formatTimeSlotLabel(blockB.startTime)} - ${formatTimeSlotLabel(
              blockB.endTime
            )}).`
          );
          return;
        }
      }
    }

    // 2. Check against existing saved schedules for this Student Assistant on this dayGroup
    const editingExistingIds = draftBlocks
      .map((b) => b.existingId)
      .filter((id): id is string => Boolean(id));

    for (let i = 0; i < draftBlocks.length; i++) {
      const block = draftBlocks[i];
      const conflict = checkDutyScheduleConflict({
        existingSchedules: allDutySchedules,
        studentAssistantId: targetSA.profile.id,
        dayGroup: dutyDayGroup,
        startTime: block.startTime,
        endTime: block.endTime,
        excludeScheduleIds: editingExistingIds,
      });

      if (conflict) {
        setDutyConflictError(
          `Schedule Conflict: ${targetSA.profile.full_name} is already assigned to ${
            conflict.areaName
          } on ${DAY_GROUP_LABELS[conflict.dayGroup].label} from ${formatTimeSlotLabel(
            conflict.startTime
          )} to ${formatTimeSlotLabel(
            conflict.endTime
          )}. A Student Assistant cannot be assigned to two areas at overlapping times.`
        );
        return;
      }
    }

    setSavingDutySchedule(true);

    const nowIso = new Date().toISOString();
    // Preserve schedules for OTHER day groups (MWF, TTh, Saturday)
    const preservedSchedules = targetSA.dutySchedules.filter((s) => s.dayGroup !== dutyDayGroup);

    const newAssignments: DutyScheduleAssignment[] = draftBlocks.map((block, idx) => {
      const areaObj =
        assignableDutyAreas.find((a) => a.id === Number(block.areaId)) || BAGGAGE_DUTY_AREA;
      const reqStats = doesAreaRequireStatistics(areaObj.id, areaObj.name);

      return {
        id:
          block.existingId ||
          `sched_${targetSA.profile.id}_${dutyDayGroup}_${Date.now()}_${idx}`,
        studentAssistantId: targetSA.profile.id,
        studentAssistantName: targetSA.profile.full_name,
        studentAssistantUsername: targetSA.profile.username,
        studentAssistantCode: targetSA.displayStaffCode,
        areaId: areaObj.id,
        areaName: areaObj.name,
        requiresStatistics: reqStats,
        dayGroup: dutyDayGroup,
        startTime: block.startTime,
        endTime: block.endTime,
        notes: block.notes.trim(),
        updatedAt: nowIso,
        updatedBy: currentUserName,
      };
    });

    const updatedSchedulesList = [...preservedSchedules, ...newAssignments];
    const encodedShiftColumn = encodeDutySchedulesToShiftColumn(updatedSchedulesList);

    const rawTargetProfile = rawProfiles.find((r) => r.id === targetSA.profile.id);
    const preservedStaffCode = rawTargetProfile?.staff_code || targetSA.displayStaffCode;
    const primaryStatisticalAreaId =
      newAssignments.find((a) => a.areaId > 0 && a.requiresStatistics)?.areaId ?? null;

    const { error } = await supabase.rpc('admin_update_staff_account', {
      p_user_id: targetSA.profile.id,
      p_full_name: targetSA.profile.full_name,
      p_username: targetSA.profile.username,
      p_staff_code: preservedStaffCode,
      p_role: 'student_assistant',
      p_assigned_area_id: primaryStatisticalAreaId,
      p_shift_schedule: encodedShiftColumn,
      p_is_active: true,
      p_new_password: null,
    });

    setSavingDutySchedule(false);

    if (error) {
      setDutyConflictError(`Could not save duty schedule: ${error.message}`);
      return;
    }

    const areaChain = newAssignments.map((a) => a.areaName).join(' → ');
    onNotify(
      'success',
      `Saved ${newAssignments.length} rotation block(s) for ${
        targetSA.profile.full_name
      } on ${DAY_GROUP_LABELS[dutyDayGroup].label} (${areaChain}).`
    );

    // Refresh draft blocks with saved IDs
    loadStudentDayGroupBlocks(targetSA.profile.id, dutyDayGroup);
    await fetchStaffAccounts();
  };

  const handleDeleteDutySchedule = async (sched: DutyScheduleAssignment) => {
    const targetSA = approvedStudentAssistants.find(
      (sa) => sa.profile.id === sched.studentAssistantId
    );
    if (!targetSA) return;

    setSavingDutySchedule(true);
    const remainingSchedules = targetSA.dutySchedules.filter((s) => s.id !== sched.id);
    const encodedShiftColumn = encodeDutySchedulesToShiftColumn(remainingSchedules);

    const rawTargetProfile = rawProfiles.find((r) => r.id === targetSA.profile.id);
    const preservedStaffCode = rawTargetProfile?.staff_code || targetSA.displayStaffCode;

    const { error } = await supabase.rpc('admin_update_staff_account', {
      p_user_id: targetSA.profile.id,
      p_full_name: targetSA.profile.full_name,
      p_username: targetSA.profile.username,
      p_staff_code: preservedStaffCode,
      p_role: 'student_assistant',
      p_assigned_area_id: null,
      p_shift_schedule: encodedShiftColumn,
      p_is_active: true,
      p_new_password: null,
    });

    setSavingDutySchedule(false);

    if (error) {
      onNotify('error', `Could not remove duty schedule: ${error.message}`);
      return;
    }

    onNotify(
      'success',
      `Removed duty entry for ${sched.studentAssistantName} (${sched.areaName} · ${
        DAY_GROUP_LABELS[sched.dayGroup].shortDays
      }, ${formatTimeSlotLabel(sched.startTime)} - ${formatTimeSlotLabel(sched.endTime)}).`
    );

    if (dutyStudentId === targetSA.profile.id && dutyDayGroup === sched.dayGroup) {
      setDraftBlocks((prev) => prev.filter((b) => b.existingId !== sched.id));
    }
    await fetchStaffAccounts();
  };

  // Generate a new Invitation Code
  const handleGenerateInvitationCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setGeneratingInvite(true);
    const code = generateRandomInviteCode();
    const carrier = encodeInviteCodeCarrier({
      code,
      label: newInviteLabel.trim() || 'Student Assistant Sign-Up Code',
      createdBy: currentUserName,
    });
    const sysUsername = `invite_${code.toLowerCase().replace(/[^a-z0-9]/g, '')}_${Date.now()
      .toString()
      .slice(-4)}`;
    const sysEmail = `${sysUsername}@lirc.edu.ph`;

    const { error } = await supabase.rpc('admin_create_staff_account', {
      p_email: sysEmail,
      p_username: sysUsername,
      p_password: `Invite_${Date.now()}!`,
      p_full_name: carrier.full_name,
      p_staff_code: carrier.staff_code,
      p_role: 'student_assistant',
      p_assigned_area_id: null,
      p_shift_schedule: carrier.shift_schedule,
    });

    setGeneratingInvite(false);

    if (error) {
      onNotify('error', `Could not generate invitation code: ${error.message}`);
      return;
    }

    setNewInviteLabel('');
    onNotify(
      'success',
      `Generated invitation code ${code}. Share this code with Student Assistants.`
    );
    await fetchStaffAccounts();
  };

  const handleCopyInviteCode = async (item: InvitationCodeRecord) => {
    try {
      await navigator.clipboard.writeText(item.code);
      setCopiedCodeId(item.id);
      setTimeout(() => {
        setCopiedCodeId((prev) => (prev === item.id ? null : prev));
      }, 2500);
    } catch {
      onNotify('error', 'Could not copy code to clipboard.');
    }
  };

  const handleRevokeInviteCode = async (item: InvitationCodeRecord) => {
    setRevokingCodeId(item.id);
    const { error } = await supabase.rpc('admin_update_staff_account', {
      p_user_id: item.id,
      p_full_name: `INVITE_CODE::${item.code}`,
      p_username: `revoked_${item.code.toLowerCase().replace(/[^a-z0-9]/g, '')}_${Date.now()
        .toString()
        .slice(-4)}`,
      p_staff_code: item.code,
      p_role: 'student_assistant',
      p_assigned_area_id: null,
      p_shift_schedule: 'REMOVED',
      p_is_active: false,
      p_new_password: null,
    });
    setRevokingCodeId(null);

    if (error) {
      onNotify('error', `Could not revoke invitation code: ${error.message}`);
      return;
    }

    onNotify('success', `Invitation code ${item.code} has been revoked.`);
    await fetchStaffAccounts();
  };

  // Approve or Reject a Student Assistant Registration Request
  const handleReviewRegistrationRequest = async (
    req: ParsedStaffAccount,
    decision: 'approved' | 'rejected'
  ) => {
    setProcessingRequestId(req.profile.id);

    const updatedStaffCode = encodeRegistrationStaffCode({
      status: decision,
      studentId: req.displayStaffCode,
      inviteCode: req.inviteCode || 'LIRC-INVITE',
      courseDepartment: req.courseDepartment,
    });

    const preservedShift = encodeDutySchedulesToShiftColumn(req.dutySchedules);

    const { error } = await supabase.rpc('admin_update_staff_account', {
      p_user_id: req.profile.id,
      p_full_name: req.profile.full_name,
      p_username: req.profile.username,
      p_staff_code: updatedStaffCode,
      p_role: 'student_assistant',
      p_assigned_area_id: null,
      p_shift_schedule: preservedShift,
      p_is_active: decision === 'approved',
      p_new_password: null,
    });

    setProcessingRequestId(null);

    if (error) {
      onNotify('error', `Could not update registration request: ${error.message}`);
      return;
    }

    if (decision === 'approved') {
      onNotify(
        'success',
        `Approved ${req.profile.full_name} (@${req.profile.username}). You can now assign their daily area rotations in Duty Schedule Management.`
      );
    } else {
      onNotify(
        'success',
        `Rejected registration request from ${req.profile.full_name} (@${req.profile.username}).`
      );
    }

    await fetchStaffAccounts();
  };

  const handleUpdateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStaff) return;
    if (currentUserId && editingStaff.id === currentUserId && editingStaff.role !== 'librarian') {
      onNotify('error', 'You cannot demote your own Librarian account.');
      return;
    }
    setUpdatingStaff(true);

    const rawRow = rawProfiles.find((r) => r.id === editingStaff.id);
    const parsedOrig = rawRow ? parseStaffAccount(rawRow) : null;
    const finalStaffCode =
      parsedOrig && parsedOrig.isRegistrationRequest
        ? encodeRegistrationStaffCode({
            status: parsedOrig.approvalStatus,
            studentId: editingStaff.staff_code,
            inviteCode: parsedOrig.inviteCode || 'LIRC-INVITE',
            courseDepartment: parsedOrig.courseDepartment,
          })
        : editingStaff.staff_code;

    const { error } = await supabase.rpc('admin_update_staff_account', {
      p_user_id: editingStaff.id,
      p_full_name: editingStaff.full_name,
      p_username: editingStaff.username,
      p_staff_code: finalStaffCode,
      p_role: editingStaff.role,
      p_assigned_area_id: null,
      p_shift_schedule: rawRow?.shift_schedule || editingStaff.shift_schedule,
      p_is_active: editingStaff.is_active,
      p_new_password: editPassword.trim() ? editPassword.trim() : null,
    });
    setUpdatingStaff(false);

    if (error) {
      onNotify('error', `Could not update account: ${error.message}`);
      return;
    }

    onNotify('success', `Updated account for ${editingStaff.full_name}.`);
    setEditingStaff(null);
    setEditPassword('');
    await fetchStaffAccounts();
  };

  const handleConfirmDeleteStaff = async () => {
    if (!deletingStaff) return;
    if (currentUserId && deletingStaff.id === currentUserId) {
      onNotify('error', 'You cannot remove your own currently active Librarian account.');
      return;
    }

    setRemovingStaff(true);

    const { error: rpcError } = await supabase.rpc('admin_delete_staff_account', {
      p_user_id: deletingStaff.id,
    });

    if (!rpcError) {
      setRemovingStaff(false);
      onNotify(
        'success',
        `Removed account for ${deletingStaff.full_name} (@${deletingStaff.username}).`
      );
      setDeletingStaff(null);
      setEditingStaff(null);
      await fetchStaffAccounts();
      return;
    }

    const { data: deletedRows, error: delError } = await supabase
      .from('user_profiles')
      .delete()
      .eq('id', deletingStaff.id)
      .select('id');

    if (!delError && deletedRows && deletedRows.length > 0) {
      setRemovingStaff(false);
      onNotify(
        'success',
        `Removed account for ${deletingStaff.full_name} (@${deletingStaff.username}).`
      );
      setDeletingStaff(null);
      setEditingStaff(null);
      await fetchStaffAccounts();
      return;
    }

    const archivedUsername = `removed_${deletingStaff.username}_${Date.now().toString().slice(-5)}`;
    const randomRevokedPass = `Revoked_${Date.now()}!`;
    const { error: archiveError } = await supabase.rpc('admin_update_staff_account', {
      p_user_id: deletingStaff.id,
      p_full_name: deletingStaff.full_name,
      p_username: archivedUsername,
      p_staff_code: deletingStaff.staff_code,
      p_role: deletingStaff.role,
      p_assigned_area_id: null,
      p_shift_schedule: 'REMOVED',
      p_is_active: false,
      p_new_password: randomRevokedPass,
    });

    setRemovingStaff(false);

    if (archiveError) {
      onNotify('error', `Could not remove account: ${archiveError.message}`);
      return;
    }

    onNotify(
      'success',
      `Removed account for ${deletingStaff.full_name} (@${deletingStaff.username}).`
    );
    setDeletingStaff(null);
    setEditingStaff(null);
    await fetchStaffAccounts();
  };

  const handleUpdateAreaCapacity = async (area: LibraryArea, newCapacity: number) => {
    if (Number.isNaN(newCapacity) || newCapacity <= 0 || newCapacity > 2000) return;
    const { error } = await supabase
      .from('library_areas')
      .update({ capacity: Math.round(newCapacity) })
      .eq('id', area.id);
    if (error) {
      onNotify('error', `Could not update capacity: ${error.message}`);
      return;
    }
    await supabase.rpc('log_client_activity', {
      p_action_type: 'area_updated',
      p_description: `Updated ${area.name} capacity to ${Math.round(newCapacity)} seats`,
      p_area_id: area.id,
      p_target_type: 'library_area',
      p_target_id: String(area.id),
      p_metadata: { old_capacity: area.capacity, new_capacity: Math.round(newCapacity) },
    });
    onNotify('success', `Updated ${area.name} capacity to ${Math.round(newCapacity)} seats.`);
    onRefreshAreas();
  };

  const handleExportBackup = async () => {
    setExportingBackup(true);
    const { data, error } = await supabase.rpc('export_system_backup');
    setExportingBackup(false);
    if (error) {
      onNotify('error', `Backup failed: ${error.message}`);
      return;
    }
    downloadJsonBackup(data, getTodayPHT());
    onNotify('success', 'Database backup downloaded.');
  };

  const existingSavedBlocksForSelectedStudentDayGroup = useMemo(
    () =>
      allDutySchedules.filter(
        (s) => s.studentAssistantId === dutyStudentId && s.dayGroup === dutyDayGroup
      ),
    [allDutySchedules, dutyStudentId, dutyDayGroup]
  );

  const studentDayGroupCounts = useMemo(() => {
    const counts: Record<DayGroup, number> = {
      Monday: 0,
      Tuesday: 0,
      Wednesday: 0,
      Thursday: 0,
      Friday: 0,
      Saturday: 0,
      MWF: 0,
      TTh: 0,
    };
    allDutySchedules
      .filter((s) => s.studentAssistantId === dutyStudentId)
      .forEach((s) => {
        if (counts[s.dayGroup] !== undefined) {
          counts[s.dayGroup]++;
        }
      });
    return counts;
  }, [allDutySchedules, dutyStudentId]);

  return (
    <div className="space-y-6 animate-literary-fade">
      {/* =====================================================================
          1. INVITATION CODES GENERATOR & DISTRIBUTION
      ===================================================================== */}
      <div className="literary-card p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[#E6D7C3]">
          <div>
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-[#A83232]" />
              <h2 className="text-lg font-heading font-bold text-[#332F2B]">
                Invitation Codes ({invitationCodes.length})
              </h2>
            </div>
            <p className="text-xs text-[#6E665E] mt-0.5">
              Generate codes for Student Assistant sign-up.
            </p>
          </div>

          <form
            onSubmit={handleGenerateInvitationCode}
            className="flex flex-wrap items-center gap-2 w-full sm:w-auto"
          >
            <input
              type="text"
              value={newInviteLabel}
              onChange={(e) => setNewInviteLabel(e.target.value)}
              placeholder="Optional label (e.g. 1st Sem)"
              className="px-3 py-2 rounded-xl bg-white border border-[#D6C3A9] text-xs text-[#332F2B] w-full sm:w-56"
            />
            <button
              type="submit"
              disabled={generatingInvite}
              className="w-full sm:w-auto px-4 py-2 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 transition"
            >
              <Plus className="w-4 h-4" />
              {generatingInvite ? 'Generating...' : 'Generate Code'}
            </button>
          </form>
        </div>

        {invitationCodes.length === 0 ? (
          <div className="py-6 text-center text-xs text-[#6E665E]">
            No active invitation codes. Click <strong>Generate Code</strong> above to create one.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 pt-4">
            {invitationCodes.map((item) => {
              const usesCount = codeUsageCountMap.get(item.code) || 0;
              const isCopied = copiedCodeId === item.id;
              return (
                <div
                  key={item.id}
                  className="p-4 rounded-xl border border-[#E6D7C3] bg-[#FAF5EE]/70 flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-base text-[#A83232] tracking-wider bg-white px-2.5 py-1 rounded-lg border border-[#D6C3A9]">
                        {item.code}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#F1F5EE] text-[#455436] border border-[#C5D3B8]">
                        Active
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-[#332F2B] mt-2.5 truncate">
                      {item.label}
                    </div>
                    <div className="text-[11px] font-stat text-[#6E665E] mt-0.5">
                      {usesCount} registration request(s) · Created {formatTimestampPHT(item.createdAt)}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-[#E6D7C3]">
                    <button
                      type="button"
                      onClick={() => handleCopyInviteCode(item)}
                      className="flex-1 py-1.5 px-3 rounded-lg bg-white hover:bg-[#F5EBDD] border border-[#D6C3A9] text-[#332F2B] text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition"
                    >
                      {isCopied ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-[#71865A]" />
                          <span className="text-[#455436]">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-[#A83232]" />
                          <span>Copy Code</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={revokingCodeId === item.id}
                      onClick={() => handleRevokeInviteCode(item)}
                      className="py-1.5 px-2.5 rounded-lg border border-[#E8BDBD] bg-[#FDF3F3] hover:bg-[#A83232] text-[#A83232] hover:text-white text-xs font-semibold cursor-pointer transition disabled:opacity-50"
                      title="Revoke Invitation Code"
                    >
                      {revokingCodeId === item.id ? '...' : 'Revoke'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* =====================================================================
          2. STUDENT ASSISTANT REGISTRATION REQUESTS (APPROVE / REJECT)
      ===================================================================== */}
      <div className="literary-card overflow-hidden">
        <div className="p-5 border-b border-[#E6D7C3] flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-heading font-bold text-[#332F2B]">
                Student Assistant Registration Requests
              </h2>
              {pendingRequestsCount > 0 && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-stat font-bold bg-[#FEF9EC] text-[#7D5B06] border border-[#E7B84B]">
                  {pendingRequestsCount} Pending
                </span>
              )}
            </div>
            <p className="text-xs text-[#6E665E] mt-0.5">
              Approve or reject Student Assistant applicants.
            </p>
          </div>

          <div className="flex items-center gap-1 bg-[#F5EBDD] p-1 rounded-xl border border-[#E6D7C3] overflow-x-auto max-w-full">
            {(
              [
                {
                  id: 'pending',
                  label: `Pending (${
                    registrationRequests.filter((r) => r.approvalStatus === 'pending').length
                  })`,
                },
                {
                  id: 'approved',
                  label: `Approved (${
                    registrationRequests.filter((r) => r.approvalStatus === 'approved').length
                  })`,
                },
                {
                  id: 'rejected',
                  label: `Rejected (${
                    registrationRequests.filter((r) => r.approvalStatus === 'rejected').length
                  })`,
                },
                { id: 'all', label: `All (${registrationRequests.length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setRequestFilter(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition shrink-0 whitespace-nowrap ${
                  requestFilter === tab.id
                    ? 'bg-[#A83232] text-white shadow-xs'
                    : 'text-[#6E665E] hover:text-[#332F2B]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {filteredRequests.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#6E665E]">
            {requestFilter === 'pending'
              ? 'No pending registration requests.'
              : 'No registration requests found.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#FAF5EE] border-b border-[#E6D7C3] text-[#332F2B]">
                <tr>
                  <th className="py-3 px-4 font-semibold whitespace-nowrap">Applicant &amp; Student ID</th>
                  <th className="py-3 px-4 font-semibold whitespace-nowrap">Username</th>
                  <th className="py-3 px-4 font-semibold whitespace-nowrap">Course / Department</th>
                  <th className="py-3 px-4 font-semibold whitespace-nowrap">Invitation Code</th>
                  <th className="py-3 px-4 font-semibold whitespace-nowrap">Submitted</th>
                  <th className="py-3 px-4 font-semibold whitespace-nowrap">Status</th>
                  <th className="py-3 px-4 font-semibold text-right whitespace-nowrap">Review Decision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6D7C3]/60 bg-white">
                {filteredRequests.map((req) => {
                  const isBusy = processingRequestId === req.profile.id;
                  return (
                    <tr key={req.profile.id} className="hover:bg-[#FAF5EE]/70 transition-colors">
                      <td className="py-3 px-4 font-semibold text-[#332F2B]">
                        <div>{req.profile.full_name}</div>
                        <div className="text-[11px] font-stat font-normal text-[#6E665E]">
                          ID: {req.displayStaffCode}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-mono font-semibold text-[#A83232]">
                          @{req.profile.username}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-[#332F2B]">{req.courseDepartment}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-mono font-bold text-[#332F2B] bg-[#FAF5EE] px-2.5 py-1 rounded-lg border border-[#D6C3A9]">
                          {req.inviteCode || 'N/A'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-stat text-[#6E665E] whitespace-nowrap">
                        {formatTimestampPHT(req.profile.created_at)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {req.approvalStatus === 'pending' && (
                          <span className="inline-flex items-center whitespace-nowrap gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#FEF9EC] text-[#7D5B06] border border-[#E7B84B]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#E7B84B]" />
                            Pending Approval
                          </span>
                        )}
                        {req.approvalStatus === 'approved' && (
                          <span className="inline-flex items-center whitespace-nowrap gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#F1F5EE] text-[#455436] border border-[#C5D3B8]">
                            <CheckCircle2 className="w-3 h-3 text-[#71865A]" />
                            Approved
                          </span>
                        )}
                        {req.approvalStatus === 'rejected' && (
                          <span className="inline-flex items-center whitespace-nowrap gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#FDF3F3] text-[#A83232] border border-[#E8BDBD]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#A83232]" />
                            Rejected
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-2">
                          {req.approvalStatus !== 'approved' && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleReviewRegistrationRequest(req, 'approved')}
                              className="px-3 py-1.5 rounded-lg bg-[#71865A] hover:bg-[#5E7149] text-white font-semibold inline-flex items-center gap-1 cursor-pointer transition disabled:opacity-50"
                            >
                              <UserCheck className="w-3.5 h-3.5" />
                              Approve
                            </button>
                          )}
                          {req.approvalStatus === 'approved' && (
                            <button
                              type="button"
                              onClick={() => openDutyScheduleModal(req.profile.id)}
                              className="px-3 py-1.5 rounded-lg border border-[#D6C3A9] bg-white hover:bg-[#F5EBDD] text-[#332F2B] font-semibold inline-flex items-center gap-1 cursor-pointer transition"
                            >
                              <CalendarClock className="w-3.5 h-3.5 text-[#A83232]" />
                              Assign Duty
                            </button>
                          )}
                          {req.approvalStatus !== 'rejected' && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleReviewRegistrationRequest(req, 'rejected')}
                              className="px-3 py-1.5 rounded-lg border border-[#E8BDBD] bg-[#FDF3F3] hover:bg-[#A83232] text-[#A83232] hover:text-white font-semibold inline-flex items-center gap-1 cursor-pointer transition disabled:opacity-50"
                            >
                              <UserX className="w-3.5 h-3.5" />
                              Reject
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* =====================================================================
          3. ACTIVE STAFF & STUDENT ASSISTANT ACCOUNTS + DUTY SCHEDULE LAUNCHER
      ===================================================================== */}
      <div className="literary-card overflow-hidden">
        <div className="p-5 border-b border-[#E6D7C3] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-heading font-bold text-[#332F2B]">
              Active Staff &amp; Student Assistant Roster ({filteredStaff.length})
            </h2>
            <p className="text-xs text-[#6E665E] mt-0.5">
              Manage approved Librarian and Student Assistant accounts, roles, and multi-area daily duty schedules.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
            <div className="relative w-full sm:w-56">
              <Search className="w-3.5 h-3.5 text-[#6E665E] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={staffSearch}
                onChange={(e) => setStaffSearch(e.target.value)}
                placeholder="Search name, username, ID..."
                className="pl-8 pr-3 py-2 rounded-xl bg-white border border-[#D6C3A9] text-xs text-[#332F2B] w-full"
              />
            </div>
            <button
              type="button"
              onClick={() => openDutyScheduleModal()}
              className="w-full sm:w-auto px-4 py-2 rounded-xl border border-[#A83232] bg-[#FDF3F3] hover:bg-[#A83232] text-[#A83232] hover:text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition"
            >
              <CalendarClock className="w-4 h-4" />
              Duty Schedules ({allDutySchedules.length})
            </button>
          </div>
        </div>

        {loadingStaff ? (
          <div className="p-8 text-center text-xs text-[#6E665E]">Loading accounts...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#FAF5EE] border-b border-[#E6D7C3] text-[#332F2B]">
                <tr>
                  <th className="py-3 px-4 font-semibold whitespace-nowrap">Full Name</th>
                  <th className="py-3 px-4 font-semibold whitespace-nowrap">Username</th>
                  <th className="py-3 px-4 font-semibold whitespace-nowrap">Role</th>
                  <th className="py-3 px-4 font-semibold whitespace-nowrap">Assigned Duty Schedule</th>
                  <th className="py-3 px-4 font-semibold whitespace-nowrap">Status</th>
                  <th className="py-3 px-4 font-semibold text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6D7C3]/60 bg-white">
                {filteredStaff.map((item) => {
                  const st = item.profile;
                  const isSelf = Boolean(currentUserId && st.id === currentUserId);
                  return (
                    <tr key={st.id} className="hover:bg-[#FAF5EE]/70 transition-colors">
                      <td className="py-3 px-4 font-semibold text-[#332F2B]">
                        <div className="flex items-center gap-2">
                          <span>{st.full_name}</span>
                          {isSelf && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#FEF9EC] text-[#7D5B06] border border-[#E7B84B]/60">
                              You
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-stat font-normal text-[#6E665E]">
                          {item.displayStaffCode}
                          {item.courseDepartment ? ` · ${item.courseDepartment}` : ''}
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-mono font-semibold text-[#A83232]">@{st.username}</div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center whitespace-nowrap px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                            st.role === 'librarian'
                              ? 'bg-[#FDF3F3] text-[#A83232] border-[#E8BDBD]'
                              : 'bg-[#F1F5EE] text-[#455436] border-[#C5D3B8]'
                          }`}
                        >
                          {st.role === 'librarian' ? 'Librarian' : 'Student Assistant'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {st.role === 'student_assistant' ? (
                          <button
                            type="button"
                            onClick={() => openDutyScheduleModal(st.id)}
                            className="px-2.5 py-1 rounded-md border border-[#D6C3A9] bg-[#FAF5EE] hover:bg-[#F5EBDD] text-[#A83232] text-[11px] font-semibold cursor-pointer transition whitespace-nowrap"
                          >
                            Manage
                          </button>
                        ) : (
                          <span className="text-[#6E665E] font-stat">{item.scheduleSummary}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center whitespace-nowrap gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                            st.is_active
                              ? 'bg-[#F1F5EE] text-[#455436] border-[#C5D3B8]'
                              : 'bg-[#FAF5EE] text-[#6E665E] border-[#E6D7C3]'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              st.is_active ? 'bg-[#71865A]' : 'bg-[#6E665E]'
                            }`}
                          />
                          {st.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingStaff(st)}
                            className="px-3 py-1.5 rounded-lg border border-[#D6C3A9] bg-white hover:bg-[#F5EBDD] text-[#332F2B] font-semibold cursor-pointer transition"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={isSelf}
                            onClick={() => setDeletingStaff(st)}
                            title={
                              isSelf
                                ? 'You cannot remove your own active Librarian account'
                                : `Remove ${st.full_name}`
                            }
                            className="px-3 py-1.5 rounded-lg border border-[#E8BDBD] bg-[#FDF3F3] hover:bg-[#A83232] text-[#A83232] hover:text-white font-semibold inline-flex items-center gap-1 cursor-pointer transition disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* =====================================================================
          4. SIX MONITORED LIBRARY AREAS
      ===================================================================== */}
      <div className="literary-card p-5">
        <div className="mb-4 pb-3 border-b border-[#E6D7C3]">
          <h2 className="text-lg font-heading font-bold text-[#332F2B]">
            Library Areas &amp; Seating Capacities
          </h2>
          <p className="text-xs text-[#6E665E] mt-0.5">
            Quickly adjust seating capacities below. To add new areas, rename existing halls, or remove areas, visit <strong className="text-[#A83232]">Advanced Settings</strong>.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {sortedAreas.map((area) => (
            <div
              key={area.id}
              className="p-4 rounded-xl border border-[#E6D7C3] bg-[#FAF5EE]/60 flex items-center justify-between gap-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: area.color_hex }}
                  />
                  <span className="font-heading font-bold text-base text-[#332F2B]">
                    {area.name}
                  </span>
                  <span className="text-[11px] font-semibold text-[#6E665E] bg-[#F5EBDD] px-2 py-0.5 rounded-md font-mono">
                    {area.code}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <label className="block text-[10px] font-semibold text-[#6E665E] mb-1">
                  Max Seats
                </label>
                <input
                  type="number"
                  min={1}
                  max={2000}
                  defaultValue={area.capacity}
                  onBlur={(e) => {
                    const val = Number(e.target.value);
                    if (val !== area.capacity && val > 0) {
                      handleUpdateAreaCapacity(area, val);
                    }
                  }}
                  className="w-20 px-2.5 py-1.5 rounded-lg bg-white border border-[#D6C3A9] text-xs font-stat font-bold text-[#332F2B] text-right"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* =====================================================================
          5. INSTITUTIONAL DATABASE BACKUP
      ===================================================================== */}
      <div className="literary-card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white">
        <div>
          <h2 className="text-lg font-heading font-bold text-[#332F2B]">
            Institutional Database Backup
          </h2>
          <p className="text-xs text-[#6E665E] mt-0.5">
            Download a complete JSON archive of all occupancy records, library areas, reports, and activity logs.
          </p>
        </div>
        <button
          type="button"
          disabled={exportingBackup}
          onClick={handleExportBackup}
          className="shrink-0 px-4 py-2.5 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-white text-xs font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-50 transition"
        >
          <Download className="w-4 h-4 text-[#E7B84B]" />
          {exportingBackup ? 'Preparing...' : 'Download Backup (.json)'}
        </button>
      </div>

      {/* =====================================================================
          DEDICATED "DUTY SCHEDULE MANAGEMENT" MODAL (MULTI-AREA DAILY ROTATIONS)
      ===================================================================== */}
      {showDutyScheduleModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-[#332F2B]/65 dark:bg-black/80 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-4 animate-literary-fade">
          <div className="literary-card shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col relative overflow-hidden">
            <div className="h-1.5 w-full bg-gradient-to-r from-[#A83232] via-[#E7B84B] to-[#71865A] absolute top-0 left-0" />

            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-[#E6D7C3] flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#FDF3F3] border border-[#E8BDBD] flex items-center justify-center text-[#A83232] shrink-0">
                  <CalendarClock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-heading font-bold text-[#332F2B]">
                    Duty Schedule Management
                  </h3>
                  <p className="text-xs text-[#6E665E]">
                    Assign fixed weekly schedules (MWF, TTh, Saturday) and area rotations.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowDutyScheduleModal(false);
                  setDutyConflictError(null);
                }}
                className="p-1.5 rounded-lg hover:bg-[#F5EBDD] text-[#6E665E] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Scrollable Content */}
            <div className="p-3.5 sm:p-5 overflow-y-auto space-y-6">
              {/* Multi-Area Daily Schedule Builder Form */}
              <form
                onSubmit={handleSaveDutySchedule}
                className="p-3.5 sm:p-5 rounded-xl bg-[#FAF5EE] border border-[#E6D7C3] space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-[#A83232]">
                      Configure Area Rotations
                    </span>
                    <p className="text-[11px] text-[#6E665E] mt-0.5">
                      Select assistant, schedule day (Monday–Saturday), and time slots.
                    </p>
                  </div>
                </div>

                {dutyConflictError && (
                  <div className="p-3 rounded-xl bg-[#FDF3F3] border border-[#A83232]/40 text-[#A83232] text-xs font-medium flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{dutyConflictError}</span>
                  </div>
                )}

                {approvedStudentAssistants.length === 0 ? (
                  <div className="p-3 rounded-xl bg-[#FEF9EC] border border-[#E7B84B] text-[#7D5B06] text-xs">
                    No approved Student Assistants available. Approve a Student Assistant registration request first to assign duty schedules.
                  </div>
                ) : (
                  <>
                    {/* Top Row: Student Assistant Selector */}
                    <div className="pb-3 border-b border-[#E6D7C3]">
                      <label className="block text-xs font-semibold text-[#332F2B] mb-1">
                        1. Select Approved Student Assistant
                      </label>
                      <select
                        value={dutyStudentId}
                        onChange={(e) => handleSelectStudentInBuilder(e.target.value)}
                        className="w-full h-10 px-3 rounded-xl bg-white border border-[#D6C3A9] text-xs font-medium text-[#332F2B]"
                      >
                        {approvedStudentAssistants.map((sa) => (
                          <option key={sa.profile.id} value={sa.profile.id}>
                            {sa.profile.full_name} (@{sa.profile.username} · {sa.displayStaffCode})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Schedule Day Tabs */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-[#332F2B]">
                        2. Select Duty Schedule Day
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                        {DAY_GROUPS.map((group) => {
                          const isSelected = dutyDayGroup === group;
                          const count = studentDayGroupCounts[group] || 0;
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
                              onClick={() => handleSelectDayGroupInBuilder(group)}
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
                                </div>
                                <span
                                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold font-stat shrink-0 ${
                                    count > 0
                                      ? 'bg-[#F1F5EE] text-[#455436] border border-[#C5D3B8]'
                                      : 'bg-[#FAF5EE] text-[#6E665E] border border-[#E6D7C3]'
                                  }`}
                                >
                                  {count}
                                </span>
                              </div>
                              <div className="text-[11px] font-semibold text-[#6E665E]">
                                {group}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Multi-Row Time & Area Rotation Table Builder */}
                    <div className="space-y-2.5 pt-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="text-xs font-semibold text-[#332F2B]">
                          3. Area Rotations for {DAY_GROUP_LABELS[dutyDayGroup].label} ({draftBlocks.length}{' '}
                          {draftBlocks.length === 1 ? 'rotation' : 'rotations'})
                        </label>
                        <button
                          type="button"
                          onClick={handleAddDraftBlockRow}
                          className="px-3 py-1.5 rounded-lg bg-white hover:bg-[#F5EBDD] border border-[#A83232] text-[#A83232] text-xs font-semibold inline-flex items-center gap-1 cursor-pointer transition shadow-2xs"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add Time Period / Area Row
                        </button>
                      </div>

                      <div className="overflow-x-auto rounded-xl border border-[#E6D7C3] bg-white">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-[#F5EBDD]/70 border-b border-[#E6D7C3] text-[#332F2B]">
                            <tr>
                              <th className="py-2.5 px-3 font-semibold whitespace-nowrap">#</th>
                              <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Start Time</th>
                              <th className="py-2.5 px-3 font-semibold whitespace-nowrap">End Time</th>
                              <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Assigned Area</th>
                              <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Attendance Statistics</th>
                              <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Notes (Optional)</th>
                              <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Remove</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#E6D7C3]/60">
                            {draftBlocks.map((block, idx) => {
                              const areaObj =
                                assignableDutyAreas.find((a) => a.id === Number(block.areaId)) ||
                                BAGGAGE_DUTY_AREA;
                              const requiresStats = doesAreaRequireStatistics(
                                areaObj.id,
                                areaObj.name
                              );
                              return (
                                <tr key={block.tempId} className="hover:bg-[#FAF5EE]/60">
                                  <td className="py-2.5 px-3 font-stat font-bold text-[#6E665E]">
                                    {idx + 1}
                                  </td>
                                  <td className="py-2.5 px-3 whitespace-nowrap">
                                    <select
                                      value={block.startTime}
                                      onChange={(e) =>
                                        handleUpdateDraftBlock(block.tempId, {
                                          startTime: e.target.value,
                                        })
                                      }
                                      className="h-9 px-2.5 rounded-lg bg-white border border-[#D6C3A9] text-xs font-stat font-semibold text-[#332F2B] min-w-[125px]"
                                    >
                                      {LIBRARY_TIME_SLOTS.map((slot) => (
                                        <option key={slot.value} value={slot.value}>
                                          {formatTimeSlotLabel(slot.value)}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                  <td className="py-2.5 px-3 whitespace-nowrap">
                                    <select
                                      value={block.endTime}
                                      onChange={(e) =>
                                        handleUpdateDraftBlock(block.tempId, {
                                          endTime: e.target.value,
                                        })
                                      }
                                      className="h-9 px-2.5 rounded-lg bg-white border border-[#D6C3A9] text-xs font-stat font-semibold text-[#332F2B] min-w-[125px]"
                                    >
                                      {LIBRARY_TIME_SLOTS.slice(1).map((slot) => (
                                        <option key={slot.value} value={slot.value}>
                                          {formatTimeSlotLabel(slot.value)}
                                        </option>
                                      ))}
                                      <option value="18:00">6:00 PM</option>
                                    </select>
                                  </td>
                                  <td className="py-2.5 px-3 whitespace-nowrap">
                                    <select
                                      value={block.areaId}
                                      onChange={(e) =>
                                        handleUpdateDraftBlock(block.tempId, {
                                          areaId: Number(e.target.value),
                                        })
                                      }
                                      className="h-9 px-2.5 rounded-lg bg-white border border-[#D6C3A9] text-xs font-semibold text-[#332F2B] min-w-[180px]"
                                    >
                                      <optgroup label="Statistical Library Areas (Statistics Required)">
                                        {sortedAreas.map((area) => (
                                          <option key={area.id} value={area.id}>
                                            {area.name}
                                          </option>
                                        ))}
                                      </optgroup>
                                      <optgroup label="Exempt Duty Stations (No Statistics Required)">
                                        <option value={CIRCULATION_AREA_ID}>
                                          Circulation (No Statistics)
                                        </option>
                                        <option value={BAGGAGE_AREA_ID}>
                                          Baggage (No Statistics)
                                        </option>
                                        <option value={SHELVER_AREA_ID}>
                                          Shelver (No Statistics)
                                        </option>
                                        <option value={TECHNICAL_AREA_ID}>
                                          Technical (No Statistics)
                                        </option>
                                        <option value={ENTRANCE_EXIT_AREA_ID}>
                                          Entrance/Exit (No Statistics)
                                        </option>
                                      </optgroup>
                                    </select>
                                  </td>
                                  <td className="py-2.5 px-3 whitespace-nowrap">
                                    {requiresStats ? (
                                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#F1F5EE] text-[#455436] border border-[#C5D3B8]">
                                        <CheckCircle2 className="w-3 h-3 text-[#71865A]" />
                                        Required
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#FEF9EC] text-[#7D5B06] border border-[#E7B84B]">
                                        Not Required
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <input
                                      type="text"
                                      value={block.notes}
                                      onChange={(e) =>
                                        handleUpdateDraftBlock(block.tempId, {
                                          notes: e.target.value,
                                        })
                                      }
                                      placeholder="Optional note..."
                                      className="h-9 px-2.5 rounded-lg bg-white border border-[#D6C3A9] text-xs text-[#332F2B] w-full min-w-[140px]"
                                    />
                                  </td>
                                  <td className="py-2.5 px-3 text-right">
                                    <button
                                      type="button"
                                      disabled={draftBlocks.length <= 1}
                                      onClick={() => handleRemoveDraftBlock(block.tempId)}
                                      className="p-1.5 rounded-lg border border-[#E8BDBD] bg-[#FDF3F3] hover:bg-[#A83232] text-[#A83232] hover:text-white cursor-pointer transition disabled:opacity-30 disabled:cursor-not-allowed"
                                      title="Remove this row"
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
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <span className="text-[11px] text-[#6E665E]">
                        Tip: You can assign multiple time periods to one Student Assistant within a day (e.g. 8:00–10:00 Periodicals, 10:00–11:30 Baggage, 11:30–1:00 Periodicals, 1:00–2:00 Filipiniana).
                      </span>
                      <button
                        type="submit"
                        disabled={savingDutySchedule || approvedStudentAssistants.length === 0}
                        className="px-5 py-2.5 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 transition shrink-0 shadow-xs"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        {savingDutySchedule
                          ? 'Saving Schedule...'
                          : `Save ${DAY_GROUP_LABELS[dutyDayGroup].label} (${draftBlocks.length} ${
                              draftBlocks.length === 1 ? 'Entry' : 'Entries'
                            })`}
                      </button>
                    </div>
                  </>
                )}
              </form>

              {/* Assigned Duty Schedules Ledger */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-heading font-bold text-[#332F2B]">
                      All Assigned Duty Schedule Entries ({filteredDutySchedules.length})
                    </h4>
                    <p className="text-[11px] text-[#6E665E]">
                      Fixed weekly rotation schedule across Student Assistants, library areas, and time slots.
                    </p>
                  </div>

                  {/* Filter Controls */}
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={filterScheduleStudentId}
                      onChange={(e) => setFilterScheduleStudentId(e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg bg-white border border-[#D6C3A9] text-xs text-[#332F2B]"
                    >
                      <option value="ALL">All Student Assistants</option>
                      {approvedStudentAssistants.map((sa) => (
                        <option key={sa.profile.id} value={sa.profile.id}>
                          {sa.profile.full_name}
                        </option>
                      ))}
                    </select>

                    <select
                      value={filterScheduleAreaId}
                      onChange={(e) =>
                        setFilterScheduleAreaId(
                          e.target.value === 'ALL' ? 'ALL' : Number(e.target.value)
                        )
                      }
                      className="px-2.5 py-1.5 rounded-lg bg-white border border-[#D6C3A9] text-xs text-[#332F2B]"
                    >
                      <option value="ALL">All Areas (Including Exempt Stations)</option>
                      {assignableDutyAreas.map((area) => (
                        <option key={area.id} value={area.id}>
                          {area.name}
                        </option>
                      ))}
                    </select>

                    <select
                      value={filterScheduleDayGroup}
                      onChange={(e) =>
                        setFilterScheduleDayGroup(
                          e.target.value === 'ALL' ? 'ALL' : (e.target.value as DayGroup)
                        )
                      }
                      className="px-2.5 py-1.5 rounded-lg bg-white border border-[#D6C3A9] text-xs font-semibold text-[#332F2B]"
                    >
                      <option value="ALL">All Days (Mon – Sat)</option>
                      <option value="Monday">Monday</option>
                      <option value="Tuesday">Tuesday</option>
                      <option value="Wednesday">Wednesday</option>
                      <option value="Thursday">Thursday</option>
                      <option value="Friday">Friday</option>
                      <option value="Saturday">Saturday</option>
                    </select>
                  </div>
                </div>

                {filteredDutySchedules.length === 0 ? (
                  <div className="p-8 rounded-xl border border-[#E6D7C3] bg-white text-center text-xs text-[#6E665E]">
                    No duty schedules match filter.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-[#E6D7C3]">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#FAF5EE] border-b border-[#E6D7C3] text-[#332F2B]">
                        <tr>
                          <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">Student Assistant</th>
                          <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">Schedule Day</th>
                          <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">Time</th>
                          <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">Assigned Area</th>
                          <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">Attendance Statistics</th>
                          <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">Last Updated</th>
                          <th className="py-2.5 px-3.5 font-semibold text-right whitespace-nowrap">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E6D7C3]/60 bg-white">
                        {filteredDutySchedules.map((sched) => {
                          const areaObj =
                            assignableDutyAreas.find((a) => a.id === sched.areaId) ||
                            BAGGAGE_DUTY_AREA;
                          const isEditingThis =
                            dutyStudentId === sched.studentAssistantId &&
                            dutyDayGroup === sched.dayGroup &&
                            draftBlocks.some((b) => b.existingId === sched.id);
                          return (
                            <tr
                              key={sched.id}
                              className={
                                isEditingThis
                                  ? 'bg-[#FEF9EC]'
                                  : 'hover:bg-[#FAF5EE]/70 transition-colors'
                              }
                            >
                              <td className="py-2.5 px-3.5">
                                <div className="font-semibold text-[#332F2B]">
                                  {sched.studentAssistantName}
                                </div>
                                <div className="text-[11px] font-mono text-[#A83232]">
                                  @{sched.studentAssistantUsername} ·{' '}
                                  <span className="font-stat text-[#6E665E]">
                                    {sched.studentAssistantCode}
                                  </span>
                                </div>
                              </td>
                              <td className="py-2.5 px-3.5 whitespace-nowrap">
                                <span
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                                    sched.dayGroup === 'Monday' || sched.dayGroup === 'MWF'
                                      ? 'bg-[#FDF3F3] text-[#A83232] border border-[#E8BDBD]'
                                      : sched.dayGroup === 'Tuesday' || sched.dayGroup === 'TTh'
                                      ? 'bg-[#FEF9EC] text-[#7D5B06] border border-[#E7B84B]'
                                      : sched.dayGroup === 'Wednesday'
                                      ? 'bg-[#F1F5EE] text-[#455436] border border-[#C5D3B8]'
                                      : sched.dayGroup === 'Thursday'
                                      ? 'bg-[#FBF4EE] text-[#8F4B38] border border-[#E8C2B3]'
                                      : sched.dayGroup === 'Friday'
                                      ? 'bg-[#EEF5F2] text-[#2E5A44] border border-[#BBD5C5]'
                                      : 'bg-[#F5F2EF] text-[#332F2B] border border-[#D6C3A9]'
                                  }`}
                                >
                                  {DAY_GROUP_LABELS[sched.dayGroup]?.label || sched.dayGroup}
                                </span>
                                <div className="text-[10px] text-[#6E665E] mt-0.5">
                                  {DAY_GROUP_LABELS[sched.dayGroup]?.subLabel || ''}
                                </div>
                              </td>
                              <td className="py-2.5 px-3.5 font-stat whitespace-nowrap">
                                <span className="px-2.5 py-1 rounded-lg bg-[#FAF5EE] text-[#332F2B] border border-[#D6C3A9] font-semibold">
                                  {formatTimeSlotLabel(sched.startTime)} -{' '}
                                  {formatTimeSlotLabel(sched.endTime)}
                                </span>
                              </td>
                              <td className="py-2.5 px-3.5">
                                <span className="inline-flex items-center gap-1.5 font-semibold text-[#332F2B]">
                                  <span
                                    className="w-2.5 h-2.5 rounded-full shrink-0"
                                    style={{
                                      backgroundColor: areaObj.color_hex || '#A83232',
                                    }}
                                  />
                                  {sched.areaName}
                                </span>
                                {sched.notes && (
                                  <div className="text-[11px] text-[#6E665E] mt-0.5">
                                    {sched.notes}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3.5 whitespace-nowrap">
                                {sched.requiresStatistics ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#F1F5EE] text-[#455436] border border-[#C5D3B8]">
                                    <CheckCircle2 className="w-3 h-3 text-[#71865A]" />
                                    Required
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#FEF9EC] text-[#7D5B06] border border-[#E7B84B]">
                                    Not Required
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3.5 text-[11px] text-[#6E665E]">
                                <div>By {sched.updatedBy}</div>
                                <div className="font-stat">{formatTimestampPHT(sched.updatedAt)}</div>
                              </td>
                              <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleEditScheduleRow(sched)}
                                    className="px-2.5 py-1 rounded-lg border border-[#D6C3A9] bg-white hover:bg-[#F5EBDD] text-[#332F2B] font-semibold inline-flex items-center gap-1 cursor-pointer transition"
                                  >
                                    <Edit3 className="w-3 h-3" />
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    disabled={savingDutySchedule}
                                    onClick={() => handleDeleteDutySchedule(sched)}
                                    className="px-2.5 py-1 rounded-lg border border-[#E8BDBD] bg-[#FDF3F3] hover:bg-[#A83232] text-[#A83232] hover:text-white font-semibold inline-flex items-center gap-1 cursor-pointer transition disabled:opacity-50"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    Remove
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-[#E6D7C3] bg-[#FAF5EE] flex items-center justify-between">
              <span className="text-xs text-[#6E665E]">
                Student Assistants automatically receive notifications for their next assigned area and rotation schedule.
              </span>
              <button
                type="button"
                onClick={() => {
                  setShowDutyScheduleModal(false);
                  setDutyConflictError(null);
                }}
                className="px-4 py-2 rounded-xl bg-[#332F2B] hover:bg-[#1E1B18] text-white text-xs font-semibold cursor-pointer transition"
              >
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Edit User Modal */}
      {editingStaff && createPortal(
        <div className="fixed inset-0 z-[9999] bg-[#332F2B]/65 dark:bg-black/80 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-4 animate-literary-fade">
          <div className="literary-card shadow-2xl max-w-md w-full p-4 sm:p-6 relative overflow-hidden max-h-[92vh] overflow-y-auto">
            <div className="h-1 w-full bg-[#E7B84B] absolute top-0 left-0" />
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base sm:text-lg font-heading font-bold text-[#332F2B]">
                Edit User Account &amp; Role
              </h3>
              <button
                type="button"
                onClick={() => {
                  setEditingStaff(null);
                  setEditPassword('');
                }}
                className="p-1.5 rounded-lg hover:bg-[#F5EBDD] text-[#6E665E] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleUpdateStaff} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#332F2B] mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={editingStaff.full_name}
                  onChange={(e) => setEditingStaff({ ...editingStaff, full_name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-white border border-[#D6C3A9] text-sm text-[#332F2B]"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#332F2B] mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    required
                    value={editingStaff.username}
                    onChange={(e) =>
                      setEditingStaff({ ...editingStaff, username: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-white border border-[#D6C3A9] text-sm text-[#332F2B]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#332F2B] mb-1">
                    Assigned Role
                    {Boolean(currentUserId && editingStaff.id === currentUserId) && (
                      <span className="ml-1.5 text-[10px] text-[#A83232] font-normal">
                        (Cannot demote own account)
                      </span>
                    )}
                  </label>
                  <select
                    value={editingStaff.role}
                    disabled={Boolean(currentUserId && editingStaff.id === currentUserId)}
                    onChange={(e) =>
                      setEditingStaff({
                        ...editingStaff,
                        role: e.target.value as StaffRole,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-white border border-[#D6C3A9] text-sm text-[#332F2B] disabled:bg-[#FAF5EE] disabled:opacity-75 disabled:cursor-not-allowed"
                  >
                    <option value="student_assistant">Student Assistant</option>
                    <option value="librarian">Librarian</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#332F2B] mb-1">Staff ID</label>
                <input
                  type="text"
                  required
                  value={editingStaff.staff_code}
                  onChange={(e) =>
                    setEditingStaff({ ...editingStaff, staff_code: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-white border border-[#D6C3A9] text-sm font-stat text-[#332F2B]"
                />
              </div>

              {editingStaff.role === 'student_assistant' && (
                <div className="p-3 rounded-xl bg-[#FAF5EE] border border-[#E6D7C3] flex items-center justify-between gap-2">
                  <div className="text-xs text-[#6E665E]">
                    Manage multi-area daily rotations in the dedicated Duty Schedule modal.
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const targetId = editingStaff.id;
                      setEditingStaff(null);
                      setEditPassword('');
                      openDutyScheduleModal(targetId);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-white border border-[#D6C3A9] hover:bg-[#F5EBDD] text-[#A83232] text-xs font-semibold inline-flex items-center gap-1 shrink-0 cursor-pointer transition"
                  >
                    <CalendarClock className="w-3.5 h-3.5" />
                    Duty Schedules
                  </button>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#332F2B] mb-1">
                  New Password (Optional)
                </label>
                <input
                  type="text"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="Leave blank to keep current password"
                  className="w-full px-3 py-2 rounded-xl bg-white border border-[#D6C3A9] text-sm text-[#332F2B]"
                />
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#332F2B] cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingStaff.is_active}
                  onChange={(e) =>
                    setEditingStaff({ ...editingStaff, is_active: e.target.checked })
                  }
                  className="accent-[#A83232]"
                />
                Account Active
              </label>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[#E6D7C3]">
                {!currentUserId || editingStaff.id !== currentUserId ? (
                  <button
                    type="button"
                    onClick={() => setDeletingStaff(editingStaff)}
                    className="w-full sm:w-auto px-3 py-2 rounded-xl border border-[#E8BDBD] bg-[#FDF3F3] hover:bg-[#A83232] text-[#A83232] hover:text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove Account
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex items-center justify-end gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingStaff(null);
                      setEditPassword('');
                    }}
                    className="flex-1 sm:flex-initial px-4 py-2 rounded-xl border border-[#D6C3A9] bg-white hover:bg-[#FAF5EE] text-xs font-semibold text-[#332F2B] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={updatingStaff}
                    className="flex-1 sm:flex-initial px-4 py-2 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                  >
                    {updatingStaff ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Remove Account Confirmation Modal */}
      {deletingStaff && createPortal(
        <div className="fixed inset-0 z-[9999] bg-[#332F2B]/65 dark:bg-black/80 backdrop-blur-[2px] flex items-center justify-center p-4 animate-literary-fade">
          <div className="literary-card shadow-2xl max-w-md w-full p-6 relative overflow-hidden">
            <div className="h-1 w-full bg-[#A83232] absolute top-0 left-0" />
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#FDF3F3] border border-[#E8BDBD] flex items-center justify-center text-[#A83232]">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <h3 className="text-lg font-heading font-bold text-[#332F2B]">
                  Remove User Account
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDeletingStaff(null)}
                className="p-1.5 rounded-lg hover:bg-[#F5EBDD] text-[#6E665E] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#6E665E] leading-relaxed mb-4">
              Are you sure you want to remove this account? The user will immediately lose sign-in access to LIRC MANAGEMENT SYSTEM. All historical occupancy counts they previously recorded will be preserved.
            </p>

            <div className="p-3.5 rounded-xl bg-[#FAF5EE] border border-[#E6D7C3] mb-5 space-y-1 text-xs">
              <div className="font-semibold text-[#332F2B] text-sm">{deletingStaff.full_name}</div>
              <div className="text-[#A83232] font-mono font-semibold">@{deletingStaff.username}</div>
              <div className="text-[#6E665E] font-stat">
                {deletingStaff.role === 'librarian' ? 'Librarian' : 'Student Assistant'} ·{' '}
                {deletingStaff.staff_code}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={removingStaff}
                onClick={() => setDeletingStaff(null)}
                className="px-4 py-2 rounded-xl border border-[#D6C3A9] bg-white hover:bg-[#FAF5EE] text-xs font-semibold text-[#332F2B] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={removingStaff}
                onClick={handleConfirmDeleteStaff}
                className="px-4 py-2 rounded-xl bg-[#A83232] hover:bg-[#8E2828] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {removingStaff ? 'Removing...' : 'Remove Account'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
