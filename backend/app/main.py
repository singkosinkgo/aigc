from __future__ import annotations

import json
import mimetypes
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.image_generation import generate_images_work
from app import local_store
from app.models import Character, ModelConfig, Work
from app.script_generation import generate_script_work
from app.schemas import (
    GenerateResponse,
    CharacterCreate,
    CharacterOut,
    CharacterUpdate,
    ImageGenerateRequest,
    ModelConfigCreate,
    ModelConfigOut,
    ModelConfigUpdate,
    ScriptGenerateRequest,
    UserOut,
    VideoGenerateRequest,
    WorkOut,
    WorksSummaryOut,
)
from app.services import character_out, dump_json, ensure_default_user, get_default_user, model_config_out
from app.video_generation import generate_video_work, retry_video_payload_with_private_avatar


settings = get_settings()
app = FastAPI(title=settings.app_name)
upload_dir = Path(settings.upload_dir)
image_upload_dir = upload_dir / "images"
media_upload_dir = upload_dir / "media"
image_upload_dir.mkdir(parents=True, exist_ok=True)
media_upload_dir.mkdir(parents=True, exist_ok=True)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    if settings.storage_mode == "local":
        local_store.ensure_default_user()
        return
    db = next(get_db())
    try:
        ensure_default_user(db)
    finally:
        db.close()


app.mount("/uploads", StaticFiles(directory=upload_dir), name="uploads")


def _json_loads(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def _deep_get(data: Any, path: str | None) -> Any:
    if not path:
        return data
    cursor = data
    for part in path.split("."):
        if isinstance(cursor, dict):
            cursor = cursor.get(part)
        elif isinstance(cursor, list) and part.isdigit():
            cursor = cursor[int(part)]
        else:
            return None
    return cursor


def get_app_db():
    if settings.storage_mode == "local":
        yield None
        return
    yield from get_db()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "env": settings.env}


@app.get("/api/me", response_model=UserOut)
def me(db: Session = Depends(get_app_db)):
    return get_default_user(db)


def _find_url(data: Any) -> str | None:
    if isinstance(data, str):
        return data if data.startswith(("http://", "https://")) else None
    if isinstance(data, dict):
        for key in ("url", "file_url", "fileUrl", "path", "src"):
            value = data.get(key)
            if isinstance(value, str) and value.startswith(("http://", "https://")):
                return value
        for value in data.values():
            found = _find_url(value)
            if found:
                return found
    if isinstance(data, list):
        for item in data:
            found = _find_url(item)
            if found:
                return found
    return None


async def _upload_to_local(file: UploadFile, content: bytes, suffix: str, folder: str = "images") -> dict[str, str]:
    filename = f"{uuid4().hex}{suffix}"
    target_dir = image_upload_dir if folder == "images" else media_upload_dir
    target = target_dir / filename
    target.write_bytes(content)
    return {"url": f"{settings.public_upload_base_url.rstrip('/')}/{folder}/{filename}"}


async def _upload_to_storage(config: ModelConfig, file: UploadFile, content: bytes, filename: str | None = None, content_type: str | None = None) -> dict[str, str]:
    headers = json.loads(config.headers_json or "{}")
    params = json.loads(config.params_json or "{}")
    field_name = params.get("field_name") or "file"

    if config.api_key and "x-api-key" not in {key.lower(): value for key, value in headers.items()}:
        headers["x-api-key"] = config.api_key

    files = {
        field_name: (
            filename or file.filename or "upload.png",
            content,
            content_type or file.content_type or "application/octet-stream",
        )
    }
    async with httpx.AsyncClient(timeout=settings.model_request_timeout) as client:
        response = await client.request((config.method or "POST").upper(), config.endpoint, files=files, headers=headers)

    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"文件上传失败: {response.text[:500]}") from exc

    content_type = response.headers.get("content-type", "")
    raw: Any = response.json() if "application/json" in content_type else response.text
    url = _deep_get(raw, config.result_path) or _find_url(raw)
    if not isinstance(url, str):
        raise HTTPException(status_code=502, detail=f"文件上传返回中没有找到地址: {json.dumps(raw, ensure_ascii=False)[:500]}")
    return {"url": url}


