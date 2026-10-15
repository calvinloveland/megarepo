"""In-process pub/sub for live game pages.

When a score, achievement, rating, play, or comment changes, the API publishes
to a per-slug topic and every open game page watching that slug is notified over
Server-Sent Events. This is intentionally in-memory and single-worker (the app
runs one gevent worker), which is enough for a self-hosted arcade.
"""

from __future__ import annotations

import queue
import threading


class LiveHub:
    def __init__(self) -> None:
        self._subscribers: dict[str, list[queue.Queue]] = {}
        self._lock = threading.Lock()

    def subscribe(self, slug: str) -> queue.Queue:
        channel: queue.Queue = queue.Queue(maxsize=64)
        with self._lock:
            self._subscribers.setdefault(slug, []).append(channel)
        return channel

    def unsubscribe(self, slug: str, channel: queue.Queue) -> None:
        with self._lock:
            channels = self._subscribers.get(slug)
            if channels and channel in channels:
                channels.remove(channel)
                if not channels:
                    self._subscribers.pop(slug, None)

    def publish(self, slug: str, kind: str = "update") -> None:
        with self._lock:
            channels = list(self._subscribers.get(slug, ()))
        for channel in channels:
            try:
                channel.put_nowait(kind)
            except queue.Full:
                pass


LIVE = LiveHub()
