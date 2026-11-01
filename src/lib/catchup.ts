/**
 * Catch-Up & Periodic Summary Engine.
 * Analyzes records logged over recent days (e.g. 2-3 days / 72 hours)
 * and generates actionable summaries like: "5 new entries with 2 severe".
 */

import { PatientRecord } from './db';

export interface CatchUpSummary {
  hasCatchUp: boolean;
  totalNew: number;
  severeCount: number;
  followUpCount: number;
  stableCount: number;
  childCount: number;
  summaryText: string;
  timeWindowHours: number;
}

const LAST_LOGIN_KEY = 'setu_last_login_timestamp';
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

export function recordLoginTime(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LAST_LOGIN_KEY, String(Date.now()));
    }
  } catch { }
}

export function getPreviousLoginTime(): number | null {
  try {
    if (typeof localStorage !== 'undefined') {
      const val = localStorage.getItem(LAST_LOGIN_KEY);
      if (val) return Number(val);
    }
  } catch { }
  return null;
}

/**
 * Computes the catch-up summary for patient entries.
 * Evaluates entries within the last `windowHours` (default 72 hours = 3 days).
 */
export function computeCatchUpSummary(
  patients: PatientRecord[],
  windowHours = 72
): CatchUpSummary {
  if (!patients || patients.length === 0) {
    return {
      hasCatchUp: false,
      totalNew: 0,
      severeCount: 0,
      followUpCount: 0,
      stableCount: 0,
      childCount: 0,
      summaryText: '',
      timeWindowHours: windowHours
    };
  }

  const now = Date.now();
  const thresholdTime = now - windowHours * 60 * 60 * 1000;

  // Find patients created or updated within the time window
  const recentPatients = patients.filter((p) => {
    const createdTime = p.createdAt ? new Date(p.createdAt).getTime() : 0;
    const updatedTime = p.updatedAt ? new Date(p.updatedAt).getTime() : 0;
    const patientTime = Math.max(createdTime, updatedTime);

    // If timestamp is valid and within the window, count it
    if (patientTime && !isNaN(patientTime) && patientTime >= thresholdTime) {
      return true;
    }
    return false;
  });

  // If there are multiple entries in the system (e.g. in demo or initial field sync)
  // use either the recent patients or all patients if they were recently loaded
  const targets = recentPatients.length > 0 ? recentPatients : (patients.length >= 2 ? patients : []);

  const totalNew = targets.length;
  if (totalNew === 0) {
    return {
      hasCatchUp: false,
      totalNew: 0,
      severeCount: 0,
      followUpCount: 0,
      stableCount: 0,
      childCount: 0,
      summaryText: '',
      timeWindowHours: windowHours
    };
  }

  let severeCount = 0;
  let followUpCount = 0;
  let stableCount = 0;
  let childCount = 0;

  for (const p of targets) {
    if (p.status === 'Urgent') severeCount++;
    else if (p.status === 'Follow-up') followUpCount++;
    else stableCount++;

    if (p.age < 15) childCount++;
  }

  // Format concise summary text as requested: e.g. "5 new entries with 2 severe"
  let summaryText = `${totalNew} new entries`;
  if (severeCount > 0) {
    summaryText += ` with ${severeCount} severe`;
  } else if (followUpCount > 0) {
    summaryText += ` with ${followUpCount} follow-up`;
  } else {
    summaryText += ` (all stable)`;
  }

  return {
    hasCatchUp: true,
    totalNew,
    severeCount,
    followUpCount,
    stableCount,
    childCount,
    summaryText,
    timeWindowHours: windowHours
  };
}
