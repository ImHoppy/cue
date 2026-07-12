"""Client registry that fans out state/settings to connected overlays."""

import threading


class Hub:
    def __init__(self):
        self._clients = set()
        self._last_state = None
        self._last_settings = None
        self._lock = threading.Lock()

    def add(self, client):
        with self._lock:
            self._clients.add(client)
            settings = self._last_settings
            state = self._last_state
        if settings is not None:
            client.send_text(settings)
        if state is not None:
            client.send_text(state)

    def remove(self, client):
        with self._lock:
            self._clients.discard(client)

    def broadcast(self, message, sender=None, is_settings=False):
        with self._lock:
            if is_settings:
                self._last_settings = message
            else:
                self._last_state = message
            targets = [c for c in self._clients if c is not sender]
        for c in targets:
            c.send_text(message)


# Single shared hub used by the websocket handler.
HUB = Hub()
