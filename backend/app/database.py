from __future__ import annotations

from collections.abc import Generator

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


settings = get_settings()
engine = None
SessionLocal = None
if settings.storage_mode != "local":
    engine = create_engine(settings.database_url, pool_pre_ping=True, pool_recycle=280)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    if SessionLocal is None:
        raise HTTPException(status_code=500, detail="当前为本地存储模式，不连接数据库")
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
