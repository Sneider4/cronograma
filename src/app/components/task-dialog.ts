import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { BoardService } from '../core/board.service';
import { diffDays, formatDate } from '../core/dates';
import { PRIORITIES, Priority, STATUSES, Status, TaskDraft } from '../core/models';
import { friendlyError } from '../core/supabase';
import { ToastService } from '../core/toast.service';
import { Icon } from './icon';

@Component({
  selector: 'app-task-dialog',
  imports: [FormsModule, Icon],
  template: `
    <div class="backdrop" (mousedown)="close()">
      <form class="dialog" (mousedown)="$event.stopPropagation()" (ngSubmit)="save()">
        <header>
          <h3>{{ isNew ? 'Nueva actividad' : 'Editar actividad' }}</h3>
          <button type="button" class="btn ghost icon" (click)="close()" aria-label="Cerrar"><app-icon name="x" /></button>
        </header>

        <div class="body">
          <div class="field">
            <label for="t-name">Nombre de la actividad *</label>
            <input id="t-name" class="input" name="name" [(ngModel)]="d.name" maxlength="300" required autofocus
                   [class.invalid]="tried() && !d.name.trim()" />
          </div>

          <div class="grid-2 dates">
            <div class="field">
              <label for="t-start">Inicio *</label>
              <input id="t-start" class="input" type="date" name="start" [(ngModel)]="d.start_date" (ngModelChange)="syncEnd()" required />
            </div>
            <div class="field">
              <label for="t-end">Fin *</label>
              <input id="t-end" class="input" type="date" name="end" [(ngModel)]="d.end_date" (ngModelChange)="touch()" [min]="d.start_date" required
                     [class.invalid]="datesInvalid()" />
              @if (datesInvalid()) {
                <span class="error">La fecha fin no puede ser anterior al inicio.</span>
              } @else {
                <span class="hint">{{ duration() }}</span>
              }
            </div>
          </div>

          <div class="grid-3">
            <div class="field">
              <label for="t-obj">Objetivo</label>
              <select id="t-obj" class="select" name="obj" [(ngModel)]="d.objective_id">
                <option [ngValue]="null">Sin objetivo</option>
                @for (o of board.objectives(); track o.id) {
                  <option [ngValue]="o.id">{{ o.code }}{{ o.name ? ' · ' + o.name : '' }}</option>
                }
              </select>
            </div>
            <div class="field">
              <label for="t-status">Estado</label>
              <select id="t-status" class="select" name="status" [(ngModel)]="d.status" (ngModelChange)="onStatus($event)">
                @for (s of statuses; track s.value) {
                  <option [ngValue]="s.value">{{ s.label }}</option>
                }
              </select>
            </div>
            <div class="field">
              <label for="t-prio">Prioridad</label>
              <select id="t-prio" class="select" name="prio" [(ngModel)]="d.priority">
                @for (p of priorities; track p.value) {
                  <option [ngValue]="p.value">{{ p.label }}</option>
                }
              </select>
            </div>
          </div>

          <div class="field">
            <label for="t-progress">Avance: {{ d.progress }}%</label>
            <input id="t-progress" type="range" min="0" max="100" step="5" name="progress" [(ngModel)]="d.progress" />
          </div>

          <div class="grid-2">
            <div class="field">
              <label for="t-deliv">Entregable</label>
              <input id="t-deliv" class="input" name="deliv" [(ngModel)]="d.deliverable" />
            </div>
            <div class="field">
              <label for="t-assignee">Responsable</label>
              <input id="t-assignee" class="input" name="assignee" [(ngModel)]="d.assignee" list="assignees" />
              <datalist id="assignees">
                @for (a of board.assignees(); track a) {
                  <option [value]="a"></option>
                }
              </datalist>
            </div>
          </div>

          <div class="field">
            <label for="t-notes">Descripción / notas</label>
            <textarea id="t-notes" class="textarea" name="notes" [(ngModel)]="d.notes"></textarea>
          </div>

          <div class="field">
            <label for="t-ev">Enlace de evidencia</label>
            <input id="t-ev" class="input" type="url" name="ev" [(ngModel)]="d.evidence_url" placeholder="https://drive.google.com/…" />
          </div>
        </div>

        <footer>
          @if (!isNew) {
            @if (confirmDelete()) {
              <span class="small">¿Eliminar?</span>
              <button type="button" class="btn sm danger" (click)="remove()" [disabled]="busy()">Sí, eliminar</button>
              <button type="button" class="btn sm ghost" (click)="confirmDelete.set(false)">No</button>
            } @else {
              <button type="button" class="btn danger" (click)="confirmDelete.set(true)"><app-icon name="trash" [size]="15" /> Eliminar</button>
            }
          }
          <span class="spacer"></span>
          <button type="button" class="btn" (click)="close()">Cancelar</button>
          <button type="submit" class="btn primary" [disabled]="busy()">
            {{ isNew ? 'Crear actividad' : 'Guardar cambios' }}
          </button>
        </footer>
      </form>
    </div>
  `,
  styles: `
    @media (max-width: 560px) {
      .dates { grid-template-columns: 1fr 1fr; gap: 10px; }
      .grid-3 { grid-template-columns: 1fr 1fr; gap: 10px; }
      .grid-3 > :first-child { grid-column: 1 / -1; }
    }
  `,
})
export class TaskDialog implements OnInit {
  protected readonly board = inject(BoardService);
  private readonly toast = inject(ToastService);

