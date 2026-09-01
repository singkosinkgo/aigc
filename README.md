# LeapAI AIGC Studio

一期目标：本地前后端跑通 AIGC 主流程，数据库通过 ECS SSH tunnel 连接火山云 RDS。

## 本地数据库通道

先在一个终端保持 SSH tunnel：

```bash
ssh -N -L 13306:mysql77ecea7583e8.rds.ivolces.com:3306 root@115.190.6.97
```

后端会读取 `backend/.env` 中的 `DATABASE_URL`，连接 `127.0.0.1:13306/aigc`。

## 后端

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python run.py
```

启动时会确保默认用户存在：`伦琴`。

## 前端

```bash
cd frontend
npm install
npm run dev
```

访问：

```text
http://127.0.0.1:5173
```

## 一期说明

- 不做用户鉴权和账户扣费。
- 脚本、图片、视频生成均读取 `model_configs` 中当前启用配置。
- 模型 API Key 和数据库连接等敏感配置必须放 `.env` 或数据库中，不写死在代码里。
