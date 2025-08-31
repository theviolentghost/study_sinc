import fs_sync from 'fs';
import fs from 'fs/promises';
import path from 'path';
import 'dotenv/config';
import { google } from 'googleapis';
import { YtDlp } from 'ytdlp-nodejs';
import SpotifyWebApi from 'spotify-web-api-node';
import SpotifyToYoutube from 'spotify-to-youtube';
import progress_emitter from '../progress.emitter.js';
import { spawn, exec } from 'child_process';
import axios from 'axios';
import Adaptive_Stream from './stream.js';
const stream = new Adaptive_Stream();
import { promisify } from 'util';

const exec_async = promisify(exec);
async function kill_processes_on_port(port) {
    try {
        console.log(`🧹 Checking for processes on port ${port}...`);
        
        // Find processes using the port
        const { stdout } = await exec_async(`lsof -ti:${port}`);
        
        if (stdout.trim()) {
            const pids = stdout.trim().split('\n').filter(pid => pid);
            console.log(`Found ${pids.length} process(es) on port ${port}: ${pids.join(', ')}`);
            
            // Kill each process
            for (const pid of pids) {
                try {
                    await exec_async(`kill -9 ${pid}`);
                    console.log(`✅ Killed process ${pid}`);
                } catch (error) {
                    console.log(`⚠️ Process ${pid} was already terminated or couldn't be killed`);
                }
            }
            
            // Wait a moment for processes to fully terminate
            await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
            console.log(`✅ No processes found on port ${port}`);
        }
    } catch (error) {
        if (error.code === 1) {
            // lsof returns exit code 1 when no processes are found - this is normal
            console.log(`✅ No processes found on port ${port}`);
        } else {
            console.error(`Error checking/killing processes on port ${port}:`, error.message);
        }
    }
}

// start python server 
try {
    await kill_processes_on_port(54321); // Ensure no processes are using port 54321

    const pythonServer = spawn('./venv/bin/gunicorn', [
            '-w', '2',
            '-b', '0.0.0.0:54321',
            'server:app'
        ], {
        cwd: process.cwd(), 
        env: {
            ...process.env,
            PATH: `${path.resolve('./venv/bin')}:${process.env.PATH}`,
            VIRTUAL_ENV: path.resolve('./venv')
        },
        stdio: 'inherit' 
    });

    // Optionally, handle exit or errors
    pythonServer.on('error', (err) => {
        console.error('Failed to start Python server:', err);
    });

    pythonServer.on('exit', (code) => {
        console.log(`Python server exited with code ${code}`);
    });
} catch (error) {
    console.error('Error starting Python server');
}

const Downloader = new YtDlp({
    cwd: process.cwd(),
    shell: false,
    windowsHide: true,
    detached: false,
    binaryPath: '/Users/norbertzych/Desktop/Projects/study_sinc/venv/bin/yt-dlp' // Specify the correct path to yt-dlp
});

const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY,
});

const spotify_api = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET
});

async function setup_spotify_auth(retry_depth = 0) {
    if( retry_depth > 3) return console.error('Failed to set up Spotify authentication after 3 attempts');
    try {
        const creds = await spotify_api.clientCredentialsGrant();
        spotify_api.setAccessToken(creds.body.access_token);
        console.log('Spotify authentication set up successfully');
    } catch (error) {
        console.error('Error setting up Spotify authentication');
        await setup_spotify_auth(retry_depth + 1);
    }
}
setup_spotify_auth();
setTimeout(() => {
    setup_spotify_auth();
    console.log("Spotify authentication setup complete");
}, 20 * 60 * 1000); 

async function get_audio_file(audio_path = '') {
    try {
        audio_path = path.join('storage', 'uploads', audio_path);
        await fs.access(audio_path, fs_sync.constants.R_OK);
        const stat = await fs.stat(audio_path);
        if (!stat.isFile()) {
            throw new Error('Path is not a file');
        }
        const data = await fs.readFile(audio_path);
        return data;
    } catch (error) {
        console.error('Error reading audio file:', error);
        return null;
    }
}

