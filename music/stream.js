import express from 'express';
import { spawn } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import file_system from 'fs-extra';
import path from 'path';
import https from 'https';
import http from 'http';
import crypto from 'crypto';

import { request_embedding, is_song_in_process_queue } from './recommendation/reuqest.embedding.js';
// import { get_mix_information }

// cmd + shift + p => fold level

const __dirname = path.resolve();

// Helper function to call Python DJ service
async function call_dj_api(endpoint, data) {
    return new Promise((resolve, reject) => {
        const DJ_SERVICE_HOST = process.env.DJ_SERVICE_HOST || 'localhost';
        const DJ_SERVICE_PORT = process.env.DJ_SERVICE_PORT || 5002; // Analysis Worker
        
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
            timeout: 120000 // 120 second timeout for mix creation
        };
        
        // Use HTTP for local service
        const req = http.request(options, (res) => {
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
                bitrate: '32k',
                sample_rate: 48000,
                channels: 1,
                bandwidth: 32 * 1024,
                codec: 'libopus', // FFmpeg codec name
                hls_codec: 'opus', // HLS CODECS attribute
                audio_profile: 'audio', // Opus application mode
                compression_level: 10,
                frame_duration: 20,
                vbr: 'on',
                hls_time: '4.0',
                hls_preset: 'fast',
            },
            'low': {
                bitrate: '96k',
                sample_rate: 48000,
                channels: 2,
                bandwidth: 96 * 1024,
                codec: 'libopus', // FFmpeg codec name
                hls_codec: 'opus', // HLS CODECS attribute
                audio_profile: 'audio', // Opus application mode
                compression_level: 10,
                frame_duration: 20,
                vbr: 'on',
                hls_time: '4.0',
                hls_preset: 'fast',
            },
            'medium': {
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
                hls_time: '4.0',
                hls_preset: 'fast',
            },
            'high': {
                bitrate: '192k',
                sample_rate: 48000,
                channels: 2,
                bandwidth: 192 * 1024,
                codec: 'libopus',
                hls_codec: 'opus',
                audio_profile: 'audio',
                compression_level: 10,
                frame_duration: 20,
                vbr: 'on',
                hls_time: '4.0',
                hls_preset: 'medium',
            },
            'ultra-high': {
                bitrate: '256k',
                sample_rate: 48000,
                channels: 2,
                bandwidth: 256 * 1024,
                codec: 'libopus',
                hls_codec: 'opus',
                audio_profile: 'audio',
                compression_level: 10,
                frame_duration: 20,
                vbr: 'constrained',
                hls_time: '4.0',
                hls_preset: 'medium',
            },
        },
        'aac': {
            // use for ultra-low latency, data when processing in python for embedding
            // dont use frontend
            'ultra-low': {
                bitrate: '32k',
                sample_rate: 22050,
                channels: 1,
                bandwidth: 32 * 1024,
                codec: 'aac',
                hls_codec: 'mp4a.40.5', // HLS CODECS attribute - HE-AAC
                audio_profile: 'aac_he',
                compression_level: null,
                frame_duration: null,
                vbr: null,
                hls_time: '4.0',
                hls_preset: 'fast',
            },
            'low': {
                bitrate: '96k',
                sample_rate: 44100,
                channels: 2,
                bandwidth: 96 * 1024,
                codec: 'aac',
                hls_codec: 'mp4a.40.5', // HLS CODECS attribute - HE-AAC
                audio_profile: 'aac_he',
                compression_level: null,
                frame_duration: null,
                vbr: null,
                hls_time: '4.0',
                hls_preset: 'fast',
            },
            'medium': {
                bitrate: '128k',
                sample_rate: 44100,
                channels: 2,
                bandwidth: 128 * 1024,
                codec: 'aac',
                hls_codec: 'mp4a.40.2', // HLS CODECS attribute - AAC-LC mp4a.40.2
                audio_profile: 'aac_low',
                compression_level: null,
                frame_duration: null,
                vbr: null,
                hls_time: '4.0',
                hls_preset: 'fast',
            },
            'high': {
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
                hls_time: '4.0',
                hls_preset: 'medium',
            },
            'ultra-high': {
                bitrate: '320k',
                sample_rate: 48000,
                channels: 2,
                bandwidth: 320 * 1024,
                codec: 'aac',
                hls_codec: 'mp4a.40.2',
                audio_profile: 'aac_low', // aac_low
                compression_level: null,
                frame_duration: null,
                vbr: null,
                hls_time: '4.0',
                hls_preset: 'medium',
            },
        },
    };

    codecs = ['opus','aac']; // Supported codecs
    profile_progression = ['ultra-low', 'low', 'medium', 'high', 'ultra-high']; // Order of profiles for adaptive streaming
    hls_root = path.join(__dirname, 'storage', 'musik', 'hls'); 
    hls_raw_audio_directory = path.join(this.hls_root, 'raw');
    hls_mix_audio_directory = path.join(this.hls_root, 'mixes');
    hls_session_directory = path.join(this.hls_root, 'sessions'); // where temporary session data is stored

    hls_raw_audio_max_uphold_time = 7 * 24 * 60 * 60 * 1000; // 7 days
    hls_raw_audio_cleanup_interval = 60 * 60 * 1000; // 60 minutes

    ready = false;
    audio_data = new Map(); // Map of video_id to audio details
    session_data = new Map(); // Map of session_id to session state

    async initialize() {
        console.log('Initializing Adaptive_Stream...');
        try {
            await this.ensure_directories([
                this.hls_root,
                this.hls_raw_audio_directory,
                this.hls_mix_audio_directory,
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
                
                // Determine appropriate status code based on error type
                let status_code = 500;
                let error_type = 'internal_error';
                
                if (error.message.includes('not found') || 
                    error.message.includes('unavailable') ||
                    error.message.includes('does not exist')) {
                    status_code = 404;
                    error_type = 'video_not_found';
                } else if (error.message.includes('forbidden') || 
                           error.message.includes('403') ||
                           error.message.includes('not accessible')) {
                    status_code = 403;
                    error_type = 'access_forbidden';
                } else if (error.message.includes('timeout') || 
                           error.message.includes('Timeout')) {
                    status_code = 504;
                    error_type = 'timeout';
                }
                
                return res.status(status_code).json({ 
                    error: error.message || 'Internal server error',
                    error_type,
                    success: false 
                });
            }
        });

        // DJ Mix endpoint - creates a seamless stitched HLS mix between two songs
        // Returns a SINGLE HLS stream that Safari/iOS can play without issues
        app.get('/dj/mix', async (req, res) => {
            try {
                const { current_song_id, next_song_id, quality = 'high', mix_style = 'balanced' } = req.query;
                
                if (!this.is_valid_video_id(current_song_id) || !this.is_valid_video_id(next_song_id)) {
                    return res.status(400).json({ 
                        error: 'Invalid video IDs', 
                        success: false 
                    });
                }
                
                console.log(`DJ Mix request: ${current_song_id} -> ${next_song_id} (quality: ${quality}, style: ${mix_style})`);
                
                // Ensure both songs are available in HLS (wait for completion)
                await Promise.all([
                    this.create_hls_stream(current_song_id, this.codecs, this.profile_progression),
                    this.create_hls_stream(next_song_id, this.codecs, this.profile_progression)
                ]);
                
                // Wait for both streams to be complete (needed for stitching)
                await Promise.all([
                    this.wait_for_stream_complete(current_song_id, 60000),
                    this.wait_for_stream_complete(next_song_id, 60000)
                ]);
                
                // Call Python DJ service to get mix data with crossfade WAV
                const mix_result = await call_dj_api('/get_stitched_mix', {
                    song_id_1: current_song_id,
                    song_id_2: next_song_id,
                    mix_style: mix_style
                });
                
                console.log(`DJ Mix data received: ${mix_result.mix_id} (cached: ${mix_result.cached})`);
                
                // If already cached with HLS, return immediately
                // if (mix_result.cached) {
                //     return res.status(200).json({
                //         success: true,
                //         mix_id: mix_result.mix_id,
                //         playlist_url: mix_result.playlist_url,
                //         mix_info: mix_result.mix_info,
                //         cached: true
                //     });
                // }

                // Stitch the mix data into final HLS stream
                const stitch_result = await this.stitch_mix_data_to_raw_audio(mix_result.mix_info);

                return res.status(200).json({
                    success: true,
                    mix_id: stitch_result.mix_id,
                    playlist_url: stitch_result.playlist_url,
                    mix_info: stitch_result.mix_data,
                    cached: false
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

        app.get('/hls/bundle', async (req, res) => {
            try {
                const { video_id, qualities = this.profile_progression } = req.query;
                if (!this.is_valid_video_id(video_id)) {
                    return res.status(400).json({ error: 'Invalid video ID', success: false });
                }
                console.log(`HLS bundle request: ${video_id} (qualities: ${qualities})`);
                
                // Create HLS stream (will skip if already exists)
                await this.create_hls_stream(video_id, this.codecs, this.profile_progression);
                
                // Wait for stream to be fully ready
                await this.wait_for_stream_complete(video_id, 60000);

                const bundle = await this.get_hls_bundle(video_id, Array.isArray(qualities) ? qualities : [qualities]);

                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Cache-Control', 'no-cache');

                return res.status(200).json({
                    success: true,
                    video_id,
                    ...bundle
                });
            } catch (error) {
                console.error('Error during HLS bundle request:', error.message);
                return res.status(500).json({ 
                    error: error.message || 'Internal server error',
                    success: false 
                });
            }
        });


        app.get('/download/hls/bundle', async (req, res) => {
            try {
                let { video_id, qualities } = req.query;
                
                if (!this.is_valid_video_id(video_id)) {
                    return res.status(400).json({ error: 'Invalid video ID', success: false });
                }
                
                // Parse qualities if it's a string
                if (typeof qualities === 'string') {
                    try {
                        qualities = JSON.parse(qualities);
                    } catch (e) {
                        // If not JSON, treat as single quality
                        qualities = [qualities];
                    }
                }
                
                // Default to all profiles if not specified
                if (!qualities || !Array.isArray(qualities) || qualities.length === 0) {
                    qualities = this.profile_progression;
                }
                
                console.log(`Download HLS bundle request: ${video_id} (qualities: ${qualities})`);
                
                // Create HLS stream (will skip if already exists)
                await this.create_hls_stream(video_id, this.codecs, this.profile_progression);
                
                // Wait for stream to be fully ready
                await this.wait_for_stream_complete(video_id, 60000);
                
                // Mark as permanent
                // await this.mark_as_permanent(video_id);
                
                // Stream the bundle as JSON with base64 encoded segments
                const bundle = await this.get_hls_bundle_with_data(video_id, qualities, this.codecs);
                
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Cache-Control', 'no-cache');

                return res.status(200).json({
                    success: true,
                    video_id,
                    ...bundle
                });
                
            } catch(error) {
                console.error('Error during HLS bundle download:', error.message);
                return res.status(500).json({ 
                    error: error.message || 'Internal server error',
                    success: false 
                });
            }
        });

        // app.get('/hls/:path(*)', (req, res) => {
        //     return res.status(404).json({success: false, error: "Not found"});
        // });
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

    async confirm_stream_creation(video_id, timeout = 25000, root = this.hls_raw_audio_directory) {
        try {
            await this.wait_for_first_readable_master_playlist(path.join(root, video_id, 'audio', this.codecs[0], this.profile_progression[0], `${Adaptive_Stream.profiles[this.codecs[0]][this.profile_progression[0]].bitrate}.m3u8`), timeout);
            console.log(`Stream creation confirmed: ${video_id}`);
        } catch (error) {
            throw new Error(`Stream creation confirmation failed for video ID ${video_id}: ${error.message}`);
        }
    }

    create_master_playlist(available_codecs = this.codecs, available_profiles = this.profile_progression) {
        const lines = ['#EXTM3U', '#EXT-X-VERSION:7'];

        for (const codec of available_codecs) {
            for (const profile of available_profiles) {
                const profile_info = Adaptive_Stream.profiles?.[codec]?.[profile];
                if (profile == "ultra-low") continue; // skip ultra-low, used for processing 
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
            fps: json_dump_data?.fps || 0,
            width: json_dump_data?.width || 0,
            height: json_dump_data?.height || 0,
            filesize_approx: json_dump_data?.filesize_approx || 0,
            title: json_dump_data?.track || json_dump_data?.fulltitle || '',
            album: json_dump_data?.album || '',
            artist: json_dump_data?.artist || json_dump_data?.creator || json_dump_data?.uploader || '',
            channel_id: json_dump_data?.channel_id || '',
            like_count: json_dump_data?.like_count || 0,
            view_count: json_dump_data?.view_count || 0,
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

    async mark_as_permanent(video_id) {
        const properties_path = path.join(this.hls_raw_audio_directory, video_id, 'properties.json');
        try {
            let properties = {};
            try {
                properties = await this.read_properties_json(video_id);
            } catch (e) {
                // File doesn't exist yet, create new
            }
            properties.permanent = true;
            properties.downloaded_at = Date.now();
            await file_system.promises.writeFile(properties_path, JSON.stringify(properties, null, 2));
        } catch (error) {
            console.error(`Error marking ${video_id} as permanent:`, error);
            throw error;
        }
    }

    async wait_for_stream_complete(video_id, timeout = 60000, root = this.hls_raw_audio_directory) {
        const start_time = Date.now();
        const codec = this.codecs[0];
        
        // Map quality names to profile names
        const profile = this.profile_progression[this.profile_progression.length - 1]; // Use highest quality
        const playlist_path = path.join(
            root,
            video_id,
            'audio',
            codec,
            profile, 
            `${Adaptive_Stream.profiles[codec][profile].bitrate}.m3u8`
        );

        return new Promise((resolve, reject) => {
            const check = async () => {
                if (Date.now() - start_time > timeout) {
                    return reject(new Error(`Timeout waiting for stream completion: ${video_id}`));
                }

                try {
                    const playlist_content = await file_system.promises.readFile(playlist_path, 'utf-8');
                    
                    // Check if playlist has #EXT-X-ENDLIST (stream complete)
                    if (playlist_content.includes('#EXT-X-ENDLIST')) {
                        return resolve(true);
                    }
                    
                    // Not complete yet, check again
                    setTimeout(check, 500);
                } catch (error) {
                    // File doesn't exist yet, try again
                    setTimeout(check, 500);
                }
            };
            check();
        });
    }

    async get_hls_bundle(video_id, profiles = this.profile_progression, codecs = this.codecs) {
        let profile_data = {};

        for(let codec of codecs) {
            if(!Adaptive_Stream.profiles[codec]) continue;
            for(let profile of profiles) {
                if(!Adaptive_Stream.profiles[codec][profile]) continue;

                // Check if audio exists for this codec/profile
                const audio_dir = path.join(this.hls_raw_audio_directory, video_id, 'audio', codec, profile);
                const playlist_path = path.join(audio_dir, `${Adaptive_Stream.profiles[codec][profile].bitrate}.m3u8`);
                const relative_playlist_path = path.join('hls', path.relative(this.hls_root, playlist_path));
                const exists = file_system.existsSync(playlist_path);
                if(!exists) {
                    // no available codec/profile
                    continue;
                }

                const segments = await this.parse_playlist_segments(playlist_path);

                profile_data[codec] = profile_data[codec] || {};
                profile_data[codec][profile] = {
                    playlist_url: relative_playlist_path,
                    profile_data: Adaptive_Stream.profiles[codec]?.[profile],
                    codec: codec,
                    profiles: profile,
                    segments: segments,
                    segment_count: segments.length
                }
            }
        }
        
        return {
            master_playlist_url: `/hls/raw/${video_id}/audio/master.m3u8`,
            profile_data,
            profiles,
            codecs
        };
    }

    async get_hls_bundle_with_data(video_id, profiles = this.profile_progression, codecs = this.codecs) {
        let profile_data = {};

        for(let codec of codecs) {
            if(!Adaptive_Stream.profiles[codec]) continue;
            for(let profile of profiles) {
                if(!Adaptive_Stream.profiles[codec][profile]) continue;

                // Check if audio exists for this codec/profile
                const audio_dir = path.join(this.hls_raw_audio_directory, video_id, 'audio', codec, profile);
                const playlist_path = path.join(audio_dir, `${Adaptive_Stream.profiles[codec][profile].bitrate}.m3u8`);
                const relative_playlist_path = path.join('hls', path.relative(this.hls_root, playlist_path));
                const exists = file_system.existsSync(playlist_path);
                if(!exists) {
                    // no available codec/profile
                    continue;
                }

                // Read the playlist
                const playlist_content = await file_system.promises.readFile(playlist_path, 'utf-8');
                
                // Parse segment filenames and durations from playlist
                const lines = playlist_content.split('\n');
                const segment_info = [];
                let current_duration = 0;
                
                for (const line of lines) {
                    if (line.startsWith('#EXTINF:')) {
                        // Parse duration: #EXTINF:1.021678,
                        const duration_match = line.match(/#EXTINF:([\d.]+)/);
                        if (duration_match) {
                            current_duration = parseFloat(duration_match[1]);
                        }
                    } else if (line.endsWith('.ts') && !line.startsWith('#')) {
                        // This is a segment filename
                        segment_info.push({
                            filename: line.trim(),
                            duration: current_duration
                        });
                        current_duration = 0;
                    }
                }
                
                // Read all segments and encode as base64
                const segments_with_data = await Promise.all(
                    segment_info.map(async (info) => {
                        const segment_path = path.join(audio_dir, info.filename);
                        const data = await file_system.promises.readFile(segment_path);
                        return {
                            filename: info.filename,
                            data: data.toString('base64'),
                            size: data.length,
                            duration: info.duration
                        };
                    })
                );

                const segments = await this.parse_playlist_segments(playlist_path);

                profile_data[codec] = profile_data[codec] || {};
                profile_data[codec][profile] = {
                    playlist_url: relative_playlist_path,
                    playlist_content: playlist_content,
                    profile_data: Adaptive_Stream.profiles[codec]?.[profile],
                    codec: codec,
                    profile: profile,
                    segments: segments_with_data,
                    // segments_with_data: segments_with_data,
                    segment_count: segments.length,
                    total_size: segments_with_data.reduce((sum, seg) => sum + seg.size, 0)
                }
            }
        }
        
        return {
            master_playlist_url: `/hls/raw/${video_id}/audio/master.m3u8`,
            profile_data,
            profiles,
            codecs
        };
    }

    async does_video_id_audio_exist(video_id) {
        // check sessions first then files (as a fail safe)
        if (this.audio_data.has(video_id)) {
            // reset last accessed
            this.audio_data.get(video_id).last_accessed = Date.now();
            return true;
        }

        const video_audio_path = path.join(this.hls_raw_audio_directory, video_id, 'audio');
        const exists = file_system.existsSync(video_audio_path);
        if(exists) {
            const audio_codec_directories = this.codecs.map(codec => ({
                codec,
                directory: path.join(video_audio_path, codec)
            }));

            for(const {codec, directory} of audio_codec_directories) {
                for(const profile of this.profile_progression) {
                    const profile_directory = path.join(directory, profile);
                    const playlist_path = path.join(profile_directory, `${Adaptive_Stream.profiles[codec][profile].bitrate}.m3u8`);
                    const playlist_exists = file_system.existsSync(playlist_path);
                    if(!playlist_exists) {
                        // even if one playlist is missing, delete all audio files
                        console.warn(`Missing playlist for video ID ${video_id}, codec ${codec}, profile ${profile}. Deleting audio files.`);
                        // file_system.promises.rm(video_audio_path, { recursive: true, force: true });
                        await this.delete_raw_audio(video_id);
                        return false;
                    }
                }
            }

            console.warn(`Audio files exist for video ID: ${video_id} but no active session found. Recreating session data.`);
            this.audio_data.set(video_id, {
                process: null,
                created_at: Date.now(),
                last_accessed: Date.now(),
            });
        }
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

        let audio_process = null;
        let ffmpeg_process = null;

        try {
            const create_audio_metadata = async () => {
                try {
                    const json_dump_data = await this.get_json_dump(video_id);
                    await this.create_properties_json(video_id, { permanent: false }, json_dump_data);
                    // this.create_lyrics_vtt(video_id, json_dump_data);
                    // replace with custom json data format 
                } catch (error) {
                    console.warn(`Failed to create metadata for ${video_id}:`, error.message);
                    // Non-fatal error - continue without metadata
                }
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
            audio_process = await this.create_yt_dlp_process(video_id); // use inital video to create the HLS stream
            ffmpeg_process = await this.create_ffmpeg_process(audio_process, path.join(this.hls_raw_audio_directory, video_id, 'audio'), video_id, available_codecs, available_profiles);

            // Wait for first segment
            const first_profile = available_profiles[0]; // 'ultra-low'
            await this.wait_for_first_readable_segment(video_id, available_codecs[0], first_profile, 15000);

            request_embedding(video_id).catch(error => {}); // catch to avoid unhandled rejection

            // success
            this.audio_data.set(video_id, {
                process: ffmpeg_process,
                created_at: Date.now(),
                last_accessed: Date.now(),
            });

            return ffmpeg_process;
        } catch (error) {
            // cleanup on failure
            console.error(`Error creating HLS stream for video ID ${video_id}:`, error.message);
            
            // Kill any running processes
            try {
                if (audio_process && audio_process.kill) {
                    audio_process.kill('SIGTERM');
                }
            } catch (killError) {
                console.warn(`Failed to kill yt-dlp process for ${video_id}:`, killError.message);
            }
            
            try {
                if (ffmpeg_process && ffmpeg_process.kill) {
                    ffmpeg_process.kill('SIGTERM');
                }
            } catch (killError) {
                console.warn(`Failed to kill ffmpeg process for ${video_id}:`, killError.message);
            }
            
            // Cleanup audio data
            this.audio_data.delete(video_id);
            
            // Delete files (non-blocking)
            this.delete_raw_audio(video_id).catch(deleteError => {
                console.warn(`Failed to cleanup audio files for ${video_id}: ${deleteError.message}`);
            });
            
            throw error;
        }
    }

    async create_hls_mix_stream(mix_id, audio_url, available_codecs = this.codecs, available_profiles = this.profile_progression) {
        if (!this.ready) throw new Error('Adaptive_Stream not initialized properly.');
        if (!mix_id || typeof mix_id !== 'string' || mix_id.trim() === '') throw new Error('Invalid mix_id parameter.');

        console.log(`Spinning up HLS mix stream: ${mix_id}`);

        // optimistic
        this.audio_data.set(mix_id, {
            process: null,
            created_at: Date.now(),
            last_accessed: Date.now(),
        });

        let ffmpeg_process = null;

        try {
            // ensure the session directory folders and raw audio directory folders
            await this.ensure_directories([
                ...available_codecs.flatMap(codec => {
                    return available_profiles.map(profile => {
                        return path.join(this.hls_mix_audio_directory, mix_id, 'audio', codec, profile);
                    });
                })
            ]);
            const master_playlist = this.create_master_playlist(available_codecs, available_profiles);
            await this.write_master_playlist(path.join(this.hls_mix_audio_directory, mix_id, 'audio'), master_playlist);

            ffmpeg_process = await this.create_ffmpeg_process(audio_url, path.join(this.hls_mix_audio_directory, mix_id, 'audio'), mix_id, available_codecs, available_profiles);

            // Wait for first segment
            const first_profile = available_profiles[0]; // 'ultra-low'
            await this.wait_for_first_readable_segment(mix_id, available_codecs[0], first_profile, 15000, this.hls_mix_audio_directory);

            // success
            this.audio_data.set(mix_id, {
                process: ffmpeg_process,
                created_at: Date.now(),
                last_accessed: Date.now(),
            });

            return ffmpeg_process;
        } catch (error) {
            console.error(`Error creating HLS mix stream for mix ID ${mix_id}:`, error.message);
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
                        '-hls_playlist_type', 'vod',
                        // '-hls_segment_type', 'mpegts',
                        // '-start_number', '0',
                        // '-avoid_negative_ts', 'make_zero',
                        // '-fflags', '+genpts',
                        '-map_metadata', '-1',
                        // '-preset', this.get_ffmpeg_preset(fast_startup, profile),
                        // '-tune', this.get_ffmpeg_tune(fast_startup, profile),
                        '-hls_flags', 'append_list',
                        // '-hls_base_url', `${relative_segment_path}/`,
                        '-hls_segment_filename', path.join(output_directory, codec, profile, `${video_id}_${profile_info.bitrate}_%d.ts`)
                    ]);
            }
        }

        return new Promise((resolve, reject) => {
            let resolved = false;
            
            // Add timeout for FFmpeg startup
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    try {
                        ffmpeg_process.kill('SIGTERM');
                    } catch (e) {
                        // Ignore kill errors
                    }
                    reject(new Error(`FFmpeg timeout for video ${video_id}`));
                }
            }, 30000); // 30 second timeout
            
            ffmpeg_process
                .on('end', () => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        resolve({
                            process: ffmpeg_process,
                            duration: null, // to do: calculate duration
                        });
                    }
                })
                .on('error', (err, stdout, stderr) => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        
                        const error_message = err.message || '';
                        const stderr_message = stderr || '';
                        
                        // Check for specific error types
                        if (error_message.includes('SIGTERM') || error_message.includes('SIGKILL')) {
                            reject(new Error(`FFmpeg was terminated for video ${video_id}`));
                        } else if (stderr_message.includes('Invalid data found') || 
                                   stderr_message.includes('moov atom not found') ||
                                   error_message.includes('I/O error')) {
                            reject(new Error(`Video ${video_id} has invalid or inaccessible audio data`));
                        } else if (stderr_message.includes('403') || 
                                   stderr_message.includes('Forbidden')) {
                            reject(new Error(`Access forbidden for video ${video_id}`));
                        } else {
                            reject(new Error(`FFmpeg failed for video ${video_id}: ${error_message}`));
                        }
                    }
                })
                .run();
        });
    }

    async wait_for_first_readable_segment(video_id, codec = 'aac', profile = this.profile_progression[0], timeout = 15000, root = this.hls_raw_audio_directory) {
        return new Promise((resolve, reject) => {
            const segment_path = path.join(root, video_id, 'audio', codec, profile);
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

                const timeout = setTimeout(() => {
                    if (process && !process.killed) {
                        process.kill('SIGTERM');
                    }
                    reject(new Error(`Timeout getting JSON dump for ${video_id}`));
                }, 15000); // 15 second timeout

                process.stdout.on('data', (data) => {
                    stdout_data += data.toString();
                });

                process.stderr.on('data', (data) => {
                    stderr_data += data.toString();
                });

                process.on('close', (code) => {
                    clearTimeout(timeout);
                    if (code === 0) {
                        try {
                            const json_data = JSON.parse(stdout_data);
                            resolve(json_data);
                        } catch (err) {
                            reject(new Error(`Failed to parse yt-dlp JSON output: ${err.message}`));
                        }
                    } else {
                        const error_message = stderr_data.trim() || 'Unknown error';
                        
                        // Check for specific error types
                        if (error_message.includes('HTTP Error 403') || 
                            error_message.includes('Forbidden') ||
                            error_message.includes('fragment') ||
                            error_message.includes('not available')) {
                            reject(new Error(`Video ${video_id} is not accessible or not available`));
                        } else if (error_message.includes('Video unavailable') || 
                                   error_message.includes('Private video') ||
                                   error_message.includes('does not exist')) {
                            reject(new Error(`Video ${video_id} not found or unavailable`));
                        } else {
                            reject(new Error(`Failed to get JSON dump for ${video_id}: ${error_message}`));
                        }
                    }
                });

                process.on('error', (err) => {
                    clearTimeout(timeout);
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

    async stitch_mix_data_to_raw_audio(mix_data) {
        if(!mix_data) throw new Error('No mix_data provided for stitching.');

        console.log('Stitching mix data to raw audio:', mix_data);

        const {
            mix_id,
            song_id_1,
            song_id_2,
            mix_out_time,
            mix_in_time,
            overlap_duration,
            last_song1_segment,
            crossfade_wav_path,
            first_song2_segment,
            segment_duration
        } = mix_data;

        // Validate required fields
        if(!song_id_1 || !song_id_2) throw new Error('Invalid song IDs in mix_data.');
        if(!crossfade_wav_path) throw new Error('No crossfade WAV path provided.');

        const codec = this.codecs[0]; // 'aac'
        const profile = 'ultra-high'; // Use highest quality for mixing

        // Get segment paths for both songs
        const song1_segment_dir = path.join(this.hls_raw_audio_directory, song_id_1, 'audio', codec, profile);
        const song2_segment_dir = path.join(this.hls_raw_audio_directory, song_id_2, 'audio', codec, profile);

        // Get list of segment files for song 1 (up to last_song1_segment)
        const song1_files = await file_system.promises.readdir(song1_segment_dir);
        const song1_segments = song1_files
            .filter(f => f.endsWith('.ts'))
            .sort((a, b) => {
                const num_a = parseInt(a.match(/\d+/)?.[0] || '0');
                const num_b = parseInt(b.match(/\d+/)?.[0] || '0');
                return num_a - num_b;
            })
            .slice(0, last_song1_segment)
            .map(f => path.join(song1_segment_dir, f));

        // Get list of segment files for song 2 (from first_song2_segment onwards)
        const song2_files = await file_system.promises.readdir(song2_segment_dir);
        const song2_segments = song2_files
            .filter(f => f.endsWith('.ts'))
            .sort((a, b) => {
                const num_a = parseInt(a.match(/\d+/)?.[0] || '0');
                const num_b = parseInt(b.match(/\d+/)?.[0] || '0');
                return num_a - num_b;
            })
            .slice(first_song2_segment)
            .map(f => path.join(song2_segment_dir, f));

        console.log(`Stitching mix ${mix_id}:`);
        console.log(`  Song 1 segments: ${song1_segments.length} (0 to ${last_song1_segment - 1})`);
        console.log(`  Crossfade WAV: ${crossfade_wav_path}`);
        console.log(`  Song 2 segments: ${song2_segments.length} (from ${first_song2_segment})`);

        // Create output directory for the mix
        const mix_output_dir = path.join(this.hls_root, 'mixes', mix_id);
        await this.ensure_directories([mix_output_dir]);

        // Stitch to single WAV, then convert to HLS
        // const stitched_wav_path = await this.stitch_audio_to_single_wav(
        //     song1_segments,
        //     song2_segments,
        //     crossfade_wav_path,
        //     mix_output_dir
        // );

        // Convert stitched WAV to HLS
        await this.create_hls_mix_stream(mix_id, crossfade_wav_path);

        // Cleanup temp WAV files
        // await this.unlink_file(stitched_wav_path).catch(e => console.warn('Failed to delete stitched WAV:', e.message));
        
        // Release the crossfade temp file (call Python to clean it up, or just delete it)
        await this.unlink_file(crossfade_wav_path).catch(e => console.warn('Failed to delete crossfade WAV:', e.message));

        return {
            mix_id,
            playlist_url: `/hls/mixes/${mix_id}/audio/master.m3u8`,
            mix_data
        };
    }

    // combine all audio into single wav file for processing into one final audio file for HLS streaming
    // release temp files after processing
    async stitch_audio_to_single_wav(song1_segments, song2_segments, crossfade_wav_path, output_dir) {
        if(!song1_segments || !song2_segments) throw new Error('Invalid segments provided for stitching.');

        const output_wav_path = path.join(output_dir, 'stitched_mix.wav');

        // Create a concat file for FFmpeg
        const concat_file_path = path.join(output_dir, 'concat_list.txt');
        
        // Build the concat list
        // Format: file 'path/to/file'
        const concat_lines = [];

        // Add song 1 segments
        for (const segment of song1_segments) {
            concat_lines.push(`file '${segment}'`);
        }

        // Add crossfade WAV
        concat_lines.push(`file '${crossfade_wav_path}'`);

        // Add song 2 segments
        for (const segment of song2_segments) {
            concat_lines.push(`file '${segment}'`);
        }

        await file_system.promises.writeFile(concat_file_path, concat_lines.join('\n'));

        console.log(`  Created concat list with ${concat_lines.length} files`);

        // Use FFmpeg to concatenate and convert to WAV
        return new Promise((resolve, reject) => {
            const ffmpeg_process = spawn('ffmpeg', [
                '-f', 'concat',
                '-safe', '0',
                '-i', concat_file_path,
                '-c:a', 'pcm_s16le',  // Convert to PCM WAV
                '-ar', '44100',        // 44.1kHz sample rate
                '-ac', '2',            // Stereo
                '-y',                  // Overwrite output
                output_wav_path
            ]);

            let stderr_output = '';

            ffmpeg_process.stderr.on('data', (data) => {
                stderr_output += data.toString();
            });

            ffmpeg_process.on('close', async (code) => {
                // Cleanup concat file
                await this.unlink_file(concat_file_path).catch(() => {});

                if (code === 0) {
                    console.log(`  ✅ Stitched WAV created: ${output_wav_path}`);
                    resolve(output_wav_path);
                } else {
                    console.error(`  ❌ FFmpeg concat failed:`, stderr_output);
                    reject(new Error(`FFmpeg concat failed with code ${code}`));
                }
            });

            ffmpeg_process.on('error', (err) => {
                reject(new Error(`FFmpeg spawn error: ${err.message}`));
            });
        });
    }

    async unlink_file(file_path) {
        return new Promise((resolve, reject) => {
            file_system.promises.unlink(file_path)
                .then(() => {
                    resolve();
                })
                .catch((err) => {
                    reject(err);
                });
        });
    }

    async create_session(video_ids) {
        const session_id = crypto.randomBytes(16).toString('hex');

        await this.stream(video_ids);

        const session_directory = path.join(this.hls_session_directory, session_id);
        const session_audio_directory = path.join(session_directory, 'audio');

        await this.ensure_directories([session_directory, session_audio_directory]);

        const master_playlist = this.create_session_master_playlist(session_id);
        await this.write_master_playlist(session_audio_directory, master_playlist);

        // Store session state - tracks are { video_id, type: 'raw' } or { mix_id, type: 'mix' }
        const session_state = {
            session_id,
            tracks: video_ids.map(video_id => ({
                video_id, 
                type: 'raw',
                out_mix: null, // pointer to mix if created, to be put after this track
                in_mix: null,  // pointer to mix if created, to be put before this track
                start_time: null,
                end_time: null,
            })),
            created_at: Date.now(),
            updated_at: Date.now(),
            playlist_url: `/hls/sessions/${session_id}/audio/master.m3u8`,
        };
        
        this.session_data.set(session_id, session_state);

        return session_state;
    }

    create_session_master_playlist(session_id) {
        const lines = ['#EXTM3U', '#EXT-X-VERSION:7'];

        for (const codec of this.codecs) {
            for (const profile of this.profile_progression) {
                const profile_info = Adaptive_Stream.profiles?.[codec]?.[profile];
                if (!profile_info) continue;
                
                lines.push(
                    `#EXT-X-STREAM-INF:BANDWIDTH=${profile_info.bandwidth},CODECS="${profile_info.hls_codec}"`,
                    `/session/${session_id}/audio/${codec}/${profile}/playlist.m3u8`
                );
            }
        }

        return lines.join('\n');
    }

    async parse_playlist_segments(playlist_path, base_path) {
        try {
            const content = await file_system.promises.readFile(playlist_path, 'utf-8');
            const lines = content.split('\n');
            const segments = [];
            
            let current_duration = 0;
            
            for (const line of lines) {
                if (line.startsWith('#EXTINF:')) {
                    // Parse duration: #EXTINF:1.021678,
                    const duration_match = line.match(/#EXTINF:([\d.]+)/);
                    if (duration_match) {
                        current_duration = parseFloat(duration_match[1]);
                    }
                } else if (line.endsWith('.ts') && !line.startsWith('#')) {
                    // This is a segment filename
                    segments.push({
                        duration: current_duration,
                        filename: line.trim(),
                        base_path: base_path
                    });
                    current_duration = 0;
                }
            }
            
            return segments;
        } catch (error) {
            console.error(`Error parsing playlist ${playlist_path}:`, error.message);
            return [];
        }
    }

    async generate_session_playlist(session_id, codec, profile, tracks = null, options = {}) {
        const session = this.session_data.get(session_id);
        if (!session) {
            throw new Error('Session not found');
        }
        if(!tracks) {
            tracks = session.tracks;
        }

        const profile_info = Adaptive_Stream.profiles?.[codec]?.[profile];
        if (!profile_info) {
            throw new Error('Invalid codec/profile combination');
        }

        const bitrate = profile_info.bitrate;
        const lines = ['#EXTM3U', '#EXT-X-VERSION:7'];
        
        // lines.push('#EXT-X-INDEPENDENT-SEGMENTS');
        lines.push('#EXT-X-PLAYLIST-TYPE:VOD');
        
        // Calculate target duration (max segment duration across all tracks)
        let max_duration = 0;
        let is_first_source = true;
        let total_duration = 0;
        const all_track_segments = [];

        for (const track of tracks) {
            let playlist_path;
            let base_path; // Absolute URL path to segments
            let total_duration = 0;

            playlist_path = path.join(this.hls_raw_audio_directory, track.video_id, 'audio', codec, profile, `${bitrate}.m3u8`);
            base_path = `/hls/raw/${track.video_id}/audio/${codec}/${profile}`;

            let segments = await this.parse_playlist_segments(playlist_path, base_path);

            if(track.out_mix) {
                const mix = track.out_mix;
                const mix_playlist_path = path.join(this.hls_mix_audio_directory, mix.mix_id, 'audio', codec, profile, `${bitrate}.m3u8`);
                const mix_base_path = `/hls/mixes/${mix.mix_id}/audio/${codec}/${profile}`;
                const mix_segments = await this.parse_playlist_segments(mix_playlist_path, mix_base_path);

                const concated_segments = this.get_mix_segments_and_track_segments(segments, mix_segments, mix);
                segments = concated_segments;
            } else if(track.in_mix) {
                const mix = track.in_mix;
                const mix_playlist_path = path.join(this.hls_mix_audio_directory, mix.mix_id, 'audio', codec, profile, `${bitrate}.m3u8`);
                const mix_base_path = `/hls/mixes/${mix.mix_id}/audio/${codec}/${profile}`;
                const mix_segments = await this.parse_playlist_segments(mix_playlist_path, mix_base_path);
                
                const concated_segments = this.get_mix_segments_and_track_segments(segments, mix_segments, mix, 'in');
                segments = concated_segments;
            }
            
            // if (track.type === 'raw') {
            // } else if (track.type === 'mix') {
                // playlist_path = path.join(this.hls_mix_audio_directory, track.mix_id, 'audio', codec, profile, `${bitrate}.m3u8`);
                // base_path = `/hls/mixes/${track.mix_id}/audio/${codec}/${profile}`;

                // segments = await this.parse_mix_playlist_segments(playlist_path, );
            // } else {
                // continue;
            // }


            // const segments = await this.parse_playlist_segments(playlist_path);

            for (const seg of segments) {
                if (seg.duration > max_duration) {
                    max_duration = seg.duration;
                }
                // total_duration += seg.duration;
            }

            all_track_segments.push({ track, segments });
        }

        lines.push(`#EXT-X-TARGETDURATION:${Math.ceil(max_duration || 8)}`);
        lines.push('#EXT-X-MEDIA-SEQUENCE:0');
        // lines.push(`#EXT-X-DISCONTINUITY-SEQUENCE:0`);

        // Second pass: build the playlist with discontinuity tags
        for (let i = 0; i < all_track_segments.length; i++) {
            const { track, segments } = all_track_segments[i];
            
            // Add discontinuity tag before each new source (except the first)
            if (!is_first_source) {
                lines.push('#EXT-X-DISCONTINUITY');
                
            }
            // lines.push(`#EXT-X-DISCONTINUITY-SEQUENCE:${i}`);
            // lines.push(`#EXT-X-MEDIA-SEQUENCE:${i * 2}`);

            is_first_source = false;
            
            // Add all segments from this source
            for (const segment of segments) {
                lines.push(`#EXTINF:${segment.duration.toFixed(6)},`);
                lines.push(`${segment.base_path}/${segment.filename}`);
                total_duration += segment.duration;
            }
        }

        lines.push('#EXT-X-ENDLIST');
        const filtered_lines = this.filter_playlist_m3u8(lines);

        return filtered_lines.join('\n');
    }

    filter_playlist_m3u8(playlist_lines) {
        // remove back to back discontinuity tags
        const filtered_lines = [];
        let last_line_was_discontinuity = false;

        for (const line of playlist_lines) {
            if (line === '#EXT-X-DISCONTINUITY') {
                if (!last_line_was_discontinuity) {
                    filtered_lines.push(line);
                    last_line_was_discontinuity = true;
                } // else skip this line
            } else {
                filtered_lines.push(line);
                last_line_was_discontinuity = false;
            }
        }

        return filtered_lines;
    }

    get_mix_segments_and_track_segments(track_segments, mix_segments, mix_data, track_position = 'out') {
        const {
            mix_id,
            song_id_1,
            song_id_2,
            mix_out_time,
            mix_in_time,
            overlap_duration,
            last_song1_segment,
            crossfade_wav_path,
            first_song2_segment,
            segment_duration
        } = mix_data;

        if(track_position === 'out') {
            // song => mix
            const final_mix_segments = mix_segments.slice(last_song1_segment, last_song1_segment + first_song2_segment - 1);
            let final_track_segments = track_segments.slice(0, last_song1_segment);
            return final_track_segments.concat(final_mix_segments);
        } else if(track_position === 'in') {
            // mix => song
            let final_track_segments = track_segments.slice(first_song2_segment);
            return final_track_segments; // mix segments should already be added due to out mix
        }

        return [];
    }

    async delete_session(session_id) {
        const session = this.session_data.get(session_id);
        if (!session) {
            return false;
        }

        // Remove session directory (only contains master.m3u8)
        const session_directory = path.join(this.hls_session_directory, session_id);
        try {
            await file_system.promises.rm(session_directory, { recursive: true, force: true });
        } catch (error) {
            console.error(`Error deleting session directory ${session_id}:`, error.message);
        }

        this.session_data.delete(session_id);
        return true;
    }

    async add_song_to_session(session_id, video_id, options = {}) {
        const session = this.session_data.get(session_id);
        if (!session) {
            throw new Error('Session not found');
        }

        await this.stream([video_id], options);

        session.tracks.push({ video_id, type: 'raw', out_mix: null, in_mix: null });
        session.updated_at = Date.now();

        console.log(`Added song ${video_id} to session ${session_id}`);

        return {
            session_id,
            video_id,
            playlist_url: `/hls/sessions/${session_id}/audio/master.m3u8`,
        };
    }   

    async add_mix_to_session(session_id, mix_data) {
        const session = this.session_data.get(session_id);
        if (!session) {
            throw new Error('Session not found');
        }

        this.stitch_mix_data_to_raw_audio(mix_data);

        // session.tracks.push({ mix_id: mix_data.mix_id, type: 'mix' });
        const out_mix_track = session.tracks.find(track => track.video_id === mix_data.song_id_1 && track.out_mix === null);
        const in_mix_track = session.tracks.find(track => track.video_id === mix_data.song_id_2 && track.in_mix === null);
        if (out_mix_track) {
            out_mix_track.out_mix = mix_data;
        }
        if (in_mix_track) {
            in_mix_track.in_mix = mix_data;
        }
        session.updated_at = Date.now();

        console.log(`Added mix ${mix_data.mix_id} to session ${session_id}`);

        return {
            session_id,
            mix_id: mix_data.mix_id,
            playlist_url: `/hls/sessions/${session_id}/audio/master.m3u8`,
        };
    };
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