def _convert_m4a_to_mp3(content: bytes) -> bytes:
    ffmpeg = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
    if not Path(ffmpeg).exists() and shutil.which("ffmpeg") is None:
        raise HTTPException(status_code=500, detail="服务器未安装 ffmpeg，无法将 m4a 转为 mp3")
    with tempfile.TemporaryDirectory() as tmpdir:
        source = Path(tmpdir) / "input.m4a"
        target = Path(tmpdir) / "output.mp3"
        source.write_bytes(content)
        try:
            subprocess.run(
                [ffmpeg, "-y", "-i", str(source), "-codec:a", "libmp3lame", "-b:a", "192k", str(target)],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except (subprocess.CalledProcessError, FileNotFoundError) as exc:
            raise HTTPException(status_code=400, detail="m4a 转 mp3 失败") from exc
        return target.read_bytes()


def _media_duration_seconds(content: bytes, suffix: str) -> float | None:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return None
    with tempfile.TemporaryDirectory() as tmpdir:
        source = Path(tmpdir) / f"input{suffix}"
        source.write_bytes(content)
        try:
            result = subprocess.run(
                [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(source)],
                check=True,
                capture_output=True,
                text=True,
            )
        except (subprocess.CalledProcessError, FileNotFoundError, ValueError):
            return None
        try:
            return float(result.stdout.strip())
        except ValueError:
            return None


@app.post("/api/uploads/images")
async def upload_image(file: UploadFile = File(...), db: Session = Depends(get_app_db)) -> dict[str, str]:
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="只能上传图片文件")

    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        suffix = ".png"

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="图片不能超过 10MB")

    user = get_default_user(db)
    if settings.storage_mode == "local":
        configs = local_store.list_model_configs("storage")
        config = next((item for item in configs if item.user_id == user.id and int(item.enabled) == 1), None)
    else:
        config = db.scalar(
            select(ModelConfig)
            .where(ModelConfig.user_id == user.id, ModelConfig.type == "storage", ModelConfig.enabled == 1)
            .order_by(ModelConfig.updated_at.desc(), ModelConfig.id.desc())
        )
    if config:
        return await _upload_to_storage(config, file, content)
    return await _upload_to_local(file, content, suffix)


@app.post("/api/uploads/media")
async def upload_media(file: UploadFile = File(...), db: Session = Depends(get_app_db)) -> dict[str, str]:
    suffix = Path(file.filename or "").suffix.lower()
    content_type = file.content_type or "application/octet-stream"
    content = await file.read()

    media_type = ""
    filename = file.filename or f"upload{suffix or '.bin'}"
    if content_type.startswith("image/") or suffix in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
            suffix = ".png"
            filename = f"{Path(filename).stem}.png"
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="图片不能超过 10MB")
        media_type = "image"
    elif content_type.startswith("audio/") or suffix in {".mp3", ".wav", ".m4a"}:
        if suffix not in {".mp3", ".wav", ".m4a"}:
            raise HTTPException(status_code=400, detail="音频仅支持 MP3、WAV；m4a 会自动转为 mp3")
        if len(content) > 15 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="音频不能超过 15MB")
        if suffix == ".m4a":
            content = _convert_m4a_to_mp3(content)
            if len(content) > 15 * 1024 * 1024:
                raise HTTPException(status_code=400, detail="m4a 转 mp3 后不能超过 15MB")
            suffix = ".mp3"
            filename = f"{Path(filename).stem}.mp3"
            content_type = "audio/mpeg"
        duration = _media_duration_seconds(content, suffix)
        if duration is not None and duration > 15:
            raise HTTPException(status_code=400, detail="单个音频时长不能超过 15 秒")
        media_type = "audio"
    elif content_type.startswith("video/") or suffix in {".mp4", ".mov"}:
        if suffix not in {".mp4", ".mov"}:
            raise HTTPException(status_code=400, detail="视频仅支持 MP4、MOV")
        if len(content) > 50 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="视频不能超过 50MB")
        media_type = "video"
    elif content_type in {"text/plain", "text/markdown", "application/json"} or suffix in {".txt", ".md", ".json"}:
        if suffix not in {".txt", ".md", ".json"}:
            suffix = ".txt"
            filename = f"{Path(filename).stem}.txt"
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="文件不能超过 10MB")
        media_type = "file"
    else:
        raise HTTPException(status_code=400, detail="仅支持图片、MP4/MOV 视频、MP3/WAV 音频、TXT/MD/JSON 文件，m4a 会自动转为 mp3")

    user = get_default_user(db)
    if settings.storage_mode == "local":
        configs = local_store.list_model_configs("storage")
        config = next((item for item in configs if item.user_id == user.id and int(item.enabled) == 1), None)
    else:
        config = db.scalar(
            select(ModelConfig)
            .where(ModelConfig.user_id == user.id, ModelConfig.type == "storage", ModelConfig.enabled == 1)
            .order_by(ModelConfig.updated_at.desc(), ModelConfig.id.desc())
        )
    if config:
        result = await _upload_to_storage(config, file, content, filename=filename, content_type=content_type)
    else:
        result = await _upload_to_local(file, content, suffix, folder="media")
    return {**result, "type": media_type}


