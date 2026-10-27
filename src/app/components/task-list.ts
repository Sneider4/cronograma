import { Component, computed, inject, signal } from '@angular/core';

import { BoardService, isOverdue } from '../core/board.service';
import { diffDays, formatDate, todayISO } from '../core/dates';
import { PRIORITIES, Priority, STATUSES, Status, Task, statusColor } from '../core/models';
import { Icon } from './icon';

type SortKey = 'name' | 'start_date' | 'end_date' | 'objective' | 'status' | 'priority' | 'progress' | 'assignee';

@Component({
  selector: 'app-task-list',
  imports: [Icon],
  template: `
    <div class="card wrap">
      <table>
        <thead>
          <tr>
            @for (c of cols; track c.key) {
              <th [class]="c.cls ?? ''" (click)="sortBy(c.key)" [class.sorted]="sort().key === c.key">
                <span class="th">
                  {{ c.label }}
                  @if (sort().key === c.key) {
                    <app-icon class="arrow" [class.up]="sort().dir === 1" name="chevron-down" [size]="13" />
                  }
                </span>
              </th>
            }
          </tr>
        </thead>
        <tbody>
          @for (t of rows(); track t.id) {
            <tr (click)="board.edit(t)">
              <td class="name">
                <span class="swatch" [style.background]="board.colorOf(t)"></span>
                <div>
                  <div class="title" [class.done]="t.status === 'completada'">{{ t.name }}</div>
                  @if (t.deliverable) {
                    <div class="faint small">{{ t.deliverable }}</div>
                  }
                </div>
              </td>
              <td class="nowrap num">{{ fmt(t.start_date) }}</td>
              <td class="nowrap num" [class.late]="late(t)">
                {{ fmt(t.end_date) }}
                @if (late(t)) {
                  <div class="small">vencida hace {{ daysLate(t) }} d</div>
                }
              </td>
              <td class="hide-md">{{ board.objectiveOf(t)?.code ?? '—' }}</td>
              <td (click)="$event.stopPropagation()">
                <select class="select sm status" [value]="t.status" [style.--c]="statusColor(t.status)"
                        (change)="setStatus(t, $any($event.target).value)">
                  @for (s of statuses; track s.value) {
                    <option [value]="s.value" [selected]="s.value === t.status">{{ s.label }}</option>
                  }
                </select>
              </td>
              <td class="hide-md" (click)="$event.stopPropagation()">
                <select class="select sm" [value]="t.priority" (change)="setPriority(t, $any($event.target).value)">
                  @for (p of priorities; track p.value) {
                    <option [value]="p.value" [selected]="p.value === t.priority">{{ p.label }}</option>
                  }
                </select>
              </td>
              <td class="prog">
                <div class="progress"><span [style.width.%]="t.progress" [style.background]="board.colorOf(t)"></span></div>
                <span class="small muted num">{{ t.progress }}%</span>
              </td>
              <td class="hide-md">{{ t.assignee || '—' }}</td>
            </tr>
          } @empty {
            <tr class="no-hover"><td colspan="8" class="muted center">Ninguna actividad coincide con los filtros.</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    .wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th {
      position: sticky; top: 0; padding: 0 14px; height: 44px; text-align: left; white-space: nowrap;
      font-size: 12.5px; font-weight: 500; color: var(--text-3); background: var(--surface);
      border-bottom: 1px solid var(--border); cursor: pointer; user-select: none;
      &:hover, &.sorted { color: var(--text); }
    }
    .th { display: inline-flex; align-items: center; gap: 4px; }
    .arrow { color: var(--copper); }
    .arrow.up { transform: rotate(180deg); }
    td { padding: 12px 14px; border-bottom: 1px solid var(--border); vertical-align: middle; }
    tbody tr:last-child td { border-bottom: 0; }
    tr:not(.no-hover) { cursor: pointer; }
    tbody tr:not(.no-hover):hover td { background: var(--surface-2); }
    tbody tr:not(.no-hover):hover .title { color: var(--copper); }
    .name { display: flex; gap: 10px; align-items: flex-start; min-width: 240px; }
    .title { font-weight: 500; }
    .title.done { text-decoration: line-through; color: var(--text-3); }
    .swatch { flex: none; width: 9px; height: 9px; margin-top: 6px; border-radius: 50%; }
    .nowrap { white-space: nowrap; }
    .late { color: var(--danger); font-weight: 600; }
    .status { width: 136px; box-shadow: inset 3px 0 0 var(--c); }
    .select.sm { height: 32px; font-size: 12.5px; border-radius: 999px; padding: 0 12px; }
    .wrap { padding: 4px 6px; }
    .prog { min-width: 110px; .progress { margin-bottom: 3px; } }
    .center { text-align: center; padding: 30px; }
    @media (max-width: 900px) { .hide-md { display: none; } }

    /* Movil: cada fila es una tarjeta (nombre / fechas + estado / avance) */
    @media (max-width: 640px) {
      .wrap { padding: 4px; border-radius: 20px; overflow: visible; }
      table, tbody { display: block; }
      thead { display: none; }
      tr {
        display: grid; grid-template-columns: auto auto minmax(0, 1fr);
        grid-template-areas: 'name name name' 'start end status' 'prog prog prog';
        gap: 6px 8px; align-items: center; padding: 12px; border-bottom: 1px solid var(--border);
      }
      tbody tr:last-child { border-bottom: 0; }
      td { padding: 0; border: 0 !important; background: none !important; }
      .name { grid-area: name; min-width: 0; }
      td:nth-child(2) { grid-area: start; font-size: 12.5px; color: var(--text-2); }
      td:nth-child(2)::after { content: ' →'; color: var(--text-3); }
      td:nth-child(3) { grid-area: end; font-size: 12.5px; color: var(--text-2); }
      td:nth-child(3).late { color: var(--danger); .small { display: none; } }
      td:nth-child(5) { grid-area: status; justify-self: end; }
      .prog { grid-area: prog; display: flex; align-items: center; gap: 10px; min-width: 0; .progress { flex: 1; margin: 0; } }
      .status { width: 122px; height: 34px; padding: 0 10px; }
      .title { font-size: 15px; }
      tr.no-hover { display: block; }
    }
  `,
})
export class TaskList {
  protected readonly board = inject(BoardService);
  protected readonly statuses = STATUSES;
  protected readonly priorities = PRIORITIES;
  protected readonly statusColor = statusColor;

