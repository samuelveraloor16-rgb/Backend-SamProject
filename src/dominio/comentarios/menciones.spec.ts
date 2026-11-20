import { extraerMenciones, FormatoComentarioInvalido } from './menciones';

describe('extraerMenciones', () => {
  it('conserva el orden de la primera aparición y elimina duplicados', () => {
    expect(extraerMenciones('@[b] @[a] @[b] @nombre')).toEqual(['b', 'a']);
  });

  it('ignora los marcadores escapados sin exigir cierre', () => {
    expect(extraerMenciones('@@[incompleto y @[valido]')).toEqual(['valido']);
  });

  it.each(['@[', '@[]', '@[a b]', '@[á]', `@[${'a'.repeat(129)}]`])(
    'rechaza un marcador inválido: %s',
    (texto) => expect(() => extraerMenciones(texto)).toThrow(FormatoComentarioInvalido),
  );

  it('acepta 20 destinatarios distintos y rechaza 21', () => {
    const menciones = Array.from({ length: 20 }, (_, i) => `@[u${i}]`).join(' ');
    expect(extraerMenciones(menciones)).toHaveLength(20);
    expect(() => extraerMenciones(`${menciones} @[extra]`)).toThrow(FormatoComentarioInvalido);
    expect(extraerMenciones(`${menciones} @[u0]`)).toHaveLength(20);
  });

  it('cuenta caracteres Unicode y rechaza texto vacío o demasiado largo', () => {
    expect(extraerMenciones('😀'.repeat(4000))).toEqual([]);
    for (const texto of ['', '  \n', '😀'.repeat(4001)]) {
      expect(() => extraerMenciones(texto)).toThrow(FormatoComentarioInvalido);
    }
  });
});
