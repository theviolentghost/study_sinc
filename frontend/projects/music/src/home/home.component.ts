import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GlobalInfoService } from '../../global.info.service';
import { ScrollSnapActiveDirective } from './scroll-snap-active.directive';
import { MusicMediaService } from '../../music.media.service';
import { Router } from '@angular/router';

@Component({
  selector: 'search-home',
  imports: [CommonModule, ScrollSnapActiveDirective],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HomeComponent {
    private _categories: any[] | null = null;
    private _lastDataHash: string = '';

    public get categories(): any[] {
        // Create a simple hash of the data to detect changes
        const new_releases_obj = this.global.new_releases_by_followed_artists || {};
        const dataHash = `${this.global.top_releases?.length || 0}_${Object.keys(new_releases_obj).length}`;
        
        // Only recalculate if data has changed
        if (this._categories === null || this._lastDataHash !== dataHash) {
            this._lastDataHash = dataHash;
            
            const top_releases = this.global?.top_releases || [];
            const first_release = top_releases[0];
            const first_artist = first_release?.artists?.[0];
            
            const potential_categories = [
                // ...(top_releases.length > 0 ? [{
                //     type: 'album',
                //     artist: first_artist || null,
                //     artist_tab: first_artist?.name || 'Top Releases',
                //     header: 'Top Releases',
                //     items: top_releases.slice(0, 10).map(release => {
                //         const images = release?.images || [];
                //         const first_image = images[0];
                //         return {
                //             title: release?.name || 'Unknown',
                //             cover: first_image?.url || '',
                //             total_tracks: release?.total_tracks || 0,
                //             album_id: release?.id || '',
                //         };
                //     })
                // }] : []),
                // {
                //     type: 'carousel',
                //     header: "Made for You",
                //     items: null,
                // },
                ...Object.keys(new_releases_obj).map((artist_id: any) => ({
                    type: 'album',
                    artist: this.global.get_followed_artist_by_id(artist_id) || null,
                    header: `${this.global.get_followed_artist_by_id(artist_id)?.name || artist_id}`,
                    artist_tab: 'New Releases',
                    total_tracks: (new_releases_obj[artist_id] || []).reduce((sum: number, release: any) => sum + (release?.total_tracks || 0), 0),
                    items: (new_releases_obj[artist_id] || []).map((release: any) => ({
                        title: release?.name || 'Unknown',
                        cover: release?.image_url || '',
                        total_tracks: release?.total_tracks || 0,
                        album_id: release?.id || '',
                    }))
                })),
            ];
            
            this._categories = potential_categories.filter(category => category && category?.items && category?.items?.length > 0);
        }
        
        return this._categories;
    }

    get playlist_play_pause_icon(): string {
        // return this.is_current_playlist_playing ? 'player-pause' : 'player-play';
        return 'player-play';
    }

    constructor(
        private global: GlobalInfoService, 
        private media: MusicMediaService, 
        private router: Router,
        private cdr: ChangeDetectorRef
    ) {}

    public get_greeting(): string {
        const hours = new Date().getHours();
        if (hours < 12) {
            return 'Good Morning';
        } else if (hours < 18) {
            return 'Good Afternoon';
        } else {
            return 'Good Evening';
        }
    }

    private primary_colors: Map<string, string> = new Map(); // source to primary color mapping
    private color_loading: Set<string> = new Set(); // Track which colors are currently loading
    
    public get_album_primary_color(source: string): string {
        if (this.primary_colors.has(source)) {
            return this.primary_colors.get(source)!;
        }
        
        // Only start loading if not already loading
        if (!this.color_loading.has(source)) {
            this.load_album_primary_color(source);
        }
        
        // Return a neutral color while loading
        return 'rgba(255, 255, 255, 0.1)';
    }

    private async load_album_primary_color(source: string): Promise<void> {
        if (this.color_loading.has(source)) return;
        
        this.color_loading.add(source);
        try {
            const color = await this.media.get_primary_color_from_artwork(source);
            this.primary_colors.set(source, color);
            // Manually trigger change detection only when color is loaded
            this.cdr.markForCheck();
        } catch (error) {
            console.error('Error loading album color:', error);
            this.primary_colors.set(source, 'rgba(255, 255, 255, 0.1)');
        } finally {
            this.color_loading.delete(source);
        }
    }

    public play_album(album_id: string): void {
        // redirect to album page with autoplay flag
        this.router.navigate(['/album', album_id], { queryParams: { autoplay: true, source: 'spotify' } });
    }

    public play_artist(artist: any): void {
        // redirect to artist page with autoplay flag
        this.router.navigate(['/artist', artist.id], { queryParams: { autoplay: true, source: 'spotify' } });
    }
}
