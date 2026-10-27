import { Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/guards';

export const routes: Routes = [
  {
    path: 'entrar',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login/login').then((m) => m.LoginPage),
  },
  {
    // Sin guard: llega con la sesion temporal del enlace de recuperacion (o con un enlace vencido).
    path: 'restablecer',
    loadComponent: () => import('./pages/reset/reset').then((m) => m.ResetPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/projects/projects').then((m) => m.ProjectsPage),
  },
  {
    path: 'p/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/project/project').then((m) => m.ProjectPage),
  },
  { path: '**', redirectTo: '' },
];
