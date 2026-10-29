import { Component, HostListener, computed, inject, input, output, signal } from '@angular/core';

import { BoardService } from '../core/board.service';
import { formatDate } from '../core/dates';
import { ImportResult } from '../core/excel.service';
import { priorityLabel, statusLabel } from '../core/models';
import { friendlyError } from '../core/supabase';
import { ToastService } from '../core/toast.service';
import { Icon } from './icon';

const PREVIEW = 60;

@Component({
  selector: 'app-import-dialog',
  imports: [Icon],
  template: `
    <div class="backdrop" (mousedown)="closed.emit()">
      <div class="dialog wide" (mousedown)="$event.stopPropagation()">
        <header>
          <div>
            <h3>Importar desde Excel</h3>
            <span class="faint small">{{ fileName() }}</span>
          </div>
          <button class="btn ghost icon" (click)="closed.emit()" aria-label="Cerrar"><app-icon name="x" /></button>
        </header>

        <div class="body">
          <div class="stats">
            <div class="stat ok"><span class="eyebrow">Filas válidas</span><b class="num">{{ result().rows.length }}</b></div>
            <div class="stat" [class.bad]="result().errors.length"><span class="eyebrow">Con errores</span><b class="num">{{ result().errors.length }}</b></div>
            <div class="stat"><span class="eyebrow">Objetivos nuevos</span><b class="num">{{ result().newObjectiveCodes.length }}</b></div>
          </div>

          @if (result().errors.length) {
            <div class="callout error">
              <b>Estas filas no se importarán.</b> Corrígelas en el Excel y vuelve a subirlo, o importa solo las válidas.
              <ul class="issues">
                @for (e of result().errors.slice(0, 40); track $index) {
                  <li>{{ e.row ? 'Fila ' + e.row + ': ' : '' }}{{ e.message }}</li>
                }
                @if (result().errors.length > 40) {
                  <li>… y {{ result().errors.length - 40 }} más.</li>
                }
              </ul>
            </div>
          }

          @if (result().warnings.length) {
            <div class="callout warn">
              <ul class="issues">
                @for (w of result().warnings; track $index) {
                  <li>Fila {{ w.row }}: {{ w.message }}</li>
                }
              </ul>
            </div>
          }

          @if (others().length) {
            <div class="callout">
              No están en el equipo y quedarán como <b>otra persona</b>: {{ others().join(', ') }}.
              Si son compañeros, invítalos antes de importar para que vean sus actividades.
            </div>
          }

          @if (result().newObjectiveCodes.length) {
            <div class="callout">
              Se crearán los objetivos: <b>{{ result().newObjectiveCodes.join(', ') }}</b>.
              Puedes cambiarles nombre y color luego en Ajustes.
            </div>
          }

          @if (result().rows.length) {
            <div class="preview">
              <table>
                <thead>
                  <tr><th>Fila</th><th>Actividad</th><th>Inicio</th><th>Fin</th><th>Obj.</th><th>Estado</th><th>Prior.</th><th>%</th><th>Responsable</th></tr>
                </thead>
                <tbody>
                  @for (r of result().rows.slice(0, preview); track r.row) {
                    <tr>
                      <td class="faint">{{ r.row }}</td>
                      <td>{{ r.name }}</td>
                      <td class="nowrap">{{ fmt(r.start_date) }}</td>
                      <td class="nowrap">{{ fmt(r.end_date) }}</td>
                      <td>{{ r.objective_code || '—' }}</td>
                      <td>{{ status(r.status) }}</td>
                      <td>{{ prio(r.priority) }}</td>
                      <td>{{ r.progress }}</td>
                      <td>
                        @if (board.matchMember(r.assignee); as m) {
                          {{ m.profile?.full_name }}
                        } @else if (r.assignee) {
                          {{ r.assignee }} <span class="faint">(otra persona)</span>
                        } @else {
                          —
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
              @if (result().rows.length > preview) {
                <p class="faint small more">Mostrando {{ preview }} de {{ result().rows.length }} filas.</p>
              }
            </div>

            <fieldset class="modes">
              <label class="mode" [class.on]="mode() === 'append'">
                <input type="radio" name="mode" [checked]="mode() === 'append'" (change)="mode.set('append')" />
                <div><b>Agregar</b><span class="small muted">Suma estas filas a las {{ board.tasks().length }} actividades actuales.</span></div>
              </label>
              <label class="mode" [class.on]="mode() === 'replace'">
                <input type="radio" name="mode" [checked]="mode() === 'replace'" (change)="mode.set('replace')" />
                <div><b>Reemplazar</b><span class="small muted">Borra las {{ board.tasks().length }} actividades actuales y deja solo las del Excel.</span></div>
              </label>
            </fieldset>
          }
        </div>

        <footer>
          <span class="spacer"></span>
          <button class="btn" (click)="closed.emit()">Cancelar</button>
          <button class="btn primary" [class.danger-fill]="mode() === 'replace'" [disabled]="busy() || !result().rows.length" (click)="run()">
            {{ busy() ? 'Importando…' : buttonText() }}
          </button>
        </footer>
      </div>
    </div>
  `,
  styles: `
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid var(--border); border-radius: var(--radius); }
    .stat {
      display: flex; flex-direction: column; gap: 2px; padding: 10px 14px; border-left: 1px solid var(--border);
      &:first-child { border-left: 0; }
      b { font-size: 20px; font-weight: 600; }
      &.ok b { color: var(--ok); }
      &.bad b { color: var(--danger); }
    }
    .issues { margin: 6px 0 0; padding-left: 18px; max-height: 160px; overflow: auto; }
    .preview { max-height: 300px; overflow: auto; border: 1px solid var(--border); border-radius: var(--radius); }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    th {
      position: sticky; top: 0; background: var(--surface-2); text-align: left; padding: 7px 10px;
      font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-3);
      border-bottom: 1px solid var(--border-strong);
    }
    td { padding: 6px 10px; border-top: 1px solid var(--border); }
    tr:first-child td { border-top: 0; }
    .nowrap { white-space: nowrap; font-variant-numeric: tabular-nums; }
    .more { margin: 0; padding: 8px 10px; }
    .modes { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 0; padding: 0; border: 0; }
    .mode {
      display: flex; gap: 10px; align-items: flex-start; padding: 12px; border-radius: var(--radius); cursor: pointer;
      border: 1px solid var(--border-strong);
      &.on { border-color: var(--accent); background: var(--accent-soft); }
      div { display: flex; flex-direction: column; }
      input { margin-top: 3px; accent-color: var(--accent); }
    }
    .danger-fill { background: var(--danger) !important; border-color: var(--danger) !important; }
    @media (max-width: 560px) { .modes, .stats { grid-template-columns: 1fr; } }
  `,
})
export class ImportDialog {
  protected readonly board = inject(BoardService);
  private readonly toast = inject(ToastService);

