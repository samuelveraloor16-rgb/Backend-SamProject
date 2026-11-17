// Puerto: envío de correo. El adaptador SMTP (Nodemailer) nunca lanza:
// ante un fallo registra el error y devuelve false (falla controlada).

export interface CorreoMensaje {
  para: string;
  asunto: string;
  html: string;
  texto?: string;
}

export interface Mailer {
  enviar(mensaje: CorreoMensaje): Promise<boolean>;
}

export const MAILER = Symbol('MAILER');
