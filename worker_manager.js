/**
 * Worker Manager for CPU-optimized task distribution
 * M1 MacBook: 8 cores (4 performance + 4 efficiency)
 * 
 * Allocation:
 * - Python Worker 1 (Random): 1 core
 * - Python Worker 2 (Analysis): 2 cores
 * - Python Worker 3 (Transcription): 2 cores
 * - Node.js (HLS/Main): 3 cores
 */

import { spawn, exec } from 'child_process';
import { EventEmitter } from 'events';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Check if a port is in use and kill the process using it
 * @param {number} port - Port number to check
 * @returns {Promise<boolean>} - True if a process was killed, false otherwise
 */
async function killProcessOnPort(port) {
    try {
        // Use lsof to find process using the port
        const { stdout } = await execAsync(`lsof -ti:${port}`);
        const pids = stdout.trim().split('\n').filter(pid => pid);
        
        if (pids.length > 0) {
            console.log(`   🔄 Port ${port} in use by PID(s): ${pids.join(', ')}`);
            
            // Kill all processes on this port
            for (const pid of pids) {
                try {
                    await execAsync(`kill -9 ${pid}`);
                    console.log(`   ✅ Killed process ${pid} on port ${port}`);
                } catch (killError) {
                    console.error(`   ⚠️  Could not kill process ${pid}: ${killError.message}`);
                }
            }
            
            // Wait a moment for port to be released
            await new Promise(resolve => setTimeout(resolve, 500));
            return true;
        }
        return false;
    } catch (error) {
        // lsof returns error if no process found - this is fine
        if (error.code === 1) {
            return false;
        }
        console.error(`   ⚠️  Error checking port ${port}: ${error.message}`);
        return false;
    }
}

