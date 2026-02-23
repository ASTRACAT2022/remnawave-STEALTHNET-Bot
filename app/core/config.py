from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Pepoapple Core"
    app_env: str = "dev"
    app_host: str = "0.0.0.0"
    app_port: int = 8080
    database_url: str = "postgresql+psycopg://pepoapple:pepoapple@localhost:5432/pepoapple"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 30
    rate_limit_per_minute: int = 120
    backup_dir: str = "./backups"
    webhook_timeout_seconds: int = 5
    cors_allow_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    public_api_base_url: str = "http://localhost:8080"

    singbox_check_command: str = "sing-box check -c {config_path}"
    singbox_check_timeout_seconds: int = 20
    singbox_check_strict: bool = False

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    def cors_origins(self) -> list[str]:
        if self.cors_allow_origins.strip() == "*":
            return ["*"]
        return [item.strip() for item in self.cors_allow_origins.split(",") if item.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
