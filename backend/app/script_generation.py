from __future__ import annotations

import json

from sqlalchemy.orm import Session

from app.model_runner import call_model
from app.schemas import GenerateResponse, ScriptGenerateRequest
from app.services import create_work, get_default_user, get_enabled_model_config


def _build_script_prompt(payload: ScriptGenerateRequest) -> str:
    script_type = payload.script_type.strip()
    if script_type == "微短剧":
        return payload.prompt
    if not script_type:
        return (
            f"请根据用户输入创作一段时长为【{payload.duration_seconds}秒】的视频分镜脚本，2-5秒一个分镜。\n"
            "只输出 JSON 数组，不要输出解释文字，不要使用 Markdown。\n"
            "数组每一项字段固定为：title、duration_seconds、description、prompt。\n"
            "description 包含角色/场景、分镜运镜、画面、旁白、BGM，单项不超过100字。\n"
            "prompt 是用于生成分镜图的画面提示词，单项不超过100字。\n"
            f"用户输入：{payload.prompt}"
        )
    instruction = (
        f"请创作一段类型为【{script_type}】的脚本，时长为【{payload.duration_seconds}秒】，2-5秒一个分镜。分镜格式：\n"
        "1、名称/时长；\n"
        "2、角色/场景；\n"
        "3、分镜运镜、画面、旁白、BGM\n"
        "每段分镜总长度不超过100字。\n"
        "只输出 JSON 数组，不要输出解释文字，不要使用 Markdown。\n"
        "数组每一项字段固定为：title、duration_seconds、description、prompt。\n"
        "duration_seconds 必须是数字，所有分镜时长总和应等于用户选择的总时长。\n"
        "description 包含角色/场景、分镜运镜、画面、旁白、BGM。\n"
        "prompt 是用于生成分镜图的画面提示词。"
    )
    return f"{instruction}\n\n用户输入：{payload.prompt}"


async def generate_script_work(db: Session, payload: ScriptGenerateRequest) -> GenerateResponse:
    user = get_default_user(db)
    config = get_enabled_model_config(db, user.id, "script")
    model_prompt = _build_script_prompt(payload)
    model_payload = {
        "prompt": model_prompt,
        "script_type": payload.script_type,
        "duration_seconds": payload.duration_seconds,
    }
    result, raw = await call_model(config, model_payload)
    content = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
    work = create_work(
        db,
        user_id=user.id,
        title=payload.prompt[:80],
        type="script",
        prompt=payload.prompt,
        generation_params_json=json.dumps(payload.model_dump(), ensure_ascii=False),
        reference_urls_json=json.dumps([], ensure_ascii=False),
        content=content,
        model_id=config.id,
        status="completed",
    )
    return GenerateResponse(work=work, raw_result=raw)
