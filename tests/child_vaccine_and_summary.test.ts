import { describe, it, expect } from 'vitest';
import {
  isChild,
  getMilestonesForChildAge,
  getAllMilestones,
  getAllPediatricVaccines,
  getChildVaccineStatus,
  toggleVaccineInFields
} from '../src/lib/vaccination';
import { computeCatchUpSummary } from '../src/lib/catchup';
import { CADRE_INFO, SEEDED_OFFLINE_USERS, HealthWorkerCadre } from '../src/lib/auth';
import { PatientRecord } from '../src/lib/db';

describe('Health Worker Cadres & Roles', () => {
  it('defines all required frontline cadres: ASHA, ANM, AWW, CHW, DOCTOR, ADMIN', () => {
    const requiredCadres: HealthWorkerCadre[] = ['ASHA', 'ANM', 'AWW', 'CHW', 'DOCTOR', 'ADMIN'];
    for (const cadre of requiredCadres) {
      expect(CADRE_INFO[cadre]).toBeDefined();
      expect(CADRE_INFO[cadre].label).toBeDefined();
      expect(CADRE_INFO[cadre].title).toBeDefined();
      expect(CADRE_INFO[cadre].color).toBeDefined();
      expect(CADRE_INFO[cadre].bg).toBeDefined();
    }
  });

  it('includes seeded offline accounts for each cadre', () => {
    expect(SEEDED_OFFLINE_USERS.asha1).toBeDefined();
    expect(SEEDED_OFFLINE_USERS.asha1.user.cadre).toBe('ASHA');

    expect(SEEDED_OFFLINE_USERS.anm1).toBeDefined();
    expect(SEEDED_OFFLINE_USERS.anm1.user.cadre).toBe('ANM');

    expect(SEEDED_OFFLINE_USERS.aww1).toBeDefined();
    expect(SEEDED_OFFLINE_USERS.aww1.user.cadre).toBe('AWW');

    expect(SEEDED_OFFLINE_USERS.chw1.user.cadre).toBe('CHW');
    expect(SEEDED_OFFLINE_USERS.doctor1.user.cadre).toBe('DOCTOR');
    expect(SEEDED_OFFLINE_USERS.admin1.user.cadre).toBe('ADMIN');
  });
});

describe('Pediatric Vaccination Chart for Children Under 15', () => {
  it('correctly identifies children < 15 years', () => {
    expect(isChild(0)).toBe(true);
    expect(isChild(0.5)).toBe(true);
    expect(isChild(5)).toBe(true);
    expect(isChild(14.9)).toBe(true);
    expect(isChild(15)).toBe(false);
    expect(isChild(42)).toBe(false);
  });

  it('returns milestones for a newborn (Birth)', () => {
    const milestones = getMilestonesForChildAge(0);
    expect(milestones.length).toBeGreaterThan(0);
    const birthMilestone = milestones.find(m => m.id === 'birth');
    expect(birthMilestone).toBeDefined();
    const codes = birthMilestone!.vaccines.map(v => v.code);
    expect(codes).toContain('BCG');
    expect(codes).toContain('OPV_0');
    expect(codes).toContain('HEPB_BIRTH');
  });

  it('returns milestones for a 5-year-old child', () => {
    const milestones = getMilestonesForChildAge(5);
    const ids = milestones.map(m => m.id);
    expect(ids).toContain('birth');
    expect(ids).toContain('6_weeks');
    expect(ids).toContain('10_weeks');
    expect(ids).toContain('14_weeks');
    expect(ids).toContain('9_months');
    expect(ids).toContain('16_24_months');
    expect(ids).toContain('5_6_years');
  });

  it('returns empty applicable milestones for person aged 15 or older', () => {
    const milestones = getMilestonesForChildAge(15);
    expect(milestones).toEqual([]);

    const adultStatus = getChildVaccineStatus(25);
    expect(adultStatus.totalApplicable).toBe(0);
    expect(adultStatus.percent).toBe(100);
  });

  it('computes vaccine status when vaccines are checked off', () => {
    // Child aged 1 year (12 months)
    const customFields: Record<string, string> = {
      vax_BCG: 'done',
      vax_OPV_0: 'done',
      vax_PENTA_1: 'done'
    };

    const status = getChildVaccineStatus(1, customFields);
    expect(status.totalApplicable).toBeGreaterThan(3);
    expect(status.completedCount).toBe(3);
    expect(status.pendingCount).toBe(status.totalApplicable - 3);
    expect(status.percent).toBeGreaterThan(0);
    expect(status.percent).toBeLessThan(100);
  });

  it('toggles vaccines in customFields correctly', () => {
    let fields: Record<string, string> = {};
    fields = toggleVaccineInFields(fields, 'BCG', true);
    expect(fields.vax_BCG).toBe('done');

    fields = toggleVaccineInFields(fields, 'BCG', false);
    expect(fields.vax_BCG).toBeUndefined();
  });
});

describe('Field Catch-Up Periodic Summary', () => {
  it('generates exact summary text like "5 new entries with 2 severe"', () => {
    const now = new Date().toISOString();
    const samplePatients: PatientRecord[] = [
      {
        id: 'P-001',
        name: 'Patient One',
        age: 5,
        locality: 'Ludhiana',
        status: 'Urgent',
        district: 'Ludhiana',
        createdBy: 'u-1',
        version: 1,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'P-002',
        name: 'Patient Two',
        age: 12,
        locality: 'Ludhiana',
        status: 'Urgent',
        district: 'Ludhiana',
        createdBy: 'u-1',
        version: 1,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'P-003',
        name: 'Patient Three',
        age: 30,
        locality: 'Khanna',
        status: 'Follow-up',
        district: 'Khanna',
        createdBy: 'u-1',
        version: 1,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'P-004',
        name: 'Patient Four',
        age: 65,
        locality: 'Ludhiana',
        status: 'Stable',
        district: 'Ludhiana',
        createdBy: 'u-1',
        version: 1,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'P-005',
        name: 'Patient Five',
        age: 8,
        locality: 'Ludhiana',
        status: 'Stable',
        district: 'Ludhiana',
        createdBy: 'u-1',
        version: 1,
        createdAt: now,
        updatedAt: now
      }
    ];

    const summary = computeCatchUpSummary(samplePatients, 72);

    expect(summary.hasCatchUp).toBe(true);
    expect(summary.totalNew).toBe(5);
    expect(summary.severeCount).toBe(2);
    expect(summary.followUpCount).toBe(1);
    expect(summary.stableCount).toBe(2);
    expect(summary.childCount).toBe(3); // Ages 5, 12, 8 are < 15
    expect(summary.summaryText).toBe('5 new entries with 2 severe');
  });

  it('handles empty patient lists gracefully', () => {
    const summary = computeCatchUpSummary([]);
    expect(summary.hasCatchUp).toBe(false);
    expect(summary.totalNew).toBe(0);
    expect(summary.severeCount).toBe(0);
  });
});
