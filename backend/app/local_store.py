from __future__ import annotations

import json
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from fastapi import HTTPException

from app.config import get_settings
from app.schemas import CharacterCreate, CharacterUpdate, ModelConfigCreate, ModelConfigUpdate


settings = get_settings()
data_dir = Path(settings.local_data_dir)
works_path = data_dir / "works.json"
model_configs_path = data_dir / "model_configs.json"
users_path = data_dir / "users.json"
characters_path = data_dir / "characters.json"


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _load(path: Path, default: Any) -> Any:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(json.dumps(default, ensure_ascii=False, indent=2), encoding="utf-8")
        return default
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return default
    return json.loads(text)


def _save(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _obj(data: dict[str, Any]) -> SimpleNamespace:
    item = dict(data)
    item.setdefault("generation_params_json", None)
    item.setdefault("reference_urls_json", None)
    for key in ("created_at", "updated_at"):
        value = item.get(key)
        if isinstance(value, str):
            item[key] = datetime.fromisoformat(value)
    if "balance" in item:
        item["balance"] = Decimal(str(item["balance"]))
    item.setdefault("portrait_url", None)
    item.setdefault("assets", [])
    item.setdefault("memory_files", [])
    item.setdefault("api_key_masked", None)
    return SimpleNamespace(**item)


def _next_id(items: list[dict[str, Any]]) -> int:
    return max((int(item.get("id", 0)) for item in items), default=0) + 1


def _default_characters() -> list[dict[str, Any]]:
    stamp = _now()
    seeds = [
        ("安娜", "女", "温柔甜美的邻家女孩，性格开朗活泼，喜欢旅行和摄影，擅长与人沟通，善于表达。", 12, 2, 3, 8, "from-rose-100 via-orange-50 to-sky-100"),
        ("林川", "男", "沉稳细致的职场精英，专注高效且极具逻辑和思维。", 10, 1, 4, 6, "from-slate-100 via-blue-50 to-indigo-100"),
        ("Mia", "女", "时尚博主，热爱生活与美妆分享，风格阳光自信。", 6, 1, 1, 2, "from-amber-100 via-pink-50 to-sky-100"),
        ("苏晚", "女", "知性优雅的文艺青年，喜欢古典音乐与写作。", 4, 1, 2, 1, "from-pink-100 via-white to-blue-100"),
        ("陈言", "男", "阳光运动型男生，热爱篮球与健身，充满活力。", 2, 0, 0, 0, "from-cyan-100 via-white to-slate-100"),
        ("小雨", "女", "清纯可爱的大学生，喜欢动漫和手作。", 1, 0, 0, 0, "from-emerald-100 via-white to-violet-100"),
    ]
    return [
        {
            "id": index,
            "user_id": 1,
            "name": name,
            "gender": gender,
            "intro": intro,
            "tone": tone,
            "portraits": portraits,
            "voices": voices,
            "videos": videos,
            "memories": memories,
            "assets": [],
            "memory_files": [],
            "thinking_model": "preset",
            "model_endpoint": None,
            "model_format": None,
            "api_key": None,
            "status": "active",
            "created_at": stamp,
            "updated_at": stamp,
        }
        for index, (name, gender, intro, portraits, voices, videos, memories, tone) in enumerate(seeds, start=1)
    ]


def ensure_default_user() -> SimpleNamespace:
    users = _load(users_path, [])
    for user in users:
        if user.get("nickname") == settings.default_user_nickname:
            return _obj(user)

    user = {
        "id": 1,
        "nickname": settings.default_user_nickname,
        "avatar_url": settings.default_user_avatar_url,
        "phone": None,
        "email": None,
        "password_hash": None,
        "balance": "86436.00",
        "created_at": _now(),
        "updated_at": _now(),
    }
    users.append(user)
    _save(users_path, users)
    return _obj(user)


def get_default_user() -> SimpleNamespace:
    return ensure_default_user()


def list_works(work_type: str | None = None) -> list[SimpleNamespace]:
    items = _load(works_path, [])
    if work_type:
        items = [item for item in items if item.get("type") == work_type]
    items.sort(key=lambda item: (item.get("created_at") or "", int(item.get("id", 0))), reverse=True)
    return [_obj(item) for item in items]


def get_work(work_id: int, user_id: int) -> SimpleNamespace | None:
    for item in _load(works_path, []):
        if int(item.get("id", 0)) == work_id and int(item.get("user_id", 0)) == user_id:
            return _obj(item)
    return None


def update_work(work_id: int, user_id: int, updates: dict[str, Any]) -> SimpleNamespace | None:
    items = _load(works_path, [])
    for item in items:
        if int(item.get("id", 0)) == work_id and int(item.get("user_id", 0)) == user_id:
            item.update(updates)
            item["updated_at"] = _now()
            _save(works_path, items)
            return _obj(item)
    return None


def create_work(data: dict[str, Any]) -> SimpleNamespace:
    items = _load(works_path, [])
    stamp = _now()
    item = {
        "id": _next_id(items),
        "user_id": data.get("user_id", 1),
        "title": data.get("title"),
        "type": data.get("type"),
        "prompt": data.get("prompt"),
        "generation_params_json": data.get("generation_params_json"),
        "reference_urls_json": data.get("reference_urls_json"),
        "content": data.get("content"),
        "file_url": data.get("file_url"),
        "thumbnail_url": data.get("thumbnail_url"),
        "model_id": data.get("model_id"),
        "status": data.get("status", "completed"),
        "created_at": stamp,
        "updated_at": stamp,
    }
    items.append(item)
    _save(works_path, items)
    return _obj(item)


def list_model_configs(config_type: str | None = None) -> list[SimpleNamespace]:
    items = _load(model_configs_path, [])
    if config_type:
        items = [item for item in items if item.get("type") == config_type]
    items.sort(key=lambda item: (item.get("type") or "", int(item.get("id", 0))))
    return [_obj(item) for item in items]


def get_model_config(config_id: int, user_id: int = 1) -> SimpleNamespace | None:
    for item in _load(model_configs_path, []):
        if int(item.get("id", 0)) == config_id and int(item.get("user_id", 0)) == user_id:
            return _obj(item)
    return None


def get_enabled_model_config(user_id: int, content_type: str) -> SimpleNamespace:
    items = [
        item
        for item in _load(model_configs_path, [])
        if int(item.get("user_id", 0)) == user_id and item.get("type") == content_type and int(item.get("enabled", 0)) == 1
    ]
    items.sort(key=lambda item: (item.get("updated_at") or "", int(item.get("id", 0))), reverse=True)
    if not items:
        raise HTTPException(status_code=400, detail=f"请先在“我的模型”启用 {content_type} 模型配置")
    return _obj(items[0])


def create_model_config(payload: ModelConfigCreate, user_id: int = 1) -> SimpleNamespace:
    items = _load(model_configs_path, [])
    if payload.enabled:
        for item in items:
            if int(item.get("user_id", 0)) == user_id and item.get("type") == payload.type:
                item["enabled"] = 0
                item["updated_at"] = _now()

    stamp = _now()
    item = {
        "id": _next_id(items),
        "user_id": user_id,
        "name": payload.name,
        "type": payload.type,
        "endpoint": payload.endpoint,
        "api_key": payload.api_key,
        "method": payload.method.upper(),
        "headers_json": json.dumps(payload.headers_json, ensure_ascii=False) if payload.headers_json is not None else None,
        "params_json": json.dumps(payload.params_json, ensure_ascii=False) if payload.params_json is not None else None,
        "portrait_url": payload.portrait_url,
        "result_path": payload.result_path,
        "task_id_path": payload.task_id_path,
        "task_query_endpoint": payload.task_query_endpoint,
        "enabled": 1 if payload.enabled else 0,
        "created_at": stamp,
        "updated_at": stamp,
    }
    items.append(item)
    _save(model_configs_path, items)
    return _obj(item)


def copy_model_config(config_id: int, user_id: int = 1) -> SimpleNamespace:
    items = _load(model_configs_path, [])
    source = next((item for item in items if int(item.get("id", 0)) == config_id and int(item.get("user_id", 0)) == user_id), None)
    if not source:
        raise HTTPException(status_code=404, detail="模型配置不存在")
    stamp = _now()
    copied = dict(source)
    copied["id"] = _next_id(items)
    copied["name"] = f"{source.get('name')} 副本"
    copied["enabled"] = 0
    copied["created_at"] = stamp
    copied["updated_at"] = stamp
    items.append(copied)
    _save(model_configs_path, items)
    return _obj(copied)


def update_model_config(config_id: int, payload: ModelConfigUpdate, user_id: int = 1) -> SimpleNamespace:
    items = _load(model_configs_path, [])
    target = next((item for item in items if int(item.get("id", 0)) == config_id and int(item.get("user_id", 0)) == user_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="模型配置不存在")

    updates = payload.model_dump(exclude_unset=True)
    target_type = updates.get("type") or target.get("type")
    if updates.get("enabled") is True:
        for item in items:
            if int(item.get("user_id", 0)) == user_id and item.get("type") == target_type:
                item["enabled"] = 0
                item["updated_at"] = _now()

    for key, value in updates.items():
        if key in {"headers_json", "params_json"}:
            target[key] = json.dumps(value, ensure_ascii=False) if value is not None else None
        elif key == "enabled":
            target[key] = 1 if value else 0
        elif key == "method" and value:
            target[key] = value.upper()
        else:
            target[key] = value
    target["updated_at"] = _now()
    _save(model_configs_path, items)
    return _obj(target)


def delete_model_config(config_id: int, user_id: int = 1) -> None:
    items = _load(model_configs_path, [])
    remaining = [item for item in items if not (int(item.get("id", 0)) == config_id and int(item.get("user_id", 0)) == user_id)]
    if len(remaining) == len(items):
        raise HTTPException(status_code=404, detail="模型配置不存在")
    _save(model_configs_path, remaining)


def list_characters(user_id: int = 1, gender: str | None = None, query: str | None = None) -> list[SimpleNamespace]:
    items = [item for item in _load(characters_path, _default_characters()) if int(item.get("user_id", 0)) == user_id]
    if gender and gender != "全部性别":
        items = [item for item in items if item.get("gender") == gender]
    if query:
        keyword = query.strip().lower()
        items = [item for item in items if keyword in str(item.get("name") or "").lower()]
    items.sort(key=lambda item: (item.get("created_at") or "", int(item.get("id", 0))), reverse=True)
    return [_obj(item) for item in items]


def get_character(character_id: int, user_id: int = 1) -> SimpleNamespace | None:
    for item in _load(characters_path, _default_characters()):
        if int(item.get("id", 0)) == character_id and int(item.get("user_id", 0)) == user_id:
            return _obj(item)
    return None


def create_character(payload: CharacterCreate, user_id: int = 1) -> SimpleNamespace:
    items = _load(characters_path, _default_characters())
    stamp = _now()
    data = payload.model_dump()
    item = {
        "id": _next_id(items),
        "user_id": user_id,
        **data,
        "created_at": stamp,
        "updated_at": stamp,
    }
    items.append(item)
    _save(characters_path, items)
    return _obj(item)


def update_character(character_id: int, payload: CharacterUpdate, user_id: int = 1) -> SimpleNamespace:
    items = _load(characters_path, _default_characters())
    target = next((item for item in items if int(item.get("id", 0)) == character_id and int(item.get("user_id", 0)) == user_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="角色不存在")
    target.update(payload.model_dump(exclude_unset=True))
    target["updated_at"] = _now()
    _save(characters_path, items)
    return _obj(target)


def delete_character(character_id: int, user_id: int = 1) -> None:
    items = _load(characters_path, _default_characters())
    remaining = [item for item in items if not (int(item.get("id", 0)) == character_id and int(item.get("user_id", 0)) == user_id)]
    if len(remaining) == len(items):
        raise HTTPException(status_code=404, detail="角色不存在")
    _save(characters_path, remaining)
