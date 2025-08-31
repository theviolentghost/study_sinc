import express from 'express';
import { spawn } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs-extra';
import path from 'path';

const __dirname = path.resolve();

class Adaptive_Stream {
    static profiles = {
        'desperate': { 
            bitrate: '16k',
            sample_rate: 22050,
            channels: 1,
            audio_profile: 'aac_he',
            bandwidth: 16 * 1024,
            codec: 'mp4a.40.2',
            hls_time: '1.0', // Short segments for fast startup
            hls_preset: 'ultrafast',
        },
        'ultra-low': { 
            bitrate: '32k',
            sample_rate: 22050,
            channels: 1,
            audio_profile: 'aac_he',
            bandwidth: 32 * 1024,
            codec: 'mp4a.40.2',
            hls_time: '1.0', // Short segments for fast startup
            hls_preset: 'ultrafast',
        },
        'low': { 
            bitrate: '64k',
            sample_rate: 44100, 
            channels: 1, 
            audio_profile: 'aac_he',
            bandwidth: 64 * 1024 ,
            codec: 'mp4a.40.2',
            hls_time: '1.0', // Short segments for fast startup
            hls_preset: 'ultrafast',
        },
        'medium': { 
            bitrate: '128k',
            sample_rate: 44100,
            channels: 2,
            audio_profile: 'aac_low',
            bandwidth: 128 * 1024,
            codec: 'mp4a.40.2',
            hls_time: '2.0',
            hls_preset: 'fast',
        },
        'high': { 
            bitrate: '192k',
            sample_rate: 44100,
            channels: 2,
            audio_profile: 'aac_low',
            bandwidth: 192 * 1024,
            codec: 'mp4a.40.2',
            hls_time: '4.0',
            hls_preset: 'medium',
        },
        'ultra-high': { 
            bitrate: '256k',
            sample_rate: 44100,
            channels: 2,
            audio_profile: 'aac_low',
            bandwidth: 256 * 1024,
            codec: 'mp4a.40.2',
            hls_time: '4.0',
            hls_preset: 'medium',
        }
    };
    static profile_progression = ['ultra-low', 'low', 'medium', 'high', 'ultra-high']; // Order of profiles for adaptive streaming
    get_requested_profiles(target_profile = 'medium') {
        const target_index = Adaptive_Stream.profile_progression.indexOf(target_profile);
        if (target_index === -1) return [];

        // Get all profiles from ultra-low to the target profile
        return Adaptive_Stream.profile_progression.slice(0, target_index + 1);
    }
    static hls_root = path.join(__dirname, 'storage', 'musik', 'hls');
    static stream_buffer_size = '16K'; // Buffer size for streaming

    static hls_playlist_max_timeout = 30000; // Max wait time for playlist in ms
    static hls_playlist_refresh_interval = 100; // Interval to check for playlist in ms
    static hls_playlist_segment_wait_timeout = 30000; // Max wait time for first segment in ms
    static hls_playlist_segment_interval = 50; // Interval to check for first segment in ms

    static hls_playlist_max_uphold_time = 15 * 60 * 1000; // 15 min (can be kept alive to last longer)
    static hls_playlist_cleanup_interval = 5 * 60 * 1000; // 5 min

    static hls_playlist_generation_timeout = 60000; // 60 seconds to handle YouTube rate limiting

