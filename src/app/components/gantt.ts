import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';

import { BoardService } from '../core/board.service';
import {
  addDays,
  diffDays,
  endOfMonth,
  formatDate,
  monthLong,
  monthShort,
  startOfMonth,
  startOfWeek,
  todayISO,
  weekday,
} from '../core/dates';
import { NO_OBJECTIVE_COLOR, Objective, Task, statusLabel } from '../core/models';
import { loadPref, savePref } from '../core/prefs';

type Zoom = 'dia' | 'semana' | 'mes';

const PX: Record<Zoom, number> = { dia: 34, semana: 14, mes: 4.5 };
const leftFor = (w: number) => (w < 480 ? 132 : w < 900 ? 200 : 300);
const EDGE = 7;

interface Unit {
  label: string;
  left: number;
  width: number;
  weekend?: boolean;
  today?: boolean;
}

type Row =
  | { kind: 'group'; key: string; objective: Objective | null; count: number; done: number }
  | { kind: 'task'; key: string; task: Task };

interface Drag {
  id: string;
  mode: 'move' | 'start' | 'end';
  x0: number;
  delta: number;
  moved: boolean;
}

@Component({
  selector: 'app-gantt',
  template: `
    <div class="bar-tools">
      <div class="seg">
        @for (z of zooms; track z.value) {
          <button [class.on]="zoom() === z.value" (click)="setZoom(z.value)">{{ z.label }}</button>
        }
      </div>
      <button class="btn sm" (click)="scrollToToday()">Hoy</button>
      <label class="check small">
        <input type="checkbox" [checked]="grouped()" (change)="toggleGrouped()" />
        Agrupar por objetivo
      </label>
      <span class="spacer"></span>
      <span class="faint small hide-sm">Arrastra una barra para moverla o sus bordes para cambiar fechas · Doble clic en el fondo para crear</span>
    </div>

    <div class="scroll card" #scroller>
      <div class="gantt" [style.width.px]="left() + totalWidth()" [style.--left]="left() + 'px'">
        <div class="head">
          <div class="corner eyebrow">Actividad</div>
          <div class="scale" [style.width.px]="totalWidth()">
            <div class="units top">
              @for (u of topUnits(); track u.left) {
                <div class="unit" [style.left.px]="u.left" [style.width.px]="u.width">{{ u.label }}</div>
              }
            </div>
            <div class="units bottom">
              @for (u of bottomUnits(); track u.left) {
                <div class="unit" [class.weekend]="u.weekend" [class.today]="u.today" [style.left.px]="u.left" [style.width.px]="u.width">
                  {{ u.label }}
                </div>
              }
            </div>
          </div>
        </div>

        <div class="rows">
          <div class="bg" [style.width.px]="totalWidth()" (dblclick)="createAt($event)">
            @for (u of bottomUnits(); track u.left) {
              <div class="col" [class.weekend]="u.weekend" [style.left.px]="u.left" [style.width.px]="u.width"></div>
            }
            @if (todayLeft() !== null) {
              <div class="today-line" [style.left.px]="todayLeft()"></div>
            }
          </div>

          @for (r of rows(); track r.key) {
            @if (r.kind === 'group') {
              <div class="row group">
                <div class="label">
                  <span class="swatch" [style.background]="r.objective?.color ?? noColor"></span>
                  <b>{{ r.objective?.code ?? 'Sin objetivo' }}</b>
                  <span class="muted ellipsis">{{ r.objective?.name }}</span>
                  <span class="faint small count">{{ r.done }}/{{ r.count }}</span>
                </div>
              </div>
            } @else {
              @let t = r.task;
              @let g = geometry(t);
              <div class="row">
                <button class="label task-label" (click)="board.edit(t)" [title]="t.name">
                  <span class="name ellipsis" [class.done]="t.status === 'completada'">{{ t.name }}</span>
                  <span class="faint small ellipsis">
                    <span class="num">{{ fmt(t.start_date) }} – {{ fmt(t.end_date) }}</span>{{ t.assignee ? ' · ' + t.assignee : '' }}
                  </span>
                </button>
                <div class="track" [style.width.px]="totalWidth()">
                  <div
                    class="gbar"
                    [class.dragging]="drag()?.id === t.id"
                    [class.done]="t.status === 'completada'"
                    [class.blocked]="t.status === 'bloqueada'"
                    [style.left.px]="g.left"
                    [style.width.px]="g.width"
                    [style.--c]="color(t)"
                    [title]="tooltip(t)"
                    (pointerdown)="down($event, t)"
                    (pointermove)="move($event)"
                    (pointerup)="up($event, t)"
                    (pointercancel)="drag.set(null)"
                    (click)="tap(t)"
                  >
                    <span class="fill" [style.width.%]="t.progress"></span>
                  </div>
                  @if (drag()?.id === t.id && drag()!.delta !== 0) {
                    <div class="drag-hint" [style.left.px]="g.left + g.width + 8">
                      {{ fmt(g.start) }} – {{ fmt(g.end) }}
                    </div>
                  } @else {
                    <span class="pct" [style.left.px]="g.left + g.width + 6">{{ t.progress }}%</span>
                  }
                </div>
              </div>
            }
          }

          @if (!rows().length) {
            <div class="row"><div class="label muted">Ninguna actividad coincide con los filtros.</div></div>
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
    .bar-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
    .spacer { flex: 1; }
    .check { display: inline-flex; align-items: center; gap: 6px; color: var(--text-2); cursor: pointer; }
    .scroll { overflow: auto; max-height: calc(100vh - 150px); min-height: 360px; position: relative; }
    .gantt { position: relative; min-width: 100%; }
    .head {
      position: sticky; top: 0; z-index: 4; display: flex; height: 50px;
      background: var(--surface-2); border-bottom: 1px solid var(--border-strong);
    }
    .corner {
      position: sticky; left: 0; z-index: 5; flex: 0 0 var(--left); display: flex; align-items: flex-end;
      padding: 0 14px 7px; background: var(--surface-2); border-right: 1px solid var(--border-strong);
    }
    .scale { position: relative; flex: none; }
    .units { position: absolute; left: 0; right: 0; height: 25px; }
    .units.top { top: 0; }
    .units.bottom { top: 25px; border-top: 1px solid var(--border); }
    .unit {
      position: absolute; top: 0; height: 100%; display: flex; align-items: center; justify-content: center;
      overflow: hidden; white-space: nowrap; font-size: 11px; color: var(--text-2);
      font-variant-numeric: tabular-nums; border-left: 1px solid var(--border);
    }
    .units.top .unit { justify-content: flex-start; padding-left: 8px; font-weight: 600; font-size: 12px; color: var(--text); text-transform: capitalize; }
    .unit.weekend { background: var(--weekend); }
    .unit.today { color: var(--today); font-weight: 700; box-shadow: inset 0 -2px 0 var(--today); }

    .rows { position: relative; }
    .bg { position: absolute; top: 0; bottom: 0; left: var(--left); }
    .col { position: absolute; top: 0; bottom: 0; border-left: 1px solid var(--border); opacity: 0.55; }
    .col.weekend { background: var(--weekend); opacity: 1; }
    .today-line { position: absolute; top: 0; bottom: 0; width: 0; border-left: 1.5px solid var(--today); z-index: 1; }

    .scroll.card { border-radius: var(--radius); }
    .row { position: relative; display: flex; height: 42px; border-bottom: 1px solid var(--border); pointer-events: none; }
    .row > * { pointer-events: auto; }
    .row.group { height: 32px; background: var(--surface-2); }
    .label {
      position: sticky; left: 0; z-index: 3; flex: 0 0 var(--left); width: var(--left);
      display: flex; align-items: center; gap: 8px; padding: 0 14px; min-width: 0;
      background: var(--surface); border-right: 1px solid var(--border-strong);
    }
    .group .label { background: var(--surface-2); font-size: 12.5px; b { font-weight: 600; } }
    .count { margin-left: auto; font-variant-numeric: tabular-nums; }
    .swatch { flex: none; width: 9px; height: 9px; border-radius: 50%; }
    .task-label {
      flex-direction: column; align-items: flex-start; justify-content: center; gap: 0;
      border: 0; border-right: 1px solid var(--border-strong); border-radius: 0; font: inherit; color: inherit;
      text-align: left; cursor: pointer;
      &:hover { background: var(--surface-2); .name { color: var(--copper); } }
      .name { font-size: 13px; font-weight: 500; max-width: 100%; line-height: 1.35; }
      .name.done { text-decoration: line-through; color: var(--text-3); }
      .small { max-width: 100%; font-size: 11.5px; }
    }
    .ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .track { position: relative; flex: none; pointer-events: none; }
    .gbar {
      position: absolute; top: 9px; height: 22px; border-radius: 999px; overflow: hidden;
      background: color-mix(in srgb, var(--c) 20%, var(--surface));
      border: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
      cursor: grab; touch-action: none; user-select: none; pointer-events: auto;
      &:hover { border-color: var(--c); }
      &::before, &::after { content: ''; position: absolute; top: 0; bottom: 0; width: 7px; cursor: ew-resize; z-index: 2; }
      &::before { left: 0; }
      &::after { right: 0; }
      &.dragging { cursor: grabbing; border-color: var(--c); box-shadow: var(--shadow); z-index: 2; }
      &.done { background: var(--c); }
      &.blocked { background-image: repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--danger) 22%, transparent) 5px 10px); }
    }
    .fill { position: absolute; inset: 0 auto 0 0; background: var(--c); }
    .pct {
      position: absolute; top: 11px; line-height: 18px; font-size: 11px; color: var(--text-3);
      font-variant-numeric: tabular-nums; white-space: nowrap; pointer-events: none;
    }
    .drag-hint {
      position: absolute; top: 9px; z-index: 3; padding: 2px 10px; border-radius: 999px; white-space: nowrap;
      background: var(--text); color: var(--surface); font-size: 11.5px; font-weight: 500;
      font-variant-numeric: tabular-nums; pointer-events: none;
    }
    @media (max-width: 760px) { .hide-sm { display: none; } }
    @media (pointer: coarse) {
      .gbar { touch-action: pan-x pan-y; cursor: pointer; &::before, &::after { display: none; } }
    }
    /* Movil: nombres en dos lineas, fechas ocultas (se ven en la barra y al tocarla) */
    @media (max-width: 480px) {
      .bar-tools { gap: 8px; }
      .scroll { max-height: calc(100dvh - 120px); }
      .label { padding: 0 8px; gap: 6px; }
      .row { height: 46px; }
      .row.group { height: 34px; }
      .group .label { font-size: 12px; .muted { display: none; } }
      .task-label {
        .name {
          font-size: 12px; line-height: 1.25; white-space: normal;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
        }
        .small { display: none; }
      }
      .corner { padding: 0 8px 7px; }
      .gbar { top: 11px; }
      .pct { top: 13px; }
    }
  `,
})
export class Gantt implements AfterViewInit {
  protected readonly board = inject(BoardService);
  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');