  protected readonly statuses = STATUSES;
  protected readonly priorities = PRIORITIES;
  protected readonly busy = signal(false);
  protected readonly tried = signal(false);
  protected readonly confirmDelete = signal(false);

  protected isNew = true;
  private id: string | undefined;
  protected d!: TaskDraft;

  // ngModel muta `d`; este signal fuerza el recalculo de lo derivado.
  private readonly tick = signal(0);
  protected readonly datesInvalid = computed(() => {
    this.tick();
    return !!this.d?.start_date && !!this.d?.end_date && this.d.end_date < this.d.start_date;
  });
  protected readonly duration = computed(() => {
    this.tick();
    if (!this.d?.start_date || !this.d?.end_date) return '';
    const days = diffDays(this.d.start_date, this.d.end_date) + 1;
    return `${days} día${days === 1 ? '' : 's'} · termina ${formatDate(this.d.end_date)}`;
  });

  ngOnInit() {
    const e = this.board.editing()!;
    this.isNew = !e.id;
    this.id = e.id;
    this.d = {
      name: e.name ?? '',
      start_date: e.start_date,
      end_date: e.end_date,
      objective_id: e.objective_id ?? null,
      status: (e.status ?? 'pendiente') as Status,
      priority: (e.priority ?? 'media') as Priority,
      progress: e.progress ?? 0,
      deliverable: e.deliverable ?? '',
      assignee: e.assignee ?? '',
      notes: e.notes ?? '',
      evidence_url: e.evidence_url ?? '',
    };
  }

  @HostListener('document:keydown.escape')
  close() {
    this.board.editing.set(null);
  }

  touch() {
    this.tick.update((n) => n + 1);
  }

  syncEnd() {
    if (this.d.end_date < this.d.start_date) this.d.end_date = this.d.start_date;
    this.tick.update((n) => n + 1);
  }

  onStatus(s: Status) {
    if (s === 'completada') this.d.progress = 100;
    else if (s === 'pendiente' && this.d.progress === 100) this.d.progress = 0;
  }

  async save() {
    this.tried.set(true);
    this.tick.update((n) => n + 1);
    if (!this.d.name.trim() || !this.d.start_date || !this.d.end_date || this.datesInvalid()) return;
    this.busy.set(true);
    const draft: TaskDraft = { ...this.d, name: this.d.name.trim(), progress: Number(this.d.progress) };
    try {
      if (this.isNew) await this.board.createTask(draft);
      else await this.board.updateTask(this.id!, draft);
      this.toast.show(this.isNew ? 'Actividad creada' : 'Cambios guardados');
      this.close();
    } catch (e) {
      this.toast.error(friendlyError(e));
    } finally {
      this.busy.set(false);
    }
  }

  async remove() {
    this.busy.set(true);
    try {
      await this.board.deleteTask(this.id!);
      this.toast.show('Actividad eliminada');
      this.close();
    } catch (e) {
      this.toast.error(friendlyError(e));
    } finally {
      this.busy.set(false);
    }
  }
}
