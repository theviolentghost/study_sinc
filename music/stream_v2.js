import express from 'express';
import { spawn } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import file_system from 'fs-extra';
import path from 'path';
import https from 'https';

// import { request_embedding, is_song_in_process_queue } from './recommendation/reuqest.embedding.js';
// import { get_mix_information }

const __dirname = path.resolve();

// Helper function to call Python DJ service
async function call_dj_api(endpoint, data) {
    return new Promise((resolve, reject) => {
        const DJ_SERVICE_HOST = process.env.DJ_SERVICE_HOST || 'localhost';
        const DJ_SERVICE_PORT = process.env.DJ_SERVICE_PORT || 5000;
        
        const postData = JSON.stringify(data);
        
        const options = {
            hostname: DJ_SERVICE_HOST,
            port: DJ_SERVICE_PORT,
            path: endpoint,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: 30000 // 30 second timeout
        };
        
        const req = https.request(options, (res) => {
            let responseData = '';
            
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            
            res.on('end', () => {
                try {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        const parsedData = JSON.parse(responseData);
                        resolve(parsedData);
                    } else {
                        reject(new Error(`DJ service returned status ${res.statusCode}: ${responseData}`));
                    }
                } catch (error) {
                    reject(new Error(`Failed to parse DJ service response: ${error.message}`));
                }
            });
        });
        
        req.on('error', (error) => {
            reject(new Error(`DJ service connection error: ${error.message}`));
        });
        
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('DJ service request timeout'));
        });
        
        req.write(postData);
        req.end();
    });
}

class Adaptive_Stream {
    static profiles = {
        'opus': {
            'ultra-low': {
                bitrate: '24k',
                sample_rate: 48000,
                channels: 1,
                bandwidth: 24 * 1024,
                codec: 'libopus', // FFmpeg codec name
                hls_codec: 'opus', // HLS CODECS attribute
                audio_profile: 'audio', // Opus application mode
                compression_level: 10,
                frame_duration: 60, // ms
                vbr: 'on',
                hls_time: '1.0',
                hls_preset: 'ultrafast',
            },
            'low': {
                bitrate: '48k',
                sample_rate: 48000,
                channels: 1,
                bandwidth: 48 * 1024,
                codec: 'libopus',
                hls_codec: 'opus',
                audio_profile: 'audio',
                compression_level: 10,
                frame_duration: 40,
                vbr: 'on',
                hls_time: '2.0',
                hls_preset: 'ultrafast',
            },
            'medium': {
                bitrate: '96k',
                sample_rate: 48000,
                channels: 2,
                bandwidth: 96 * 1024,
                codec: 'libopus',
                hls_codec: 'opus',
                audio_profile: 'audio',
                compression_level: 10,
                frame_duration: 20,
                vbr: 'on',
                hls_time: '4.0',
                hls_preset: 'fast',
            },
            'high': {
                bitrate: '128k',
                sample_rate: 48000,
                channels: 2,
                bandwidth: 128 * 1024,
                codec: 'libopus',
                hls_codec: 'opus',
                audio_profile: 'audio',
                compression_level: 10,
                frame_duration: 20,
                vbr: 'on',
                hls_time: '8.0',
                hls_preset: 'medium',
            },
            'ultra-high': {
                bitrate: '192k',
                sample_rate: 48000,
                channels: 2,
                bandwidth: 192 * 1024,
                codec: 'libopus',
                hls_codec: 'opus',
                audio_profile: 'audio',
                compression_level: 10,
                frame_duration: 20,
                vbr: 'constrained',
                hls_time: '8.0',
                hls_preset: 'medium',
            },
        },
        'aac': {
            'ultra-low': {
                bitrate: '32k',
                sample_rate: 22050,
                channels: 1,
                bandwidth: 32 * 1024,
                codec: 'aac', // FFmpeg codec name
                hls_codec: 'mp4a.40.29', // HLS CODECS attribute - HE-AAC v2
                audio_profile: 'aac_he_v2',
                compression_level: null,
                frame_duration: null,
                vbr: null,
                hls_time: '1.0',
                hls_preset: 'ultrafast',
            },
            'low': {
                bitrate: '64k',
                sample_rate: 44100,
                channels: 1,
                bandwidth: 64 * 1024,
                codec: 'aac',
                hls_codec: 'mp4a.40.5', // HLS CODECS attribute - HE-AAC
                audio_profile: 'aac_he',
                compression_level: null,
                frame_duration: null,
                vbr: null,
                hls_time: '4.0',
                hls_preset: 'ultrafast',
            },
            'medium': {
                bitrate: '128k',
                sample_rate: 44100,
                channels: 2,
                bandwidth: 128 * 1024,
                codec: 'aac',
                hls_codec: 'mp4a.40.2', // HLS CODECS attribute - AAC-LC
                audio_profile: 'aac_low',
                compression_level: null,
                frame_duration: null,
                vbr: null,
                hls_time: '8.0',
                hls_preset: 'fast',
            },
            'high': {
                bitrate: '192k',
                sample_rate: 44100,
                channels: 2,
                bandwidth: 192 * 1024,
                codec: 'aac',
                hls_codec: 'mp4a.40.2',
                audio_profile: 'aac_low',
                compression_level: null,
                frame_duration: null,
                vbr: null,
                hls_time: '8.0',
                hls_preset: 'medium',
            },
            'ultra-high': {
                bitrate: '256k',
                sample_rate: 48000,
                channels: 2,
                bandwidth: 256 * 1024,
                codec: 'aac',
                hls_codec: 'mp4a.40.2',
                audio_profile: 'aac_low',
                compression_level: null,
                frame_duration: null,
                vbr: null,
                hls_time: '8.0',
                hls_preset: 'medium',
            },
        },
    };

