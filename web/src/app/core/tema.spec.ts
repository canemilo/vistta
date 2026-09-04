import { TestBed } from '@angular/core/testing';
import { TemaApp } from './tema';

/**
 * El interruptor del tema.
 *
 * Lo que se comprueba de verdad es que «sistema» sea la AUSENCIA del atributo,
 * y que una elección explícita gane en los DOS sentidos: quien tiene el sistema
 * en oscuro tiene que poder poner la aplicación en claro. Si el atributo se
 * pusiera solo para el oscuro, esa persona no podría deshacerlo.
 */
describe('TemaApp', () => {
  let tema: TemaApp;

  beforeEach(() => {
    localStorage.removeItem('vistta.tema');
    document.documentElement.removeAttribute('data-theme');
    TestBed.resetTestingModule();
    tema = TestBed.inject(TemaApp);
  });

  afterEach(() => {
    localStorage.removeItem('vistta.tema');
    document.documentElement.removeAttribute('data-theme');
  });

  it('empieza siguiendo al sistema, sin ensuciar el html', () => {
    expect(tema.tema()).toBe('sistema');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('elegir claro lo marca, para poder ganarle a un sistema en oscuro', () => {
    tema.poner('claro');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('elegir oscuro lo marca igual', () => {
    tema.poner('oscuro');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('volver a «sistema» quita el atributo: se deshace la elección', () => {
    tema.poner('oscuro');
    tema.poner('sistema');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('la elección sobrevive a recargar', () => {
    tema.poner('claro');
    TestBed.resetTestingModule();
    expect(TestBed.inject(TemaApp).tema()).toBe('claro');
  });

  it('el botón rota por los tres estados y vuelve al principio', () => {
    const visto = [tema.tema()];
    for (let i = 0; i < 3; i++) {
      tema.siguiente();
      visto.push(tema.tema());
    }
    expect(visto).toEqual(['sistema', 'claro', 'oscuro', 'sistema']);
  });
});
