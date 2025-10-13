import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

import { MusicPlayerService } from '../../music.player.service';
import { MusicMediaService, Song_Source, Song_Identifier } from '../../music.media.service';
import { HotActionService } from '../../hot.action.service';

@Component({
  selector: 'app-album',
  imports: [CommonModule],
  templateUrl: './album.component.html',
  styleUrl: './album.component.css'
})
export class AlbumComponent implements OnInit {
    private album_id: string = '';
    private source: string | null = null;
    public album_details: any = null;
    public primary_color: string = 'var(--color-background)';

    get playing_icon() {
        return 'player-play'; 
    }

    get current_song_identifier(): Song_Identifier | null {
        return this.player.song_data ? this.player.song_data.id : null;
    }

    ngOnInit(): void {
        this.route.params.subscribe(params => {
            this.album_id = params['album_id'] || null;
            console.log('Album ID:', this.album_id);
        });

        this.route.queryParams.subscribe(params => {
            this.source = params['source'] || null; 
            console.log('Source:', this.source);
        });

        this.load_album_details();
    }

    constructor(private media: MusicMediaService, private hot_action: HotActionService, private player: MusicPlayerService, private route: ActivatedRoute, private router: Router) { }

    public open_artist(artist_id: string) {

    }

    public async load_album_primary_color(): Promise<void> {
        this.primary_color = await this.media.get_primary_color_from_artwork(this.album_details?.images[0]?.url || '');
    }

    private async load_album_details(): Promise<void> {
        if (!this.album_id || !this.source) return;
        switch(this.source) {
            case 'spotify':
                this.album_details = await this.media.spotify_get_album(this.album_id);
                this.load_album_primary_color();
                break;
            case 'youtube':
                // Handle YouTube album fetching if applicable
                break;
            default:
                console.error(`Unsupported source: ${this.source}`);
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

    public spotify_play(item: any) {

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
        const totalDuration = tracks.reduce((acc, track) => acc + (track.duration_ms || 0), 0);
        return this.ms_to_time(totalDuration, 'verbose');
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
}
