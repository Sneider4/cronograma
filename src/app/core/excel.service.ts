import { Injectable } from '@angular/core';
import type { Cell, Workbook, Worksheet } from 'exceljs';

import { ImportRow } from './board.service';
import {
  addDays,
  diffDays,
  formatDate,
  isValidISO,
  isoToExcelDate,
  parseISO,
  startOfWeek,
  toISO,
  todayISO,
} from './dates';
import {
  textOn,
  NO_OBJECTIVE_COLOR,
  Objective,
  PRIORITIES,
  Priority,
  Project,
  STATUSES,
  Status,
  Task,
  priorityLabel,
  statusLabel,
} from './models';

/**
 * Formato unico para plantilla, exportacion e importacion: lo que se exporta
 * se puede volver a subir tal cual.
 */
const COLUMNS = [
  { key: 'name', header: 'Actividad *', width: 46 },
  { key: 'start_date', header: 'Fecha inicio *', width: 15 },
  { key: 'end_date', header: 'Fecha fin *', width: 15 },
  { key: 'objective_code', header: 'Objetivo', width: 12 },
  { key: 'status', header: 'Estado', width: 14 },
  { key: 'priority', header: 'Prioridad', width: 12 },
  { key: 'progress', header: 'Avance (%)', width: 12 },
  { key: 'deliverable', header: 'Entregable', width: 32 },
  { key: 'assignee', header: 'Responsable', width: 22 },
  { key: 'notes', header: 'Notas', width: 42 },
  { key: 'evidence_url', header: 'Enlace de evidencia', width: 36 },
] as const;

type ColumnKey = (typeof COLUMNS)[number]['key'];

/** Encabezados que se aceptan al importar (sin tildes, minusculas, sin *). */
const HEADER_ALIASES: Record<string, ColumnKey> = {
  actividad: 'name', tarea: 'name', nombre: 'name', 'nombre de la actividad': 'name',
  'fecha inicio': 'start_date', inicio: 'start_date', 'fecha de inicio': 'start_date',
  'fecha fin': 'end_date', fin: 'end_date', 'fecha de fin': 'end_date',
  finalizacion: 'end_date', 'fecha finalizacion': 'end_date', 'fecha de finalizacion': 'end_date',
  objetivo: 'objective_code', 'objetivo (codigo)': 'objective_code', 'codigo objetivo': 'objective_code',
  estado: 'status',
  prioridad: 'priority',
  avance: 'progress', 'avance (%)': 'progress', progreso: 'progress', '% avance': 'progress',
  entregable: 'deliverable', 'entregable esperado': 'deliverable',
  responsable: 'assignee', asignado: 'assignee', 'asignado a': 'assignee',
  notas: 'notes', descripcion: 'notes', observaciones: 'notes', 'descripcion / observaciones': 'notes',
  'enlace de evidencia': 'evidence_url', evidencia: 'evidence_url', enlace: 'evidence_url',
};

const STATUS_ALIASES: Record<string, Status> = {
  pendiente: 'pendiente', 'por hacer': 'pendiente', 'sin iniciar': 'pendiente',
  'en proceso': 'en_proceso', 'en progreso': 'en_proceso', 'en curso': 'en_proceso', proceso: 'en_proceso',
  bloqueada: 'bloqueada', bloqueado: 'bloqueada',
  completada: 'completada', completado: 'completada', terminada: 'completada',
  terminado: 'completada', finalizada: 'completada', finalizado: 'completada', hecha: 'completada',
};

const PRIORITY_ALIASES: Record<string, Priority> = { alta: 'alta', media: 'media', baja: 'baja' };

const MAX_TEMPLATE_ROWS = 500;
const HEADER_FILL = 'FF0B0B0C';
const DATE_FMT = 'dd/mm/yyyy';

export interface ImportIssue {
  row: number;
  message: string;
}

