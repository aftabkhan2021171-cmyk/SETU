/**
 * Offline CSV / Excel Export Engine for SETU.
 * Generates RFC 4180 compliant CSV files with full patient records,
 * custom dynamic columns, and latest clinical vitals.
 * Operates 100% offline in browser memory.
 */

import { PatientRecord, VitalRecord } from './db';

function escapeCsv(val: any): string {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

export function exportPatientsToCsv(patients: PatientRecord[], vitals: VitalRecord[]): void {
  // Collect all unique custom field names across all patients
  const customFieldKeys = new Set<string>();
  for (const p of patients) {
    if (p.customFields) {
      for (const k of Object.keys(p.customFields)) {
        customFieldKeys.add(k);
      }
    }
  }
  const customHeaders = Array.from(customFieldKeys);

  // Map latest vitals per patient
  const latestVitalsMap = new Map<string, VitalRecord>();
  for (const v of vitals) {
    const existing = latestVitalsMap.get(v.patientId);
    if (!existing || new Date(v.at).getTime() > new Date(existing.at).getTime()) {
      latestVitalsMap.set(v.patientId, v);
    }
  }

  // Build CSV headers
  const headers = [
    'Patient ID',
    'Full Name',
    'Age',
    'Locality / Village',
    'District',
    'Clinical Status',
    ...customHeaders,
    'Latest Blood Pressure',
    'Systolic (mmHg)',
    'Diastolic (mmHg)',
    'Heart Rate / Pulse (bpm)',
    'Temperature (°C)',
    'SpO2 (%)',
    'Last Vitals Recorded At'
  ];

  const rows: string[] = [headers.map(escapeCsv).join(',')];

  for (const p of patients) {
    const v = latestVitalsMap.get(p.id);
    const bpStr = v ? `${v.sys}/${v.dia}` : 'N/A';
    const sys = v ? String(v.sys) : '';
    const dia = v ? String(v.dia) : '';
    const pulse = v ? String(v.pulse) : '';
    const temp = v ? String(v.temp) : '';
    const spo2 = v ? String(v.spo2) : '';
    const vitalsAt = v ? new Date(v.at).toLocaleString() : 'No readings yet';

    const customValues = customHeaders.map(h => p.customFields?.[h] || '');

    const row = [
      p.id,
      p.name,
      p.age,
      p.locality,
      p.district || 'General',
      p.status,
      ...customValues,
      bpStr,
      sys,
      dia,
      pulse,
      temp,
      spo2,
      vitalsAt
    ];

    rows.push(row.map(escapeCsv).join(','));
  }

  const csvContent = '\uFEFF' + rows.join('\r\n'); // Add UTF-8 BOM so Excel opens Indian language scripts properly!
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const now = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `SETU_Patient_Records_${now}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
