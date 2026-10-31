import { createContext, useContext, useEffect, useState, ReactNode, ButtonHTMLAttributes } from 'react'
type V = 'primary' | 'secondary' | 'outlined' | 'text' | 'danger'
type B = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: V; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode }
export function Button({ variant = 'primary', size = 'md', icon, children, className = '', ...r }: B) {
  return <button type="button" {...r} className={`btn ${variant} ${size === 'md' ? '' : size} ${className}`}>{icon}{children}</button>
}
export function IconButton({ label, children, size = 'md', ...r }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'sm' | 'md' }) {
  return <button type="button" aria-label={label} title={label} {...r} className={`btn icon ${size === 'sm' ? 'sm' : ''}`}>{children}</button>
}
const T = createContext<(m: string, bad?: boolean) => void>(() => {})
export const useToast = () => useContext(T)
export function Toasts({ children }: { children: ReactNode }) {
  const [l, setL] = useState<{ id: number; m: string; bad?: boolean }[]>([])
  const push = (m: string, bad?: boolean) => { const id = Date.now() + Math.random(); setL(x => [...x, { id, m, bad }]); setTimeout(() => setL(x => x.filter(i => i.id !== id)), 3500) }
  return <T.Provider value={push}>{children}<div className="toasts" role="status" aria-live="polite">{l.map(i => <div key={i.id} className={`toast ${i.bad ? 'bad' : ''}`}>{i.m}</div>)}</div></T.Provider>
}
export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [onClose])
  return <div className="back" onClick={onClose}><div className="dlg" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}><h2>{title}</h2>{children}</div></div>
}
export const Tag = ({ s }: { s: string }) => <span className={`tag ${/Stable|Acknowledged|resolved/i.test(s) ? 't-ok' : /Urgent|Failed|open/i.test(s) ? 't-bad' : 't-warn'}`}>{s}</span>
