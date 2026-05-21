// filepath: /Users/norbertzych/Desktop/Projects/study_sinc/worker_manager.js
import { spawn, exec } from 'child_process';
import { EventEmitter } from 'events';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function killProcessOnPort(port) {
    try {
        const { stdout } = await execAsync(`lsof -ti:${port}`);
        const pids = stdout.trim().split('\n').filter(pid => pid);
        if (pids.length > 0) {
            for (const pid of pids) {
                try {
                    await execAsync(`kill -9 ${pid}`);
                } catch (killError) {}
            }
            await new Promise(resolve => setTimeout(resolve, 500));
            return true;
        }
        return false;
    } catch (error) {
        return false;
    }
}

export const PRIORITY = {
    URGENT: 0,
    HIGH: 1,
    NORMAL: 2,
    LOW: 3,
    IDLE: 4
};

class PriorityQueue {
    constructor() {
        this.queues = {
            [PRIORITY.URGENT]: [],
            [PRIORITY.HIGH]: [],
            [PRIORITY.NORMAL]: [],
            [PRIORITY.LOW]: [],
            [PRIORITY.IDLE]: []
        };
        this.processing = new Set();
    }

    enqueue(task, priority = PRIORITY.NORMAL) {
        const taskId = task.id || JSON.stringify(task);
        if (this.processing.has(taskId)) return false;
        for (const queue of Object.values(this.queues)) {
            if (queue.some(t => (t.id || JSON.stringify(t)) === taskId)) return false;
        }
        task.id = taskId;
        task.priority = priority;
        task.queuedAt = Date.now();
        this.queues[priority].push(task);
        return true;
    }

    dequeue() {
        for (let priority = PRIORITY.URGENT; priority <= PRIORITY.IDLE; priority++) {
            if (this.queues[priority].length > 0) {
                const task = this.queues[priority].shift();
                this.processing.add(task.id);
                return task;
            }
        }
        return null;
    }

    complete(taskId) {
        this.processing.delete(taskId);
    }

    getStats() {
        return {
            urgent: this.queues[PRIORITY.URGENT].length,
            high: this.queues[PRIORITY.HIGH].length,
            normal: this.queues[PRIORITY.NORMAL].length,
            low: this.queues[PRIORITY.LOW].length,
            idle: this.queues[PRIORITY.IDLE].length,
            processing: this.processing.size
        };
    }

    promote(taskId, newPriority) {
        for (const [priority, queue] of Object.entries(this.queues)) {
            const index = queue.findIndex(t => t.id === taskId);
            if (index !== -1) {
                const task = queue.splice(index, 1)[0];
                task.priority = newPriority;
                this.queues[newPriority].push(task);
                return true;
            }
        }
        return false;
    }
}

class PythonWorker extends EventEmitter {
    constructor(name, port, cores, serverFile, venvPath = './venv') {
        super();
        this.name = name;
        this.port = port;
        this.cores = cores;
        this.serverFile = serverFile;
        this.venvPath = venvPath;
        this.process = null;
        this.queue = new PriorityQueue();
        this.isProcessing = false;
        this.currentTask = null;
    }

    async start() {
        await killProcessOnPort(this.port);
        const env = {
            ...process.env,
            FLASK_PORT: String(this.port),
            OMP_NUM_THREADS: String(this.cores),
            WORKER_NAME: this.name,
            WORKER_CORES: String(this.cores)
        };
        const gunicornPath = `${this.venvPath}/bin/gunicorn`;
        const serverModule = `${this.serverFile}:app`;
        this.process = spawn(gunicornPath, ['--config', 'gunicorn_config.py', serverModule], {
            env,
            cwd: process.cwd(),
            stdio: ['pipe', 'pipe', 'pipe']
        });
        this.process.stdout.on('data', (data) => console.log(`[${this.name}] ${data.toString().trim()}`));
        this.process.stderr.on('data', (data) => console.error(`[${this.name} ERROR] ${data.toString().trim()}`));
        this.processQueue();
    }

    async processQueue() {
        if (this.isProcessing) return;
        const task = this.queue.dequeue();
        if (!task) {
            setTimeout(() => this.processQueue(), 100);
            return;
        }
        this.isProcessing = true;
        this.currentTask = task;
        try {
            const result = await this.executeTask(task);
            this.emit('task-complete', { task, result });
            task.resolve?.(result);
        } catch (error) {
            this.emit('task-error', { task, error });
            task.reject?.(error);
        } finally {
            this.queue.complete(task.id);
            this.currentTask = null;
            this.isProcessing = false;
            setImmediate(() => this.processQueue());
        }
    }