function ensure_quality_in_query(query) {
    const lower = query.toLowerCase();
    const keywords = ['lyrics', 'original', 'official audio'];
    let enhanced = query;

    keywords.forEach(keyword => {
        if (!lower.includes(keyword)) {
            enhanced += ` ${keyword}`;
        }
    });

    return enhanced.trim();
}

async function youtube_search_for_videos(query = 'NoCopyrightSounds', total_results = 50, next_page_token = undefined, enhance_search = true) {
    if (!query || query.trim() === '') {
        console.error('Query must be a non-empty string');
        return {
            results: [],
            total: 0,
            next_page_token: null
        };
    }

    if (enhance_search) query = ensure_quality_in_query(query);

    let results = [];

    while (results.length < total_results) {
        const response = await youtube.search.list({
            part: ['id', 'snippet'],
            q: query,
            type: ['video'],
            videoCategoryId: '10',
            maxResults: Math.min(200, total_results - results.length),
            pageToken: next_page_token,
        });

        results = results.concat(response.data.items);
        next_page_token = response.data.nextPageToken;

        if (!next_page_token) break;
    }

    return {
        results,
        total: results.length,
        next_page_token
    };
}

async function youtube_search_for_artists(query = 'NoCopyrightSounds', total_results = 16, next_page_token = undefined) {
    if (!query || query.trim() === '') {
        console.error('Query must be a non-empty string');
        return {
            results: [],
            total: 0,
            next_page_token: null
        };
    }

    let results = [];

    while (results.length < total_results) {
        const response = await youtube.search.list({
            part: ['id', 'snippet'],
            q: query,
            type: ['channel'],
            maxResults: Math.min(40, total_results - results.length), // YouTube API max is 50 per request
            pageToken: next_page_token,
        });

        results = results.concat(response.data.items);
        next_page_token = response.data.nextPageToken;

        // Break if no more pages available
        if (!next_page_token) break;
    }

    return {
        results,
        total: results.length,
        next_page_token
    };
}

async function youtube_search(query = 'NoCopyrightSounds', /* add more params in future */) {
    if (!query || query.trim() === '') {
        console.error('Query must be a non-empty string');
        return {
            videos: {},
            artists: {},
        };
    }

    try {
        return Promise.all([
            youtube_search_for_videos(query, 50, undefined, false),
            youtube_search_for_artists(query, 16)
        ]).then(([videos, artists]) => {
            return {
                videos,
                artists
            };
        });
    } catch (error) {
        console.error('Error searching YouTube:', error);
        return {
            videos: {},
            artists: {}
        };
    }
}

async function spotify_search_for_videos(query = 'NoCopyrightSounds', total_results = 50) {
    if (!query || query.trim() === '') {
        console.error('Query must be a non-empty string');
        return {};
    }

    try {
        const data = await spotify_api.search(query, ['track'], { limit: total_results });

        return data.body.tracks;
    } catch (error) {
        console.error('Error searching Spotify:', error);
        return {};
    }
}

async function spotify_search_for_artists(query = 'NoCopyrightSounds', total_results = 50) {
    if (!query || query.trim() === '') {
        console.error('Query must be a non-empty string');
        return {};
    }

    try {
        const data = await spotify_api.search(query, ['artist'], { limit: total_results });

        return data.body.tracks;
    } catch (error) {
        console.error('Error searching Spotify:', error);
        return {};
    }
}

async function spotify_search_for_albums(query = 'NoCopyrightSounds', total_results = 50) {
    if (!query || query.trim() === '') {
        console.error('Query must be a non-empty string');
        return {};
    }

    try {
        const data = await spotify_api.search(query, ['album'], { limit: total_results });

        return data.body.albums;
    } catch (error) {
        console.error('Error searching Spotify:', error);
        return {};
    }
}

