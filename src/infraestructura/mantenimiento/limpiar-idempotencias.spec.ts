import { ejecutarLimpieza } from './limpiar-idempotencias';
import { COMENTARIOS_REPOSITORY } from '../../dominio/puertos/comentarios.repository';

describe('ejecución controlada de limpieza RF-19', () => {
  const limpiarVencidas = jest.fn();
  const close = jest.fn();
  const get = jest.fn().mockReturnValue({ limpiarVencidas });
  const crear = jest.fn().mockResolvedValue({ get, close });

  beforeEach(() => { jest.clearAllMocks(); limpiarVencidas.mockResolvedValue(3); close.mockResolvedValue(undefined); });

  it.each([[undefined, ['--ejecutar']], ['false', ['--ejecutar']], ['true', []], ['true', ['--ejecutar', 'otro']]])
  ('no abre contexto sin ambas autorizaciones (%s)', async (flag, args) => {
    await expect(ejecutarLimpieza(flag, args!, crear)).rejects.toThrow();
    expect(crear).not.toHaveBeenCalled();
  });

  it('ejecuta un solo lote acotado y cierra el contexto', async () => {
    await expect(ejecutarLimpieza('true', ['--ejecutar'], crear)).resolves.toBe(3);
    expect(get).toHaveBeenCalledWith(COMENTARIOS_REPOSITORY);
    expect(limpiarVencidas).toHaveBeenCalledTimes(1);
    expect(limpiarVencidas).toHaveBeenCalledWith(100);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('cierra el contexto al fallar el lote y propaga el error', async () => {
    limpiarVencidas.mockRejectedValueOnce(new Error('fallo'));
    await expect(ejecutarLimpieza('true', ['--ejecutar'], crear)).rejects.toThrow('fallo');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