  /** Ancho de la columna de nombres: mas angosta en movil para dejar ver la linea de tiempo. */
  protected readonly left = signal(leftFor(window.innerWidth));
  protected readonly noColor = NO_OBJECTIVE_COLOR;

  @HostListener('window:resize')
  onResize() {
    this.left.set(leftFor(window.innerWidth));
  }
  protected readonly zooms: { value: Zoom; label: string }[] = [
    { value: 'dia', label: 'Día' },
    { value: 'semana', label: 'Semana' },
    { value: 'mes', label: 'Mes' },
  ];

  protected readonly zoom = signal<Zoom>(loadPref('gantt.zoom', 'semana') as Zoom);
  protected readonly grouped = signal(loadPref('gantt.grouped', '1') === '1');
  protected readonly drag = signal<Drag | null>(null);

  private readonly px = computed(() => PX[this.zoom()]);

  /** Rango visible: todas las tareas + hoy, con margen y alineado a semanas/meses. */
  private readonly range = computed(() => {
    const tasks = this.board.tasks();
    const today = todayISO();
    let start = today;
    let end = today;
    for (const t of tasks) {
      if (t.start_date < start) start = t.start_date;
      if (t.end_date > end) end = t.end_date;
    }
    const z = this.zoom();
    if (z === 'mes') {
      start = startOfMonth(addDays(start, -15));
      end = endOfMonth(addDays(end, 45));
    } else {
      start = startOfWeek(addDays(start, -7));
      end = addDays(startOfWeek(addDays(end, z === 'dia' ? 14 : 28)), 6);
    }
    // Minimo un mes y medio para que la vista no se vea vacia.
    if (diffDays(start, end) < 45) end = addDays(start, 45);
    return { start, end, days: diffDays(start, end) + 1 };
  });