async function spotify_search_for_playlists(query = 'NoCopyrightSounds', total_results = 50) {
    if (!query || query.trim() === '') {
        console.error('Query must be a non-empty string');
        return {};
    }

    try {
        const data = await spotify_api.search(query, ['playlist'], { limit: total_results });

        return data.body.playlists;
    } catch (error) {
        console.error('Error searching Spotify:', error);
        return {};
    }
}

async function spotify_search(query = 'NoCopyrightSounds', total_results = 40) {
    if (!query || query.trim() === '') {
        console.error('Query must be a non-empty string');
        return {};
    }

    try {
        const data = await spotify_api.search(query, ['track', 'album', 'artist'], { limit: total_results });

        return data.body;
    } catch (error) {
        console.error('Error searching Spotify:', error);
        return {};
    }
}

async function search(query = 'NoCopyrightSounds', source = 'spotify') {
    switch(source) {
        case 'youtube':
            return youtube_search(query);
        case 'spotify':
            return spotify_search(query);
        default:
            console.error(`Unknown source: ${source}`);
            return {};
    }
}

async function spotify_uri_to_video_id(uri) {
    if (!uri) return null;

    try {
        //open.spotify.com/track/
        //spotify:track:5B2KdpqWRwcnO2Cfxh7MSX'
        if (!uri.startsWith('spotify:')) throw new Error(`Failed to fetch video id: Invalid URI format: ${uri}`);
        const spotify_id = uri.split(':').pop(); // Extract the last part of the URI

        console.log('Fetching Spotify video ID for:', spotify_id);

        const response = await axios.get(`http://0.0.0.0:54321/get_video_id?q=open.spotify.com/track/${spotify_id}`, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        if (response.status !== 200) {
            throw new Error(`Failed to fetch video id: ${response.statusText}`);
        }

        console.log('Fetched Spotify video ID:', response.data?.id);
        
        return response.data?.id;
    } catch (error) {
        console.error('Error fetching spotify video id:', error);
        return {};
        console.error('Error fetching spotify video id:', error);
        return {};
    }
}














//
//
// media

async function download_audio(youtube_video_id, options = {quality: '0', bit_rate: '192K'}) {
    try {
        const download_options = {
            extractAudio: true,
            audioFormat: 'mp3',
            audioQuality: options.quality || '0',
            output: 'storage/uploads/%(title)s.%(ext)s',
            args: [
                '--postprocessor-args', `ffmpeg:-b:a ${options.bit_rate}`,
            ],
        };

        console.log('Downloading audio for video ID:', `https://www.youtube.com/watch?v=${youtube_video_id}`);
        await Downloader.downloadAsync(`https://www.youtube.com/watch?v=${youtube_video_id}`, download_options);
    } catch (error) {
        console.error('Error downloading audio:', error);
        throw error;
    }
}

async function download_audio_to_stream(res, youtube_video_id, options = {quality: '0', bit_rate: '192K'}) {
    try {
        const download_options = {
            extractAudio: true,
            audioFormat: 'mp3',
            audioQuality: options.quality || '0',
            output: '-',
            args: [
                '--audio-format', 'mp3',
                '--postprocessor-args', `ffmpeg:-b:a ${options.bit_rate}`,
            ],
        };

        const downloadProcess = Downloader.download(
            `https://www.youtube.com/watch?v=${youtube_video_id}`,
            download_options
        );

        res.setHeader('Content-Type', 'audio/mpeg');                             // Crucial for Safari
        res.setHeader('Content-Disposition', 'inline; filename="track.mp3"');    // Helps with Blob usability
        res.setHeader('Cache-Control', 'no-cache');                              // Prevent aggressive caching
        res.setHeader('Accept-Ranges', 'bytes');                                 // Allows seeking/streaming

        downloadProcess.stdout.pipe(res);

        downloadProcess.stderr.on('data', (data) => {
            const str = data.toString();
            if (str.trim().startsWith('bright-')) {
                try {
                    const progress = JSON.parse(str.trim().replace(/^bright-/, ''));
                    progress_emitter.emit(youtube_video_id, progress);
                } catch (error) {}
            }
        });

        downloadProcess.on('close', (code) => {
            console.log(`Download process exited with code ${code}`);
            progress_emitter.emit(`${youtube_video_id}_done`);
            if (code !== 0) {
                if (!res.headersSent) {
                    res.status(500).send(`Download process failed with code ${code}`);
                } else if (!res.writableEnded) {
                    res.end();
                }
                // Do NOT throw here!
                return;
            }
            // throw new Error(`Download process failed with code ${code}`);
        });
    } catch (error) {
        // console.error('Error during audio download:', error);   
        throw error;
    }
}

async function download_audio_artwork_to_stream(res, youtube_video_id) {
    try {
        // Get video info to extract thumbnail URL
        const ytdlpArgs = [
            '--dump-json',
            '--no-playlist',
            '--quiet',
            `https://www.youtube.com/watch?v=${youtube_video_id}`
        ];

        const ytdlp = spawn('yt-dlp', ytdlpArgs);
        let output = '';
        let error = '';

        ytdlp.stdout.on('data', (data) => {
            output += data.toString();
        });

        ytdlp.stderr.on('data', (data) => {
            error += data.toString();
        });

        ytdlp.on('close', async (code) => {
            if (code !== 0) {
                console.error('yt-dlp failed:', error);
                res.status(500).send('Error fetching video info');
                return;
            }

            try {
                const videoInfo = JSON.parse(output);
                
                // Get the best quality thumbnail
                let thumbnailUrl = null;
                
                if (videoInfo.thumbnails && videoInfo.thumbnails.length > 0) {
                    // Sort thumbnails by resolution (highest first)
                    const sortedThumbnails = videoInfo.thumbnails
                        .filter(thumb => thumb.url && (thumb.width || thumb.height))
                        .sort((a, b) => {
                            const aRes = (a.width || 0) * (a.height || 0);
                            const bRes = (b.width || 0) * (b.height || 0);
                            return bRes - aRes;
                        });
                    
                    thumbnailUrl = sortedThumbnails[0]?.url;
                }
                
                // Fallback to maxresdefault if no thumbnails found
                if (!thumbnailUrl) {
                    thumbnailUrl = `https://img.youtube.com/vi/${youtube_video_id}/maxresdefault.jpg`;
                }

                // Stream the image
                const response = await axios({
                    method: 'GET',
                    url: thumbnailUrl,
                    responseType: 'stream',
                    timeout: 10000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });

                // Set appropriate headers
                res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
                res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
                
                if (response.headers['content-length']) {
                    res.setHeader('Content-Length', response.headers['content-length']);
                }

                // Pipe the image data to response
                response.data.pipe(res);

                response.data.on('error', (streamError) => {
                    console.error('Error streaming artwork:', streamError);
                    if (!res.headersSent) {
                        res.status(500).send('Error streaming artwork');
                    }
                });

            } catch (parseError) {
                console.error('Error parsing video info:', parseError);
                res.status(500).send('Error parsing video information');
            }
        });

    } catch (error) {
        console.error('Error fetching artwork:', error);
        if (!res.headersSent) {
            res.status(500).send('Error fetching artwork');
        }
    }
}

// Get direct audio URL from YouTube with customizable quality
async function get_audio_url(videoId, options = {quality: '0', bit_rate: '192K', format: 'mp3'}) {
  return new Promise((resolve, reject) => {
    let formatString;
    
    // Convert quality level to target bitrate if not explicitly provided
    const targetBitrate = options.bit_rate || getAudioBitrateForQuality(options.quality || '0');
    const qualityNum = parseInt(options.quality || '0');
    
    if (options.format === 'mp3' || options.format === 'audio') {
      if (qualityNum === 0) {
        // Best quality - no bitrate restriction
        formatString = 'bestaudio[protocol!=m3u8][ext!=m3u8]';
      } else if (qualityNum <= 3) {
        // High quality (320K, 256K, 192K, 160K)
        formatString = `bestaudio[protocol!=m3u8][ext!=m3u8][abr>=${parseInt(targetBitrate)}]`;
        formatString += `/bestaudio[protocol!=m3u8][ext!=m3u8][abr<=${parseInt(targetBitrate) + 64}]`;
      } else if (qualityNum <= 6) {
        // Medium quality (128K, 96K, 64K)
        formatString = `bestaudio[protocol!=m3u8][ext!=m3u8][abr<=${parseInt(targetBitrate) + 32}][abr>=${parseInt(targetBitrate) - 32}]`;
      } else {
        // Low quality (48K, 32K, 24K)
        formatString = `bestaudio[protocol!=m3u8][ext!=m3u8][abr<=${parseInt(targetBitrate) + 16}]`;
      }
      
      // Add fallbacks
      formatString += '/bestaudio[protocol!=m3u8]/best[protocol!=m3u8]';
    } else {
      // For other formats, apply quality filtering too
      if (qualityNum === 0) {
        formatString = 'bestaudio[ext=m4a][protocol!=m3u8]/bestaudio[ext=webm][protocol!=m3u8]/bestaudio[protocol!=m3u8]';
      } else {
        const bitrateNum = parseInt(targetBitrate);
        formatString = `bestaudio[ext=m4a][protocol!=m3u8][abr<=${bitrateNum + 32}]`;
        formatString += `/bestaudio[ext=webm][protocol!=m3u8][abr<=${bitrateNum + 32}]`;
        formatString += `/bestaudio[protocol!=m3u8][abr<=${bitrateNum + 32}]`;
      }
      
      formatString += '/best[protocol!=m3u8]';
    }

    console.log(`Using format string: ${formatString}`);
    
    const ytdlpArgs = [
      '-f', formatString,
      '--get-url',
      '--no-playlist',
      '--quiet',
      '--no-warnings'
    ];
    
    // Don't add postprocessor args when just getting URL
    // (postprocessor args are for actual downloads, not URL extraction)
    
    // Add video ID
    ytdlpArgs.push(`https://www.youtube.com/watch?v=${videoId}`);
    
    console.log(`Quality ${options.quality} (${targetBitrate}) format: ${formatString}`);
    
    // Run yt-dlp command
    const ytdlp = spawn('yt-dlp', ytdlpArgs);

    let output = '';
    let error = '';

    ytdlp.stdout.on('data', (data) => {
      output += data.toString();
    });

    ytdlp.stderr.on('data', (data) => {
      error += data.toString();
    });

    ytdlp.on('close', (code) => {
      if (code === 0) {
        const url = output.trim();
        
        // Check if we still got an HLS URL (fallback)
        if (url.includes('.m3u8') || url.includes('manifest')) {
          resolve('');
          return;
        }
        
        // console.log(`Got direct audio URL for ${videoId}: ${url.substring(0, 100)}...`);
        progress_emitter.emit(`${videoId}_got_url`, { url, options });
        resolve(url);
      } else {
        resolve('');
      }
    });
  });
}

function buildYtDlpCommand(videoUrl, { quality, bit_rate, format, directUrl = true }) {
    let cmd = `yt-dlp`;

    // If user wants the direct stream URL instead of downloading
    if (directUrl) cmd += ` -g`;

    // Start with format filter
    if (bit_rate) {
        const abr = parseInt(bit_rate.toLowerCase().replace('k', ''));
        cmd += ` -f "bestaudio[abr<=${abr}]"`;
    } else if (quality !== undefined) {
        // Sort by abr (average bitrate)
        // yt-dlp allows sort syntax: bestaudio[abr] → sort by bitrate
        cmd += ` -f "bestaudio[ext=webm]/bestaudio"`; // fallback if ext filter fails
        cmd += ` --format-sort "abr"`; // sort by bitrate
        // quality index: 0 = best (highest), 9 = worst (lowest)
        cmd += ` --format-sort-force`;
        cmd += ` --format-sort "abr"`; // sort ascending by default
        if (quality === '0') {
            cmd += ` --format-sort "abr:desc"`; // highest bitrate
        } else {
            // Lower quality means pick lower from sorted list
            cmd += ` --format-sort "abr:asc"`; // lowest bitrate
        }
    }

    // If converting to audio format like mp3
    if (format) {
        cmd += ` --extract-audio --audio-format ${format}`;
    }

    cmd += ` "${videoUrl}"`;
    return cmd;
}

// Helper function to convert quality level (0-9) to approximate bitrate
function getAudioBitrateForQuality(quality) {
  const qualityMap = {
    '0': '320K',  // Best
    '1': '256K',
    '2': '192K',
    '3': '160K',
    '4': '128K',
    '5': '96K',
    '6': '64K',
    '7': '48K',
    '8': '32K',
    '9': '24K'    // Worst
  };
  
  return qualityMap[quality] || '192K';
}

async function stream_audio(res, youtube_video_id) {
    try {
        let audio_url = await get_audio_url(youtube_video_id, {quality: '9', bit_rate: '24K', format: 'mp3'});
        if (!audio_url) {
            //for direct streaming
            audio_url = `/music/stream/${youtube_video_id}`;
        }
        // console.log(`Streaming audio for ${youtube_video_id} from URL: ${audio_url}`);

        res.status(200).json({url: audio_url});
    } catch (error) {
        console.error(`Error streaming audio for ${youtube_video_id}:`, error);
        if (!res.headersSent) {
            res.status(500).send('Error starting audio stream');
        } else if (!res.writableEnded) {
            res.end();
        }
    }
}

async function get_search_recommendations(query = '') {
    if(!query || query.trim() === '') {
        console.error('Query must be a non-empty string');
        return [];
    }
    try {
        const response = await axios.get('http://0.0.0.0:54321/search_suggestions', {
            params: {
                q: query
            },
            headers: {
                'Content-Type': 'application/json'
            }
        });
        if (response.status !== 200) {
            throw new Error(`Failed to fetch recommendations: ${response.statusText}`);
        }
        return response.data;
    } catch (error) {
        console.error('Error fetching search recommendations:', error);
        return {};
    }
}

async function get_top_charts() {
    try {
        const response = await axios.get('http://0.0.0.0:54321/charts', {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        if (response.status !== 200) {
            throw new Error(`Failed to fetch top charts: ${response.statusText}`);
        }
        return response.data;
    } catch (error) {
        console.error('Error fetching top charts:', error);
        return {};
    }
}

async function get_mood_categories() {
    try {
        const response = await axios.get('http://0.0.0.0:54321/mood_categories', {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        if (response.status !== 200) {
            throw new Error(`Failed to fetch mood categories: ${response.statusText}`); 
        }
        return response.data["Moods & moments"] || [];
    } catch (error) {
        console.error('Error fetching mood categories:', error);
        return [];
    }
}

async function get_mood_playlists(category) {
    if (!category || category.trim() === '') {
        console.error('Category must be a non-empty string');
        return [];
    }
    try {
        const response = await axios.get('http://0.0.0.0:54321/mood_playlists', {
            params: {
                mood: category
            },
            headers: {
                'Content-Type': 'application/json'  
            }
        });
        if (response.status !== 200) {
            throw new Error(`Failed to fetch mood tracks: ${response.statusText}`);
        }
        return response.data;
    } catch (error) {
        console.error('Error fetching mood tracks:', error);
        return [];
    }
}

function parse_duratrion(duration) {
    if (!duration || typeof duration !== 'string') return 0;
    const parts = duration.split(':').map(part => parseInt(part, 10));
    if (parts.length === 3) {
        // HH:MM:SS format
        return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000; // convert to milliseconds
    } else if (parts.length === 2) {
        // MM:SS format
        return (parts[0] * 60 + parts[1]) * 1000; // convert to milliseconds
    } else if (parts.length === 1) {
        // SS format
        return parts[0] * 1000; // convert to milliseconds
    }
    return 0; // invalid format
}

async function get_watch_playlist(track_id) {
    if (!track_id || track_id.trim() === '') {
        console.error('Track ID must be a non-empty string');
        return [];
    }
    try {
        const response = await axios.get(`http://0.0.0.0:54321/watch_playlist`, {
            params: {
                track_id: track_id
            },
            headers: {
                'Content-Type': 'application/json'  
            }
        });
        if (response.status !== 200) {
            throw new Error(`Failed to fetch mood tracks: ${response.statusText}`);
        }

        return {
            songs: response.data.slice(1).map((track) => ({
                // exclude first track as it is the playlist itself
                video_id: track.videoId,
                source_id: '',
                source: 'youtube'
            })),
            name: 'Watch Playlist',
            default: false,
            song_data: response.data.slice(1).map((track) => {
                return {
                    original_artists: track.artists.map(artist => ({
                        name: artist?.name,
                        id: artist?.id,
                        source: 'youtube'
                    })),
                    original_song_name: track?.title,
                    song_name: track?.title,
                    downloaded: false,
                    download_audio_blob: null,
                    download_artwork_blob: null,
                    download_options: {
                        quality: '0',
                        bit_rate: '192K'
                    },
                    url: {
                        audio: null,
                        artwork: {
                            low: track?.thumbnail[0]?.url || null,
                            high: track?.thumbnail[2]?.url || null
                        }
                    },
                    colors: {
                        primary: null,
                        common: null
                    },
                    video_duration: parse_duratrion(track?.length),
                    lyrics: null,
                    id: {
                        video_id: track.videoId,
                        source: 'youtube',
                        source_id: ''
                    },
                    liked: false
                };
            })
        };

        /*original_song_name: string;
    original_artists: Artist_Identifier[];
    song_name: string; // modifiable
    downloaded: boolean;
    download_audio_blob?: Blob | null; // the actual audio blob, if downloaded
    download_artwork_blob?: Blob | null; // the artwork blob, if available
    download_options?: { 
        quality: DownloadQuality,
        bit_rate: string // set to specifrics laters
    } | null; 
    url?: {
        audio: string | null; // the URL to the audio stream, if available
        artwork: {
            low: string | null; // low quality artwork URL
            high: string | null; // high quality artwork URL
        };
    };
    colors?: {
        primary: string | null; 
        common?: string[] | null
    }
    video_duration?: number; // the duration of the video in ms, if available
    lyrics?: Song_Lyrics,
    id: Song_Identifier; // the where this song was downloaded
    liked?: boolean; // whether the song is liked by the user*/ 
    } catch (error) {
        console.error('Error fetching mood tracks:', error);
        return [];
    }
}





export default {
    get: get_audio_file,
    youtube: {
        search: youtube_search,
        search_videos: youtube_search_for_videos,
        search_artists: youtube_search_for_artists,
        download: download_audio,
        download_stream: download_audio_to_stream,
        stream: stream_audio,
        get_audio_url: get_audio_url,
    },
    spotify: {
        search: spotify_search,
        search_videos: spotify_search_for_videos,
        search_artists: spotify_search_for_artists,
        search_albums: spotify_search_for_albums,
        search_playlists: spotify_search_for_playlists,
        uri_to_video_id: spotify_uri_to_video_id,
    },
    search,
    get_search_recommendations: get_search_recommendations,
    get_top_charts: get_top_charts,
    get_mood_categories: get_mood_categories,
    get_mood_playlists: get_mood_playlists,
    get_watch_playlist: get_watch_playlist,
    get_search_recommendations: get_search_recommendations,
    get_top_charts: get_top_charts,
    get_mood_categories: get_mood_categories,
    get_mood_playlists: get_mood_playlists,
    get_watch_playlist: get_watch_playlist,
    get_artwork: download_audio_artwork_to_stream,
    stream,
};