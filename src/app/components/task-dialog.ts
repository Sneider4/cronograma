import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { BoardService } from '../core/board.service';
import { diffDays, formatDate } from '../core/dates';
import { PRIORITIES, Priority, STATUSES, Status, TaskDraft } from '../core/models';
import { friendlyError } from '../core/supabase';
import { ToastService } from '../core/toast.service';
import { Avatar } from './avatar';
import { Icon } from './icon';

@Component({
  selector: 'app-task-dialog',
  imports: [FormsModule, Icon, Avatar],
  template: `
    <div class="backdrop" (mousedown)="close()">
      <form class="dialog" (mousedown)="$event.stopPropagation()" (ngSubmit)="save()">
        <header>
          <h3>{{ isNew ? 'Nueva actividad' : canManage ? 'Editar actividad' : canUpdate ? 'Tu actividad' : 'Detalle de la actividad' }}</h3>
          <button type="button" class="btn ghost icon" (click)="close()" aria-label="Cerrar"><app-icon name="x" /></button>
        </header>

        <div class="body">
          @if (!canManage) {
            <p class="callout small locked">
              <app-icon name="lock" [size]="14" />
              {{ canUpdate ? 'Puedes actualizar el estado, el avance, las notas y la evidencia. Lo demás lo cambia el dueño o un editor.' : 'Esta actividad es de otra persona: solo puedes verla.' }}
            </p>
          }
          <div class="field">
            <label for="t-name">Nombre de la actividad *</label>
            <input id="t-name" class="input" name="name" [(ngModel)]="d.name" maxlength="300" required [autofocus]="canManage" [disabled]="!canManage"
                   [class.invalid]="tried() && !d.name.trim()" />
          </div>

          <div class="grid-2 dates">
            <div class="field">
              <label for="t-start">Inicio *</label>
              <input id="t-start" class="input" type="date" name="start" [(ngModel)]="d.start_date" (ngModelChange)="syncEnd()" required [disabled]="!canManage" />
            </div>
            <div class="field">
              <label for="t-end">Fin *</label>
              <input id="t-end" class="input" type="date" name="end" [(ngModel)]="d.end_date" (ngModelChange)="touch()" [min]="d.start_date" required [disabled]="!canManage"
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
              <select id="t-obj" class="select" name="obj" [(ngModel)]="d.objective_id" [disabled]="!canManage">
                <option [ngValue]="null">Sin objetivo</option>
                @for (o of board.objectives(); track o.id) {
                  <option [ngValue]="o.id">{{ o.code }}{{ o.name ? ' · ' + o.name : '' }}</option>
                }
              </select>
            </div>
            <div class="field">
              <label for="t-status">Estado</label>
              <select id="t-status" class="select" name="status" [(ngModel)]="d.status" (ngModelChange)="onStatus($event)" [disabled]="!canUpdate">
                @for (s of statuses; track s.value) {
                  <option [ngValue]="s.value">{{ s.label }}</option>
                }
              </select>
            </div>
            <div class="field">
              <label for="t-prio">Prioridad</label>
              <select id="t-prio" class="select" name="prio" [(ngModel)]="d.priority" [disabled]="!canManage">
                @for (p of priorities; track p.value) {
                  <option [ngValue]="p.value">{{ p.label }}</option>
                }
              </select>
            </div>
          </div>

          <div class="field">
            <label for="t-progress">Avance: {{ d.progress }}%</label>
            <input id="t-progress" type="range" min="0" max="100" step="5" name="progress" [(ngModel)]="d.progress" [disabled]="!canUpdate" />
          </div>

          <div class="grid-2">
            <div class="field">
              <label for="t-deliv">Entregable</label>
              <input id="t-deliv" class="input" name="deliv" [(ngModel)]="d.deliverable" [disabled]="!canManage" />
            </div>
            <div class="field">
              <label for="t-assignee">Responsable</label>
              <div class="who-pick">
                <app-avatar [avatar]="pickAvatar()" [name]="pickName()" [ghost]="who() === OTHER" [size]="30" />
                <select id="t-assignee" class="select" name="who" [ngModel]="who()" (ngModelChange)="who.set($event)" [disabled]="!canManage">
                  <option value="">Sin responsable</option>
                  @for (m of board.members(); track m.user_id) {
                    <option [value]="m.user_id">{{ m.profile?.full_name || m.profile?.email }}{{ m.user_id === board.myId() ? ' (tú)' : '' }}</option>
                  }
                  <option [value]="OTHER">Otra persona…</option>
                </select>
              </div>
              @if (who() === OTHER) {
                <input class="input other" name="other" [(ngModel)]="other" placeholder="Nombre de la persona" maxlength="80"
                       [disabled]="!canManage" aria-label="Nombre de la otra persona" />
                <span class="hint">No tiene cuenta, así que no verá la actividad.</span>
              }
            </div>
          </div>

          <div class="field">
            <label for="t-notes">Descripción / notas</label>
            <textarea id="t-notes" class="textarea" name="notes" [(ngModel)]="d.notes" [disabled]="!canUpdate"></textarea>
          </div>

          <div class="field">
            <label for="t-ev">Enlace de evidencia</label>
            <input id="t-ev" class="input" type="url" name="ev" [(ngModel)]="d.evidence_url" placeholder="https://drive.google.com/…" [disabled]="!canUpdate" />
          </div>
        </div>

        <footer>
          @if (!isNew && canManage) {
            @if (confirmDelete()) {
              <span class="small">¿Eliminar?</span>
              <button type="button" class="btn sm danger" (click)="remove()" [disabled]="busy()">Sí, eliminar</button>
              <button type="button" class="btn sm ghost" (click)="confirmDelete.set(false)">No</button>
            } @else {
              <button type="button" class="btn danger" (click)="confirmDelete.set(true)"><app-icon name="trash" [size]="15" /> Eliminar</button>
            }
          }
          <span class="spacer"></span>
          <button type="button" class="btn" (click)="close()">{{ canUpdate ? 'Cancelar' : 'Cerrar' }}</button>
          @if (canUpdate) {
            <button type="submit" class="btn primary" [disabled]="busy()">
              {{ isNew ? 'Crear actividad' : 'Guardar cambios' }}
            </button>
          }
        </footer>
      </form>
    </div>
  `,
  styles: `
    .locked { display: flex; align-items: center; gap: 8px; margin: 0; }
    .who-pick { display: flex; align-items: center; gap: 8px; .select { flex: 1; min-width: 0; } }
    .other { margin-top: 8px; }
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
  /** El dueno edita todo; un integrante solo estado, avance, notas y evidencia. */
  protected readonly canManage = this.board.canEditAll();
  /** Puede guardar algo (si no, el dialogo es solo de lectura). */
  protected canUpdate = true;

  protected readonly OTHER = '__otra__';
  /** '' = sin responsable, id del miembro, u OTHER. */
  protected readonly who = signal('');
  protected other = '';
  protected readonly pickName = computed(() => {
    const w = this.who();
    if (w === this.OTHER) return this.other || '?';
    return this.board.memberMap().get(w)?.profile?.full_name ?? '';
  });
  protected readonly pickAvatar = computed(() => this.board.memberMap().get(this.who())?.profile?.avatar ?? '');

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
      assignee_id: e.assignee_id ?? null,
      assignee: e.assignee ?? '',
      notes: e.notes ?? '',
      evidence_url: e.evidence_url ?? '',
    };
    this.canUpdate = this.isNew ? this.canManage : this.board.canUpdate(this.d);
    if (this.d.assignee_id) this.who.set(this.d.assignee_id);
    else if (this.d.assignee.trim()) {
      this.who.set(this.OTHER);
      this.other = this.d.assignee;
    }
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
    if (!this.canUpdate) return;
    this.tried.set(true);
    this.tick.update((n) => n + 1);
    if (!this.d.name.trim() || !this.d.start_date || !this.d.end_date || this.datesInvalid()) return;
    this.busy.set(true);
    const w = this.who();
    const member = this.board.memberMap().get(w);
    const draft: TaskDraft = {
      ...this.d,
      name: this.d.name.trim(),
      progress: Number(this.d.progress),
      assignee_id: member ? w : null,
      assignee: member ? (member.profile?.full_name ?? '') : w === this.OTHER ? this.other.trim() : '',
    };
    try {
      if (this.isNew) await this.board.createTask(draft);
      else if (this.canManage) await this.board.updateTask(this.id!, draft);
      else {
        // Un integrante solo envia lo que puede cambiar.
        const { status, progress, notes, evidence_url } = draft;
        await this.board.updateTask(this.id!, { status, progress, notes, evidence_url });
      }
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
