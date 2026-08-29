import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./demo/demo').then((m) => m.Demo) },
  { path: 'panel', loadComponent: () => import('./panel/panel').then((m) => m.Panel) },
  // El viewer va aparte para que su bundle sea mínimo.
  { path: 'v/:token', loadComponent: () => import('./viewer/viewer').then((m) => m.Viewer) },
  { path: '**', redirectTo: '' },
];