    codecs = [/*'opus'*/'aac']; // Supported codecs
    profile_progression = ['ultra-low', 'low', 'medium', 'high', 'ultra-high']; // Order of profiles for adaptive streaming
    hls_root = path.join(__dirname, 'storage', 'musik', 'hls'); 
    hls_raw_audio_directory = path.join(this.hls_root, 'raw');

    hls_raw_audio_max_uphold_time = 7 * 24 * 60 * 60 * 1000; // 7 days
    hls_raw_audio_cleanup_interval = 60 * 60 * 1000; // 60 minutes

    ready = false;
    audio_data = new Map(); // Map of video_id to audio details

    async initialize() {
        console.log('Initializing Adaptive_Stream...');
        try {
            await this.ensure_directories([
                this.hls_root,
                this.hls_raw_audio_directory,
            ]);
            // await Promise.all([
            //     // this.remove_audio_files('*'),
            // ]);
            
            // Wrap cleanup interval in error handler
            setInterval(() => {
                this.cleanup().catch(error => {
                    console.error('Error during scheduled cleanup:', error);
                });
            }, this.hls_raw_audio_cleanup_interval);

            this.ready = true;
            console.log('Adaptive_Stream initialized successfully');
        } catch (error) {
            console.error('Error during initialization:', error);
            this.ready = false;
            // throw error;
        }
    }

