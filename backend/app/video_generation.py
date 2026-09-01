from __future__ import annotations

import json
import asyncio
from copy import deepcopy
from datetime import datetime
from typing import Any

import httpx
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.config import get_settings
from app.model_runner import _deep_get, _json_loads, build_payload, call_model
from app.schemas import GenerateResponse, VideoGenerateRequest
from app.services import create_work, get_default_user, get_enabled_model_config


settings = get_settings()


class ModelSubmitError(Exception):
    def __init__(self, status_code: int, raw: Any, text: str):
        self.status_code = status_code
        self.raw = raw
        self.text = text


def _reference_urls(payload: VideoGenerateRequest) -> list[str]:
    urls: list[str] = []
    for segment in payload.segments:
        for url in segment.image_urls:
            if url and url not in urls:
                urls.append(url)
        for url in segment.video_urls:
            if url and url not in urls:
                urls.append(url)
        for url in segment.audio_urls:
            if url and url not in urls:
                urls.append(url)
        for item in segment.image_inputs:
            image_url = item.get("image_url")
            url = image_url.get("url") if isinstance(image_url, dict) else None
            if isinstance(url, str) and url and url not in urls:
                urls.append(url)
    return urls


def _content(raw: object) -> str:
    return raw if isinstance(raw, str) else json.dumps(raw, ensure_ascii=False)


def _video_url(config, raw: object) -> str | None:
    result = _deep_get(raw, config.result_path)
    return result if isinstance(result, str) and result.startswith("http") else None


def _auth_headers(config) -> dict[str, str]:
    headers = _json_loads(config.headers_json, {})
    if not isinstance(headers, dict):
        raise HTTPException(status_code=400, detail="headers_json 必须是 JSON 对象")
    if config.api_key:
        lower_headers = {str(key).lower(): value for key, value in headers.items()}
        if "authorization" not in lower_headers:
            api_key = str(config.api_key).strip()
            headers["Authorization"] = api_key if api_key.lower().startswith("bearer ") else f"Bearer {api_key}"
    return headers


def _params(config) -> dict[str, Any]:
    params = _json_loads(config.params_json, {})
    return params if isinstance(params, dict) else {}


def _private_avatar_group_payload(params: dict[str, Any]) -> dict[str, Any]:
    payload = params.get("private_avatar_group_payload")
    if isinstance(payload, dict) and payload:
        return payload
    return {
        "name": f"leap-private-avatar-{datetime.now().strftime('%Y%m%d%H%M%S')}",
        "description": "LeapAI private avatar fallback assets",
    }


def _configured_portrait_endpoint(config) -> str | None:
    value = (config.portrait_url or "").strip()
    if "/private-avatar/groups" in value:
        return value
    return None


def _configured_portrait_source(config) -> str | None:
    value = (config.portrait_url or "").strip()
    if not value or "/private-avatar/groups" in value:
        return None
    return value


def _public_error(exc: ModelSubmitError) -> HTTPException:
    return HTTPException(status_code=502, detail=f"模型接口请求失败: {exc.text[:500]}")


def _error_code(raw: Any) -> str:
    value = (
        _deep_get(raw, "code")
        or _deep_get(raw, "error.code")
        or _deep_get(raw, "data.code")
        or _deep_get(raw, "error.error_code")
    )
    return str(value) if value else ""


def _error_message(raw: Any, text: str) -> str:
    value = (
        _deep_get(raw, "message")
        or _deep_get(raw, "error.message")
        or _deep_get(raw, "data.message")
        or _deep_get(raw, "error.error_message")
    )
    return str(value) if value else text


def _needs_private_avatar_fallback_raw(raw: Any, text: str = "") -> bool:
    code = _error_code(raw)
    message = _error_message(raw, text).lower()
    return "privacyinformation" in f"{code} {message}".lower() and "real person" in message


def _needs_private_avatar_fallback(exc: ModelSubmitError) -> bool:
    return _needs_private_avatar_fallback_raw(exc.raw, exc.text)


def _private_avatar_asset_type(raw: Any, text: str = "") -> str:
    message = _error_message(raw, text).lower()
    if "input video" in message:
        return "video"
    if "input audio" in message:
        return "audio"
    return "image"


def _replace_reference_url(data: Any, source_url: str, target_url: str) -> Any:
    if isinstance(data, str):
        return target_url if data == source_url else data
    if isinstance(data, list):
        return [_replace_reference_url(item, source_url, target_url) for item in data]
    if isinstance(data, dict):
        return {key: _replace_reference_url(value, source_url, target_url) for key, value in data.items()}
    return data


def _first_reference_image_url(payload: VideoGenerateRequest) -> str | None:
    for segment in payload.segments:
        for url in segment.image_urls:
            if url:
                return url
        for item in segment.image_inputs:
            image_url = item.get("image_url")
            url = image_url.get("url") if isinstance(image_url, dict) else None
            if isinstance(url, str) and url:
                return url
    return None


def _first_reference_url_for_asset(data: Any, asset_type: str) -> str | None:
    urls = _reference_urls_for_asset(data, asset_type)
    return urls[0] if urls else None


