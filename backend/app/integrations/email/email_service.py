"""Email service for transactional and marketing emails via Resend."""

import asyncio
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


email_service = EmailService()
