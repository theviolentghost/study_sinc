import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

import { MusicMediaService, Song_Identifier, Song_Source, Song_Data } from '../../music.media.service';
import { MusicPlayerService } from '../../music.player.service';
import { HotActionService } from '../../hot.action.service';

@Component({
  selector: 'app-artists',
  imports: [CommonModule],
  templateUrl: './artists.component.html',
  styleUrl: './artists.component.css'
})
export class ArtistsComponent implements OnInit {
    followed_artists: any[] = [];
    recent_artists: any[] = [];

    ngOnInit(): void {
        this.media.artists_loaded.subscribe(() => {
            this.followed_artists = this.media.get_followed_artists();
            this.recent_artists = this.media.get_recent_artists();
        });
        // load followed and recent artists
        this.followed_artists = this.media.get_followed_artists();
        this.recent_artists = this.media.get_recent_artists();
    }

    constructor(
        private route: ActivatedRoute,
        private router: Router,
        private media: MusicMediaService,
        private player: MusicPlayerService,
        private hot_action: HotActionService
    ) { }

    source: string | null = null;
    artist_id: string | null = null;
    artist_details: any | null = null;
    artist_top_tracks: any[] = [];
    artist_albums: any[] = [];

    possible_artist_recommendations: any[] = []; // extracted from collabed playlists, albums, tracks

    following: boolean = false;
    private song_data_cache: Map<string, Song_Data | null> = new Map(); // bare_song_key -> Song_Data | null
    /*
    {
    "external_urls": {
    "spotify": "string"
    },
    "followers": {
    "href": "string",
    "total": 0
    },
    "genres": ["Prog rock", "Grunge"],
    "href": "string",
    "id": "string",
    "images": [
    {
        "url": "https://i.scdn.co/image/ab67616d00001e02ff9ca10b55ce82ae553c8228",
        "height": 300,
        "width": 300
    }
    ],
    "name": "string",
    "popularity": 0,
    "type": "artist",
    "uri": "string"
}
    */ 

    this_artist_playing: boolean = false;
    playing_icon: string = 'player-play';
    get status(): string {
        const status =  this.player.player_status;
        switch(status) {
            case 'playing':
                this.playing_icon = 'player-pause';
                break;
            case 'paused':
                this.playing_icon = 'player-play';
                break;
            case 'loading':
                this.playing_icon = 'loader';
                break;
            default:
                this.playing_icon = 'player-play';
                break;
        }
        if(!this.this_artist_playing) {
            this.playing_icon = 'player-play';
        }
        return status;
    } 

    get current_song_identifier(): Song_Identifier | null {
        return this.player.song_data ? this.player.song_data.id : null;
    }

    // constructor(private route: ActivatedRoute, private media: MusicMediaService, private player: MusicPlayerService, private hot_action: HotActionService, private router: Router) { }

    // ngOnInit(): void {
    //     this.route.params.subscribe(params => {
    //         this.artist_id = params['artist_id'] || null;
    //         this.get_artist_details();
    //         this.get_artist_top_tracks();
    //         this.get_artist_albums();
    //         this.following = this.media.is_artist_followed(this.artist_id || '');
    //         // this.this_artist_playing = false;
    //         console.log('Artist ID:', this.artist_id);
    //     });

    //     this.route.queryParams.subscribe(params => {
    //         this.source = params['source'] || null; 
    //         console.log('Source:', this.source);
    //     });

    //     // this.player.song_changed.subscribe(() => {
    //     //     const current_id = this.current_song_identifier;
    //     //     this.media.is_song_in_playlist()
    //     // });
    // }

    async get_artist_details(): Promise<void> {
        if (this.artist_id) {
            this.artist_details = await this.media.get_artist_details(this.artist_id);
            console.log('Artist Details:', this.artist_details);
        }
    }

    async get_artist_top_tracks(): Promise<void> {
        if (this.artist_id) {
            this.artist_top_tracks = await this.media.get_artist_top_tracks(this.artist_id);
            console.log('Artist Top Tracks:', this.artist_top_tracks);
        }
    }

    async get_artist_albums(): Promise<void> {
        if (this.artist_id) {
            this.artist_albums = await this.media.get_artist_albums(this.artist_id);
            console.log('Artist Albums:', this.artist_albums);
        }
    }

    play_playlist(): void {
        if (this.artist_top_tracks && this.artist_top_tracks.length > 0) {
            const random_index = Math.floor(Math.random() * this.artist_top_tracks.length);
            this.spotify_play(this.artist_top_tracks[random_index]);
            this.player.reduce_player.emit();
        }
    }

    toggle_follow(): void {
        this.following = !this.following;
        if(this.following) {
            this.media.follow_artist(this.artist_details!);
        } else {
            this.media.unfollow_artist(this.artist_id!);
        }
    }

    is_song_in_collection(video: any, source: Song_Source): boolean {
        if (!video || !source) return false;

        let identifier: Song_Identifier | null = this.get_video_identifier(video, source);
        if (!identifier) return false;

        const bare_song_key = this.media.bare_song_key(identifier);
        const in_collection: boolean = this.media.is_song_in_collection(bare_song_key, true);
        if (in_collection) this.add_to_cache(bare_song_key, video, source);
        return in_collection;
    }

