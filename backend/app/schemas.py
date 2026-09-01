from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


ContentType = Literal["script", "image", "video"]
ModelConfigType = Literal["script", "image", "video", "storage"]
CharacterGender = Literal["女", "男", "未知"]
ThinkingModel = Literal["preset", "custom"]


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nickname: str | None
    avatar_url: str | None
    phone: str | None
    email: str | None
    balance: Decimal


class ModelConfigBase(BaseModel):
    name: str
    type: ModelConfigType
    endpoint: str
    api_key: str | None = None
    method: str = "POST"
    headers_json: dict[str, Any] | None = None
    params_json: dict[str, Any] | None = None
    portrait_url: str | None = None
    result_path: str | None = None
    task_id_path: str | None = None
    task_query_endpoint: str | None = None
    enabled: bool = True


class ModelConfigCreate(ModelConfigBase):
    pass


class ModelConfigUpdate(BaseModel):
    name: str | None = None
    type: ModelConfigType | None = None
    endpoint: str | None = None
    api_key: str | None = None
    method: str | None = None
    headers_json: dict[str, Any] | None = None
    params_json: dict[str, Any] | None = None
    portrait_url: str | None = None
    result_path: str | None = None
    task_id_path: str | None = None
    task_query_endpoint: str | None = None
    enabled: bool | None = None


class ModelConfigOut(ModelConfigBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    api_key_masked: str | None = None
    created_at: datetime
    updated_at: datetime


class WorkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    title: str | None
    type: ContentType
    prompt: str | None
    generation_params_json: str | None = None
    reference_urls_json: str | None = None
    content: str | None
    file_url: str | None
    thumbnail_url: str | None
    model_id: int | None
    status: str
    created_at: datetime
    updated_at: datetime


class WorksSummaryOut(BaseModel):
    counts: dict[str, int]
    items: list[WorkOut]


class CharacterAsset(BaseModel):
    type: Literal["image", "video", "audio", "file"]
    category: Literal["three_view", "expression", "audio", "video"] | None = None
    url: str | None = None
    name: str | None = None
    mime_type: str | None = None
    size: int | None = None


class CharacterBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    gender: CharacterGender = "未知"
    birthplace: str | None = None
    age: int | None = Field(default=None, ge=0, le=150)
    height_cm: int | None = Field(default=None, ge=0)
    weight_kg: float | None = Field(default=None, ge=0)
    skin_tone: str | None = None
    hairstyle: str | None = None
    clothing_style: str | None = None
    intro: str = ""
    tone: str | None = None
    portraits: int = Field(default=0, ge=0)
    voices: int = Field(default=0, ge=0)
    videos: int = Field(default=0, ge=0)
    memories: int = Field(default=0, ge=0)
    assets: list[CharacterAsset] = Field(default_factory=list)
    memory_files: list[CharacterAsset] = Field(default_factory=list)
    thinking_model: ThinkingModel = "preset"
    model_endpoint: str | None = None
    model_format: str | None = None
    api_key: str | None = None
    status: str = "active"


class CharacterCreate(CharacterBase):
    pass


class CharacterUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    gender: CharacterGender | None = None
    birthplace: str | None = None
    age: int | None = Field(default=None, ge=0, le=150)
    height_cm: int | None = Field(default=None, ge=0)
    weight_kg: float | None = Field(default=None, ge=0)
    skin_tone: str | None = None
    hairstyle: str | None = None
    clothing_style: str | None = None
    intro: str | None = None
    tone: str | None = None
    portraits: int | None = Field(default=None, ge=0)
    voices: int | None = Field(default=None, ge=0)
    videos: int | None = Field(default=None, ge=0)
    memories: int | None = Field(default=None, ge=0)
    assets: list[CharacterAsset] | None = None
    memory_files: list[CharacterAsset] | None = None
    thinking_model: ThinkingModel | None = None
    model_endpoint: str | None = None
    model_format: str | None = None
    api_key: str | None = None
    status: str | None = None


class CharacterOut(CharacterBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    api_key_masked: str | None = None
    created_at: datetime
    updated_at: datetime


class ScriptGenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=8000)
    script_type: str = ""
    duration_seconds: int = Field(default=15, ge=5, le=300)

    @model_validator(mode="after")
    def validate_general_duration(self) -> "ScriptGenerateRequest":
        if self.script_type in {"", "广告片", "通用"} and self.duration_seconds > 60:
            raise ValueError("通用脚本时长最多为 1 分钟")
        return self


class ImageShot(BaseModel):
    title: str
    duration_seconds: int = Field(default=5, ge=1, le=30)
    prompt: str
    reference_urls: list[str] = Field(default_factory=list)


class ImageGenerateRequest(BaseModel):
    shots: list[ImageShot]
    aspect_ratio: str = "16:9"
    resolution: str = "2K"


class VideoSegment(BaseModel):
    title: str
    duration_seconds: int = Field(default=5, ge=1, le=30)
    prompt: str
    image_urls: list[str] = Field(default_factory=list)
    image_inputs: list[dict[str, Any]] = Field(default_factory=list)
    video_urls: list[str] = Field(default_factory=list)
    audio_urls: list[str] = Field(default_factory=list)


class VideoGenerateRequest(BaseModel):
    segments: list[VideoSegment]
    aspect_ratio: str = "16:9"
    resolution: str = "720p"


class GenerateResponse(BaseModel):
    work: WorkOut
    raw_result: Any | None = None
