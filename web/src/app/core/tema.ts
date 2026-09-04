import { Injectable, signal } from '@angular/core';

export type Tema = 'sistema' | 'claro' | 'oscuro';

const CLAVE = 'vistta.tema';

/**
 * El tema de la aplicación: sistema, claro u oscuro.
 *
 * Son TRES estados y no dos, y la diferencia importa. Con dos, quien tiene el
 * sistema en oscuro y elige claro deja de seguir al sistema para siempre,
 * aunque luego lo cambie. Con «sistema» de vuelta, se puede deshacer la
 * elección, que es lo que la gente espera de un ajuste de aspecto.
 *
 * Se guarda en `localStorage` y no en el servidor a propósito: es una
 * preferencia del dispositivo, no de la cuenta. Alguien puede querer el panel
 * en claro en el portátil y en oscuro en el móvil.
 *
 * OJO: esto NO decide el tema del pase que se envía a un cliente. Ese viaja en
 * el propio pase (`passes.tema`) porque lo elige quien lo manda, y quien lo
 * abre no tiene por qué compartir su gusto.
 */
@Injectable({ providedIn: 'root' })
export class TemaApp {
  readonly tema = signal<Tema>(leer());

  constructor() {
    // Se aplica YA, no dentro de un `effect`. Con el efecto, el atributo no se
    // ponía hasta que Angular refrescaba, y eso es un parpadeo del tema
    // equivocado en la primera pintada. Lo destapó la prueba, no el ojo.
    aplicar(this.tema());
  }

  poner(t: Tema): void {
    this.tema.set(t);
    aplicar(t);
    try {
      if (t === 'sistema') localStorage.removeItem(CLAVE);
      else localStorage.setItem(CLAVE, t);
    } catch {
      // Modo privado o almacenamiento lleno: el tema vale para esta sesión y ya.
    }
  }

  /** Rota sistema → claro → oscuro → sistema. */
  siguiente(): void {
    const orden: Tema[] = ['sistema', 'claro', 'oscuro'];
    this.poner(orden[(orden.indexOf(this.tema()) + 1) % orden.length]);
  }
}

function leer(): Tema {
  try {
    const v = localStorage.getItem(CLAVE);
    return v === 'claro' || v === 'oscuro' ? v : 'sistema';
  } catch {
    return 'sistema';
  }
}

/**
 * «sistema» es la AUSENCIA del atributo, no un valor suyo.
 *
 * Así el CSS no tiene que saber nada de esto: sin atributo manda la consulta
 * `prefers-color-scheme`, y con atributo manda el atributo. Poner
 * `data-theme="sistema"` habría obligado a una tercera rama en la hoja.
 */
function aplicar(t: Tema): void {
  const raiz = document.documentElement;
  if (t === 'sistema') raiz.removeAttribute('data-theme');
  else raiz.setAttribute('data-theme', t === 'claro' ? 'light' : 'dark');
}