  protected readonly totalWidth = computed(() => this.range().days * this.px());

  protected readonly todayLeft = computed(() => {
    const { start, days } = this.range();
    const d = diffDays(start, todayISO());
    return d >= 0 && d < days ? d * this.px() + this.px() / 2 : null;
  });

  protected readonly topUnits = computed<Unit[]>(() => {
    const { start, end } = this.range();
    const px = this.px();
    const units: Unit[] = [];
    if (this.zoom() === 'mes') {
      // Años
      let cur = start;
      while (cur <= end) {
        const yearEnd = `${cur.slice(0, 4)}-12-31` < end ? `${cur.slice(0, 4)}-12-31` : end;
        units.push({ label: cur.slice(0, 4), left: diffDays(start, cur) * px, width: (diffDays(cur, yearEnd) + 1) * px });
        cur = addDays(yearEnd, 1);
      }
      return units;
    }
    let cur = start;
    while (cur <= end) {
      const mEnd = endOfMonth(cur) < end ? endOfMonth(cur) : end;
      units.push({
        label: `${monthLong(cur)} ${cur.slice(0, 4)}`,
        left: diffDays(start, cur) * px,
        width: (diffDays(cur, mEnd) + 1) * px,
      });
      cur = addDays(mEnd, 1);
    }
    return units;
  });

