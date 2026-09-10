import type { ProfileContent } from '../core/api';

/**
 * Plantillas de partida: algo ya montado que modificar.
 *
 * El problema que resuelven no es de funciones que falten, es de PRIMERA
 * PANTALLA. Quien crea un perfil se encuentra un lienzo vacío y tiene que
 * decidir a la vez qué apartados hacer, en qué orden, qué escribir y cómo
 * enseñar las fotos. Son cuatro decisiones a la vez y ninguna tiene una
 * respuesta evidente, así que la primera —empezar— se pospone.
 *
 * Una plantilla es SOLO contenido inicial: un `ProfileData` prerrellenado. No
 * hay tipo nuevo, ni columna, ni nada que se guarde en la base diciendo «este
 * perfil vino de la plantilla X». En cuanto se crea el perfil, la plantilla ha
 * terminado su trabajo y lo que queda es contenido corriente que se edita como
 * cualquier otro. Por eso tampoco existe «cambiar de plantilla» después:
 * machacaría lo que el cliente ya haya escrito.
 *
 * Y por eso viven en el FRONTEND. Si estuvieran en el servidor haría falta una
 * ruta, un versionado y una respuesta a «¿qué pasa con los perfiles creados con
 * la versión vieja?»; aquí la respuesta es que no pasa nada, porque el perfil
 * no se acuerda de dónde salió.
 *
 * Los textos de ejemplo son INSTRUCCIONES, no prosa de relleno («Describe aquí
 * …», no «Lorem ipsum» ni un párrafo verosímil sobre un piso). Dos razones: se
 * ve de un vistazo qué falta por escribir, y si alguien manda el dosier sin
 * tocarlos, lo que recibe el cliente delata el descuido en vez de disimularlo.
 * Sobre eso se apoya el aviso de `hayTextoDeEjemplo`.
 */
export interface Plantilla {
  id: string;
  nombre: string;
  /** Una línea de para qué sirve. Es lo que hace elegir, más que el nombre. */
  para: string;
  contenido: ProfileContent;
}

/**
 * El texto que se deja escrito en cada hueco.
 *
 * Se nombran para poder compararlos después: el aviso de «vas a mandar esto con
 * el relleno puesto» no busca una marca escondida dentro del texto, compara con
 * estas cadenas exactas. Una marca invisible acabaría enseñándose por error en
 * el documento del cliente, y una marca visible («⟨ejemplo⟩») ensucia justo la
 * pantalla que tiene que dar confianza.
 *
 * La comparación es exacta a propósito: en cuanto el cliente escribe una letra
 * encima, deja de coincidir y el aviso desaparece solo. No hay que acordarse de
 * apagarlo.
 */
export const EJEMPLOS = {
  intro: 'Describe aquí, en dos o tres frases, qué es esto y para quién.',
  caracteristicas:
    'Describe aquí las características: superficie, distribución, año, estado. Una por línea.',
  condiciones: 'Describe aquí las condiciones: precio, plazos, qué incluye y qué no.',
  alcance: 'Describe aquí qué trabajo se va a hacer, con qué entregas y en cuánto tiempo.',
  sobreMi: 'Describe aquí quién eres y qué haces. Tres frases bastan.',
  proyecto: 'Describe aquí el proyecto: qué se pedía, qué hiciste y cómo quedó.',
  catalogo: 'Describe aquí la colección: qué es, de cuándo y cómo se pide.',
  planos: 'Describe aquí lo que se ve en los planos, si hace falta aclararlo.',
} as const;

/** Todos los textos de ejemplo, para reconocerlos después sin escribirlos dos veces. */
const TEXTOS_DE_EJEMPLO: ReadonlySet<string> = new Set(Object.values(EJEMPLOS));

/**
 * Las plantillas, por CASO DE USO y no por sector.
 *
 * «Dosier de propiedad» y «Portfolio» no son dos sectores: son dos formas
 * distintas de enseñar, y un fotógrafo puede querer la primera. Nombrarlas por
 * sector —«Inmobiliaria», «Arquitectura»— haría que quien no se ve en ninguno
 * eligiera «Desde cero», que es exactamente lo que hay que evitar.
 *
 * «Desde cero» va SIEMPRE, y va la última: es la opción de siempre y sigue
 * estando, pero deja de ser la única y deja de ser la primera.
 */
