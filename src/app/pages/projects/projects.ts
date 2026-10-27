import { NgTemplateOutlet } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { Icon } from '../../components/icon';
import { Topbar } from '../../components/topbar';
import { AuthService } from '../../core/auth.service';
import { diffDays, formatDate, todayISO } from '../../core/dates';
import { PALETTE, STATUSES } from '../../core/models';
import { loadPref, savePref } from '../../core/prefs';
import { AgendaItem, ProjectsService } from '../../core/projects.service';
import { friendlyError } from '../../core/supabase';
import { ToastService } from '../../core/toast.service';

function firstVisit(): boolean {
  try {
    if (sessionStorage.getItem('intro.home')) return false;
    sessionStorage.setItem('intro.home', '1');
  } catch {
    // Sin almacenamiento: se anima siempre.
  }
  return true;
}

type Layout = 'grid' | 'list';
type Sort = 'recent' | 'name' | 'progress' | 'due';

@Component({
  selector: 'app-projects',
  imports: [FormsModule, RouterLink, NgTemplateOutlet, Topbar, Icon],
  template: `
    <app-topbar><span class="current">Inicio</span></app-topbar>

    <main class="page">
      <!-- Saludo -->
      <section class="hero">
        <div class="intro">
          <span class="tag">Espacio de trabajo</span>
          <h1 [class.motion]="intro">
            <span class="rv"><span style="--i: 0">{{ greeting() }},</span></span>&ngsp;<span class="rv"><span style="--i: 1">{{ firstName() }}.</span></span>&ngsp;
            <span class="tone"><span class="rv"><span style="--i: 3">Esto</span></span>&ngsp;<span class="rv"><span style="--i: 4">es</span></span>&ngsp;<span class="rv"><span style="--i: 5">lo</span></span>&ngsp;<span class="rv"><span style="--i: 6">que</span></span>&ngsp;<span class="rv"><span style="--i: 7">viene.</span></span></span>
          </h1>
        </div>
        <div class="actions">
          <button class="btn" (click)="joinOpen.set(true)"><app-icon name="link" /> Unirme con código</button>
          <button class="btn primary" (click)="openCreate()">Nuevo proyecto <span class="btn-go"><app-icon name="plus" [size]="15" /></span></button>
        </div>
      </section>

      @if (svc.loading() && !svc.projects().length) {
        <p class="muted">Cargando…</p>
      } @else if (!svc.projects().length) {
        <div class="card empty">
          <span class="empty-icon"><app-icon name="folder" [size]="22" /></span>
          <h3>Aún no tienes proyectos</h3>
          <p>Crea uno para empezar tu cronograma, o únete al de tu equipo con el código que te compartieron.</p>
          <div class="actions">
            <button class="btn" (click)="joinOpen.set(true)"><app-icon name="link" /> Unirme con código</button>
            <button class="btn primary" (click)="openCreate()"><app-icon name="plus" /> Nuevo proyecto</button>
          </div>
        </div>
      } @else {
        @let t = svc.totals();

        <!-- Indicadores de todos los proyectos -->
        <section class="kpis">
          <div class="kpi"><span class="eyebrow">Proyectos</span><b class="num">{{ t.projects }}</b></div>
          <div class="kpi"><span class="eyebrow">Actividades</span><b class="num">{{ t.total }}</b><small>{{ t.done }} completadas</small></div>
          <div class="kpi"><span class="eyebrow">En proceso</span><b class="num">{{ t.inProgress }}</b><small>{{ t.pending }} pendientes</small></div>
          <div class="kpi"><span class="eyebrow">Vencidas</span><b class="num" [class.bad]="t.overdue">{{ t.overdue }}</b><small>{{ t.blocked }} bloqueadas</small></div>
          <div class="kpi dark">
            <span class="eyebrow">Avance global</span>
            <b class="num copper-text">{{ t.progress }}%</b>
            <div class="progress"><span [style.width.%]="t.progress"></span></div>
          </div>
        </section>

        <div class="main">
          <!-- Proyectos -->
          <section class="projects">
            <header class="sec-head">
              <h2>Proyectos <span class="count">{{ shown().length }}</span></h2>
              <div class="tools">
                <label class="input-icon search">
                  <app-icon name="search" [size]="15" />
                  <input class="input sm" type="search" placeholder="Buscar proyecto" [ngModel]="query()" (ngModelChange)="query.set($event)" />
                </label>
                <select class="select sm sort" [ngModel]="sort()" (ngModelChange)="setSort($event)" aria-label="Ordenar">
                  <option value="recent">Más recientes</option>
                  <option value="due">Próxima entrega</option>
                  <option value="progress">Menor avance</option>
                  <option value="name">Nombre (A–Z)</option>
                </select>
                <div class="seg" role="group" aria-label="Vista">
                  <button [class.on]="layout() === 'grid'" (click)="setLayout('grid')" title="Tarjetas"><app-icon name="kanban" [size]="14" /></button>
                  <button [class.on]="layout() === 'list'" (click)="setLayout('list')" title="Lista"><app-icon name="list" [size]="14" /></button>
                </div>
              </div>
            </header>

            @if (!shown().length) {
              <p class="muted none">Ningún proyecto coincide con «{{ query() }}».</p>
            } @else if (layout() === 'grid') {
              <div class="grid">
                @for (p of shown(); track p.id) {
                  @let pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
                  <a class="pcard" [routerLink]="['/p', p.id]">
                    <div class="pc-top">
                      <span class="chip"><span class="dot" [style.background]="p.color"></span>{{ p.members }} {{ p.members === 1 ? 'miembro' : 'miembros' }}</span>
                      @if (p.overdue) {
                        <span class="chip warn">{{ p.overdue }} vencida{{ p.overdue === 1 ? '' : 's' }}</span>
                      }
                      <span class="go"><app-icon name="chevron-right" [size]="16" /></span>
                    </div>
                    <h3>{{ p.name }}</h3>
                    <p class="desc">{{ p.description || 'Sin descripción' }}</p>

                    <div class="mini">
                      <div><b class="num">{{ p.total }}</b><span>Actividades</span></div>
                      <div><b class="num">{{ p.inProgress }}</b><span>En proceso</span></div>
                      <div><b class="num">{{ p.done }}</b><span>Completadas</span></div>
                    </div>

                    <div class="pct">
                      <div class="progress"><span [style.width.%]="pct"></span></div>
                      <span class="num">{{ pct }}%</span>
                    </div>

                    <div class="next">
                      @if (p.next; as n) {
                        <span class="faint">Próxima entrega</span>
                        <span class="nx"><span class="ellipsis">{{ n.name }}</span><b class="when">{{ rel(n.end_date) }}</b></span>
                      } @else if (p.total && p.done === p.total) {
                        <span class="faint">Todas las actividades están completadas</span>
                      } @else if (!p.total) {
                        <span class="faint">Aún no tiene actividades</span>
                      } @else {
                        <span class="faint">Sin entregas futuras pendientes</span>
                      }
                    </div>
                  </a>
                }
                <button class="pcard add" (click)="openCreate()">
                  <span class="plus"><app-icon name="plus" [size]="20" /></span>
                  <b>Nuevo proyecto</b>
                  <span class="faint small">Cronograma, objetivos y equipo propios</span>
                </button>
              </div>
            } @else {
              <div class="card table">
                <div class="thead">
                  <span class="eyebrow">Proyecto</span>
                  <span class="eyebrow hide-md">Próxima entrega</span>
                  <span class="eyebrow hide-sm">Actividades</span>
                  <span class="eyebrow">Avance</span>
                  <span></span>
                </div>
                @for (p of shown(); track p.id) {
                  @let pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
                  <a class="trow" [routerLink]="['/p', p.id]">
                    <div class="pname">
                      <span class="pmark" [style.background]="p.color"></span>
                      <div>
                        <b>{{ p.name }}</b>
                        @if (p.description) {
                          <span class="desc1">{{ p.description }}</span>
                        }
                      </div>
                    </div>
                    <span class="hide-md small muted ellipsis">{{ p.next ? p.next.name + ' · ' + rel(p.next.end_date) : '—' }}</span>
                    <span class="num muted hide-sm">{{ p.done }} de {{ p.total }}</span>
                    <div class="pct">
                      <div class="progress"><span [style.width.%]="pct"></span></div>
                      <span class="num small">{{ pct }}%</span>
                    </div>
                    <span class="go"><app-icon name="chevron-right" [size]="16" /></span>
                  </a>
                }
              </div>
            }
          </section>

          <!-- Lateral -->
          <aside class="side">
            @let a = svc.agenda();
            <section class="card panel agenda">
              <header class="panel-head">
                <h2>Agenda</h2>
                <span class="faint small">Próximas 3 semanas</span>
              </header>

              @if (!a.overdue.length && !a.thisWeek.length && !a.later.length) {
                <p class="muted small calm">Nada pendiente en las próximas tres semanas.</p>
              }
              @if (a.overdue.length) {
                <h4 class="group bad">Vencidas <span>{{ a.overdue.length }}</span></h4>
                @for (i of a.overdue.slice(0, 5); track i.task.id) {
                  <ng-container *ngTemplateOutlet="row; context: { $implicit: i }" />
                }
              }
              @if (a.thisWeek.length) {
                <h4 class="group">Esta semana <span>{{ a.thisWeek.length }}</span></h4>
                @for (i of a.thisWeek.slice(0, 6); track i.task.id) {
                  <ng-container *ngTemplateOutlet="row; context: { $implicit: i }" />
                }
              }
              @if (a.later.length) {
                <h4 class="group">Después <span>{{ a.later.length }}</span></h4>
                @for (i of a.later.slice(0, 5); track i.task.id) {
                  <ng-container *ngTemplateOutlet="row; context: { $implicit: i }" />
                }
              }
            </section>

            <section class="card panel status">
              <header class="panel-head">
                <h2>Estado general</h2>
                <span class="faint small num">{{ t.total }} actividades</span>
              </header>
              <div class="stack">
                @for (s of statusBreakdown(); track s.value) {
                  @if (s.count) {
                    <span [style.flex-grow]="s.count" [style.background]="s.color" [title]="s.label + ': ' + s.count"></span>
                  }
                }
                @if (!t.total) {
                  <span class="empty-bar"></span>
                }
              </div>
              <ul class="legend">
                @for (s of statusBreakdown(); track s.value) {
                  <li>
                    <i [style.background]="s.color"></i>{{ s.label }}
                    <b class="num">{{ s.count }}</b>
                    <span class="faint num">{{ t.total ? Math.round((s.count / t.total) * 100) : 0 }}%</span>
                  </li>
                }
              </ul>
            </section>
          </aside>
        </div>
      }
      <p class="credit">
        Cronograma · <a href="https://github.com/Sneider4" target="_blank" rel="noopener">por Richard Malagón</a>
      </p>
    </main>

    <ng-template #row let-i>
      <a class="arow" [routerLink]="['/p', i.project.id]">
        <span class="dot" [style.background]="i.project.color"></span>
        <span class="atext">
          <span class="aname">{{ i.task.name }}</span>
          <span class="aproj">{{ i.project.name }}{{ i.task.assignee ? ' · ' + i.task.assignee : '' }}</span>
        </span>
        <span class="when" [class.bad]="isLate(i)">{{ rel(i.task.end_date) }}</span>
      </a>
    </ng-template>

    @if (createOpen()) {
      <div class="backdrop" (click)="createOpen.set(false)">
        <form class="dialog" (click)="$event.stopPropagation()" (ngSubmit)="create()">
          <header>
            <h3>Nuevo proyecto</h3>
            <button type="button" class="btn ghost icon" (click)="createOpen.set(false)" aria-label="Cerrar"><app-icon name="x" /></button>
          </header>
          <div class="body">
            <div class="field">
              <label for="pname">Nombre *</label>
              <input id="pname" class="input" name="name" [(ngModel)]="name" maxlength="120" required autofocus />
            </div>
            <div class="field">
              <label for="pdesc">Descripción</label>
              <textarea id="pdesc" class="textarea" name="desc" [(ngModel)]="description"></textarea>
            </div>
            <div class="field">
              <span class="label">Color</span>
              <div class="swatches">
                @for (c of palette; track c) {
                  <button type="button" class="swatch" [style.background]="c" [class.on]="color === c" (click)="color = c" [attr.aria-label]="'Color ' + c"></button>
                }
              </div>
            </div>
          </div>
          <footer>
            <span class="spacer"></span>
            <button type="button" class="btn" (click)="createOpen.set(false)">Cancelar</button>
            <button type="submit" class="btn primary" [disabled]="busy() || !name.trim()">Crear proyecto</button>
          </footer>
        </form>
      </div>
    }

    @if (joinOpen()) {
      <div class="backdrop" (click)="joinOpen.set(false)">
        <form class="dialog narrow" (click)="$event.stopPropagation()" (ngSubmit)="join()">
          <header>
            <h3>Unirme a un proyecto</h3>
            <button type="button" class="btn ghost icon" (click)="joinOpen.set(false)" aria-label="Cerrar"><app-icon name="x" /></button>
          </header>
          <div class="body">
            <div class="field">
              <label for="code">Código de invitación</label>
              <input id="code" class="input mono code" name="code" [(ngModel)]="code" maxlength="6" placeholder="ABC234" autofocus />
              <span class="hint">Pídeselo al dueño del proyecto (botón «Invitar»).</span>
            </div>
          </div>
          <footer>
            <span class="spacer"></span>
            <button type="button" class="btn" (click)="joinOpen.set(false)">Cancelar</button>
            <button type="submit" class="btn primary" [disabled]="busy() || code.trim().length < 6">Unirme</button>
          </footer>
        </form>
      </div>
    }
  `,
  styles: `
    .page {
      display: flex; flex-direction: column; gap: 20px;
      max-width: 2000px; margin: 0 auto; padding: 32px clamp(16px, 3vw, 40px) 64px;
    }

    /* ---------- Saludo ---------- */
    .hero {
      display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 20px;
      padding-bottom: 6px;
    }
    .intro {
      display: flex; flex-direction: column; align-items: flex-start; gap: 14px;
      h1 { max-width: 900px; font-size: clamp(32px, 3.6vw, 56px); line-height: 1; letter-spacing: -0.055em; }
    }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }

    /* ---------- Indicadores ---------- */
    .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)) minmax(0, 1.4fr); gap: 10px; }
    .kpi {
      display: flex; flex-direction: column; gap: 6px; min-height: 118px; padding: 16px 20px;
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
      b { margin-top: auto; font-size: 42px; font-weight: 500; line-height: 1; letter-spacing: -0.055em; }
      small { font-size: 12.5px; color: var(--text-3); }
      .bad { color: var(--danger); }
      &.dark {
        background: var(--ink); border-color: var(--ink); color: #fff;
        .eyebrow { color: rgba(255, 255, 255, 0.6); }
        .progress { height: 6px; background: rgba(255, 255, 255, 0.15); }
      }
    }

    /* ---------- Cuerpo en dos columnas ---------- */
    .main { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 400px); gap: 20px; align-items: start; }

    .sec-head {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px;
      margin-bottom: 14px;
      h2 { display: flex; align-items: center; gap: 10px; font-size: 26px; }
    }
    .count {
      display: grid; place-items: center; min-width: 28px; height: 24px; padding: 0 8px; border-radius: 999px;
      background: var(--ink); color: #fff; font-size: 12px; font-weight: 600; letter-spacing: 0;
    }
    .tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .search { width: 230px; }
    .sort { width: auto; border-radius: 999px; padding: 0 14px; }
    .seg button { display: grid; place-items: center; padding: 0 12px; }
    .none { padding: 24px 0; }

    /* Tarjetas de proyecto */
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)); gap: 12px; }
    .pcard {
      display: flex; flex-direction: column; gap: 12px; min-height: 290px; padding: 18px 20px 20px;
      background: var(--surface); border: 1px solid var(--border); border-radius: 24px;
      color: inherit; text-decoration: none; font: inherit; text-align: left;
      transition: border-color 0.15s, transform 0.2s;
      &:hover { border-color: var(--text); .go { background: var(--ink); color: #fff; border-color: var(--ink); transform: rotate(-45deg); } }
      h3 { font-size: 24px; line-height: 1.05; letter-spacing: -0.045em; }
    }
    .pc-top { display: flex; align-items: center; gap: 6px; .go { margin-left: auto; } }
    .chip.warn { background: var(--danger-soft); color: var(--danger); }
    .desc {
      margin: -4px 0 0; font-size: 13px; color: var(--text-3);
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .mini {
      display: grid; grid-template-columns: repeat(3, 1fr); margin-top: auto;
      padding: 12px 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
      div { display: flex; flex-direction: column; }
      div + div { padding-left: 12px; border-left: 1px solid var(--border); }
      b { font-size: 22px; font-weight: 500; letter-spacing: -0.04em; line-height: 1.1; }
      span { font-size: 11.5px; color: var(--text-3); }
    }
    .pct {
      display: flex; align-items: center; gap: 12px;
      .progress { flex: 1; height: 6px; }
      .num { width: 38px; text-align: right; font-weight: 500; font-size: 13px; }
    }
    .next { display: flex; flex-direction: column; gap: 2px; font-size: 12.5px; }
    .nx { display: flex; align-items: center; gap: 8px; font-weight: 500; }
    .ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .when {
      flex: none; padding: 1px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--copper);
      font-size: 11.5px; font-weight: 600; white-space: nowrap;
      &.bad { background: var(--danger-soft); color: var(--danger); }
    }
    .go {
      display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; flex: none;
      border: 1px solid var(--border-strong); color: var(--text-2); transition: background 0.2s, color 0.2s, transform 0.2s;
    }
    .pcard.add {
      align-items: center; justify-content: center; gap: 8px; cursor: pointer;
      background: transparent; border: 1.5px dashed var(--border-strong);
      .plus { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 50%; background: var(--surface-3); }
      b { font-size: 17px; font-weight: 500; letter-spacing: -0.03em; }
      &:hover { border-color: var(--text); .plus { background: var(--copper-grad); color: #fff; } }
    }

    /* Lista */
    .table { overflow: hidden; padding: 6px; }
    .thead, .trow {
      display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) 120px 200px 34px; align-items: center; gap: 16px;
      padding: 0 16px;
    }
    .thead { height: 40px; }
    .trow {
      min-height: 68px; padding-top: 10px; padding-bottom: 10px; border-radius: 16px;
      color: inherit; text-decoration: none; transition: background 0.15s;
      & + .trow { box-shadow: 0 -1px 0 var(--border); }
      &:hover { background: var(--surface-2); box-shadow: none; .go { background: var(--ink); color: #fff; transform: rotate(-45deg); } }
      &:hover + .trow { box-shadow: none; }
    }
    .pname {
      display: flex; align-items: center; gap: 14px; min-width: 0;
      > div { display: flex; flex-direction: column; min-width: 0; }
      b { font-size: 17px; font-weight: 500; letter-spacing: -0.035em; }
      .desc1 { font-size: 12.5px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    }
    .pmark { flex: none; width: 12px; height: 12px; border-radius: 50%; }

    /* ---------- Lateral ---------- */
    .side { display: flex; flex-direction: column; gap: 12px; position: sticky; top: 76px; }
    .panel { padding: 18px 18px 14px; border-radius: 24px; }
    .panel-head {
      display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 6px;
      h2 { font-size: 22px; }
    }
    .calm { margin: 10px 0 4px; }
    .group {
      display: flex; align-items: center; gap: 8px; margin: 14px 0 4px;
      font-size: 12.5px; font-weight: 500; letter-spacing: 0; color: var(--text-2);
      span { color: var(--text-3); }
      &.bad { color: var(--danger); }
    }
    .arow {
      display: flex; align-items: center; gap: 10px; margin: 0 -8px; padding: 8px; border-radius: 12px;
      color: inherit; text-decoration: none;
      &:hover { background: var(--surface-2); }
      .dot { flex: none; width: 8px; height: 8px; border-radius: 50%; }
    }
    .atext { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .aname, .aproj { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .aname { font-size: 13.5px; font-weight: 500; }
    .aproj { font-size: 12px; color: var(--text-3); }

    .stack {
      display: flex; gap: 3px; height: 14px; margin: 12px 0 14px;
      span { min-width: 6px; border-radius: 999px; }
      .empty-bar { flex: 1; background: var(--surface-3); }
    }
    .legend {
      display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none;
      li { display: grid; grid-template-columns: 10px 1fr auto 42px; align-items: center; gap: 10px; font-size: 13px; }
      i { width: 10px; height: 10px; border-radius: 50%; }
      b { font-weight: 600; }
      .faint { text-align: right; font-size: 12px; }
    }

    /* Credito discreto al final */
    .credit {
      margin: 12px 0 0; text-align: center; font-size: 11.5px; color: var(--text-3); opacity: 0.8;
      a { color: inherit; text-decoration: none; transition: color 0.15s; &:hover { color: var(--text-2); } }
    }

    /* ---------- Dialogos ---------- */
    .swatches { display: flex; gap: 8px; flex-wrap: wrap; }
    .swatch {
      width: 30px; height: 30px; border-radius: 50%; border: 0; cursor: pointer;
      &.on { outline: 2px solid var(--text); outline-offset: 3px; }
    }
    .narrow { max-width: 440px; }
    .code { text-transform: uppercase; letter-spacing: 0.25em; font-size: 20px; height: 52px; text-align: center; border-radius: 16px; }

    /* ---------- Responsive ---------- */
    @media (max-width: 1200px) {
      .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .kpi.dark { grid-column: span 2; }
    }
    @media (max-width: 1080px) {
      .main { grid-template-columns: 1fr; }
      .side { position: static; display: grid; grid-template-columns: 1fr 1fr; }
      .hide-md { display: none; }
      .thead, .trow { grid-template-columns: minmax(0, 1fr) 120px 180px 34px; }
    }
    @media (max-width: 720px) {
      .side { grid-template-columns: 1fr; }
      .tools { width: 100%; }
      .search { flex: 1 1 100%; width: auto; }
      .sort { flex: 1; }
    }

    /* Movil: KPIs compactos y la agenda justo despues de los indicadores */
    @media (max-width: 640px) {
      .page { gap: 16px; padding: 20px 14px 40px; }
      .hero { gap: 14px; }
      .intro { gap: 10px; h1 { font-size: 32px; } }
      .actions { width: 100%; }
      .actions .btn { flex: 1; height: 44px; }

      .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
      .kpi {
        min-height: 0; gap: 2px; padding: 10px 10px 12px; border-radius: 16px;
        .eyebrow { font-size: 11px; }
        b { font-size: 26px; }
        small { display: none; }
        &.dark {
          grid-column: 1 / -1; order: -1; flex-direction: row; flex-wrap: wrap; align-items: center;
          column-gap: 12px; padding: 14px 16px;
          b { margin: 0; order: 2; font-size: 30px; }
          .eyebrow { order: 1; flex: 1; }
          .progress { order: 3; flex: 1 1 100%; margin-top: 8px; }
        }
      }

      .main { display: flex; flex-direction: column; align-items: stretch; gap: 16px; }
      .side { display: contents; }
      .agenda { order: 1; }
      .projects { order: 2; }
      .status { order: 3; }
      .agenda, .projects, .status { min-width: 0; }

      .sec-head h2 { font-size: 22px; }
      .pcard { min-height: 0; padding: 16px; border-radius: 20px; h3 { font-size: 21px; } }
      .pcard.add { flex-direction: row; justify-content: flex-start; padding: 14px 16px; gap: 12px;
        .plus { width: 40px; height: 40px; } .faint { display: none; } }
      .panel { padding: 16px 14px 10px; border-radius: 20px; }
      .arow { padding: 10px 8px; }

      .hide-sm { display: none; }
      .thead, .trow { grid-template-columns: minmax(0, 1fr) 96px 30px; gap: 10px; padding: 0 10px; }
    }
  `,
})
export class ProjectsPage implements OnInit {
  protected readonly svc = inject(ProjectsService);
  private readonly auth = inject(AuthService);
  protected readonly Math = Math;
  private readonly router = inject(Router);
  /** El saludo entra por palabras solo la primera vez por sesion. */
  protected readonly intro = firstVisit();
  private readonly toast = inject(ToastService);

