import { Injectable, Injector, Output, EventEmitter } from '@angular/core';
import { Observable, of } from 'rxjs';

import { ServiceWorkerMessageDistributorService } from '../src/service.worker.message.distributor';
import { MusicMediaService } from '../music.media.service';
import { MusicPlayerService } from '../music.player.service';

export interface Mix_Bundle {
    'mix_id': string,
    'song_id_1': string,
    'song_id_2': string,
    'mix_style': string,
    'mix_out_time': string,
    'mix_in_time': string,
    'overlap_duration': string,
    'last_song1_segment': string,
    'crossfade_wav_path': string,
    'first_song2_segment': string,
    'segment_duration': string,
    'created_at': number
}

export interface HLS_Bundle {
    video_id: string;
    codecs: string;
    profiles: string;
    profile_data: any;
}

export interface HLS_Segment {
    filename: string; // e.g., 'segment0.ts'
    data?: string; // base64 encoded segment data
    duration: number; // duration in seconds
}

export interface Track_Timestamp {
    video_id: string;
    start_timestamp: number;
    end_timestamp: number;
    has_audio_segments: boolean;
}

@Injectable({
    providedIn: 'root'
})
export class SessionPlaylistInterceptorService {
    @Output() public playlist_updated: EventEmitter<number[]> = new EventEmitter<number[]>();

    private readonly PLAYLIST_CACHE_NAME = 'sinc_music_playlists_v1';