    get_video_identifier(video: any, source: Song_Source): Song_Identifier | null {
        switch(source) {
            case 'youtube': return { video_id: video.snippet?.videoId || video.id?.videoId, source: 'youtube' };
            case 'spotify': return { video_id: '', source_id:  video.id  || video.uri  || '', source }
            default: return null; // Unsupported source
        }
    }

    async add_to_cache(bare_song_key: string, video: any, source: Song_Source): Promise<void> {
        if (this.song_data_cache.has(bare_song_key)) return; // Already cached
        this.song_data_cache.set(bare_song_key, null); // Initialize with null to avoid duplicate requests

        let identifier: Song_Identifier | null = null;
        switch (source) {
            case 'youtube':
                identifier = await this.hot_action.youtube_track_identifier(video);
                break;
            case 'spotify':
                identifier = await this.hot_action.spotify_track_identifier(video);
                break;
            default:
                console.error(`Unsupported source: ${source}`);
                return; // Unsupported source
        }
        if (!identifier) {
            console.error('Failed to get identifier for video:', video);
            return; 
        }

        const song_data: Song_Data | null = await this.media.get_song_from_indexDB(this.media.song_key(identifier));
        if(!song_data) {
            console.error('Failed to get song data from indexDB for identifier:', identifier);
            return; 
        }

        this.song_data_cache.set(bare_song_key, song_data);
    }

    async open_hot_action(video: any, source: Song_Source): Promise<void> {
        this.hot_action.open_hot_action(video, source);
    }

    ms_to_time(ms: number): string {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
    }

    get_bare_song_key(identifier: Song_Identifier | null | undefined): string {
        if (!identifier) return '';
        return this.media.bare_song_key(identifier);
    }

    async spotify_play(video: any): Promise<void> {
        this.this_artist_playing = true;
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
        });

        this.player.open_player.emit();

        const cache = this.song_data_cache.get(this.media.bare_song_key({source: 'spotify', source_id: video.id || video.uri || '', video_id: ''}));
        let track_data: Song_Data | null = cache || await this.hot_action.spotify_track_data(video);
        if(!track_data) return;

        // this.media.get_watch_playlist(track_data.id.video_id).then(async (playlist) => {
        //     if (playlist && playlist.songs && playlist.songs.length > 0) {
        //         await this.player.load_playlist(playlist, false, false);
        //         this.player.load_song_data_array_into_playlist_cache(playlist.song_data || []);
        //     } else {
        //         console.warn('No tracks found in the watch playlist for:', track_data?.id.video_id);
        //     }
        // }).catch((error) => {
        //     console.error('Error fetching watch playlist:', error);
        // });
        // set top tracks as the current playlist
        if(this.artist_top_tracks && this.artist_top_tracks.length > 0) {
            const top_tracks_identifiers: Song_Identifier[] = this.artist_top_tracks.map(track => ({ video_id: '', source_id: track.id || track.uri || '', source: 'spotify' }));
            const map = new Map<string, Song_Identifier | null>();

            const top_tracks_songs: Song_Data[] = await Promise.all(this.artist_top_tracks.map(track => this.hot_action.spotify_track_data(track)));
            const top_tracks_keys: string[] = top_tracks_songs.map(song => this.media.song_key(song.id));
            top_tracks_songs.forEach((song, index) => map.set(top_tracks_keys[index], top_tracks_songs[index].id));

            if(top_tracks_keys.length > 0) {
                // this.player.load_song_data_array_into_playlist_cache(top_tracks_songs);
                await this.player.load_playlist(null, {
                    songs: map,
                    name: (this.artist_details?.name || 'Unknown Artist') + ' Top Tracks',
                    song_added_timestamps: new Map(),
                    sorting_method: 'recent_to_old'
                }, false, false);
                console.log('Loaded top tracks playlist:', top_tracks_songs);
            }
        }

        await this.player.load_and_play_track(track_data);
        if(!cache) {
            track_data = await this.media.get_song_from_indexDB(this.media.song_key(track_data.id)); // Ensure player has the latest song data
            if(!track_data) return;
            this.player.song_data = track_data; 
            this.media.save_song_to_indexDB(this.media.song_key(track_data.id), track_data);
        }
    }

    format_followers(followers: number | undefined): string {
        if (typeof followers !== 'number') return '';
        // Format number with commas as thousand separators
        return followers.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }

    open_artist(artist_id: string): void {
        // this.router.navigate(['/artist', artist_id], { queryParams: { source: 'spotify' } });
        this.artist_id = artist_id;
        this.get_artist_details();
        this.get_artist_top_tracks();
        this.get_artist_albums();
        this.following = this.media.is_artist_followed(this.artist_id || '');
    }
    open_album(album_id: string): void {
        this.router.navigate(['/album', album_id], { queryParams: { source: 'spotify' } });
    }
    parse_year(date_str: string | undefined): string {
        if(!date_str) return '';
        const date = new Date(date_str);
        if(isNaN(date.getTime())) {
            // If date is invalid, try to extract year directly from string
            const year_match = date_str.match(/\d{4}/);
            return year_match ? year_match[0] : '';
        }
        return date.getFullYear().toString();
    }


}
