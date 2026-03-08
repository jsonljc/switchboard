// ---------------------------------------------------------------------------
// Dayparting Engine — Schedule optimization based on hourly performance
// ---------------------------------------------------------------------------

import type { DaypartSchedule, DaypartingRecommendation } from "./types.js";

export interface HourlyPerformance {
  adSetId: string;
  hourlyData: Array<{
    day: number;
    hour: number;
    spend: number;
    impressions: number;
    conversions: number;
    cpa: number | null;
  }>;
}

export class DaypartingEngine {
  recommend(data: HourlyPerformance): DaypartingRecommendation {
    const { adSetId, hourlyData } = data;

    // Calculate performance index for each hour slot
    const avgCPA = this.computeAvgCPA(hourlyData);
    const peakHours: DaypartingRecommendation["peakHours"] = [];

    for (const slot of hourlyData) {
      if (slot.conversions > 0 && slot.cpa !== null && avgCPA > 0) {
        peakHours.push({
          day: slot.day,
          hour: slot.hour,
          performanceIndex: avgCPA / slot.cpa, // Higher = better
        });
      }
    }

    // Sort by performance index
    peakHours.sort((a, b) => b.performanceIndex - a.performanceIndex);

    // Generate schedule from top-performing hours
    const topHours = peakHours.filter((h) => h.performanceIndex > 0.8);
    const schedule = this.buildSchedule(topHours);

    return {
      adSetId,
      currentSchedule: null,
      recommendedSchedule: schedule,
      peakHours: peakHours.slice(0, 10),
      summary: schedule.length > 0
        ? `Recommend dayparting with ${schedule.length} time blocks targeting peak performance hours`
        : "Insufficient data for dayparting recommendation — run on all hours",
    };
  }

  private computeAvgCPA(data: HourlyPerformance["hourlyData"]): number {
    const withConversions = data.filter((d) => d.conversions > 0 && d.cpa !== null);
    if (withConversions.length === 0) return 0;
    return withConversions.reduce((s, d) => s + d.cpa!, 0) / withConversions.length;
  }

  private buildSchedule(peakHours: DaypartingRecommendation["peakHours"]): DaypartSchedule[] {
    if (peakHours.length === 0) return [];

    // Group by day
    const byDay = new Map<number, number[]>();
    for (const peak of peakHours) {
      if (!byDay.has(peak.day)) byDay.set(peak.day, []);
      byDay.get(peak.day)!.push(peak.hour);
    }

    const schedule: DaypartSchedule[] = [];
    for (const [day, hours] of byDay) {
      hours.sort((a, b) => a - b);
      // Merge consecutive hours into blocks
      let start = hours[0]!;
      let end = hours[0]!;
      for (let i = 1; i < hours.length; i++) {
        if (hours[i]! - end! <= 1) {
          end = hours[i]!;
        } else {
          schedule.push({ day, startMinute: start * 60, endMinute: (end + 1) * 60 });
          start = hours[i]!;
          end = hours[i]!;
        }
      }
      schedule.push({ day, startMinute: start * 60, endMinute: (end + 1) * 60 });
    }

    return schedule;
  }
}
