import { Injectable, Output, EventEmitter } from '@angular/core';
import { Observable, of } from 'rxjs';

import { ServiceWorkerMessageDistributorService } from '../src/service.worker.message.distributor';
import { MusicMediaService } from '../music.media.service';

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

    public profiles = {
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

    public codecs = [/*'opus'*/'aac']; // Supported codecs
    public profile_progression = ['ultra-low', 'low', 'medium', 'high', 'ultra-high']; // Order of profiles for adaptive streaming

    private hls_bundles = new Map<string, HLS_Bundle>();
    private silent_audio_url: string = '/music/audio/silent/audio/master.m3u8';
    private silent_audio_segment_url: string = '/music/audio/silent/audio/aac/ultra-low/32k_60.ts';
    private silent_audio_duration: number = 60.0523; // duration in seconds

    constructor(private service_worker_message_distributor: ServiceWorkerMessageDistributorService, private media: MusicMediaService) { 
        this.initialize();
    }

    public initialize(): void {
        this.service_worker_message_distributor.session_request.subscribe((url: string) => {
            this.service_worker_message_distributor.post_message('SESSION_RESPONSE', { data: this.handle_request(url), url });
        });
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

        // add the silent audio at the start
        // lines.push('#EXT-X-DISCONTINUITY');
        lines.push(`#EXTINF:${this.silent_audio_duration.toFixed(6)},`);
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
            // console.log('Processing track at index', index, ':', track);
            if(track == null) {
                updated_timestamps.push(null);
                continue;
                // break;
            }
            // Add discontinuity tag before each new source (except the first)
            if (!is_first_source) {
                lines.push('#EXT-X-DISCONTINUITY');
            }
            is_first_source = false;

            const track_profile_data = track.profile_data?.[codec]?.[profile];
            if(!track_profile_data) {
                console.warn(`No profile data found for track ${track.video_id} with codec ${codec} and profile ${profile}`);
                updated_timestamps.push(null);
                continue;
            }

            const track_segments = track_profile_data.segments;
            let track_duration = 0;
            for (let segment_index = 0; segment_index < (track_profile_data?.segment_count || track_segments.length); segment_index++) {
                const segment = track_segments[segment_index];
                lines.push(`#EXTINF:${segment.duration.toFixed(6)},`);
                lines.push(`/hls/raw/${track.video_id}/audio/${codec}/${profile}/${segment.filename}`);
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
        if(this.hls_bundles.has(bundle.video_id)) return;
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
    }

    private get_tracks_for_session_playlist(): HLS_Bundle[] {
        const tracks: HLS_Bundle[] = [];
        for (const song_key of this.song_queue) {
            const parsed_song_key = this.media.parse_song_key(song_key);
            if(!parsed_song_key || !parsed_song_key?.video_id) break;

            const bundle = this.hls_bundles.get(parsed_song_key.video_id);
            if(bundle) tracks.push(bundle);
            else tracks.push(null);
        }
        this.create_session_playlist(undefined, undefined, tracks, null);
        return tracks;
    }
}
