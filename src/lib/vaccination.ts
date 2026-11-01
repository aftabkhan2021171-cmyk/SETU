/**
 * Pediatric Vaccination Schedule & Checklist Engine
 * Loads JSON config from config/vaccination-schedule.json (needs clinical review)
 * Supports children aged < 15 years with checkbox tracking.
 */

import scheduleData from '../config/vaccination-schedule.json';

export interface VaccineItem {
  code: string;
  name: string;
  dose: string;
  essential: boolean;
}

export interface Milestone {
  id: string;
  ageLabel: string;
  minAgeYears: number;
  maxAgeYears: number;
  vaccines: VaccineItem[];
}

export interface ChildVaccineStatus {
  totalApplicable: number;
  completedCount: number;
  pendingCount: number;
  percent: number;
}

export function isChild(ageYears: number): boolean {
  return typeof ageYears === 'number' && !isNaN(ageYears) && ageYears < 15 && ageYears >= 0;
}

export function toggleVaccineInFields(
  customFields: Record<string, string> = {},
  vaccineCode: string,
  done: boolean
): Record<string, string> {
  const updated = { ...customFields };
  if (done) {
    updated[`vax_${vaccineCode}`] = 'done';
  } else {
    delete updated[`vax_${vaccineCode}`];
  }
  return updated;
}

export function getAllMilestones(): Milestone[] {
  return scheduleData.milestones as Milestone[];
}

/**
 * Returns applicable milestones for a child of a given age (< 15).
 */
export function getMilestonesForChildAge(ageYears: number): Milestone[] {
  if (ageYears >= 15) return [];
  // For children < 15, show all standard developmental milestones up to their age milestone
  return scheduleData.milestones.filter(m => m.minAgeYears <= Math.max(ageYears, 0.5)) as Milestone[];
}

/**
 * Returns all vaccines defined for children up to 15 years.
 */
export function getAllPediatricVaccines(): VaccineItem[] {
  const list: VaccineItem[] = [];
  const seen = new Set<string>();
  for (const m of scheduleData.milestones) {
    for (const v of m.vaccines) {
      if (!seen.has(v.code)) {
        seen.add(v.code);
        list.push(v);
      }
    }
  }
  return list;
}

/**
 * Calculates how many vaccines are marked completed in patient customFields.
 * Keys are stored as: `vax_<CODE>` = 'done' | 'pending'
 */
export function getChildVaccineStatus(
  ageYears: number,
  customFields?: Record<string, string>
): ChildVaccineStatus {
  if (ageYears >= 15) {
    return { totalApplicable: 0, completedCount: 0, pendingCount: 0, percent: 100 };
  }

  const milestones = getMilestonesForChildAge(ageYears);
  const codes = new Set<string>();
  for (const m of milestones) {
    for (const v of m.vaccines) {
      codes.add(v.code);
    }
  }

  const totalApplicable = codes.size;
  if (totalApplicable === 0) {
    return { totalApplicable: 0, completedCount: 0, pendingCount: 0, percent: 100 };
  }

  let completedCount = 0;
  if (customFields) {
    for (const code of codes) {
      if (customFields[`vax_${code}`] === 'done') {
        completedCount++;
      }
    }
  }

  const pendingCount = totalApplicable - completedCount;
  const percent = Math.round((completedCount / totalApplicable) * 100);

  return { totalApplicable, completedCount, pendingCount, percent };
}
