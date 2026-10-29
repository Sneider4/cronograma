import { Component, HostListener, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../core/auth.service';
import { Avatar } from './avatar';
import { Icon } from './icon';
import { ProfileDialog } from './profile-dialog';

/** Barra de navegacion comun. Las migas de pan llegan por <ng-content>. */
@Component({
  selector: 'app-topbar',
  imports: [RouterLink, Icon, Avatar, ProfileDialog],
  template: `
    <header class="appnav">
      <a class="brand" routerLink="/" title="Mis proyectos">
        <svg class="mark" viewBox="0 0 20 20" aria-hidden="true">
          <rect width="20" height="20" rx="6" fill="currentColor" />
          <path class="redraw" pathLength="1" d="M5 6.5h6M7.5 10h7M10 13.5h5" stroke="var(--surface)" stroke-width="2" stroke-linecap="round" />
        </svg>
        <span>Cronograma</span>
      </a>
      <nav class="crumbs" aria-label="Ruta"><ng-content /></nav>
      <div class="me">
        <div class="when">
          <small>Hoy</small>
          <span>{{ today }}</span>
        </div>
        <div class="me-anchor">
          <button class="me-btn" (click)="toggle($event)" [attr.aria-expanded]="menu()" aria-haspopup="menu"
                  title="Mi cuenta">
            <span class="name">{{ auth.displayName() }}</span>
            <app-avatar [avatar]="auth.avatar()" [name]="auth.displayName()" [size]="32" />
          </button>
          @if (menu()) {
            <div class="menu account" role="menu" (click)="$event.stopPropagation()">
              <div class="account-head">
                <app-avatar [avatar]="auth.avatar()" [name]="auth.displayName()" [size]="40" />
                <span><b>{{ auth.displayName() }}</b><small>{{ auth.user()?.email }}</small></span>
              </div>
              <hr />
              <button role="menuitem" (click)="openProfile()">
                <app-icon name="user" />
                <span>Mi perfil<small>Avatar, nombre y contraseña</small></span>
              </button>
              <button role="menuitem" (click)="signOut()">
                <app-icon name="logout" />
                <span>Cerrar sesión</span>
              </button>
            </div>
          }
        </div>
      </div>
    </header>
    @if (profile()) {
      <app-profile-dialog (closed)="profile.set(false)" />
    }
  `,
  styles: `
    .me-anchor { position: relative; }
    .me-btn {
      display: flex; align-items: center; gap: 10px; padding: 2px; border: 0; border-radius: 999px;
      background: none; color: inherit; font: inherit; cursor: pointer;
      &:hover app-avatar, &[aria-expanded='true'] app-avatar { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--text); }
    }
    .account { right: 0; top: calc(100% + 8px); }
    .account-head {
      display: flex; align-items: center; gap: 12px; padding: 8px 10px 6px;
      span { display: flex; flex-direction: column; min-width: 0; }
      b { font-size: 14px; letter-spacing: -0.02em; }
      small { font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; }
    }
    /* La barra tiene desenfoque (crea su propio contexto para lo fijo): en movil
       el menu queda anclado al avatar en vez de ir abajo como los demas. */
    @media (max-width: 640px) {
      .menu.account {
        position: absolute !important; left: auto !important; right: 0 !important;
        top: calc(100% + 8px) !important; bottom: auto; width: min(300px, calc(100vw - 24px));
      }
    }
  `,
})
export class Topbar {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly menu = signal(false);
  protected readonly profile = signal(false);

  protected readonly today = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(),
  );

  @HostListener('document:click')
  protected close() {
    this.menu.set(false);
  }

  protected toggle(ev: Event) {
    ev.stopPropagation();
    this.menu.update((v) => !v);
  }

  protected openProfile() {
    this.menu.set(false);
    this.profile.set(true);
  }

  protected async signOut() {
    this.menu.set(false);
    await this.auth.signOut();
    await this.router.navigateByUrl('/entrar');
  }
}
