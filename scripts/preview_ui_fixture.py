"""Business-UI test fixture only. The separate admission suite uses gated HTML.

This server is never packaged or deployed. Bind exclusively to localhost.
"""
import argparse
import re
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlsplit
from urllib.request import build_opener,ProxyHandler

def trusted_fixture(html):
    match=re.search(r'<template id="site-protected-content">([\s\S]*)</template>\s*<link rel="stylesheet" href="styles/access.css',html)
    if not match:return html
    prefix=re.split(r'(<body[^>]*>)',html,maxsplit=1)
    deps='<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.min.js"></script><script src="config.js"></script>'
    return prefix[0]+prefix[1]+deps+match.group(1)+'</body></html>'

parser=argparse.ArgumentParser()
source=parser.add_mutually_exclusive_group(required=True)
source.add_argument('--directory');source.add_argument('--upstream')
parser.add_argument('--port',type=int,default=8766)
args=parser.parse_args()
opener=build_opener(ProxyHandler({}))

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*items,**kwargs):super().__init__(*items,directory=args.directory or '.',**kwargs)
    def log_message(self,*items):pass
    def do_GET(self):self.serve()
    def do_HEAD(self):self.serve(head=True)
    def serve(self,head=False):
        try:
            if args.upstream:
                try:
                    response=opener.open(args.upstream.rstrip('/')+self.path,timeout=90)
                    body=response.read();status=response.status;kind=response.headers.get('Content-Type','application/octet-stream')
                except Exception as error:
                    self.send_error(getattr(error,'code',502));return
            else:
                target=self.translate_path(self.path)
                from pathlib import Path
                file=Path(target)
                if file.is_dir():file=file/'index.html'
                if file.suffix!='.html' or not file.exists():
                    return super().do_HEAD() if head else super().do_GET()
                body=file.read_bytes();status=200;kind='text/html; charset=utf-8'
            if 'text/html' in kind:body=trusted_fixture(body.decode('utf8')).encode('utf8')
            self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(body)));self.end_headers()
            if not head:self.wfile.write(body)
        except (BrokenPipeError,ConnectionResetError):pass

print(f'Trusted business-UI fixture: http://127.0.0.1:{args.port}; admission tests must use the unmodified server',flush=True)
ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