  readonly result = input.required<ImportResult>();
  readonly fileName = input('');
  readonly closed = output<void>();

  protected readonly preview = PREVIEW;
  protected readonly mode = signal<'append' | 'replace'>('append');
  protected readonly busy = signal(false);

  /** Responsables del Excel que no coinciden con nadie del equipo. */
  protected readonly others = computed(() => {
    const names = new Set<string>();
    for (const r of this.result().rows) if (r.assignee && !this.board.matchMember(r.assignee)) names.add(r.assignee);
    return [...names].sort((a, b) => a.localeCompare(b));
  });

  protected readonly buttonText = computed(() => {
    const n = this.result().rows.length;
    const verb = this.mode() === 'replace' ? 'Reemplazar con' : 'Importar';
    return `${verb} ${n} actividad${n === 1 ? '' : 'es'}`;
  });

  @HostListener('document:keydown.escape')
  onEsc() {
    if (!this.busy()) this.closed.emit();
  }

  protected async run() {
    if (this.mode() === 'replace' && this.board.tasks().length) {
      const ok = confirm(
        `Se borrarán las ${this.board.tasks().length} actividades actuales del proyecto. ¿Continuar?`,
      );
      if (!ok) return;
    }
    this.busy.set(true);
    try {
      const rows = this.result().rows.map(({ row: _row, ...rest }) => rest);
      const n = await this.board.importTasks(rows, this.result().objectives, this.mode() === 'replace');
      this.toast.show(`${n} actividades importadas`);
      this.closed.emit();
    } catch (e) {
      this.toast.error(friendlyError(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected fmt(iso: string) {
    return formatDate(iso);
  }
  protected status = statusLabel;
  protected prio = priorityLabel;
}