  protected readonly bottomUnits = computed<Unit[]>(() => {
    const { start, end } = this.range();
    const px = this.px();
    const today = todayISO();
    const units: Unit[] = [];
    const z = this.zoom();
    if (z === 'dia') {
      for (let cur = start; cur <= end; cur = addDays(cur, 1)) {
        const wd = weekday(cur);
        units.push({
          label: cur.slice(8, 10).replace(/^0/, ''),
          left: diffDays(start, cur) * px,
          width: px,
          weekend: wd === 0 || wd === 6,
          today: cur === today,
        });
      }
    } else if (z === 'semana') {
      for (let cur = start; cur <= end; cur = addDays(cur, 7)) {
        units.push({
          label: `${Number(cur.slice(8, 10))} ${monthShort(cur)}`,
          left: diffDays(start, cur) * px,
          width: 7 * px,
          today: today >= cur && today <= addDays(cur, 6),
        });
      }
    } else {
      for (let cur = start; cur <= end; cur = addDays(endOfMonth(cur), 1)) {
        units.push({
          label: monthShort(cur),
          left: diffDays(start, cur) * px,
          width: (diffDays(cur, endOfMonth(cur)) + 1) * px,
          today: today.slice(0, 7) === cur.slice(0, 7),
        });
      }
    }
    return units;
  });

  protected readonly rows = computed<Row[]>(() => {
    const tasks = this.board.filteredTasks();
    if (!this.grouped()) return tasks.map((t) => ({ kind: 'task', key: t.id, task: t }));

    const groups = new Map<string, Task[]>();
    for (const t of tasks) {
      const k = t.objective_id ?? '';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(t);
    }
    const objectives = this.board.objectives();
    const order = [...objectives.map((o) => o.id), ''];
    const rows: Row[] = [];
    for (const k of order) {
      const list = groups.get(k);
      if (!list?.length) continue;
      rows.push({
        kind: 'group',
        key: 'g:' + k,
        objective: objectives.find((o) => o.id === k) ?? null,
        count: list.length,
        done: list.filter((t) => t.status === 'completada').length,
      });
      for (const t of list) rows.push({ kind: 'task', key: t.id, task: t });
    }
    return rows;
  });