def _work_task_id(work: Work) -> str | None:
    if work.type != "video" or work.file_url:
        return None
    content = _json_loads(work.content, {})
    if not isinstance(content, dict):
        return None
    task_id = content.get("id") or content.get("task_id") or content.get("taskId")
    return str(task_id) if task_id else None


async def _query_video_task(config: ModelConfig, task_id: str) -> dict[str, Any] | None:
    if not config.task_query_endpoint:
        return None
    headers = _json_loads(config.headers_json, {})
    if not isinstance(headers, dict):
        headers = {}
    if config.api_key and "authorization" not in {str(key).lower(): value for key, value in headers.items()}:
        api_key = str(config.api_key).strip()
        headers["Authorization"] = api_key if api_key.lower().startswith("bearer ") else f"Bearer {api_key}"
    endpoint = config.task_query_endpoint.replace("{task_id}", task_id)
    async with httpx.AsyncClient(timeout=settings.model_request_timeout) as client:
        response = await client.get(endpoint, headers=headers)
        response.raise_for_status()
        return response.json()


async def _refresh_video_work(work: Work, config: ModelConfig, db: Session | None = None) -> Work:
    task_id = _work_task_id(work)
    if not task_id:
        return work
    try:
        task = await _query_video_task(config, task_id)
    except (httpx.HTTPError, ValueError):
        return work
    if not isinstance(task, dict):
        return work

    status = str(
        _deep_get(task, "status")
        or _deep_get(task, "state")
        or _deep_get(task, "data.status")
        or _deep_get(task, "data.state")
        or ""
    ).lower()
    result_path = config.result_path or "content.video_url"
    video_url = _deep_get(task, result_path)
    updates: dict[str, Any] = {"content": json.dumps(task, ensure_ascii=False)}
    if isinstance(video_url, str) and video_url.startswith("http"):
        updates["file_url"] = video_url
        updates["status"] = "completed"
    elif status in {"failed", "error", "canceled", "cancelled"}:
        request_payload = _json_loads(work.generation_params_json, {})
        if isinstance(request_payload, dict) and "asset://" not in json.dumps(request_payload, ensure_ascii=False):
            try:
                retried = await retry_video_payload_with_private_avatar(config, request_payload, task, json.dumps(task, ensure_ascii=False))
            except HTTPException:
                retried = None
            if isinstance(retried, dict):
                retry_video_url = _deep_get(retried, result_path)
                updates["content"] = json.dumps(retried, ensure_ascii=False)
                if isinstance(retry_video_url, str) and retry_video_url.startswith("http"):
                    updates["file_url"] = retry_video_url
                    updates["status"] = "completed"
                else:
                    updates["status"] = "processing"
            else:
                updates["status"] = "failed"
        else:
            updates["status"] = "failed"
    elif status in {"running", "processing", "pending", "queued", "created"}:
        updates["status"] = "processing"
    else:
        updates["status"] = work.status

    if settings.storage_mode == "local":
        refreshed = local_store.update_work(work.id, work.user_id, updates)
        return refreshed or work
    for key, value in updates.items():
        setattr(work, key, value)
    db.commit()
    db.refresh(work)
    return work


async def _refresh_video_works(works: list[Work], db: Session | None = None) -> list[Work]:
    pending = [work for work in works if _work_task_id(work)]
    if not pending:
        return works
    if settings.storage_mode == "local":
        configs = {config.id: config for config in local_store.list_model_configs("video")}
    else:
        config_ids = {work.model_id for work in pending if work.model_id}
        configs = {config.id: config for config in db.scalars(select(ModelConfig).where(ModelConfig.id.in_(config_ids)))}
    refreshed: list[Work] = []
    for work in works:
        config = configs.get(work.model_id)
        if config:
            refreshed.append(await _refresh_video_work(work, config, db))
        else:
            refreshed.append(work)
    return refreshed


def _works_summary_payload(items: list[Work], counts: dict[str, int]) -> dict[str, Any]:
    return {
        "counts": {
            "all": sum(counts.values()),
            "video": counts.get("video", 0),
            "image": counts.get("image", 0),
            "script": counts.get("script", 0),
        },
        "items": items,
    }


