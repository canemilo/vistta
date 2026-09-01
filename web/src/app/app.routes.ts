import type { Routes } from '@angular/router';

export const routes: Routes = [
  // El panel es la home: quien entra aquí es el profesional, no su cliente.
  { path: '', loadComponent: () => import('./panel/panel').then((m) => m.Panel) },
  // El viewer va aparte para que su bundle sea mínimo.
  { path: 'v/:token', loadComponent: () => import('./viewer/viewer').then((m) => m.Viewer) },
  { path: 'demo', loadComponent: () => import('./demo/demo').then((m) => m.Demo) },
  { path: '**', redirectTo: '' },
];
