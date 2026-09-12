# -*- coding: utf-8 -*-
"""
乡居设计通 · 本地大模型代理（Python 3 标准库，零依赖）

用途：
  - 和 Cloudflare Worker 代理同一套协议，没装 Node / 没有 Cloudflare 账号时，
    在本机跑这个脚本就能让静态网页以“代理模式”访问 DeepSeek，密钥不进浏览器。

启动：
  set DEEPSEEK_API_KEY=sk-你的密钥          (Windows CMD)
  $env:DEEPSEEK_API_KEY="sk-你的密钥"        (PowerShell)
  可选：set APP_TOKEN=你自己定的口令
  python local_proxy.py

  然后在网页“大模型设置”里选【本地 Python 代理】，直接保存拨打。

可选环境变量：
  DEEPSEEK_API_KEY  必填
  APP_TOKEN         选填，前端访问口令（X-App-Token）
  UPSTREAM_URL      默认 https://api.deepseek.com
  FORCE_MODEL       默认 deepseek-chat，设为空字符串则透传前端模型
  PORT              默认 8788
"""
import json
import os
import hmac
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM_URL = os.environ.get("UPSTREAM_URL", "https://api.deepseek.com").rstrip("/")
API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
APP_TOKEN = os.environ.get("APP_TOKEN", "")
FORCE_MODEL = os.environ.get("FORCE_MODEL", "deepseek-chat")
PORT = int(os.environ.get("PORT", "8788"))
MAX_BODY = 96 * 1024

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-App-Token",
    "Access-Control-Max-Age": "86400",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "XiangJuProxy/1.0"

    def _send(self, status, payload, ctype="application/json; charset=utf-8"):
        data = payload if isinstance(payload, bytes) else payload.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _json(self, status, obj):
        self._send(status, json.dumps(obj, ensure_ascii=False))

    def do_OPTIONS(self):
        self.send_response(204)
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)
        self.end_headers()

    def do_GET(self):
        if self.path.split("?")[0] == "/healthz":
            self._json(200, {
                "ok": True,
                "service": "xiangju-local-proxy",
                "keyConfigured": len(API_KEY) > 8,
                "tokenRequired": bool(APP_TOKEN),
                "forceModel": FORCE_MODEL,
            })
        else:
            self._json(404, {"error": {"message": "只接受 POST /v1/chat/completions"}})

    def do_POST(self):
        if self.path.split("?")[0].rstrip("/") not in ("/v1/chat/completions", "/chat/completions"):
            self._json(404, {"error": {"message": "只接受 POST /v1/chat/completions"}})
            return

        if APP_TOKEN and not hmac.compare_digest(self.headers.get("X-App-Token", ""), APP_TOKEN):
            self._json(401, {"error": {"message": "代理访问口令不对（X-App-Token）"}})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length > MAX_BODY:
            self._json(413, {"error": {"message": "请求体超过 96KB 限制"}})
            return
        raw = self.rfile.read(length if length else MAX_BODY)
        if len(raw) > MAX_BODY:
            self._json(413, {"error": {"message": "请求体超过 96KB 限制"}})
            return

        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            self._json(400, {"error": {"message": "请求体不是合法 JSON"}})
            return

        if FORCE_MODEL:
            body["model"] = FORCE_MODEL
        body.setdefault("model", "deepseek-chat")

        if not API_KEY:
            self._json(500, {"error": {"message": "本机未设置 DEEPSEEK_API_KEY 环境变量"}})
            return

        req = urllib.request.Request(
            UPSTREAM_URL + "/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer " + API_KEY,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as up:
                self._send(up.status, up.read(), up.headers.get("Content-Type", "application/json; charset=utf-8"))
        except urllib.error.HTTPError as e:
            self._send(e.code, e.read(), e.headers.get("Content-Type", "application/json; charset=utf-8"))
        except Exception as e:
            self._json(502, {"error": {"message": "代理请求上游失败：" + str(e)}})

    def log_message(self, fmt, *args):
        # 简洁日志：只记方法/路径/状态
        print("[proxy] " + (fmt % args))


def main():
    if not API_KEY:
        print("!! 还没有设置 DEEPSEEK_API_KEY 环境变量，调用时会报 500。")
    print("乡居设计通本地代理已启动：http://127.0.0.1:%d/v1" % PORT)
    print("健康检查：http://127.0.0.1:%d/healthz （Ctrl+C 停止）" % PORT)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
