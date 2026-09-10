import type { ApplicationConfig } from '@angular/core';
import { provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    /*
     * `anchorScrolling` va encendido porque hay enlaces con ancla entre rutas
     * —el «Avisar de un contenido» del pie apunta a `/legal#avisar`— y sin esto
     * Angular cambia de ruta y deja al lector arriba del todo, mirando otra
     * cosa. La restauración de posición ya estaba.
     */
    provideRouter(
      routes,
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
    ),
    provideHttpClient(withFetch()),
  ],
};
