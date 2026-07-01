"""Canary-Qwen 2.5B transcription service -> lazy loaded, language-agnostic.

Outputs English text regardless of input language (multilingual → English).
Heavy model (~5GB); loads in background at first use, not at startup.
"""
from __future__ import annotations

import io
import logging
import threading
from typing import Optional

logger = logging.getLogger(__name__)

# Familiarity → interjection threshold (fraction of semantic drift that triggers correction)
FAMILIARITY_THRESHOLDS = {
    "eli5": 0.70,
    "high_school": 0.40,
    "graduate": 0.15,
    "expert": 0.05,
}


class TranscriptionService:
    _instance: Optional["TranscriptionService"] = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self._pipeline = None
        self._loading = False
        self._ready = threading.Event()
        # Start background load
        threading.Thread(target=self._load, daemon=True).start()

    @classmethod
    def get(cls) -> "TranscriptionService":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def _load(self) -> None:
        try:
            self._loading = True
            logger.info("Loading Canary-Qwen 2.5B STT model (this may take a few minutes)…")
            from nemo.collections.asr.models import EncDecMultiTaskModel  # type: ignore
            self._pipeline = EncDecMultiTaskModel.from_pretrained(
                "nvidia/canary-qwen-2.5b"
            )
            self._pipeline.eval()
            logger.info("Canary-Qwen 2.5B loaded and ready.")
        except Exception as exc:
            logger.warning(f"Canary-Qwen failed to load: {exc}. STT unavailable; text fallback active.")
            self._pipeline = None
        finally:
            self._loading = False
            self._ready.set()

    @property
    def is_ready(self) -> bool:
        return self._ready.is_set()

    @property
    def is_available(self) -> bool:
        return self._pipeline is not None

    def transcribe(self, audio_bytes: bytes) -> str:
        """Transcribe audio bytes → English text. Returns empty string if STT unavailable."""
        if not self.is_available:
            return ""
        try:
            import soundfile as sf  # type: ignore
            import tempfile, os
            # Write to temp wav for NeMo
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                f.write(audio_bytes)
                tmp_path = f.name
            try:
                result = self._pipeline.transcribe(
                    [tmp_path],
                    batch_size=1,
                    task="asr",
                    source_lang="multilingual",
                    target_lang="en",
                )
                return result[0] if result else ""
            finally:
                os.unlink(tmp_path)
        except Exception as exc:
            logger.warning(f"Transcription failed: {exc}")
            return ""

    def is_model_loading(self) -> bool:
        return self._loading
