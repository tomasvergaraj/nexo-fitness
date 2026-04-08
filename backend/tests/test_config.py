from app.core.config import Settings


def test_cors_origins_list_includes_frontend_url_and_deduplicates() -> None:
    settings = Settings(
        CORS_ORIGINS="http://localhost:3000,http://localhost:5173,https://demo.trycloudflare.com/",
        FRONTEND_URL="https://demo.trycloudflare.com/",
    )

    assert settings.cors_origins_list == [
        "http://localhost:3000",
        "http://localhost:5173",
        "https://demo.trycloudflare.com",
    ]
