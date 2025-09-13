import { Injectable, Output, EventEmitter } from '@angular/core';
import { ViewChild } from '@angular/core';

import { HotActionComponent } from './src/hot.action/hot.action.component';
import { MusicMediaService, Song_Source, Song_Data, Song_Identifier, Song_Playlist_Identifier } from './music.media.service';

@Injectable({
  providedIn: 'root'
})
export class HotActionService {
    @ViewChild('hot_action') hot_action!: HotActionComponent;
    @Output() hot_action_opened: EventEmitter<boolean> = new EventEmitter<boolean>();
    _hot_action_open: boolean = false;
    song_data: Song_Data | null = null;
    meta_song_data: Song_Data | null = null;
    action: string = 'add_to_playlist';

    get hot_action_open(): boolean {
        return this._hot_action_open;
    }

    set hot_action_open(value: boolean) {
        this._hot_action_open = value;
        this.hot_action_opened.emit(value);
    }
    

    constructor(private media: MusicMediaService) { }

    async open_hot_action(video: Song_Data | any, source: Song_Source, action:string = "add_to_playlist"): Promise<void> {
        this.hot_action_open = !this.hot_action_open;
        this.action = action;

        switch (action) {
            case "add_to_playlist": return this.do_add_to_playlist(source, video);
            case "create_playlist": return;
            case "import_playlist": return;
            default: console.error(`Unknown action: ${action}`); return;
        }
    }

    private is_song_data(obj: any): obj is Song_Data {
        return obj && 
            typeof obj === 'object' &&
            'id' in obj &&
            'song_name' in obj &&
            'original_song_name' in obj &&
            'original_artists' in obj &&
            'downloaded' in obj;
    }

    async do_add_to_playlist(source: Song_Source, video: Song_Data | any): Promise<void> {
        if(this.is_song_data(video)) {
            this.song_data = video;
            return;
        }
        switch (source) {
            case 'youtube': {
                const video_data = await this.youtube_track_data(video);
                const id = video_data?.id;
                const song_key = this.media.song_key(id);
                const stored_data = await this.media.get_song_data(song_key);
                this.song_data = stored_data ?? video_data;
                break;
            }
            case 'spotify': {
                // get bare minimum data from spotify video object
                this.meta_song_data = await this.spotify_track_data_bare(video);

                const video_data = await this.spotify_track_data(video);
                const id = video_data?.id;
                const song_key = this.media.song_key(id);
                const stored_data = await this.media.get_song_data(song_key);
                this.song_data = stored_data ?? video_data;
                break;
            }
            default:
                console.error(`Unsupported source: ${source}`);
                this.song_data = null;
                break;
        }
    }

    close_hot_action(): void {
        this.hot_action_open = false;
        this.song_data = null;
    }

    async youtube_track_data(video: any): Promise<Song_Data | null> {
        return {
            original_song_name: video.snippet?.title || '',
            original_artists: [{ id: video.snippet?.channelId || '', name: video.snippet?.channelTitle || '', source: 'youtube' }],
            song_name: video.snippet?.title || '',
            downloaded: false,
            download_audio_blob: null,
            download_artwork_blob: null,
            download_options: null,
            id: {
                video_id: video.id?.videoId || video.snippet?.videoId || '',
                source: 'youtube',
            },
            url: {
                audio: null,
                artwork: {
                    low: video.snippet.thumbnails.default?.url || null,
                    high: video.snippet.thumbnails.high?.url || null,
                },
            },
            colors: {
                primary: await this.media.get_primary_color_from_artwork(video.snippet.thumbnails.default?.url || null),
                common: await this.media.get_top_colors_from_artwork(video.snippet.thumbnails.default?.url || null, 5, 55),
            },
            liked: false,
            video_duration: 0,
        }
    }

    async youtube_track_identifier(video: any): Promise<Song_Identifier | null> {
        if (!video || !video.id || !video.id.videoId) return null;
        return {
            video_id: video.id.videoId,
            source: 'youtube',
        };
    }

    async spotify_track_data(video: any): Promise<Song_Data | null> {
        const video_uri = video.uri;
        if (!video_uri) return null;

        const video_id = await this.media.get_video_id_from_spotify_uri(video_uri);

        if( !video_id) {
            console.error(`Could not convert Spotify URI to video ID: ${video_uri}`);
            return null;
        }

            return {
                original_song_name: video.name || '',
                original_artists: video.artists.map((artist: any) => { return {name: artist.name, id: artist.id, source: 'spotify' } }) || [],
                song_name: video.name || '',
                downloaded: false,
                download_audio_blob: null,
                download_artwork_blob: null,
                download_options: null,
                id: {
                    video_id: video_id,
                    source_id: video.id || video_uri || '', 
                    source: 'spotify',
                },
                url: {
                    audio: null,
                    artwork: {
                        low: video.album?.images?.[2]?.url || null,
                        high: video.album?.images?.[0]?.url || null,
                    },
                },
                colors: {
                    primary: await this.media.get_primary_color_from_artwork(video.album?.images?.[0]?.url || null),
                    common: await this.media.get_top_colors_from_artwork(video.album?.images?.[0]?.url || null, 5, 55),
                },
                video_duration: video.duration_ms,
                liked: false,
            }
    }

    async spotify_track_data_bare(video: any): Promise<Song_Data | null> {
        const video_uri = video.uri;
        if (!video_uri) return null;

        return {
            original_song_name: video.name || '',
            original_artists: video.artists.map((artist: any) => { return {name: artist.name, id: artist.id, source: 'spotify' } }) || [],
            song_name: video.name || '',
            downloaded: false,
            download_audio_blob: null,
            download_artwork_blob: null,
            download_options: null,
            id: {
                video_id: '',
                source_id: video_uri || '', 
                source: 'spotify',
            },
            url: {
                audio: null,
                artwork: {
                    low: video.album?.images?.[2]?.url || null,
                    high: video.album?.images?.[0]?.url || null,
                },
            },
            colors: {
                primary: null,
                common: null,
            },
            video_duration: video.duration_ms,
            liked: false,
        }
    }

    async spotify_track_identifier(video: any): Promise<Song_Identifier | null> {
        if (!video || !video.id) return null;

        const video_id = await this.media.get_video_id_from_spotify_uri(video.uri);
        if (!video_id) {
            console.error(`Could not convert Spotify URI to video ID: ${video.uri}`);
            return null;
        }

        return {
            video_id: video_id,
            source_id: video.id || video.uri || '',
            source: 'spotify',
        };
    }

    async musi_track_data(video: any): Promise<Song_Data | null> {
        return {
            original_song_name: video.title || '',
            original_artists: [{ name: video.artist || '', id: '', source: 'musi' }],
            song_name: video.title || '',
            downloaded: false,
            download_audio_blob: null,
            download_artwork_blob: null,
            download_options: null,
            id: {
                video_id: video.id || '', 
                source_id: '', 
                source: 'musi',
            },
            url: {
                audio: null,
                artwork: {
                    low: null,
                    high: video.artwork_url || null,
                },
            },
            colors: {
                primary: null,
                common: null,
                // primary: await this.media.get_primary_color_from_artwork(video.artwork_url || null),
                // common: await this.media.get_top_colors_from_artwork(video.artwork_url || null),
            },
            video_duration: 0,
            liked: false,
        }
    }

    async musix_track_data(video: any): Promise<Song_Data | null> {
        let data: Song_Data | null = await this.musi_track_data(video);
        if (!data || !data?.id?.source) return null;
        data.id.source = 'musix';
        data.original_song_name = '#null';
        data.original_artists = [{ name: '#null', id: '', source: 'musix' }];
        return data;
    }
}
