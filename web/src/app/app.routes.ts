import type { Routes } from '@angular/router';

export const routes: Routes = [
  // El panel es la home: quien entra aquí es el profesional, no su cliente.
  { path: '', loadComponent: () => import('./panel/panel').then((m) => m.Panel) },
  // El viewer va aparte para que su bundle sea mínimo.
  { path: 'v/:token', loadComponent: () => import('./viewer/viewer').then((m) => m.Viewer) },
  { path: 'demo', loadComponent: () => import('./demo/demo').then((m) => m.Demo) },
  // Administración. La ruta no está enlazada desde ninguna parte y el guardia de
  // verdad está en el servidor: a una sesión sin rol admin la API le responde
  // 404 en todo /api/admin/*, así que esta pantalla no le sirve de nada.
  { path: 'admin', loadComponent: () => import('./admin/admin').then((m) => m.Admin) },
  { path: '**', redirectTo: '' },
];