    async executeTask(task) {
        const url = `http://localhost:${this.port}${task.endpoint}`;
        const response = await fetch(url, {
            method: task.method || (task.body ? 'POST' : 'GET'),
            headers: {
                'Content-Type': 'application/json',
                'X-Priority': String(task.priority),
                'X-Task-Id': task.id
            },
            body: task.body ? JSON.stringify(task.body) : undefined
        });
        if (!response.ok) throw new Error(`Worker request failed: ${response.statusText}`);
        return await response.json();
    }

    addTask(task, priority = PRIORITY.NORMAL) {
        return new Promise((resolve, reject) => {
            task.resolve = resolve;
            task.reject = reject;
            if (this.queue.enqueue(task, priority)) {
                this.processQueue();
            } else {
                reject(new Error('Task already queued or processing'));
            }
        });
    }

    getStats() {
        return {
            name: this.name,
            port: this.port,
            cores: this.cores,
            queue: this.queue.getStats(),
            isProcessing: this.isProcessing,
            currentTask: this.currentTask ? { id: this.currentTask.id, type: this.currentTask.type, priority: this.currentTask.priority } : null
        };
    }

    stop() {
        if (this.process) this.process.kill('SIGTERM');
    }
}

class WorkerManager extends EventEmitter {
    constructor() {
        super();
        this.workers = {
            random: new PythonWorker('Random Worker', 5001, 1, 'worker_random'),
            analysis: new PythonWorker('Analysis Worker', 5002, 2, 'worker_analysis'),
            transcription: new PythonWorker('Transcription Worker', 5003, 2, 'worker_transcription')
        };
        Object.values(this.workers).forEach(worker => {
            worker.on('task-complete', ({ task, result }) => this.emit('task-complete', { worker: worker.name, task, result }));
            worker.on('task-error', ({ task, error }) => this.emit('task-error', { worker: worker.name, task, error }));
        });
    }

    async start() {
        for (const worker of Object.values(this.workers)) await worker.start();
    }

    async transcribeLyrics(videoId, audioPath = null, priority = PRIORITY.NORMAL) {
        return this.workers.transcription.addTask({
            type: 'transcription',
            endpoint: '/api/transcribe-lyrics',
            method: 'POST',
            body: { video_id: videoId, audio_path: audioPath },
            id: `transcribe-${videoId}`
        }, priority);
    }

    async analyzeAudio(videoId, priority = PRIORITY.NORMAL) {
        return this.workers.analysis.addTask({
            type: 'analysis',
            endpoint: '/api/analyze-audio',
            method: 'POST',
            body: { video_id: videoId },
            id: `analyze-${videoId}`
        }, priority);
    }

    async findNewYoutubeMusicReleases(artistId, date, priority = PRIORITY.NORMAL) {
        return this.workers.random.addTask({
            type: 'youtube_music',
            endpoint: `/find_new_youtube_music_releases?artist_id=${encodeURIComponent(artistId)}&date=${encodeURIComponent(date)}`,
            method: 'GET',
            id: `find_new_youtube_music_releases-${artistId}-${date}`
        }, priority);
    }

    async findYoutubeMusicLyrics(videoId, priority = PRIORITY.NORMAL) {
        return this.workers.random.addTask({
            type: 'youtube_music',
            endpoint: `/find_youtube_music_lyrics?video_id=${encodeURIComponent(videoId)}`,
            method: 'GET',
            id: `find_youtube_music_lyrics-${videoId}`
        }, priority);
    }

    async getYoutubeMusicArtist(artistId, priority = PRIORITY.NORMAL) {
        return this.workers.random.addTask({
            type: 'youtube_music',
            endpoint: `/get_artist?artist_id=${encodeURIComponent(artistId)}`,
            method: 'GET',
            id: `get_artist-${artistId}`
        }, priority);
    }

    async makeRequest(endpoint, body, priority = PRIORITY.NORMAL) {
        return this.workers.random.addTask({
            type: 'generic',
            endpoint,
            method: 'POST',
            body,
            id: `request-${endpoint}-${JSON.stringify(body).substring(0, 20)}`
        }, priority);
    }

    promoteTask(taskId, newPriority) {
        for (const worker of Object.values(this.workers)) {
            if (worker.queue.promote(taskId, newPriority)) return true;
        }
        return false;
    }

    getStats() {
        return { workers: Object.values(this.workers).map(w => w.getStats()), timestamp: new Date().toISOString() };
    }

    stop() {
        Object.values(this.workers).forEach(worker => worker.stop());
    }
}

let manager = null;
export function getWorkerManager() {
    if (!manager) manager = new WorkerManager();
    return manager;
}
export default WorkerManager;
