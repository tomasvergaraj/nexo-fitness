"""Application configuration using Pydantic Settings."""

from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


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
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]

    # Email
    SENDGRID_API_KEY: str = ""
    EMAIL_FROM: str = "noreply@nexofitness.com"
    EMAIL_FROM_NAME: str = "Nexo Fitness"

    # Payments
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    MERCADOPAGO_ACCESS_TOKEN: str = ""

    # Push Notifications
    EXPO_PUSH_API_URL: str = "https://exp.host/--/api/v2/push/send"
    EXPO_PUSH_RECEIPTS_API_URL: str = "https://exp.host/--/api/v2/push/getReceipts"
    EXPO_PUSH_ACCESS_TOKEN: str = ""
    EXPO_PUSH_REQUEST_TIMEOUT_SECONDS: float = 10.0
    EXPO_PUSH_RECEIPT_BATCH_SIZE: int = 100
    EXPO_PUSH_RECEIPT_POLL_INTERVAL_SECONDS: int = 60
    EXPO_PUSH_RECEIPT_POLL_LIMIT: int = 200

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
    SAAS_TRIAL_DAYS: int = 14
    SAAS_CURRENCY: str = "CLP"
    SAAS_MONTHLY_PRICE: int = 34990
    SAAS_ANNUAL_PRICE: int = 349900
    STRIPE_SAAS_MONTHLY_PRICE_ID: str = ""
    STRIPE_SAAS_ANNUAL_PRICE_ID: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
