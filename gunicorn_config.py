# Gunicorn configuration for Python workers
# This replaces Flask's development server with a production WSGI server

import os
import multiprocessing

# Get worker configuration from environment
worker_cores = int(os.getenv('WORKER_CORES', '2'))
worker_name = os.getenv('WORKER_NAME', 'Python Worker')
port = int(os.getenv('FLASK_PORT', '5000'))

# Gunicorn config
bind = f"0.0.0.0:{port}"
workers = 1  # One worker per Python worker instance (managed by worker_manager.js)
threads = worker_cores  # Number of threads = allocated cores
worker_class = 'gevent'  # Async worker for I/O-bound tasks (transcription, ML inference)
worker_connections = 1000  # Max concurrent connections per worker

# Logging
loglevel = 'info'
accesslog = '-'  # Log to stdout
errorlog = '-'   # Log to stderr
access_log_format = f'[{worker_name}] %(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s"'

# Process naming
proc_name = worker_name

# Timeouts (increase for long-running tasks like transcription)
timeout = 300  # 5 minutes for transcription tasks
graceful_timeout = 30

# Server mechanics
daemon = False
pidfile = None
umask = 0
user = None
group = None
tmp_upload_dir = None

# Pre-fork worker configuration
preload_app = False  # Don't preload to allow per-worker initialization
worker_tmp_dir = '/dev/shm' if os.path.exists('/dev/shm') else None  # Use RAM for worker tmp

print(f"🔧 Gunicorn Config:")
print(f"   Worker: {worker_name}")
print(f"   Port: {port}")
print(f"   Threads: {threads}")
print(f"   Bind: {bind}")
