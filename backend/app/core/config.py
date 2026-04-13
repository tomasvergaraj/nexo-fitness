"""Application configuration using Pydantic Settings."""

from functools import lru_cache
from typing import List

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_INSECURE_DEFAULTS = {"change-me-in-production", "change-me-jwt-secret", "change-me-admin"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False)

    # App
    APP_NAME: str = "NexoFitness"
    APP_ENV: str = "development"
    SECRET_KEY: str = "change-me-in-production"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://nexo:nexo_password@localhost:5432/nexo_fitness"
    DATABASE_POOL_SIZE: int = 20
    DATABASE_MAX_OVERFLOW: int = 10
    DATABASE_ECHO: bool = False

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"
    CAMPAIGN_SCHEDULER_INTERVAL_SECONDS: int = 60
    CAMPAIGN_SCHEDULER_BATCH_SIZE: int = 10

    # JWT
    JWT_SECRET_KEY: str = "change-me-jwt-secret"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:5173"

    @property
    def public_app_url(self) -> str:
        """URL pública HTTPS para return URLs de pagos. Usa PUBLIC_APP_URL si está configurada, sino FRONTEND_URL."""
        url = self.PUBLIC_APP_URL.strip().rstrip("/")
        return url if url else self.FRONTEND_URL.strip().rstrip("/")

    @property
    def cors_origins_list(self) -> List[str]:
        origins = [origin.strip().rstrip("/") for origin in self.CORS_ORIGINS.split(",") if origin.strip()]
        frontend_url = self.FRONTEND_URL.strip().rstrip("/")
        if frontend_url:
            origins.append(frontend_url)
        return list(dict.fromkeys(origins))

    # Email
    RESEND_API_KEY: str = ""
    EMAIL_FROM: str = "noreply@nexofitness.cl"
    EMAIL_FROM_NAME: str = "Nexo Fitness"

    # Payments
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    MERCADOPAGO_ACCESS_TOKEN: str = ""
    FINTOC_SECRET_KEY: str = ""
    FINTOC_WEBHOOK_SECRET: str = ""
    FINTOC_RECIPIENT_HOLDER_ID: str = ""
    FINTOC_RECIPIENT_ACCOUNT_NUMBER: str = ""
    FINTOC_RECIPIENT_ACCOUNT_TYPE: str = "checking_account"
    FINTOC_RECIPIENT_INSTITUTION_ID: str = ""
    WEBPAY_ENVIRONMENT: str = "integration"
    WEBPAY_COMMERCE_CODE: str = ""
    WEBPAY_API_KEY: str = ""

    # Push Notifications
    EXPO_PUSH_API_URL: str = "https://exp.host/--/api/v2/push/send"
    EXPO_PUSH_RECEIPTS_API_URL: str = "https://exp.host/--/api/v2/push/getReceipts"
    EXPO_PUSH_ACCESS_TOKEN: str = ""
    EXPO_PUSH_REQUEST_TIMEOUT_SECONDS: float = 10.0
    EXPO_PUSH_RECEIPT_BATCH_SIZE: int = 100
    EXPO_PUSH_RECEIPT_POLL_INTERVAL_SECONDS: int = 60
    EXPO_PUSH_RECEIPT_POLL_LIMIT: int = 200
    WEB_PUSH_VAPID_PUBLIC_KEY: str = ""
    WEB_PUSH_VAPID_PRIVATE_KEY: str = ""
    WEB_PUSH_VAPID_SUBJECT: str = "mailto:soporte@nexofitness.com"
    WEB_PUSH_REQUEST_TIMEOUT_SECONDS: float = 10.0

    # Storage
    AWS_S3_BUCKET: str = ""
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_REGION: str = "us-east-1"

    # Rate Limiting
    RATE_LIMIT_PER_MINUTE: int = 60

    # Superadmin
    SUPERADMIN_EMAIL: str = "admin@nexofitness.com"
    SUPERADMIN_PASSWORD: str = "change-me-admin"

    # SaaS Billing
    FRONTEND_URL: str = "http://localhost:3000"
    # URL pública HTTPS usada para webhooks y return URLs de proveedores de pago.
    # En producción debe ser la URL real. En dev, usar un túnel HTTPS (ej. Cloudflare).
    PUBLIC_APP_URL: str = ""  # Si vacío, cae en FRONTEND_URL
    SAAS_TRIAL_DAYS: int = 14
    SAAS_CURRENCY: str = "CLP"
    SAAS_MONTHLY_PRICE: int = 34990
    SAAS_QUARTERLY_PRICE: int = 94990
    SAAS_SEMI_ANNUAL_PRICE: int = 184990
    SAAS_ANNUAL_PRICE: int = 349900
    STRIPE_SAAS_MONTHLY_PRICE_ID: str = ""
    STRIPE_SAAS_QUARTERLY_PRICE_ID: str = ""
    STRIPE_SAAS_SEMI_ANNUAL_PRICE_ID: str = ""
    STRIPE_SAAS_ANNUAL_PRICE_ID: str = ""

    # Observability
    SENTRY_DSN: str = ""

    @model_validator(mode="after")
    def _block_insecure_defaults_in_production(self) -> "Settings":
        if self.APP_ENV != "production":
            return self
        insecure = []
        if self.SECRET_KEY in _INSECURE_DEFAULTS:
            insecure.append("SECRET_KEY")
        if self.JWT_SECRET_KEY in _INSECURE_DEFAULTS:
            insecure.append("JWT_SECRET_KEY")
        if self.SUPERADMIN_PASSWORD in _INSECURE_DEFAULTS:
            insecure.append("SUPERADMIN_PASSWORD")
        if insecure:
            raise ValueError(
                f"Insecure default values detected in production for: {', '.join(insecure)}. "
                "Set proper values in your .env file."
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
