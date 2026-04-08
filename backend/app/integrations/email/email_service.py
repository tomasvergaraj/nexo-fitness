"""Email service for transactional and marketing emails."""

from typing import Optional, List

import structlog

from app.core.config import get_settings

logger = structlog.get_logger()

settings = get_settings()


class EmailService:
    """Sends transactional emails via SendGrid or similar provider."""

    async def send(
        self,
        to_email: str,
        subject: str,
        html_content: str,
        from_email: Optional[str] = None,
        from_name: Optional[str] = None,
    ) -> bool:
        try:
            from sendgrid import SendGridAPIClient
            from sendgrid.helpers.mail import Mail

            message = Mail(
                from_email=from_email or settings.EMAIL_FROM,
                to_emails=to_email,
                subject=subject,
                html_content=html_content,
            )
            sg = SendGridAPIClient(settings.SENDGRID_API_KEY)
            response = sg.send(message)
            return response.status_code in (200, 202)
        except Exception as e:
            logger.error("email_send_failed", to=to_email, subject=subject, exc_info=e)
            return False

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
        """Aviso de trial por vencer: se llama a 7 días y a 1 día de la expiración."""
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
            f"⚠️ Tu prueba de Nexo Fitness vence mañana — activa tu plan"
            if days_remaining <= 1
            else f"Tu prueba de Nexo Fitness vence en {days_label} — activa tu plan"
        )
        return await self.send(to_email, subject, html)

    async def send_password_reset(self, to_email: str, reset_url: str) -> bool:
        html = f"""
        <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="padding: 30px;">
                <h2>Recuperar contraseña</h2>
                <p>Haz clic en el siguiente enlace para restablecer tu contraseña:</p>
                <a href="{reset_url}" style="display: inline-block; background: #06b6d4; color: white;
                   padding: 12px 24px; border-radius: 8px; text-decoration: none;">Restablecer</a>
                <p style="color: #6b7280; font-size: 14px; margin-top: 20px;">
                    Este enlace expira en 1 hora. Si no solicitaste este cambio, ignora este correo.
                </p>
            </div>
        </div>
        """
        return await self.send(to_email, "Recuperar contraseña — Nexo Fitness", html)


email_service = EmailService()
