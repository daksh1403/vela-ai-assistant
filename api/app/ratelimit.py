import asyncio
import time
from collections import defaultdict, deque

from .errors import AppError


class RateLimiter:
    """One-process sliding window. Production runs one API worker."""

    def __init__(self) -> None:
        self._events: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    async def check(self, client: str, operation: str, limit: int) -> None:
        now = time.monotonic()
        key = (client, operation)
        async with self._lock:
            events = self._events[key]
            while events and events[0] <= now - 60:
                events.popleft()
            if len(events) >= limit:
                raise AppError(429, "RATE_LIMITED", "Too many requests. Try again shortly.")
            events.append(now)
            if len(self._events) > 10000:
                for stale_key, values in list(self._events.items()):
                    if not values or values[-1] <= now - 60:
                        del self._events[stale_key]