    setup_endpoints(app) {
        // Configure static middleware with proper MIME types for HLS
        app.use('/hls', express.static(Adaptive_Stream.hls_root, {
            setHeaders: (res, path) => {
                if (path.endsWith('.m3u8')) {
                    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.setHeader('Access-Control-Allow-Headers', 'Range');
                    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
                } else if (path.endsWith('.ts')) {
                    res.setHeader('Content-Type', 'video/mp2t');
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.setHeader('Access-Control-Allow-Headers', 'Range');
                    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
                }
            }
        }));

        // Standard adaptive quality stream
        app.get('/stream', async (req, res) => {
            const video_id = req.query.video_id;
            const target_quality = req.query.quality || 'medium';

            if (!video_id) {
                return res.status(400).json({ 
                    error: 'Missing video_id parameter', 
                    success: false 
                });
            }

            try {
                // console.log('stream:', video_id);
                const response = await this.stream(video_id, target_quality);
                res.json(response);
            } catch (error) {
                console.log(`Streaming error for ${video_id}:`, error.message);
                
                // Return appropriate error based on the type
                if (error.message.includes('Video not available') || 
                    error.message.includes('Video not found') ||
                    error.message.includes('unavailable') ||
                    error.message.includes('does not exist') ||
                    error.message.includes('not found') ||
                    error.message.includes('members-only') ||
                    error.message.includes('age-restricted') ||
                    error.message.includes('region-blocked') ||
                    error.message.includes('copyright') ||
                    error.message.includes('removed') ||
                    error.message.includes('deleted')) {
                    res.status(404).json({ 
                        error: 'Video not found or unavailable', 
                        message: 'The requested song/video could not be found or is not accessible.',
                        video_id: video_id,
                        success: false 
                    });
                } else if (error.message.includes('Timeout')) {
                    res.status(408).json({ 
                        error: 'Stream timeout', 
                        message: 'The stream took too long to initialize. Please try again.',
                        success: false 
                    });
                } else {
                    res.status(500).json({ 
                        error: 'Error generating stream', 
                        message: 'An internal error occurred while processing your request.',
                        success: false 
                    });
                }
            }
        });

        app.get('/stream/preload', async (req, res) => {
            const video_id = req.query.video_id;
            const target_quality = req.query.quality || 'medium';

            if (!video_id) {
                return res.status(400).json({ 
                    error: 'Missing video_id parameter', 
                    success: false 
                });
            }

            try {
                // console.log(`Preloading stream for video ID: ${video_id} with target quality: ${target_quality}`);
                const response = await this.preload(video_id, target_quality);
                res.json(response);
            } catch (error) {
                console.error(`Preload error for ${video_id}:`, error.message);
                
                // Return appropriate error based on the type
                if (error.message.includes('Video not available') || 
                    error.message.includes('Video not found') ||
                    error.message.includes('unavailable') ||
                    error.message.includes('does not exist') ||
                    error.message.includes('not found') ||
                    error.message.includes('members-only') ||
                    error.message.includes('age-restricted') ||
                    error.message.includes('region-blocked') ||
                    error.message.includes('copyright') ||
                    error.message.includes('removed') ||
                    error.message.includes('deleted')) {
                    res.status(404).json({ 
                        error: 'Video not found or unavailable', 
                        message: 'The requested song/video could not be found or is not accessible.',
                        video_id: video_id,
                        success: false 
                    });
                } else if (error.message.includes('Timeout')) {
                    res.status(408).json({ 
                        error: 'Preload timeout', 
                        message: 'The preload took too long to initialize. Please try again.',
                        success: false 
                    });
                } else {
                    res.status(500).json({ 
                        error: 'Error generating preload stream', 
                        message: 'An internal error occurred while processing your request.',
                        success: false 
                    });
                }
            }
        });

        app.get('stream/keepalive', async (req, res) => {
            const video_id = req.query.video_id;
            const target_quality = req.query.quality || 'medium';
            // to implement
        });

        app.get('/music/duration', async (req, res) => {
            const video_id = req.query.video_id;
            if (!video_id) {
                return res.status(400).json({ 
                    error: 'Missing video_id parameter', 
                    success: false 
                });
            }
            
            const video_url = `https://www.youtube.com/watch?v=${video_id}`;
            try {
                const duration_str = await this.get_duration(video_url);
                const duration_ms = this.parse_duration(duration_str);
                res.json({ 
                    duration: duration_ms,
                    video_id: video_id,
                    success: true 
                });
            } catch (error) {
                console.error(`Duration error for ${video_id}:`, error.message);
                
                // Return appropriate error based on the type
                if (error.message.includes('Video not available') || 
                    error.message.includes('Video not found') ||
                    error.message.includes('unavailable') ||
                    error.message.includes('does not exist') ||
                    error.message.includes('not found') ||
                    error.message.includes('members-only') ||
                    error.message.includes('age-restricted') ||
                    error.message.includes('region-blocked') ||
                    error.message.includes('copyright') ||
                    error.message.includes('removed') ||
                    error.message.includes('deleted')) {
                    res.status(404).json({ 
                        error: 'Video not found or unavailable', 
                        message: 'The requested song/video could not be found or is not accessible.',
                        video_id: video_id,
                        success: false 
                    });
                } else if (error.message.includes('Timeout')) {
                    res.status(408).json({ 
                        error: 'Duration timeout', 
                        message: 'The duration lookup took too long. Please try again.',
                        success: false 
                    });
                } else {
                    res.status(500).json({ 
                        error: 'Error getting duration', 
                        message: 'An internal error occurred while getting video duration.',
                        success: false 
                    });
                }
            }
        });

        // Get session status (useful for checking upgrade progress)
        // app.get('/session/:session_id/status', (req, res) => {
        //     const session_id = req.params.session_id;
        //     const session = this.active_processes.get(session_id);
            
        //     if (!session) {
        //         return res.status(404).json({ error: 'Session not found' });
        //     }

        //     res.json({
        //         session_id: session_id,
        //         phase: session.phase || 'active',
        //         target_quality: session.target_quality,
        //         playlist_url: session.playlist_url || `/hls/${session_id}/instant.m3u8`,
        //         duration: session.duration || null,
        //         upgrade_available: session.phase === 'upgraded'
        //     });
        // });

        app.delete('/session/:session_id', async (req, res) => {
            const session_id = req.params.session_id;
            try {
                await this.clean(session_id);
                res.json({ success: true, message: 'Session cleaned up' });
            } catch (error) {
                res.status(500).json({ error: 'Cleanup failed: ' + error.message });
            }
        });
    }
    constructor() {
        this.active_processes = new Map();

        this.hls_directory_cleanup();
        setInterval(() => this.hls_directory_cleanup(), Adaptive_Stream.hls_playlist_cleanup_interval); 
    }

    does_session_already_exist(session_id, target_quality) {
        const session = this.active_processes.get(session_id);
        if (!session) return false;

        // Check if the session has the requested quality
        const requested_profiles = this.get_requested_profiles(target_quality);
        return requested_profiles.some(profile => 
            session.qualities.includes(profile) && 
            fs.existsSync(path.join(session.session_directory, `${Adaptive_Stream.profiles[profile].bitrate}.m3u8`))
        );
    }