// Priority levels for task queuing
export const PRIORITY = {
    URGENT: 0,      // Currently playing song (user waiting)
    HIGH: 1,        // Next in queue
    NORMAL: 2,      // In-demand load (user browsing)
    LOW: 3,         // Lazy load (background prefetch)
    IDLE: 4         // Pre-cache (when idle)
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
        // Check if already in queue or processing
        const taskId = task.id || JSON.stringify(task);
        if (this.processing.has(taskId)) {
            return false; // Already processing
        }

        // Check if already in any queue
        for (const queue of Object.values(this.queues)) {
            if (queue.some(t => (t.id || JSON.stringify(t)) === taskId)) {
                return false; // Already queued
            }
        }

        task.id = taskId;
        task.priority = priority;
        task.queuedAt = Date.now();
        
        this.queues[priority].push(task);
        return true;
    }

    dequeue() {
        // Check queues in priority order
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

    // Promote task priority (e.g., lazy load becomes urgent when user clicks)
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
        console.log(`🚀 Starting ${this.name} on port ${this.port} with ${this.cores} cores`);
        
        // Check if port is in use and kill any existing process
        await killProcessOnPort(this.port);
        
        // Set CPU affinity and thread limits via environment
        const env = {
            ...process.env,
            FLASK_PORT: String(this.port),
            OMP_NUM_THREADS: String(this.cores),
            MKL_NUM_THREADS: String(this.cores),
            OPENBLAS_NUM_THREADS: String(this.cores),
            VECLIB_MAXIMUM_THREADS: String(this.cores),
            NUMEXPR_NUM_THREADS: String(this.cores),
            WORKER_NAME: this.name,
            WORKER_CORES: String(this.cores)
        };

        const gunicornPath = `${this.venvPath}/bin/gunicorn`;
        const serverModule = `${this.serverFile}:app`;
        
        console.log(`   Gunicorn: ${gunicornPath}`);
        console.log(`   Module: ${serverModule}`);
        console.log(`   Port: ${this.port}`);
        console.log(`   Cores: ${this.cores}`);

        // Use Gunicorn (production WSGI server) instead of Flask development server
        this.process = spawn(gunicornPath, [
            '--config', 'gunicorn_config.py',
            serverModule
        ], {
            env,
            cwd: process.cwd(),
            stdio: ['pipe', 'pipe', 'pipe']
        });

        this.process.stdout.on('data', (data) => {
            console.log(`[${this.name}] ${data.toString().trim()}`);
        });

        this.process.stderr.on('data', (data) => {
            console.error(`[${this.name} ERROR] ${data.toString().trim()}`);
        });

        this.process.on('exit', (code) => {
            console.log(`[${this.name}] exited with code ${code}`);
            this.emit('exit', code);
        });

        // Start processing queue
        this.processQueue();
    }

    async processQueue() {
        if (this.isProcessing) return;

        const task = this.queue.dequeue();
        if (!task) {
            // Check again in 100ms
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
            // Process next task
            setImmediate(() => this.processQueue());
        }
    }

    async executeTask(task) {
        // Make HTTP request to worker's Flask server
        const response = await fetch(`http://localhost:${this.port}${task.endpoint}`, {
            method: task.method || 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Priority': task.priority,
                'X-Task-Id': task.id
            },
            body: task.body ? JSON.stringify(task.body) : undefined
        });

        if (!response.ok) {
            throw new Error(`Worker request failed: ${response.statusText}`);
        }

        return await response.json();
    }

    addTask(task, priority = PRIORITY.NORMAL) {
        return new Promise((resolve, reject) => {
            task.resolve = resolve;
            task.reject = reject;
            
            const added = this.queue.enqueue(task, priority);
            if (added) {
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
            currentTask: this.currentTask ? {
                id: this.currentTask.id,
                type: this.currentTask.type,
                priority: this.currentTask.priority
            } : null
        };
    }

    stop() {
        if (this.process) {
            this.process.kill('SIGTERM');
        }
    }
}

class WorkerManager extends EventEmitter {
    constructor() {
        super();
        
        // Initialize workers with their specific server files
        this.workers = {
            random: new PythonWorker('Random Worker', 5001, 1, 'worker_random'),
            analysis: new PythonWorker('Analysis Worker', 5002, 2, 'worker_analysis'),
            transcription: new PythonWorker('Transcription Worker', 5003, 2, 'worker_transcription')
        };

        // Setup event listeners
        Object.values(this.workers).forEach(worker => {
            worker.on('task-complete', ({ task, result }) => {
                this.emit('task-complete', { worker: worker.name, task, result });
            });
            worker.on('task-error', ({ task, error }) => {
                this.emit('task-error', { worker: worker.name, task, error });
            });
        });
    }

    async start() {
        console.log('🎵 Starting Worker Manager for M1 optimization...\n');
        console.log('CPU Allocation:');
        console.log('  - Random Worker:        1 core  (port 5001)');
        console.log('  - Analysis Worker:      2 cores (port 5002)');
        console.log('  - Transcription Worker: 2 cores (port 5003)');
        console.log('  - Node.js (HLS):        3 cores (main process)\n');

        // Start workers sequentially to avoid port conflicts
        for (const worker of Object.values(this.workers)) {
            await worker.start();
        }
    }

    /**
     * Request lyrics transcription
     */
    async transcribeLyrics(videoId, audioPath = null, priority = PRIORITY.NORMAL) {
        return this.workers.transcription.addTask({
            type: 'transcription',
            endpoint: '/api/transcribe-lyrics',
            method: 'POST',
            body: { video_id: videoId, audio_path: audioPath },
            id: `transcribe-${videoId}`
        }, priority);
    }

    /**
     * Request audio analysis
     */
    async analyzeAudio(videoId, priority = PRIORITY.NORMAL) {
        return this.workers.analysis.addTask({
            type: 'analysis',
            endpoint: '/api/analyze-audio',
            method: 'POST',
            body: { video_id: videoId },
            id: `analyze-${videoId}`
        }, priority);
    }

    /**
     * Generic Python request
     */
    async makeRequest(endpoint, body, priority = PRIORITY.NORMAL) {
        return this.workers.random.addTask({
            type: 'generic',
            endpoint,
            method: 'POST',
            body,
            id: `request-${endpoint}-${JSON.stringify(body).substring(0, 20)}`
        }, priority);
    }

    /**
     * Promote task priority (e.g., user clicked on a song being lazy-loaded)
     */
    promoteTask(taskId, newPriority) {
        for (const worker of Object.values(this.workers)) {
            if (worker.queue.promote(taskId, newPriority)) {
                return true;
            }
        }
        return false;
    }

    getStats() {
        return {
            workers: Object.values(this.workers).map(w => w.getStats()),
            timestamp: new Date().toISOString()
        };
    }

    stop() {
        Object.values(this.workers).forEach(worker => worker.stop());
    }
}

// Singleton instance
let manager = null;

export function getWorkerManager() {
    if (!manager) {
        manager = new WorkerManager();
    }
    return manager;
}

export default WorkerManager;
