import type { Routes } from '@angular/router';

export const routes: Routes = [
  /*
   * La portada pública es la home, y el panel se muda a /panel.
   *
   * Hasta ahora la home era la pantalla de entrada, lo que tenía sentido cuando
   * no había nada público que enseñar. Con una portada, dejar el login en la
   * raíz obligaría a quien llega por primera vez a mirar un formulario de una
   * cuenta que no tiene y que además no puede crearse.
   */
  { path: '', loadComponent: () => import('./landing/landing').then((m) => m.Landing) },
  { path: 'panel', loadComponent: () => import('./panel/panel').then((m) => m.Panel) },
  // El viewer va aparte para que su bundle sea mínimo.
  { path: 'v/:token', loadComponent: () => import('./viewer/viewer').then((m) => m.Viewer) },
  { path: 'demo', loadComponent: () => import('./demo/demo').then((m) => m.Demo) },
  // Aparte y perezosa: el renderizador de Markdown solo se descarga si alguien
  // entra aquí, y el bundle del viewer no se entera.
  { path: 'legal', loadComponent: () => import('./legal/legal').then((m) => m.Legal) },
  // Administración. La ruta no está enlazada desde ninguna parte y el guardia de
  // verdad está en el servidor: a una sesión sin rol admin la API le responde
  // 404 en todo /api/admin/*, así que esta pantalla no le sirve de nada.
  { path: 'admin', loadComponent: () => import('./admin/admin').then((m) => m.Admin) },
  { path: '**', redirectTo: '' },
];