def _reference_urls_for_asset(data: Any, asset_type: str) -> list[str]:
    url_keys = {
        "image": ("image_urls", "reference_urls", "images"),
        "video": ("video_urls", "videos"),
        "audio": ("audio_urls", "audios"),
    }.get(asset_type, ("image_urls", "reference_urls", "images"))
    role_keys = {
        "image": ("image_with_roles",),
        "video": ("video_with_roles",),
        "audio": ("audio_with_roles",),
    }.get(asset_type, ())
    urls: list[str] = []

    def add(url: str) -> None:
        if url and url not in urls:
            urls.append(url)

    def from_value(value: Any) -> None:
        if isinstance(value, str) and value:
            add(value)
            return
        if isinstance(value, dict):
            direct = value.get("url")
            if isinstance(direct, str) and direct:
                add(direct)
            for key in ("image_url", "video_url", "audio_url"):
                nested = value.get(key)
                if isinstance(nested, dict):
                    nested_url = nested.get("url")
                    if isinstance(nested_url, str) and nested_url:
                        add(nested_url)

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            for key in url_keys:
                urls = value.get(key)
                if isinstance(urls, list):
                    for item in urls:
                        from_value(item)
            for key in role_keys:
                items = value.get(key)
                if isinstance(items, list):
                    for item in items:
                        from_value(item)
            if asset_type == "image":
                image_inputs = value.get("image_inputs")
                if isinstance(image_inputs, list):
                    for item in image_inputs:
                        from_value(item)
            for nested in value.values():
                walk(nested)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(data)
    return urls


async def _submit_video_task(config, request_payload: dict) -> object:
    headers = _auth_headers(config)

    payload = build_payload(config, request_payload)
    method = (config.method or "POST").upper()
    async with httpx.AsyncClient(timeout=settings.model_request_timeout) as client:
        try:
            if method == "GET":
                response = await client.get(config.endpoint, params=payload, headers=headers)
            else:
                response = await client.request(method, config.endpoint, json=payload, headers=headers)
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"模型接口网络请求失败: {exc}") from exc

    content_type = response.headers.get("content-type", "")
    raw: Any = response.json() if "application/json" in content_type else response.text
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise ModelSubmitError(response.status_code, raw, response.text) from exc
    return raw


async def _post_json(config, url: str, payload: dict[str, Any]) -> Any:
    async with httpx.AsyncClient(timeout=settings.model_request_timeout) as client:
        response = await client.post(url, json=payload, headers=_auth_headers(config))
    content_type = response.headers.get("content-type", "")
    raw: Any = response.json() if "application/json" in content_type else response.text
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        text = response.text if isinstance(raw, str) else json.dumps(raw, ensure_ascii=False)
        raise HTTPException(status_code=502, detail=f"私有人像素材接口请求失败: {text[:500]}") from exc
    return raw


async def _get_json(config, url: str) -> Any:
    async with httpx.AsyncClient(timeout=settings.model_request_timeout) as client:
        response = await client.get(url, headers=_auth_headers(config))
    content_type = response.headers.get("content-type", "")
    raw: Any = response.json() if "application/json" in content_type else response.text
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        text = response.text if isinstance(raw, str) else json.dumps(raw, ensure_ascii=False)
        raise HTTPException(status_code=502, detail=f"私有人像素材状态查询失败: {text[:500]}") from exc
    return raw


async def _private_avatar_asset_id(config, source_url: str, asset_type: str) -> str:
    params = _params(config)
    group_endpoint = (
        _configured_portrait_endpoint(config)
        or params.get("private_avatar_group_endpoint")
        or "https://toapis.com/v1/videos/doubao-seedance-2-0/private-avatar/groups"
    )
    group_raw = await _post_json(config, group_endpoint, _private_avatar_group_payload(params))
    group_id = _deep_get(group_raw, "data.group_id") or _deep_get(group_raw, "group_id") or _deep_get(group_raw, "id")
    if not group_id:
        raise HTTPException(status_code=502, detail=f"创建私有人像素材组失败: {json.dumps(group_raw, ensure_ascii=False)[:500]}")

    asset_endpoint = params.get("private_avatar_asset_endpoint") or str(group_endpoint).replace("/groups", "/assets")
    asset_endpoint = str(asset_endpoint).replace("{group_id}", str(group_id))
    url_key = params.get("private_avatar_url_key") or "source_url"
    asset_raw = await _post_json(config, asset_endpoint, {
        "group_id": str(group_id),
        "asset_type": asset_type,
        str(url_key): source_url,
        "name": f"leap-{asset_type}-{datetime.now().strftime('%Y%m%d%H%M%S')}",
    })
    asset_id = _deep_get(asset_raw, "data.asset_id") or _deep_get(asset_raw, "asset_id") or _deep_get(asset_raw, "id")
    if not asset_id:
        raise HTTPException(status_code=502, detail=f"上传私有人像素材失败: {json.dumps(asset_raw, ensure_ascii=False)[:500]}")

    query_endpoint = params.get("private_avatar_asset_query_endpoint")
    if query_endpoint:
        query_endpoint = str(query_endpoint).replace("{group_id}", str(group_id)).replace("{asset_id}", str(asset_id))
    else:
        query_endpoint = f"{str(asset_endpoint).rstrip('/')}/{asset_id}"
    for _ in range(int(params.get("private_avatar_poll_attempts") or 24)):
        status_raw = await _get_json(config, query_endpoint)
        status = str(_deep_get(status_raw, "data.status") or _deep_get(status_raw, "status") or "").lower()
        if status == "active":
            return str(asset_id)
        if status == "failed":
            raise HTTPException(status_code=502, detail=f"私有人像素材处理失败: {json.dumps(status_raw, ensure_ascii=False)[:500]}")
        await asyncio.sleep(int(params.get("private_avatar_poll_interval") or 5))
    raise HTTPException(status_code=504, detail="私有人像素材仍在处理中，请稍后重试")


