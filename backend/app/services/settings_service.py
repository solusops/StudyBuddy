"""Persistent settings for the Study Buddy app.

Settings are stored in ~/.studybuddy/settings.json and include the content
and questions folder paths selected by the student on first launch.
"""
import json
import os
from typing import Optional

_SETTINGS_DIR = os.path.expanduser("~/.studybuddy")
_SETTINGS_PATH = os.path.join(_SETTINGS_DIR, "settings.json")


def load_settings() -> dict:
    if not os.path.exists(_SETTINGS_PATH):
        return {}
    with open(_SETTINGS_PATH, encoding="utf-8") as f:
        return json.load(f)


def save_settings(updates: dict) -> dict:
    current = load_settings()
    current.update(updates)
    os.makedirs(_SETTINGS_DIR, exist_ok=True)
    with open(_SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(current, f, indent=2)
    return current


def get_content_folder() -> Optional[str]:
    return load_settings().get("content_folder")


def get_questions_folder() -> Optional[str]:
    return load_settings().get("questions_folder")


def is_configured() -> bool:
    return bool(get_content_folder())
