export interface CandidatoVencimiento {
  id: string;
  responsableId: string;
  fechaLimite: Date;
}
export interface VencimientosRepository {
  candidatos(ahora: Date, despuesDe: string | undefined, limite: number): Promise<CandidatoVencimiento[]>;
  encolarVigente(candidato: CandidatoVencimiento, ahora: Date): Promise<boolean>;
}
