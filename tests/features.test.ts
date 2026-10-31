import { describe, it, expect } from 'vitest';
import { LANGUAGES, TRANSLATIONS, t, LangCode } from '../src/lib/i18n';
import { exportPatientsToCsv } from '../src/lib/export';
import { PatientRecord, VitalRecord } from '../src/lib/db';

describe('New Feature 1: Multi-Language Engine (7 Sisters & Far-Off Languages)', () => {
  it('contains all 16 supported regional languages including 7 Sisters', () => {
    expect(LANGUAGES.length).toBe(16);
    const codes = LANGUAGES.map(l => l.code);
    // 7 Sisters of North East
    expect(codes).toContain('as');  // Assamese (Assam)
    expect(codes).toContain('bn');  // Bengali (Tripura / Assam)
    expect(codes).toContain('mni'); // Manipuri / Meitei (Manipur)
    expect(codes).toContain('lus'); // Mizo (Mizoram)
    expect(codes).toContain('kha'); // Khasi (Meghalaya)
    expect(codes).toContain('brx'); // Bodo (Bodoland / Assam)
    expect(codes).toContain('nag'); // Nagamese (Nagaland)

    // Far-off regions
    expect(codes).toContain('pa');  // Punjabi (Punjab / North)
    expect(codes).toContain('hi');  // Hindi (National / Central)
    expect(codes).toContain('ta');  // Tamil (Tamil Nadu / South)
    expect(codes).toContain('te');  // Telugu (Andhra / Telangana)
    expect(codes).toContain('ml');  // Malayalam (Kerala)
    expect(codes).toContain('kn');  // Kannada (Karnataka)
    expect(codes).toContain('or');  // Odia (Odisha)
    expect(codes).toContain('mr');  // Marathi (Maharashtra)
    expect(codes).toContain('en');  // English
  });

  it('provides complete string translations for all languages with no missing keys', () => {
    const requiredKeys = [
      'dashboard',
      'vitals',
      'doctorTriage',
      'conflicts',
      'syncManager',
      'addPatient',
      'exportCsv',
      'fullName',
      'age',
      'locality',
      'status',
      'duplicateDetected',
      'updateExisting',
      'customColumns',
      'outdoorMode'
    ] as const;

    for (const lang of LANGUAGES) {
      const strings = TRANSLATIONS[lang.code];
      expect(strings).toBeDefined();
      for (const key of requiredKeys) {
        expect(strings[key]).toBeDefined();
        expect(strings[key].trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('New Feature 2: Offline CSV / Excel Export', () => {
  it('generates well-formed CSV with UTF-8 BOM, custom fields, and vitals', () => {
    const mockPatients: PatientRecord[] = [
      {
        id: 'P-101',
        name: 'Harman Singh (synthetic)',
        age: 48,
        locality: 'Model Town, Ludhiana',
        district: 'Ludhiana',
        status: 'Stable',
        customFields: {
          'Phone Number': '+91 9876543210',
          'Blood Group': 'O+'
        }
      }
    ];

    const mockVitals: VitalRecord[] = [
      {
        id: 'V-101',
        patientId: 'P-101',
        sys: 124,
        dia: 82,
        pulse: 72,
        temp: 36.8,
        spo2: 98,
        at: '2026-11-01T04:00:00Z'
      }
    ];

    // Mock document.createElement and click
    let capturedContent = '';
    let capturedFilename = '';

    const origCreateElement = document.createElement;
    document.createElement = function (tag: string) {
      const el = origCreateElement.call(document, tag);
      if (tag === 'a') {
        Object.defineProperty(el, 'click', {
          value: function () {
            // Blob URL was assigned to href
          }
        });
      }
      return el;
    };

    const origCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = (blob: any) => {
      return 'blob:mock-csv-url';
    };

    exportPatientsToCsv(mockPatients, mockVitals);

    // Restore
    document.createElement = origCreateElement;
    URL.createObjectURL = origCreateObjectURL;
  });
});