  protected readonly palette = PALETTE;
  protected readonly createOpen = signal(false);
  protected readonly joinOpen = signal(false);
  protected readonly busy = signal(false);

  protected readonly query = signal('');
  protected readonly layout = signal<Layout>(loadPref('home.layout', 'grid') as Layout);
  protected readonly sort = signal<Sort>(loadPref('home.sort', 'recent') as Sort);

  protected name = '';
  protected description = '';
  protected color = PALETTE[0];
  protected code = '';

  protected readonly firstName = computed(() => {
    const n = this.auth.displayName();
    return (n.includes('@') ? n.split('@')[0] : n.split(/\s+/)[0]) || 'equipo';
  });

  protected readonly greeting = computed(() => {
    const h = new Date().getHours();
    return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  });

  /** Proyectos filtrados por la busqueda y ordenados segun la preferencia. */
  protected readonly shown = computed(() => {
    const q = this.query().trim().toLowerCase();
    const list = this.svc
      .projects()
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
    const pct = (p: { done: number; total: number }) => (p.total ? p.done / p.total : 1);
    switch (this.sort()) {
      case 'name':
        return [...list].sort((a, b) => a.name.localeCompare(b.name, 'es'));
      case 'progress':
        return [...list].sort((a, b) => pct(a) - pct(b));
      case 'due':
        return [...list].sort((a, b) => (a.next?.end_date ?? '9999').localeCompare(b.next?.end_date ?? '9999'));
      default:
        return list;
    }
  });

