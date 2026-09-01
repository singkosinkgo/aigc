from __future__ import annotations

import json

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app import local_store
from app.models import Character, ModelConfig, User
from app.security import hash_password, mask_secret
from app.schemas import CharacterOut, ModelConfigOut


settings = get_settings()


def ensure_default_user(db: Session) -> User:
    if settings.storage_mode == "local":
        return local_store.ensure_default_user()
    user = db.scalar(select(User).where(User.nickname == settings.default_user_nickname))
    if user:
        return user
    user = User(
        nickname=settings.default_user_nickname,
        avatar_url=settings.default_user_avatar_url,
        password_hash=hash_password(settings.default_user_password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_default_user(db: Session) -> User:
    if settings.storage_mode == "local":
        return local_store.get_default_user()
    user = db.scalar(select(User).where(User.nickname == settings.default_user_nickname))
    if not user:
        return ensure_default_user(db)
    return user


def get_enabled_model_config(db: Session, user_id: int, content_type: str) -> ModelConfig:
    if settings.storage_mode == "local":
        return local_store.get_enabled_model_config(user_id, content_type)
    config = db.scalar(
        select(ModelConfig)
        .where(ModelConfig.user_id == user_id, ModelConfig.type == content_type, ModelConfig.enabled == 1)
        .order_by(ModelConfig.updated_at.desc(), ModelConfig.id.desc())
    )
    if not config:
        raise HTTPException(status_code=400, detail=f"请先在“我的模型”启用 {content_type} 模型配置")
    return config


def dump_json(value: dict | None) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False)


def parse_json(value: str | None) -> dict | None:
    if not value:
        return None
    return json.loads(value)


def model_config_out(config: ModelConfig) -> ModelConfigOut:
    return ModelConfigOut(
        id=config.id,
        user_id=config.user_id,
        name=config.name,
        type=config.type,
        endpoint=config.endpoint,
        api_key=None,
        api_key_masked=mask_secret(config.api_key),
        method=config.method,
        headers_json=parse_json(config.headers_json),
        params_json=parse_json(config.params_json),
        portrait_url=config.portrait_url,
        result_path=config.result_path,
        task_id_path=config.task_id_path,
        task_query_endpoint=config.task_query_endpoint,
        enabled=bool(config.enabled),
        created_at=config.created_at,
        updated_at=config.updated_at,
    )


def character_out(character: Character) -> CharacterOut:
    return CharacterOut(
        id=character.id,
        user_id=character.user_id,
        name=character.name,
        gender=character.gender,
        birthplace=getattr(character, "birthplace", None),
        age=getattr(character, "age", None),
        height_cm=getattr(character, "height_cm", None),
        weight_kg=getattr(character, "weight_kg", None),
        skin_tone=getattr(character, "skin_tone", None),
        hairstyle=getattr(character, "hairstyle", None),
        clothing_style=getattr(character, "clothing_style", None),
        intro=character.intro or "",
        tone=character.tone,
        portraits=character.portraits or 0,
        voices=character.voices or 0,
        videos=character.videos or 0,
        memories=character.memories or 0,
        assets=parse_json(getattr(character, "assets_json", None)) or getattr(character, "assets", []) or [],
        memory_files=parse_json(getattr(character, "memories_json", None)) or getattr(character, "memory_files", []) or [],
        thinking_model=character.thinking_model or "preset",
        model_endpoint=character.model_endpoint,
        model_format=character.model_format,
        api_key=None,
        api_key_masked=mask_secret(character.api_key),
        status=character.status or "active",
        created_at=character.created_at,
        updated_at=character.updated_at,
    )


def create_work(db: Session, **data):
    if settings.storage_mode == "local":
        return local_store.create_work(data)
    from app.models import Work

    work = Work(**data)
    db.add(work)
    db.commit()
    db.refresh(work)
    return work