export const PLANTILLAS: readonly Plantilla[] = [
  {
    id: 'propiedad',
    nombre: 'Dosier de propiedad',
    para: 'Enseñar un inmueble a un cliente concreto: fotos, características, planos y condiciones.',
    contenido: {
      intro: EJEMPLOS.intro,
      sections: [
        { type: 'galeria', title: 'Fotos', items: [], display: 'cuadricula' },
        { type: 'texto', title: 'Características', body: EJEMPLOS.caracteristicas },
        { type: 'galeria', title: 'Planos', items: [], display: 'cuadricula' },
        { type: 'texto', title: 'Condiciones', body: EJEMPLOS.condiciones },
      ],
    },
  },
  {
    id: 'portfolio',
    nombre: 'Portfolio',
    para: 'Enseñar dos o tres trabajos con su explicación, y quién hay detrás.',
    contenido: {
      intro: EJEMPLOS.intro,
      sections: [
        {
          type: 'proyecto',
          title: 'Primer proyecto',
          body: EJEMPLOS.proyecto,
          items: [],
          display: 'cuadricula',
        },
        {
          type: 'proyecto',
          title: 'Segundo proyecto',
          body: EJEMPLOS.proyecto,
          items: [],
          display: 'cuadricula',
        },
        { type: 'texto', title: 'Sobre mí', body: EJEMPLOS.sobreMi },
      ],
    },
  },
  {
    id: 'propuesta',
    nombre: 'Presupuesto o propuesta',
    para: 'Proponer un trabajo: qué se hace, qué se ha hecho antes y en qué condiciones.',
    contenido: {
      intro: EJEMPLOS.intro,
      sections: [
        { type: 'texto', title: 'Alcance', body: EJEMPLOS.alcance },
        { type: 'galeria', title: 'Trabajos previos', items: [], display: 'cuadricula' },
        { type: 'texto', title: 'Condiciones', body: EJEMPLOS.condiciones },
      ],
    },
  },
  {
    id: 'catalogo',
    nombre: 'Catálogo',
    para: 'Muchas piezas seguidas, para pasarlas de una en una.',
    contenido: {
      intro: EJEMPLOS.intro,
      sections: [
        // En carrusel: un catálogo se recorre pieza a pieza, y la cuadrícula
        // recorta. Es la plantilla que enseña que la presentación se elige.
        { type: 'galeria', title: 'Piezas', items: [], display: 'carrusel' },
        { type: 'texto', title: 'Cómo se pide', body: EJEMPLOS.catalogo },
      ],
    },
  },
  {
    id: 'vacio',
    nombre: 'Desde cero',
    para: 'Un perfil vacío, para montarlo a tu manera.',
    contenido: { sections: [] },
  },
];

/** La de «Desde cero», que es también la que se usa si un id no existe. */
export const PLANTILLA_VACIA = PLANTILLAS[PLANTILLAS.length - 1];

export function plantillaPorId(id: string): Plantilla {
  return PLANTILLAS.find((p) => p.id === id) ?? PLANTILLA_VACIA;
}

/**
 * Una copia PROFUNDA del contenido de una plantilla.
 *
 * Profunda y no `{ ...plantilla.contenido }`: las secciones son objetos, y con
 * una copia superficial el editor estaría escribiendo dentro de la constante.
 * El segundo perfil creado en la misma sesión heredaría lo que el cliente
 * escribió en el primero, y la plantilla se quedaría contaminada hasta recargar
 * la página. Es de los fallos que no se ven hasta que ya han pasado.
 */
export function contenidoDe(plantilla: Plantilla): ProfileContent {
  return structuredClone(plantilla.contenido) as ProfileContent;
}

/**
 * ¿Queda algún texto de ejemplo sin tocar?
 *
 * Se mira SOLO la prosa —la entradilla y los cuerpos—, nunca los títulos.
 * «Características» o «Condiciones» son títulos que el cliente tiene todo el
 * derecho a dejar tal cual: son correctos. Avisar por ellos sería avisar
 * siempre, y un aviso que sale siempre no se lee ninguna vez.
 */
export function hayTextoDeEjemplo(contenido: ProfileContent): boolean {
  if (contenido.intro && TEXTOS_DE_EJEMPLO.has(contenido.intro.trim())) return true;
  if (contenido.tagline && TEXTOS_DE_EJEMPLO.has(contenido.tagline.trim())) return true;
  return contenido.sections.some(
    (s) => 'body' in s && s.body !== undefined && TEXTOS_DE_EJEMPLO.has(s.body.trim()),
  );
}

/**
 * La miniatura de la estructura: qué bloques trae y en qué orden.
 *
 * Es una lista de tipos, no un render. Un render completo de la plantilla sería
 * mentira —no tiene fotos— y además obligaría a montar el viewer dentro del
 * selector para elegir algo que se cambia en treinta segundos.
 */
export function estructuraDe(plantilla: Plantilla): readonly string[] {
  return plantilla.contenido.sections.map((s) => s.type);
}
