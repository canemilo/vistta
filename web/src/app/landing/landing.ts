import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api, type CatalogoPublico } from '../core/api';
import { Marca } from '../core/marca';
import { haySesion } from '../core/sesion';

/**
 * La página pública.
 *
 * Dos cosas la separan de una landing cualquiera, y las dos vienen del producto:
 *
 *  1. NO hay alta pública. Las cuentas las crea un administrador, así que aquí
 *     no puede haber un «regístrate»: sería un botón que no lleva a ninguna
 *     parte. La llamada a la acción es ver la demostración y escribir.
 *  2. Las cifras de los planes NO se escriben aquí. Salen de `GET /api/planes`,
 *     que las lee de `planes.ts`, porque en este proyecto ningún número de plan
 *     vive fuera de ese archivo. Si la página los llevara a mano, el día que
 *     cambie la oferta seguiría anunciando la vieja.
 *
 * Y una regla de tono: aquí no se promete nada que el sistema no haga. Hay una
 * sección entera dedicada a lo que Vistta NO impide, y no es humildad: vender
 * que se evita una captura de pantalla sería mentir, y este producto se sostiene
 * justo sobre lo contrario.
 */
@Component({
  selector: 'app-landing',
  imports: [RouterLink, Marca],
  templateUrl: './landing.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  /* Oscura por defecto, como los textos legales: es el aspecto de la casa y
     quien llega aquí no ha elegido nada todavía. Si eligió, manda lo suyo. */
  host: { class: 'paleta-oscura block' },
})
export class Landing {
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  protected readonly catalogo = signal<CatalogoPublico | null>(null);
  protected readonly contacto = signal<string | null>(null);

  constructor() {
    /*
     * Con sesión abierta, esta página no pinta nada: es la puerta de la calle y
     * quien la ve ya está dentro. Se le manda a lo suyo en el acto —antes
     * incluso de pedir el catálogo—, porque enseñarle un «Entrar» a alguien que
     * ya entró es enseñarle que se ha salido sin querer.
     *
     * Se mira solo la PRESENCIA del testigo: si estuviera caducado, en /panel
     * se encontrará la pantalla de entrada, que es lo correcto.
     */
    if (haySesion()) {
      void this.router.navigate(['/panel']);
      return;
    }
    void this.cargar();
  }

  private async cargar(): Promise<void> {
    // Si algo de esto falla, la página se ve igual: son datos que enriquecen,
    // no el contenido. Una portada que se cae porque no responde una consulta
    // de precios es peor portada.
    this.catalogo.set(await this.api.planes().catch(() => null));
    this.contacto.set(
      await this.api
        .legal()
        .then((l) => l.contacto)
        .catch(() => null),
    );
  }

  /** 1200 céntimos → «12 €». Sin decimales cuando no los hay. */
  protected precio(centimos: number): string {
    return centimos % 100 === 0
      ? `${centimos / 100} €`
      : `${(centimos / 100).toFixed(2).replace('.', ',')} €`;
  }

  protected enMegas(bytes: number): string {
    return bytes >= 1024 * 1024 * 1024
      ? `${Math.round(bytes / 1024 / 1024 / 1024)} GB`
      : `${Math.round(bytes / 1024 / 1024)} MB`;
  }

  /** «7 días», «15 días», o la ausencia de plazo dicha con palabras. */
  protected retencion(ms: number | null): string {
    return ms === null ? 'no caduca' : `${Math.round(ms / 86_400_000)} días`;
  }

  /** Los cuatro pasos, en el orden en que ocurren de verdad. */
  protected readonly pasos = [
    {
      n: '01',
      titulo: 'Montas el perfil',
      texto:
        'Fotos, texto y documentos. Lo ordenas por bloques y la rejilla respeta la proporción real de cada imagen: nada se recorta.',
    },
    {
      n: '02',
      titulo: 'Generas el enlace',
      texto:
        'En ese momento se congela una instantánea: el pase enseñará eso, aunque después cambies el perfil.',
    },
    {
      n: '03',
      titulo: 'Lo envías tú',
      texto:
        'Por WhatsApp, por correo, por donde quieras. Vistta no lo manda, y por eso no sabe a quién se lo has mandado.',
    },
    {
      n: '04',
      titulo: 'Se abre y se cierra',
      texto:
        'Tu cliente lo abre y lo ve. Al cerrarlo, el enlace ya no vale: recargar no enseña nada.',
    },
  ];

  protected readonly promesas = [
    'El enlace se abre las veces que digas y ni una más. Está resuelto en una sola operación de base de datos, y hay pruebas que lanzan ráfagas de dieciséis peticiones simultáneas para demostrarlo.',
    'Las fotos salen con la marca de agua incrustada en los píxeles, distinta en cada visita. No es una capa encima: guardar la imagen guarda la marca.',
    'Puedes escribir a quién se lo enseñas, y esa referencia va dentro de la propia imagen.',
    'Los archivos solo se sirven por una URL firmada que caduca en minutos, y solo si ese pase concreto tenía derecho a ese archivo.',
    'Nada de esto se indexa. Un buscador que abriera un pase se lo gastaría.',
  ];

  protected readonly noPromesas = [
    'No impide una captura de pantalla. Ni una foto a la pantalla con otro móvil. Nadie puede impedirlo, y quien te diga lo contrario te está vendiendo humo.',
    'No bloquea el clic derecho como si eso fuera seguridad.',
    'No sabe quién abre un enlace: del navegador que lo abre no llega ni identidad, ni IP, ni huella del dispositivo.',
    'No es un disco duro. El contenido caduca según tu plan, y eso es una decisión de diseño, no una limitación.',
  ];

  protected readonly modos = [
    {
      nombre: 'Un solo uso',
      texto:
        'Se abre una vez. Es lo que viene elegido y lo único que este producto promete de verdad.',
    },
    {
      nombre: 'Varios accesos',
      texto:
        'Se abre el número de veces que elijas y muere al llegar. Para cuando sabes que van a volver.',
    },
    {
      nombre: 'Ventana',
      texto:
        'Válido un plazo que empieza a contar cuando lo abren por primera vez, no cuando lo creas.',
    },
  ];

  protected limite(n: number | null): string {
    return n === null ? 'sin límite' : String(n);
  }
}
