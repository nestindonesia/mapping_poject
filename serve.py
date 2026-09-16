#!/usr/bin/env python3
"""Server statis lokal untuk Peta GIS Wilayah.
Pakai: python serve.py [port]
"""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8093
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """Selalu kirim file terbaru dari disk -- tanpa ini, browser sering
    menyimpan cache lama untuk file .js/.html sehingga perubahan kode tidak
    langsung kelihatan walau sudah reload berkali-kali."""

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()


handler = NoCacheHandler

with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
    print(f"Serving '{os.getcwd()}' at http://localhost:{PORT}/")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
