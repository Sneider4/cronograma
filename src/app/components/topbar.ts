import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../core/auth.service';
import { Icon } from './icon';

/** Barra de navegacion comun. Las migas de pan llegan por <ng-content>. */
@Component({
  selector: 'app-topbar',
  imports: [RouterLink, Icon],
  template: `
    <header class="appnav">
      <a class="brand" routerLink="/" title="Mis proyectos">
        <svg class="mark" viewBox="0 0 20 20" aria-hidden="true">
          <rect width="20" height="20" rx="6" fill="currentColor" />
          <path d="M5 6.5h6M7.5 10h7M10 13.5h5" stroke="var(--surface)" stroke-width="2" stroke-linecap="round" />
        </svg>
        <span>Cronograma</span>
      </a>
      <nav class="crumbs" aria-label="Ruta"><ng-content /></nav>
      <div class="me">
        <div class="when">
          <small>Hoy</small>
          <span>{{ today }}</span>
        </div>
        <span class="avatar" [title]="auth.displayName()">{{ initials() }}</span>
        <span class="name">{{ auth.displayName() }}</span>
        <button class="nav-btn" (click)="signOut()" title="Cerrar sesión" aria-label="Cerrar sesión">
          <app-icon name="logout" [size]="15" /><span>Salir</span>
        </button>
      </div>
    </header>
  `,
})
export class Topbar {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly today = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(),
  );

  protected readonly initials = computed(() =>
    this.auth
      .displayName()
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join(''),
  );

  protected async signOut() {
    await this.auth.signOut();
    await this.router.navigateByUrl('/entrar');
  }
}
