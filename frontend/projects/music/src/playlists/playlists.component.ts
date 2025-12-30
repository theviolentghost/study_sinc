import { AfterViewInit, Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MusicMediaService, Song_Data, Song_Identifier, Song_Playlist, Song_Playlist_Identifier } from '../../music.media.service';
import { PlaylistsService } from '../../playlists.service';
import { HotActionService } from '../../hot.action.service';
import { MusicPlayerService } from '../../music.player.service';
import { LoadingService } from '../../loading.service';

@Component({
  selector: 'app-playlists',
  imports: [CommonModule],
  templateUrl: './playlists.component.html',
  styleUrl: './playlists.component.css'
})
export class PlaylistsComponent implements OnInit, OnDestroy {
    // Store loaded images for each playlist
    private playlist_images_cache: Map<string, string[]> = new Map();
    private playlist_check_interval: any;
    private last_playlist_count = 0;
    
    ngOnInit(): void {
        this.loading_service.loading = false;
        
        // Initial load
        this.load_all_playlist_images();
        
        // Set up interval to check for new playlists
        this.playlist_check_interval = setInterval(() => {
            const current_count = this.default_playlist_identifiers.length + this.playlist_identifiers.length;
            if (current_count !== this.last_playlist_count) {
                this.last_playlist_count = current_count;
                this.load_all_playlist_images();
            }
        }, 500);
    }
    
    ngOnDestroy(): void {
        if (this.playlist_check_interval) {
            clearInterval(this.playlist_check_interval);
        }
    }

    constructor(private media: MusicMediaService, private playlists: PlaylistsService, private hot_action: HotActionService, private player: MusicPlayerService, private loading_service: LoadingService) {}

    get playlist_identifiers(): Song_Playlist_Identifier[] {
        return this.playlists.playlist_identifiers;
    }

    get default_playlist_identifiers(): Song_Playlist_Identifier[] {
        return this.playlists.default_playlist_identifiers;
    }

    is_current_playlist_this_playlist(playlist: Song_Playlist_Identifier): boolean {
        return this.player.playlist_identifier?.id === playlist.id;
    }

    select_playlist(playlist: Song_Playlist_Identifier): void {
        this.playlists.select_playlist(playlist);
    }

    create_playlist(): void {
        this.hot_action.open_hot_action(null, 'youtube', 'create_playlist');
    }
    import_playlist(): void {
        this.hot_action.open_hot_action(null, 'youtube', 'import_playlist');
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

    get_playlist_primary_color(playlist_identifier: Song_Playlist_Identifier): string {
        return playlist_identifier?.colors?.primary || 'var(--color-primary)';
    }

    start_dj_play(): void {

    }

    /**
     * Load images for all playlists
     */
    private async load_all_playlist_images(): Promise<void> {
        const all_playlists = [...this.default_playlist_identifiers, ...this.playlist_identifiers];
        
        // Only load images for playlists that aren't already cached
        const playlists_to_load = all_playlists.filter(playlist => !this.playlist_images_cache.has(playlist.id));
        
        if (playlists_to_load.length === 0) {
            return; // All images already loaded
        }
        
        await Promise.all(playlists_to_load.map(async (playlist) => {
            const images = await this.get_images_for_playlist(playlist);
            this.playlist_images_cache.set(playlist.id, images);
        }));
    }
    
    /**
     * Get loaded images for a playlist from cache
     */
    public get_playlist_images(playlist: Song_Playlist_Identifier): string[] {
        return this.playlist_images_cache.get(playlist.id) || [];
    }
    
    /**
     * Load images for a specific playlist
     */
    private async get_images_for_playlist(playlist: Song_Playlist_Identifier): Promise<string[]> {
        const images: string[] = [];
        
        for (let image_key of playlist?.images || []) {
            const song_key = image_key.song_key;
            const song_data = await this.media.get_song_from_indexDB(song_key);
            
            if (song_data) {
                // Priority: blob > high > low
                if (song_data.download_artwork_blob) {
                    images.push(URL.createObjectURL(song_data.download_artwork_blob));
                } else if (song_data.url?.artwork?.high) {
                    images.push(song_data.url.artwork.high);
                } else if (song_data.url?.artwork?.low) {
                    images.push(song_data.url.artwork.low);
                }
            }
        }
        
        return images;
    }
}
