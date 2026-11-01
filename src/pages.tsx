import { useState, FormEvent, useEffect } from 'react';
import { LuPlus, LuRefreshCw, LuSearch, LuPencil, LuTriangleAlert, LuCircleCheck, LuCircleX, LuClock, LuDownload, LuSparkles } from 'react-icons/lu';
import { Button, Dialog, Tag, useToast } from './ui';
import { useStore, Status, Patient } from './store';
import { db, OutboxItem } from './lib/db';
import { useI18n } from './lib/i18n';
import { exportPatientsToCsv } from './lib/export';
import { computeCatchUpSummary } from './lib/catchup';
import {
  isChild,
  getChildVaccineStatus,
  getMilestonesForChildAge,
  getAllMilestones,
  getAllPediatricVaccines,
  toggleVaccineInFields
} from './lib/vaccination';

export const go = (p: string) => { location.hash = p; };

const PRESET_COLUMNS = [
  { label: '+ Phone', key: 'Phone Number', placeholder: '+91 9876543210' },
  { label: '+ Blood Group', key: 'Blood Group', placeholder: 'B+, O+, A+, AB+' },
  { label: '+ Aadhaar / ID', key: 'Govt ID / Aadhaar', placeholder: 'XXXX-XXXX-XXXX' },
  { label: '+ Guardian', key: 'Guardian Name', placeholder: 'Parent / Spouse' },
  { label: '+ Pregnancy / ANC', key: 'ANC Trimester', placeholder: '1st / 2nd / 3rd' },
  { label: '+ Allergies', key: 'Allergies', placeholder: 'Penicillin, Sulfa, None' }
];

