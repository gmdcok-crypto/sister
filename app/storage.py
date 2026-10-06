"""Cloudflare R2 (S3-compatible) object storage for product images."""
from __future__ import annotations

import mimetypes
from pathlib import Path

import boto3
from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class R2Settings(BaseSettings):
    r2_account_id: str = ''
    r2_access_key_id: str = ''
    r2_secret_access_key: str = ''
    r2_bucket: str = Field(
        default='sisterfood',
        validation_alias=AliasChoices('R2_BUCKET', 'R2_BUCKET_NAME', 'r2_bucket'),
    )
    r2_public_url: str = Field(
        default='',
        validation_alias=AliasChoices('R2_PUBLIC_URL', 'R2_PUBLIC_BASE_URL', 'r2_public_url'),
    )
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')

    @field_validator(
        'r2_secret_access_key',
        'r2_public_url',
        'r2_access_key_id',
        'r2_account_id',
        'r2_bucket',
    )
    @classmethod
    def strip_value(cls, value: str) -> str:
        return value.strip() if isinstance(value, str) else value


def _settings() -> R2Settings:
    settings = R2Settings()
    missing = [
        name
        for name, value in (
            ('R2_ACCOUNT_ID', settings.r2_account_id),
            ('R2_ACCESS_KEY_ID', settings.r2_access_key_id),
            ('R2_SECRET_ACCESS_KEY', settings.r2_secret_access_key),
            ('R2_PUBLIC_URL', settings.r2_public_url),
        )
        if not value
    ]
    if missing:
        raise RuntimeError('R2 설정이 필요합니다: ' + ', '.join(missing))
    return settings


def r2_client():
    settings = _settings()
    return boto3.client(
        's3',
        endpoint_url=f'https://{settings.r2_account_id}.r2.cloudflarestorage.com',
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name='auto',
    ), settings


def public_url(key: str) -> str:
    settings = _settings()
    return f'{settings.r2_public_url.rstrip("/")}/{key.lstrip("/")}'


def upload_file(local_path: Path, key: str) -> str:
    client, settings = r2_client()
    content_type = mimetypes.guess_type(str(local_path))[0] or 'application/octet-stream'
    client.upload_file(
        str(local_path),
        settings.r2_bucket,
        key,
        ExtraArgs={'ContentType': content_type, 'CacheControl': 'public, max-age=31536000'},
    )
    return public_url(key)


def upload_bytes(data: bytes, key: str, content_type: str = 'application/octet-stream') -> str:
    client, settings = r2_client()
    client.put_object(
        Bucket=settings.r2_bucket,
        Key=key,
        Body=data,
        ContentType=content_type,
        CacheControl='public, max-age=31536000',
    )
    return public_url(key)
