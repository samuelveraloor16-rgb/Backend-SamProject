import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Mailer, CorreoMensaje } from '../../dominio/puertos/mailer.port';

// RF-03: MailHog en desarrollo (127.0.0.1:1025, sin auth). Si SMTP falla, se registra
// el error y se devuelve false: el flujo de recuperación nunca se rompe por el correo.
@Injectable()
export class SmtpMailer implements Mailer {
  private readonly logger = new Logger(SmtpMailer.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.from = config.get<string>('SMTP_FROM') ?? 'SamProject <no-reply@samproject.local>';
    const port = Number(config.get('SMTP_PORT') ?? 1025);
    const user = config.get<string>('SMTP_USER') || undefined;
    const pass = config.get<string>('SMTP_PASS') || undefined;
    this.transporter = nodemailer.createTransport({
      host: config.get<string>('SMTP_HOST') ?? '127.0.0.1',
      port,
      secure: (config.get<string>('SMTP_SECURE') ?? 'false') === 'true',
      auth: user ? { user, pass } : undefined,
    });
  }

  async enviar(mensaje: CorreoMensaje): Promise<boolean> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: mensaje.para,
        subject: mensaje.asunto,
        html: mensaje.html,
        text: mensaje.texto,
      });
      return true;
    } catch (error) {
      this.logger.error(
        `Fallo al enviar correo "${mensaje.asunto}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }
}