    public profiles = {
        'opus': {
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
                hls_time: '8.0',
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
                hls_time: '8.0',
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
                hls_time: '8.0',
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
                hls_time: '8.0',
                hls_preset: 'medium',
            },
        },
        'aac': {
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
                hls_time: '8.0',
                hls_preset: 'fast',
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
            'ultra-high': {
                bitrate: '320k',
                sample_rate: 48000,
                channels: 2,
                bandwidth: 320 * 1024,
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

    public codecs = [/*'opus',*/ 'aac']; // Supported codecs
    public profile_progression = ['low', 'medium', 'high', 'ultra-high']; // Order of profiles for adaptive streaming

    public hls_bundles = new Map<string, HLS_Bundle>();
    private segment_blob_urls = new Map<string, string>(); // Map of segment URL -> blob URL
    private silent_audio_url: string = '/music/audio/silent/audio/master.m3u8';
    private silent_audio_segment_url: string = '/music/audio/silent/audio/aac/ultra-low/32k_60.ts';
    private silent_audio_duration: number = 60.0523; // duration in seconds
    private _player: MusicPlayerService;
    private get player(): MusicPlayerService {
        if (!this._player) {
            this._player = this.injector.get(MusicPlayerService);
        }
        return this._player;
    }

    constructor(private service_worker_message_distributor: ServiceWorkerMessageDistributorService, private media: MusicMediaService, private injector: Injector) { 
        console.log('🔧 SessionPlaylistInterceptorService constructor called');
        this.initialize();
    }

    private async store_playlist_in_cache(url: string, data: string): Promise<void> {
        try {
            const cache = await caches.open(this.PLAYLIST_CACHE_NAME);
            const response = new Response(data, {
                headers: {
                    'Content-Type': 'application/vnd.apple.mpegurl',
                    'Cache-Control': 'no-cache',
                    'X-Timestamp': Date.now().toString()
                }
            });
            await cache.put(url, response);
            console.log('💾 Stored playlist in Cache API (Angular):', url);
        } catch (error) {
            console.error('❌ Error storing playlist in Cache API (Angular):', error);
        }
    }

    public async initialize(): Promise<void> {
        console.log('✅ SessionPlaylistInterceptorService initializing...');
        
        // Pre-generate and store initial playlists
        await this.update_session_playlists();
        
        console.log('✅ SessionPlaylistInterceptorService initialized');
    }

    /**
     * Pre-generate and store session playlists in Cache API
     * Call this whenever the playlist changes
     */
    public async update_session_playlists(): Promise<void> {
        console.log('🔄 Updating session playlists in Cache API...');
        
        const tracks = this.get_tracks_for_session_playlist();
        
        // Generate and store master playlist
        const master_url = '/music/session/master.m3u8';
        const master_playlist = this.create_master_playlist();
        await this.store_playlist_in_cache(master_url, master_playlist);
        
        // Generate and store all codec/profile combinations
        for (const codec of this.codecs) {
            for (const profile of this.profile_progression) {
                const playlist_url = `/music/session/audio/${codec}/${profile}/playlist.m3u8`;
                const playlist = this.create_session_playlist(codec, profile, tracks, null);
                await this.store_playlist_in_cache(playlist_url, playlist);
            }
        }
        
        console.log('✅ Session playlists updated in Cache API');
        
        // Verify what's actually stored in the cache
        await this.verify_cache_contents();
    }
    
    private async verify_cache_contents(): Promise<void> {
        try {
            const cache = await caches.open(this.PLAYLIST_CACHE_NAME);
            const requests = await cache.keys();
            for (const request of requests) {
                const response = await cache.match(request);
                const text = await response?.text();
            }
        } catch (error) {
            console.error('❌ Error verifying cache:', error);
        }
    }

    // Create blob URLs from base64 segment data
    private create_blob_url_for_segment(base64_data: string): string {
        try {
            // Decode base64 to binary
            const binary_string = atob(base64_data);
            const bytes = new Uint8Array(binary_string.length);
            for (let i = 0; i < binary_string.length; i++) {
                bytes[i] = binary_string.charCodeAt(i);
            }
            
            // Create blob with correct MIME type for MPEG-TS
            const blob = new Blob([bytes], { type: 'video/mp2t' });
            return URL.createObjectURL(blob);
        } catch (error) {
            console.error('Error creating blob URL:', error);
            return null;
        }
    }

    // Clean up blob URLs to prevent memory leaks
    public cleanup_blob_urls(video_id?: string): void {
        if (video_id) {
            // Clean up blob URLs for a specific video
            const prefix = `/hls/raw/${video_id}/`;
            for (const [url, blob_url] of this.segment_blob_urls.entries()) {
                if (url.startsWith(prefix)) {
                    URL.revokeObjectURL(blob_url);
                    this.segment_blob_urls.delete(url);
                }
            }
        } else {
            // Clean up all blob URLs
            for (const blob_url of this.segment_blob_urls.values()) {
                URL.revokeObjectURL(blob_url);
            }
            this.segment_blob_urls.clear();
        }
    }

    public handle_request(url: string): string | null {
        if (url.includes('session') && url.endsWith('/playlist.m3u8')) return this.handle_playlist_request(url);
        if (url.includes('session') && url.endsWith('/master.m3u8')) return this.handle_master_playlist_request(url);

        return null;
    }

    private handle_playlist_request(url: string): any {
        // Check if we have a custom playlist for this URL
        // if (this.playlist) {
        //     const response = new HttpResponse({
        //         body: this.playlist,
        //         status: 200,
        //         statusText: 'OK',
        //         headers: req.headers.set('Content-Type', 'application/vnd.apple.mpegurl')
        //     });
            
        //     return of(response);
        // } 

        // return of(
        //     new HttpResponse({
        //         body: '',
        //         status: 404,
        //         statusText: 'Not Found'
        //     })
        // );

        const parsed_url = this.parse_session_playlist_url(url);
        const codec = parsed_url.codec;
        const profile = parsed_url.profile;

        return this.create_session_playlist(codec, profile, this.get_tracks_for_session_playlist(), null);
    }

    private parse_session_playlist_url(url: string): {codec: string, profile: string} {
        const regex = /\/session\/audio\/([^\/]+)\/([^\/]+)\/playlist.m3u8/;
        const match = url.match(regex);
        if (match) {
            return {
                codec: match[1],
                profile: match[2]
            };
        }
        return { codec: 'aac', profile: 'high' };
    }

    private handle_master_playlist_request(url: string): any {
        // Check if we have a custom master playlist for this URL
        if(!this.profile_progression || this.profile_progression.length == 0) {
            return "";
        }
        // if (!this.master_playlist) {
        //     this.master_playlist = this.create_master_playlist([]);
        // }

        return this.create_master_playlist();
    }


    public create_master_playlist(codecs: Array<string> = this.codecs, profile_progression: Array<string> = this.profile_progression): string {
        const lines = [
            '#EXTM3U',
            '#EXT-X-VERSION:7'
        ];

        for( const codec of codecs) {
            for (const profile of profile_progression) {
                const profile_info = this.profiles[codec]?.[profile];
                if(!profile_info) {
                    console.warn(`No profile info found for codec ${codec} and profile ${profile}`);
                    continue;
                }
                lines.push(
                    `#EXT-X-STREAM-INF:BANDWIDTH=${profile_info.bandwidth},CODECS="${profile_info.hls_codec}"`,
                    `/music/session/audio/${codec}/${profile}/playlist.m3u8`
                );
            }
        }

        return lines.join('\n');
    }

    private timestamps_of_tracks_cache: Track_Timestamp[] | null = null;
    // private last_requested_tracks_cache: Track_Timestamp[] | null = null;
    public get_timestamps_of_tracks(): Track_Timestamp[] {
        const tracks = this.timestamps_of_tracks_cache || [];
        // this.last_requested_tracks_cache = tracks;
        return tracks;
    }

    private media_sequence: number = 0;
    public create_session_playlist(codec = 'aac', profile = 'high', tracks: HLS_Bundle[], mixes: Map<string, Mix_Bundle[]> = new Map()): string {
        if (!tracks || !Array.isArray(tracks)) {
            console.error('create_session_playlist called with invalid tracks parameter:', tracks);
            tracks = [];
        }

        // Find the first non-null track to get segment duration
        const first_valid_track = tracks.find(track => track !== null);
        const target_duration = first_valid_track?.profile_data?.segment_duration || 8;

        const lines = [
            '#EXTM3U',
            '#EXT-X-VERSION:7',
            // '#EXT-X-PLAYLIST-TYPE:VOD',
            `#EXT-X-TARGETDURATION:${target_duration}`,
            `#EXT-X-MEDIA-SEQUENCE:0`
        ];

        // this.timestamps_of_tracks_cache = [];
        const updated_timestamps: Track_Timestamp[] = [];
        let total_duration = 0;

        // let program_date_time = base_date.getTime();
        let is_first_source = true;
        let prevent_future_scoping = false; // prevent loading segments ahead of buffer_controller current_index if there is a null track

        // add the silent audio at the start
        // lines.push('#EXT-X-DISCONTINUITY');
        lines.push(`#EXTINF:${this.silent_audio_duration.toFixed(6)},-1:0`);
        lines.push(this.silent_audio_segment_url);
        updated_timestamps.push({
            video_id: '#silent_audio',
            start_timestamp: 0,
            end_timestamp: this.silent_audio_duration,
            has_audio_segments: true,
        });
        total_duration += this.silent_audio_duration;
        is_first_source = false;

        for (let index = 0; index < tracks.length; index++) {
            const track = tracks[index];
            if(track == null || prevent_future_scoping) {
                updated_timestamps.push(null);
                if(index >= this.player.media_controller.buffer_controller.current_track_index) prevent_future_scoping = true;
                continue;
                // break;
            }
            // Add discontinuity tag before each new source (except the first)
            if (!is_first_source) {
                lines.push('#EXT-X-DISCONTINUITY');
            }
            is_first_source = false;

            let track_profile_data = track.profile_data?.[codec]?.[profile];
            if(!track_profile_data) {
                for(let index = this.profile_progression.length - 1; index >= 0; index--) {
                    const alternate_profile = this.profile_progression[index];
                    track_profile_data = track.profile_data?.[codec]?.[alternate_profile];
                    if(track_profile_data) break;
                }
            }
            if(!track_profile_data) {
                console.warn(`No profile data found for track ${track.video_id} with codec ${codec} and profile ${profile}. or any alternate profile: ${this.profile_progression.join(', ')}`);
                console.log('Available profile data:', track);
                updated_timestamps.push(null);
                continue;
            }

            const track_segments = track_profile_data.segments;
            let track_duration = 0;
            for (let segment_index = 0; segment_index < (track_profile_data?.segment_count || track_segments.length); segment_index++) {
                const segment: HLS_Segment = track_segments[segment_index];
                
                const segment_url = `/hls/raw/${track.video_id}/audio/${codec}/${profile}/${segment.filename}`;
                const is_last_segment = (segment_index === (track_profile_data?.segment_count || track_segments.length) - 1);
                
                // If segment has data (downloaded), create blob URL
                const title = is_last_segment ? `${index}:${segment_index}:end` : `${index}:${segment_index}`;
                if (segment?.data) {
                    // Check if we already have a blob URL for this segment
                    if (!this.segment_blob_urls.has(segment_url)) {
                        const blob_url = this.create_blob_url_for_segment(segment.data);
                        if (blob_url) {
                            this.segment_blob_urls.set(segment_url, blob_url);
                        }
                    }
                    
                    // Use blob URL if available, otherwise fall back to network URL
                    const url_to_use = this.segment_blob_urls.get(segment_url) || segment_url;
                    lines.push(`#EXTINF:${segment.duration?.toFixed(6)},${title}`);
                    lines.push(url_to_use);
                } else {
                    // No cached data, use network URL
                    lines.push(`#EXTINF:${segment.duration?.toFixed(6)},${title}`);
                    lines.push(segment_url);
                }
                
                total_duration += segment.duration;
                track_duration += segment.duration;
            }

            // Store timestamps
            // console.log('Track', track.video_id, 'duration:', track_duration, 'seconds', this.timestamps_of_tracks[index]?.has_audio_segments);
            updated_timestamps.push({
                video_id: track.video_id,
                start_timestamp: total_duration - track_duration,
                end_timestamp: total_duration,
                has_audio_segments: this.timestamps_of_tracks_cache?.[index]?.has_audio_segments || false,
            });
        }

        // add a final silent segment to skip to for silent audio
        // if (updated_timestamps?.length > 0) {
        //     const filter_nulls = updated_timestamps.filter(track => track !== null);
        //     const last_track = filter_nulls[filter_nulls.length - 1];
        //     if(last_track) {
        //         lines.push('#EXT-X-DISCONTINUITY');
        //         lines.push(`#EXTINF:${this.silent_audio_duration.toFixed(6)},`);
        //         lines.push(this.silent_audio_segment_url);
        //         updated_timestamps.push({
        //             video_id: '#silent_audio',
        //             start_timestamp: last_track.end_timestamp,
        //             end_timestamp: last_track.end_timestamp + this.silent_audio_duration,
        //             has_audio_segments: true,
        //         });
        //         total_duration += this.silent_audio_duration;
        //     }
        // }

        this.timestamps_of_tracks_cache = updated_timestamps;

        // lines.push('#EXT-X-ENDLIST');
        return lines.join('\n');
    }

    public add_bundle(bundle: HLS_Bundle): void {
        if(!bundle || !bundle.video_id) return;
        if(this.hls_bundles.has(bundle.video_id)) {
            return;
            
        }
        this.hls_bundles.set(bundle.video_id, bundle);
        // now look through song queue and see if any missing, if so emit event to update playlists with the indexes of the missing tracks now available
        const missing_tracks: number[] = [];
        for (const [index, song_key] of this.song_queue.entries()) {
            const parsed_song_key = this.media.parse_song_key(song_key);
            if (!parsed_song_key || !parsed_song_key.video_id) continue;

            if(parsed_song_key.video_id === bundle.video_id) {
                missing_tracks.push(index);
            }
        }

        this.create_session_playlist(undefined, undefined, this.get_tracks_for_session_playlist(), null);
        this.update_session_playlists();
        if (missing_tracks.length > 0) {
            this.playlist_updated.emit(missing_tracks);
        }
    }

    private _song_queue: string[] = []; // song_keys
    public get song_queue(): string[] {
        return this._song_queue;
    }
    public set song_queue(value: string[]) {
        this._song_queue = value;
        // Whenever the song queue is updated, we can also update the playlist timestamps cache
        this.get_tracks_for_session_playlist(); // This will ensure the timestamps cache is updated
        
        // Update playlists in Cache API
        this.update_session_playlists().catch(err => {
            console.error('Failed to update session playlists:', err);
        });
    }

    public is_index_loaded(index: number): boolean {
        const song_key = this.song_queue[index];
        if(!song_key) return false;

        this.get_tracks_for_session_playlist(); // This will ensure the timestamps cache is updated
        const tracks = this.tracks_for_session_playlist_cache;
        return tracks[index] !== null;
    }

    public tracks_for_session_playlist_cache: HLS_Bundle[] = [];
    private get_tracks_for_session_playlist(): HLS_Bundle[] {
        const tracks: HLS_Bundle[] = [];
        for (const song_key of this.song_queue) {
            const parsed_song_key = this.media.parse_song_key(song_key);
            if(!parsed_song_key || !parsed_song_key?.video_id) {
                tracks.push(null);
                continue;
            }

            const bundle = this.hls_bundles.get(parsed_song_key.video_id);
            if(bundle) tracks.push(bundle);
            else tracks.push(null);
        }
        this.tracks_for_session_playlist_cache = tracks;
        this.create_session_playlist(undefined, undefined, tracks, null);
        return tracks;
    }
}
