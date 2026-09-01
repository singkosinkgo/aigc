from __future__ import annotations

import json
from copy import deepcopy
from typing import Any
import asyncio

import httpx
from fastapi import HTTPException

from app.config import get_settings
from app.models import ModelConfig


settings = get_settings()


def _json_loads(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"模型配置 JSON 格式错误: {exc}") from exc


def _deep_set(data: dict[str, Any], path: str, value: Any) -> None:
    parts = [part for part in path.split(".") if part]
    cursor = data
    for part in parts[:-1]:
        if part not in cursor or not isinstance(cursor[part], dict):
            cursor[part] = {}
        cursor = cursor[part]
    if parts:
        cursor[parts[-1]] = value


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


def _collect_reference_urls(request_payload: dict[str, Any]) -> list[str]:
    urls: list[str] = []

    def add(value: Any) -> None:
        if isinstance(value, str) and value and value not in urls:
            urls.append(value)

    for key in ("image_urls", "reference_urls", "images"):
        value = request_payload.get(key)
        if isinstance(value, list):
            for item in value:
                add(item)

    for collection_key in ("segments", "shots"):
        collection = request_payload.get(collection_key)
        if not isinstance(collection, list):
            continue
        for item in collection:
            if not isinstance(item, dict):
                continue
            has_role_images = isinstance(item.get("image_inputs"), list) and bool(item.get("image_inputs"))
            for key in ("image_urls", "reference_urls", "images"):
                if has_role_images and key == "image_urls":
                    continue
                value = item.get(key)
                if isinstance(value, list):
                    for url in value:
                        add(url)

    return urls


