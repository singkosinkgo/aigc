# LeapAI AIGC Studio API 文档

## 基础约定

本地开发基础地址：

```text
http://127.0.0.1:8001/api
```

前端开发时通过 Vite proxy 使用相对路径：

```text
/api
```

请求体默认使用 JSON，文件上传使用 `multipart/form-data`。

错误响应：

```json
{
  "detail": "错误原因"
}
```

当前一期无登录鉴权。所有接口默认操作系统内置默认用户。

## 通用类型

### User

```ts
interface User {
  id: number;
  nickname: string | null;
  avatar_url: string | null;
  phone: string | null;
  email: string | null;
  balance: string;
}
```

### Work

```ts
type ContentType = 'script' | 'image' | 'video';

interface Work {
  id: number;
  user_id: number;
  title: string | null;
  type: ContentType;
  prompt: string | null;
  generation_params_json: string | null;
  reference_urls_json: string | null;
  content: string | null;
  file_url: string | null;
  thumbnail_url: string | null;
  model_id: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}
```

### ModelConfig

```ts
type ModelConfigType = 'script' | 'image' | 'video' | 'storage';

interface ModelConfig {
  id: number;
  user_id: number;
  name: string;
  type: ModelConfigType;
  endpoint: string;
  api_key?: string | null;
  api_key_masked?: string | null;
  method: string;
  headers_json?: Record<string, unknown> | null;
  params_json?: Record<string, unknown> | null;
  result_path?: string | null;
  task_id_path?: string | null;
  task_query_endpoint?: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}
```

### GenerateResponse

```ts
interface GenerateResponse {
  work: Work;
  raw_result?: unknown;
}
```

## 系统与用户

### GET /health

健康检查。

响应：

```json
{
  "status": "ok",
  "env": "local"
}
```

### GET /me

获取当前默认用户。

响应：`User`

## 上传

### POST /uploads/images

上传参考图。后端优先使用启用的 `storage` 配置上传到云空间；没有启用云空间时保存到本地 `/uploads/images`。

请求：

```text
Content-Type: multipart/form-data
file: File
```

限制：

- 只能上传图片
- 单张最大 10MB
- 支持 `.jpg .jpeg .png .webp .gif`

响应：

```json
{
  "url": "https://example.com/image.png"
}
```

## 作品

### GET /works

获取作品列表。

Query：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| work_type | `script | image | video` | 否 | 按类型筛选 |

响应：

```ts
Work[]
```

示例：

```http
GET /api/works?work_type=image
```

### GET /works/{work_id}/download

下载作品文件。

规则：

- `script` 返回 `.txt`
- `image` 返回图片文件
- `video` 返回视频文件
- 远程 URL 由后端代理下载并设置 `Content-Disposition`

响应：文件流。

常见错误：

```json
{ "detail": "作品不存在" }
{ "detail": "作品文件不存在" }
{ "detail": "下载远程文件失败" }
```

## 生成脚本

### POST /generate/script

读取当前启用的 `script` 模型配置，生成分镜脚本，并保存到 `works`。

请求：