@app.get("/api/works/summary", response_model=WorksSummaryOut)
async def works_summary(db: Session = Depends(get_app_db)):
    limits = {"video": 4, "image": 7, "script": 5}
    if settings.storage_mode == "local":
        all_works = local_store.list_works()
        counts = {kind: sum(1 for work in all_works if work.type == kind) for kind in limits}
        selected: list[Work] = []
        for kind, limit in limits.items():
            selected.extend([work for work in all_works if work.type == kind][:limit])
        return _works_summary_payload(await _refresh_video_works(selected), counts)

    user = get_default_user(db)
    counts = {
        kind: db.scalar(select(func.count()).select_from(Work).where(Work.user_id == user.id, Work.type == kind)) or 0
        for kind in limits
    }
    selected: list[Work] = []
    for kind, limit in limits.items():
        stmt = (
            select(Work)
            .where(Work.user_id == user.id, Work.type == kind)
            .order_by(Work.created_at.desc(), Work.id.desc())
            .limit(limit)
        )
        selected.extend(list(db.scalars(stmt)))
    return _works_summary_payload(await _refresh_video_works(selected, db), counts)


@app.get("/api/works", response_model=list[WorkOut])
async def list_works(work_type: str | None = None, db: Session = Depends(get_app_db)):
    if settings.storage_mode == "local":
        return await _refresh_video_works(local_store.list_works(work_type))
    user = get_default_user(db)
    stmt = select(Work).where(Work.user_id == user.id).order_by(Work.created_at.desc(), Work.id.desc())
    if work_type:
        stmt = stmt.where(Work.type == work_type)
    return await _refresh_video_works(list(db.scalars(stmt)), db)


@app.get("/api/works/{work_id}", response_model=WorkOut)
async def get_work(work_id: int, db: Session = Depends(get_app_db)):
    user = get_default_user(db)
    if settings.storage_mode == "local":
        work = local_store.get_work(work_id, user.id)
        if not work:
            raise HTTPException(status_code=404, detail="作品不存在")
        return (await _refresh_video_works([work]))[0]
    work = db.scalar(select(Work).where(Work.id == work_id, Work.user_id == user.id))
    if not work:
        raise HTTPException(status_code=404, detail="作品不存在")
    return (await _refresh_video_works([work], db))[0]


def _download_filename(work: Work, extension: str) -> str:
    safe_title = "".join(
        char for char in (work.title or f"work-{work.id}") if char not in '\\/:*?"<>|\r\n\t'
    ).strip()
    if len(safe_title) > 60:
        safe_title = safe_title[:60].rstrip()
    return f"{safe_title or f'work-{work.id}'}{extension}"


def _content_disposition(filename: str) -> str:
    return f"attachment; filename*=UTF-8''{quote(filename)}"


def _work_file_url(work: Work) -> str:
    if work.file_url:
        return work.file_url
    if not work.content:
        return ""
    try:
        content = json.loads(work.content)
    except json.JSONDecodeError:
        return work.content if work.content.startswith(("http://", "https://", "/uploads/")) else ""
    for path in ("url", "file_url", "video_url", "image_url", "data.url", "content.video_url"):
        value = _deep_get(content, path)
        if isinstance(value, str) and value:
            return value
    return ""


@app.get("/api/works/{work_id}/download")
async def download_work(work_id: int, db: Session = Depends(get_app_db)):
    user = get_default_user(db)
    if settings.storage_mode == "local":
        work = local_store.get_work(work_id, user.id)
    else:
        work = db.scalar(select(Work).where(Work.id == work_id, Work.user_id == user.id))
    if not work:
        raise HTTPException(status_code=404, detail="作品不存在")

    if work.type == "script":
        filename = _download_filename(work, ".txt")
        return Response(
            content=work.content or "",
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": _content_disposition(filename)},
        )

    url = _work_file_url(work)
    if not url:
        raise HTTPException(status_code=404, detail="作品文件不存在")

    parsed = urlparse(url)
    extension = Path(parsed.path).suffix or (".mp4" if work.type == "video" else ".png")
    filename = _download_filename(work, extension)

    if parsed.scheme in {"", "file"} or url.startswith("/uploads/"):
        local_path = upload_dir / url.removeprefix("/uploads/")
        if not local_path.exists():
            raise HTTPException(status_code=404, detail="本地文件不存在")
        return FileResponse(
            local_path,
            filename=filename,
            media_type=mimetypes.guess_type(filename)[0] or "application/octet-stream",
        )

    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
        response = await client.get(url)
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail="下载远程文件失败") from exc

    media_type = response.headers.get("content-type") or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return Response(
        content=response.content,
        media_type=media_type,
        headers={"Content-Disposition": _content_disposition(filename)},
    )


