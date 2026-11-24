import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { ComputedStatisticalReport } from '../types/lirc';
import { formatSlotLabel, formatSlotRangeLabel, formatTimestampPHT } from './statistics';
import { renderAreaComparisonChart, renderHourlyOccupancyChart } from './chartRenderer';

function sanitizeFileSlug(label: string): string {
  return label
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

/**
 * 1. EXCEL (.xlsx) EXPORT
 * Multi-sheet institutional workbook containing:
 * - Sheet 1: Executive Summary & Library Area Totals
 * - Sheet 2: Hourly Occupancy Summary (8:00 AM - 6:00 PM)
 * - Sheet 3: Daily Occupancy Totals Matrix (Date x 6 Areas)
 * - Sheet 4: Monthly Occupancy Totals (when applicable)
 * - Sheet 5: 30-Minute Time-Slot Distribution
 * - Sheet 6: Missing Recording Intervals Audit
 * - Sheet 7: Detailed Occupancy Records Log
 */
export function exportStatisticalReportToExcel(
  report: ComputedStatisticalReport,
  preparedBy: string
): void {
  const wb = XLSX.utils.book_new();
  const areaHeaders = report.areaSummaries.map((s) => s.area.name);

  // Sheet 1: Executive Summary & Area Totals
  const summaryRows: (string | number)[][] = [
    ['LIRC MANAGEMENT SYSTEM – LEARNING & INFORMATION RESOURCE CENTER'],
    [report.reportTitle.toUpperCase()],
    [`Covered Period: ${report.periodLabel}`, '', `Generated: ${report.generatedAt}`],
    [`Date Range: ${report.startDate} to ${report.endDate}`, '', `Prepared By: ${preparedBy}`],
    [],
    ['EXECUTIVE STATISTICAL HIGHLIGHTS'],
    ['Overall Recorded Occupancy (All 6 Library Areas)', report.overallTotal],
    ['Operating Days Covered', report.totalOperatingDays],
    ['Average Daily Occupancy', report.dailyAverageOccupancy],
    ['Peak Library Area', report.peakArea ? `${report.peakArea.areaName} (${report.peakArea.total.toLocaleString()} • ${report.peakArea.sharePercent}%)` : 'N/A'],
    ['Peak Operating Hour', report.peakHour ? `${report.peakHour.label} (${report.peakHour.total.toLocaleString()})` : 'N/A'],
    ['Peak Single Day', report.peakDay ? `${report.peakDay.formattedDate} (${report.peakDay.total.toLocaleString()})` : 'N/A'],
    [],
    ['OCCUPANCY SUMMARY BY LIBRARY AREA'],
    [
      'Library Area',
      'Seating Capacity',
      'Recorded Slots',
      'Daily Average',
      'Avg / 30-Min Slot',
      'Peak Count',
      'Total Occupancy',
      'Share (%)',
    ],
  ];

  for (const item of report.areaSummaries) {
    summaryRows.push([
      item.area.name,
      item.area.capacity,
      item.recordedSlotsCount,
      item.dailyAverage,
      item.slotAverage,
      item.peakCount,
      item.totalOccupancy,
      `${item.sharePercent}%`,
    ]);
  }

  summaryRows.push([
    'OVERALL TOTAL (ALL 6 LIBRARY AREAS)',
    report.areaSummaries.reduce((a, b) => a + b.area.capacity, 0),
    report.totalSlotEntries,
    report.dailyAverageOccupancy,
    '',
    '',
    report.overallTotal,
    '100.0%',
  ]);

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [
    { wch: 30 },
    { wch: 16 },
    { wch: 15 },
    { wch: 15 },
    { wch: 17 },
    { wch: 14 },
    { wch: 18 },
    { wch: 13 },
  ];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Executive Summary');

  // Sheet 2: Hourly Occupancy Summary
  const hourlyRows: (string | number)[][] = [
    [`HOURLY OCCUPANCY SUMMARY (8:00 AM – 6:00 PM) – ${report.periodLabel.toUpperCase()}`],
    [],
    ['Hour Bracket', ...areaHeaders, 'Hourly Total (All Areas)', 'Avg per 30-Min Entry'],
  ];
  for (const hRow of report.hourlyBreakdown) {
    hourlyRows.push([
      hRow.label,
      ...report.areaSummaries.map((s) => hRow.areaTotals[s.area.id] || 0),
      hRow.totalOccupancy,
      hRow.averagePerSlot,
    ]);
  }
  hourlyRows.push([
    'OVERALL TOTAL',
    ...report.areaSummaries.map((s) => s.totalOccupancy),
    report.overallTotal,
    '',
  ]);
  const wsHourly = XLSX.utils.aoa_to_sheet(hourlyRows);
  wsHourly['!cols'] = [
    { wch: 22 },
    ...report.areaSummaries.map(() => ({ wch: 18 })),
    { wch: 22 },
    { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, wsHourly, 'Hourly Summary');

  // Sheet 3: Daily Occupancy Totals Matrix
  const dailyRows: (string | number)[][] = [
    [`DAILY OCCUPANCY TOTALS BY LIBRARY AREA – ${report.periodLabel.toUpperCase()}`],
    [],
    ['Date', 'Day', ...areaHeaders, 'Daily Total', 'Slots Recorded', 'Missing Slots'],
  ];
  for (const dRow of report.dailyBreakdown) {
    dailyRows.push([
      dRow.formattedDate,
      dRow.dayOfWeek,
      ...report.areaSummaries.map((s) => dRow.areaTotals[s.area.id] || 0),
      dRow.dailyTotal,
      dRow.slotsRecorded,
      dRow.missingSlots,
    ]);
  }
  dailyRows.push([
    'PERIOD TOTAL',
    `${report.totalOperatingDays} Days`,
    ...report.areaSummaries.map((s) => s.totalOccupancy),
    report.overallTotal,
    report.totalSlotEntries,
    report.missingSlotsCount,
  ]);
  const wsDaily = XLSX.utils.aoa_to_sheet(dailyRows);
  wsDaily['!cols'] = [
    { wch: 16 },
    { wch: 10 },
    ...report.areaSummaries.map(() => ({ wch: 18 })),
    { wch: 16 },
    { wch: 15 },
    { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, wsDaily, 'Daily Totals');

  // Sheet 4: Monthly Occupancy Totals (when applicable)
  if (report.monthlyBreakdown.length > 0 && report.reportType !== 'daily') {
    const monthlyRows: (string | number)[][] = [
      [`MONTHLY OCCUPANCY TOTALS – ${report.periodLabel.toUpperCase()}`],
      [],
      ['Month', 'Operating Days', ...areaHeaders, 'Monthly Total', 'Daily Average'],
    ];
    for (const mRow of report.monthlyBreakdown) {
      monthlyRows.push([
        mRow.label,
        mRow.operatingDays,
        ...report.areaSummaries.map((s) => mRow.areaTotals[s.area.id] || 0),
        mRow.monthlyTotal,
        mRow.dailyAverage,
      ]);
    }
    const wsMonthly = XLSX.utils.aoa_to_sheet(monthlyRows);
    wsMonthly['!cols'] = [
      { wch: 20 },
      { wch: 15 },
      ...report.areaSummaries.map(() => ({ wch: 18 })),
      { wch: 18 },
      { wch: 16 },
    ];
    XLSX.utils.book_append_sheet(wb, wsMonthly, 'Monthly Totals');
  }

  // Sheet 5: 30-Minute Time-Slot Breakdown
  const slotRows: (string | number)[][] = [
    [`30-MINUTE RECORDING INTERVALS (8:00 AM – 6:00 PM) – ${report.periodLabel.toUpperCase()}`],
    [],
    ['Time Interval', 'Shift Period', ...areaHeaders, 'Interval Total', 'Daily Interval Avg'],
  ];
  for (const sRow of report.slotBreakdown) {
    slotRows.push([
      sRow.label,
      sRow.period,
      ...report.areaSummaries.map((s) => sRow.areaTotals[s.area.id] || 0),
      sRow.totalAcrossAreas,
      sRow.averageAcrossDays,
    ]);
  }
  const wsSlots = XLSX.utils.aoa_to_sheet(slotRows);
  wsSlots['!cols'] = [
    { wch: 15 },
    { wch: 16 },
    ...report.areaSummaries.map(() => ({ wch: 18 })),
    { wch: 16 },
    { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(wb, wsSlots, '30-Min Intervals');

  // Sheet 6: Missing Recording Intervals
  const missingRows: (string | number)[][] = [
    [`MISSING OCCUPANCY RECORDING INTERVALS (${report.missingIntervals.length} IDENTIFIED)`],
    [],
    ['Date', 'Time Interval', 'Library Area', 'Area Code'],
  ];
  for (const m of report.missingIntervals) {
    missingRows.push([m.date, m.timeSlotLabel, m.areaName, m.areaCode]);
  }
  const wsMissing = XLSX.utils.aoa_to_sheet(missingRows);
  wsMissing['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 24 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsMissing, 'Missing Intervals');

  // Sheet 7: Detailed Raw Logs
  const areaNameById = new Map<number, string>();
  report.areaSummaries.forEach((s) => areaNameById.set(s.area.id, s.area.name));
  const logRows: (string | number)[][] = [
    [
      'Date',
      'Time Interval',
      'Library Area',
      'Occupancy Count',
      'Recorded By',
      'Server Recorded At (PHT)',
      'Corrected?',
      'Correction Reason',
      'Notes',
    ],
  ];
  for (const rec of report.rawRecords) {
    logRows.push([
      rec.record_date,
      formatSlotRangeLabel(rec.time_slot),
      areaNameById.get(rec.area_id) || `Area #${rec.area_id}`,
      rec.occupancy_count,
      rec.recorded_by_name || 'Student Assistant',
      formatTimestampPHT(rec.recorded_at),
      rec.is_corrected ? 'Yes' : 'No',
      rec.correction_reason || '',
      rec.notes || '',
    ]);
  }
  const wsLogs = XLSX.utils.aoa_to_sheet(logRows);
  wsLogs['!cols'] = [
    { wch: 13 },
    { wch: 14 },
    { wch: 22 },
    { wch: 16 },
    { wch: 24 },
    { wch: 22 },
    { wch: 12 },
    { wch: 28 },
    { wch: 28 },
  ];
  XLSX.utils.book_append_sheet(wb, wsLogs, 'Detailed Logs');

  XLSX.writeFile(wb, `LIRC_MANAGEMENT_SYSTEM_Report_${sanitizeFileSlug(report.periodLabel)}.xlsx`);
}

/**
 * 2. PDF (.pdf) EXPORT
 * Institutional landscape PDF containing:
 * - Formal LIRC MANAGEMENT SYSTEM banner & covered period metadata
 * - Embedded high-DPI Visual Charts (Area Comparison + Hourly Distribution)
 * - Library Area Summary Table
 * - Hourly Occupancy Summary Table
 * - Daily Occupancy Totals Matrix (+ Monthly Totals when applicable)
 * - Librarian Certification Block
 */
export function exportStatisticalReportToPDF(
  report: ComputedStatisticalReport,
  preparedBy: string
): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Header Banner (Warm Academic Dark Charcoal & Mustard Yellow)
  doc.setFillColor(51, 47, 43); // Dark Charcoal #332F2B
  doc.rect(0, 0, pageWidth, 78, 'F');
  doc.setFillColor(231, 184, 75); // Mustard Yellow #E7B84B accent line
  doc.rect(0, 75, pageWidth, 3, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('LIRC MANAGEMENT SYSTEM — LEARNING & INFORMATION RESOURCE CENTER', 40, 30);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.text(`${report.reportTitle}`, 40, 49);

  doc.setFontSize(8.5);
  doc.text(
    `Covered Period: ${report.periodLabel} (${report.startDate} to ${report.endDate})   |   Generated: ${report.generatedAt}   |   Prepared by: ${preparedBy}`,
    40,
    65
  );

  // KPI strip
  doc.setFillColor(241, 245, 249);
  doc.roundedRect(40, 90, pageWidth - 80, 46, 6, 6, 'F');

  const kpis = [
    { label: 'OVERALL OCCUPANCY', val: report.overallTotal.toLocaleString() },
    { label: 'OPERATING DAYS', val: String(report.totalOperatingDays) },
    { label: 'DAILY AVERAGE', val: report.dailyAverageOccupancy.toLocaleString() },
    { label: 'TOP AREA', val: report.peakArea ? report.peakArea.areaName : 'N/A' },
  ];
  const kpiStep = (pageWidth - 100) / kpis.length;
  kpis.forEach((k, idx) => {
    const x = 52 + idx * kpiStep;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(k.label, x, 106);
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(k.val, x, 124);
  });

  // Table 1: Area Summary
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('1. Occupancy Summary Across All Six Library Areas', 40, 158);

  autoTable(doc, {
    startY: 166,
    margin: { left: 40, right: 40 },
    head: [
      [
        'Library Area',
        'Capacity',
        'Recorded',
        'Daily Avg',
        'Peak Count',
        'Total Occupancy',
        'Share (%)',
      ],
    ],
    body: [
      ...report.areaSummaries.map((item) => [
        item.area.name,
        item.area.capacity.toString(),
        item.recordedSlotsCount.toLocaleString(),
        item.dailyAverage.toLocaleString(),
        `${item.peakCount} (${item.peakSlot})`,
        item.totalOccupancy.toLocaleString(),
        `${item.sharePercent}%`,
      ]),
      [
        'OVERALL TOTAL (ALL 6 AREAS)',
        report.areaSummaries.reduce((a, b) => a + b.area.capacity, 0).toString(),
        report.totalSlotEntries.toLocaleString(),
        report.dailyAverageOccupancy.toLocaleString(),
        report.peakHour ? `Peak Hr: ${report.peakHour.label}` : '—',
        report.overallTotal.toLocaleString(),
        '100.0%',
      ],
    ],
    theme: 'grid',
    headStyles: { fillColor: [168, 50, 50], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8.5, textColor: [51, 47, 43] },
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.index === report.areaSummaries.length) {
        data.cell.styles.fillColor = [245, 235, 221];
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.textColor = [51, 47, 43];
      }
    },
  });

  // Page 2: Visual Charts
  const areaChart = renderAreaComparisonChart(report);
  const hourlyChart = renderHourlyOccupancyChart(report);
  if (areaChart && hourlyChart) {
    doc.addPage();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text(`2. Visual Statistical Charts (${report.periodLabel})`, 40, 42);

    const chartW = (pageWidth - 96) / 2;
    const chartH = chartW * (areaChart.height / areaChart.width);
    doc.addImage(areaChart.dataUrl, 'PNG', 40, 56, chartW, chartH);
    doc.addImage(hourlyChart.dataUrl, 'PNG', 56 + chartW, 56, chartW, chartH);

    // Table 3: Hourly Occupancy Summary right below charts
    const afterChartsY = 56 + chartH + 26;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('3. Hourly Occupancy Summary (8:00 AM – 6:00 PM)', 40, afterChartsY);

    autoTable(doc, {
      startY: afterChartsY + 8,
      margin: { left: 40, right: 40 },
      head: [['Hour Bracket', ...report.areaSummaries.map((s) => s.area.name), 'Hourly Total', 'Avg / Entry']],
      body: report.hourlyBreakdown.map((h) => [
        h.label,
        ...report.areaSummaries.map((s) => (h.areaTotals[s.area.id] || 0).toLocaleString()),
        h.totalOccupancy.toLocaleString(),
        h.averagePerSlot.toLocaleString(),
      ]),
      theme: 'striped',
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 7.8, textColor: [30, 41, 59] },
    });
  }

  // Page 3+: Daily Occupancy Breakdown (+ Monthly Totals when applicable)
  doc.addPage();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(`4. Daily Occupancy Totals Across All Six Library Areas (${report.periodLabel})`, 40, 42);

  const dailyBody = report.dailyBreakdown.map((dRow) => [
    dRow.formattedDate,
    dRow.dayOfWeek,
    ...report.areaSummaries.map((s) => (dRow.areaTotals[s.area.id] || 0).toLocaleString()),
    dRow.dailyTotal.toLocaleString(),
    `${dRow.slotsRecorded}/${dRow.expectedSlots}`,
  ]);
  dailyBody.push([
    'PERIOD TOTAL',
    `${report.totalOperatingDays} Days`,
    ...report.areaSummaries.map((s) => s.totalOccupancy.toLocaleString()),
    report.overallTotal.toLocaleString(),
    `${report.totalSlotEntries}/${report.expectedTotalSlots}`,
  ]);

  autoTable(doc, {
    startY: 52,
    margin: { left: 40, right: 40 },
    head: [['Date', 'Day', ...report.areaSummaries.map((s) => s.area.name), 'Daily Total', 'Slots']],
    body: dailyBody,
    theme: 'striped',
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7.8, textColor: [30, 41, 59] },
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.index === report.dailyBreakdown.length) {
        data.cell.styles.fillColor = [219, 234, 254];
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.textColor = [30, 58, 138];
      }
    },
  });

  // Monthly Totals Table (when applicable)
  if (report.monthlyBreakdown.length > 0 && report.reportType !== 'daily') {
    const afterDailyY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
    const startY = afterDailyY > pageHeight - 130 ? (doc.addPage(), 48) : afterDailyY;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text('5. Monthly Occupancy Totals Summary', 40, startY);

    autoTable(doc, {
      startY: startY + 8,
      margin: { left: 40, right: 40 },
      head: [['Month', 'Days', ...report.areaSummaries.map((s) => s.area.name), 'Monthly Total', 'Daily Avg']],
      body: report.monthlyBreakdown.map((m) => [
        m.label,
        String(m.operatingDays),
        ...report.areaSummaries.map((s) => (m.areaTotals[s.area.id] || 0).toLocaleString()),
        m.monthlyTotal.toLocaleString(),
        m.dailyAverage.toLocaleString(),
      ]),
      theme: 'grid',
      headStyles: { fillColor: [30, 64, 175], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
    });
  }

  // Certification sign-off
  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 28;
  const signY = finalY > pageHeight - 68 ? (doc.addPage(), 54) : finalY;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text('Certified Correct & Generated via LIRC MANAGEMENT SYSTEM Automated Statistical Tracking & Analysis Tool:', 40, signY);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(preparedBy, 40, signY + 22);
  doc.setFont('helvetica', 'normal');
  doc.text('Librarian, Learning & Information Resource Center (LIRC)', 40, signY + 34);

  doc.save(`LIRC_MANAGEMENT_SYSTEM_Report_${sanitizeFileSlug(report.periodLabel)}.pdf`);
}

/**
 * 3. WORD (.docx) EXPORT
 * Formal Microsoft Word document with embedded visual charts,
 * Area Summary, Hourly Occupancy Summary, Daily Totals, and Monthly Totals.
 */
export async function exportStatisticalReportToWord(
  report: ComputedStatisticalReport,
  preparedBy: string
): Promise<void> {
  const borderStyle = {
    style: BorderStyle.SINGLE,
    size: 1,
    color: 'CBD5E1',
  };
  const cellBorders = {
    top: borderStyle,
    bottom: borderStyle,
    left: borderStyle,
    right: borderStyle,
  };

  function makeCell(text: string, isHeader = false, alignRight = false, isTotalRow = false): TableCell {
    return new TableCell({
      borders: cellBorders,
      shading: isHeader
        ? { fill: '1E3A8A', type: ShadingType.CLEAR, color: 'auto' }
        : isTotalRow
        ? { fill: 'EFF6FF', type: ShadingType.CLEAR, color: 'auto' }
        : undefined,
      children: [
        new Paragraph({
          alignment: alignRight ? AlignmentType.RIGHT : AlignmentType.LEFT,
          spacing: { before: 50, after: 50 },
          children: [
            new TextRun({
              text,
              bold: isHeader || isTotalRow,
              size: isHeader ? 17 : 16,
              color: isHeader ? 'FFFFFF' : '0F172A',
              font: 'Calibri',
            }),
          ],
        }),
      ],
    });
  }

  const areaTableRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        makeCell('Library Area', true),
        makeCell('Capacity', true, true),
        makeCell('Recorded', true, true),
        makeCell('Daily Avg', true, true),
        makeCell('Total Occupancy', true, true),
        makeCell('Share', true, true),
      ],
    }),
    ...report.areaSummaries.map(
      (item) =>
        new TableRow({
          children: [
            makeCell(item.area.name),
            makeCell(item.area.capacity.toString(), false, true),
            makeCell(item.recordedSlotsCount.toLocaleString(), false, true),
            makeCell(item.dailyAverage.toLocaleString(), false, true),
            makeCell(item.totalOccupancy.toLocaleString(), false, true),
            makeCell(`${item.sharePercent}%`, false, true),
          ],
        })
    ),
    new TableRow({
      children: [
        makeCell('OVERALL TOTAL (ALL 6 AREAS)', false, false, true),
        makeCell(
          report.areaSummaries.reduce((a, b) => a + b.area.capacity, 0).toString(),
          false,
          true,
          true
        ),
        makeCell(report.totalSlotEntries.toLocaleString(), false, true, true),
        makeCell(report.dailyAverageOccupancy.toLocaleString(), false, true, true),
        makeCell(report.overallTotal.toLocaleString(), false, true, true),
        makeCell('100.0%', false, true, true),
      ],
    }),
  ];

  const hourlyTableRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        makeCell('Hour Bracket', true),
        ...report.areaSummaries.map((s) => makeCell(s.area.code, true, true)),
        makeCell('Hourly Total', true, true),
      ],
    }),
    ...report.hourlyBreakdown.map(
      (h) =>
        new TableRow({
          children: [
            makeCell(h.label),
            ...report.areaSummaries.map((s) =>
              makeCell((h.areaTotals[s.area.id] || 0).toLocaleString(), false, true)
            ),
            makeCell(h.totalOccupancy.toLocaleString(), false, true),
          ],
        })
    ),
  ];

  const dailyTableRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        makeCell('Date', true),
        makeCell('Day', true),
        ...report.areaSummaries.map((s) => makeCell(s.area.code, true, true)),
        makeCell('Daily Total', true, true),
      ],
    }),
    ...report.dailyBreakdown.map(
      (dRow) =>
        new TableRow({
          children: [
            makeCell(dRow.formattedDate),
            makeCell(dRow.dayOfWeek),
            ...report.areaSummaries.map((s) =>
              makeCell((dRow.areaTotals[s.area.id] || 0).toLocaleString(), false, true)
            ),
            makeCell(dRow.dailyTotal.toLocaleString(), false, true),
          ],
        })
    ),
    new TableRow({
      children: [
        makeCell('PERIOD TOTAL', false, false, true),
        makeCell(`${report.totalOperatingDays} Days`, false, false, true),
        ...report.areaSummaries.map((s) =>
          makeCell(s.totalOccupancy.toLocaleString(), false, true, true)
        ),
        makeCell(report.overallTotal.toLocaleString(), false, true, true),
      ],
    }),
  ];

  const areaChart = renderAreaComparisonChart(report);
  const hourlyChart = renderHourlyOccupancyChart(report);

  const docChildren: (Paragraph | Table)[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [
        new TextRun({
          text: 'LIRC MANAGEMENT SYSTEM — LEARNING & INFORMATION RESOURCE CENTER',
          bold: true,
          size: 28,
          color: '1E3A8A',
          font: 'Calibri',
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 140 },
      children: [
        new TextRun({
          text: report.reportTitle,
          bold: true,
          size: 22,
          color: '334155',
          font: 'Calibri',
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: `Covered Period: ${report.periodLabel} (${report.startDate} to ${report.endDate})  |  Generated: ${report.generatedAt}  |  Prepared by: ${preparedBy}`,
          size: 17,
          color: '475569',
          font: 'Calibri',
        }),
      ],
    }),
    new Paragraph({
      spacing: { before: 120, after: 100 },
      children: [
        new TextRun({
          text: '1. Occupancy Summary Across All Six Library Areas',
          bold: true,
          size: 21,
          color: '0F172A',
          font: 'Calibri',
        }),
      ],
    }),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: areaTableRows }),
  ];

  if (areaChart) {
    docChildren.push(
      new Paragraph({
        spacing: { before: 240, after: 100 },
        children: [
          new TextRun({
            text: '2. Visual Occupancy Charts',
            bold: true,
            size: 21,
            color: '0F172A',
            font: 'Calibri',
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 140 },
        children: [
          new ImageRun({
            type: 'png',
            data: areaChart.bytes,
            transformation: { width: 580, height: 246 },
          }),
        ],
      })
    );
  }

  if (hourlyChart) {
    docChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 160 },
        children: [
          new ImageRun({
            type: 'png',
            data: hourlyChart.bytes,
            transformation: { width: 580, height: 246 },
          }),
        ],
      })
    );
  }

  docChildren.push(
    new Paragraph({
      spacing: { before: 240, after: 100 },
      children: [
        new TextRun({
          text: '3. Hourly Occupancy Summary (8:00 AM – 6:00 PM)',
          bold: true,
          size: 21,
          color: '0F172A',
          font: 'Calibri',
        }),
      ],
    }),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: hourlyTableRows }),
    new Paragraph({
      spacing: { before: 260, after: 100 },
      children: [
        new TextRun({
          text: `4. Daily Occupancy Totals (${report.periodLabel})`,
          bold: true,
          size: 21,
          color: '0F172A',
          font: 'Calibri',
        }),
      ],
    }),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: dailyTableRows })
  );

  if (report.monthlyBreakdown.length > 0 && report.reportType !== 'daily') {
    const monthlyRows: TableRow[] = [
      new TableRow({
        tableHeader: true,
        children: [
          makeCell('Month', true),
          makeCell('Days', true, true),
          ...report.areaSummaries.map((s) => makeCell(s.area.code, true, true)),
          makeCell('Monthly Total', true, true),
        ],
      }),
      ...report.monthlyBreakdown.map(
        (m) =>
          new TableRow({
            children: [
              makeCell(m.label),
              makeCell(String(m.operatingDays), false, true),
              ...report.areaSummaries.map((s) =>
                makeCell((m.areaTotals[s.area.id] || 0).toLocaleString(), false, true)
              ),
              makeCell(m.monthlyTotal.toLocaleString(), false, true),
            ],
          })
      ),
    ];

    docChildren.push(
      new Paragraph({
        spacing: { before: 260, after: 100 },
        children: [
          new TextRun({
            text: '5. Monthly Occupancy Totals',
            bold: true,
            size: 21,
            color: '0F172A',
            font: 'Calibri',
          }),
        ],
      }),
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: monthlyRows })
    );
  }

  docChildren.push(
    new Paragraph({
      spacing: { before: 360, after: 60 },
      children: [
        new TextRun({
          text: 'Prepared and Certified By:',
          size: 18,
          color: '475569',
          font: 'Calibri',
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: preparedBy,
          bold: true,
          size: 20,
          color: '0F172A',
          font: 'Calibri',
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: 'Librarian, Learning & Information Resource Center (LIRC MANAGEMENT SYSTEM)',
          size: 18,
          color: '475569',
          font: 'Calibri',
        }),
      ],
    })
  );

  const doc = new Document({ sections: [{ children: docChildren }] });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `LIRC_MANAGEMENT_SYSTEM_Report_${sanitizeFileSlug(report.periodLabel)}.docx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 4. JSON SYSTEM BACKUP DOWNLOAD
 */
export function downloadJsonBackup(payload: unknown, dateSlug: string): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `LIRC_MANAGEMENT_SYSTEM_Backup_${dateSlug}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 5. QUICK CSV EXPORT OF OCCUPANCY RECORDS
 */
export function exportStatisticalReportToCSV(report: ComputedStatisticalReport): void {
  const areaNameById = new Map<number, string>();
  report.areaSummaries.forEach((s) => areaNameById.set(s.area.id, s.area.name));

  const headers = [
    'Date',
    'Time Slot',
    'Library Area',
    'Occupancy Count',
    'Recorded By',
    'Server Recorded At (PHT)',
    'Corrected',
    'Correction Reason',
    'Notes',
  ];

  const escapeCsv = (val: string | number) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = report.rawRecords.map((rec) =>
    [
      rec.record_date,
      formatSlotRangeLabel(rec.time_slot),
      areaNameById.get(rec.area_id) || `Area #${rec.area_id}`,
      rec.occupancy_count,
      rec.recorded_by_name || 'Student Assistant',
      formatTimestampPHT(rec.recorded_at),
      rec.is_corrected ? 'Yes' : 'No',
      rec.correction_reason || '',
      rec.notes || '',
    ]
      .map(escapeCsv)
      .join(',')
  );

  const csvContent = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `LIRC_MANAGEMENT_SYSTEM_Records_${sanitizeFileSlug(report.periodLabel)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