```ts
interface ScriptGenerateRequest {
  prompt: string;
  script_type: string;
  duration_seconds: number;
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| prompt | string | 是 | 用户输入的创作需求 |
| script_type | string | 否 | 如 `宣传片`、`微短剧`、`带货视频`、`达人口播`，可为空 |
| duration_seconds | number | 是 | 5 到 300 秒 |

请求示例：

```json
{
  "prompt": "一款智能手表的科技感宣传片，突出健康监测和运动追踪",
  "script_type": "宣传片",
  "duration_seconds": 30
}
```

响应：`GenerateResponse`

响应中的 `work`：

- `type`: `script`
- `prompt`: 用户原始提示词
- `content`: 模型生成脚本内容，优先为 JSON 数组字符串
- `status`: `completed`

推荐 `content` 结构：

```json
[
  {
    "title": "开场",
    "duration_seconds": 5,
    "description": "角色/场景、分镜运镜、画面、旁白、BGM",
    "prompt": "用于生成分镜图的画面提示词"
  }
]
```

## 生成图片

### POST /generate/images

读取当前启用的 `image` 模型配置，生成图片，并保存到 `works`。

请求：

```ts
interface ImageGenerateRequest {
  aspect_ratio: string;
  resolution: string;
  shots: Array<{
    title: string;
    duration_seconds: number;
    prompt: string;
    reference_urls: string[];
  }>;
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| aspect_ratio | string | 是 | `16:9`、`9:16`、`1:1`、`3:4`、`4:3` |
| resolution | string | 是 | `1K`、`2K`、`4K` |
| shots | array | 是 | 每个元素生成一张图，最多 30 张 |
| shots[].title | string | 是 | 图片/分镜标题 |
| shots[].duration_seconds | number | 是 | 来源分镜时长，可用于记录 |
| shots[].prompt | string | 是 | 图片提示词 |
| shots[].reference_urls | string[] | 是 | 参考图 URL，可为空数组 |

请求示例：

```json
{
  "aspect_ratio": "16:9",
  "resolution": "1K",
  "shots": [
    {
      "title": "开场",
      "duration_seconds": 5,
      "prompt": "黄昏时的海边老灯塔，写实风格",
      "reference_urls": []
    }
  ]
}
```

响应：`GenerateResponse`

响应中的 `work`：

- `type`: `image`
- `prompt`: 实际生成使用的提示词集合
- `content`: 模型结果集合，通常可解析出图片 URL
- `file_url`: 第一张图片地址
- `thumbnail_url`: 第一张图片地址

说明：

- 当前 GPT Image 2 这类 chat/completions 图片模型不会直接吃独立比例字段，后端会把比例拼进 text，例如：`横版 16:9 电影画幅，黄昏时的海边老灯塔，写实风格`。
- 当生成数量为 1 时，直接使用用户提示词。
- 当生成数量大于 1 时，后端可使用启用的脚本模型拆分多条图片提示词，再并发调用图片模型。

## 生成视频

### POST /generate/video

读取当前启用的 `video` 模型配置，生成视频，并保存到 `works`。

请求：

```ts
interface VideoGenerateRequest {
  aspect_ratio: string;
  resolution: string;
  segments: Array<{
    title: string;
    duration_seconds: number;
    prompt: string;
    image_urls: string[];
  }>;
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| aspect_ratio | string | 是 | `16:9`、`9:16`、`1:1` |
| resolution | string | 是 | `720p`、`1080p` |
| segments | array | 是 | 视频分段，至少 1 条 |
| segments[].title | string | 是 | 分段标题 |
| segments[].duration_seconds | number | 是 | 分段时长 |
| segments[].prompt | string | 是 | 视频提示词 |
| segments[].image_urls | string[] | 是 | 分镜图或参考图 URL，可为空数组 |

请求示例：

```json
{
  "aspect_ratio": "16:9",
  "resolution": "720p",
  "segments": [
    {
      "title": "开场",
      "duration_seconds": 15,
      "prompt": "蓝色数字粒子通道，镜头向前高速推进，无字幕",
      "image_urls": []
    }
  ]
}
```

响应：`GenerateResponse`

响应中的 `work`：

- `type`: `video`
- `prompt`: 后端汇总的完整视频提示词
- `content`: 视频 URL 或模型原始结果
- `file_url`: 视频 URL
- `status`: `completed`

说明：

- 如果模型配置里有 `task_id_path` 和 `task_query_endpoint`，后端会提交任务后轮询结果。
- 轮询成功状态包括：`succeeded`、`success`、`completed`、`done`。
- 轮询失败状态包括：`failed`、`error`、`canceled`、`cancelled`。

## 模型配置

### GET /model-configs

获取模型配置列表。

Query：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| config_type | `script | image | video | storage` | 否 | 按配置类型筛选 |

响应：`ModelConfig[]`

注意：列表接口不返回明文 API Key，只返回 `api_key_masked`。

### GET /model-configs/{config_id}/secret

获取某条配置的明文 API Key。用于“眼睛”按钮查看。

响应：

```json
{
  "api_key": "sk-..."
}
```

### POST /model-configs

新增模型配置。

请求：

```ts
interface ModelConfigCreate {
  name: string;
  type: 'script' | 'image' | 'video' | 'storage';
  endpoint: string;
  api_key?: string | null;
  method?: string;
  headers_json?: Record<string, unknown> | null;
  params_json?: Record<string, unknown> | null;
  result_path?: string | null;
  task_id_path?: string | null;
  task_query_endpoint?: string | null;
  enabled?: boolean;
}
```

示例：

```json
{
  "name": "GPT Image 2",
  "type": "image",
  "endpoint": "https://api.apiyi.com/v1/chat/completions",
  "api_key": "sk-xxx",
  "method": "POST",
  "headers_json": {
    "Content-Type": "application/json"
  },
  "params_json": {
    "model": "gpt-image-2-all",
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": ""
          }
        ]
      }
    ]
  },
  "result_path": "choices.0.message.content",
  "enabled": true
}
```

响应：`ModelConfig`

### PUT /model-configs/{config_id}

更新模型配置。请求体字段同新增接口，支持部分更新。

如果 `enabled=true`，同用户同类型其他配置会自动置为未启用。

响应：`ModelConfig`

### POST /model-configs/{config_id}/copy

复制模型配置。

规则：

- 新配置名称为：`原名称 副本`
- API Key 和参数会复制
- 默认 `enabled=false`

响应：`ModelConfig`

### DELETE /model-configs/{config_id}

删除模型配置。

响应：

```json
{
  "ok": true
}
```

## 前端 API Client 对应关系

文件：`frontend/src/lib/api.ts`

| 方法 | 后端接口 |
| --- | --- |
| `getMe()` | `GET /me` |
| `getWorks(type?)` | `GET /works` |
| `uploadImage(file)` | `POST /uploads/images` |
| `generateScript(payload)` | `POST /generate/script` |
| `generateImages(payload)` | `POST /generate/images` |
| `generateVideo(payload)` | `POST /generate/video` |
| `getModelConfigs(type?)` | `GET /model-configs` |
| `createModelConfig(payload)` | `POST /model-configs` |
| `updateModelConfig(id, payload)` | `PUT /model-configs/{id}` |
| `getModelConfigSecret(id)` | `GET /model-configs/{id}/secret` |
| `copyModelConfig(id)` | `POST /model-configs/{id}/copy` |
| `deleteModelConfig(id)` | `DELETE /model-configs/{id}` |

## 后续接口拆分建议

当前生成接口是同步等待外部模型结果。后续如果前后端完全拆队列和测试压力，建议改成异步任务：

```text
POST /generate/images -> 返回 work_id + task_id
GET /works/{id}       -> 查询状态
GET /tasks/{id}       -> 查询模型任务进度
```

一期先保持现状，前端只按当前文档调用接口即可。