    async stream(video_id, target_quality = 'medium', fast_startup = true) {
        // console.time('dir check');
        console.log(`Starting stream for video ${video_id} with quality ${target_quality}`);
        fs.appendFileSync('/tmp/stream-debug.log', `\n${new Date().toISOString()} - Starting stream for ${video_id}\n`);

        const session_id = video_id;
        const url = `https://www.youtube.com/watch?v=${video_id}`;
        const session_directory = path.join(Adaptive_Stream.hls_root, session_id);
        let requested_profiles = this.get_requested_profiles(target_quality);

        // console.log(`Starting stream for video ID: ${video_id} with target quality: ${target_quality}`);

        // Check if session already exists
        // if so return existing session info if it contains the requested quality
        if( this.does_session_already_exist(session_id, target_quality) ) {
            const session = this.active_processes.get(session_id);
            if (!session) throw new Error(`Session ${session_id} not found`);
            session.start_time = Date.now(); 
            return {
                success: true,
                playlist_url: `/hls/${session_id}/master.m3u8`,
                session_id: session_id,
                qualities: this.get_requested_profiles(target_quality),
                startup_mode: fast_startup ? 'instant' : 'delayed',
                origin: 'existing'
            };
        }

        // if session with required quakity does not exist
        // check to see if a session with the same ID exists
        // if so, add the desired quality to the existing session
        if( this.active_processes.has(session_id) ) {
            const existing_session = this.active_processes.get(session_id);
            const missing_profiles = requested_profiles.filter(profile => !existing_session.qualities.includes(profile));
            if (missing_profiles.length === 0) {
                // make sure existing session has the minimum quality, if not wait.
                try {
                    await Promise.race([
                        Promise.all([
                            this.wait_for_playlist(path.join(session_directory, `${Adaptive_Stream.profiles[Adaptive_Stream.profile_progression[0]].bitrate}.m3u8`)),
                            this.wait_for_first_segment(session_directory, Adaptive_Stream.profiles[Adaptive_Stream.profile_progression[0]].bitrate),
                        ]),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for low quality stream')), Adaptive_Stream.hls_playlist_generation_timeout))
                    ]);
                } catch (error) {
                    console.error('Failed to wait for low quality stream:', error);
                    throw new Error('Failed to initialize low quality stream: ' + error.message);
                }


                return {
                    success: true,
                    playlist_url: `/hls/${session_id}/master.m3u8`,
                    session_id: session_id,
                    qualities: this.get_requested_profiles(target_quality),
                    startup_mode: fast_startup ? 'instant' : 'delayed',
                    origin: 'existing#missing'
                }
            }

            existing_session.start_time = Date.now(); 
            requested_profiles = missing_profiles; // Update requested profiles to only include missing ones
        }
        // Ensure directory exists synchronously for immediate use
        else if(!fs.ensureDirSync(session_directory)) throw new Error(`Failed to create session directory: ${session_directory}`);

        // console.log('yt-dlp')
        // console.log('yt-dlp process started');

        // Create and start FFmpeg immediately after getting stream source
        let yt_dlp_process = null;
        let ffmpeg_process;
        let input_source = null;
        let using_direct_url = false;

        try {
            // First, try to get the direct stream URL
            try {
                console.log(`Attempting to get direct stream URL for ${video_id}...`);
                fs.appendFileSync('/tmp/stream-debug.log', `${new Date().toISOString()} - Attempting direct URL for ${video_id}\n`);
                // throw Error('skip url')
                const stream_url = await this.get_stream_url(url);
                input_source = stream_url;
                using_direct_url = true;
                console.log(`Got direct stream URL for ${video_id}`);
                fs.appendFileSync('/tmp/stream-debug.log', `${new Date().toISOString()} - Got direct URL for ${video_id}\n`);
            } catch (direct_url_error) {
                console.log(`Direct stream URL failed for ${video_id}, falling back to yt-dlp process: ${direct_url_error.message}`);
                fs.appendFileSync('/tmp/stream-debug.log', `${new Date().toISOString()} - Direct URL failed for ${video_id}: ${direct_url_error.message}\n`);
                
                // If getting direct URL fails, fall back to yt-dlp process
                yt_dlp_process = await this.create_yt_dlp_process(url);
                input_source = yt_dlp_process;
                using_direct_url = false;
            }

            // Create master playlist in parallel if we haven't done it yet
            await this.create_master_playlist(session_directory, target_quality);

            ffmpeg_process = await this.create_hls_stream(
                input_source, 
                session_directory, 
                target_quality,
                fast_startup,
                requested_profiles,
            );

            // Wrap FFmpeg run in a Promise for better error handling
            await new Promise((resolve, reject) => {
                let ffmpeg_started = false;
                
                ffmpeg_process.on('start', (commandLine) => {
                    ffmpeg_started = true;
                    // console.log(`FFmpeg started for ${video_id} using ${using_direct_url ? 'direct URL' : 'yt-dlp process'}`);
                    resolve(); // Resolve when FFmpeg starts, not when it ends
                });

                ffmpeg_process.on('error', (err) => {
                    console.error('FFmpeg process error:', err.message);
                    if (!ffmpeg_started) {
                        reject(new Error(`FFmpeg failed to start: ${err.message}`));
                    }
                });

                // ffmpeg_process.on('end', () => {
                //     console.log('FFmpeg process ended normally');
                // });

                // Start the FFmpeg process
                ffmpeg_process.run();
                
                // Fallback timeout in case 'start' event doesn't fire
                setTimeout(() => {
                    if (!ffmpeg_started) {
                        reject(new Error('FFmpeg process failed to start within timeout'));
                    }
                }, 8000);
            });
        } catch (error) {
            console.error(`Failed to create HLS stream for ${video_id}:`, error.message);
            console.error(`Error details:`, error);
            fs.appendFileSync('/tmp/stream-debug.log', `${new Date().toISOString()} - Failed to create HLS stream for ${video_id}: ${error.message}\n`);
            
            // If we used direct URL and it failed, try falling back to yt-dlp process
            if (using_direct_url && !yt_dlp_process) {
                console.log(`Direct URL method failed for ${video_id}, attempting fallback to yt-dlp process...`);
                try {
                    // Clean up the failed FFmpeg process first
                    if (ffmpeg_process) {
                        try {
                            ffmpeg_process.kill('SIGTERM');
                        } catch (e) {
                            console.error('Error killing failed ffmpeg process:', e.message);
                        }
                    }
                    
                    // Try with yt-dlp process
                    yt_dlp_process = await this.create_yt_dlp_process(url);
                    input_source = yt_dlp_process;
                    using_direct_url = false;
                    
                    ffmpeg_process = await this.create_hls_stream(
                        input_source, 
                        session_directory, 
                        target_quality,
                        fast_startup,
                        requested_profiles,
                    );

                    // Start FFmpeg with yt-dlp process
                    await new Promise((resolve, reject) => {
                        let ffmpeg_started = false;
                        
                        ffmpeg_process.on('start', (commandLine) => {
                            ffmpeg_started = true;
                            console.log(`FFmpeg started for ${video_id} using fallback yt-dlp process`);
                            resolve();
                        });

                        ffmpeg_process.on('error', (err) => {
                            console.error('FFmpeg process error (fallback):', err.message);
                            if (!ffmpeg_started) {
                                reject(new Error(`FFmpeg failed to start (fallback): ${err.message}`));
                            }
                        });

                        ffmpeg_process.run();
                        
                        setTimeout(() => {
                            if (!ffmpeg_started) {
                                reject(new Error('FFmpeg process failed to start within timeout (fallback)'));
                            }
                        }, 5000);
                    });
                } catch (fallback_error) {
                    console.error(`Fallback also failed for ${video_id}:`, fallback_error.message);
                    
                    // Clean up fallback attempt
                    if (yt_dlp_process && !yt_dlp_process.killed) {
                        try {
                            yt_dlp_process.kill('SIGTERM');
                        } catch (e) {
                            console.error('Error killing fallback yt-dlp process:', e.message);
                        }
                    }
                    if (ffmpeg_process) {
                        try {
                            ffmpeg_process.kill('SIGTERM');
                        } catch (e) {
                            console.error('Error killing fallback ffmpeg process:', e.message);
                        }
                    }
                    
                    // Clean up directory and throw original error
                    try {
                        if (fs.existsSync(session_directory)) {
                            fs.removeSync(session_directory);
                        }
                    } catch (e) {
                        console.error('Error cleaning up session directory:', e.message);
                    }
                    
                    if (this.active_processes.has(session_id)) {
                        this.active_processes.delete(session_id);
                    }
                    
                    throw error; // Throw the original error, not the fallback error
                }
            } else {
                // Original cleanup logic for non-fallback cases
                if (yt_dlp_process && !yt_dlp_process.killed) {
                    try {
                        yt_dlp_process.kill('SIGTERM');
                    } catch (e) {
                        console.error('Error killing yt-dlp process:', e.message);
                    }
                }
                if (ffmpeg_process) {
                    try {
                        ffmpeg_process.kill('SIGTERM');
                    } catch (e) {
                        console.error('Error killing ffmpeg process:', e.message);
                    }
                }
                
                // Clean up directory
                try {
                    if (fs.existsSync(session_directory)) {
                        fs.removeSync(session_directory);
                    }
                } catch (e) {
                    console.error('Error cleaning up session directory:', e.message);
                }
                
                // Remove from active processes if it was added
                if (this.active_processes.has(session_id)) {
                    this.active_processes.delete(session_id);
                }
                
                // Re-throw with more specific error message
                if (error.message.includes('Video not found or unavailable')) {
                    throw new Error(`Video not available: ${video_id}. The requested song/video could not be found or is not accessible.`);
                } else {
                    throw new Error(`Failed to initialize stream for ${video_id}: ${error.message}`);
                }
            }
        }
        // console.log('FFmpeg process started');

        // Store session info immediately for cleanup
        this.active_processes.set(session_id, {
            ffmpeg: ffmpeg_process,
            yt_dlp: yt_dlp_process,
            url: url,
            session_id: session_id,
            session_directory: session_directory,
            qualities: this.get_requested_profiles(target_quality),
            target_quality: target_quality,
            start_time: Date.now(),
            stream_method: using_direct_url ? 'direct_url' : 'yt_dlp_process'
        });

        // Wait for both the playlist and first segment to be ready
        try {
            await Promise.race([
                Promise.all([
                    this.wait_for_playlist(path.join(session_directory, `${Adaptive_Stream.profiles[Adaptive_Stream.profile_progression[0]].bitrate}.m3u8`)),
                    this.wait_for_first_segment(session_directory, Adaptive_Stream.profiles[Adaptive_Stream.profile_progression[0]].bitrate),
                ]),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for low quality stream')), Adaptive_Stream.hls_playlist_generation_timeout))
            ]);
        } catch (error) {
            console.error('Failed to wait for low quality stream:', error);
            fs.appendFileSync('/tmp/stream-debug.log', `${new Date().toISOString()} - Failed to wait for low quality stream for ${video_id}: ${error.message}\n`);
            throw new Error('Failed to initialize low quality stream: ' + error.message);
        }

        // console.log(`Stream for video ID ${video_id} started successfully with target quality: ${target_quality}`);
        // console.log(path.join(session_directory, `${Adaptive_Stream.profiles[Adaptive_Stream.profile_progression[0]].bitrate}.m3u8`), 'exists')

        return {
            success: true,
            playlist_url: `/hls/${session_id}/master.m3u8`,
            session_id: session_id,
            qualities: this.get_requested_profiles(target_quality),
            startup_mode: fast_startup ? 'instant' : 'delayed',
            origin: 'new'
        };
    }