export function Dashboard() {
  const { s, createPatient, updatePatientField } = useStore();
  const { t } = useI18n();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [f, setF] = useState<'All' | Status>('All');
  const [add, setAdd] = useState(false);
  const [editPatient, setEditPatient] = useState<Patient | null>(null);

  // Child vaccination states
  const [childVax, setChildVax] = useState<Record<string, boolean>>({});
  const [viewingVaxPatient, setViewingVaxPatient] = useState<Patient | null>(null);
  const [vaxModalFields, setVaxModalFields] = useState<Record<string, boolean>>({});
  const [dismissCatchUp, setDismissCatchUp] = useState(false);

  // Compute periodic catch-up summary
  const catchUp = computeCatchUpSummary(s.patients, 72);

  useEffect(() => {
    if (viewingVaxPatient) {
      const initial: Record<string, boolean> = {};
      const allVax = getAllPediatricVaccines();
      for (const v of allVax) {
        if (viewingVaxPatient.customFields?.[`vax_${v.code}`] === 'done') {
          initial[v.code] = true;
        }
      }
      setVaxModalFields(initial);
    }
  }, [viewingVaxPatient]);

  const saveVaxUpdates = async () => {
    if (!viewingVaxPatient) return;
    try {
      const updatedCustom: Record<string, string> = { ...(viewingVaxPatient.customFields || {}) };
      const allVax = getAllPediatricVaccines();
      for (const v of allVax) {
        if (vaxModalFields[v.code]) {
          updatedCustom[`vax_${v.code}`] = 'done';
        } else {
          delete updatedCustom[`vax_${v.code}`];
        }
      }
      await updatePatientField(viewingVaxPatient.id, 'customFields', JSON.stringify(updatedCustom));
      toast(`Updated vaccination record for ${viewingVaxPatient.name}`);
      setViewingVaxPatient(null);
    } catch (err: any) {
      toast(err.message || 'Failed to update vaccination record', true);
    }
  };

  // Form states for Add Patient
  const [n, setN] = useState('');
  const [a, setA] = useState('');
  const [l, setL] = useState('');
  const [customCols, setCustomCols] = useState<{ key: string; value: string }[]>([]);
  const [err, setErr] = useState('');
  const [allowDupOverride, setAllowDupOverride] = useState(false);

  // Form states for Edit Patient
  const [editField, setEditField] = useState<'locality' | 'status' | 'phone' | 'allergy'>('status');
  const [editVal, setEditVal] = useState('');
  const [editErr, setEditErr] = useState('');

  const rows = s.patients.filter(p =>
    (f === 'All' || p.status === f) &&
    (p.name + p.id + p.locality).toLowerCase().includes(q.toLowerCase())
  );

  // Real-time duplicate & contradiction detection
  const cleanName = n.trim().toLowerCase();
  const cleanLoc = l.trim().toLowerCase();
  const duplicatePatient = s.patients.find(p => {
    if (!cleanName || cleanName.length < 2) return false;
    const pClean = p.name.replace(/\s*\(synthetic\)/i, '').trim().toLowerCase();
    if (pClean === cleanName) {
      if (!cleanLoc || p.locality.trim().toLowerCase() === cleanLoc) return true;
      if (a && Math.abs(p.age - Number(a)) <= 1) return true;
    }
    // Check if phone or government ID matches
    for (const col of customCols) {
      if (col.value.trim().length >= 6 && p.customFields) {
        for (const existingVal of Object.values(p.customFields)) {
          if (existingVal.trim().toLowerCase() === col.value.trim().toLowerCase()) return true;
        }
      }
    }
    return false;
  });

  const saveNew = async (ev: FormEvent) => {
    ev.preventDefault();
    const age = Number(a);
    if (n.trim().length < 2 || !(age > 0 && age < 120) || !l.trim()) {
      return setErr('Name, age (1 to 119) and locality are required.');
    }
    if (duplicatePatient && !allowDupOverride) {
      return setErr(`Existing patient record found (${duplicatePatient.name}, ID: ${duplicatePatient.id}). Open the existing patient to update, or check 'Register Anyway' if this is a distinct individual.`);
    }

    try {
      const customMap: Record<string, string> = {};
      for (const col of customCols) {
        if (col.key.trim() && col.value.trim()) {
          customMap[col.key.trim()] = col.value.trim();
        }
      }

      if (age < 15) {
        for (const [vCode, isDone] of Object.entries(childVax)) {
          if (isDone) {
            customMap[`vax_${vCode}`] = 'done';
          }
        }
      }

      const pid = await createPatient({
        name: `${n.trim()} (synthetic)`,
        age,
        locality: l.trim(),
        status: 'Stable',
        customFields: Object.keys(customMap).length > 0 ? customMap : undefined
      });
      toast(`Saved patient ${pid} locally. Queued in outbox.`);
      setAdd(false);
      setN('');
      setA('');
      setL('');
      setChildVax({});
      setCustomCols([]);
      setErr('');
      setAllowDupOverride(false);
    } catch (e: any) {
      setErr(e.message || 'Failed to save patient');
    }
  };

  const saveEdit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!editPatient || !editVal.trim()) return setEditErr('Value is required');
    try {
      await updatePatientField(editPatient.id, editField, editVal.trim());
      toast(`Updated ${editField} for ${editPatient.id} locally.`);
      setEditPatient(null);
      setEditVal('');
      setEditErr('');
    } catch (e: any) {
      setEditErr(e.message || 'Update failed');
    }
  };

  const pendingChanges = s.syncStats.pendingCount + s.syncStats.inflightCount;

  return (
    <div className="page">
      <h1>{t.dashboard}</h1>

      {catchUp.hasCatchUp && !dismissCatchUp && (
        <div className="banner" style={{ background: '#EFF6FF', borderColor: '#3B82F6', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.25rem' }}>📋</span>
            <div>
              <span style={{ fontWeight: 800, fontSize: '0.92rem', color: '#1E40AF' }}>
                Field Catch-Up Summary: "{catchUp.summaryText}"
              </span>
              <div style={{ fontSize: '0.78rem', color: '#4B5563', marginTop: 2 }}>
                Logged in after field period · {catchUp.totalNew} entries ({catchUp.severeCount} severe, {catchUp.followUpCount} follow-up, {catchUp.childCount} pediatric &lt;15y)
              </div>
            </div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {catchUp.severeCount > 0 && (
              <Button size="sm" variant={f === 'Urgent' ? 'primary' : 'secondary'} onClick={() => setF('Urgent')}>
                🚨 Filter Severe ({catchUp.severeCount})
              </Button>
            )}
            <Button size="sm" variant="outlined" onClick={() => setF('All')}>
              View All ({catchUp.totalNew})
            </Button>
            <button
              type="button"
              style={{ background: 'none', border: 'none', fontSize: '1rem', cursor: 'pointer', color: '#6B7280', padding: '0 4px' }}
              onClick={() => setDismissCatchUp(true)}
              title="Dismiss catch-up banner"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <div className="banner">
        District: <b>{s.user?.district || 'General'}</b> · Logged in as: <b>{s.user?.name}</b> ({s.user?.role})
      </div>

      <div className="grid" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="muted">{t.patientsCount}</div>
          <h2>{s.patients.length}</h2>
        </div>
        <div className="card">
          <div className="muted">{t.pendingSync}</div>
          <h2>{pendingChanges} operation(s)</h2>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <div style={{ flex: '1 1 200px', position: 'relative' }}>
            <label className="muted" htmlFor="q" style={{ display: 'none' }}>Search</label>
            <input
              id="q"
              placeholder={t.searchPlaceholder}
              value={q}
              onChange={e => setQ(e.target.value)}
            />
          </div>
          <select
            aria-label="Filter by status"
            style={{ width: 160 }}
            value={f}
            onChange={e => setF(e.target.value as 'All')}
          >
            <option value="All">{t.filterAll}</option>
            <option value="Stable">{t.stable}</option>
            <option value="Follow-up">{t.followUp}</option>
            <option value="Urgent">{t.urgent}</option>
          </select>
          <Button icon={<LuPlus />} onClick={() => { setAdd(true); setAllowDupOverride(false); setErr(''); }}>{t.addPatient}</Button>
          <Button
            variant="outlined"
            icon={<LuDownload />}
            onClick={() => {
              exportPatientsToCsv(s.patients, s.vitals);
              toast(`Exported ${s.patients.length} patient records to CSV`);
            }}
          >
            {t.exportCsv}
          </Button>
        </div>

        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Age</th>
                <th>Locality</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => {
                const isProvisional = p.provisionalFields && Object.keys(p.provisionalFields).length > 0;
                return (
                  <tr key={p.id}>
                    <td><b>{p.id}</b></td>
                    <td>
                      {p.name}
                      {isProvisional && (
                        <span style={{ color: 'var(--maroon)', fontSize: '0.75rem', marginLeft: 6, fontWeight: 'bold' }}>
                          (Provisional Conflict)
                        </span>
                      )}
                    </td>
                    <td>
                      <div>{p.age}</div>
                      {p.age < 15 && (
                        <span
                          style={{
                            display: 'inline-block',
                            marginTop: 3,
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 10,
                            background: '#ECFDF5',
                            color: '#047857',
                            border: '1px solid #A7F3D0'
                          }}
                        >
                          👶 &lt;15y
                        </span>
                      )}
                    </td>
                    <td>
                      <div>{p.locality}</div>
                      {p.customFields && Object.keys(p.customFields).length > 0 && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                          {Object.entries(p.customFields).map(([k, v]) => (
                            <span
                              key={k}
                              style={{
                                fontSize: '0.68rem',
                                padding: '1px 5px',
                                background: '#EDE5D0',
                                borderRadius: 3,
                                color: '#4A3B32',
                                border: '1px solid #d4cbb8'
                              }}
                            >
                              <strong>{k}:</strong> {v}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td><Tag s={p.status} /></td>
                    <td>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        <Button size="sm" variant="outlined" onClick={() => go(`/vitals?p=${p.id}`)}>
                          Record vitals
                        </Button>
                        <Button size="sm" variant="outlined" icon={<LuPencil />} onClick={() => { setEditPatient(p); setEditVal(''); setEditErr(''); }}>
                          Edit
                        </Button>
                        {p.age < 15 && (
                          <Button
                            size="sm"
                            variant="outlined"
                            style={{ borderColor: '#10B981', color: '#047857', background: '#F0FDF4' }}
                            onClick={() => setViewingVaxPatient(p)}
                            title="View/Update Pediatric Vaccination Chart"
                          >
                            💉 Vax ({getChildVaccineStatus(p.age, p.customFields).completedCount}/{getChildVaccineStatus(p.age, p.customFields).totalApplicable})
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="muted"><LuSearch /> No patients match current search/filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {add && (
        <Dialog title={`${t.addPatient} (Local Write First)`} onClose={() => setAdd(false)}>
          <form onSubmit={saveNew} noValidate>
            <div className="field">
              <label htmlFor="an">{t.fullName}</label>
              <input id="an" value={n} onChange={e => setN(e.target.value)} placeholder="e.g. Balwinder Kaur" />
            </div>
            <div className="field">
              <label htmlFor="aa">{t.age}</label>
              <input id="aa" inputMode="numeric" value={a} onChange={e => setA(e.target.value)} placeholder="e.g. 42" />
            </div>
            <div className="field">
              <label htmlFor="al">{t.locality}</label>
              <input id="al" value={l} onChange={e => setL(e.target.value)} placeholder="e.g. Gill Road, Ludhiana" />
            </div>

            {/* Pediatric Vaccination Chart for Children < 15 Years */}
            {Number(a) < 15 && Number(a) >= 0 && a.trim() !== '' && (
              <div style={{ marginTop: 14, padding: '12px 14px', background: '#F0FDF4', border: '1.5px solid #86EFAC', borderRadius: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: '1.1rem' }}>👶</span>
                    <div>
                      <b style={{ color: '#166534', fontSize: '0.88rem' }}>Pediatric Vaccination Chart (Age &lt; 15)</b>
                      <span style={{ fontSize: '0.74rem', color: '#15803D', display: 'block' }}>
                        National Immunization Schedule (milestones up to age {a})
                      </span>
                    </div>
                  </div>
                  <span style={{
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 12,
                    background: '#DCFCE7',
                    color: '#166534',
                    border: '1px solid #86EFAC'
                  }}>
                    {Object.values(childVax).filter(Boolean).length} / {getMilestonesForChildAge(Number(a)).flatMap(m => m.vaccines).length} Completed
                  </span>
                </div>

                <div style={{ maxHeight: 220, overflowY: 'auto', paddingRight: 4, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {getMilestonesForChildAge(Number(a)).map(m => {
                    const allInMilestoneDone = m.vaccines.every(v => childVax[v.code]);
                    return (
                      <div key={m.id} style={{ background: '#FFFFFF', padding: '8px 10px', borderRadius: 6, border: '1px solid #BBF7D0' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#14532D' }}>
                            {m.ageLabel}
                          </span>
                          <button
                            type="button"
                            style={{
                              fontSize: '0.7rem',
                              padding: '1px 6px',
                              background: allInMilestoneDone ? '#F3F4F6' : '#ECFDF5',
                              border: '1px solid #86EFAC',
                              borderRadius: 4,
                              color: '#166534',
                              cursor: 'pointer'
                            }}
                            onClick={() => {
                              const next = { ...childVax };
                              const toggleTo = !allInMilestoneDone;
                              for (const v of m.vaccines) {
                                next[v.code] = toggleTo;
                              }
                              setChildVax(next);
                            }}
                          >
                            {allInMilestoneDone ? 'Clear all' : 'Mark all done'}
                          </button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 4 }}>
                          {m.vaccines.map(v => (
                            <label
                              key={v.code}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                fontSize: '0.78rem',
                                padding: '3px 4px',
                                cursor: 'pointer',
                                background: childVax[v.code] ? '#F0FDF4' : 'transparent',
                                borderRadius: 4
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={!!childVax[v.code]}
                                onChange={e => setChildVax({ ...childVax, [v.code]: e.target.checked })}
                              />
                              <span style={{ fontWeight: childVax[v.code] ? 700 : 500, color: childVax[v.code] ? '#166534' : 'var(--ink)' }}>
                                {v.code} <span style={{ color: '#6B7280', fontSize: '0.72rem' }}>({v.dose})</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Quick Column Presets (Feature 7) */}
            <div style={{ marginTop: 12 }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--grey)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                ⚡ Quick Presets:
              </span>
              <div className="row" style={{ gap: 4 }}>
                {PRESET_COLUMNS.map(preset => {
                  const alreadyAdded = customCols.some(c => c.key === preset.key);
                  return (
                    <button
                      key={preset.key}
                      type="button"
                      disabled={alreadyAdded}
                      style={{
                        fontSize: '0.74rem',
                        padding: '3px 8px',
                        borderRadius: 14,
                        border: '1px solid var(--line)',
                        background: alreadyAdded ? '#ececec' : '#fff',
                        color: alreadyAdded ? '#999' : 'var(--maroon)',
                        cursor: alreadyAdded ? 'default' : 'pointer',
                        fontWeight: 600
                      }}
                      onClick={() => {
                        setCustomCols([...customCols, { key: preset.key, value: '' }]);
                      }}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom Dynamic Columns */}
            <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px dashed #d0c8b6' }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--maroon)' }}>
                  {t.customColumns} ({customCols.length})
                </span>
                <button
                  type="button"
                  style={{
                    fontSize: '0.78rem',
                    padding: '3px 8px',
                    borderRadius: 4,
                    border: '1px solid var(--maroon)',
                    background: '#fff',
                    color: 'var(--maroon)',
                    cursor: 'pointer'
                  }}
                  onClick={() => setCustomCols([...customCols, { key: '', value: '' }])}
                >
                  {t.addColumn}
                </button>
              </div>

              {customCols.map((col, idx) => (
                <div key={idx} className="row" style={{ gap: 6, marginBottom: 8, alignItems: 'center' }}>
                  <input
                    style={{ flex: 1, fontSize: '0.82rem', padding: '5px 8px' }}
                    placeholder="Column Name (e.g. Blood Group, Phone, Ward)"
                    value={col.key}
                    onChange={e => {
                      const updated = [...customCols];
                      updated[idx].key = e.target.value;
                      setCustomCols(updated);
                    }}
                  />
                  <input
                    style={{ flex: 1.2, fontSize: '0.82rem', padding: '5px 8px' }}
                    placeholder="Value (e.g. B+, +91 9876543210)"
                    value={col.value}
                    onChange={e => {
                      const updated = [...customCols];
                      updated[idx].value = e.target.value;
                      setCustomCols(updated);
                    }}
                  />
                  <button
                    type="button"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#b00020',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      padding: '4px 6px'
                    }}
                    onClick={() => setCustomCols(customCols.filter((_, i) => i !== idx))}
                    title="Remove column"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            {/* Real-Time Duplicate Prevention / Anti-Contradiction Banner */}
            {duplicatePatient && (
              <div style={{ background: '#FFF3CD', border: '1px solid #FFE69C', padding: '10px 12px', borderRadius: 6, marginTop: 14, marginBottom: 6 }}>
                <div style={{ fontWeight: 700, color: '#856404', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: '0.85rem' }}>
                  <LuTriangleAlert size={16} /> {t.duplicateDetected}
                </div>
                <div style={{ fontSize: '0.82rem', color: '#664D03', lineHeight: 1.4 }}>
                  <strong>{duplicatePatient.name}</strong> (ID: {duplicatePatient.id}, {t.locality}: {duplicatePatient.locality}, {t.age}: {duplicatePatient.age}) is already recorded in the local database.
                </div>
                <div className="row" style={{ marginTop: 8, gap: 8 }}>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setAdd(false);
                      go(`/vitals?p=${duplicatePatient.id}`);
                      toast(`Opened existing patient ${duplicatePatient.id}`);
                    }}
                  >
                    {t.updateExisting} ({duplicatePatient.id})
                  </Button>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', color: '#664D03', cursor: 'pointer', margin: 0 }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto', height: 'auto' }}
                      checked={allowDupOverride}
                      onChange={e => setAllowDupOverride(e.target.checked)}
                    />
                    {t.registerAnyway}
                  </label>
                </div>
              </div>
            )}

            {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
            <div className="row" style={{ marginTop: 12 }}>
              <Button type="submit">{t.savePatient}</Button>
              <Button variant="outlined" onClick={() => setAdd(false)}>{t.cancel}</Button>
            </div>
          </form>
        </Dialog>
      )}

      {editPatient && (
        <Dialog title={`Edit ${editPatient.id} (${editPatient.name})`} onClose={() => setEditPatient(null)}>
          <form onSubmit={saveEdit} noValidate>
            <div className="field">
              <label htmlFor="ef">Field to update</label>
              <select id="ef" value={editField} onChange={e => setEditField(e.target.value as any)}>
                <option value="status">Status</option>
                <option value="locality">Locality</option>
                <option value="allergy">Allergy</option>
                <option value="phone">Phone</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="ev">New value</label>
              {editField === 'status' ? (
                <select id="ev" value={editVal} onChange={e => setEditVal(e.target.value)}>
                  <option value="">Select status...</option>
                  <option value="Stable">Stable</option>
                  <option value="Follow-up">Follow-up</option>
                  <option value="Urgent">Urgent</option>
                </select>
              ) : (
                <input id="ev" value={editVal} onChange={e => setEditVal(e.target.value)} placeholder={`Enter new ${editField}`} />
              )}
            </div>
            {editErr && <div className="err">{editErr}</div>}
            <div className="row" style={{ marginTop: 12 }}>
              <Button type="submit">Save update</Button>
              <Button variant="outlined" onClick={() => setEditPatient(null)}>Cancel</Button>
            </div>
          </form>
        </Dialog>
      )}

      {viewingVaxPatient && (
        <Dialog
          title={`👶 Pediatric Vaccination Record: ${viewingVaxPatient.name} (Age: ${viewingVaxPatient.age})`}
          onClose={() => setViewingVaxPatient(null)}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, padding: '8px 12px', background: '#F0FDF4', borderRadius: 6, border: '1px solid #BBF7D0' }}>
              <div>
                <b style={{ color: '#166534', fontSize: '0.9rem' }}>National Immunization Status</b>
                <div style={{ fontSize: '0.75rem', color: '#15803D' }}>
                  Pediatric milestone vaccination tracking (Birth to 16 years).
                </div>
              </div>
              <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#166534', padding: '3px 8px', background: '#DCFCE7', borderRadius: 12, border: '1px solid #86EFAC' }}>
                {Object.values(vaxModalFields).filter(Boolean).length} / {getMilestonesForChildAge(viewingVaxPatient.age).flatMap(m => m.vaccines).length} Completed
              </span>
            </div>

            <div style={{ maxHeight: '55vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 4 }}>
              {getMilestonesForChildAge(viewingVaxPatient.age).map(m => {
                const allDone = m.vaccines.every(v => vaxModalFields[v.code]);
                return (
                  <div key={m.id} style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '8px 12px', background: '#FFF' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--maroon)' }}>
                        {m.ageLabel}
                      </span>
                      <button
                        type="button"
                        style={{
                          fontSize: '0.72rem',
                          padding: '2px 8px',
                          background: allDone ? '#F3F4F6' : '#ECFDF5',
                          border: '1px solid #10B981',
                          borderRadius: 4,
                          color: '#047857',
                          cursor: 'pointer',
                          fontWeight: 600
                        }}
                        onClick={() => {
                          const next = { ...vaxModalFields };
                          const toVal = !allDone;
                          for (const v of m.vaccines) {
                            next[v.code] = toVal;
                          }
                          setVaxModalFields(next);
                        }}
                      >
                        {allDone ? 'Clear milestone' : 'Mark all done'}
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
                      {m.vaccines.map(v => (
                        <label
                          key={v.code}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '4px 6px',
                            borderRadius: 4,
                            cursor: 'pointer',
                            background: vaxModalFields[v.code] ? '#ECFDF5' : 'transparent',
                            border: `1px solid ${vaxModalFields[v.code] ? '#A7F3D0' : 'transparent'}`
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={!!vaxModalFields[v.code]}
                            onChange={e => setVaxModalFields({ ...vaxModalFields, [v.code]: e.target.checked })}
                          />
                          <span style={{ fontSize: '0.8rem', fontWeight: vaxModalFields[v.code] ? 700 : 400 }}>
                            <b>{v.code}</b> – {v.name}
                            <span style={{ display: 'block', fontSize: '0.7rem', color: '#6B7280' }}>
                              Dose: {v.dose} {v.essential && <span style={{ color: '#DC2626' }}>· Essential</span>}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end', gap: 8 }}>
              <Button variant="outlined" onClick={() => setViewingVaxPatient(null)}>Cancel</Button>
              <Button onClick={saveVaxUpdates}>Save Immunization Updates</Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

const lim: Record<string, [number, number, string]> = {
  sys: [60, 260, 'Systolic'],
  dia: [30, 160, 'Diastolic'],
  pulse: [30, 220, 'Pulse (bpm)'],
  temp: [33, 43, 'Temperature (C)'],
  spo2: [50, 100, 'Oxygen saturation (%)']
};

export function Vitals({ pid }: { pid: string }) {
  const { s, saveVitals } = useStore();
  const toast = useToast();
  const [p, setP] = useState(pid || s.patients[0]?.id || '');
  const [v, setV] = useState<Record<string, string>>({});
  const [e, setE] = useState<Record<string, string>>({});

  useEffect(() => {
    if (pid) setP(pid);
    else if (!p && s.patients.length > 0) setP(s.patients[0].id);
  }, [pid, s.patients]);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const x: Record<string, string> = {};
    for (const k in lim) {
      const n = Number(v[k]);
      if (!v[k] || isNaN(n) || n < lim[k][0] || n > lim[k][1]) {
        x[k] = `${lim[k][2]}: enter ${lim[k][0]} to ${lim[k][1]}.`;
      }
    }
    if (!p) x.p = 'Select a patient.';
    if (!x.sys && !x.dia && Number(v.dia) >= Number(v.sys)) {
      x.dia = 'Diastolic must be lower than systolic.';
    }
    setE(x);
    if (Object.keys(x).length) return toast('Reading not saved. Fix the errors.', true);

    try {
      const vid = await saveVitals(p, {
        sys: +v.sys,
        dia: +v.dia,
        pulse: +v.pulse,
        temp: +v.temp,
        spo2: +v.spo2
      });
      toast(`Vitals ${vid} saved on device. Queued for sync.`);
      setV({});
    } catch (err: any) {
      toast(err.message || 'Failed to save vitals', true);
    }
  };

  const mine = s.vitals.filter(x => x.patientId === p);
  const activePatient = s.patients.find(x => x.id === p);

  return (
    <div className="page">
      <h1>Vitals registration</h1>
      <form className="card" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="vp">Patient</label>
          <select id="vp" value={p} onChange={x => setP(x.target.value)}>
            {s.patients.map(x => (
              <option key={x.id} value={x.id}>{x.id} {x.name}</option>
            ))}
          </select>
          {activePatient?.customFields && Object.keys(activePatient.customFields).length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {Object.entries(activePatient.customFields).map(([k, val]) => (
                <span
                  key={k}
                  style={{
                    fontSize: '0.72rem',
                    padding: '2px 8px',
                    background: '#EDE5D0',
                    borderRadius: 4,
                    color: '#4A3B32',
                    border: '1px solid #d4cbb8'
                  }}
                >
                  <strong>{k}:</strong> {val}
                </span>
              ))}
            </div>
          )}

          {activePatient && activePatient.age < 15 && (
            <div style={{ marginTop: 10, padding: '8px 12px', background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>👶</span>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#065F46' }}>
                  Pediatric Patient (Age: {activePatient.age}y)
                </span>
              </div>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#047857' }}>
                💉 {getChildVaccineStatus(activePatient.age, activePatient.customFields).completedCount} / {getChildVaccineStatus(activePatient.age, activePatient.customFields).totalApplicable} Vaccines Done
              </span>
            </div>
          )}
        </div>
        <div className="grid">
          {Object.keys(lim).map(k => (
            <div className="field" key={k}>
              <label htmlFor={k}>{lim[k][2]}</label>
              <input
                id={k}
                inputMode="decimal"
                value={v[k] || ''}
                onChange={x => setV({ ...v, [k]: x.target.value })}
                aria-invalid={!!e[k]}
              />
              {e[k] && <div className="err">{e[k]}</div>}
            </div>
          ))}
        </div>
        <div className="row">
          <Button type="submit">Save reading</Button>
          <Button variant="outlined" onClick={() => { setV({}); setE({}); }}>Reset</Button>
          <Button variant="text" onClick={() => go('/dashboard')}>Back to dashboard</Button>
        </div>
      </form>

      <div className="card">
        <h2>Readings history for {p}</h2>
        {mine.length ? (
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>BP (mmHg)</th>
                  <th>Pulse (bpm)</th>
                  <th>Temp (°C)</th>
                  <th>SpO2 (%)</th>
                </tr>
              </thead>
              <tbody>
                {mine.map(x => (
                  <tr key={x.id}>
                    <td>{new Date(x.at).toLocaleString()}</td>
                    <td><b>{x.sys}/{x.dia}</b></td>
                    <td>{x.pulse}</td>
                    <td>{x.temp}</td>
                    <td>{x.spo2}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No vitals readings recorded yet for this patient.</p>
        )}
      </div>
    </div>
  );
}

export function Doctor() {
  const { s } = useStore();
  const [f, setF] = useState<'All' | Status>('All');
  const [dismissCatchUp, setDismissCatchUp] = useState(false);
  const catchUp = computeCatchUpSummary(s.patients, 72);
  const rank: Record<Status, number> = { Urgent: 0, 'Follow-up': 1, Stable: 2 };

  const rows = [...s.patients]
    .filter(p => f === 'All' || p.status === f)
    .sort((a, b) => rank[a.status] - rank[b.status]);

  const openConflicts = s.conflicts.filter(c => c.state === 'open');

  return (
    <div className="page">
      <h1>Doctor triage</h1>

      {catchUp.hasCatchUp && !dismissCatchUp && (
        <div className="banner" style={{ background: '#EFF6FF', borderColor: '#3B82F6', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.25rem' }}>📋</span>
            <div>
              <span style={{ fontWeight: 800, fontSize: '0.92rem', color: '#1E40AF' }}>
                Field Catch-Up Summary: "{catchUp.summaryText}"
              </span>
              <div style={{ fontSize: '0.78rem', color: '#4B5563', marginTop: 2 }}>
                Multiple field records logged across last 72h ({catchUp.severeCount} severe, {catchUp.followUpCount} follow-up, {catchUp.childCount} pediatric entries)
              </div>
            </div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {catchUp.severeCount > 0 && (
              <Button size="sm" variant={f === 'Urgent' ? 'primary' : 'secondary'} onClick={() => setF('Urgent')}>
                🚨 Filter Severe ({catchUp.severeCount})
              </Button>
            )}
            <Button size="sm" variant="outlined" onClick={() => setF('All')}>
              View All ({catchUp.totalNew})
            </Button>
            <button
              type="button"
              style={{ background: 'none', border: 'none', fontSize: '1rem', cursor: 'pointer', color: '#6B7280', padding: '0 4px' }}
              onClick={() => setDismissCatchUp(true)}
              title="Dismiss catch-up banner"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      {openConflicts.length > 0 && (
        <div className="banner" role="alert" style={{ background: '#FEE2E2', borderColor: '#DC2626' }}>
          <LuTriangleAlert size={18} style={{ color: '#DC2626' }} />
          <span><b>{openConflicts.length} concurrent conflict(s)</b> require clinical decision.</span>
          <Button size="sm" variant="outlined" onClick={() => go('/doctor/conflicts')}>
            Review conflicts
          </Button>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <select
            aria-label="Filter by status"
            style={{ width: 160 }}
            value={f}
            onChange={e => setF(e.target.value as 'All')}
          >
            <option>All</option>
            <option>Urgent</option>
            <option>Follow-up</option>
            <option>Stable</option>
          </select>
        </div>

        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Patient</th>
                <th>District</th>
                <th>Latest vitals</th>
                <th>Open conflicts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => {
                const v = s.vitals.find(x => x.patientId === p.id);
                const patConflicts = openConflicts.filter(c => c.patientId === p.id);
                return (
                  <tr key={p.id}>
                    <td><Tag s={p.status} /></td>
                    <td>
                      <div><b>{p.id}</b> {p.name}</div>
                      {p.age < 15 && (
                        <div style={{ marginTop: 2 }}>
                          <span style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 10,
                            background: '#ECFDF5',
                            color: '#047857',
                            border: '1px solid #A7F3D0'
                          }}>
                            👶 Child ({p.age}y) · 💉 {getChildVaccineStatus(p.age, p.customFields).completedCount}/{getChildVaccineStatus(p.age, p.customFields).totalApplicable} Vax
                          </span>
                        </div>
                      )}
                    </td>
                    <td>{p.district}</td>
                    <td>{v ? `BP ${v.sys}/${v.dia}, SpO2 ${v.spo2}%` : 'None recorded'}</td>
                    <td>
                      {patConflicts.length > 0 ? (
                        <span style={{ color: '#DC2626', fontWeight: 'bold' }}>
                          {patConflicts.length} open
                        </span>
                      ) : (
                        <span className="muted">0</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function Conflicts() {
  const { s, resolveConflict } = useStore();
  const toast = useToast();
  const [pend, setPend] = useState<{ id: string; field: string; kind: string; val: string } | null>(null);
  const [man, setMan] = useState<Record<string, string>>({});

  const open = s.conflicts.filter(c => c.state === 'open');

  const confirm = async () => {
    if (!pend) return;
    try {
      await resolveConflict(pend.id, pend.field, pend.val, pend.kind);
      toast(`Resolved ${pend.field}: ${pend.val}`);
      setPend(null);
    } catch (err: any) {
      toast(err.message || 'Failed to resolve conflict', true);
    }
  };

  return (
    <div className="page">
      <h1>Conflict resolution (Multi-value Registers)</h1>
      <p className="muted">
        Concurrent edits create immutable siblings. Zero silent data loss: neither value is discarded until a doctor confirms.
      </p>

      {!open.length && <div className="card">No unresolved conflicts. All field registers in sync.</div>}

      {open.map(c => (
        <div
          className="card"
          key={c.id}
          style={c.isCritical ? { borderLeft: '4px solid #DC2626' } : {}}
        >
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <h2>{c.patientId} · {c.field}</h2>
            {c.isCritical && (
              <span style={{ background: '#DC2626', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 'bold' }}>
                CRITICAL (Medication / Allergy)
              </span>
            )}
          </div>

          <div className="cols">
            <div className="card old">
              <b>Existing Branch</b>
              <p>{c.existing}</p>
              <span className="muted">Event {c.siblings[0]?.eventId?.slice(0, 8)}</span>
            </div>
            <div className="card new">
              <b>Concurrent Incoming Branch</b>
              <p>{c.incoming}</p>
              <span className="muted">{c.device} · HLC {c.hlc}</span>
            </div>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <Button variant="outlined" onClick={() => setPend({ id: c.id, field: c.field, kind: 'Kept existing', val: c.existing })}>
              Keep existing
            </Button>
            <Button variant="secondary" onClick={() => setPend({ id: c.id, field: c.field, kind: 'Accepted incoming', val: c.incoming })}>
              Accept incoming
            </Button>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <input
              aria-label={`Manual merged value for ${c.id}`}
              style={{ maxWidth: 260 }}
              placeholder="Custom blended value"
              value={man[c.id] || ''}
              onChange={e => setMan({ ...man, [c.id]: e.target.value })}
            />
            <Button
              variant="outlined"
              disabled={!man[c.id]?.trim()}
              onClick={() => setPend({ id: c.id, field: c.field, kind: 'Merged manually', val: man[c.id].trim() })}
            >
              Merge manually
            </Button>
          </div>
        </div>
      ))}

      <div className="card">
        <h2>Audit history</h2>
        {s.audit.length ? (
          s.audit.map((a, i) => <p key={i} className="muted" style={{ fontSize: '0.85rem' }}>{a}</p>)
        ) : (
          <p className="muted">No audit events yet.</p>
        )}
      </div>

      {pend && (
        <Dialog title="Confirm Clinical Resolution" onClose={() => setPend(null)}>
          <p>Resolution for <b>{pend.field}</b>:</p>
          <div className="card" style={{ background: '#F8FAFC', margin: '8px 0' }}>
            <b>{pend.kind}</b>: <span>{pend.val}</span>
          </div>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            This human decision will be authored into the immutable log and synced to all devices.
          </p>
          <div className="row" style={{ marginTop: 16 }}>
            <Button onClick={confirm}>Confirm Decision</Button>
            <Button variant="outlined" onClick={() => setPend(null)}>Cancel</Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

export function Sync() {
  const { s, triggerSync } = useStore();
  const toast = useToast();
  const [recentOutbox, setRecentOutbox] = useState<OutboxItem[]>([]);

  useEffect(() => {
    db.outbox.reverse().limit(10).toArray().then(items => setRecentOutbox(items));
    const interval = setInterval(() => {
      db.outbox.reverse().limit(10).toArray().then(items => setRecentOutbox(items));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleSyncClick = async () => {
    if (!s.online) {
      return toast('Offline mode active. Operations are preserved locally in IndexedDB.', true);
    }
    toast('Sync started in background...');
    await triggerSync();
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'synced': return <LuCircleCheck style={{ color: '#10B981' }} />;
      case 'rejected': return <LuCircleX style={{ color: '#DC2626' }} />;
      case 'inflight': return <LuRefreshCw className="spin" style={{ color: '#3B82F6' }} />;
      default: return <LuClock style={{ color: '#F59E0B' }} />;
    }
  };

  return (
    <div className="page">
      <h1>Sync manager</h1>
      <div className="banner">
        Status: <b>{s.online ? 'Online (Connected)' : 'Offline (Local Writes Only)'}</b>
      </div>

      <div className="grid" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="muted">Pending Upload</div>
          <h2>{s.syncStats.pendingCount}</h2>
        </div>
        <div className="card">
          <div className="muted">In-flight</div>
          <h2>{s.syncStats.inflightCount}</h2>
        </div>
        <div className="card">
          <div className="muted">Acknowledged (Synced)</div>
          <h2>{s.syncStats.syncedCount}</h2>
        </div>
        <div className="card">
          <div className="muted">Rejected</div>
          <h2>{s.syncStats.rejectedCount}</h2>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <b>Last Sync Time:</b> {s.syncStats.lastSyncTime || 'Never'}
            {s.syncStats.lastError && (
              <div style={{ color: '#DC2626', fontSize: '0.85rem', marginTop: 4 }}>
                Last Error: {s.syncStats.lastError}
              </div>
            )}
          </div>
          <Button
            icon={<LuRefreshCw className={s.syncStats.isSyncing ? 'spin' : ''} />}
            onClick={handleSyncClick}
            disabled={s.syncStats.isSyncing}
          >
            {s.syncStats.isSyncing ? 'Syncing...' : 'Sync Now'}
          </Button>
        </div>

        <h3>Recent Outbox Operations</h3>
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Event ID</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Last Attempt</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {recentOutbox.map(item => (
                <tr key={item.eventId}>
                  <td><code>{item.eventId.slice(0, 12)}...</code></td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {getStatusIcon(item.status)}
                      <b>{item.status.toUpperCase()}</b>
                    </span>
                  </td>
                  <td>{item.attempts}</td>
                  <td>{item.lastAttemptAt ? new Date(item.lastAttemptAt).toLocaleTimeString() : 'Pending'}</td>
                  <td>{item.lastError ? <span style={{ color: '#DC2626' }}>{item.lastError}</span> : '-'}</td>
                </tr>
              ))}
              {!recentOutbox.length && (
                <tr>
                  <td colSpan={5} className="muted">Outbox is clear. No queued operations.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
