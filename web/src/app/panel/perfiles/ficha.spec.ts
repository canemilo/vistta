import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Api } from '../../core/api';
import { Panel } from '../panel';
import { ApiFalsa, PERFIL } from '../panel.fixtures';

/**
 * La ficha del inmueble, dentro del panel.
 *
 * Vivía SOLO dentro del informe de actividad, que es donde se inventó. El
 * problema es que para anotar la referencia de un piso recién montado había que
 * pasar por una pantalla que todavía no tenía nada que enseñar: un dosier sin
 * enviar no tiene lecturas. Ahora está también junto al dosier que describe, y
 * es el MISMO componente: copiar el formulario habría dejado dos sitios donde
 * corregir el mismo fallo, y esta pantalla ya tuvo uno.
 */
describe('Panel · la ficha del inmueble', () => {
  let fixture: ComponentFixture<Panel>;
  let api: ApiFalsa;

  async function estabiliza(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const boton = (texto: string) =>
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => (b.textContent ?? '').trim().startsWith(texto),
    );
  const referencia = () =>
    fixture.nativeElement.querySelector('input[placeholder="REF-118"]') as HTMLInputElement;
  const opciones = () =>
    Array.from(fixture.nativeElement.querySelectorAll('option')) as HTMLOptionElement[];

  beforeEach(async () => {
    api = new ApiFalsa();
    sessionStorage.setItem('vistta.sesion', 'sesion-de-prueba');
    await TestBed.configureTestingModule({
      imports: [Panel],
      providers: [{ provide: Api, useValue: api }, provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(Panel);
    await estabiliza();
  });

  afterEach(() => sessionStorage.clear());

  it('se llega a ella desde el editor, sin pasar por el informe', () => {
    expect(fixture.nativeElement.textContent).toContain('Ficha del inmueble');
    expect(referencia()).not.toBeNull();
  });

  /*
   * Plegada porque no es lo que se viene a hacer: se abre una vez, al montar el
   * dosier, y se vuelve a ella de tarde en tarde. Desplegada empujaría hacia
   * abajo lo que sí se toca todos los días.
   */
  it('va plegada, y se abre a mano', () => {
    const caja = fixture.nativeElement.querySelector('details') as HTMLDetailsElement;
    expect(caja.open).toBeFalse();
  });

  it('lo que se escribe se guarda contra el perfil abierto', async () => {
    const campo = referencia();
    campo.value = 'REF-42';
    campo.dispatchEvent(new Event('input'));
    await estabiliza();

    boton('Guardar ficha')!.click();
    await estabiliza();

    expect(api.fichas['p_uno'].referencia).toBe('REF-42');
    expect(fixture.nativeElement.textContent).toContain('Ficha guardada');
  });

  /*
   * Y el selector se entera. La referencia se enseña junto al nombre del
   * dosier, así que sin refrescar la cuenta el desplegable seguiría diciendo la
   * vieja hasta la siguiente recarga: se acabaría de escribir un dato y la
   * pantalla enseñaría otro.
   */
  it('al guardarla, el selector de perfiles enseña la referencia nueva', async () => {
    expect(opciones()[0].textContent).not.toContain('REF-42');

    const campo = referencia();
    campo.value = 'REF-42';
    campo.dispatchEvent(new Event('input'));
    await estabiliza();
    boton('Guardar ficha')!.click();
    await estabiliza();

    expect(opciones()[0].textContent).toContain('REF-42');
  });

  /*
   * Al cambiar de dosier se trae la ficha del nuevo. Dejar a la vista la del
   * anterior es peor que no enseñar ninguna: parece que ese inmueble tiene esos
   * datos, y lo siguiente es guardarlos encima.
   */
  it('cambiar de perfil trae la ficha del que se abre', async () => {
    api.perfiles = [PERFIL('p_uno', 'Primero'), PERFIL('p_dos', 'Segundo')];
    api.fichas['p_uno'] = {
      referencia: 'REF-1',
      propietarioNota: null,
      exclusivaDesde: null,
      actualizadoEn: 1,
    };
    api.fichas['p_dos'] = {
      referencia: 'REF-2',
      propietarioNota: null,
      exclusivaDesde: null,
      actualizadoEn: 1,
    };
    fixture = TestBed.createComponent(Panel);
    await estabiliza();
    expect(referencia().value).toBe('REF-1');

    const selector = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    selector.value = 'p_dos';
    selector.dispatchEvent(new Event('change'));
    await estabiliza();

    expect(referencia().value).toBe('REF-2');
  });
});
