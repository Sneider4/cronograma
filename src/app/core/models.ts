export type Status = 'pendiente' | 'en_proceso' | 'bloqueada' | 'completada';
export type Priority = 'alta' | 'media' | 'baja';
export type Role = 'owner' | 'editor';

export interface Profile {
  id: string;
  full_name: string;
  email: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  color: string;
  invite_code: string;
  created_by: string;
  created_at: string;
}

export interface Member {
  project_id: string;
  user_id: string;
  role: Role;
  joined_at: string;
  profile?: Profile;
}

export interface Objective {
  id: string;
  project_id: string;
  code: string;
  name: string;
  color: string;
}

export interface Task {
  id: string;
  project_id: string;
  objective_id: string | null;
  name: string;
  /** YYYY-MM-DD */
  start_date: string;
  /** YYYY-MM-DD, inclusiva */
  end_date: string;
  status: Status;
  priority: Priority;
  progress: number;
  deliverable: string;
  assignee: string;
  notes: string;
  evidence_url: string;
  created_at: string;
  updated_at: string;
}

export type TaskDraft = Omit<Task, 'id' | 'project_id' | 'created_at' | 'updated_at'>;

export const STATUSES: { value: Status; label: string; color: string }[] = [
  { value: 'pendiente', label: 'Pendiente', color: '#b4b6bd' },
  { value: 'en_proceso', label: 'En proceso', color: '#c2652a' },
  { value: 'bloqueada', label: 'Bloqueada', color: '#c23a2c' },
  { value: 'completada', label: 'Completada', color: '#0b0b0c' },
];

export const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'alta', label: 'Alta' },
  { value: 'media', label: 'Media' },
  { value: 'baja', label: 'Baja' },
];

export const PALETTE = [
  // Cobre, negro y grises frios, con variaciones para distinguir objetivos.
  '#c2652a',
  '#0b0b0c',
  '#8e9097',
  '#e0914f',
  '#4a4b51',
  '#7a3612',
  '#c4c6cc',
  '#a8774f',
];

export const statusLabel = (s: Status) => STATUSES.find((x) => x.value === s)?.label ?? s;
export const statusColor = (s: Status) => STATUSES.find((x) => x.value === s)?.color ?? '#b4b6bd';
export const priorityLabel = (p: Priority) => PRIORITIES.find((x) => x.value === p)?.label ?? p;

export const NO_OBJECTIVE_COLOR = '#a4a6ad';

/** Texto legible sobre un fondo: casi negro en fondos claros, blanco en oscuros. */
export function textOn(hex: string): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum > 0.35 ? '#0b0b0c' : '#ffffff';
}
