"""Retain JupyterLite's root page config when installing the course homepage."""
import json
import re
import sys
from pathlib import Path

CONFIG = re.compile(r'<script\b[^>]*\bid=[\"\']jupyter-config-data[\"\'][^>]*>(.*?)</script>', re.I | re.S)


def merge_page_config(directory):
    directory = Path(directory)
    generated = (directory / "lite.html").read_text(encoding="utf-8")
    homepage = directory / "index.html"
    shell = homepage.read_text(encoding="utf-8")
    match = CONFIG.search(generated)
    if not match:
        raise ValueError("Generated JupyterLite page has no root page configuration")
    config = json.loads(match.group(1))
    if not isinstance(config, dict):
        raise ValueError("JupyterLite root configuration must be a JSON object")
    if CONFIG.search(shell):
        raise ValueError("Course shell already contains a JupyterLite root configuration")
    if "</head>" not in shell:
        raise ValueError("Course shell has no head insertion point")
    # The runtime fetches root/index.html and parses this exact script ID.
    payload = json.dumps(config, ensure_ascii=False).replace("</", "<\\/")
    tag = '<script id="jupyter-config-data" type="application/json">' + payload + '</script>\n'
    homepage.write_text(shell.replace("</head>", tag + "</head>", 1), encoding="utf-8")


if __name__ == "__main__":
    merge_page_config(sys.argv[1])
