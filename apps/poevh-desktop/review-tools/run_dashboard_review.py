"""Windows fallback: own the HTTP server directly, no orphaned shell subprocess.

The skill's with_server.py terminates cmd.exe but can leave Python alive on Windows.
This runner shuts down the exact server it created, including on test failure.
"""
import runpy
import socket
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

from mock_dashboard_server import Handler


class ReviewServer(ThreadingHTTPServer):
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


if __name__ == "__main__":
    server = ReviewServer(("127.0.0.1", 8876), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        runpy.run_path(str(Path(__file__).with_name("test_cream_theme.py")), run_name="__main__")
        runpy.run_path(str(Path(__file__).with_name("test_instances.py")), run_name="__main__")
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
