import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

import { MusicPlayerService } from '../../music.player.service';
import { MusicMediaService, Song_Source, Song_Identifier, Song_Data, Song_Playlist_Identifier, Song_Playlist } from '../../music.media.service';
import { HotActionService } from '../../hot.action.service';
import { PlaylistsService } from '../../playlists.service';

@Component({
  selector: 'app-album',
  imports: [CommonModule],
  templateUrl: './album.component.html',
  styleUrl: './album.component.css'
})
export class AlbumComponent implements OnInit {
    private album_id: string = '';
    private source: string | null = null;
    public auto_play: boolean = false;
    public album_details: any = null;
    public primary_color: string = 'var(--color-primary)';

    song_data_cache: Map<string, Song_Data | null> = new Map(); // bare_song_key to Song_Data mapping for quick playback

    get is_current_playlist_playing(): boolean {
        // Check if the current playlist is loaded in the player and is playing
        return this.player.playlist_identifier?.id === this.playlists.selected_playlist_identifier?.id &&
               this.player.player_status === 'playing';
    }

    get playing_icon(): string {
        return this.is_current_playlist_playing ? 'player-pause' : 'player-play';
    }

    get current_song_identifier(): Song_Identifier | null {
        return this.player.current ? this.player.current.id : null;
    }

    ngOnInit(): void {
        this.route.params.subscribe(params => {
            this.album_id = params['album_id'] || null;
        });

        this.route.queryParams.subscribe(params => {
            this.source = params['source'] || null; 
            this.auto_play = params['autoplay'] === 'true';
        });

        this.load_album_details();
    }

    constructor(private media: MusicMediaService, private hot_action: HotActionService, private player: MusicPlayerService, private route: ActivatedRoute, private router: Router, private playlists: PlaylistsService) { }

    public open_artist(artist_id: string) {

    }

    public async play_album(): Promise<void> {
        if(!this.playlists.selected_playlist) return;
        if(this.playlists.selected_playlist.songs.size === 0) return;

        // Check if this playlist is already loaded and playing/paused
        if (this.player.playlist_identifier?.id === this.playlists.selected_playlist_identifier?.id) {
            // Same playlist is loaded, toggle play/pause
            if (this.player.player_status === 'playing') {
                this.player.pause();
            } else {
                this.player.play();
            }
        } else {
            // Different playlist or no playlist loaded, load and play
            this.player.open_player.emit();
            await this.player.load_playlist(this.playlists.selected_playlist_identifier, this.playlists.selected_playlist, false, true);
            this.player.playlist_changed.emit();
            // this.player.play();
        }
    }

    public async load_album_primary_color(): Promise<void> {
        this.primary_color = await this.media.get_primary_color_from_artwork(this.album_details?.images[0]?.url || '', 0.5);
    }

    private async load_album_details(): Promise<void> {
        if (!this.album_id || !this.source) return;
        switch(this.source) {
            case 'spotify':
                this.album_details = await this.media.spotify_get_album(this.album_id);
                await this.load_album_primary_color();
                break;
            case 'youtube':
                // Handle YouTube album fetching 
                break;
            default:
                console.error(`Unsupported source: ${this.source}`);
        }

        const playlist = this.generate_album_playlist();
        const playlist_identifier = this.generate_album_playlist_identifier();
        console.log('Generated playlist and identifier:', playlist, playlist_identifier);
        if(playlist && playlist_identifier) {
            await this.playlists.load_playlist(playlist_identifier, playlist);
        }
        if(this.auto_play) {
            this.auto_play = false; // reset to avoid loops
            this.play_album();
        }
    }

    public parse_year(date_str: string | undefined): string {
        if(!date_str) return '';
        const date = new Date(date_str);
        if(isNaN(date.getTime())) {
            // If date is invalid, try to extract year directly from string
            const year_match = date_str.match(/\d{4}/);
            return year_match ? year_match[0] : '';
        }
        return date.getFullYear().toString();
    }

