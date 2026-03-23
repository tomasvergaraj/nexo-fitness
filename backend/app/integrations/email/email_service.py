"""Email service for transactional and marketing emails."""

from typing import Optional, List

from app.core.config import get_settings

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
            print(f"Email send failed: {e}")
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
        html = f"""
        <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #06b6d4, #0891b2); padding: 40px; text-align: center;">
                <h1 style="color: white; margin: 0;">¡Bienvenido a {gym_name}!</h1>
            </div>
            <div style="padding: 30px; background: #f9fafb;">
                <p>Hola <strong>{first_name}</strong>,</p>
                <p>Tu cuenta ha sido creada exitosamente. Ya puedes acceder a todas las funcionalidades.</p>
                <a href="#" style="display: inline-block; background: #06b6d4; color: white; padding: 12px 24px;
                   border-radius: 8px; text-decoration: none; margin-top: 16px;">Ir al Dashboard</a>
            </div>
        </div>
        """
        return await self.send(to_email, f"Bienvenido a {gym_name}", html)

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
