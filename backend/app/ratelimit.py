"""Fixed-window rate limiting.

Uses Redis when ``AS_REDIS_URL`` is configured (required when running more than
one API process), otherwise an in-process store.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from functools import lru_cache

from fastapi import Depends, HTTPException, Request

from .config import get_settings
from .models import User
from .security import client_ip, current_user


class MemoryStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counts: dict[str, tuple[int, float]] = {}

    def hit(self, key: str, window: int) -> int:
        now = time.monotonic()
        with self._lock:
            count, reset = self._counts.get(key, (0, now + window))
            if now >= reset:
                count, reset = 0, now + window
            count += 1
            self._counts[key] = (count, reset)
            if len(self._counts) > 50_000:  # bound memory
                self._counts = {k: v for k, v in self._counts.items() if v[1] > now}
            return count

    def reset(self) -> None:
        with self._lock:
            self._counts.clear()


class RedisStore:
    def __init__(self, url: str) -> None:
        import redis

        self._r = redis.Redis.from_url(url)

    def hit(self, key: str, window: int) -> int:
        bucket = f"as:rl:{key}:{int(time.time() // window)}"
        pipe = self._r.pipeline()
        pipe.incr(bucket)
        pipe.expire(bucket, window + 5)
        count, _ = pipe.execute()
        return int(count)

    def reset(self) -> None:  # pragma: no cover - not used with redis
        pass


@lru_cache
def get_store() -> MemoryStore | RedisStore:
    url = get_settings().redis_url
    return RedisStore(url) if url else MemoryStore()


def check(key: str, limit: int, window: int) -> None:
    if not get_settings().rate_limit_enabled:
        return
    if get_store().hit(key, window) > limit:
        raise HTTPException(429, "Too many requests. Please wait and try again.", headers={"Retry-After": str(window)})


def user_limit(scope: str, limit_fn: Callable[[], int], window: int):
    """FastAPI dependency factory limiting requests per signed-in user."""

    def dep(user: User = Depends(current_user)) -> None:
        check(f"{scope}:u:{user.id}", limit_fn(), window)

    return dep


def ip_limit(scope: str, limit_fn: Callable[[], int], window: int):
    """FastAPI dependency factory limiting requests per client IP."""

    def dep(request: Request) -> None:
        check(f"{scope}:ip:{client_ip(request)}", limit_fn(), window)

    return dep
