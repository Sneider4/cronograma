import { Component, HostListener, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { AuthService } from '../core/auth.service';
import { BoardService } from '../core/board.service';
import { Member, PALETTE, ROLES, Role, roleLabel } from '../core/models';
import { friendlyError } from '../core/supabase';
import { ToastService } from '../core/toast.service';
import { Avatar } from './avatar';
import { Icon } from './icon';

type Tab = 'general' | 'objetivos' | 'equipo';

interface ObjectiveDraft {
  id?: string;
  code: string;
  name: string;
  color: string;
}

@Component({
  selector: 'app-settings-dialog',
  imports: [FormsModule, Icon, Avatar],
  template: `
    <div class="backdrop" (mousedown)="closed.emit()">
      <div class="dialog wide" (mousedown)="$event.stopPropagation()">
        <header>
          <h3>Ajustes del proyecto</h3>
          <button class="btn ghost icon" (click)="closed.emit()" aria-label="Cerrar"><app-icon name="x" /></button>
        </header>

        <nav class="tabs">
          <button [class.on]="tab() === 'general'" (click)="tab.set('general')">General</button>
          <button [class.on]="tab() === 'objetivos'" (click)="tab.set('objetivos')">Objetivos ({{ board.objectives().length }})</button>
          <button [class.on]="tab() === 'equipo'" (click)="tab.set('equipo')">Equipo ({{ board.members().length }})</button>
        </nav>

        <div class="body">
          @switch (tab()) {
            @case ('general') {
              <div class="field">
                <label for="s-name">Nombre</label>
                <input id="s-name" class="input" [(ngModel)]="name" maxlength="120" [disabled]="!board.isOwner()" />
              </div>
              <div class="field">
                <label for="s-desc">Descripción</label>
                <textarea id="s-desc" class="textarea" [(ngModel)]="description" [disabled]="!board.isOwner()"></textarea>
              </div>
              <div class="field">
                <span class="label">Color</span>
                <div class="swatches">
                  @for (c of palette; track c) {
                    <button type="button" class="swatch" [style.background]="c" [class.on]="color === c"
                            [disabled]="!board.isOwner()" (click)="color = c" [attr.aria-label]="'Color ' + c"></button>
                  }
                </div>
              </div>
              @if (board.isOwner()) {
                <div><button class="btn primary" (click)="saveGeneral()" [disabled]="busy() || !name.trim()">Guardar</button></div>
                <div class="danger-zone">
                  <div>
                    <b>Eliminar proyecto</b>
                    <p class="small muted">Borra el proyecto, sus objetivos y todas sus actividades para todo el equipo. No se puede deshacer.</p>
                  </div>
                  <button class="btn danger" (click)="deleteProject()">Eliminar proyecto</button>
                </div>
              } @else {
                <p class="small muted">Solo el dueño puede cambiar estos datos.</p>
                <div class="danger-zone">
                  <div><b>Salir del proyecto</b><p class="small muted">Dejarás de ver este cronograma.</p></div>
                  <button class="btn danger" (click)="leave()">Salir</button>
                </div>
              }
            }

            @case ('objetivos') {
              <p class="small muted">
                Los objetivos agrupan las actividades y les dan color. El <b>código</b> es lo que se escribe en la
                columna «Objetivo» del Excel.
                @if (!board.canEditAll()) {
                  <br />Solo el dueño o un editor puede crearlos o cambiarlos.
                }
              </p>
              @if (!board.canEditAll()) {
                <div class="obj-list">
                  @for (o of board.objectives(); track o.id) {
                    <div class="obj-view"><span class="dot" [style.background]="o.color"></span><b class="mono">{{ o.code }}</b><span>{{ o.name || '—' }}</span></div>
                  } @empty {
                    <span class="small faint">Aún no hay objetivos.</span>
                  }
                </div>
              } @else {
              <div class="obj-list">
                @for (o of drafts(); track $index) {
                  <div class="obj-row">
                    <input type="color" [(ngModel)]="o.color" [attr.aria-label]="'Color de ' + o.code" />
                    <input class="input code" [(ngModel)]="o.code" maxlength="20" placeholder="OE1" />
                    <input class="input" [(ngModel)]="o.name" placeholder="Nombre del objetivo" />
                    <button class="btn sm" (click)="saveObjective(o)" [disabled]="busy() || !o.code.trim()">
                      {{ o.id ? 'Guardar' : 'Crear' }}
                    </button>
                    <button class="btn sm danger icon" (click)="removeObjective(o, $index)" title="Eliminar" aria-label="Eliminar objetivo">
                      <app-icon name="trash" [size]="14" />
                    </button>
                  </div>
                }
              </div>
              <div><button class="btn" (click)="addDraft()"><app-icon name="plus" /> Agregar objetivo</button></div>
              }
            }

            @case ('equipo') {
              @if (board.project(); as p) {
                <div class="invite">
                  <div>
                    <span class="eyebrow">Código de invitación</span>
                    <div class="code-big mono">{{ p.invite_code }}</div>
                    <span class="small faint">Quien tenga el código entra como <b>integrante</b> desde «Unirme con código».</span>
                  </div>
                  <div class="col">
                    <button class="btn" (click)="copy(p.invite_code)"><app-icon name="copy" [size]="15" /> Copiar código</button>
                    @if (board.isOwner()) {
                      <button class="btn ghost sm" (click)="regenerate()"><app-icon name="refresh" [size]="14" /> Generar otro</button>
                    }
                  </div>
                </div>
              }

              <ul class="roles-help small">
                @for (r of roles; track r.value) {
                  <li><b>{{ r.label }}:</b> {{ r.help }}</li>
                }
              </ul>
              <div class="members">
                @for (m of board.members(); track m.user_id) {
                  <div class="member">
                    <app-avatar [avatar]="m.profile?.avatar" [name]="m.profile?.full_name || m.profile?.email" [size]="36" />
                    <div class="who">
                      <b>{{ m.profile?.full_name || 'Sin nombre' }}{{ m.user_id === me() ? ' (tú)' : '' }}</b>
                      <span class="small faint">{{ m.profile?.email }}</span>
                    </div>
                    @if (board.isOwner() && m.user_id !== me()) {
                      <select class="select sm role" [value]="m.role" (change)="setRole(m, $any($event.target).value)">
                        @for (r of roles; track r.value) {
                          <option [value]="r.value" [selected]="m.role === r.value">{{ r.label }}</option>
                        }
                      </select>
                      <button class="btn sm danger" (click)="removeMember(m)">Quitar</button>
                    } @else {
                      <span class="chip">{{ roleName(m.role) }}</span>
                    }
                  </div>
                }
              </div>
            }
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    .tabs {
      display: flex; gap: 2px; padding: 0 12px; border-bottom: 1px solid var(--border);
      button {
        height: 40px; padding: 0 12px; margin-bottom: -1px; border: 0; border-bottom: 2px solid transparent;
        background: transparent; color: var(--text-2); font: inherit; font-weight: 500; cursor: pointer;
        &:hover:not(.on) { color: var(--text); }
        &.on { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }
      }
    }
    .swatches { display: flex; gap: 6px; flex-wrap: wrap; }
    .swatch {
      width: 26px; height: 26px; border-radius: var(--radius-sm); border: 0; cursor: pointer;
      &.on { outline: 2px solid var(--text); outline-offset: 2px; }
    }
    .danger-zone {
      display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 8px;
      padding: 14px; border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent); border-radius: var(--radius);
      p { margin: 2px 0 0; }
    }
    .obj-list { display: flex; flex-direction: column; gap: 8px; }
    .obj-row { display: grid; grid-template-columns: 34px 90px 1fr auto auto; gap: 8px; align-items: center; }
    .code { text-transform: uppercase; font-weight: 600; font-family: var(--mono); }
    .invite {
      display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 16px;
      border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2);
      .col { display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
    }
    .code-big { margin: 2px 0; font-size: 26px; font-weight: 600; letter-spacing: 0.18em; color: var(--text); }
    .members { display: flex; flex-direction: column; }
    .member { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); }
    .obj-view {
      display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border);
      .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
    }
    .roles-help { margin: 4px 0 0; padding-left: 18px; color: var(--text-2); display: grid; gap: 2px; }
    .who { display: flex; flex-direction: column; flex: 1; min-width: 0; }
    .role { width: 136px; }
    @media (max-width: 640px) {
      .tabs { overflow-x: auto; padding: 0 10px; button { flex: none; white-space: nowrap; } }
      .obj-list { gap: 0; }
      .obj-row {
        grid-template-columns: 40px 78px minmax(0, 1fr); padding: 10px 0; border-bottom: 1px solid var(--border);
        > .btn:not(.danger) { grid-column: 1 / 3; }
        > .btn.danger { grid-column: 3; justify-self: end; }
      }
      .invite, .danger-zone { flex-direction: column; align-items: stretch; }
      .code-big { font-size: 24px; }
      .member { flex-wrap: wrap; row-gap: 8px; }
      .who { flex: 1 1 calc(100% - 50px); }
      .role { margin-left: 48px; flex: 1; width: auto; }
    }
  `,
})
export class SettingsDialog implements OnInit {
  protected readonly board = inject(BoardService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly initialTab = input<Tab>('general');
  readonly closed = output<void>();

  protected readonly tab = signal<Tab>('general');
  protected readonly busy = signal(false);
  protected readonly drafts = signal<ObjectiveDraft[]>([]);
  protected readonly palette = PALETTE;
  protected readonly roles = ROLES;
  protected readonly roleName = roleLabel;
  protected readonly me = () => this.auth.user()?.id;

  protected name = '';
  protected description = '';
  protected color = PALETTE[0];

  ngOnInit() {
    this.tab.set(this.initialTab());
    const p = this.board.project();
    if (p) {
      this.name = p.name;
      this.description = p.description;
      this.color = p.color;
    }
    this.drafts.set(this.board.objectives().map((o) => ({ ...o })));
    if (!this.drafts().length) this.addDraft();
  }

  @HostListener('document:keydown.escape')
  onEsc() {
    this.closed.emit();
  }

  private async run(fn: () => Promise<unknown>, ok?: string) {
    this.busy.set(true);
    try {
      await fn();
      if (ok) this.toast.show(ok);
      return true;
    } catch (e) {
      this.toast.error(friendlyError(e));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected saveGeneral() {
    return this.run(
      () => this.board.updateProject({ name: this.name.trim(), description: this.description.trim(), color: this.color }),
      'Proyecto actualizado',
    );
  }

  protected addDraft() {
    const used = new Set(this.drafts().map((d) => d.code.toUpperCase()));
    let n = this.drafts().length + 1;
    while (used.has(`OE${n}`)) n++;
    this.drafts.update((d) => [
      ...d,
      { code: `OE${n}`, name: '', color: PALETTE[d.length % PALETTE.length] },
    ]);
  }

  protected async saveObjective(o: ObjectiveDraft) {
    await this.run(async () => {
      await this.board.saveObjective(o);
      const saved = this.board.objectives().find((x) => x.code.toUpperCase() === o.code.trim().toUpperCase());
      if (saved) o.id = saved.id;
    }, 'Objetivo guardado');
  }

  protected async removeObjective(o: ObjectiveDraft, index: number) {
    if (o.id) {
      const used = this.board.tasks().filter((t) => t.objective_id === o.id).length;
      const msg = used
        ? `${used} actividades quedarán sin objetivo. ¿Eliminar ${o.code}?`
        : `¿Eliminar el objetivo ${o.code}?`;
      if (!confirm(msg)) return;
      const ok = await this.run(() => this.board.deleteObjective(o.id!), 'Objetivo eliminado');
      if (!ok) return;
    }
    this.drafts.update((d) => d.filter((_, i) => i !== index));
  }

  protected async copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      this.toast.show('Código copiado');
    } catch {
      this.toast.show(`Código: ${code}`, 'info');
    }
  }

  protected regenerate() {
    if (!confirm('El código actual dejará de funcionar. ¿Generar uno nuevo?')) return;
    return this.run(() => this.board.regenerateCode(), 'Nuevo código generado');
  }

  protected setRole(m: Member, role: Role) {
    return this.run(() => this.board.setRole(m.user_id, role), 'Rol actualizado');
  }

  protected removeMember(m: Member) {
    if (!confirm(`¿Quitar a ${m.profile?.full_name || 'este miembro'} del proyecto? Sus actividades quedarán sin responsable.`)) return;
    return this.run(() => this.board.removeMember(m.user_id), 'Miembro quitado');
  }

  protected async leave() {
    if (!confirm('¿Salir de este proyecto?')) return;
    if (await this.run(() => this.board.leave())) await this.router.navigateByUrl('/');
  }

  protected async deleteProject() {
    const p = this.board.project();
    if (!p) return;
    const typed = prompt(`Escribe el nombre del proyecto para confirmar:\n${p.name}`);
    if (typed?.trim() !== p.name) return;
    if (await this.run(() => this.board.deleteProject(), 'Proyecto eliminado')) {
      await this.router.navigateByUrl('/');
    }
  }

}

