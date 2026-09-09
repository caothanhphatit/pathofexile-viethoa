"""Visual and behavior smoke test for the isolated Trade overlay."""

import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / "crates" / "poe2-overlay" / "ui"
TOKEN = "trade-review-token"
RAW = """Item Class: Boots
Rarity: Rare
Doom Tread
Iron Greaves
--------
Item Level: 78
--------
+35% to Fire Resistance
+72 to maximum Life"""
ITEM = {
    "raw_text": RAW, "item_class": "Boots", "rarity": "rare", "name": "Doom Tread",
    "base_type": "Iron Greaves", "quality": 20, "item_level": 78, "waystone_tier": None,
    "sockets": "S S", "armour": 142, "evasion": 0, "energy_shield": 0,
    "requirements_level": 65, "corrupted": False, "unidentified": False, "mirrored": False,
    "mods": [
        {"text": "+35% to Fire Resistance", "mod_type": "explicit", "values": [35], "is_selected": True},
        {"text": "+72 to maximum Life", "mod_type": "explicit", "values": [72], "is_selected": True},
    ],
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def send_bytes(self, content, content_type):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def send_json(self, value, status=200):
        content = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        if self.path == "/trade-overlay":
            html = (UI / "trade-overlay.html").read_text(encoding="utf-8")
            html = html.replace("<head>", f'<head><script>window.__API_TOKEN__="{TOKEN}";</script>', 1)
            self.send_bytes(html.encode(), "text/html; charset=utf-8")
        elif self.path == "/static/trade-overlay.css":
            self.send_bytes((UI / "css" / "trade-overlay.css").read_bytes(), "text/css")
        elif self.path == "/static/trade-overlay.js":
            self.send_bytes((UI / "js" / "trade-overlay.js").read_bytes(), "application/javascript")
        elif self.path == "/api/trade/latest":
            if self.headers.get("X-Api-Token") != TOKEN:
                self.send_json({"error": "unauthorized"}, 401)
            else:
                self.send_json({"revision": 1, "status": "captured", "raw_text": RAW, "item": ITEM, "error": None})
        elif self.path == "/api/trade/leagues":
            if self.headers.get("X-Api-Token") != TOKEN:
                self.send_json({"error": "unauthorized"}, 401)
            else:
                self.send_json({"leagues": ["Runes of Aldur", "Standard"]})
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path != "/api/trade/search" or self.headers.get("X-Api-Token") != TOKEN:
            self.send_json({"error": "unauthorized"}, 401)
            return
        length = int(self.headers.get("Content-Length", "0"))
        json.loads(self.rfile.read(length))
        self.send_json({
            "source": "pathofexile.com/trade2", "query_id": "review-query", "league": "Standard",
            "total": 37, "inexact": False, "item": ITEM,
            "filters": [
                {"index": 0, "text": "+35% to Fire Resistance", "trade_id": "explicit.fire", "suggested_min": 28, "selected": False},
                {"index": 1, "text": "+72 to maximum Life", "trade_id": "explicit.life", "suggested_min": 57.6, "selected": False},
            ],
            "listings": [
                {"id": "1", "amount": 10, "currency": "exalted", "account": "<img src=x onerror=alert(1)>", "character": "SellerOne", "indexed": "2026-09-04T03:00:00Z", "online": True, "item_level": 81, "quality": "+20%", "stack_size": None},
                {"id": "2", "amount": 12, "currency": "exalted", "account": "SellerTwo", "character": "", "indexed": "2026-09-03T03:00:00Z", "online": True, "item_level": 80, "quality": None, "stack_size": None},
            ],
            "trade_url": "https://www.pathofexile.com/trade2/search/poe2/Standard/review-query",
        })


class Server(ThreadingHTTPServer):
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


if __name__ == "__main__":
    server = Server(("127.0.0.1", 8877), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 540, "height": 760})
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto("http://127.0.0.1:8877/trade-overlay", wait_until="networkidle")
            expect(page.locator("#item-name")).to_have_text("Doom Tread")
            expect(page.locator("#matched")).to_contain_text("37 kết quả")
            expect(page.locator("#results tr")).to_have_count(2)
            expect(page.locator("#median")).to_have_text("11 exalted")
            expect(page.locator("#mod-list .mod-row")).to_have_count(2)
            assert page.locator("#results img").count() == 0, "Listing account rendered as HTML"
            assert not errors, errors
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Horizontal overflow"
            page.screenshot(path=str(Path(__file__).with_name("trade-overlay-review.png")))
            browser.close()
        print("Trade overlay review passed: layout, listings, filters, auth and XSS rendering")
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
