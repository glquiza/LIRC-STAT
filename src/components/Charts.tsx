import React from 'react';
import {
  AreaStatisticalSummary,
  DailyStatisticalRow,
  HourlyStatisticalRow,
  MonthlyStatisticalRow,
} from '../types/lirc';
import { getLiteraryAreaColor } from '../utils/statistics';

export const AreaComparisonChart: React.FC<{
  areaSummaries: AreaStatisticalSummary[];
  periodLabel: string;
}> = ({ areaSummaries, periodLabel }) => {
  const maxTotal = Math.max(...areaSummaries.map((s) => s.totalOccupancy), 1);

  return (
    <div className="literary-card p-6">
      <div className="flex items-start justify-between gap-2 mb-5 pb-3 border-b border-[#E6D7C3]">
        <div>
          <h3 className="text-base font-heading font-bold text-[#332F2B]">
            Occupancy by Library Area
          </h3>
          <p className="text-xs text-[#6E665E] mt-0.5">{periodLabel}</p>
        </div>
        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#F5EBDD] text-[#332F2B] border border-[#E6D7C3]">
          6 Monitored Zones
        </span>
      </div>

      <div className="space-y-4">
        {areaSummaries.map((item) => {
          const widthPct =
            item.totalOccupancy > 0
              ? Math.max(4, Math.round((item.totalOccupancy / maxTotal) * 100))
              : 0;
          const color = getLiteraryAreaColor(item.area.code, item.area.color_hex);

          return (
            <div key={item.area.id}>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-semibold text-[#332F2B] flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  {item.area.name}
                  <span className="text-[11px] font-normal text-[#6E665E]">
                    ({item.utilizationPercent}% util.)
                  </span>
                </span>
                <span className="font-stat font-bold text-[#332F2B]">
                  {item.totalOccupancy.toLocaleString()}{' '}
                  <span className="text-[#6E665E] font-normal">({item.sharePercent}%)</span>
                </span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-[#F5EBDD] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${widthPct}%`, backgroundColor: color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const HourlyOccupancyChart: React.FC<{
  hourlyBreakdown: HourlyStatisticalRow[];
  periodLabel: string;
  peakHourLabel?: string | null;
}> = ({ hourlyBreakdown, periodLabel, peakHourLabel }) => {
  const maxVal = Math.max(...hourlyBreakdown.map((h) => h.totalOccupancy), 1);

  return (
    <div className="literary-card p-6 flex flex-col justify-between">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-2 mb-5 pb-3 border-b border-[#E6D7C3]">
          <div>
            <h3 className="text-base font-heading font-bold text-[#332F2B]">
              Hourly Occupancy (8:00 AM – 6:00 PM)
            </h3>
            <p className="text-xs text-[#6E665E] mt-0.5">{periodLabel}</p>
          </div>
          {peakHourLabel && (
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#F1F5EE] text-[#455436] border border-[#71865A]/40">
              Peak Hour: {peakHourLabel}
            </span>
          )}
        </div>

        <div className="h-48 flex items-end gap-2 pt-5 pb-2 border-b border-[#E6D7C3] overflow-x-auto">
          {hourlyBreakdown.map((h) => {
            const heightPct =
              h.totalOccupancy > 0 ? Math.max(8, Math.round((h.totalOccupancy / maxVal) * 100)) : 2;
            const isPeak = peakHourLabel === h.label && h.totalOccupancy > 0;
            return (
              <div
                key={h.hourKey}
                className="flex-1 min-w-[38px] h-full flex flex-col justify-end items-center group"
                title={`${h.label}: ${h.totalOccupancy.toLocaleString()} students (${h.averagePerSlot} avg/slot)`}
              >
                <span className="text-[10px] font-stat font-bold text-[#332F2B] mb-1">
                  {h.totalOccupancy > 0 ? h.totalOccupancy.toLocaleString() : '0'}
                </span>
                <div
                  className={`w-full max-w-[34px] rounded-t-md transition-all duration-300 ${
                    isPeak
                      ? 'bg-[#71865A]'
                      : 'bg-[#A83232] group-hover:bg-[#8E2828]'
                  }`}
                  style={{ height: `${heightPct}%` }}
                />
                <span className="text-[10px] font-medium text-[#6E665E] mt-1.5 whitespace-nowrap">
                  {h.shortLabel}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-[#6E665E] pt-3">
        <span>Combined student counts across all 6 library areas</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-[#71865A]" /> Sage Green = Busiest Hour
        </span>
      </div>
    </div>
  );
};

export const DailyTrendChart: React.FC<{
  dailyBreakdown: DailyStatisticalRow[];
  periodLabel: string;
  overallTotal: number;
}> = ({ dailyBreakdown, periodLabel, overallTotal }) => {
  const maxDay = Math.max(...dailyBreakdown.map((d) => d.dailyTotal), 1);

  return (
    <div className="literary-card p-6 flex flex-col justify-between">
      <div>
        <div className="flex items-start justify-between gap-2 mb-5 pb-3 border-b border-[#E6D7C3]">
          <div>
            <h3 className="text-base font-heading font-bold text-[#332F2B]">
              Daily Occupancy Trend
            </h3>
            <p className="text-xs text-[#6E665E] mt-0.5">{periodLabel}</p>
          </div>
          <span className="text-xs font-stat font-bold text-[#A83232] bg-[#FDF3F3] border border-[#A83232]/25 px-3 py-1 rounded-full">
            Total: {overallTotal.toLocaleString()}
          </span>
        </div>

        {dailyBreakdown.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-xs text-[#6E665E]">
            No daily records for this period.
          </div>
        ) : (
          <div className="h-44 flex items-end gap-1.5 pt-5 pb-2 border-b border-[#E6D7C3] overflow-x-auto">
            {dailyBreakdown.map((dRow) => {
              const heightPct =
                dRow.dailyTotal > 0
                  ? Math.max(8, Math.round((dRow.dailyTotal / maxDay) * 100))
                  : 2;
              const dayLabel = dRow.date.slice(5);
              return (
                <div
                  key={dRow.date}
                  className="flex-1 min-w-[24px] h-full flex flex-col justify-end items-center group"
                  title={`${dRow.formattedDate}: ${dRow.dailyTotal.toLocaleString()} students (${dRow.missingSlots} missing)`}
                >
                  <span className="opacity-0 group-hover:opacity-100 transition text-[10px] font-stat font-bold text-[#332F2B] mb-0.5">
                    {dRow.dailyTotal.toLocaleString()}
                  </span>
                  <div
                    className={`w-full max-w-[28px] rounded-t-md transition-all ${
                      dRow.missingSlots > 0
                        ? 'bg-[#E7B84B] hover:bg-[#D1A237]'
                        : 'bg-[#71865A] hover:bg-[#5E704A]'
                    }`}
                    style={{ height: `${heightPct}%` }}
                  />
                  <span className="text-[10px] font-stat text-[#6E665E] mt-1">{dayLabel}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center gap-5 text-[11px] text-[#6E665E] pt-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#71865A]" /> Complete Day
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#E7B84B]" /> Pending / Missing Intervals
        </span>
      </div>
    </div>
  );
};

export const MonthlySummaryChart: React.FC<{
  monthlyBreakdown: MonthlyStatisticalRow[];
}> = ({ monthlyBreakdown }) => {
  const maxVal = Math.max(...monthlyBreakdown.map((m) => m.monthlyTotal), 1);

  return (
    <div className="literary-card p-6">
      <div className="mb-5 pb-3 border-b border-[#E6D7C3]">
        <h3 className="text-base font-heading font-bold text-[#332F2B]">Monthly Totals</h3>
        <p className="text-xs text-[#6E665E] mt-0.5">
          Consolidated monthly occupancy across all six areas
        </p>
      </div>

      {monthlyBreakdown.length === 0 ? (
        <div className="py-10 text-center text-xs text-[#6E665E]">No monthly data yet.</div>
      ) : (
        <div className="space-y-4">
          {monthlyBreakdown.map((m) => {
            const widthPct = Math.max(6, Math.round((m.monthlyTotal / maxVal) * 100));
            return (
              <div key={m.yearMonth}>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-semibold text-[#332F2B]">
                    {m.label}{' '}
                    <span className="text-[#6E665E] font-normal">
                      ({m.operatingDays} days · avg {m.dailyAverage.toLocaleString()}/day)
                    </span>
                  </span>
                  <span className="font-stat font-bold text-[#A83232]">
                    {m.monthlyTotal.toLocaleString()}
                  </span>
                </div>
                <div className="w-full h-2.5 rounded-full bg-[#F5EBDD] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#A83232] transition-all duration-500"
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