    public async spotify_play(video: any) {
        this.player.song_changed.emit(); 
        this.player.update_media_session({
            original_song_name: video.name || '',
            original_artists: video.artists.map((artist: any) => ({ name: artist.name, id: artist.id, source: 'spotify' })) || [],
            song_name: video.name || '',
            downloaded: false,
            download_audio_blob: null,
            download_artwork_blob: null,
            download_options: null,
            id: {
                video_id: '', // null, faster loading
                source_id: '', // Use video.id or video.uri for Spotify
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
            explicit: video.explicit || false,
        });

        this.player.pause();
        this.player.open_player.emit();

        const cache = this.song_data_cache.get(this.media.bare_song_key({source: 'spotify', source_id: video.id || video.uri || '', video_id: ''}));
        let track_data: Song_Data | null = cache || await this.hot_action.spotify_track_data(video);
        if(!track_data) return;

        this.player.add_song_to_cache(track_data);

        // this.media.get_watch_playlist(track_data.id.video_id).then(async (playlist) => {
        //     if (playlist && playlist.songs && playlist.songs.length > 0) {
        //         // convert the array of songs to a map of song_key to song_identifier
        //         const song_map = new Map<string, Song_Identifier>();
        //         playlist.song_data.forEach((song) => {
        //             song_map.set(this.media.bare_song_key(song.id), song.id);
        //         });
        //         playlist.songs = song_map;

        //         playlist.song_data.map((song) => {
        //             this.player.add_song_to_cache(song);
        //         });

        //         await this.player.load_playlist(null, playlist, false);
        //     } else {
        //         console.warn('No tracks found in the watch playlist for:', track_data?.id.video_id);
        //     }
        // }).catch((error) => {
        //     console.error('Error fetching watch playlist:', error);
        // });

        await this.player.load_and_play_track(track_data);
        if(!cache) {
            track_data = await this.media.get_song_from_indexDB(this.media.song_key(track_data.id)); // Ensure player has the latest song data
            if(!track_data) return;
            this.player.set_current_song(track_data);
            this.media.save_song_to_indexDB(this.media.song_key(track_data.id), track_data);
        }
    }

    public async youtube_play(video: any) {

    }

    public is_song_in_collection(video: any, source: Song_Source): boolean {
        if (!video || !source) return false;

        let identifier: Song_Identifier | null = this.get_video_identifier(video, source);
        if (!identifier) return false;

        const bare_song_key = this.media.bare_song_key(identifier);
        const in_collection: boolean = this.media.is_song_in_collection(bare_song_key, true);
        // if (in_collection) this.add_to_cache(bare_song_key, video, source);
        return in_collection;
    }

    public get_video_identifier(video: any, source: Song_Source): Song_Identifier | null {
        switch(source) {
            case 'youtube': return { video_id: video.snippet?.videoId || video.id?.videoId, source: 'youtube' };
            case 'spotify': return { video_id: '', source_id:  video.id  || video.uri  || '', source }
            default: return null; // Unsupported source
        }
    }

    public async open_hot_action(video: any, source: Song_Source): Promise<void> {
        this.hot_action.open_hot_action(video, source);
    }

    public ms_to_time(ms: number, format: string = 'concise'): string {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        switch(format) {
            case 'concise':
                if (hours > 0) {
                    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                } else {
                    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
                }
            case 'verbose':
                const parts = [];
                if (hours > 0) parts.push(`${hours} hr`);
                if (minutes > 0) parts.push(`${minutes} min`);
                if (seconds > 0 || parts.length === 0) parts.push(`${seconds} sec`);
                return parts.join(' ');
            default:
                return '';
        }
    }

    public get_bare_song_key(identifier: Song_Identifier | null | undefined): string {
        if (!identifier) return '';
        return this.media.bare_song_key(identifier);
    }

    public get_album_duration(tracks: any[]): string {
        const total_duration = tracks?.reduce((acc, track) => acc + (track.duration_ms || 0), 0) || 0;
        return this.ms_to_time(total_duration, 'verbose');
    }

    // public async add_to_cache(bare_song_key: string, video: any, source: Song_Source): Promise<void> {
    //     if (this.song_data_cache.has(bare_song_key)) return; // Already cached
    //     this.song_data_cache.set(bare_song_key, null); // Initialize with null to avoid duplicate requests

    //     let identifier: Song_Identifier | null = null;
    //     switch (source) {
    //         case 'youtube':
    //             identifier = await this.hot_action.youtube_track_identifier(video);
    //             break;
    //         case 'spotify':
    //             identifier = await this.hot_action.spotify_track_identifier(video);
    //             break;
    //         default:
    //             console.error(`Unsupported source: ${source}`);
    //             return; // Unsupported source
    //     }
    //     if (!identifier) {
    //         console.error('Failed to get identifier for video:', video);
    //         return; 
    //     }

    //     const song_data: Song_Data | null = await this.media.get_song_from_indexDB(this.media.song_key(identifier));
    //     if(!song_data) {
    //         console.error('Failed to get song data from indexDB for identifier:', identifier);
    //         return; 
    //     }

    //     this.song_data_cache.set(bare_song_key, song_data);
    // }

    public generate_album_playlist_identifier(): Song_Playlist_Identifier | null {
        if (!this.album_details) return null;
        return {
            id: `album_${this.album_details.id}`,
            name: this.album_details.name || 'Unknown Album',
            track_count: this.album_details.total_tracks || 0,
            // duration: 0,
            default: false,
            images: [this.album_details?.images[0]?.url || ''],
            colors: {
                primary: this.primary_color,
            },
            playlist_type: 'album',
            created_by: this.album_details.artists?.map((artist: any) => artist.name).join(', ') || 'Unknown Artist',
            created_at: this.album_details?.release_date,
        };
    }

    public generate_album_playlist(): Song_Playlist | null {
        if (!this.album_details) return null;
        const song_map = new Map<string, Song_Identifier>();
        this.album_details.tracks?.items?.forEach((track: any) => {
            const identifier: Song_Identifier | null = this.get_video_identifier(track, this.source as Song_Source);
            if (identifier) {
                const bare_song_key = this.media.bare_song_key(identifier);
                song_map.set(bare_song_key, identifier);

                // save in storage for quick playback later
                let song_data: Song_Data = this.hot_action.spotify_track_data_bare(track);
                song_data.url.artwork.high = this.album_details?.images[0]?.url || null;
                song_data.colors.primary = this.primary_color;
                song_data.colors.common = [this.primary_color, 'var(--color-background)'];
                this.media.save_song_to_indexDB(this.media.song_key(identifier), song_data);
            }
        });

        const song_added_timestamps: Map<string, number> = new Map();
        const current_timestamp = Date.now();
        let index = 0;
        song_map.forEach((_, bare_song_key) => {
            song_added_timestamps.set(bare_song_key, current_timestamp - index);
            index++;
        });
        return {
            songs: song_map,
            song_added_timestamps: song_added_timestamps,
            sorting_method: 'recent_to_old',
            name: this.album_details.name || 'Unknown Album',
            default: false,
        };
    }

    public playlist_saved_into_library(): boolean {
        const identifier = this.generate_album_playlist_identifier();
        if(!identifier) return false;
        return this.playlists.playlist_exists(identifier);
    }

    public get saved_into_library(): boolean {
        return this.playlist_saved_into_library();
    }

    public add_to_library(): void {
        // check if specific playlist for this album exists
        if(this.playlist_saved_into_library()) {
            // already in library, remove it
            const identifier = this.generate_album_playlist_identifier();
            if(identifier) {
                this.playlists.delete_playlist(identifier);
            }
        } else {
            const identifier = this.generate_album_playlist_identifier();
            const playlist = this.generate_album_playlist();
            if(identifier && playlist) {
                this.playlists.add_playlist(identifier, playlist);
            }
        }
    }
}