async def _submit_with_private_avatar(config, request_payload: dict[str, Any], asset_type: str = "image", fallback_portrait_url: str | None = None) -> object:
    portrait_urls = _reference_urls_for_asset(request_payload, asset_type)
    configured_source = (_configured_portrait_source(config) if asset_type == "image" else None) or fallback_portrait_url
    if configured_source and configured_source not in portrait_urls:
        portrait_urls.insert(0, configured_source)
    if not portrait_urls:
        media_label = {"image": "参考图", "video": "参考视频", "audio": "参考音频"}.get(asset_type, "参考素材")
        raise HTTPException(status_code=400, detail=f"当前任务没有可用的{media_label}，无法执行私有人像兜底")

    next_payload = deepcopy(request_payload)
    for portrait_url in portrait_urls:
        asset_id = await _private_avatar_asset_id(config, portrait_url, asset_type)
        next_payload = _replace_reference_url(next_payload, portrait_url, f"asset://{asset_id}")

    if next_payload == request_payload:
        role_key = {"image": "image_with_roles", "video": "video_with_roles", "audio": "audio_with_roles"}.get(asset_type, "image_with_roles")
        role = {"image": "reference_image", "video": "reference_video", "audio": "reference_audio"}.get(asset_type, "reference_image")
        for portrait_url in portrait_urls:
            asset_id = await _private_avatar_asset_id(config, portrait_url, asset_type)
            next_payload.setdefault(role_key, []).append({"url": f"asset://{asset_id}", "role": role})
    return await _submit_video_task(config, next_payload)


async def retry_video_payload_with_private_avatar(config, request_payload: dict[str, Any], error_raw: Any, error_text: str = "") -> object | None:
    if not ((_configured_portrait_endpoint(config) or config.portrait_url) and _needs_private_avatar_fallback_raw(error_raw, error_text)):
        return None
    asset_type = _private_avatar_asset_type(error_raw, error_text)
    return await _submit_with_private_avatar(config, request_payload, asset_type)


async def generate_video_work(db: Session, payload: VideoGenerateRequest) -> GenerateResponse:
    user = get_default_user(db)
    config = get_enabled_model_config(db, user.id, "video")
    if len(payload.segments) == 1:
        prompt = payload.segments[0].prompt
    else:
        prompt = "\n".join(f"{idx + 1}. {segment.prompt}" for idx, segment in enumerate(payload.segments))
    model_payload = payload.model_dump()
    model_payload["prompt"] = prompt
    if config.task_id_path and config.task_query_endpoint:
        try:
            raw = await _submit_video_task(config, model_payload)
        except ModelSubmitError as exc:
            if not ((_configured_portrait_endpoint(config) or config.portrait_url) and _needs_private_avatar_fallback(exc)):
                raise _public_error(exc) from exc
            asset_type = _private_avatar_asset_type(exc.raw, exc.text)
            try:
                raw = await _submit_with_private_avatar(config, model_payload, asset_type, _first_reference_image_url(payload) if asset_type == "image" else None)
            except ModelSubmitError as fallback_exc:
                raise _public_error(fallback_exc) from fallback_exc
        file_url = _video_url(config, raw)
        work = create_work(
            db,
            user_id=user.id,
            title="生成视频",
            type="video",
            prompt=prompt,
            generation_params_json=json.dumps(model_payload, ensure_ascii=False),
            reference_urls_json=json.dumps(_reference_urls(payload), ensure_ascii=False),
            content=_content(raw),
            file_url=file_url,
            model_id=config.id,
            status="completed" if file_url else "processing",
        )
        return GenerateResponse(work=work, raw_result=raw)

    result, raw = await call_model(config, model_payload)
    file_url = result if isinstance(result, str) else None
    content = _content(result)
    status = "completed" if file_url else "processing"
    work = create_work(
        db,
        user_id=user.id,
        title="生成视频",
        type="video",
        prompt=prompt,
        generation_params_json=json.dumps(model_payload, ensure_ascii=False),
        reference_urls_json=json.dumps(_reference_urls(payload), ensure_ascii=False),
        content=content,
        file_url=file_url,
        model_id=config.id,
        status=status,
    )
    return GenerateResponse(work=work, raw_result=raw)