    setup_endpoints(app) {
        app.use('/hls', express.static(this.hls_root, {
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

        app.get('/stream', async (req, res) => {
            try {
                let video_ids = req.query.video_ids;
                
                // Parse video_ids if it's a JSON string
                if (typeof video_ids === 'string') {
                    try {
                        video_ids = JSON.parse(video_ids);
                    } catch (e) {
                        // If it's not JSON, wrap it in an array
                        video_ids = [video_ids];
                    }
                }
                
                // Ensure it's an array
                if (!Array.isArray(video_ids) || video_ids.length === 0) {
                    return res.status(400).json({ error: 'Invalid video_ids parameter', success: false });
                }

                const session_response = await this.stream(video_ids);
                
                return res.status(200).json({ ...session_response, success: true });
            } catch(error) {
                console.error('Error during session request:', error.message);
                console.error('Stack trace:', error.stack);
                return res.status(500).json({ 
                    error: error.message || 'Internal server error', 
                    success: false 
                });
            }
        });

        // DJ Mix endpoint - creates a seamless mix between two songs
        app.get('/dj/mix', async (req, res) => {
            try {
                const { current_song_id, next_song_id } = req.query;
                const current_position = 0; // temp
                
                if (!this.is_valid_video_id(current_song_id) || !this.is_valid_video_id(next_song_id)) {
                    return res.status(400).json({ 
                        error: 'Invalid video IDs', 
                        success: false 
                    });
                }
                
                console.log(`DJ Mix request: ${current_song_id} -> ${next_song_id}`);
                
                // Ensure both songs are available in HLS
                await Promise.all([
                    this.create_hls_stream(current_song_id, this.codecs, this.profile_progression),
                    this.create_hls_stream(next_song_id, this.codecs, this.profile_progression)
                ]);
                
                // Call Python DJ service to create the mix
                const mix_result = await call_dj_api('/create-mix', {
                    current_song_id,
                    next_song_id,
                    quality: 'ultra-high',
                    current_position,
                    auto_calculate: true
                });
                
                console.log(`DJ Mix created: ${mix_result.mix_id}`);
                
                return res.status(200).json({
                    success: true,
                    mix_id: mix_result.mix_id,
                    playlist_url: mix_result.playlist_url,
                    mix_info: mix_result.mix_info
                });
                
            } catch(error) {
                console.error('Error during DJ mix request:', error.message);
                return res.status(500).json({ 
                    error: error.message || 'Internal server error', 
                    success: false 
                });
            }
        });
        
        // DJ Analysis endpoint - analyze a single song
        app.post('/dj/analyze', async (req, res) => {
            try {
                const { song_id, quality = 'high' } = req.body;
                
                if (!this.is_valid_video_id(song_id)) {
                    return res.status(400).json({ error: 'Invalid video ID', success: false });
                }
                
                // Ensure song is available in HLS
                await this.create_hls_stream(song_id, this.codecs, this.profile_progression);
                
                // Call Python DJ service
                const analysis_result = await call_dj_api('/analyze', { song_id, quality });
                
                return res.status(200).json(analysis_result);
                
            } catch(error) {
                console.error('Error during DJ analysis request:', error.message);
                return res.status(500).json({ 
                    error: error.message || 'Internal server error',
                    success: false 
                });
            }
        });
    }

    is_valid_video_id(video_id) {
        if(!video_id) return false;
        if(typeof video_id !== 'string') return false;
        const trimmed_video_id = video_id.trim();
        if(trimmed_video_id === '' || trimmed_video_id === 'undefined' || trimmed_video_id === 'null') return false;
        if(trimmed_video_id.length !== 11) return false; // YouTube video IDs are 11 characters long
        return true;
    }

    async ensure_directories(directories = []) {
        if(directories.length === 0) return;
        try {
            await Promise.all(directories.map(directory => {
                return file_system.promises.mkdir(directory, { recursive: true });
            }));
        } catch (error) {
            throw error;
        }
    }

    async stream(video_ids = []) {
        // video_ids is an array of video_id strings to already include in the session
        // used for prioritized users for better visual 'speed' / better spin up
        if (!this.ready) throw new Error('Adaptive_Stream not initialized properly.');
        if(!Array.isArray(video_ids) || video_ids.length === 0) throw new Error('Invalid video_ids parameter.');

        try {
            // max 10 concurrent streams for now
            Promise.all(video_ids.slice(0, 10).map(async (video_id) => {
                try {
                    await this.create_hls_stream(video_id, this.codecs, this.profile_progression);
                    if(video_id !== video_ids[0]) {
                        // confirm stream creation for non-priority videos
                        await this.confirm_stream_creation(video_id, 25000);
                    }
                } catch (error) {
                    console.error(`Failed to create stream for ${video_id}:`, error.message);
                    // Don't throw, just log - allow other streams to continue
                }
            })).catch((error) => {
                console.error('Error in stream creation promises:', error);
            });

            // console.log(path.join(this.hls_raw_audio_directory, this.codecs[0], this.profile_progression[0], `${Adaptive_Stream.profiles[this.codecs[0]][this.profile_progression[0]].bitrate}.m3u8`))
            await this.confirm_stream_creation(video_ids[0], 25000);

            const session_data = {
                video_ids: video_ids,
                playlist_url: `/hls/raw/${video_ids[0]}/audio/master.m3u8`,
            };

            return session_data;
        } catch (error) {
            throw error;
        }
    }

    async confirm_stream_creation(video_id, timeout = 25000) {
        try {
            await this.wait_for_first_readable_master_playlist(path.join(this.hls_raw_audio_directory, video_id, 'audio', this.codecs[0], this.profile_progression[0], `${Adaptive_Stream.profiles[this.codecs[0]][this.profile_progression[0]].bitrate}.m3u8`), timeout);
            console.log(`Stream creation confirmed: ${video_id}`);
        } catch (error) {
            throw new Error(`Stream creation confirmation failed for video ID ${video_id}: ${error.message}`);
        }
    }

    create_master_playlist(available_codecs = this.codecs, available_profiles = this.profile_progression) {
        const lines = ['#EXTM3U', '#EXT-X-VERSION:7'];

        // to do: support multiple video_ids in the session

        for (const codec of available_codecs) {
            for (const profile of available_profiles) {
                const profile_info = Adaptive_Stream.profiles?.[codec]?.[profile];
                if (!profile_info) continue;
                
                lines.push(
                    `#EXT-X-STREAM-INF:BANDWIDTH=${profile_info.bandwidth},CODECS="${profile_info.hls_codec}"`,
                    `${codec}/${profile}/${profile_info.bitrate}.m3u8`
                );
            }
        }

        return lines.join('\n');
    }

    async write_master_playlist(session_directory, master_playlist) {
        const master_playlist_path = path.join(session_directory, 'master.m3u8');
        return file_system.promises.writeFile(master_playlist_path, master_playlist);
    }

    async create_properties_json(video_id, options = { permanent: false }, json_dump_data) {
        const properties_path = path.join(this.hls_raw_audio_directory, video_id, 'properties.json');
        await this.ensure_directories([path.dirname(properties_path)]);

        const properties = {
            video_id,
            ...options,
            duration: json_dump_data?.duration || 0,
            abr: json_dump_data?.abr || 0,
            tbr: json_dump_data?.tbr || 0,
            vbr: json_dump_data?.vbr || 0,
            asr: json_dump_data?.asr || 0,
            heatmap: json_dump_data?.heatmap || null,
        };

        return file_system.promises.writeFile(properties_path, JSON.stringify(properties, null, 2));
    }

    async create_lyrics_vtt(video_id, video_json) {
        const lyrics_path = path.join(this.hls_raw_audio_directory, video_id, 'lyrics.vtt');
        await this.ensure_directories([path.dirname(lyrics_path)]);
        const vtt_data = await this.extract_vtt_subtitles(video_json);
        await file_system.promises.writeFile(lyrics_path, vtt_data);
    }

    fetch_data(url) {
        return new Promise((resolve, reject) => {
            https.get(url, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        resolve(data);
                    } catch (err) {
                        reject(new Error(`Failed to parse data from ${url}: ${err.message}`));
                    }
                });
            }).on('error', (err) => {
                reject(new Error(`HTTP request failed for ${url}: ${err.message}`));
            });
        });
    }

    async read_properties_json(video_id) {
        const properties_path = path.join(this.hls_raw_audio_directory, video_id, 'properties.json');
        try {
            const data = await file_system.promises.readFile(properties_path, 'utf-8');
            return JSON.parse(data);
        } catch (error) {
            throw error;
        }
    }

    async does_video_id_audio_exist(video_id) {
        // check sessions first then files (as a fail safe)
        if (this.audio_data.has(video_id)) {
            // reset last accessed
            this.audio_data.get(video_id).last_accessed = Date.now();
            return true;
        }

        const video_audio_path = path.join(this.hls_raw_audio_directory, video_id);
        const exists = file_system.existsSync(video_audio_path);
        if(exists) {
            // // check if session has audio data (.ts files for all qualities), if not delete
            // const audio_quality_dirs = this.profile_progression.map(profile => ({
            //     profile,
            //     dir: path.join(video_audio_path, profile)
            // }));
            // const has_audio_data = audio_quality_dirs.some(item => file_system.existsSync(item.dir));
            // // check if they have any .ts files and their .m3u8 playlists
            // const has_playlist = audio_quality_dirs.some(item => {
            //     const m3u8_path = path.join(item.dir, `${Adaptive_Stream.profiles[this.codecs[0]][item.profile].bitrate}.m3u8`);
            //     console.log('m3u8_path check:', m3u8_path);
            //     return file_system.existsSync(m3u8_path);
            // });

            // console.log('Audio playlist existence check:', has_playlist);

            // if (!has_playlist) {
            //     console.warn(`No audio data found for video ID: ${video_id}. Deleting audio files.`);
            //     // file_system.promises.rm(video_audio_path, { recursive: true, force: true });
            //     await this.delete_raw_audio(video_id);
            //     return false;
            // } else {
                console.warn(`Audio files exist for video ID: ${video_id} but no active session found. Recreating session data.`);
                this.audio_data.set(video_id, {
                    process: null,
                    created_at: Date.now(),
                    last_accessed: Date.now(),
                });
            // }
        }

        console.log(`Audio files existence check for video ID ${video_id}: ${exists}`);

        return exists;
    }

    async create_hls_stream(video_id, available_codecs = this.codecs, available_profiles = this.profile_progression) {
        if(!this.ready) throw new Error('Adaptive_Stream not initialized properly.');
        if(!this.is_valid_video_id(video_id)) throw new Error('Invalid video_id parameter.');
        if((await this.does_video_id_audio_exist(video_id))) return null;

        console.log(`Spinning up HLS stream: ${video_id}`);

        // optimistic
        this.audio_data.set(video_id, {
            process: null,
            created_at: Date.now(),
            last_accessed: Date.now(),
        });

        try {
            const create_audio_metadata = async () => {
                const json_dump_data = await this.get_json_dump(video_id);
                this.create_properties_json(video_id, { permanent: false }, json_dump_data);
                // this.create_lyrics_vtt(video_id, json_dump_data);
                // replace with custom json data format 
            }
            create_audio_metadata();

            // ensure the session directory folders and raw audio directory folders
            await this.ensure_directories([
                ...available_codecs.flatMap(codec => {
                    return available_profiles.map(profile => {
                        return path.join(this.hls_raw_audio_directory, video_id, 'audio', codec, profile);
                    });
                })
            ]);
            const master_playlist = this.create_master_playlist(available_codecs, available_profiles);
            await this.write_master_playlist(path.join(this.hls_raw_audio_directory, video_id, 'audio'), master_playlist);
            // const audio_process = await this.get_video_audio_url(video_id);
            // console.log(`Obtained audio stream for video ID ${video_id} - url: ${audio_process}`);
            const audio_process = await this.create_yt_dlp_process(video_id); // use inital video to create the HLS stream
            const ffmpeg_process = await this.create_ffmpeg_process(audio_process, path.join(this.hls_raw_audio_directory, video_id, 'audio'), video_id, available_codecs, available_profiles);

            // Wait for first segment - use a specific profile to check
            const first_profile = available_profiles[0]; // 'ultra-low'
            await this.wait_for_first_readable_segment(video_id, available_codecs[0], first_profile, 15000);

            // success
            this.audio_data.set(video_id, {
                process: ffmpeg_process,
                created_at: Date.now(),
                last_accessed: Date.now(),
            });

            return ffmpeg_process;
        } catch (error) {
            // cleanup on failure
            this.delete_raw_audio(video_id);
            console.error(`Error creating HLS stream for video ID ${video_id}:`, error.message);
            throw error;
        }
    }

    async create_yt_dlp_process(video_id) {
        if (!this.ready) throw new Error('Adaptive_Stream not initialized properly.');
        if (!this.is_valid_video_id(video_id)) throw new Error('Invalid video_id parameter.');


        const url = this.get_video_url(video_id);

        return new Promise((resolve, reject) => {

            // Add timeout for yt-dlp process startup
            const startup_timeout = setTimeout(() => {
                if (!resolved && process && !process.killed) {
                    process.kill('SIGTERM');
                }
                if (!resolved) {
                    resolved = true;
                    reject(new Error('Timeout waiting for yt-dlp process to start'));
                }
            }, 15000); // 15 second timeout for rate limiting

            const process = spawn('yt-dlp', [
                '-f', 'bestaudio[ext=m4a]/bestaudio/best',
                '--no-playlist',
                // '--no-warnings',
                // '--buffer-size', Adaptive_Stream.stream_buffer_size,
                // '--no-part',
                // '--socket-timeout', '10',
                '--fragment-retries', '3',
                '--retries', '2',
                '-o', '-',
                url
            ]);
            
            let resolved = false;
            let stderr_output = '';
            
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
                    resolve(process.stdout);
                }
            }, 500); // let the process start normally
        });
    }

    get_video_url(video_id) {
        if (!this.is_valid_video_id(video_id)) throw new Error('Invalid video_id parameter.');

        const url = `https://www.youtube.com/watch?v=${video_id}`;
        return url;
    }

    async get_video_audio_url(video_id) {
        if(!this.ready) throw new Error('Adaptive_Stream not initialized properly.');
        if (!this.is_valid_video_id(video_id)) throw new Error('Invalid video_id parameter.');
        
        const url = this.get_video_url(video_id);

        return new Promise((resolve, reject) => {
            const process = spawn('yt-dlp', [
                '-f', 'bestaudio[ext=m4a]/bestaudio/best',
                '--no-playlist',
                '--no-warnings',
                '--get-url',
                url
            ]);

            let stdout_data = '';

            process.stdout.on('data', (data) => {
                stdout_data += data.toString();
            });

            process.on('close', (code) => {
                if (code === 0) {
                    const audio_url = stdout_data.trim();
                    resolve(audio_url);
                } else {
                    reject(new Error(`yt-dlp failed to get audio URL: ${stderr_data.trim()}`));
                }
            });

            process.on('error', (err) => {
                reject(new Error(`yt-dlp process error: ${err.message}`));
            });
        });
    }

    async create_ffmpeg_process(input_source, output_directory, video_id, available_codecs = this.codecs, available_profiles = this.profile_progression) {
        if(!this.ready) throw new Error('Adaptive_Stream not initialized properly.');
        if(!input_source) throw new Error('No input source provided for FFmpeg process.');
        if(!output_directory) throw new Error('No output directory provided for FFmpeg process.');
        if(!this.is_valid_video_id(video_id)) throw new Error('No video_id provided for FFmpeg process.');

        const total_profiles = available_codecs.length * available_profiles.length;
        if(total_profiles === 0) throw new Error('No available codecs or profiles specified for FFmpeg process.');

        const ffmpeg_process = ffmpeg(input_source);

        if( total_profiles > 1 ) {
            const split_outputs = available_codecs.map(codec => {
                return available_profiles.map(profile => {
                    const profile_info = Adaptive_Stream.profiles?.[codec]?.[profile];
                    if(!profile_info) return null;

                    return `[${codec}_${profile}]`;
                }).filter(profile => profile !== null).join('');
            }).join('');

            ffmpeg_process.complexFilter([
                `[0:a]asplit=${total_profiles}${split_outputs}`
            ]);
        }

        for(const codec of available_codecs) {
            for(const profile of available_profiles) {
                const profile_info = Adaptive_Stream.profiles?.[codec]?.[profile];
                if(!profile_info) continue;

                // Calculate relative path from session playlist to raw audio segments
                // const playlist_dir = path.join(output_directory, codec, profile);
                // const segment_dir = path.join(this.hls_raw_audio_directory, video_id, codec, profile);
                // const relative_segment_path = path.relative(playlist_dir, segment_dir);

                ffmpeg_process
                    .output(path.join(output_directory, codec, profile, `${profile_info.bitrate}.m3u8`))
                    .audioCodec(profile_info.codec)
                    .audioBitrate(profile_info.bitrate)
                    .audioChannels(profile_info.channels)
                    .audioFrequency(profile_info.sample_rate)
                    .format('hls')
                    .outputOptions([
                        '-map', total_profiles > 1 ? `[${codec}_${profile}]` : '0:a',
                        '-hls_time', profile_info.hls_time || '2.0',
                        '-hls_list_size', '0',
                        // '-hls_segment_type', 'mpegts',
                        // '-start_number', '0',
                        // '-avoid_negative_ts', 'make_zero',
                        // '-fflags', '+genpts',
                        '-map_metadata', '-1',
                        // '-preset', this.get_ffmpeg_preset(fast_startup, profile),
                        // '-tune', this.get_ffmpeg_tune(fast_startup, profile),
                        '-hls_flags', 'append_list',
                        // '-hls_base_url', `${relative_segment_path}/`,
                        '-hls_segment_filename', path.join(output_directory, codec, profile, `${profile_info.bitrate}_%d.ts`)
                    ]);
            }
        }

        return new Promise((resolve, reject) => {
            ffmpeg_process
                .on('end', () => {
                    resolve({
                        process: ffmpeg_process,
                        duration: null, // to do: calculate duration
                    });
                })
                .on('error', (err, stdout, stderr) => {
                    reject(new Error(`FFmpeg failed: I/O error - '${video_id}' may not exist`));
                })
                .run();
        });
    }

    async wait_for_first_readable_segment(video_id, codec = 'aac', profile = this.profile_progression[0], timeout = 15000) {
        return new Promise((resolve, reject) => {
            const segment_path = path.join(this.hls_raw_audio_directory, video_id, 'audio', codec, profile);
            const start_time = Date.now();

            const check_segment = () => {
                file_system.promises.readdir(segment_path)
                    .then(files => {
                        const ts_files = files.filter(file => file.endsWith('.ts'));
                        if (ts_files.length > 0) {
                            resolve();
                        } else if (Date.now() - start_time >= timeout) {
                            reject(new Error('Timeout waiting for first readable segment'));
                        } else {
                            setTimeout(check_segment, 500); // Check again after 500ms
                        }
                    })
                    .catch(err => {
                        reject(new Error(`Error checking segment directory: ${err.message}`));
                    });
            };

            check_segment();
        });
    }

    async wait_for_first_readable_master_playlist(master_playlist_path, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const start_time = Date.now();

            const check_playlist = () => {
                file_system.promises.access(master_playlist_path, file_system.constants.R_OK)
                    .then(() => {
                        resolve();
                    })
                    .catch(() => {
                        if (Date.now() - start_time >= timeout) {
                            reject(new Error('Timeout waiting for first readable master playlist'));
                        } else {
                            setTimeout(check_playlist, 500); // Check again after 500ms
                        }
                    });
            };

            check_playlist();
        });
    }

    async delete_raw_audio(video_id) {

        return new Promise((resolve, reject) => {
            // check properties.json to see if permanent
            this.read_properties_json(video_id)
                .then((properties) => {
                    if(properties?.permanent) {
                        // skip deletion
                        console.log(`Skipping deletion of permanent raw audio: ${video_id}`);
                        return resolve();
                    } else {
                        // proceed with deletion
                        return;
                    }
                })
                .catch((err) => {
                    // if error reading properties, assume not permanent and proceed
                    return;
                });
            
            // Delete the raw audio directory
            file_system.promises.rm(path.join(this.hls_raw_audio_directory, video_id), { recursive: true, force: true })
                .then(() => {
                    resolve();
                })
                .catch((err) => {
                    reject(err);
                });
            
            // also check ffmpeg process and kill if exists
            const session_info = this.audio_data.get(video_id);
            if(session_info && session_info.process) {
                try {
                    session_info.process.kill('SIGTERM');
                } catch (error) {
                    console.error(`Error killing FFmpeg process for video ID ${video_id}:`, error.message);
                }
                this.audio_data.delete(video_id);
            }
        });
    }

    async remove_audio_files(video_ids = '*') {
        // video_ids should be array of ids to remove, or '*' for all
        return new Promise(async (resolve, reject) => {
            // Cleanup logic for all raw audio files
            try {
                // Remove all raw audio directories
                if(video_ids === '*') var children = await file_system.promises.readdir(this.hls_raw_audio_directory);
                else {
                    if(!Array.isArray(video_ids)) throw new Error('Invalid video_ids parameter for remove_audio_files');
                    var children = video_ids;
                }

                let successful = 0;
                let failed = 0;

                await Promise.all(children.map(async (child) => {
                    try {
                        await this.delete_raw_audio(child);
                        successful++;
                    } catch (error) {
                        console.error(`Failed to delete audio for ${child}:`, error.message);
                        failed++;
                    }
                }));

                console.log(`Audio cleanup: ${successful} successful, ${failed} prevented (total: ${children.length})`);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }

    async get_json_dump(video_id) {
        if(!this.ready) throw new Error('Adaptive_Stream not initialized properly.');
        if(!this.is_valid_video_id(video_id)) throw new Error('Invalid video_id parameter.');

        try {
            // use yt-dlp json dump
            return new Promise((resolve, reject) => {
                const url = this.get_video_url(video_id);
                const process = spawn('yt-dlp', [
                    '--no-playlist',
                    '--no-warnings',
                    '--skip-download',
                    '--dump-json',
                    url
                ]);

                let stdout_data = '';
                let stderr_data = '';

                process.stdout.on('data', (data) => {
                    stdout_data += data.toString();
                });

                process.stderr.on('data', (data) => {
                    stderr_data += data.toString();
                });

                process.on('close', (code) => {
                    if (code === 0) {
                        try {
                            const json_data = JSON.parse(stdout_data);
                            resolve(json_data);
                        } catch (err) {
                            reject(new Error(`Failed to parse yt-dlp JSON output: ${err.message}`));
                        }
                    } else {
                        reject(new Error(`yt-dlp failed to get JSON dump: ${stderr_data.trim()}`));
                    }
                });

                process.on('error', (err) => {
                    reject(new Error(`yt-dlp process error: ${err.message}`));
                });
            });
        } catch (error) {
            throw error;
        }
    }

    async extract_vtt_subtitles(video_json) {
        if(!video_json) throw new Error('No video_json provided for subtitle extraction.');

        try {
            // use video_json.subtitles in future
            const subtitles = video_json.automatic_captions;
            if(!subtitles) return null;

            const vtt_subtitle_info = subtitles['en'] || subtitles['en-US'] || subtitles['en-GB'];
            if(!vtt_subtitle_info || vtt_subtitle_info.length === 0) return null;

            // find element with .ext === 'vtt'
            const vtt_info = vtt_subtitle_info.find(sub => sub.ext === 'vtt');
            if(!vtt_info) return null;

            const vtt_url = vtt_info.url;
            if(!vtt_url) return null;

            const vtt_subtitle_data = await this.fetch_data(vtt_url);
            return vtt_subtitle_data;
        } catch (error) {
            throw error;
        }
    }

    force_clean_index = 0;
    force_clean_index_count = Math.ceil((2 * 24 * 60 * 60 * 1000) / (this.hls_raw_audio_cleanup_interval)); // once every 48 hours
    async cleanup() {
        // Cleanup logic for all raw audio files and processes
        try {
            // grab all video ids from hls/raw
            this.force_clean_index = (this.force_clean_index + 1) % this.force_clean_index_count;
            const use_force_clean = (this.force_clean_index === this.force_clean_index_count - 1);
            if(use_force_clean) {
                console.log('Performing forced audio cleanup of all raw audio files.');
            }
            const all_video_ids = await file_system.promises.readdir(this.hls_raw_audio_directory);
            const video_ids_to_delete = all_video_ids.filter((video_id) => {
                const audio_data = this.audio_data.has(video_id);
                if(!audio_data) return true; // no active session, delete
                const session_info = this.audio_data.get(video_id);
                const now = Date.now();
                const last_accessed = session_info.last_accessed || session_info.created_at || (use_force_clean ? 0 : Date.now()); // if Date.now() reached protect it from being removed unless forced

                return (now - last_accessed) > this.hls_raw_audio_max_uphold_time;
            });

            let successful = 0;
            let failed = 0;

            await Promise.all(video_ids_to_delete.map(async (child) => {
                try {
                    await this.delete_raw_audio(child);
                    successful++;
                } catch (error) {
                    console.error(`Failed to delete audio for ${child}:`, error.message);
                    failed++;
                }
            }));

            console.log(`Audio cleanup: ${successful} successful, ${failed} prevented (total: ${video_ids_to_delete.length})`);
        } catch (error) {
            throw error;
        }
    }
}

// testing
// (async () => {
//     const adaptive_stream = new Adaptive_Stream();
//     await adaptive_stream.initialize();

//     try {
//         await adaptive_stream.stream(['9iHM6X6uUH8', '-mMmOKHzuWc']);

//         // console.log('getting dump');
//         // let result = await adaptive_stream.get_json_dump('-mMmOKHzuWc');
//         // console.log(result);
//         // let vtt_data = await adaptive_stream.extract_vtt_subtitles(result);
//         // console.log('Extracted VTT data:', vtt_data);
//         // console.log('success');
//     } catch (error) {
//         console.error('Error during testing:', error);
//     }
// })();

export default {
    Stream: Adaptive_Stream,
    is_valid_video_id: Adaptive_Stream.is_valid_video_id
}