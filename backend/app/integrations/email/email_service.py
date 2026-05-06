"""Email service for transactional and marketing emails via Resend."""

import asyncio
from datetime import datetime
from typing import Optional, List

import structlog

from app.core.config import get_settings

logger = structlog.get_logger()
settings = get_settings()


def _send_sync(to_email: str, subject: str, html_content: str, from_addr: str) -> bool:
    """Blocking Resend call — run in a thread via asyncio.to_thread."""
    import resend

    resend.api_key = settings.RESEND_API_KEY
    if not resend.api_key:
        logger.warning("email_skipped_no_api_key", to=to_email, subject=subject)
        return False

    try:
        params: resend.Emails.SendParams = {
            "from": from_addr,
            "to": [to_email],
            "subject": subject,
            "html": html_content,
        }
        email = resend.Emails.send(params)
        return bool(email.get("id"))
    except Exception as e:
        logger.error("email_send_failed", to=to_email, subject=subject, exc_info=e)
        return False


class EmailService:
    """Sends transactional emails via Resend."""

    @property
    def _from_addr(self) -> str:
        name = settings.EMAIL_FROM_NAME or "Nexo Fitness"
        return f"{name} <{settings.EMAIL_FROM}>"

    async def send(
        self,
        to_email: str,
        subject: str,
        html_content: str,
        from_email: Optional[str] = None,
        from_name: Optional[str] = None,
    ) -> bool:
        name = from_name or settings.EMAIL_FROM_NAME or "Nexo Fitness"
        addr = from_email or settings.EMAIL_FROM
        from_addr = f"{name} <{addr}>"
        return await asyncio.to_thread(_send_sync, to_email, subject, html_content, from_addr)

    async def send_bulk(
        self,
        recipients: List[str],
        subject: str,
        html_content: str,
    ) -> dict:
        sent = 0
        failed = 0
        for email in recipients:
            success = await self.send(email, subject, html_content)
            if success:
                sent += 1
            else:
                failed += 1
        return {"sent": sent, "failed": failed}

    async def send_welcome(self, to_email: str, first_name: str, gym_name: str) -> bool:
        dashboard_url = f"{settings.FRONTEND_URL}/dashboard"
        html = f"""
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
            <div style="background:linear-gradient(135deg,#0f766e,#0891b2);padding:48px 40px;text-align:center;border-radius:12px 12px 0 0;">
                <h1 style="color:white;margin:0;font-size:28px;font-weight:700;">¡Bienvenido a Nexo Fitness!</h1>
                <p style="color:rgba(255,255,255,0.85);margin:12px 0 0;font-size:16px;">{gym_name} ya está en marcha</p>
            </div>
            <div style="padding:40px;background:#f9fafb;">
                <p style="font-size:16px;color:#374151;">Hola <strong>{first_name}</strong>,</p>
                <p style="color:#4b5563;line-height:1.6;">
                    Tu gimnasio <strong>{gym_name}</strong> fue registrado exitosamente en la plataforma.
                    Tienes <strong>14 días de prueba gratuita</strong> para explorar todas las funcionalidades.
                </p>
                <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin:24px 0;">
                    <p style="margin:0 0 8px;font-weight:600;color:#111827;">Primeros pasos recomendados:</p>
                    <ul style="color:#4b5563;line-height:2;margin:0;padding-left:20px;">
                        <li>Configura tu sucursal principal en <em>Configuración → Sucursales</em></li>
                        <li>Crea tus planes de membresía en <em>Planes</em></li>
                        <li>Agrega tus primeros clientes en <em>Clientes</em></li>
                        <li>Crea una clase en <em>Clases</em> y habilita reservas</li>
                    </ul>
                </div>
                <div style="text-align:center;margin-top:32px;">
                    <a href="{dashboard_url}"
                       style="display:inline-block;background:linear-gradient(135deg,#0f766e,#0891b2);color:white;
                              padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px;">
                        Ir al Dashboard →
                    </a>
                </div>
                <p style="color:#9ca3af;font-size:13px;margin-top:32px;text-align:center;">
                    Si tienes alguna duda, responde este correo o escríbenos directamente.<br>
                    — El equipo de Nexo Fitness
                </p>
            </div>
        </div>
        """
        return await self.send(to_email, f"Bienvenido a Nexo Fitness — {gym_name} ya está activo", html)

    async def send_trial_expiring(
        self,
        to_email: str,
        first_name: str,
        gym_name: str,
        days_remaining: int,
        checkout_url: str,
    ) -> bool:
        urgency_color = "#dc2626" if days_remaining <= 1 else "#d97706"
        days_label = "menos de 1 día" if days_remaining < 1 else f"{days_remaining} día{'s' if days_remaining != 1 else ''}"
        html = f"""
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
            <div style="background:{urgency_color};padding:40px;text-align:center;border-radius:12px 12px 0 0;">
                <h1 style="color:white;margin:0;font-size:26px;font-weight:700;">Tu período de prueba vence en {days_label}</h1>
            </div>
            <div style="padding:40px;background:#f9fafb;">
                <p style="font-size:16px;color:#374151;">Hola <strong>{first_name}</strong>,</p>
                <p style="color:#4b5563;line-height:1.6;">
                    El período de prueba gratuita de <strong>{gym_name}</strong> está por vencer.
                    Para seguir usando Nexo Fitness sin interrupciones, activa tu suscripción antes de que expire el acceso.
                </p>
                <div style="text-align:center;margin:32px 0;">
                    <a href="{checkout_url}"
                       style="display:inline-block;background:{urgency_color};color:white;
                              padding:16px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;">
                        Activar suscripción ahora →
                    </a>
                </div>
                <p style="color:#6b7280;font-size:14px;line-height:1.6;">
                    Una vez activada, todos tus datos (clientes, clases, pagos) se conservan sin cambios.
                </p>
                <p style="color:#9ca3af;font-size:13px;margin-top:32px;text-align:center;">
                    Si ya activaste tu plan, puedes ignorar este correo.<br>
                    — El equipo de Nexo Fitness
                </p>
            </div>
        </div>
        """
        subject = (
            "⚠️ Tu prueba de Nexo Fitness vence mañana — activa tu plan"
            if days_remaining <= 1
            else f"Tu prueba de Nexo Fitness vence en {days_label} — activa tu plan"
        )
        return await self.send(to_email, subject, html)

    async def send_license_expiring(
        self,
        to_email: str,
        first_name: str,
        gym_name: str,
        plan_name: str,
        days_remaining: int,
        checkout_url: str,
    ) -> bool:
        urgency_color = "#dc2626" if days_remaining <= 1 else ("#d97706" if days_remaining <= 3 else "#0891b2")
        if days_remaining < 1:
            days_label = "menos de 1 día"
        elif days_remaining == 1:
            days_label = "1 día"
        else:
            days_label = f"{days_remaining} días"
        html = f"""
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
            <div style="background:{urgency_color};padding:40px;text-align:center;border-radius:12px 12px 0 0;">
                <h1 style="color:white;margin:0;font-size:26px;font-weight:700;">Tu plan vence en {days_label}</h1>
            </div>
            <div style="padding:40px;background:#f9fafb;">
                <p style="font-size:16px;color:#374151;">Hola <strong>{first_name}</strong>,</p>
                <p style="color:#4b5563;line-height:1.6;">
                    El plan <strong>{plan_name}</strong> de <strong>{gym_name}</strong> vence en {days_label}.
                    Renueva ahora para evitar la suspensión del servicio. Si pagas antes del vencimiento,
                    el nuevo período comienza apenas termine el actual — sin perder días.
                </p>
                <div style="text-align:center;margin:32px 0;">
                    <a href="{checkout_url}"
                       style="display:inline-block;background:{urgency_color};color:white;
                              padding:16px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;">
                        Renovar plan ahora →
                    </a>
                </div>
                <p style="color:#6b7280;font-size:14px;line-height:1.6;">
                    Tus datos (clientes, clases, pagos, configuración) se conservan intactos al renovar.
                </p>
                <p style="color:#9ca3af;font-size:13px;margin-top:32px;text-align:center;">
                    Si ya programaste la renovación, puedes ignorar este correo.<br>
                    — El equipo de Nexo Fitness
                </p>
            </div>
        </div>
        """
        if days_remaining <= 1:
            subject = f"⚠️ Tu plan de Nexo Fitness vence mañana — renueva {gym_name}"
        elif days_remaining <= 3:
            subject = f"Tu plan de Nexo Fitness vence en {days_label} — renueva {gym_name}"
        else:
            subject = f"Recordatorio: tu plan de Nexo Fitness vence en {days_label}"
        return await self.send(to_email, subject, html)

    async def send_password_reset(self, to_email: str, reset_url: str) -> bool:
        html = f"""
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
            <div style="background:linear-gradient(135deg,#0f766e,#0891b2);padding:40px;text-align:center;border-radius:12px 12px 0 0;">
                <h1 style="color:white;margin:0;font-size:26px;font-weight:700;">Recuperar contraseña</h1>
                <p style="color:rgba(255,255,255,0.85);margin:10px 0 0;font-size:15px;">Nexo Fitness</p>
            </div>
            <div style="padding:40px;background:#f9fafb;">
                <p style="font-size:16px;color:#374151;">Haz clic en el siguiente botón para restablecer tu contraseña:</p>
                <div style="text-align:center;margin:32px 0;">
                    <a href="{reset_url}"
                       style="display:inline-block;background:linear-gradient(135deg,#0f766e,#0891b2);color:white;
                              padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px;">
                        Restablecer contraseña →
                    </a>
                </div>
                <p style="color:#6b7280;font-size:14px;text-align:center;">
                    Este enlace expira en <strong>1 hora</strong>.<br>
                    Si no solicitaste este cambio, ignora este correo.
                </p>
            </div>
        </div>
        """
        return await self.send(to_email, "Recuperar contraseña — Nexo Fitness", html)

    async def send_email_verification(self, to_email: str, code: str) -> bool:
        html = f"""
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;background:#ffffff;">
            <div style="background:linear-gradient(135deg,#0f766e,#0891b2);padding:40px;text-align:center;border-radius:12px 12px 0 0;">
                <h1 style="color:white;margin:0;font-size:26px;font-weight:700;">Verifica tu correo</h1>
                <p style="color:rgba(255,255,255,0.85);margin:10px 0 0;font-size:15px;">Nexo Fitness</p>
            </div>
            <div style="padding:40px;background:#f9fafb;">
                <p style="font-size:16px;color:#374151;">Usa el siguiente código para verificar tu correo electrónico:</p>
                <div style="margin:28px 0;text-align:center;">
                    <span style="display:inline-block;background:#ffffff;border:2px solid #0f766e;border-radius:16px;
                                 padding:18px 40px;font-size:40px;font-weight:700;letter-spacing:12px;color:#0f766e;
                                 font-family:'Courier New',monospace;">
                        {code}
                    </span>
                </div>
                <p style="color:#6b7280;font-size:14px;text-align:center;">
                    Este código expira en <strong>10 minutos</strong>.<br>
                    Si no solicitaste esto, ignora este correo.
                </p>
            </div>
        </div>
        """
        return await self.send(to_email, "Código de verificación — Nexo Fitness", html)

    async def send_program_booking_created(
        self,
        to_email: str,
        first_name: str,
        gym_name: str,
        program_name: str,
        total_classes: int,
        confirmed_classes: int,
        waitlisted_classes: int,
    ) -> bool:
        programs_url = f"{settings.public_app_url}/member?tab=programs"
        html = f"""
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
            <div style="background:linear-gradient(135deg,#0f766e,#0891b2);padding:44px 40px;text-align:center;border-radius:12px 12px 0 0;">
                <h1 style="color:white;margin:0;font-size:26px;font-weight:700;">Reserva de programa confirmada</h1>
                <p style="color:rgba(255,255,255,0.85);margin:10px 0 0;font-size:15px;">{gym_name}</p>
            </div>
            <div style="padding:40px;background:#f9fafb;">
                <p style="font-size:16px;color:#374151;">Hola <strong>{first_name}</strong>,</p>
                <p style="color:#4b5563;line-height:1.6;">
                    Tu reserva del programa <strong>{program_name}</strong> ya quedó registrada.
                    Puedes revisar el detalle completo desde la sección <strong>Programas</strong> de tu app.
                </p>
                <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:22px 24px;margin:24px 0;">
                    <p style="margin:0 0 14px;font-size:14px;font-weight:700;color:#111827;">Resumen de la reserva</p>
                    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;">
                        <div style="padding:14px;border-radius:12px;background:#ecfeff;">
                            <p style="margin:0;font-size:12px;color:#0f766e;text-transform:uppercase;letter-spacing:0.08em;">Total</p>
                            <p style="margin:8px 0 0;font-size:24px;font-weight:700;color:#0f172a;">{total_classes}</p>
                        </div>
                        <div style="padding:14px;border-radius:12px;background:#ecfdf5;">
                            <p style="margin:0;font-size:12px;color:#047857;text-transform:uppercase;letter-spacing:0.08em;">Confirmadas</p>
                            <p style="margin:8px 0 0;font-size:24px;font-weight:700;color:#0f172a;">{confirmed_classes}</p>
                        </div>
                        <div style="padding:14px;border-radius:12px;background:#fff7ed;">
                            <p style="margin:0;font-size:12px;color:#c2410c;text-transform:uppercase;letter-spacing:0.08em;">Espera</p>
                            <p style="margin:8px 0 0;font-size:24px;font-weight:700;color:#0f172a;">{waitlisted_classes}</p>
                        </div>
                    </div>
                </div>
                <p style="color:#6b7280;font-size:14px;line-height:1.6;">
                    Si alguna clase estaba llena, quedó automáticamente en lista de espera.
                    Cualquier cambio futuro lo verás directamente en tu agenda.
                </p>
                <div style="text-align:center;margin-top:32px;">
                    <a href="{programs_url}"
                       style="display:inline-block;background:linear-gradient(135deg,#0f766e,#0891b2);color:white;
                              padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px;">
                        Ver mis programas →
                    </a>
                </div>
            </div>
        </div>
        """
        return await self.send(
            to_email,
            f"Reserva confirmada: {program_name} — {gym_name}",
            html,
        )

    async def send_program_booking_cancelled(
        self,
        to_email: str,
        first_name: str,
        gym_name: str,
        program_name: str,
        cancelled_classes: int,
        skipped_deadline: int,
        cancel_reason: Optional[str] = None,
    ) -> bool:
        programs_url = f"{settings.public_app_url}/member?tab=programs"
        reason_html = (
            f"""
            <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:16px 18px;margin-top:18px;">
                <p style="margin:0;font-size:13px;font-weight:700;color:#9a3412;">Motivo registrado</p>
                <p style="margin:8px 0 0;font-size:14px;line-height:1.6;color:#7c2d12;">{cancel_reason}</p>
            </div>
            """
            if cancel_reason
            else ""
        )
        skipped_html = (
            f"<p style=\"color:#92400e;font-size:14px;line-height:1.6;margin-top:18px;\">"
            f"{skipped_deadline} clase{'s' if skipped_deadline != 1 else ''} no se pudieron cancelar porque ya estaban dentro del plazo límite.</p>"
            if skipped_deadline
            else ""
        )
        html = f"""
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
            <div style="background:#b45309;padding:44px 40px;text-align:center;border-radius:12px 12px 0 0;">
                <h1 style="color:white;margin:0;font-size:26px;font-weight:700;">Reserva de programa cancelada</h1>
                <p style="color:rgba(255,255,255,0.85);margin:10px 0 0;font-size:15px;">{gym_name}</p>
            </div>
            <div style="padding:40px;background:#f9fafb;">
                <p style="font-size:16px;color:#374151;">Hola <strong>{first_name}</strong>,</p>
                <p style="color:#4b5563;line-height:1.6;">
                    Se canceló tu reserva del programa <strong>{program_name}</strong>.
                    Las clases futuras asociadas se actualizaron en tu agenda.
                </p>
                <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:22px 24px;margin:24px 0;">
                    <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#111827;">Resumen de la cancelación</p>
                    <p style="margin:0;font-size:34px;font-weight:700;color:#0f172a;">{cancelled_classes}</p>
                    <p style="margin:6px 0 0;color:#6b7280;font-size:14px;">Clase{'s' if cancelled_classes != 1 else ''} futura{'s' if cancelled_classes != 1 else ''} cancelada{'s' if cancelled_classes != 1 else ''}</p>
                    {skipped_html}
                    {reason_html}
                </div>
                <div style="text-align:center;margin-top:32px;">
                    <a href="{programs_url}"
                       style="display:inline-block;background:#b45309;color:white;
                              padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px;">
                        Revisar mis programas →
                    </a>
                </div>
            </div>
        </div>
        """
        return await self.send(
            to_email,
            f"Reserva cancelada: {program_name} — {gym_name}",
            html,
        )


    async def send_staff_invitation(
        self,
        to_email: str,
        first_name: str,
        gym_name: str,
        invite_url: str,
        role_label: str,
        invited_by: str,
    ) -> bool:
        html = f"""
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
            <div style="background:linear-gradient(135deg,#0f766e,#0891b2);padding:48px 40px;text-align:center;border-radius:12px 12px 0 0;">
                <h1 style="color:white;margin:0;font-size:26px;font-weight:700;">¡Te invitaron a {gym_name}!</h1>
                <p style="color:rgba(255,255,255,0.85);margin:12px 0 0;font-size:15px;">Nexo Fitness · Plataforma de gestión</p>
            </div>
            <div style="padding:40px;background:#f9fafb;">
                <p style="font-size:16px;color:#374151;">Hola <strong>{first_name}</strong>,</p>
                <p style="color:#4b5563;line-height:1.6;">
                    <strong>{invited_by}</strong> te invitó a unirte al equipo de <strong>{gym_name}</strong>
                    en Nexo Fitness como <strong>{role_label}</strong>.
                </p>
                <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:20px 24px;margin:24px 0;">
                    <p style="margin:0;font-size:14px;color:#6b7280;">Rol asignado</p>
                    <p style="margin:6px 0 0;font-size:18px;font-weight:700;color:#0f766e;">{role_label}</p>
                </div>
                <p style="color:#4b5563;font-size:14px;line-height:1.6;">
                    Haz clic en el botón para activar tu cuenta y crear tu contraseña de acceso.
                    Este enlace es válido por <strong>72 horas</strong>.
                </p>
                <div style="text-align:center;margin:32px 0;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
                        <tr>
                            <td style="border-radius:10px;background-color:#0f766e;">
                                <a href="{invite_url}"
                                   style="display:inline-block;background-color:#0f766e;color:#ffffff;
                                          padding:16px 40px;border-radius:10px;text-decoration:none;
                                          font-weight:700;font-size:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
                                          line-height:1;letter-spacing:0.01em;">
                                    Activar mi cuenta →
                                </a>
                            </td>
                        </tr>
                    </table>
                    <p style="margin:12px 0 0;font-size:13px;color:#6b7280;">
                        Si el botón no funciona, copia este enlace en tu navegador:<br>
                        <a href="{invite_url}" style="color:#0f766e;word-break:break-all;">{invite_url}</a>
                    </p>
                </div>
                <p style="color:#9ca3af;font-size:13px;text-align:center;margin-top:32px;">
                    Si no esperabas esta invitación, puedes ignorar este correo con seguridad.<br>
                    — El equipo de Nexo Fitness
                </p>
            </div>
        </div>
        """
        return await self.send(
            to_email,
            f"Invitación al equipo de {gym_name} — Nexo Fitness",
            html,
        )

    async def send_feedback_submission(
        self,
        *,
        to_email: str,
        gym_name: str,
        author_name: str,
        author_email: Optional[str],
        category_label: str,
        message: str,
        image_url: Optional[str] = None,
    ) -> bool:
        escaped_message = message.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br>")
        author_email_html = (
            f'<p style="margin:6px 0 0;font-size:14px;color:#4b5563;"><strong>Correo:</strong> {author_email}</p>'
            if author_email
            else ""
        )
        image_html = (
            f"""
            <div style="margin-top:24px;">
                <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:#111827;">Adjunto</p>
                <a href="{image_url}" style="color:#0f766e;text-decoration:none;">Ver imagen adjunta</a>
            </div>
            """
            if image_url
            else ""
        )
        html = f"""
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;background:#ffffff;">
            <div style="background:linear-gradient(135deg,#f59e0b,#f97316,#fb7185);padding:42px 40px;text-align:center;border-radius:12px 12px 0 0;">
                <h1 style="color:white;margin:0;font-size:28px;font-weight:700;">Nuevo feedback recibido</h1>
                <p style="color:rgba(255,255,255,0.9);margin:12px 0 0;font-size:16px;">{gym_name}</p>
            </div>
            <div style="padding:36px 40px;background:#fffaf5;">
                <div style="background:#ffffff;border:1px solid #fed7aa;border-radius:14px;padding:22px 24px;">
                    <p style="margin:0;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#c2410c;">Categoría</p>
                    <p style="margin:10px 0 0;font-size:20px;font-weight:700;color:#111827;">{category_label}</p>
                    <p style="margin:18px 0 0;font-size:14px;color:#4b5563;"><strong>Enviado por:</strong> {author_name}</p>
                    {author_email_html}
                </div>
                <div style="margin-top:24px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;padding:22px 24px;">
                    <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#111827;">Mensaje</p>
                    <p style="margin:0;font-size:15px;line-height:1.7;color:#374151;">{escaped_message}</p>
                    {image_html}
                </div>
                <p style="margin-top:24px;font-size:13px;line-height:1.6;color:#9ca3af;text-align:center;">
                    Este aviso fue generado automáticamente por el módulo Feedback de Nexo Fitness.
                </p>
            </div>
        </div>
        """
        return await self.send(
            to_email,
            f"Feedback {category_label.lower()} — {gym_name}",
            html,
        )

    async def send_2fa_changed(
        self,
        *,
        to_email: str,
        first_name: str,
        action: str,  # "enabled" | "disabled" | "backup_regenerated"
        when: datetime,
    ) -> bool:
        """Security alert when 2FA state changes on a user account."""
        action_label = {
            "enabled": "Verificación en dos pasos activada",
            "disabled": "Verificación en dos pasos desactivada",
            "backup_regenerated": "Códigos de respaldo regenerados",
        }.get(action, "Cambio en 2FA")

        action_body = {
            "enabled": "Acabas de activar la verificación en dos pasos. A partir de ahora necesitarás el código del autenticador (o un código de respaldo) para iniciar sesión.",
            "disabled": "Acabas de desactivar la verificación en dos pasos. Tu cuenta ya no requiere el segundo factor para iniciar sesión.",
            "backup_regenerated": "Acabas de regenerar tus códigos de respaldo de 2FA. Los códigos anteriores ya no funcionan — usa los nuevos que descargaste.",
        }.get(action, "")

        accent = "#dc2626" if action in ("disabled", "backup_regenerated") else "#0f766e"
        when_str = when.strftime("%d/%m/%Y %H:%M UTC") if when else ""

        html = f"""
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
            <div style="background:linear-gradient(135deg,{accent},#0891b2);padding:36px 40px;text-align:center;border-radius:12px 12px 0 0;">
                <h1 style="color:white;margin:0;font-size:24px;font-weight:700;">{action_label}</h1>
                <p style="color:rgba(255,255,255,0.85);margin:10px 0 0;font-size:14px;">Nexo Fitness · Aviso de seguridad</p>
            </div>
            <div style="padding:36px 40px;background:#f9fafb;">
                <p style="font-size:16px;color:#374151;">Hola <strong>{first_name}</strong>,</p>
                <p style="color:#4b5563;line-height:1.6;">{action_body}</p>
                <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:18px 22px;margin:22px 0;">
                    <p style="margin:0;font-size:13px;color:#6b7280;">Cuenta</p>
                    <p style="margin:4px 0 12px;font-size:15px;font-weight:600;color:#111827;">{to_email}</p>
                    <p style="margin:0;font-size:13px;color:#6b7280;">Fecha</p>
                    <p style="margin:4px 0 0;font-size:15px;color:#111827;">{when_str}</p>
                </div>
                <p style="color:#6b7280;font-size:14px;line-height:1.6;">
                    <strong>¿No fuiste tú?</strong> Cambia tu contraseña de inmediato y contacta al
                    administrador de tu gimnasio.
                </p>
                <p style="color:#9ca3af;font-size:12px;margin-top:24px;text-align:center;">
                    Este es un aviso automático. No respondas a este correo.
                </p>
            </div>
        </div>
        """
        return await self.send(to_email, f"{action_label} — Nexo Fitness", html)


email_service = EmailService()
