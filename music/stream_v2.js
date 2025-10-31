import express from 'express';
import { spawn } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import file_system from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import https from 'https';

// import { request_embedding, is_song_in_process_queue } from './recommendation/reuqest.embedding.js';

const __dirname = path.resolve();

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
    hls_session_directory = path.join(this.hls_root, 'session');

    hls_session_max_uphold_time = 7 * 24 * 60 * 60 * 1000; // 7 days
    hls_session_initial_uphold_time = 24 * 60 * 60 * 1000; // 24 hours
    hls_session_cleanup_interval = 60 * 60 * 1000; // 60 minutes

    ready = false;
    audio_data = new Map(); // Map of video_id to audio details
    active_sessions = new Map(); // Map of video_id to session info
    
    // Rate limiting for yt-dlp requests
    last_request_time = 0;
    min_request_interval = 2000; // 2 seconds between requests
    
    // Rate limiting for yt-dlp requests
    last_request_time = 0;
    min_request_interval = 2000; // 2 seconds between requests

    async initialize() {
        console.log('Initializing Adaptive_Stream...');
        try {
            await this.ensure_directories([
                this.hls_root,
                this.hls_raw_audio_directory,
                this.hls_session_directory,
            ]);
            await Promise.all([
                // this.remove_sessions('*'),
                // this.remove_audio_files('*'),
            ]);

            this.ready = true;
            console.log('Adaptive_Stream initialized successfully');
        } catch (error) {
            console.error('Error during initialization:', error);
            // throw error;
        }
    }

    setup_endpoints(app) {
        // app.get('/hls/:session_id/:codec/:profile/index.m3u8', async (req, res) => {
        //     const { session_id, codec, profile } = req.params;

        //     // Validate session_id, codec, and profile
        //     if (!this.active_sessions.has(session_id)) {
        //         return res.status(404).json({ error: 'Session not found', success: false });
        //     }

        //     // Generate HLS playlist
        //     const playlist = this.create_hls_playlist(session_data, codec, profile);
        //     res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        //     res.send(playlist);
        // });

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

        app.get('/session', async (req, res) => {
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

                const session_response = await this.create_session(video_ids);
                
                return res.status(200).json({ ...session_response, success: true });
            } catch(error) {
                console.error('Error during session request:', error.message);
                return res.status(500).json({ error: 'Internal server error', success: false });
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

    async create_session(video_ids = []) {
        // video_ids is an array of video_id strings to already include in the session
        // used for prioritized users for better visual 'speed' / better spin up
        if (!this.ready) throw new Error('Adaptive_Stream not initialized properly.');

        try {
            const session_uuid = crypto.randomUUID();
            const session_directory = path.join(this.hls_session_directory, session_uuid);

            await this.ensure_directories([session_directory]);
            // create HLS streams for the first 3 video_ids
            Promise.all(video_ids.slice(0, 3).map(async (video_id) => {
                this.create_hls_stream(video_id, session_directory, this.codecs, this.profile_progression);
            }));

            await this.wait_for_first_readable_master_playlist(path.join(session_directory, this.codecs[0], this.profile_progression[0], `${Adaptive_Stream.profiles[this.codecs[0]][this.profile_progression[0]].bitrate}.m3u8`), 10000);

            const session_data = {
                video_ids: video_ids,
                created_at: Date.now(),
                last_accessed: Date.now(),
                playlist_url: `/hls/session/${session_uuid}/master.m3u8`,
                session_id: session_uuid,
                // permissions: [], // future use
            };
            this.active_sessions.set(session_uuid, session_data);

            return session_data;
        } catch (error) {
            throw error;
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

    async create_segment_symlinks(video_id, session_directory, available_codecs = this.codecs, available_profiles = this.profile_progression) {
        // Create symlinks from session directory to raw audio segments
        const symlink_promises = [];
        
        for (const codec of available_codecs) {
            for (const profile of available_profiles) {
                const raw_segment_dir = path.join(this.hls_raw_audio_directory, video_id, codec, profile);
                const session_segment_dir = path.join(session_directory, codec, profile);
                
                // Create a symlink for the entire segment directory
                const symlink_target = path.relative(session_segment_dir, raw_segment_dir);
                
                // We'll symlink individual segments as they're created
                // For now, we can use the hls_base_url option in FFmpeg instead
            }
        }
        
        return Promise.all(symlink_promises);
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

    async create_hls_stream(video_id, session_directory, available_codecs = this.codecs, available_profiles = this.profile_progression) {
        if(!this.ready) throw new Error('Adaptive_Stream not initialized properly.');
        if(!this.is_valid_video_id(video_id)) throw new Error('Invalid video_id parameter.');

        console.log(`Spinning up HLS stream: ${video_id}`);

        try {
            const master_playlist = this.create_master_playlist(available_codecs, available_profiles);
            await this.write_master_playlist(session_directory, master_playlist);
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
                        return path.join(session_directory, codec, profile);
                    });
                }),
                ...available_codecs.flatMap(codec => {
                    return available_profiles.map(profile => {
                        return path.join(this.hls_raw_audio_directory, video_id, codec, profile);
                    });
                })
            ]);
            // const audio_process = await this.get_video_audio_url(video_id);
            // console.log(`Obtained audio stream for video ID ${video_id} - url: ${audio_process}`);
            const audio_process = await this.create_yt_dlp_process(video_id); // use inital video to create the HLS stream
            const ffmpeg_process = await this.create_ffmpeg_process(audio_process, session_directory, video_id, available_codecs, available_profiles);

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
                const playlist_dir = path.join(output_directory, codec, profile);
                const segment_dir = path.join(this.hls_raw_audio_directory, video_id, codec, profile);
                const relative_segment_path = path.relative(playlist_dir, segment_dir);

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
                        '-hls_base_url', `${relative_segment_path}/`,
                        '-hls_segment_filename', path.join(this.hls_raw_audio_directory, video_id, codec, profile, `${profile_info.bitrate}_%d.ts`)
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
            const segment_path = path.join(this.hls_raw_audio_directory, video_id, codec, profile);
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

    async delete_session(session_id) {
        return new Promise((resolve, reject) => {
            if(!this.active_sessions.has(session_id)) {
                // if session is in the map, remove it
                this.active_sessions.delete(session_id);
            }

            file_system.promises.rm(path.join(this.hls_session_directory, session_id), { recursive: true, force: true })
                .then(() => {
                    resolve();
                })
                .catch((err) => {
                    reject(err);
                });
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
            
            file_system.promises.rm(path.join(this.hls_raw_audio_directory, video_id), { recursive: true, force: true })
                .then(() => {
                    resolve();
                })
                .catch((err) => {
                    reject(err);
                });
        });
    }

    async remove_sessions(sessions = '*') {
        // sessions should be array of ids to remove, or '*' for all
        return new Promise(async (resolve, reject) => {
            // Cleanup logic for all sessions
            try {
                // Remove all session directories
                if(sessions === '*') var children = await file_system.promises.readdir(this.hls_session_directory);
                else {
                    if(!Array.isArray(sessions)) throw new Error('Invalid sessions parameter for remove_sessions');
                    var children = sessions;
                }

                let successful = 0;
                let failed = 0;

                await Promise.all(children.map(async (child) => {
                    try {
                        await this.delete_session(child);
                        successful++;
                    } catch (error) {
                        console.error(`Failed to delete session ${child}:`, error.message);
                        failed++;
                    }
                }));

                console.log(`Session cleanup: ${successful} successful, ${failed} failed (total: ${children.length})`);
                resolve();
            } catch (error) {
                reject(error);
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
}

// testing
(async () => {
    const adaptive_stream = new Adaptive_Stream();
    await adaptive_stream.initialize();

    try {
        await adaptive_stream.create_session(['9iHM6X6uUH8']);

        // console.log('getting dump');
        // let result = await adaptive_stream.get_json_dump('-mMmOKHzuWc');
        // console.log(result);
        // let vtt_data = await adaptive_stream.extract_vtt_subtitles(result);
        // console.log('Extracted VTT data:', vtt_data);
        // console.log('success');
    } catch (error) {
        console.error('Error during testing:', error);
    }
})();

export default {
    Stream: Adaptive_Stream,
    is_valid_video_id: Adaptive_Stream.is_valid_video_id
}