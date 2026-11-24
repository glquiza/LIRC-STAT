import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  GraduationCap,
  History,
  Info,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  User,
  UserCheck,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { UserProfile } from '../types/lirc';
import {
  calculateEffectiveRemainingSeconds,
  COMMON_VIOLATIONS,
  createViolation,
  DEFAULT_TIMER_DURATION_SECONDS,
  exportViolationsToExcel,
  exportViolationsToPDF,
  exportViolationsToWord,
  fetchViolations,
  formatTimerCountdown,
  LibraryViolationRecord,
  removeViolation,
  resolveEffectiveTimerStatus,
  subscribeToViolations,
  TimerStatus,
  updateViolationTimer,
} from '../utils/violatorsLogbook';
import { formatTimestampPHT } from '../utils/statistics';

interface ViolatorsLogbookProps {
  mode: 'student_assistant' | 'librarian';
  profile: UserProfile;
  onRecordCountChange?: (activeCount: number) => void;
}

export const ViolatorsLogbook: React.FC<ViolatorsLogbookProps> = ({
  mode,
  profile,
  onRecordCountChange,
}) => {
  const [records, setRecords] = useState<LibraryViolationRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | TimerStatus>('all');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  // Form states for Student Assistant
  const [violatorName, setViolatorName] = useState<string>('');
  const [studentId, setStudentId] = useState<string>('');
  const [course, setCourse] = useState<string>('');
  const [violation, setViolation] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [showAddModal, setShowAddModal] = useState<boolean>(false);

  // Deletion modal state
  const [recordToDelete, setRecordToDelete] = useState<LibraryViolationRecord | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

  // Wall-clock tick for running countdowns
  const [, setTick] = useState<number>(0);
  const completingIdsRef = useRef<Set<string>>(new Set());

  // Load records
  const loadData = async () => {
    try {
      const data = await fetchViolations(supabase);
      setRecords(data);
    } catch (err) {
      console.error('[ViolatorsLogbook] Load error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const unsubscribe = subscribeToViolations(supabase, () => {
      loadData();
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // Timer interval: tick every second if any timer is running
  useEffect(() => {
    const hasRunningTimers = records.some((r) => resolveEffectiveTimerStatus(r) === 'running');
    if (!hasRunningTimers) return;

    const interval = setInterval(() => {
      setTick((prev) => prev + 1);

      // Check for records that just hit 00:00 to trigger auto-complete
      records.forEach((record) => {
        if (record.timer_status === 'running') {
          const remaining = calculateEffectiveRemainingSeconds(record);
          if (remaining <= 0 && !completingIdsRef.current.has(record.id)) {
            completingIdsRef.current.add(record.id);
            // Mark completed in database/storage
            updateViolationTimer(
              record.id,
              {
                timer_status: 'completed',
                remaining_seconds: 0,
                completed_at: new Date().toISOString(),
                timer_started_at: null,
              },
              supabase
            ).then(() => {
              loadData();
            });
          }
        }
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [records]);

  // Keep parent notified of active (running/paused) count for badges
  useEffect(() => {
    const activeCount = records.filter((r) => {
      const st = resolveEffectiveTimerStatus(r);
      return st === 'running' || st === 'paused';
    }).length;
    onRecordCountChange?.(activeCount);
  }, [records, onRecordCountChange]);

  // Handle Play
  const handlePlayTimer = async (record: LibraryViolationRecord) => {
    try {
      const currentRemaining = calculateEffectiveRemainingSeconds(record);
      if (currentRemaining <= 0) {
        // If already at 0, complete it
        await updateViolationTimer(
          record.id,
          {
            timer_status: 'completed',
            remaining_seconds: 0,
            completed_at: new Date().toISOString(),
            timer_started_at: null,
          },
          supabase
        );
      } else {
        await updateViolationTimer(
          record.id,
          {
            timer_status: 'running',
            remaining_seconds: currentRemaining,
            timer_started_at: new Date().toISOString(),
          },
          supabase
        );
      }
      await loadData();
    } catch (err) {
      console.error('[ViolatorsLogbook] Play timer error:', err);
    }
  };

  // Handle Pause
  const handlePauseTimer = async (record: LibraryViolationRecord) => {
    try {
      const remaining = calculateEffectiveRemainingSeconds(record);
      await updateViolationTimer(
        record.id,
        {
          timer_status: 'paused',
          remaining_seconds: remaining,
          timer_started_at: null,
        },
        supabase
      );
      await loadData();
    } catch (err) {
      console.error('[ViolatorsLogbook] Pause timer error:', err);
    }
  };

  // Handle Add Violation
  const handleSubmitViolation = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!violatorName.trim()) {
      setFormError("Please enter the violator's full name.");
      return;
    }
    if (!studentId.trim()) {
      setFormError("Please enter the violator's student ID.");
      return;
    }
    if (!course.trim()) {
      setFormError("Please enter the violator's course or academic program.");
      return;
    }
    if (!violation.trim()) {
      setFormError('Please select or specify the violation committed.');
      return;
    }

    setSubmitting(true);
    try {
      await createViolation(
        {
          violator_name: violatorName,
          student_id: studentId,
          course: course,
          violation: violation,
          recorded_by_id: profile.id,
          recorded_by_name: profile.full_name || 'Student Assistant',
          recorded_by_staff_code: profile.staff_code || '',
          timer_duration_seconds: DEFAULT_TIMER_DURATION_SECONDS,
          notes: notes.trim(),
        },
        supabase
      );

      // Reset form
      setViolatorName('');
      setStudentId('');
      setCourse('');
      setViolation('');
      setNotes('');
      setFormSuccess('Violation record successfully logged with 1-hour countdown timer!');
      setShowAddModal(false);
      await loadData();

      setTimeout(() => {
        setFormSuccess(null);
      }, 5000);
    } catch (err: any) {
      setFormError(err.message || 'Failed to record violation. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Delete Confirmation
  const handleConfirmDelete = async () => {
    if (!recordToDelete) return;
    setDeleting(true);
    try {
      await removeViolation(recordToDelete.id, supabase, recordToDelete.carrierId);
      setRecordToDelete(null);
      await loadData();
    } catch (err) {
      console.error('[ViolatorsLogbook] Remove error:', err);
    } finally {
      setDeleting(false);
    }
  };

  // Handle Exports (Librarian)
  const handleExport = async (format: 'xlsx' | 'pdf' | 'docx') => {
    if (records.length === 0) {
      setExportNotice('No violation records available to export.');
      setTimeout(() => setExportNotice(null), 3000);
      return;
    }
    setIsExporting(true);
    try {
      const preparedBy = profile.full_name || 'LIRC Staff';
      if (format === 'xlsx') {
        exportViolationsToExcel(filteredRecords, preparedBy);
        setExportNotice('Excel report (.xlsx) generated successfully.');
      } else if (format === 'pdf') {
        exportViolationsToPDF(filteredRecords, preparedBy);
        setExportNotice('PDF document (.pdf) downloaded.');
      } else if (format === 'docx') {
        await exportViolationsToWord(filteredRecords, preparedBy);
        setExportNotice('Word report (.docx) created.');
      }
    } catch (err: any) {
      console.error('[ViolatorsLogbook] Export failed:', err);
      setExportNotice(`Export failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsExporting(false);
      setTimeout(() => setExportNotice(null), 4000);
    }
  };

  // Filtered list
  const filteredRecords = useMemo(() => {
    return records.filter((rec) => {
      const effStatus = resolveEffectiveTimerStatus(rec);

      if (statusFilter !== 'all' && effStatus !== statusFilter) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = rec.violator_name.toLowerCase().includes(q);
        const matchId = rec.student_id.toLowerCase().includes(q);
        const matchCourse = rec.course.toLowerCase().includes(q);
        const matchViolation = rec.violation.toLowerCase().includes(q);
        const matchRecorder = (rec.recorded_by_name || '').toLowerCase().includes(q);
        return matchName || matchId || matchCourse || matchViolation || matchRecorder;
      }

      return true;
    });
  }, [records, statusFilter, searchQuery]);

  // Counts for KPIs
  const totalCount = records.length;
  const runningCount = records.filter((r) => resolveEffectiveTimerStatus(r) === 'running').length;
  const pausedCount = records.filter((r) => resolveEffectiveTimerStatus(r) === 'paused').length;
  const completedCount = records.filter((r) => resolveEffectiveTimerStatus(r) === 'completed').length;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-[#A83232] to-[#8B2626] rounded-2xl p-6 text-white shadow-md relative overflow-hidden border border-[#A83232]/30">
        <div className="absolute right-0 top-0 w-96 h-full bg-white/5 pointer-events-none transform skew-x-12" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-13 h-13 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center p-3 text-amber-300 shadow-inner">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-[#E7B84B] text-[#422006] shadow-sm">
                  LIRC Registry
                </span>
                <span className="text-white/70 text-xs">
                  {mode === 'librarian' ? 'Chief Librarian Oversight' : 'Student Assistant Station'}
                </span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-white mt-1">
                Violators Logbook
              </h1>
              <p className="text-white/80 text-sm mt-0.5 max-w-2xl">
                Official register for logging library policy violations with dedicated 1-hour
                monitoring countdown timers, resolution tracking, and administrative audit reports.
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => loadData()}
              className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition flex items-center gap-1.5 border border-white/20 backdrop-blur-sm"
              title="Refresh Records"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>

            {mode === 'student_assistant' && (
              <button
                onClick={() => setShowAddModal(true)}
                className="px-4 py-2 rounded-xl bg-[#E7B84B] hover:bg-[#d6a539] text-[#332F2B] text-xs font-bold transition shadow-md flex items-center gap-1.5 transform hover:-translate-y-0.5 active:translate-y-0"
              >
                <Plus className="w-4 h-4" />
                <span>Log New Violation</span>
              </button>
            )}

            {mode === 'librarian' && (
              <div className="flex items-center gap-2">
                <button
                  disabled={isExporting}
                  onClick={() => handleExport('xlsx')}
                  className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition flex items-center gap-1.5 border border-emerald-400/30"
                  title="Export to Microsoft Excel Spreadsheet"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Excel</span>
                </button>
                <button
                  disabled={isExporting}
                  onClick={() => handleExport('pdf')}
                  className="px-3 py-2 rounded-xl bg-[#A83232] hover:bg-[#8B2626] text-white text-xs font-semibold shadow-sm transition flex items-center gap-1.5 border border-white/30"
                  title="Export to Adobe PDF Document"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>PDF</span>
                </button>
                <button
                  disabled={isExporting}
                  onClick={() => handleExport('docx')}
                  className="px-3 py-2 rounded-xl bg-blue-700 hover:bg-blue-600 text-white text-xs font-semibold shadow-sm transition flex items-center gap-1.5 border border-blue-400/30"
                  title="Export to Microsoft Word Document"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Word</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Export feedback toast */}
      {exportNotice && (
        <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl text-xs font-medium flex items-center gap-2 animate-fade-in shadow-sm">
          <Info className="w-4 h-4 text-amber-600 shrink-0" />
          <span>{exportNotice}</span>
        </div>
      )}

      {/* Form success banner */}
      {formSuccess && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs font-medium flex items-center gap-2.5 animate-fade-in shadow-sm">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{formSuccess}</span>
        </div>
      )}

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-stone-200/80 shadow-sm flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-lg bg-stone-100 text-stone-700 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-stone-900">{totalCount}</div>
            <div className="text-xs font-medium text-stone-500 uppercase tracking-wider">Total Records</div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-stone-200/80 shadow-sm flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-lg bg-red-50 text-[#A83232] flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="text-2xl font-bold text-[#A83232]">{runningCount}</div>
            <div className="text-xs font-medium text-stone-500 uppercase tracking-wider">Active Countdown</div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-stone-200/80 shadow-sm flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
            <Pause className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-amber-700">{pausedCount}</div>
            <div className="text-xs font-medium text-stone-500 uppercase tracking-wider">Paused Timers</div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-stone-200/80 shadow-sm flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-emerald-700">{completedCount}</div>
            <div className="text-xs font-medium text-stone-500 uppercase tracking-wider">Completed (1 Hr)</div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-3 text-stone-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by student name, ID, course, violation, or assistant..."
            className="w-full pl-9 pr-8 py-2 text-xs rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232] transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-2.5 text-stone-400 hover:text-stone-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Status Filter Buttons */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <span className="text-xs text-stone-400 flex items-center gap-1 mr-1">
            <Filter className="w-3.5 h-3.5" />
            <span>Filter:</span>
          </span>
          {(['all', 'running', 'paused', 'completed'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
                statusFilter === st
                  ? 'bg-[#332F2B] text-white shadow-sm'
                  : 'bg-stone-100 hover:bg-stone-200 text-stone-700'
              }`}
            >
              {st === 'all'
                ? `All (${records.length})`
                : st === 'running'
                ? `Active (${runningCount})`
                : st === 'paused'
                ? `Paused (${pausedCount})`
                : `Completed (${completedCount})`}
            </button>
          ))}
        </div>
      </div>

      {/* Violations Table / List */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-200 flex flex-wrap items-center justify-between gap-3 bg-stone-50/50">
          <div>
            <h2 className="text-sm font-bold text-stone-900 uppercase tracking-wider">
              Recorded Violations ({filteredRecords.length})
            </h2>
            <p className="text-xs text-stone-500">
              Each record includes its 1-hour timer with Play, Pause, Completed status, and Remove controls.
            </p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-3.5 py-1.5 rounded-xl bg-[#A83232] hover:bg-[#8B2626] text-white text-xs font-bold transition shadow-sm flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Log Violation</span>
          </button>
        </div>

        {loading ? (
          <div className="py-16 text-center text-stone-500">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-[#A83232] mb-2" />
            <p className="text-xs font-medium">Loading Violators Logbook...</p>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="py-16 text-center px-4">
            <ShieldAlert className="w-12 h-12 mx-auto text-stone-300 mb-3" />
            <h3 className="text-sm font-bold text-stone-800">No Violation Records Found</h3>
            <p className="text-xs text-stone-500 max-w-sm mx-auto mt-1">
              {searchQuery || statusFilter !== 'all'
                ? 'No records match your search or filter criteria. Try clearing filters.'
                : 'No library violations have been logged yet. Use the form above to record a violation.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-stone-100/70 border-b border-stone-200 text-[11px] font-bold text-stone-600 uppercase tracking-wider">
                  <th className="py-3 px-4 w-12 text-center">#</th>
                  <th className="py-3 px-4">Violator & Student Info</th>
                  <th className="py-3 px-4">Violation Details</th>
                  <th className="py-3 px-4">Recorded By</th>
                  <th className="py-3 px-4 text-center w-52">1-Hour Countdown Timer</th>
                  <th className="py-3 px-4 text-right w-24">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 text-xs">
                {filteredRecords.map((record, index) => {
                  const effStatus = resolveEffectiveTimerStatus(record);
                  const effRemaining = calculateEffectiveRemainingSeconds(record);

                  return (
                    <tr
                      key={record.id}
                      className={`hover:bg-amber-50/30 transition ${
                        effStatus === 'running'
                          ? 'bg-red-50/20'
                          : effStatus === 'completed'
                          ? 'bg-emerald-50/10'
                          : ''
                      }`}
                    >
                      {/* Index */}
                      <td className="py-3.5 px-4 text-center font-mono text-stone-400 text-[11px]">
                        {index + 1}
                      </td>

                      {/* Violator Name & ID */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-stone-900 text-sm">{record.violator_name}</div>
                        <div className="flex items-center gap-2 mt-0.5 text-stone-500 font-mono text-[11px]">
                          <span className="font-semibold text-stone-700 bg-stone-100 px-1.5 py-0.5 rounded border border-stone-200">
                            {record.student_id}
                          </span>
                          <span>•</span>
                          <span>{record.course}</span>
                        </div>
                        <div className="text-[10px] text-stone-400 mt-0.5">
                          Logged: {formatTimestampPHT(record.created_at)}
                        </div>
                      </td>

                      {/* Violation Details */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-stone-800">{record.violation}</div>
                        {record.notes && (
                          <div className="text-[11px] text-stone-500 mt-0.5 italic">
                            Note: {record.notes}
                          </div>
                        )}
                      </td>

                      {/* Recorded By */}
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-stone-800 flex items-center gap-1.5">
                          <UserCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span>{record.recorded_by_name || 'Student Assistant'}</span>
                        </div>
                        {record.recorded_by_staff_code && (
                          <div className="text-[10px] text-stone-400 font-mono ml-5">
                            Code: {record.recorded_by_staff_code}
                          </div>
                        )}
                      </td>

                      {/* 1-Hour Countdown Timer Button & Controls */}
                      <td className="py-3.5 px-4 text-center">
                        <div className="flex flex-col items-center justify-center gap-1.5">
                          {/* Timer Status Card with Play/Pause Button */}
                          {effStatus === 'completed' ? (
                            <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold text-xs shadow-sm">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                              <span>Completed</span>
                              <span className="text-[10px] font-normal text-emerald-700 ml-1">
                                (1 Hr Finished)
                              </span>
                            </div>
                          ) : effStatus === 'running' ? (
                            <div className="flex items-center gap-2">
                              {/* Pulsing countdown pill */}
                              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-red-100 text-[#A83232] border border-red-300 font-mono font-bold text-sm shadow-sm">
                                <span className="w-2 h-2 rounded-full bg-red-600 animate-ping shrink-0" />
                                <span>{formatTimerCountdown(effRemaining)}</span>
                              </div>

                              {/* Pause Button */}
                              <button
                                onClick={() => handlePauseTimer(record)}
                                className="p-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white shadow-sm transition active:scale-95"
                                title="Pause 1-Hour Countdown (retains remaining time)"
                              >
                                <Pause className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : effStatus === 'paused' ? (
                            <div className="flex items-center gap-2">
                              {/* Paused pill */}
                              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 text-amber-800 border border-amber-300 font-mono font-bold text-sm">
                                <Pause className="w-3.5 h-3.5 text-amber-600" />
                                <span>{formatTimerCountdown(effRemaining)}</span>
                                <span className="text-[10px] uppercase font-sans text-amber-600 font-normal">
                                  Paused
                                </span>
                              </div>

                              {/* Play / Resume Button */}
                              <button
                                onClick={() => handlePlayTimer(record)}
                                className="p-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition active:scale-95"
                                title="Resume 1-Hour Countdown"
                              >
                                <Play className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            /* Stopped / Ready state */
                            <button
                              onClick={() => handlePlayTimer(record)}
                              className="px-3 py-1.5 rounded-xl bg-[#A83232] hover:bg-[#8B2626] text-white text-xs font-bold transition shadow-sm flex items-center gap-1.5"
                              title="Start 1-Hour Countdown Timer"
                            >
                              <Play className="w-3.5 h-3.5" />
                              <span>Start 1-Hr Timer</span>
                            </button>
                          )}

                          {/* Completion or Started sub-label */}
                          {effStatus === 'completed' && record.completed_at && (
                            <div className="text-[10px] text-stone-400">
                              Done at: {formatTimestampPHT(record.completed_at)}
                            </div>
                          )}
                          {effStatus === 'running' && (
                            <div className="text-[10px] text-red-600 font-medium animate-pulse">
                              Counting down live...
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Remove Button (Far Right) */}
                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={() => setRecordToDelete(record)}
                          className="px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 text-xs font-medium transition flex items-center gap-1 ml-auto"
                          title="Remove this violation record"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Remove</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {recordToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-stone-200">
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-stone-900 text-center">
              Remove Violation Record?
            </h3>
            <p className="text-xs text-stone-600 text-center mt-2 leading-relaxed">
              Are you sure you want to remove the violation record for{' '}
              <strong className="text-stone-900">{recordToDelete.violator_name}</strong> (
              {recordToDelete.student_id})?
            </p>
            <p className="text-[11px] text-stone-400 text-center mt-1">
              This action will remove the record and its timer from the logbook.
            </p>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setRecordToDelete(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-red-600 hover:bg-red-700 transition flex items-center gap-1.5"
              >
                {deleting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Yes, Remove Record</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Student Assistant Add Violation Modal (if triggered via button) */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-stone-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-stone-200">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-[#A83232]" />
                <h3 className="text-base font-bold text-stone-900">Log New Library Violation</h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-stone-400 hover:text-stone-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitViolation} className="mt-4 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-medium flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                  Violator&apos;s Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={violatorName}
                  onChange={(e) => setViolatorName(e.target.value)}
                  placeholder="e.g. Juan Dela Cruz"
                  className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                    Student ID <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={studentId}
                    onChange={(e) => setStudentId(e.target.value)}
                    placeholder="e.g. 2024-01234"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232] uppercase"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                    Course / Program <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={course}
                    onChange={(e) => setCourse(e.target.value)}
                    placeholder="e.g. BS Civil Engineering"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                  Violation <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={violation}
                  onChange={(e) => setViolation(e.target.value)}
                  placeholder="Specify violation..."
                  className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-[#A83232]/20 focus:border-[#A83232]"
                />
                <div className="flex flex-wrap gap-1 mt-2">
                  {COMMON_VIOLATIONS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setViolation(preset)}
                      className="text-[11px] px-2 py-0.5 rounded bg-stone-100 hover:bg-stone-200 text-stone-700"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 text-xs text-stone-600">
                <span className="font-semibold text-stone-800">Recording Assistant (Automatic): </span>
                {profile.full_name || 'Student Assistant'}
              </div>

              <div className="pt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-[#A83232] hover:bg-[#8B2626] shadow-sm flex items-center gap-1.5"
                >
                  {submitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Record & Arm Timer</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ViolatorsLogbook;