@app.get("/api/model-configs", response_model=list[ModelConfigOut])
def list_model_configs(config_type: str | None = None, db: Session = Depends(get_app_db)):
    if settings.storage_mode == "local":
        return [model_config_out(config) for config in local_store.list_model_configs(config_type)]
    user = get_default_user(db)
    stmt = select(ModelConfig).where(ModelConfig.user_id == user.id).order_by(ModelConfig.type, ModelConfig.id.asc())
    if config_type:
        stmt = stmt.where(ModelConfig.type == config_type)
    return [model_config_out(config) for config in db.scalars(stmt)]


@app.get("/api/model-configs/{config_id}/secret")
def get_model_config_secret(config_id: int, db: Session = Depends(get_app_db)) -> dict[str, str | None]:
    user = get_default_user(db)
    if settings.storage_mode == "local":
        config = local_store.get_model_config(config_id, user.id)
    else:
        config = db.scalar(select(ModelConfig).where(ModelConfig.id == config_id, ModelConfig.user_id == user.id))
    if not config:
        raise HTTPException(status_code=404, detail="模型配置不存在")
    return {"api_key": config.api_key}


@app.post("/api/model-configs", response_model=ModelConfigOut)
def create_model_config(payload: ModelConfigCreate, db: Session = Depends(get_app_db)):
    user = get_default_user(db)
    if settings.storage_mode == "local":
        return model_config_out(local_store.create_model_config(payload, user.id))
    if payload.enabled:
        db.query(ModelConfig).filter(ModelConfig.user_id == user.id, ModelConfig.type == payload.type).update({"enabled": 0})
    config = ModelConfig(
        user_id=user.id,
        name=payload.name,
        type=payload.type,
        endpoint=payload.endpoint,
        api_key=payload.api_key,
        method=payload.method.upper(),
        headers_json=dump_json(payload.headers_json),
        params_json=dump_json(payload.params_json),
        portrait_url=payload.portrait_url,
        result_path=payload.result_path,
        task_id_path=payload.task_id_path,
        task_query_endpoint=payload.task_query_endpoint,
        enabled=1 if payload.enabled else 0,
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    return model_config_out(config)


@app.post("/api/model-configs/{config_id}/copy", response_model=ModelConfigOut)
def copy_model_config(config_id: int, db: Session = Depends(get_app_db)):
    user = get_default_user(db)
    if settings.storage_mode == "local":
        return model_config_out(local_store.copy_model_config(config_id, user.id))
    source = db.scalar(select(ModelConfig).where(ModelConfig.id == config_id, ModelConfig.user_id == user.id))
    if not source:
        raise HTTPException(status_code=404, detail="模型配置不存在")
    config = ModelConfig(
        user_id=user.id,
        name=f"{source.name} 副本",
        type=source.type,
        endpoint=source.endpoint,
        api_key=source.api_key,
        method=source.method,
        headers_json=source.headers_json,
        params_json=source.params_json,
        portrait_url=source.portrait_url,
        result_path=source.result_path,
        task_id_path=source.task_id_path,
        task_query_endpoint=source.task_query_endpoint,
        enabled=0,
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    return model_config_out(config)


@app.put("/api/model-configs/{config_id}", response_model=ModelConfigOut)
def update_model_config(config_id: int, payload: ModelConfigUpdate, db: Session = Depends(get_app_db)):
    user = get_default_user(db)
    if settings.storage_mode == "local":
        return model_config_out(local_store.update_model_config(config_id, payload, user.id))
    config = db.scalar(select(ModelConfig).where(ModelConfig.id == config_id, ModelConfig.user_id == user.id))
    if not config:
        raise HTTPException(status_code=404, detail="模型配置不存在")

    updates = payload.model_dump(exclude_unset=True)
    if updates.get("enabled") is True:
        db.query(ModelConfig).filter(ModelConfig.user_id == user.id, ModelConfig.type == (updates.get("type") or config.type)).update({"enabled": 0})

    for key, value in updates.items():
        if key in {"headers_json", "params_json"}:
            setattr(config, key, dump_json(value))
        elif key == "enabled":
            setattr(config, key, 1 if value else 0)
        elif key == "method" and value:
            setattr(config, key, value.upper())
        else:
            setattr(config, key, value)
    db.commit()
    db.refresh(config)
    return model_config_out(config)


@app.delete("/api/model-configs/{config_id}")
def delete_model_config(config_id: int, db: Session = Depends(get_app_db)):
    user = get_default_user(db)
    if settings.storage_mode == "local":
        local_store.delete_model_config(config_id, user.id)
        return {"ok": True}
    config = db.scalar(select(ModelConfig).where(ModelConfig.id == config_id, ModelConfig.user_id == user.id))
    if not config:
        raise HTTPException(status_code=404, detail="模型配置不存在")
    db.delete(config)
    db.commit()
    return {"ok": True}


@app.get("/api/characters", response_model=list[CharacterOut])
def list_characters(gender: str | None = None, query: str | None = None, db: Session = Depends(get_app_db)):
    user = get_default_user(db)
    if settings.storage_mode == "local":
        return [character_out(character) for character in local_store.list_characters(user.id, gender, query)]
    stmt = select(Character).where(Character.user_id == user.id).order_by(Character.created_at.desc(), Character.id.desc())
    if gender and gender != "全部性别":
        stmt = stmt.where(Character.gender == gender)
    if query:
        stmt = stmt.where(Character.name.like(f"%{query.strip()}%"))
    return [character_out(character) for character in db.scalars(stmt)]


@app.post("/api/characters", response_model=CharacterOut)
def create_character(payload: CharacterCreate, db: Session = Depends(get_app_db)):
    user = get_default_user(db)
    if settings.storage_mode == "local":
        return character_out(local_store.create_character(payload, user.id))
    character = Character(
        user_id=user.id,
        name=payload.name,
        gender=payload.gender,
        birthplace=payload.birthplace,
        age=payload.age,
        height_cm=payload.height_cm,
        weight_kg=payload.weight_kg,
        skin_tone=payload.skin_tone,
        hairstyle=payload.hairstyle,
        clothing_style=payload.clothing_style,
        intro=payload.intro,
        tone=payload.tone,
        portraits=payload.portraits,
        voices=payload.voices,
        videos=payload.videos,
        memories=payload.memories,
        assets_json=dump_json([item.model_dump() for item in payload.assets]),
        memories_json=dump_json([item.model_dump() for item in payload.memory_files]),
        thinking_model=payload.thinking_model,
        model_endpoint=payload.model_endpoint,
        model_format=payload.model_format,
        api_key=payload.api_key,
        status=payload.status,
    )
    db.add(character)
    db.commit()
    db.refresh(character)
    return character_out(character)


@app.put("/api/characters/{character_id}", response_model=CharacterOut)
def update_character(character_id: int, payload: CharacterUpdate, db: Session = Depends(get_app_db)):
    user = get_default_user(db)
    if settings.storage_mode == "local":
        return character_out(local_store.update_character(character_id, payload, user.id))
    character = db.scalar(select(Character).where(Character.id == character_id, Character.user_id == user.id))
    if not character:
        raise HTTPException(status_code=404, detail="角色不存在")
    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        if key == "assets":
            character.assets_json = dump_json([item.model_dump() if hasattr(item, "model_dump") else item for item in value])
        elif key == "memory_files":
            character.memories_json = dump_json([item.model_dump() if hasattr(item, "model_dump") else item for item in value])
        else:
            setattr(character, key, value)
    db.commit()
    db.refresh(character)
    return character_out(character)


@app.delete("/api/characters/{character_id}")
def delete_character(character_id: int, db: Session = Depends(get_app_db)):
    user = get_default_user(db)
    if settings.storage_mode == "local":
        local_store.delete_character(character_id, user.id)
        return {"ok": True}
    character = db.scalar(select(Character).where(Character.id == character_id, Character.user_id == user.id))
    if not character:
        raise HTTPException(status_code=404, detail="角色不存在")
    db.delete(character)
    db.commit()
    return {"ok": True}


@app.post("/api/generate/script", response_model=GenerateResponse)
async def generate_script(payload: ScriptGenerateRequest, db: Session = Depends(get_app_db)):
    return await generate_script_work(db, payload)


@app.post("/api/generate/images", response_model=GenerateResponse)
async def generate_images(payload: ImageGenerateRequest, db: Session = Depends(get_app_db)):
    return await generate_images_work(db, payload)


@app.post("/api/generate/video", response_model=GenerateResponse)
async def generate_video(payload: VideoGenerateRequest, db: Session = Depends(get_app_db)):
    return await generate_video_work(db, payload)
