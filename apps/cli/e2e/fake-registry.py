#!/usr/bin/env python3
"""An npm registry for the update scenario: serves @collagen/cli with one
version built from a local tarball, and proxies everything else to
registry.npmjs.org (npm resolves the real dependencies through it). Usage:
  fake-registry.py <port> <version> <tarball.tgz>"""
import base64, hashlib, json, os, ssl, sys, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

port, version, tgz = int(sys.argv[1]), sys.argv[2], sys.argv[3]

# python.org builds ship without a CA bundle — find one, or the proxy leg fails
# with CERTIFICATE_VERIFY_FAILED on the first dependency
def ca_context():
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        for f in ("/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt"):
            if os.path.exists(f):
                return ssl.create_default_context(cafile=f)
    return ssl.create_default_context()

SSL = ca_context()
data = open(tgz, "rb").read()
name = "@collagen/cli"
manifest = {
    "name": name,
    "version": version,
    "dist": {
        "tarball": f"http://127.0.0.1:{port}/{name}/-/cli-{version}.tgz",
        "integrity": "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode(),
        "shasum": hashlib.sha1(data).hexdigest(),
    },
    "bin": {"collagen": "bin/collagen.js"},
    "engines": {"node": ">=26.4"},
}
# dependencies come from the tarball's own package.json
import io, tarfile
with tarfile.open(tgz) as t:
    pkg = json.load(t.extractfile("package/package.json"))
manifest["dependencies"] = pkg.get("dependencies", {})
packument = {"name": name, "dist-tags": {"latest": version}, "versions": {version: manifest}}


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urllib.parse.unquote(self.path)
        if path.startswith(f"/{name}"):
            if path.endswith(".tgz"):
                body, ctype = data, "application/octet-stream"
            elif path.rstrip("/").endswith("/latest"):
                body, ctype = json.dumps(manifest).encode(), "application/json"
            else:
                body, ctype = json.dumps(packument).encode(), "application/json"
            self.reply(200, ctype, body)
            return
        # anything else: the real registry
        try:
            req = urllib.request.Request("https://registry.npmjs.org" + self.path, headers={"accept": self.headers.get("accept", "*/*")})
            with urllib.request.urlopen(req, timeout=60, context=SSL) as up:
                self.reply(up.status, up.headers.get("content-type", "application/json"), up.read())
        except urllib.error.HTTPError as e:
            self.reply(e.code, "application/json", b'{"error":"upstream"}')
        except Exception as e:  # never let one bad fetch kill the handler — npm would hang on a reset socket
            print(f"fake-registry: {self.path}: {e}", file=sys.stderr)
            self.reply(502, "application/json", json.dumps({"error": str(e)}).encode())

    def reply(self, status, ctype, body):
        self.send_response(status)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