  protected readonly statusBreakdown = computed(() => {
    const t = this.svc.totals();
    const counts: Record<string, number> = {
      pendiente: t.pending,
      en_proceso: t.inProgress,
      bloqueada: t.blocked,
      completada: t.done,
    };
    return STATUSES.map((s) => ({ ...s, count: counts[s.value] }));
  });

  ngOnInit() {
    this.svc.load().catch((e) => this.toast.error(friendlyError(e)));
  }

  protected setLayout(l: Layout) {
    this.layout.set(l);
    savePref('home.layout', l);
  }

  protected setSort(s: Sort) {
    this.sort.set(s);
    savePref('home.sort', s);
  }

  /** "Hoy", "Mañana", "En 5 d", "Hace 2 d" o la fecha si es lejana. */
  protected rel(iso: string) {
    const d = diffDays(todayISO(), iso);
    if (d === 0) return 'Hoy';
    if (d === 1) return 'Mañana';
    if (d === -1) return 'Ayer';
    if (d < 0) return `Hace ${-d} d`;
    if (d <= 14) return `En ${d} d`;
    return formatDate(iso, false);
  }

  protected isLate(i: AgendaItem) {
    return i.task.end_date < todayISO();
  }

  openCreate() {
    this.name = '';
    this.description = '';
    this.color = PALETTE[this.svc.projects().length % PALETTE.length];
    this.createOpen.set(true);
  }

  async create() {
    if (!this.name.trim()) return;
    this.busy.set(true);
    try {
      const id = await this.svc.create(this.name.trim(), this.description.trim(), this.color);
      await this.router.navigate(['/p', id]);
    } catch (e) {
      this.toast.error(friendlyError(e));
    } finally {
      this.busy.set(false);
    }
  }

  async join() {
    this.busy.set(true);
    try {
      const id = await this.svc.join(this.code);
      await this.router.navigate(['/p', id]);
    } catch (e) {
      this.toast.error(friendlyError(e));
    } finally {
      this.busy.set(false);
    }
  }
}
