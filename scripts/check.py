#!/usr/bin/env python3
"""CP NEXUS safety check. Runs on every push (see .github/workflows/check.yml).

1. SECRET SCAN  - fails if a Supabase service_role key, secret key,
                  private key or similar is found anywhere in the repo.
                  (The public "anon" key is allowed: it is meant to be public.)
2. PAGE CHECK   - every portal must exist, be a complete HTML page, and its
                  inline JavaScript must have valid syntax.

Exit code 0 = all good, 1 = something is wrong (push shows a red cross).
Only the Python standard library and Node.js are needed.
"""
import base64, json, os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PORTALS = {                                   # folder -> minimum size in bytes
    "NEXUS/index.html": 100_000,
    "REQ/index.html": 50_000,
    "ENG/index.html": 50_000,
    "SEC/index.html": 50_000,
    "CP/index.html": 50_000,
    "CEO-MANAGER APPROVAL/index.html": 50_000,
}
REQUIRED_FILES = ["sw.js", "manifest.webmanifest", "nx-notify.js"]

SKIP_DIRS = {".git", "node_modules"}
TEXT_EXT = (".html", ".js", ".json", ".webmanifest", ".md", ".txt", ".yml", ".yaml", ".sql", ".py", ".env")

JWT_RE = re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")
SECRET_PATTERNS = {
    "Supabase secret key (sb_secret_)": re.compile(r"sb_secret_[A-Za-z0-9_-]{10,}"),
    "Private key block": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "AWS access key": re.compile(r"AKIA[0-9A-Z]{16}"),
    "GitHub token": re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}"),
    "VAPID/private key assignment": re.compile(r"(?i)vapid[_-]?private[_-]?key\s*[:=]\s*['\"][A-Za-z0-9_-]{20,}"),
    "service_role key assignment": re.compile(r"(?i)service[_-]?role[_-]?key\s*[:=]\s*['\"][A-Za-z0-9._-]{20,}"),
}

problems = []


def fail(msg):
    problems.append(msg)
    print("FAIL:", msg)


def files():
    for d, dirs, names in os.walk(ROOT):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        for n in names:
            if n.lower().endswith(TEXT_EXT):
                yield os.path.join(d, n)


def rel(p):
    return os.path.relpath(p, ROOT)


def secret_scan():
    print("== Secret scan ==")
    n = 0
    for p in files():
        n += 1
        t = open(p, errors="ignore").read()
        for j in set(JWT_RE.findall(t)):
            try:
                body = j.split(".")[1]
                body += "=" * (-len(body) % 4)
                role = json.loads(base64.urlsafe_b64decode(body)).get("role")
            except Exception:
                continue
            if role and role != "anon":
                fail(f"{rel(p)}: a Supabase key with role '{role}' is in the code (only 'anon' is allowed)")
        for name, rx in SECRET_PATTERNS.items():
            if rx.search(t):
                fail(f"{rel(p)}: {name} found")
    print(f"scanned {n} files")


def script_blocks(html):
    for m in re.finditer(r"<script([^>]*)>(.*?)</script>", html, re.S | re.I):
        attrs, body = m.group(1), m.group(2)
        if "src=" in attrs.lower() or not body.strip():
            continue
        t = re.search(r"type\s*=\s*['\"]([^'\"]+)", attrs, re.I)
        t = t.group(1).lower() if t else ""
        if t in ("", "text/javascript", "application/javascript"):
            yield body, False
        elif t == "module":
            yield body, True


def page_check():
    print("== Page check ==")
    for f in REQUIRED_FILES:
        if not os.path.isfile(os.path.join(ROOT, f)):
            fail(f"required file missing: {f}")
    for f, minsize in PORTALS.items():
        p = os.path.join(ROOT, f)
        if not os.path.isfile(p):
            fail(f"portal missing: {f}")
            continue
        size = os.path.getsize(p)
        html = open(p, errors="ignore").read()
        if size < minsize:
            fail(f"{f}: only {size} bytes (expected at least {minsize}) - file may be cut off or empty")
        if "</html>" not in html.lower():
            fail(f"{f}: no closing </html> - file looks incomplete")
        if not re.search(r"<title>.+?</title>", html, re.S | re.I):
            fail(f"{f}: no <title>")
        bad = 0
        for i, (body, is_module) in enumerate(script_blocks(html), 1):
            with tempfile.NamedTemporaryFile("w", suffix=".mjs" if is_module else ".js", delete=False) as tf:
                tf.write(body)
                tmp = tf.name
            r = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
            os.unlink(tmp)
            if r.returncode != 0:
                bad += 1
                first = (r.stderr.strip().splitlines() or ["syntax error"])
                fail(f"{f}: JavaScript syntax error in script block {i}: {' | '.join(first[:4])}")
        print(f"{f}: {size:,} bytes, scripts {'OK' if not bad else 'BROKEN'}")
    for f in ("sw.js", "nx-notify.js"):
        p = os.path.join(ROOT, f)
        if os.path.isfile(p):
            r = subprocess.run(["node", "--check", p], capture_output=True, text=True)
            if r.returncode != 0:
                fail(f"{f}: JavaScript syntax error: {r.stderr.strip().splitlines()[:1]}")
    try:
        json.load(open(os.path.join(ROOT, "manifest.webmanifest")))
    except Exception as e:
        fail(f"manifest.webmanifest is not valid JSON: {e}")


if __name__ == "__main__":
    secret_scan()
    page_check()
    print()
    if problems:
        print(f"RESULT: {len(problems)} problem(s) found - do not publish.")
        sys.exit(1)
    print("RESULT: all checks passed.")
