from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.model_runner import call_model
from app.schemas import GenerateResponse, ImageGenerateRequest
from app.services import create_work, get_default_user, get_enabled_model_config


ASPECT_TEXT = {
    "16:9": "横版 16:9 电影画幅",
    "9:16": "竖版 9:16 手机画幅",
    "1:1": "正方形 1:1 画幅",
    "3:4": "竖图 3:4 画幅",
    "4:3": "横图 4:3 画幅",
}


def _with_aspect_text(prompt: str, aspect_ratio: str) -> str:
    aspect_text = ASPECT_TEXT.get(aspect_ratio.strip(), f"{aspect_ratio} 画幅")
    if aspect_text in prompt:
        return prompt
    return f"{aspect_text}，{prompt}"


def _parse_prompt_list(value: Any, expected: int, fallback: str) -> list[str]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            lines = [
                line.strip().lstrip("-").strip()
                for line in value.splitlines()
                if line.strip()
            ]
            prompts = [line.split("：", 1)[-1].split(":", 1)[-1].strip() for line in lines]
            prompts = [prompt for prompt in prompts if prompt]
            return (prompts + [fallback] * expected)[:expected]
    if isinstance(value, dict):
        value = value.get("prompts") or value.get("data") or value.get("items")
    if isinstance(value, list):
        prompts = [
            str(item.get("prompt") if isinstance(item, dict) else item).strip()
            for item in value
            if str(item.get("prompt") if isinstance(item, dict) else item).strip()
        ]
        return (prompts + [fallback] * expected)[:expected]
    return [fallback] * expected


def _ensure_prompt_count(prompts: list[str], expected: int, fallback: str) -> list[str]:
    clean = [prompt.strip() for prompt in prompts if prompt.strip()]
    return (clean + [fallback] * expected)[:expected]


def _first_url(value: Any) -> str | None:
    if isinstance(value, str):
        match = re.search(r"https?://[^\s\"'<>）)]+", value)
        return match.group(0) if match else None
    if isinstance(value, dict):
        for item in value.values():
            found = _first_url(item)
            if found:
                return found
    if isinstance(value, list):
        for item in value:
            found = _first_url(item)
            if found:
                return found
    return None


def _reference_urls(payload: ImageGenerateRequest) -> list[str]:
    urls: list[str] = []
    for shot in payload.shots:
        for url in shot.reference_urls:
            if url and url not in urls:
                urls.append(url)
    return urls


async def _build_image_prompts(db: Session, user_id: int, prompt: str, count: int) -> list[str]:
    if count <= 1:
        return [prompt]
    script_config = get_enabled_model_config(db, user_id, "script")
    instruction = (
        f"请基于以下用户图片生成需求，拆分成恰好 {count} 条图片提示词。\n"
        f"要求：只输出 JSON 数组，数组长度必须等于 {count}，不要输出解释文字。\n"
        "第 1 项对应第 1 次图片接口请求，第 2 项对应第 2 次图片接口请求，以此类推。\n"
        "如果用户要求不同颜色、不同角度、不同款式，请把这些差异分配到不同数组项中。\n"
        "每一项都是直接传给图片模型的一条完整 prompt。\n"
        f"用户需求：{prompt}"
    )
    result, _ = await call_model(script_config, {"prompt": instruction})
    return _ensure_prompt_count(_parse_prompt_list(result, count, prompt), count, prompt)


async def generate_images_work(db: Session, payload: ImageGenerateRequest) -> GenerateResponse:
    user = get_default_user(db)
    image_config = get_enabled_model_config(db, user.id, "image")
    count = max(1, len(payload.shots))
    if count > 30:
        raise HTTPException(status_code=400, detail="生成图片数量最多 30 张")
    base_prompt = payload.shots[0].prompt if payload.shots else ""
    prompts = await _build_image_prompts(db, user.id, base_prompt, count)
    prompts = _ensure_prompt_count(prompts, count, base_prompt)

    async def run_one(index: int, prompt: str):
        shot = payload.shots[min(index, len(payload.shots) - 1)]
        model_prompt = _with_aspect_text(prompt, payload.aspect_ratio)
        model_payload = payload.model_dump()
        model_payload["shots"] = [{
            "title": shot.title,
            "duration_seconds": shot.duration_seconds,
            "prompt": model_prompt,
            "reference_urls": shot.reference_urls,
        }]
        model_payload["prompt"] = model_prompt
        return await call_model(image_config, model_payload)

    pairs = await asyncio.gather(*(run_one(index, prompt) for index, prompt in enumerate(prompts)))
    results = [_first_url(result) or result for result, _ in pairs]
    raws = [raw for _, raw in pairs]
    file_url = next((item for item in results if isinstance(item, str) and item.startswith("http")), None)
    work_title = payload.shots[0].title if payload.shots else "生成图片"
    if count > 1:
        work_title = f"{work_title}等{count}张"
    work = create_work(
        db,
        user_id=user.id,
        title=work_title,
        type="image",
        prompt="\n".join(f"{idx + 1}. {prompt}" for idx, prompt in enumerate(prompts)),
        generation_params_json=json.dumps(payload.model_dump(), ensure_ascii=False),
        reference_urls_json=json.dumps(_reference_urls(payload), ensure_ascii=False),
        content=json.dumps(results, ensure_ascii=False),
        file_url=file_url,
        thumbnail_url=file_url,
        model_id=image_config.id,
        status="completed",
    )
    return GenerateResponse(work=work, raw_result=raws)
