#!/usr/bin/env python3
"""Apply / restore Cursor OpenAI override for Moonshot (Kimi via CLIProxyAPI)."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

STORAGE_KEY = (
    "src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl"
    ".persistentStorage.applicationUser"
)


def db_path() -> Path:
    appdata = os.environ.get("APPDATA") or ""
    return Path(appdata) / "Cursor" / "User" / "globalStorage" / "state.vscdb"


def load_storage(conn: sqlite3.Connection) -> dict:
    row = conn.execute(
        "SELECT value FROM ItemTable WHERE key = ?", (STORAGE_KEY,)
    ).fetchone()
    if not row:
        raise SystemExit("Cursor reactive storage not found (is Cursor installed?)")
    raw = row[0]
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", errors="ignore")
    return json.loads(raw)


def save_storage(conn: sqlite3.Connection, data: dict) -> None:
    conn.execute(
        "INSERT INTO ItemTable(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (STORAGE_KEY, json.dumps(data, separators=(",", ":"))),
    )
    conn.commit()


def snapshot_routing(data: dict) -> dict:
    ai = data.get("aiSettings") or {}
    composer = (ai.get("modelConfig") or {}).get("composer")
    return {
        "openAIBaseUrl": data.get("openAIBaseUrl"),
        "useOpenAIKey": data.get("useOpenAIKey"),
        "userAddedModels": list(ai.get("userAddedModels") or []),
        "modelOverrideEnabled": list(ai.get("modelOverrideEnabled") or []),
        "composer": composer,
    }


def apply_routing(data: dict, *, base_url: str, model: str, models: list[str]) -> dict:
    ai = dict(data.get("aiSettings") or {})
    added = list(ai.get("userAddedModels") or [])
    enabled = list(ai.get("modelOverrideEnabled") or [])
    for mid in models:
        if mid and mid not in added:
            added.append(mid)
        if mid and mid not in enabled:
            enabled.append(mid)
    if model and model not in added:
        added.append(model)
    if model and model not in enabled:
        enabled.append(model)

    model_config = dict(ai.get("modelConfig") or {})
    model_config["composer"] = {
        "modelName": model,
        "maxMode": True,
        "selectedModels": [{"modelId": model, "parameters": []}],
    }
    ai["userAddedModels"] = added
    ai["modelOverrideEnabled"] = enabled
    ai["modelConfig"] = model_config

    data["openAIBaseUrl"] = base_url
    data["useOpenAIKey"] = True
    data["aiSettings"] = ai
    return data


def restore_routing(data: dict, backup: dict) -> dict:
    ai = dict(data.get("aiSettings") or {})
    if "userAddedModels" in backup:
        ai["userAddedModels"] = backup.get("userAddedModels") or []
    if "modelOverrideEnabled" in backup:
        ai["modelOverrideEnabled"] = backup.get("modelOverrideEnabled") or []
    if "composer" in backup:
        model_config = dict(ai.get("modelConfig") or {})
        if backup.get("composer") is None:
            model_config.pop("composer", None)
        else:
            model_config["composer"] = backup["composer"]
        ai["modelConfig"] = model_config
    data["aiSettings"] = ai
    data["openAIBaseUrl"] = backup.get("openAIBaseUrl")
    data["useOpenAIKey"] = backup.get("useOpenAIKey")
    return data


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["apply", "restore", "status"])
    parser.add_argument("--base-url", default="http://127.0.0.1:8317/v1")
    parser.add_argument("--model", default="kimi-k3")
    parser.add_argument("--models", default="")
    parser.add_argument("--backup", required=True)
    args = parser.parse_args()

    path = db_path()
    if not path.exists():
        print(json.dumps({"ok": False, "error": f"missing {path}"}))
        return 1

    models = [m.strip() for m in args.models.split(",") if m.strip()]
    if args.model and args.model not in models:
        models.insert(0, args.model)

    backup_path = Path(args.backup)
    conn = sqlite3.connect(str(path), timeout=10)
    try:
        data = load_storage(conn)
        if args.action == "status":
            print(
                json.dumps(
                    {
                        "ok": True,
                        "openAIBaseUrl": data.get("openAIBaseUrl"),
                        "useOpenAIKey": data.get("useOpenAIKey"),
                        "composerModel": ((data.get("aiSettings") or {}).get("modelConfig") or {})
                        .get("composer", {})
                        .get("modelName"),
                        "userAddedModels": (data.get("aiSettings") or {}).get("userAddedModels")
                        or [],
                    }
                )
            )
            return 0

        if args.action == "apply":
            if not backup_path.exists():
                backup_path.write_text(
                    json.dumps(snapshot_routing(data), indent=2) + "\n", encoding="utf-8"
                )
            data = apply_routing(
                data, base_url=args.base_url.rstrip("/"), model=args.model, models=models
            )
            save_storage(conn, data)
            print(
                json.dumps(
                    {
                        "ok": True,
                        "applied": True,
                        "openAIBaseUrl": data.get("openAIBaseUrl"),
                        "useOpenAIKey": data.get("useOpenAIKey"),
                        "model": args.model,
                        "backup": str(backup_path),
                        "reloadRequired": True,
                    }
                )
            )
            return 0

        # restore
        if not backup_path.exists():
            print(json.dumps({"ok": True, "restored": False, "reason": "no backup"}))
            return 0
        backup = json.loads(backup_path.read_text(encoding="utf-8"))
        data = restore_routing(data, backup)
        save_storage(conn, data)
        try:
            backup_path.unlink()
        except OSError:
            pass
        print(json.dumps({"ok": True, "restored": True, "reloadRequired": True}))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