  ngAfterViewInit() {
    setTimeout(() => this.scrollToToday(false));
  }

  protected setZoom(z: Zoom) {
    this.zoom.set(z);
    savePref('gantt.zoom', z);
    setTimeout(() => this.scrollToToday(false));
  }

  protected toggleGrouped() {
    this.grouped.update((g) => !g);
    savePref('gantt.grouped', this.grouped() ? '1' : '0');
  }

  protected scrollToToday(smooth = true) {
    const left = this.todayLeft();
    if (left === null) return;
    const el = this.scroller().nativeElement;
    el.scrollTo({ left: Math.max(0, left - (el.clientWidth - this.left()) / 3), behavior: smooth ? 'smooth' : 'auto' });
  }

  protected geometry(t: Task) {
    let start = t.start_date;
    let end = t.end_date;
    const d = this.drag();
    if (d && d.id === t.id && d.delta) {
      if (d.mode === 'move') {
        start = addDays(start, d.delta);
        end = addDays(end, d.delta);
      } else if (d.mode === 'start') {
        start = addDays(start, d.delta);
        if (start > end) start = end;
      } else {
        end = addDays(end, d.delta);
        if (end < start) end = start;
      }
    }
    const px = this.px();
    const rs = this.range().start;
    return {
      start,
      end,
      left: diffDays(rs, start) * px,
      width: Math.max((diffDays(start, end) + 1) * px, 6),
    };
  }

  protected color(t: Task) {
    return this.board.colorOf(t);
  }

  protected tooltip(t: Task) {
    const obj = this.board.objectiveOf(t);
    return [
      t.name,
      `${formatDate(t.start_date)} → ${formatDate(t.end_date)}`,
      `${statusLabel(t.status)} · ${t.progress}%`,
      obj ? `${obj.code} ${obj.name}` : '',
      t.assignee ? `Responsable: ${t.assignee}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  protected fmt(iso: string) {
    return formatDate(iso, false);
  }

  // ---------- Arrastre ----------

  private lastPointer = 'mouse';

  /** En pantallas tactiles la barra no se arrastra (asi el dedo desplaza la vista); un toque la abre. */
  protected tap(t: Task) {
    if (this.lastPointer === 'touch') this.board.edit(t);
  }

  protected down(ev: PointerEvent, t: Task) {
    this.lastPointer = ev.pointerType;
    if (ev.pointerType === 'touch') return;
    if (ev.button !== 0) return;
    const el = ev.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const mode: Drag['mode'] =
      rect.width > EDGE * 3 && x <= EDGE ? 'start' : rect.width > EDGE * 3 && x >= rect.width - EDGE ? 'end' : 'move';
    el.setPointerCapture(ev.pointerId);
    this.drag.set({ id: t.id, mode, x0: ev.clientX, delta: 0, moved: false });
    ev.preventDefault();
  }

  protected move(ev: PointerEvent) {
    const d = this.drag();
    if (!d) return;
    const dx = ev.clientX - d.x0;
    const delta = Math.round(dx / this.px());
    const moved = d.moved || Math.abs(dx) > 3;
    if (delta !== d.delta || moved !== d.moved) this.drag.set({ ...d, delta, moved });
  }

  protected async up(ev: PointerEvent, t: Task) {
    const d = this.drag();
    if (!d) return;
    (ev.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId);
    const g = this.geometry(t);
    this.drag.set(null);
    if (!d.moved) {
      this.board.edit(t);
      return;
    }
    if (g.start === t.start_date && g.end === t.end_date) return;
    try {
      await this.board.updateTask(t.id, { start_date: g.start, end_date: g.end });
    } catch {
      /* el servicio ya revirtio y aviso */
    }
  }

  protected createAt(ev: MouseEvent) {
    const el = ev.currentTarget as HTMLElement;
    const x = ev.clientX - el.getBoundingClientRect().left;
    const date = addDays(this.range().start, Math.floor(x / this.px()));
    this.board.newTask(date, addDays(date, this.zoom() === 'dia' ? 0 : 6));
  }
}
