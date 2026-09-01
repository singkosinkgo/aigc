# LeapAI AIGC Studio 项目目录与架构

## 目标

一期目标是跑通 AIGC 主流程：

- 创作脚本
- 创作图片
- 创作视频
- 我的作品
- 我的模型

当前不做用户鉴权、账户消耗和付费。系统默认使用一个用户：`伦琴`。前端和后端通过 HTTP API 交互，数据库和模型调用细节由后端负责。

## 技术栈

前端：

- React
- TypeScript
- Vite
- Tailwind CSS
- Axios

后端：

- Python
- FastAPI
- SQLAlchemy
- Pydantic
- Uvicorn
- HTTPX

数据与外部服务：

- MySQL / MariaDB，当前通过 SSH tunnel 连接火山云 RDS
- `model_configs` 管理脚本、图片、视频、云空间的外部 API 配置
- 上传图片优先走启用的 `storage` 配置，未配置时回落到后端本地 `/uploads`

## 目录结构

```text
.
├── README.md
├── docs/
│   ├── PROJECT_ARCHITECTURE.md
│   └── API.md
├── backend/
│   ├── run.py
│   ├── requirements.txt
│   └── app/
│       ├── main.py                 # FastAPI 入口、路由、上传/下载、模型配置 CRUD
│       ├── config.py               # 环境变量配置
│       ├── database.py             # SQLAlchemy engine/session
│       ├── models.py               # users、works、model_configs ORM
│       ├── schemas.py              # API 请求/响应模型
│       ├── services.py             # 默认用户、模型配置输出、JSON helper
│       ├── model_runner.py         # 通用模型调用器，按 model_configs 拼接请求
│       ├── script_generation.py    # 脚本生成业务逻辑
│       ├── image_generation.py     # 图片生成业务逻辑
│       └── video_generation.py     # 视频生成业务逻辑
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx                 # 页面状态与主流程串联
│       ├── main.tsx
│       ├── styles.css
│       ├── components/
│       │   ├── Controls.tsx        # 通用按钮/选项卡控件
│       │   └── Sidebar.tsx         # 左侧导航
│       ├── pages/
│       │   ├── ScriptPage.tsx      # 创作脚本
│       │   ├── ImagePage.tsx       # 创作图片：通用/分镜图/商品套图
│       │   ├── VideoPage.tsx       # 创作视频
│       │   ├── WorksPage.tsx       # 我的作品
│       │   └── ModelsPage.tsx      # 我的模型
│       ├── lib/
│       │   ├── api.ts              # 前端 API client
│       │   └── shotParser.ts       # 脚本内容解析成分镜
│       ├── types/
│       │   └── index.ts            # 前端类型定义
│       └── assets/
│           └── image-empty.png
└── scripts/
    └── open-db-tunnel.sh
```

## 前后端边界

前端负责：

- 页面展示和交互
- 收集用户输入
- 上传本地参考图到后端
- 调用后端 API
- 按后端返回的 `work` 展示作品
- 在页面间传递当前脚本分镜、图片结果、视频分段

后端负责：

- 默认用户初始化
- 读取和维护 `model_configs`
- 拼接模型请求参数
- 调用脚本/图片/视频模型
- 调用云空间/图床上传
- 保存生成记录到 `works`
- 提供作品列表、下载、预览所需 URL

前端不应直接调用第三方模型 API，也不应持有模型 API Key。所有敏感信息必须在 `.env` 或数据库中，由后端读取。

## 核心数据表

### users

默认用户表。当前一期只使用默认用户。

关键字段：

- `id`
- `nickname`
- `avatar_url`
- `phone`
- `email`
- `password_hash`
- `balance`
- `created_at`
- `updated_at`

### works

生成记录表。脚本、图片、视频统一存在这里。

关键字段：

- `id`
- `user_id`
- `title`
- `type`: `script | image | video`
- `prompt`: 用户原始提示词或生成提示词集合
- `generation_params_json`: 本次生成任务参数 JSON
- `reference_urls_json`: 本次生成任务参考图 URL 列表 JSON
- `content`: 生成结果正文、JSON、URL 或 URL 列表
- `file_url`: 主文件地址
- `thumbnail_url`: 缩略图地址
- `model_id`
- `status`: `pending | processing | completed | failed`
- `created_at`
- `updated_at`

### model_configs

模型和云空间配置表。

关键字段：

- `id`
- `user_id`
- `name`
- `type`: `script | image | video | storage`
- `endpoint`
- `api_key`
- `method`
- `headers_json`
- `params_json`
- `result_path`
- `task_id_path`
- `task_query_endpoint`
- `enabled`
- `created_at`
- `updated_at`

同一用户同一 `type` 原则上只启用一条配置。后端创建/更新启用配置时会把同类型其他配置置为未启用。

## 主流程

### 创作脚本

```text
前端 ScriptPage
  -> POST /api/generate/script
后端 script_generation.py
  -> 读取启用 script model_config
  -> model_runner.py 调用外部模型
  -> 保存 works(type=script)
  -> 返回 GenerateResponse
前端
  -> parseShotsFromWorkContent(content)
  -> 得到 Shot[]，进入分镜图或视频
```

### 创作图片

```text
前端 ImagePage
  -> 如有本地参考图，先 POST /api/uploads/images
  -> POST /api/generate/images
后端 image_generation.py
  -> 读取启用 image model_config
  -> 多图时可读取 script model_config 拆分多条提示词
  -> 按数量并发调用图片模型
  -> 保存 works(type=image)
  -> 返回图片 URL 结果
```

### 创作视频

```text
前端 VideoPage
  -> 如有本地参考图，先 POST /api/uploads/images
  -> POST /api/generate/video
后端 video_generation.py
  -> 读取启用 video model_config
  -> 汇总 segments prompt/image_urls
  -> model_runner.py 提交视频任务
  -> 如配置 task_id_path/task_query_endpoint，则轮询任务结果
  -> 保存 works(type=video)
```

### 我的作品

```text
前端 WorksPage
  -> GET /api/works
  -> 按 type 分组展示
  -> 预览使用 work.file_url/content 解析出的 URL
  -> 下载使用 GET /api/works/{id}/download
```

### 我的模型

```text
前端 ModelsPage
  -> GET /api/model-configs
  -> POST /api/model-configs
  -> PUT /api/model-configs/{id}
  -> POST /api/model-configs/{id}/copy
  -> DELETE /api/model-configs/{id}
```

## 环境变量

后端读取 `backend/.env`。

必填或常用字段：

```env
ENV=local
DATABASE_URL=mysql+pymysql://...
DEFAULT_USER_PASSWORD=...
DEFAULT_USER_NICKNAME=伦琴
API_HOST=127.0.0.1
API_PORT=8001
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
MODEL_REQUEST_TIMEOUT=120
UPLOAD_DIR=uploads
PUBLIC_UPLOAD_BASE_URL=http://127.0.0.1:8001/uploads
```

前端通过 Vite dev server 代理 `/api` 到后端，业务代码只访问 `/api/...`。

## 协作约定

前端开发只依赖：

- `docs/API.md`
- `frontend/src/lib/api.ts`
- `frontend/src/types/index.ts`

后端开发只需要保证：

- API 路径、请求字段、响应字段稳定
- 错误统一使用 FastAPI `detail`
- 生成记录都落到 `works`
- 外部模型和云空间配置都来自 `model_configs`

测试暂时先不做。前后端通过接口文档对齐，避免一个人同时改 UI、改后端、测模型链路。
