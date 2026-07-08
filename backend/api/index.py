import sys
import os

# Add backend root to path so "from routers import ..." works
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import app  # noqa: F401 — Vercel detects the ASGI app
