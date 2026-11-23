import { ComputedStatisticalReport } from '../types/lirc';
import { getLiteraryAreaColor } from './statistics';

export interface RenderedChartAsset {
  dataUrl: string;
  bytes: Uint8Array;
  width: number;
  height: number;
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] || '';
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Render Area Comparison Horizontal Bar Chart in Warm Academic Theme
 * (#A83232 Burgundy Red, #71865A Sage Green, #E7B84B Mustard Yellow, #332F2B Dark Charcoal, #F5EBDD Warm Beige, #FFFFFF Pure White)
 */
export function renderAreaComparisonChart(
  report: ComputedStatisticalReport
): RenderedChartAsset | null {
  if (typeof document === 'undefined') return null;
  const width = 920;
  const height = 390;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Pure White Card Background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#E6D7C3';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);

  // Top Burgundy Red Accent Line
  ctx.fillStyle = '#A83232';
  ctx.fillRect(0, 0, width, 5);

  // Title
  ctx.fillStyle = '#332F2B';
  ctx.font = 'bold 20px Georgia, serif';
  ctx.fillText('Occupancy Comparison Across Six Library Areas', 28, 42);

  ctx.fillStyle = '#6E665E';
  ctx.font = '14px sans-serif';
  ctx.fillText(
    `Period: ${report.periodLabel}  •  Overall Total: ${report.overallTotal.toLocaleString()} students`,
    28,
    66
  );

  const items = report.areaSummaries;
  const maxVal = Math.max(...items.map((i) => i.totalOccupancy), 1);

  const labelWidth = 190;
  const rightPadding = 135;
  const chartLeft = labelWidth + 20;
  const chartWidth = width - chartLeft - rightPadding;
  const startY = 100;
  const rowHeight = 44;

  items.forEach((item, idx) => {
    const y = startY + idx * rowHeight;
    const areaColor = getLiteraryAreaColor(item.area.code, item.area.color_hex);

    // Area color dot & label
    ctx.fillStyle = areaColor;
    ctx.beginPath();
    ctx.arc(36, y + 14, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#332F2B';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(item.area.name, 52, y + 19);

    // Warm Beige Track
    ctx.fillStyle = '#F5EBDD';
    ctx.fillRect(chartLeft, y + 4, chartWidth, 22);

    // Value Bar
    const barW = Math.max(4, Math.round((item.totalOccupancy / maxVal) * chartWidth));
    ctx.fillStyle = areaColor;
    ctx.fillRect(chartLeft, y + 4, barW, 22);

    // Value Text
    ctx.fillStyle = '#332F2B';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(
      `${item.totalOccupancy.toLocaleString()} (${item.sharePercent}%)`,
      chartLeft + chartWidth + 12,
      y + 20
    );
  });

  const dataUrl = canvas.toDataURL('image/png');
  return {
    dataUrl,
    bytes: dataUrlToUint8Array(dataUrl),
    width,
    height,
  };
}

/**
 * Render Hourly Occupancy Vertical Column Chart (8:00 AM - 6:00 PM) in Warm Academic Theme
 */
export function renderHourlyOccupancyChart(
  report: ComputedStatisticalReport
): RenderedChartAsset | null {
  if (typeof document === 'undefined') return null;
  const width = 920;
  const height = 390;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#E6D7C3';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);

  // Top Mustard Yellow Accent Line
  ctx.fillStyle = '#E7B84B';
  ctx.fillRect(0, 0, width, 5);

  // Title
  ctx.fillStyle = '#332F2B';
  ctx.font = 'bold 20px Georgia, serif';
  ctx.fillText('Hourly Student Occupancy Distribution (8:00 AM – 6:00 PM)', 28, 42);

  ctx.fillStyle = '#6E665E';
  ctx.font = '14px sans-serif';
  const peakText = report.peakHour
    ? `Peak Hour: ${report.peakHour.label} (${report.peakHour.total.toLocaleString()})`
    : 'No peak recorded';
  ctx.fillText(`Period: ${report.periodLabel}  •  ${peakText}`, 28, 66);

  const rows = report.hourlyBreakdown;
  const maxVal = Math.max(...rows.map((r) => r.totalOccupancy), 1);

  const padLeft = 65;
  const padRight = 28;
  const padTop = 100;
  const padBottom = 64;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  // Horizontal grid lines
  ctx.strokeStyle = '#E6D7C3';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const gy = padTop + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padLeft, gy);
    ctx.lineTo(width - padRight, gy);
    ctx.stroke();

    const tickVal = Math.round(maxVal * (1 - i / 4));
    ctx.fillStyle = '#6E665E';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(tickVal.toLocaleString(), padLeft - 10, gy + 4);
  }

  const slotW = plotW / Math.max(rows.length, 1);
  const barW = Math.max(22, slotW * 0.56);

  rows.forEach((row, idx) => {
    const xCenter = padLeft + idx * slotW + slotW / 2;
    const xBar = xCenter - barW / 2;
    const barH = Math.max(3, Math.round((row.totalOccupancy / maxVal) * plotH));
    const yBar = padTop + plotH - barH;

    const isPeak = report.peakHour && report.peakHour.label === row.label;
    ctx.fillStyle = isPeak ? '#71865A' : '#A83232';
    ctx.fillRect(xBar, yBar, barW, barH);

    // Value label above bar
    ctx.fillStyle = '#332F2B';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(row.totalOccupancy.toLocaleString(), xCenter, yBar - 6);

    // X-axis label
    ctx.fillStyle = '#332F2B';
    ctx.font = '12px sans-serif';
    ctx.fillText(row.shortLabel, xCenter, padTop + plotH + 22);
  });

  const dataUrl = canvas.toDataURL('image/png');
  return {
    dataUrl,
    bytes: dataUrlToUint8Array(dataUrl),
    width,
    height,
  };
}
