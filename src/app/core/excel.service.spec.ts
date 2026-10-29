import ExcelJS from 'exceljs';

import { ExcelService } from './excel.service';
import { Objective, Project, Task } from './models';

const project: Project = {
  id: 'p1',
  name: 'Ágape 2026',
  description: '',
  color: '#4f46e5',
  invite_code: 'ABC234',
  created_by: 'u1',
  created_at: '2026-10-26T00:00:00Z',
};

const objectives: Objective[] = [
  { id: 'o1', project_id: 'p1', code: 'OE1', name: 'Diagnóstico', color: '#4f46e5' },
  { id: 'o2', project_id: 'p1', code: 'OE2', name: 'Producto', color: '#16a34a' },
];

function task(partial: Partial<Task>): Task {
  return {
    id: crypto.randomUUID(),
    project_id: 'p1',
    objective_id: null,
    name: 'Tarea',
    start_date: '2026-11-02',
    end_date: '2026-11-08',
    status: 'pendiente',
    priority: 'media',
    progress: 0,
    deliverable: '',
    assignee_id: null,
    assignee: '',
    notes: '',
    evidence_url: '',
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

async function load(buffer: ArrayBuffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

/** Simula un Excel llenado a mano por alguien del equipo. */
async function handmade(rows: unknown[][], headers?: string[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Tareas');
  ws.addRow(
    headers ?? ['Actividad *', 'Fecha inicio *', 'Fecha fin *', 'Objetivo', 'Estado', 'Prioridad', 'Avance (%)', 'Entregable', 'Responsable'],
  );
  rows.forEach((r) => ws.addRow(r));
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

describe('ExcelService', () => {
  const svc = new ExcelService();

  it('genera la plantilla con sus hojas, encabezados y listas desplegables', async () => {
    const wb = await load((await svc.templateBuffer(project, objectives)) as ArrayBuffer);

    expect(wb.worksheets.map((w) => w.name)).toEqual(['Tareas', 'Objetivos', 'Instrucciones']);

    const ws = wb.getWorksheet('Tareas')!;
    expect(ws.getRow(1).getCell(1).value).toBe('Actividad *');
    expect(ws.getRow(1).getCell(11).value).toBe('Enlace de evidencia');
    // Sin tareas: la plantilla arranca vacia (las filas solo traen validaciones).
    expect(ws.getRow(2).getCell(1).value).toBeNull();
    expect(ws.getRow(2).getCell(5).value).toBeNull();

    const status = ws.getCell('E2').dataValidation;
    expect(status.type).toBe('list');
    expect(status.formulae?.[0]).toContain('En proceso');
    expect(ws.getCell('D300').dataValidation.formulae?.[0]).toContain('Objetivos!');

    const wo = wb.getWorksheet('Objetivos')!;
    expect(wo.getRow(2).getCell(1).value).toBe('OE1');
    expect(wo.getRow(3).getCell(2).value).toBe('Producto');
  });

  it('lo exportado se vuelve a importar sin perder datos', async () => {
    const tasks = [
      task({ name: 'Análisis DOFA', objective_id: 'o1', start_date: '2026-10-26', end_date: '2026-11-08', priority: 'alta', assignee: 'Ana', deliverable: 'Matriz DOFA' }),
      task({ name: 'Prototipo', objective_id: 'o2', start_date: '2026-11-16', end_date: '2026-11-29', status: 'en_proceso', progress: 40, notes: 'Con proveedor' }),
      task({ name: 'Cierre', start_date: '2026-12-31', end_date: '2027-01-04', status: 'completada', progress: 100, evidence_url: 'https://x.co/a' }),
    ];
    const buffer = (await svc.exportBuffer(project, objectives, tasks)) as ArrayBuffer;

    const wb = await load(buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Tareas', 'Cronograma', 'Objetivos', 'Instrucciones']);

    const result = await svc.parse(buffer, objectives);
    expect(result.errors).toEqual([]);
    expect(result.newObjectiveCodes).toEqual([]);
    expect(result.rows.map(({ row: _r, ...rest }) => rest)).toEqual([
      { name: 'Análisis DOFA', start_date: '2026-10-26', end_date: '2026-11-08', objective_code: 'OE1', status: 'pendiente', priority: 'alta', progress: 0, deliverable: 'Matriz DOFA', assignee: 'Ana', notes: '', evidence_url: '' },
      { name: 'Prototipo', start_date: '2026-11-16', end_date: '2026-11-29', objective_code: 'OE2', status: 'en_proceso', priority: 'media', progress: 40, deliverable: '', assignee: '', notes: 'Con proveedor', evidence_url: '' },
      { name: 'Cierre', start_date: '2026-12-31', end_date: '2027-01-04', objective_code: '', status: 'completada', priority: 'media', progress: 100, deliverable: '', assignee: '', notes: '', evidence_url: 'https://x.co/a' },
    ]);
  });

  it('acepta fechas escritas de varias formas y estados con sinonimos', async () => {
    const buffer = await handmade([
      ['Texto dd/mm/aaaa', '15/11/2026', '3/12/2026', 'oe1', 'en progreso', 'ALTA', 50],
      ['Fecha real de Excel', new Date(Date.UTC(2026, 10, 2)), new Date(Date.UTC(2026, 10, 9)), '', 'Completado', '', null],
      ['ISO', '2026-11-20', '2026-11-21', 'OE9', '', '', '30%'],
      ['Serial numerico', 46328, 46330, '', 'Pendiente', 'baja', 0],
    ]);
    const r = await svc.parse(buffer, objectives);

    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.start_date, x.end_date, x.status, x.priority, x.progress, x.objective_code])).toEqual([
      ['2026-11-15', '2026-12-03', 'en_proceso', 'alta', 50, 'OE1'],
      ['2026-11-02', '2026-11-09', 'completada', 'media', 100, ''],
      ['2026-11-20', '2026-11-21', 'pendiente', 'media', 30, 'OE9'],
      ['2026-11-02', '2026-11-04', 'pendiente', 'baja', 0, ''],
    ]);
    expect(r.newObjectiveCodes).toEqual(['OE9']);
  });

  it('reporta errores por fila y omite filas vacias', async () => {
    const buffer = await handmade([
      ['Bien', '01/11/2026', '05/11/2026'],
      [null, '01/11/2026', '05/11/2026'],
      [],
      ['Fin antes de inicio', '10/11/2026', '05/11/2026'],
      ['Fecha imposible', '31/02/2026', '05/03/2026'],
      ['Estado raro', '01/11/2026', '02/11/2026', '', 'Quizas'],
      ['Avance fuera de rango', '01/11/2026', '02/11/2026', '', '', '', 150],
    ]);
    const r = await svc.parse(buffer, objectives);

    expect(r.rows.map((x) => x.name)).toEqual(['Bien']);
    expect(r.errors.map((e) => e.row)).toEqual([3, 5, 6, 7, 8]);
    expect(r.errors[0].message).toMatch(/nombre/);
    expect(r.errors[1].message).toMatch(/anterior al inicio/);
    expect(r.errors[2].message).toMatch(/inicio vacía o inválida/);
    expect(r.errors[3].message).toMatch(/Quizas/);
    expect(r.errors[4].message).toMatch(/0 a 100/);
  });

  it('encuentra las columnas por nombre aunque esten en otro orden', async () => {
    const buffer = await handmade([['2026-11-05', 'Reordenada', '2026-11-01', 'Luis']], ['Fin', 'Tarea', 'Inicio', 'Responsable']);
    const r = await svc.parse(buffer, []);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ name: 'Reordenada', start_date: '2026-11-01', end_date: '2026-11-05', assignee: 'Luis' });
  });

  it('avisa si falta una columna obligatoria', async () => {
    const buffer = await handmade([['x', '2026-11-01']], ['Actividad', 'Fecha inicio']);
    const r = await svc.parse(buffer, []);
    expect(r.rows).toEqual([]);
    expect(r.errors[0].message).toMatch(/Fecha fin/);
  });
});
