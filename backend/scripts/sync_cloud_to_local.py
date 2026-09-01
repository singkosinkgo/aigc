from __future__ import annotations

import json
import shutil
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import pymysql


ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
DATA_DIR = ROOT / "data"


def read_env() -> dict[str, str]:
    values: dict[str, str] = {}
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def parse_database_url(url: str) -> dict[str, object]:
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    return {
        "host": parsed.hostname or "127.0.0.1",
        "port": parsed.port or 3306,
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "database": parsed.path.lstrip("/"),
        "charset": query.get("charset", ["utf8mb4"])[0],
    }


def json_value(value):
    if isinstance(value, datetime):
        return value.isoformat(sep=" ", timespec="seconds")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value


def fetch_table(conn, table: str) -> list[dict]:
    with conn.cursor() as cursor:
        cursor.execute(f"SELECT * FROM `{table}` ORDER BY id ASC")
        rows = cursor.fetchall()
    return [{key: json_value(value) for key, value in row.items()} for row in rows]


def main() -> None:
    env = read_env()
    db_url = env.get("DATABASE_URL")
    if not db_url:
        raise SystemExit("DATABASE_URL is missing in backend/.env")

    config = parse_database_url(db_url)
    conn = pymysql.connect(cursorclass=pymysql.cursors.DictCursor, **config)
    try:
        exported = {
            "users": fetch_table(conn, "users"),
            "works": fetch_table(conn, "works"),
            "model_configs": fetch_table(conn, "model_configs"),
        }
    finally:
        conn.close()

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    backup_dir = ROOT / f"data.backup-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    shutil.copytree(DATA_DIR, backup_dir)

    for name, rows in exported.items():
        (DATA_DIR / f"{name}.json").write_text(
            json.dumps(rows, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    print(
        json.dumps(
            {
                "backup": str(backup_dir),
                "counts": {name: len(rows) for name, rows in exported.items()},
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
