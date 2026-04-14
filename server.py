"""Kronos — entry point for Dev Router auto-detection."""
import subprocess, sys, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
subprocess.run([sys.executable, "app/server.py"])
