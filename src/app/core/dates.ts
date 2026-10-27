/**
 * Las tareas manejan fechas sin hora ('YYYY-MM-DD'). Todo el calculo se hace
 * en UTC para que un cambio de horario o la zona del navegador no corran un
 * dia las barras.
 */
const DAY = 86_400_000;

export function parseISO(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function toISO(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return toISO(parseISO(iso) + days * DAY);
}

/** Dias de a hasta b (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((parseISO(b) - parseISO(a)) / DAY);
}

export function todayISO(): string {
  const now = new Date();
  return toISO(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/** Lunes de la semana de la fecha. */
export function startOfWeek(iso: string): string {
  const dow = new Date(parseISO(iso)).getUTCDay(); // 0 = domingo
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

export function startOfMonth(iso: string): string {
  return iso.slice(0, 8) + '01';
}

export function endOfMonth(iso: string): string {
  const d = new Date(parseISO(iso));
  return toISO(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

export function weekday(iso: string): number {
  return new Date(parseISO(iso)).getUTCDay();
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_LONG = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export function monthShort(iso: string): string {
  return MONTHS[Number(iso.slice(5, 7)) - 1];
}

export function monthLong(iso: string): string {
  return MONTHS_LONG[Number(iso.slice(5, 7)) - 1];
}

/** 26 oct 2026 */
export function formatDate(iso: string, withYear = true): string {
  if (!iso) return '';
  const d = Number(iso.slice(8, 10));
  return `${d} ${monthShort(iso)}${withYear ? ' ' + iso.slice(0, 4) : ''}`;
}

/** Excel guarda fechas como medianoche UTC; esto evita el corrimiento de zona. */
export function isoToExcelDate(iso: string): Date {
  return new Date(parseISO(iso));
}

export function isValidISO(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return toISO(parseISO(iso)) === iso;
}