export interface ImportResult {
  rows: (ImportRow & { row: number })[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  objectives: { code: string; name: string }[];
  newObjectiveCodes: string[];
}

@Injectable({ providedIn: 'root' })
export class ExcelService {
  /** ExcelJS pesa ~1 MB: se carga solo cuando alguien usa Excel. */
  private async lib() {
    const mod = await import('exceljs');
    return (mod as unknown as { default?: typeof mod }).default ?? mod;
  }

  // ------------------------------------------------------------------
  // Plantilla y exportacion
  // ------------------------------------------------------------------

  async downloadTemplate(project: Project, objectives: Objective[]) {
    const buffer = await this.templateBuffer(project, objectives);
    this.save(buffer, `plantilla_${slug(project.name)}.xlsx`);
  }

  async exportProject(project: Project, objectives: Objective[], tasks: Task[]) {
    const buffer = await this.exportBuffer(project, objectives, tasks);
    this.save(buffer, `cronograma_${slug(project.name)}_${todayISO()}.xlsx`);
  }

  async templateBuffer(project: Project, objectives: Objective[]) {
    return (await this.buildWorkbook(project, objectives, [])).xlsx.writeBuffer();
  }

  async exportBuffer(project: Project, objectives: Objective[], tasks: Task[]) {
    return (await this.buildWorkbook(project, objectives, tasks)).xlsx.writeBuffer();
  }