    async preload(video_id, target_quality = 'medium') {
        return this.stream(video_id, target_quality, false); // Start streaming without fast startup
    }

    parse_duration(duration_str) {
        // Parse duration string in format "HH:MM:SS" or "MM:SS"
        if (!duration_str || duration_str.trim() === '' || duration_str === '00:00') {
            throw new Error('No valid duration available');
        }
        
        const parts = duration_str.split(':').map(Number);
        if (parts.length === 3) {
            return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000; // HH:MM:SS
        } else if (parts.length === 2) {
            return (parts[0] * 60 + parts[1]) * 1000; // MM:SS
        } else {
            throw new Error('Invalid duration format');
        }
    }

    async create_master_playlist(session_directory, target_quality) {
        const profiles = this.get_requested_profiles(target_quality);
        if (profiles.length === 0) {
            throw new Error('No valid profiles found for target quality: ' + target_quality);
        }

        const master_lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
        for (const profile of profiles) {
            const profile_data = Adaptive_Stream.profiles[profile];
            if (!profile_data) {
                console.warn(`Profile ${profile} not found, skipping`);
                continue;
            }
            master_lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${profile_data.bandwidth},CODECS="${profile_data.codec}"`);
            master_lines.push(`${profile_data.bitrate}.m3u8`);
        }

        const master_path = path.join(session_directory, 'master.m3u8');
        fs.writeFileSync(master_path, master_lines.join('\n'));

        return master_path;
    }

    async create_hls_stream(input_source, session_directory, target_quality = 'medium', fast_startup = false, requested_profiles) {
        const profiles = requested_profiles || this.get_requested_profiles(target_quality);
        if (profiles.length === 0) {
            throw new Error('No valid profiles found for target quality: ' + target_quality);
        }
        
        // Handle different input types: yt-dlp process stdout or direct stream URL
        let ffmpeg_process;
        if (typeof input_source === 'string') {
            // input_source is a stream URL
            ffmpeg_process = ffmpeg(input_source);
        } else {
            // input_source is a yt-dlp process with stdout
            ffmpeg_process = ffmpeg(input_source.stdout);
        }
        
        // Add error handling for FFmpeg process
        ffmpeg_process.on('error', (err) => {
            console.error('FFmpeg error:', err.message);
            // Don't throw here, let the calling code handle it
        });

        ffmpeg_process.on('stderr', (stderrLine) => {
            // Log FFmpeg stderr for debugging, but don't treat as fatal error
            if (stderrLine.includes('Error') || stderrLine.includes('error')) {
                console.error('FFmpeg stderr:', stderrLine);
            }
        });

        if (profiles.length > 1) {
            // split audio into multiple quality streams
            const split_outputs = profiles.map((profile) => `[${Adaptive_Stream.profiles[profile].bitrate}]`).join('');
            ffmpeg_process.complexFilter([
                `[0:a]asplit=${profiles.length}${split_outputs}`
            ]);
        }

        for(const profile of profiles) {
            const profile_data = Adaptive_Stream.profiles[profile];
            if (!profile_data) {
                console.warn(`Profile ${profile} not found, skipping`);
                continue;
            }

            ffmpeg_process
                .output(path.join(session_directory, `${profile_data.bitrate}.m3u8`))
                .audioCodec('aac')
                .audioBitrate(profile_data.bitrate)
                .audioChannels(profile_data.channels)
                .audioFrequency(profile_data.sample_rate)
                .format('hls')
                .outputOptions([
                     '-map', profiles.length > 1 ? `[${profile_data.bitrate}]` : '0:a',
                    '-hls_time', profile_data.hls_time || '2.0',
                    '-hls_list_size', '0',
                    // '-hls_segment_type', 'mpegts',
                    // '-start_number', '0',
                    // '-avoid_negative_ts', 'make_zero',
                    // '-fflags', '+genpts',
                    '-map_metadata', '-1',
                    '-preset', this.get_ffmpeg_preset(fast_startup, profile),
                    '-tune', this.get_ffmpeg_tune(fast_startup, profile),
                    // '-hls_flags', 'delete_segments',
                    '-hls_segment_filename', path.join(session_directory, `${profile_data.bitrate}_%d.ts`)
                ]);
        }
            
        return ffmpeg_process;
    }

    get_ffmpeg_preset(fast_startup, profile = 'ultra-low') {
        if(fast_startup) return 'ultrafast';
        return Adaptive_Stream.profiles[profile].hls_preset || 'fast';
    }

    get_ffmpeg_tune(fast_startup, profile = 'ultra-low') {
        if(fast_startup) return 'zerolatency';
        return 'fastdecode'; // Default for other profiles
    }

    async get_stream_url(url) {
        return new Promise((resolve, reject) => {
            // Validate URL first
            if (!url || typeof url !== 'string') {
                reject(new Error('Invalid URL provided to get stream URL'));
                return;
            }

            const timeout = setTimeout(() => {
                if (!yt_dlp.killed) {
                    yt_dlp.kill('SIGTERM');
                }
                reject(new Error('Timeout waiting for stream URL'));
            }, 15000); // 15 second timeout

            const yt_dlp = spawn('yt-dlp', [
                '-f', 'bestaudio[ext=m4a]/bestaudio/best',
                '--get-url',
                // '--no-playlist',
                '--quiet',
                // '--socket-timeout', '10',
                // '--retries', '1',
                url
            ]);
            
            let stream_url = '';
            let stderr_output = '';

            yt_dlp.stdout.on('data', (data) => {
                stream_url += data.toString();
            });

            yt_dlp.stderr.on('data', (data) => {
                stderr_output += data.toString();
            });

            yt_dlp.on('error', (err) => {
                clearTimeout(timeout);
                reject(new Error(`Failed to start yt-dlp for stream URL: ${err.message}`));
            });
            
            yt_dlp.on('close', (code) => {
                clearTimeout(timeout);
                if (code === 0) {
                    const trimmed_url = stream_url.trim();
                    if (trimmed_url) {
                        resolve(trimmed_url);
                    } else {
                        reject(new Error('No stream URL returned from yt-dlp'));
                    }
                } else {
                    const error_msg = stderr_output || `Process exited with code ${code}`;
                    console.error(`yt-dlp get-url failed for URL ${url}:`, error_msg);
                    
                    // Check for specific error types
                    if (stderr_output.includes('Video unavailable') || 
                        stderr_output.includes('Private video') ||
                        stderr_output.includes('This video is not available') ||
                        stderr_output.includes('does not exist') ||
                        stderr_output.includes('not found') ||
                        code === 1) {
                        reject(new Error(`Video not found or unavailable: ${url}`));
                    } else {
                        reject(new Error(`Failed to get stream URL: ${error_msg}`));
                    }
                }
            });
        });
    }

    async create_yt_dlp_process(url) {
        return new Promise((resolve, reject) => {
            // Validate URL first
            if (!url || typeof url !== 'string') {
                reject(new Error('Invalid URL provided to yt-dlp'));
                return;
            }

            // Add timeout for yt-dlp process startup
            const startup_timeout = setTimeout(() => {
                if (!resolved && process && !process.killed) {
                    process.kill('SIGTERM');
                }
                if (!resolved) {
                    resolved = true;
                    reject(new Error('Timeout waiting for yt-dlp process to start'));
                }
            }, 60000); // 60 second timeout for rate limiting

            const process = spawn('yt-dlp', [
                '-f', 'bestaudio[ext=m4a]/bestaudio/best',
                '--no-playlist',
                // '--no-warnings',
                // '--buffer-size', Adaptive_Stream.stream_buffer_size,
                // '--no-part',
                // '--socket-timeout', '10',
                // '--fragment-retries', '3',
                // '--retries', '2',
                '-o', '-',
                url
            ]);
            
            let resolved = false;
            let stderr_output = '';
            let has_stdout_data = false;
            
            // Handle process errors
            process.on('error', (err) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(startup_timeout);
                    console.error(`yt-dlp spawn error for URL ${url}:`, err.message);
                    reject(new Error(`Failed to start yt-dlp process: ${err.message}`));
                }
            });
            
            // Handle stderr to capture error messages
            if (process.stderr) {
                process.stderr.on('data', (data) => {
                    stderr_output += data.toString();
                    
                    // Check for immediate error patterns in stderr
                    const current_stderr = data.toString();
                    
                    if (!resolved && (
                        current_stderr.includes('Video unavailable') || 
                        current_stderr.includes('Private video') ||
                        current_stderr.includes('This video is not available') ||
                        current_stderr.includes('does not exist') ||
                        current_stderr.includes('not found') ||
                        current_stderr.includes('ERROR: [youtube]') ||
                        current_stderr.includes('members-only') ||
                        current_stderr.includes('age-restricted') ||
                        current_stderr.includes('region-blocked') ||
                        current_stderr.includes('copyright') ||
                        current_stderr.includes('removed') ||
                        current_stderr.includes('deleted')
                    )) {
                        resolved = true;
                        clearTimeout(startup_timeout);
                        process.kill('SIGTERM');
                        reject(new Error(`Video not found or unavailable: ${url}`));
                        return;
                    }
                });
                
                process.stderr.on('error', (err) => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(startup_timeout);
                        console.error(`yt-dlp stderr error for URL ${url}:`, err.message);
                        reject(new Error(`yt-dlp stderr error: ${err.message}`));
                    }
                });
            }
            
            // Handle stdout errors
            if (process.stdout) {
                process.stdout.on('data', (data) => {
                    has_stdout_data = true;
                });

                process.stdout.on('error', (err) => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(startup_timeout);
                        console.error(`yt-dlp stdout error for URL ${url}:`, err.message);
                        reject(new Error(`yt-dlp stdout error: ${err.message}`));
                    }
                });
            }
            
            // Handle process exit/close
            process.on('close', (code, signal) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(startup_timeout);
                    if (code !== 0) {
                        const error_msg = stderr_output || `Process exited with code ${code}`;
                        console.error(`yt-dlp failed for URL ${url}:`, error_msg);
                        
                        // Check for specific error types
                        if (stderr_output.includes('Video unavailable') || 
                            stderr_output.includes('Private video') ||
                            stderr_output.includes('This video is not available') ||
                            stderr_output.includes('does not exist') ||
                            stderr_output.includes('not found') ||
                            stderr_output.includes('Video not available') ||
                            stderr_output.includes('members-only') ||
                            stderr_output.includes('age-restricted') ||
                            stderr_output.includes('region-blocked') ||
                            stderr_output.includes('copyright') ||
                            stderr_output.includes('removed') ||
                            stderr_output.includes('deleted') ||
                            stderr_output.includes('ERROR: Unable to download') ||
                            code === 1) {
                            reject(new Error(`Video not found or unavailable: ${url}`));
                        } else {
                            reject(new Error(`yt-dlp failed: ${error_msg}`));
                        }
                    } else if (signal) {
                        reject(new Error(`yt-dlp killed by signal: ${signal}`));
                    }
                }
            });
            
            process.on('exit', (code, signal) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(startup_timeout);
                    if (code !== 0) {
                        const error_msg = stderr_output || `Process exited with code ${code}`;
                        console.error(`yt-dlp exited with error for URL ${url}:`, error_msg);
                        
                        // Check for specific error types
                        if (stderr_output.includes('Video unavailable') || 
                            stderr_output.includes('Private video') ||
                            stderr_output.includes('This video is not available') ||
                            stderr_output.includes('does not exist') ||
                            stderr_output.includes('not found') ||
                            stderr_output.includes('Video not available') ||
                            stderr_output.includes('members-only') ||
                            stderr_output.includes('age-restricted') ||
                            stderr_output.includes('region-blocked') ||
                            stderr_output.includes('copyright') ||
                            stderr_output.includes('removed') ||
                            stderr_output.includes('deleted') ||
                            stderr_output.includes('ERROR: Unable to download') ||
                            code === 1) {
                            reject(new Error(`Video not found or unavailable: ${url}`));
                        } else {
                            reject(new Error(`yt-dlp exited with error: ${error_msg}`));
                        }
                    } else if (signal) {
                        reject(new Error(`yt-dlp terminated by signal: ${signal}`));
                    }
                }
            });
            
            // Wait a bit to ensure the process started successfully
            setTimeout(() => {
                if (!resolved && !process.killed) {
                    resolved = true;
                    clearTimeout(startup_timeout);
                    resolve(process);
                }
            }, 500); // Reduced initial timeout, let the process start normally
        });
    }

    wait_for_playlist(playlist_path) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout waiting for playlist')), Adaptive_Stream.hls_playlist_max_timeout);
            
            const check = () => {
                if (fs.existsSync(playlist_path)) {
                    try {
                        const content = fs.readFileSync(playlist_path, 'utf8');
                        // Check if playlist has actual content and at least one segment reference
                        if (content.includes('#EXTM3U') && content.includes('.ts')) {
                            clearTimeout(timeout);
                            resolve();
                            return;
                        }
                    } catch (e) {
                        // File exists but not readable/complete yet
                    }
                }
                setTimeout(check, Adaptive_Stream.hls_playlist_refresh_interval);
            };
            check();
        });
    };


        // Wait for at least the first segment to be created
    wait_for_first_segment(session_directory, quality = 'low') {
        return new Promise((resolve, reject) => {
            console.log(`Waiting for first segment: ${quality}_0.ts in directory ${session_directory}`);
            const timeout = setTimeout(() => {
                const segment_path = path.join(session_directory, `${quality}_0.ts`);
                console.log(`Timeout waiting for first segment. Expected file: ${segment_path}`);
                console.log(`Directory exists: ${fs.existsSync(session_directory)}`);
                if (fs.existsSync(session_directory)) {
                    console.log(`Directory contents:`, fs.readdirSync(session_directory).slice(0, 10));
                }
                reject(new Error('Timeout waiting for first segment'));
            }, Adaptive_Stream.hls_playlist_segment_wait_timeout);
            
            const check = () => {
                const segment_path = path.join(session_directory, `${quality}_0.ts`);
                if (fs.existsSync(segment_path)) {
                    console.log(`First segment found: ${segment_path}`);
                    clearTimeout(timeout);
                    resolve();
                } else {
                    setTimeout(check, Adaptive_Stream.hls_playlist_segment_interval);
                }
            };
            check();
        });
    }

    // async seek(session_id, time) {
    //     // to implement
    //     const session = this.active_processes.get(session_id);
    //     if (!session) {
    //         throw new Error('Session not found');
    //     }

    //     this.clean(session_id); // Clean up the session before seeking

    //     this.stream(session.url, time, session.quality);
    //     return {
    //         success: true,
    //         playlist_url: `/hls/${session_id}/stream.m3u8`,
    //         session_id: session_id
    //     };
    // }

    health() {
        const sessions = fs.readdirSync(Adaptive_Stream.hls_root).filter(dir => 
            fs.statSync(path.join(Adaptive_Stream.hls_root, dir)).isDirectory()
        );
        
        const activeProcessCount = this.active_processes.size;
        
        return {
            status: 'healthy',
            activeSessions: sessions.length,
            activeProcesses: activeProcessCount,
            sessions: sessions
        };
    }

    async clean(session_id) {
        const session = this.active_processes.get(session_id);
        if (session) {
            const { ffmpeg, yt_dlp, session_directory } = session;

            //cleanup processes
            try {
                ffmpeg.kill('SIGTERM');
                yt_dlp.kill('SIGTERM');
            } catch (e) {
                console.error('Error terminating processes:', e);
            }

            //cleanup files
            try {
                if (fs.existsSync(session_directory)) {
                    fs.removeSync(session_directory);
                }
            } catch (e) {
                console.error('Error removing session directory:', e);
            }

            // Remove from active processes
            this.active_processes.delete(session_id);
        }
    }

    async hls_directory_cleanup() {
        // cleanup old sessions
        const sessions = fs.readdirSync(Adaptive_Stream.hls_root).filter(dir => 
            fs.statSync(path.join(Adaptive_Stream.hls_root, dir)).isDirectory()
        );

        const now = Date.now();
        for (const session_id of sessions) {
            const session = this.active_processes.get(session_id);
            if (session) {
                const age = now - session.start_time;
                if (age > Adaptive_Stream.hls_playlist_max_uphold_time) { // 1 hour
                    await this.clean(session_id);
                    this.active_processes.delete(session_id);
                    console.log(`Cleaned up old session: ${session_id}`);
                }
            } else {
                // If no active process, remove the directory
                const session_directory = path.join(Adaptive_Stream.hls_root, session_id);
                try {
                    if (fs.existsSync(session_directory)) {
                        fs.removeSync(session_directory);
                        console.log(`Removed stale session directory: ${session_id}`);
                    }
                } catch (e) {
                    console.error('Error removing stale session directory:', e);
                }
            }
        }
    }

    get_duration(url) {
        // Get the duration of the video using yt-dlp
        if (!url) return Promise.reject(new Error('URL is required to get duration'));

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (!yt_dlp.killed) {
                    yt_dlp.kill('SIGTERM');
                }
                reject(new Error('Timeout waiting for video duration'));
            }, 15000); // 15 second timeout

            const yt_dlp = spawn('yt-dlp', [
                '--get-duration',
                '--no-playlist',
                '--quiet',
                '--socket-timeout', '10',
                '--retries', '1',
                url
            ]);
            
            let duration = '';
            let stderr_output = '';

            yt_dlp.stdout.on('data', (data) => {
                duration += data.toString();
            });

            yt_dlp.stderr.on('data', (data) => {
                stderr_output += data.toString();
            });

            yt_dlp.on('error', (err) => {
                clearTimeout(timeout);
                reject(new Error(`Failed to start yt-dlp for duration: ${err.message}`));
            });
            
            yt_dlp.on('close', (code) => {
                clearTimeout(timeout);
                if (code === 0) {
                    const trimmed_duration = duration.trim();
                    if (trimmed_duration) {
                        resolve(trimmed_duration);
                    } else {
                        reject(new Error('No duration returned from yt-dlp'));
                    }
                } else {
                    const error_msg = stderr_output || `Process exited with code ${code}`;
                    console.error(`yt-dlp duration failed for URL ${url}:`, error_msg);
                    
                    // Check for specific error types
                    if (stderr_output.includes('Video unavailable') || 
                        stderr_output.includes('Private video') ||
                        stderr_output.includes('This video is not available') ||
                        stderr_output.includes('does not exist') ||
                        stderr_output.includes('not found') ||
                        code === 1) {
                        reject(new Error(`Video not found or unavailable: ${url}`));
                    } else {
                        reject(new Error(`Failed to get duration: ${error_msg}`));
                    }
                }
            });
        });
    }
}

export default Adaptive_Stream;