def _collect_reference_items(request_payload: dict[str, Any]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()

    def add(url: Any, role: str = "reference_image", media_type: str = "image") -> None:
        if not isinstance(url, str) or not url:
            return
        key = (url, role, media_type)
        if key in seen:
            return
        seen.add(key)
        if media_type == "video":
            items.append({"type": "video_url", "video_url": {"url": url}, "role": role})
        elif media_type == "audio":
            items.append({"type": "audio_url", "audio_url": {"url": url}, "role": role})
        else:
            items.append({"type": "image_url", "image_url": {"url": url}, "role": role})

    for url in _collect_reference_urls(request_payload):
        add(url)

    for collection_key in ("segments", "shots"):
        collection = request_payload.get(collection_key)
        if not isinstance(collection, list):
            continue
        for item in collection:
            if not isinstance(item, dict):
                continue
            image_inputs = item.get("image_inputs")
            if isinstance(image_inputs, list):
                for image_input in image_inputs:
                    if not isinstance(image_input, dict):
                        continue
                    image_url = image_input.get("image_url")
                    url = image_url.get("url") if isinstance(image_url, dict) else None
                    role = image_input.get("role")
                    add(url, role if isinstance(role, str) else "reference_image")
            for media_key, media_type, default_role in (
                ("video_urls", "video", "reference_video"),
                ("audio_urls", "audio", "reference_audio"),
            ):
                urls = item.get(media_key)
                if isinstance(urls, list):
                    for url in urls:
                        add(url, default_role, media_type)

    return items


def _request_duration(request_payload: dict[str, Any]) -> int | None:
    value = request_payload.get("duration")
    if isinstance(value, (int, float)) and value > 0:
        return int(value)

    segments = request_payload.get("segments")
    if not isinstance(segments, list):
        return None
    total = 0
    for segment in segments:
        if not isinstance(segment, dict):
            continue
        duration = segment.get("duration_seconds")
        if isinstance(duration, (int, float)) and duration > 0:
            total += int(duration)
    return total or None


def _sora_duration(duration: int | None) -> int:
    if duration is None:
        return 12
    allowed = [4, 8, 12]
    return min(allowed, key=lambda item: abs(item - duration))


def _apply_sora2_payload(payload: dict[str, Any], request_payload: dict[str, Any]) -> dict[str, Any]:
    prompt = request_payload.get("prompt")
    if prompt:
        payload["prompt"] = prompt
    if "aspect_ratio" in request_payload:
        payload["aspect_ratio"] = request_payload["aspect_ratio"]
    payload["duration"] = _sora_duration(_request_duration(request_payload))

    image_urls = _collect_reference_urls(request_payload)
    if image_urls:
        payload["image_urls"] = image_urls
    elif "image_urls" in payload:
        payload["image_urls"] = []
    return payload


def _apply_content_payload(payload: dict[str, Any], request_payload: dict[str, Any]) -> dict[str, Any]:
    content = payload.get("content")
    if not isinstance(content, list):
        return payload

    prompt = request_payload.get("prompt")
    if prompt:
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                item["text"] = prompt
                break
        else:
            content.insert(0, {"type": "text", "text": prompt})

    for item in _collect_reference_items(request_payload):
        content.append(item)

    if "aspect_ratio" in request_payload and "ratio" in payload:
        payload["ratio"] = request_payload["aspect_ratio"]
    if "resolution" in request_payload and "resolution" in payload:
        payload["resolution"] = request_payload["resolution"]
    duration = _request_duration(request_payload)
    if duration is not None and "duration" in payload:
        payload["duration"] = duration
    return payload


def _apply_messages_payload(payload: dict[str, Any], request_payload: dict[str, Any]) -> dict[str, Any]:
    messages = payload.get("messages")
    if not isinstance(messages, list):
        return payload

    prompt = request_payload.get("prompt")
    if not prompt:
        return payload

    user_message = None
    for message in reversed(messages):
        if isinstance(message, dict) and message.get("role") == "user":
            user_message = message
            break
    if user_message is None:
        user_message = {"role": "user", "content": []}
        messages.append(user_message)

    content = user_message.get("content")
    if isinstance(content, list):
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                item["text"] = prompt
                break
        else:
            content.insert(0, {"type": "text", "text": prompt})

        for item in _collect_reference_items(request_payload):
            content.append(item)
    else:
        user_message["content"] = prompt

    return payload


def _apply_image_with_roles_payload(payload: dict[str, Any], request_payload: dict[str, Any]) -> dict[str, Any]:
    prompt = request_payload.get("prompt")
    if prompt:
        payload["prompt"] = prompt

    if "aspect_ratio" in request_payload:
        payload["aspect_ratio"] = request_payload["aspect_ratio"]
    if "resolution" in request_payload:
        payload["resolution"] = request_payload["resolution"]
    duration = _request_duration(request_payload)
    if duration is not None:
        payload["duration"] = duration

    images: list[dict[str, Any]] = []
    videos: list[dict[str, Any]] = []
    audios: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    def add(collection: list[dict[str, Any]], url: Any, role: str) -> None:
        if not isinstance(url, str) or not url:
            return
        key = (url, role)
        if key in seen:
            return
        seen.add(key)
        collection.append({"url": url, "role": role})

    for item in _collect_reference_items(request_payload):
        media_type = item.get("type")
        if media_type == "image_url":
            value = item.get("image_url")
            role = item.get("role") if isinstance(item.get("role"), str) else "reference_image"
            add(images, value.get("url") if isinstance(value, dict) else None, role)
        elif media_type == "video_url":
            value = item.get("video_url")
            add(videos, value.get("url") if isinstance(value, dict) else None, "reference_video")
        elif media_type == "audio_url":
            value = item.get("audio_url")
            add(audios, value.get("url") if isinstance(value, dict) else None, "reference_audio")

    for item in request_payload.get("image_with_roles") or []:
        if isinstance(item, dict):
            add(images, item.get("url"), str(item.get("role") or "reference_image"))

    for item in payload.get("image_with_roles") or []:
        if isinstance(item, dict):
            add(images, item.get("url"), str(item.get("role") or "reference_image"))

    payload["image_with_roles"] = images
    if "video_with_roles" in payload or videos:
        payload["video_with_roles"] = videos
    if "audio_with_roles" in payload or audios:
        payload["audio_with_roles"] = audios
    return payload


def build_payload(config: ModelConfig, request_payload: dict[str, Any]) -> dict[str, Any]:
    params = _json_loads(config.params_json, {})
    if not isinstance(params, dict):
        raise HTTPException(status_code=400, detail="params_json 必须是 JSON 对象")

    payload = deepcopy(params)
    if isinstance(payload.get("content"), list):
        return _apply_content_payload(payload, request_payload)
    if isinstance(payload.get("messages"), list):
        return _apply_messages_payload(payload, request_payload)
    if isinstance(payload.get("image_with_roles"), list):
        return _apply_image_with_roles_payload(payload, request_payload)
    if payload.get("model") == "sora-2-vvip":
        return _apply_sora2_payload(payload, request_payload)

    if "prompt" in request_payload:
        if "prompt" not in payload:
            payload["prompt"] = request_payload["prompt"]
        else:
            payload["prompt"] = request_payload["prompt"]
    if "messages" in payload and isinstance(payload["messages"], list) and request_payload.get("prompt"):
        payload["messages"].append({"role": "user", "content": request_payload["prompt"]})

    for key, value in request_payload.items():
        if key != "prompt":
            payload[key] = value
    return payload


async def call_model(config: ModelConfig, request_payload: dict[str, Any]) -> tuple[Any, Any]:
    headers = _json_loads(config.headers_json, {})
    if not isinstance(headers, dict):
        raise HTTPException(status_code=400, detail="headers_json 必须是 JSON 对象")

    if config.api_key and "Authorization" not in headers:
        headers["Authorization"] = f"Bearer {config.api_key}"

    payload = build_payload(config, request_payload)
    method = (config.method or "POST").upper()

    async with httpx.AsyncClient(timeout=settings.model_request_timeout) as client:
        response: httpx.Response | None = None
        max_timeout_retries = 3
        for attempt in range(max_timeout_retries + 1):
            try:
                if method == "GET":
                    response = await client.get(config.endpoint, params=payload, headers=headers)
                else:
                    response = await client.request(method, config.endpoint, json=payload, headers=headers)
                break
            except httpx.TimeoutException as exc:
                if attempt < max_timeout_retries:
                    await asyncio.sleep(2**attempt)
                    continue
                error_type = type(exc).__name__
                error_message = str(exc).strip()
                detail = f"{error_type}: {error_message}" if error_message else error_type
                raise HTTPException(
                    status_code=504,
                    detail=f"模型接口请求超时，自动重试 {max_timeout_retries} 次后仍失败: {detail}",
                ) from exc
            except httpx.RequestError as exc:
                error_type = type(exc).__name__
                error_message = str(exc).strip()
                detail = f"{error_type}: {error_message}" if error_message else error_type
                raise HTTPException(status_code=502, detail=f"模型接口网络请求失败: {detail}") from exc

        if response is None:
            raise HTTPException(status_code=502, detail="模型接口未返回响应")

        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=502, detail=f"模型接口请求失败: {response.text[:500]}") from exc

        content_type = response.headers.get("content-type", "")
        raw: Any = response.json() if "application/json" in content_type else response.text

        if isinstance(raw, dict) and config.task_id_path and config.task_query_endpoint:
            task_id = _deep_get(raw, config.task_id_path)
            if task_id:
                query_endpoint = config.task_query_endpoint.replace("{task_id}", str(task_id))
                task_completed = False
                for _ in range(90):
                    await asyncio.sleep(5)
                    poll_response = await client.get(query_endpoint, headers=headers)
                    try:
                        poll_response.raise_for_status()
                    except httpx.HTTPStatusError as exc:
                        raise HTTPException(status_code=502, detail=f"模型任务查询失败: {poll_response.text[:500]}") from exc

                    poll_content_type = poll_response.headers.get("content-type", "")
                    poll_raw: Any = poll_response.json() if "application/json" in poll_content_type else poll_response.text
                    if not isinstance(poll_raw, dict):
                        raw = poll_raw
                        break

                    status = (
                        _deep_get(poll_raw, "status")
                        or _deep_get(poll_raw, "state")
                        or _deep_get(poll_raw, "data.status")
                        or _deep_get(poll_raw, "data.state")
                    )
                    raw = poll_raw
                    if str(status).lower() in {"succeeded", "success", "completed", "done"}:
                        task_completed = True
                        break
                    if str(status).lower() in {"failed", "error", "canceled", "cancelled"}:
                        raise HTTPException(status_code=502, detail=f"模型任务失败: {json.dumps(poll_raw, ensure_ascii=False)[:500]}")
                if not task_completed:
                    raise HTTPException(status_code=504, detail=f"模型任务仍在处理中，请稍后重试: {json.dumps(raw, ensure_ascii=False)[:500]}")

    result = _deep_get(raw, config.result_path)
    if result is None:
        result = raw
    return result, raw
