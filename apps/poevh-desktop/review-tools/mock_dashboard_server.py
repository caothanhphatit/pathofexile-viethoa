import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "crates" / "poe2-overlay" / "src" / "dashboard.html").read_text(encoding="utf-8")
TOKEN = "review-token"

STATE = {
    "tick": 42,
    "running": False,
    "leader": {"name": "MAIN", "pos": {"x": 1, "y": 2}, "hp": 91, "mana": 80, "area": "Review Area", "action": "Hold"},
    "followers": [
        {"name": f"P{i}", "pos": {"x": i, "y": i}, "hp": 80 + i, "mana": 70, "area": "Review Area", "action": "Hold"}
        for i in range(2, 7)
    ],
    "loot": [],
    "threats": [],
    "loot_paused": False,
    "settings": {
        "tracker": {"total_div_estimate": 1.25, "div_per_hour": 2.5, "session_seconds": 65, "div_count": 1, "exalt_count": 2, "chaos_count": 3, "gold_count": 400},
        "multi_client": {"main_instance_id": 1, "next_instance_id": 4, "clients": [
            {"id": 3, "label": "Instance 3", "flavor": "Standalone", "exe_path": "", "enabled": True, "black_screen": False, "bg_fps": 60},
            {"id": 1, "label": "Instance 1 (Main)", "flavor": "Steam", "exe_path": "", "enabled": True, "black_screen": False, "bg_fps": 60},
            {"id": 2, "label": "Instance 2", "flavor": "Standalone", "exe_path": "", "enabled": True, "black_screen": True, "bg_fps": 15},
        ]},
    },
    "config": {"tick_ms": 200},
    "area_name_hint": "Review Area",
    "client": {"connected": True},
    "telemetry": [
        {"cpu_pct": 1.1, "ram_mb": 100, "fps": 60, "render_mode": "Review"},
        {"cpu_pct": 2.2, "ram_mb": 200, "fps": 30, "render_mode": "Review"},
        {"cpu_pct": 3.3, "ram_mb": 300, "fps": 15, "render_mode": "Review"},
    ],
    "events": [{"tick": 42, "actor": "<img src=x onerror=alert(1)>", "action": "<script>alert(2)</script>", "detail": "<svg onload=alert(3)>"}],
}

# Explicit UI fixtures, not claims about the user's running processes.
BINDINGS = {}
STATE["instance_services"] = {
    "profiles_persistent": False,
    "profile_path": None,
    "scan_error": None,
    "per_process_graphics": False,
    "graphics_reason": "No renderer backend in this UI test.",
    "instances": [],
    "processes": [
        {"identity": {"pid": pid, "started_at": f"{pid:016x}", "exe_path": path},
         "flavor": flavor, "window": {"handle": str(pid), "title": "Test fixture", "minimized": False},
         "working_set_bytes": 104857600, "cpu_percent": 12.5}
        for pid, flavor, path in [(1001, "Steam", r"D:\Steam\PathOfExileSteam.exe"), (2002, "Standalone", r"D:\Two\PathOfExile.exe"), (3003, "Standalone", r"D:\Three\PathOfExile.exe")]
    ],
}


def refresh_instances():
    services = STATE["instance_services"]
    services["instances"] = []
    for profile in STATE["settings"]["multi_client"]["clients"]:
        binding = BINDINGS.get(profile["id"])
        process = next((p for p in services["processes"] if p["identity"] == binding), None)
        status = "disabled" if not profile["enabled"] else "unbound" if binding is None else "bound" if process else "exited_or_unavailable"
        services["instances"].append({"instance_id": profile["id"], "status": status, "binding": binding, "process": process})


refresh_instances()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def _json(self, status, value):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ("/", "/dashboard"):
            injected = f'<script>window.__API_TOKEN__ = "{TOKEN}";</script>\n'
            body = HTML.replace("<head>", f"<head>\n    {injected}", 1).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/api/state":
            if self.headers.get("X-Api-Token") != TOKEN:
                self._json(401, {"error": "unauthorized"})
            else:
                self._json(200, STATE)
            return
        self.send_error(404)

    def do_POST(self):
        if self.path != "/api/command":
            self.send_error(404)
            return
        if self.headers.get("X-Api-Token") != TOKEN:
            self._json(401, {"error": "unauthorized"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        command = json.loads(self.rfile.read(length) or b"{}")
        print("COMMAND " + json.dumps(command), flush=True)
        if command.get("command") == "run":
            STATE["running"] = bool(command.get("value"))
        if command.get("command") == "update_instance":
            profile = next((c for c in STATE["settings"]["multi_client"]["clients"] if c["id"] == command.get("instance_id")), None)
            if profile is None:
                self._json(404, {"error": "Instance ID not found"})
                return
            profile.update(command["value"])
            if not profile["enabled"]:
                BINDINGS.pop(profile["id"], None)
        config = STATE["settings"]["multi_client"]
        instance_id = command.get("instance_id")
        if command.get("command") == "bind_instance":
            if any(i != instance_id and b == command["value"] for i, b in BINDINGS.items()):
                self._json(409, {"error": "This PID is already assigned to another instance"})
                return
            BINDINGS[instance_id] = command["value"]
        if command.get("command") == "unbind_instance":
            BINDINGS.pop(instance_id, None)
        if command.get("command") == "set_main_instance":
            config["main_instance_id"] = instance_id
        if command.get("command") == "add_instance":
            ident = config["next_instance_id"]
            config["next_instance_id"] += 1
            config["clients"].append({"id": ident, "label": f"Instance {ident}", "enabled": True, "flavor": "Unknown", "exe_path": "", "black_screen": False, "bg_fps": 60})
        if command.get("command") == "remove_instance":
            config["clients"] = [p for p in config["clients"] if p["id"] != instance_id]
            BINDINGS.pop(instance_id, None)
        refresh_instances()
        self._json(200, STATE)


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8876), Handler).serve_forever()
