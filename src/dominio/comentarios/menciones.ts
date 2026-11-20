/** Error de formato deliberadamente independiente del transporte HTTP. */
export class FormatoComentarioInvalido extends Error {}

/** Valida texto plano y devuelve los IDs únicos en orden de aparición. */
export function extraerMenciones(texto: string): string[] {
  if (typeof texto !== 'string' || !texto.trim() || [...texto].length > 4000) {
    throw new FormatoComentarioInvalido('El texto debe contener entre 1 y 4000 caracteres');
  }

  const ids = new Set<string>();
  for (let i = 0; i < texto.length; i++) {
    if (texto.startsWith('@@[', i)) {
      i += 2;
      continue;
    }
    if (!texto.startsWith('@[', i)) continue;
    const cierre = texto.indexOf(']', i + 2);
    if (cierre === -1) throw new FormatoComentarioInvalido('Mención inválida');
    const id = texto.slice(i + 2, cierre);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      throw new FormatoComentarioInvalido('Mención inválida');
    }
    ids.add(id);
    if (ids.size > 20) throw new FormatoComentarioInvalido('Máximo 20 menciones distintas');
    i = cierre;
  }
  return [...ids];
}
