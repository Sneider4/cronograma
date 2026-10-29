import { CdkDrag, CdkDragDrop, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { Component, computed, inject } from '@angular/core';

import { BoardService, isOverdue } from '../core/board.service';
import { formatDate, todayISO } from '../core/dates';
import { STATUSES, Status, Task, priorityLabel } from '../core/models';
import { Avatar } from './avatar';
import { Icon } from './icon';

@Component({
  selector: 'app-kanban',
  imports: [CdkDropListGroup, CdkDropList, CdkDrag, Icon, Avatar],
  template: `
    <div class="board" cdkDropListGroup>
      @for (col of columns(); track col.value) {
        <section class="col">
          <header [style.--s]="col.color">
            <h4>{{ col.label }}</h4>
            <span class="count">{{ col.tasks.length }}</span>
            @if (board.canEditAll()) {
              <button class="btn sm ghost icon add" (click)="add(col.value)" title="Nueva actividad en esta columna" aria-label="Nueva actividad">
                <app-icon name="plus" [size]="15" />
              </button>
            }
          </header>
          <div class="list" cdkDropList [cdkDropListData]="col.value" (cdkDropListDropped)="drop($event)">
            @for (t of col.tasks; track t.id) {
              <article class="item" cdkDrag [cdkDragData]="t" [cdkDragDisabled]="!board.canUpdate(t)" [cdkDragStartDelay]="{ touch: 300, mouse: 0 }" (click)="board.edit(t)" [style.--c]="board.colorOf(t)">
                <div class="top">
                  @if (board.objectiveOf(t); as o) {
                    <span class="chip"><span class="dot" [style.background]="o.color"></span>{{ o.code }}</span>
                  }
                  <span class="prio" [class]="t.priority">{{ prio(t.priority) }}</span>
                </div>
                <p class="name">{{ t.name }}</p>
                <div class="meta">
                  <span class="num" [class.late]="late(t)">{{ fmt(t.start_date) }} – {{ fmt(t.end_date) }}</span>
                  @if (board.assigneeName(t); as who) {
                    <app-avatar [avatar]="board.assigneeAvatar(t)" [name]="who" [ghost]="!t.assignee_id" [size]="26" />
                  }
                </div>
                @if (t.progress > 0 && t.status !== 'completada') {
                  <div class="progress"><span [style.width.%]="t.progress"></span></div>
                }
              </article>
            } @empty {
              <div class="drop-empty faint small">Suelta aquí</div>
            }
          </div>
        </section>
      }
    </div>
  `,
  styles: `
    .board {
      display: grid; grid-template-columns: repeat(4, minmax(240px, 1fr)); gap: 12px;
      overflow-x: auto; padding-bottom: 6px;
    }
    .col {
      display: flex; flex-direction: column; min-height: 300px; border-radius: 24px;
      background: var(--surface-3);
    }
    header { display: flex; align-items: center; gap: 8px; height: 52px; padding: 0 10px 0 16px; }
    header::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--s); }
    h4 { font-size: 15px; font-weight: 500; letter-spacing: -0.03em; color: var(--text); }
    .count {
      min-width: 24px; height: 22px; padding: 0 7px; border-radius: 999px; background: var(--surface);
      display: grid; place-items: center; font-size: 11.5px; font-weight: 600; color: var(--text-2);
      font-variant-numeric: tabular-nums;
    }
    .add { margin-left: auto; background: var(--surface); }
    .list { flex: 1; display: flex; flex-direction: column; gap: 8px; padding: 0 8px 10px; min-height: 80px; }
    .item {
      display: flex; flex-direction: column; gap: 8px; padding: 14px 16px;
      background: var(--surface); border: 1px solid transparent; border-radius: 18px;
      cursor: grab; transition: border-color 0.15s;
      &:hover { border-color: var(--text); }
    }
    .top { display: flex; align-items: center; gap: 6px; min-height: 20px; }
    .prio {
      margin-left: auto; font-size: 11.5px; color: var(--text-3);
      &.alta { color: var(--danger); font-weight: 600; }
    }
    .name { margin: 0; font-size: 15px; font-weight: 500; line-height: 1.3; letter-spacing: -0.02em; }
    .meta { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--text-2); }
    .late { color: var(--danger); font-weight: 600; }

    .progress > span { background: var(--c); }
    /* Movil: una columna casi a lo ancho y se desliza de lado, ajustando cada columna */
    @media (max-width: 640px) {
      .board {
        grid-template-columns: none; grid-auto-flow: column; grid-auto-columns: 86%;
        gap: 10px; margin: 0 -16px; padding: 0 16px 8px; scroll-snap-type: x mandatory;
        scroll-padding: 0 16px; -webkit-overflow-scrolling: touch;
      }
      .col { scroll-snap-align: start; min-height: 220px; border-radius: 20px; }
      .item { padding: 12px 14px; border-radius: 16px; }
    }
    .drop-empty { display: grid; place-items: center; height: 64px; border: 1.5px dashed var(--border-strong); border-radius: 18px; }
  `,
})
export class Kanban {
  protected readonly board = inject(BoardService);

  protected readonly columns = computed(() => {
    const tasks = this.board.filteredTasks();
    const rank = { alta: 0, media: 1, baja: 2 };
    return STATUSES.map((s) => ({
      ...s,
      tasks: tasks
        .filter((t) => t.status === s.value)
        .sort((a, b) => a.end_date.localeCompare(b.end_date) || rank[a.priority] - rank[b.priority]),
    }));
  });

  protected async drop(ev: CdkDragDrop<Status, Status, Task>) {
    const task = ev.item.data;
    const status = ev.container.data;
    if (task.status === status) return;
    const changes: Partial<Task> = { status };
    if (status === 'completada') changes.progress = 100;
    if (status === 'pendiente' && task.progress === 100) changes.progress = 0;
    try {
      await this.board.updateTask(task.id, changes);
    } catch {
      /* revertido por el servicio */
    }
  }

  protected add(status: Status) {
    this.board.newTask();
    this.board.editing.update((e) => (e ? { ...e, status } : e));
  }

  protected late(t: Task) {
    return isOverdue(t, todayISO());
  }

  protected fmt(iso: string) {
    return formatDate(iso, false);
  }

  protected prio(p: Task['priority']) {
    return priorityLabel(p);
  }

}