  private async buildWorkbook(project: Project, objectives: Objective[], tasks: Task[]) {
    const ExcelJS = await this.lib();
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cronograma';
    wb.created = new Date();

    const objMap = new Map(objectives.map((o) => [o.id, o]));
    const isTemplate = tasks.length === 0;

    // ---- Hoja Tareas (la que se importa) ----
    const ws = wb.addWorksheet('Tareas', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = COLUMNS.map((c) => ({ key: c.key, header: c.header, width: c.width }));
    styleHeader(ws);

    for (const t of tasks) {
      const row = ws.addRow({
        name: t.name,
        start_date: isoToExcelDate(t.start_date),
        end_date: isoToExcelDate(t.end_date),
        objective_code: t.objective_id ? (objMap.get(t.objective_id)?.code ?? '') : '',
        status: statusLabel(t.status),
        priority: priorityLabel(t.priority),
        progress: t.progress,
        deliverable: t.deliverable,
        assignee: t.assignee,
        notes: t.notes,
        evidence_url: t.evidence_url,
      });
      row.alignment = { vertical: 'top', wrapText: true };
    }

    const lastRow = Math.max(MAX_TEMPLATE_ROWS, tasks.length + 200);
    this.addValidations(ws, lastRow, objectives.length);
    if (!isTemplate) ws.autoFilter = { from: 'A1', to: `K${tasks.length + 1}` };

    // ---- Cronograma visual (solo exportacion) ----
    if (!isTemplate) this.addTimelineSheet(wb, tasks, objMap);

    // ---- Objetivos ----
    const wo = wb.addWorksheet('Objetivos', { views: [{ state: 'frozen', ySplit: 1 }] });
    wo.columns = [
      { key: 'code', header: 'Código *', width: 12 },
      { key: 'name', header: 'Nombre del objetivo', width: 70 },
    ];
    styleHeader(wo);
    for (const o of objectives) {
      const r = wo.addRow({ code: o.code, name: o.name });
      r.getCell(1).fill = solid(argb(o.color));
      r.getCell(1).font = { bold: true, color: { argb: argb(textOn(o.color)) } };
    }

    this.addInstructions(wb, project);
    return wb;
  }

  private addValidations(ws: Worksheet, lastRow: number, objectiveCount: number) {
    const statusList = `"${STATUSES.map((s) => s.label).join(',')}"`;
    const priorityList = `"${PRIORITIES.map((p) => p.label).join(',')}"`;
    const objRange = `Objetivos!$A$2:$A$${Math.max(objectiveCount + 100, 101)}`;

    for (let r = 2; r <= lastRow; r++) {
      for (const col of ['B', 'C']) {
        const cell = ws.getCell(`${col}${r}`);
        cell.numFmt = DATE_FMT;
        cell.dataValidation = {
          type: 'date',
          operator: 'greaterThan',
          allowBlank: true,
          showErrorMessage: true,
          errorTitle: 'Fecha inválida',
          error: 'Escribe una fecha, por ejemplo 15/11/2026.',
          formulae: [new Date(Date.UTC(2000, 0, 1))],
        };
      }
      // Advertencia y no error: un codigo nuevo se crea al importar.
      ws.getCell(`D${r}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        showErrorMessage: true,
        errorStyle: 'warning',
        errorTitle: 'Objetivo nuevo',
        error: 'Ese código no está en la hoja Objetivos. Se creará al importar.',
        formulae: [objRange],
      };
      ws.getCell(`E${r}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        showErrorMessage: true,
        error: 'Elige un estado de la lista.',
        formulae: [statusList],
      };
      ws.getCell(`F${r}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        showErrorMessage: true,
        error: 'Elige una prioridad de la lista.',
        formulae: [priorityList],
      };
      ws.getCell(`G${r}`).dataValidation = {
        type: 'whole',
        operator: 'between',
        allowBlank: true,
        showErrorMessage: true,
        error: 'El avance es un número entero de 0 a 100.',
        formulae: [0, 100],
      };
    }
  }

  /** Diagrama de Gantt por semanas hecho con celdas coloreadas. */
  private addTimelineSheet(wb: Workbook, tasks: Task[], objMap: Map<string, Objective>) {
    const ws = wb.addWorksheet('Cronograma', {
      views: [{ state: 'frozen', xSplit: 4, ySplit: 2 }],
    });
    const sorted = [...tasks].sort((a, b) => a.start_date.localeCompare(b.start_date));
    const first = startOfWeek(sorted.reduce((m, t) => (t.start_date < m ? t.start_date : m), sorted[0].start_date));
    const last = sorted.reduce((m, t) => (t.end_date > m ? t.end_date : m), sorted[0].end_date);
    const weeks = Math.min(Math.floor(diffDays(first, last) / 7) + 1, 156);
    const FIXED = 4;

    ws.getColumn(1).width = 44;
    ws.getColumn(2).width = 10;
    ws.getColumn(3).width = 11;
    ws.getColumn(4).width = 11;

    const top = ws.getRow(1);
    const head = ws.getRow(2);
    ['Actividad', 'Objetivo', 'Inicio', 'Fin'].forEach((h, i) => {
      head.getCell(i + 1).value = h;
    });

    let monthStart = FIXED + 1;
    for (let w = 0; w < weeks; w++) {
      const monday = addDays(first, w * 7);
      const col = FIXED + 1 + w;
      ws.getColumn(col).width = 4.5;
      head.getCell(col).value = Number(monday.slice(8, 10));
      const nextMonday = addDays(monday, 7);
      const monthEnds = w === weeks - 1 || nextMonday.slice(0, 7) !== monday.slice(0, 7);
      if (monthEnds) {
        top.getCell(monthStart).value = `${monthName(monday)} ${monday.slice(0, 4)}`;
        if (col > monthStart) ws.mergeCells(1, monthStart, 1, col);
        monthStart = col + 1;
      }
    }
    for (const r of [top, head]) {
      r.eachCell({ includeEmpty: true }, (c) => {
        c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
        c.fill = solid(HEADER_FILL);
        c.alignment = { horizontal: 'center', vertical: 'middle' };
      });
    }
    head.getCell(1).alignment = { horizontal: 'left' };

    const thin = { style: 'thin' as const, color: { argb: 'FFE3E4E8' } };
    sorted.forEach((t, i) => {
      const r = ws.getRow(3 + i);
      const obj = t.objective_id ? objMap.get(t.objective_id) : undefined;
      r.getCell(1).value = t.name;
      r.getCell(2).value = obj?.code ?? '';
      r.getCell(3).value = isoToExcelDate(t.start_date);
      r.getCell(4).value = isoToExcelDate(t.end_date);
      r.getCell(3).numFmt = DATE_FMT;
      r.getCell(4).numFmt = DATE_FMT;
      const hex = obj?.color ?? NO_OBJECTIVE_COLOR;
      const color = argb(hex);
      for (let w = 0; w < weeks; w++) {
        const monday = addDays(first, w * 7);
        const sunday = addDays(monday, 6);
        const cell = r.getCell(FIXED + 1 + w);
        cell.border = { left: thin, right: thin, top: thin, bottom: thin };
        if (t.start_date <= sunday && t.end_date >= monday) {
          cell.fill = solid(t.status === 'completada' ? color : lighten(color));
          if (t.status === 'completada') cell.value = '✓';
          cell.font = { color: { argb: argb(textOn(hex)) }, size: 8 };
          cell.alignment = { horizontal: 'center' };
        }
      }
    });

    const legend = ws.getRow(sorted.length + 4);
    legend.getCell(1).value = 'Color = objetivo. Tono fuerte con ✓ = completada. Cada columna es una semana (lunes).';
    legend.getCell(1).font = { italic: true, color: { argb: 'FF5D5F66' }, size: 9 };
  }

  private addInstructions(wb: Workbook, project: Project) {
    const ws = wb.addWorksheet('Instrucciones');
    ws.getColumn(1).width = 26;
    ws.getColumn(2).width = 90;

    const title = ws.addRow([`Como llenar la plantilla · ${project.name}`]);
    title.font = { bold: true, size: 14 };
    ws.addRow([]);

    const lines: [string, string][] = [
      ['1. Hoja "Tareas"', 'Una fila por actividad, desde la fila 2. No cambies los encabezados.'],
      ['Actividad *', 'Obligatorio. Nombre corto de la actividad.'],
      ['Fecha inicio / fin *', 'Obligatorias. Formato dd/mm/aaaa. La fecha fin no puede ser anterior al inicio.'],
      ['Objetivo', 'Código del objetivo (ej. OE1). Si no existe en la hoja "Objetivos", se crea al importar.'],
      ['Estado', `Lista: ${STATUSES.map((s) => s.label).join(', ')}. Vacio = Pendiente.`],
      ['Prioridad', `Lista: ${PRIORITIES.map((p) => p.label).join(', ')}. Vacio = Media.`],
      ['Avance (%)', 'Numero de 0 a 100. Vacio = 0 (o 100 si el estado es Completada).'],
      ['Responsable', 'Nombre o correo de alguien del equipo. Si no está en el equipo, queda como otra persona (sin cuenta).'],
      ['Entregable, Notas, Enlace', 'Opcionales, texto libre.'],
      ['', ''],
      ['2. Hoja "Objetivos"', 'Opcional. Código y nombre de cada objetivo para que la importación les ponga nombre.'],
      ['3. Importar', 'En la app: Excel → Importar. Verás una vista previa con los errores antes de guardar.'],
      ['Agregar vs reemplazar', '"Agregar" suma las filas al cronograma actual. "Reemplazar" borra las tareas actuales primero.'],
      ['', ''],
      ['Ejemplo de fila', ''],
    ];
    for (const [a, b] of lines) {
      const r = ws.addRow([a, b]);
      r.getCell(1).font = { bold: true };
      r.alignment = { vertical: 'top', wrapText: true };
    }

    const example = [
      'Analisis DOFA y definicion de prioridades',
      '02/11/2026',
      '13/11/2026',
      'OE1',
      'Pendiente',
      'Alta',
      '0',
      'Matriz DOFA',
      'Ana Perez',
    ];
    const hdr = ws.addRow(COLUMNS.slice(0, example.length).map((c) => c.header));
    hdr.font = { bold: true, size: 9 };
    const ex = ws.addRow(example);
    ex.font = { italic: true, size: 9, color: { argb: 'FF5D5F66' } };
  }

  private save(buffer: ArrayBuffer, filename: string) {
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ------------------------------------------------------------------
  // Importacion
  // ------------------------------------------------------------------

  async parse(file: Blob | ArrayBuffer, existing: Objective[]): Promise<ImportResult> {
    const ExcelJS = await this.lib();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file instanceof Blob ? await file.arrayBuffer() : file);

    const result: ImportResult = { rows: [], errors: [], warnings: [], objectives: [], newObjectiveCodes: [] };

    const ws = wb.getWorksheet('Tareas') ?? wb.worksheets[0];
    if (!ws) {
      result.errors.push({ row: 0, message: 'El archivo no tiene hojas.' });
      return result;
    }

    // Columnas por encabezado, no por posicion: tolera columnas movidas.
    const colOf = new Map<ColumnKey, number>();
    ws.getRow(1).eachCell((cell, col) => {
      const key = HEADER_ALIASES[normalize(cellText(cell)).replace(/\*/g, '').trim()];
      if (key && !colOf.has(key)) colOf.set(key, col);
    });
    for (const required of ['name', 'start_date', 'end_date'] as const) {
      if (!colOf.has(required)) {
        const header = COLUMNS.find((c) => c.key === required)!.header.replace(' *', '');
        result.errors.push({ row: 1, message: `Falta la columna "${header}". Usa la plantilla.` });
      }
    }
    if (result.errors.length) return result;

    const known = new Set(existing.map((o) => o.code.toUpperCase()));

    // Hoja Objetivos (opcional)
    const wo = wb.getWorksheet('Objetivos');
    wo?.eachRow((row, n) => {
      if (n === 1) return;
      const code = cellText(row.getCell(1)).trim().toUpperCase();
      if (!code) return;
      if (code.length > 20) {
        result.warnings.push({ row: n, message: `Objetivos: el código "${code}" es muy largo (máx. 20), se omite.` });
        return;
      }
      result.objectives.push({ code, name: cellText(row.getCell(2)).trim() });
    });
    for (const o of result.objectives) known.add(o.code);

    const get = (row: import('exceljs').Row, key: ColumnKey) => {
      const col = colOf.get(key);
      return col ? row.getCell(col) : null;
    };

    const newCodes = new Set<string>();

    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (n === 1) return;
      const values = COLUMNS.map((c) => get(row, c.key)).filter(Boolean).map((c) => cellText(c!).trim());
      if (values.every((v) => v === '')) return;

      const errs: string[] = [];
      const name = cellText(get(row, 'name')).trim();
      if (!name) errs.push('falta el nombre de la actividad');
      if (name.length > 300) errs.push('el nombre supera 300 caracteres');

      const start = cellDate(get(row, 'start_date'));
      const end = cellDate(get(row, 'end_date'));
      if (!start) errs.push('fecha de inicio vacía o inválida');
      if (!end) errs.push('fecha de fin vacía o inválida');
      if (start && end && end < start) errs.push('la fecha de fin es anterior al inicio');

      const statusRaw = normalize(cellText(get(row, 'status')));
      let status: Status = 'pendiente';
      if (statusRaw) {
        const s = STATUS_ALIASES[statusRaw];
        if (s) status = s;
        else errs.push(`estado "${cellText(get(row, 'status'))}" no valido`);
      }

      const priorityRaw = normalize(cellText(get(row, 'priority')));
      let priority: Priority = 'media';
      if (priorityRaw) {
        const p = PRIORITY_ALIASES[priorityRaw];
        if (p) priority = p;
        else errs.push(`prioridad "${cellText(get(row, 'priority'))}" no valida`);
      }

      let progress = cellPercent(get(row, 'progress'));
      if (progress === null) progress = status === 'completada' ? 100 : 0;
      else if (Number.isNaN(progress) || progress < 0 || progress > 100) {
        errs.push('el avance debe ser un número de 0 a 100');
        progress = 0;
      }

      const objective_code = cellText(get(row, 'objective_code')).trim().toUpperCase();
      if (objective_code.length > 20) errs.push('el código de objetivo supera 20 caracteres');
      else if (objective_code && !known.has(objective_code)) newCodes.add(objective_code);

      if (errs.length) {
        result.errors.push({ row: n, message: capitalize(errs.join('; ')) });
        return;
      }

      result.rows.push({
        row: n,
        name,
        start_date: start!,
        end_date: end!,
        objective_code,
        status,
        priority,
        progress: Math.round(progress),
        deliverable: cellText(get(row, 'deliverable')).trim(),
        assignee: cellText(get(row, 'assignee')).trim(),
        notes: cellText(get(row, 'notes')).trim(),
        evidence_url: cellText(get(row, 'evidence_url')).trim(),
      });
    });

    result.newObjectiveCodes = [...newCodes].sort();
    if (!result.rows.length && !result.errors.length) {
      result.errors.push({ row: 0, message: 'La hoja "Tareas" no tiene filas con datos.' });
    }
    return result;
  }
}

// ----------------------------------------------------------------------
// Helpers de celdas
// ----------------------------------------------------------------------

function cellText(cell: Cell | null): string {
  if (!cell) return '';
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return toISO(dateOnlyUTC(v));
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((p) => p.text).join('');
    if ('hyperlink' in v) return String((v as { hyperlink: string }).hyperlink ?? '');
    if ('result' in v) return v.result === undefined || v.result === null ? '' : String(v.result);
    if ('text' in v) return String((v as { text: unknown }).text ?? '');
    return '';
  }
  return String(v);
}

function cellDate(cell: Cell | null): string | null {
  if (!cell) return null;
  let v: unknown = cell.value;
  if (v && typeof v === 'object' && !(v instanceof Date) && 'result' in v) v = (v as { result: unknown }).result;

  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : toISO(dateOnlyUTC(v));
  if (typeof v === 'number') {
    // Serial de Excel: dias desde 1899-12-30.
    if (v < 1 || v > 120000) return null;
    return toISO(Math.round((v - 25569) * 86_400_000));
  }
  if (typeof v !== 'string') return null;

  const s = v.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return checked(+m[1], +m[2], +m[3]);
  // dd/mm/aaaa (formato local), tambien dd-mm-aa
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return checked(year, +m[2], +m[1]);
  }
  return null;
}

function checked(y: number, mo: number, d: number): string | null {
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isValidISO(iso) ? iso : null;
}

/**
 * Excel guarda las fechas como medianoche UTC. Se redondea al dia mas
 * cercano por si el serial trae decimales de punto flotante (23:59:59.999).
 */
function dateOnlyUTC(d: Date): number {
  return Math.round(d.getTime() / 86_400_000) * 86_400_000;
}

function cellPercent(cell: Cell | null): number | null {
  if (!cell) return null;
  let v: unknown = cell.value;
  if (v && typeof v === 'object' && 'result' in v) v = (v as { result: unknown }).result;
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    return cell.numFmt?.includes('%') ? v * 100 : v;
  }
  const s = String(v).trim().replace(',', '.');
  if (!s) return null;
  const n = parseFloat(s.replace('%', ''));
  return Number.isNaN(n) ? NaN : n;
}

function styleHeader(ws: Worksheet) {
  const row = ws.getRow(1);
  row.height = 22;
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = solid(HEADER_FILL);
    c.alignment = { vertical: 'middle' };
  });
}

function solid(argbColor: string) {
  return { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: argbColor } };
}

function argb(hex: string) {
  return 'FF' + hex.replace('#', '').toUpperCase().padEnd(6, '0').slice(0, 6);
}

/** Mezcla el color con blanco al 55% para las tareas no completadas. */
function lighten(argbColor: string) {
  const hex = argbColor.slice(2);
  const mix = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16);
    return Math.round(c + (255 - c) * 0.45).toString(16).padStart(2, '0');
  };
  return ('FF' + mix(0) + mix(2) + mix(4)).toUpperCase();
}

function monthName(iso: string) {
  return formatDate(iso).split(' ')[1];
}

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function slug(s: string) {
  return normalize(s).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'proyecto';
}