  protected readonly cols: { key: SortKey; label: string; cls?: string }[] = [
    { key: 'name', label: 'Actividad' },
    { key: 'start_date', label: 'Inicio' },
    { key: 'end_date', label: 'Fin' },
    { key: 'objective', label: 'Objetivo', cls: 'hide-md' },
    { key: 'status', label: 'Estado' },
    { key: 'priority', label: 'Prioridad', cls: 'hide-md' },
    { key: 'progress', label: 'Avance' },
    { key: 'assignee', label: 'Responsable', cls: 'hide-md' },
  ];

  protected readonly sort = signal<{ key: SortKey; dir: 1 | -1 }>({ key: 'start_date', dir: 1 });

  protected readonly rows = computed(() => {
    const { key, dir } = this.sort();
    const statusRank = Object.fromEntries(STATUSES.map((s, i) => [s.value, i]));
    const prioRank = { alta: 0, media: 1, baja: 2 };
    const value = (t: Task): string | number => {
      switch (key) {
        case 'objective':
          return this.board.objectiveOf(t)?.code ?? '~';
        case 'status':
          return statusRank[t.status];
        case 'priority':
          return prioRank[t.priority];
        case 'progress':
          return t.progress;
        default:
          return (t[key] as string).toLowerCase();
      }
    };
    return [...this.board.filteredTasks()].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      const c = typeof va === 'number' ? va - (vb as number) : va.localeCompare(vb as string);
      return c * dir || a.start_date.localeCompare(b.start_date);
    });
  });

  protected sortBy(key: SortKey) {
    this.sort.update((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  }

  protected async setStatus(t: Task, status: Status) {
    try {
      await this.board.updateTask(t.id, { status });
    } catch {
      /* revertido */
    }
  }

  protected async setPriority(t: Task, priority: Priority) {
    try {
      await this.board.updateTask(t.id, { priority });
    } catch {
      /* revertido */
    }
  }

  protected fmt(iso: string) {
    return formatDate(iso);
  }

  protected late(t: Task) {
    return isOverdue(t, todayISO());
  }

  protected daysLate(t: Task) {
    return diffDays(t.end_date, todayISO());
  }
}
