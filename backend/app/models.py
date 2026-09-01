from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import DateTime, DECIMAL, Enum, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.mysql import BIGINT, LONGTEXT, TINYINT
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


WorkType = Enum("script", "image", "video", "storage", name="work_type")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BIGINT(unsigned=True), primary_key=True, autoincrement=True)
    nickname: Mapped[Optional[str]] = mapped_column(String(100))
    avatar_url: Mapped[Optional[str]] = mapped_column(String(1024))
    phone: Mapped[Optional[str]] = mapped_column(String(32), unique=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), unique=True)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255))
    balance: Mapped[Decimal] = mapped_column(DECIMAL(12, 2), default=Decimal("0.00"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    works: Mapped[List["Work"]] = relationship(back_populates="user")
    model_configs: Mapped[List["ModelConfig"]] = relationship(back_populates="user")
    characters: Mapped[List["Character"]] = relationship(back_populates="user")


class Work(Base):
    __tablename__ = "works"

    id: Mapped[int] = mapped_column(BIGINT(unsigned=True), primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BIGINT(unsigned=True), ForeignKey("users.id"), index=True)
    title: Mapped[Optional[str]] = mapped_column(String(255))
    type: Mapped[str] = mapped_column(WorkType, index=True)
    prompt: Mapped[Optional[str]] = mapped_column(Text)
    generation_params_json: Mapped[Optional[str]] = mapped_column(LONGTEXT)
    reference_urls_json: Mapped[Optional[str]] = mapped_column(LONGTEXT)
    content: Mapped[Optional[str]] = mapped_column(LONGTEXT)
    file_url: Mapped[Optional[str]] = mapped_column(String(1024))
    thumbnail_url: Mapped[Optional[str]] = mapped_column(String(1024))
    model_id: Mapped[Optional[int]] = mapped_column(BIGINT(unsigned=True), index=True)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    user: Mapped[User] = relationship(back_populates="works")


class ModelConfig(Base):
    __tablename__ = "model_configs"

    id: Mapped[int] = mapped_column(BIGINT(unsigned=True), primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BIGINT(unsigned=True), ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    type: Mapped[str] = mapped_column(WorkType, index=True)
    endpoint: Mapped[str] = mapped_column(String(1024))
    api_key: Mapped[Optional[str]] = mapped_column(String(2048))
    method: Mapped[str] = mapped_column(String(16), default="POST")
    headers_json: Mapped[Optional[str]] = mapped_column(Text)
    params_json: Mapped[Optional[str]] = mapped_column(Text)
    portrait_url: Mapped[Optional[str]] = mapped_column(String(1024))
    result_path: Mapped[Optional[str]] = mapped_column(String(255))
    task_id_path: Mapped[Optional[str]] = mapped_column(String(255))
    task_query_endpoint: Mapped[Optional[str]] = mapped_column(String(1024))
    enabled: Mapped[int] = mapped_column(TINYINT(1), default=1, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    user: Mapped[User] = relationship(back_populates="model_configs")


class Character(Base):
    __tablename__ = "characters"

    id: Mapped[int] = mapped_column(BIGINT(unsigned=True), primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BIGINT(unsigned=True), ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    gender: Mapped[str] = mapped_column(String(16), default="未知", index=True)
    birthplace: Mapped[Optional[str]] = mapped_column(String(255))
    age: Mapped[Optional[int]] = mapped_column(Integer)
    height_cm: Mapped[Optional[int]] = mapped_column(Integer)
    weight_kg: Mapped[Optional[float]] = mapped_column(Float)
    skin_tone: Mapped[Optional[str]] = mapped_column(String(100))
    hairstyle: Mapped[Optional[str]] = mapped_column(String(255))
    clothing_style: Mapped[Optional[str]] = mapped_column(String(255))
    intro: Mapped[Optional[str]] = mapped_column(Text)
    tone: Mapped[Optional[str]] = mapped_column(String(255))
    portraits: Mapped[int] = mapped_column(default=0)
    voices: Mapped[int] = mapped_column(default=0)
    videos: Mapped[int] = mapped_column(default=0)
    memories: Mapped[int] = mapped_column(default=0)
    assets_json: Mapped[Optional[str]] = mapped_column(LONGTEXT)
    memories_json: Mapped[Optional[str]] = mapped_column(LONGTEXT)
    thinking_model: Mapped[str] = mapped_column(String(32), default="preset")
    model_endpoint: Mapped[Optional[str]] = mapped_column(String(1024))
    model_format: Mapped[Optional[str]] = mapped_column(LONGTEXT)
    api_key: Mapped[Optional[str]] = mapped_column(String(2048))
    status: Mapped[str] = mapped_column(String(32), default="active", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    user: Mapped[User] = relationship(back_populates="characters")
