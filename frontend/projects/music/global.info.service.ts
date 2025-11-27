import { Injectable } from '@angular/core';
import { take } from 'rxjs/operators';

import { MusicMediaService } from './music.media.service';

@Injectable({
  providedIn: 'root'
})
export class GlobalInfoService {
    public top_releases: any[] = [];
    public mood_genres: any[] = [];
    public followed_artists: any[] = [];
    public new_releases_by_followed_artists: any = {};

    constructor(private media: MusicMediaService) { }

    public async load_global_info(): Promise<void> {
        await Promise.all([
            this.load_top_releases(),
            this.load_mood_genres(),
            this.load_followed_artists(),
        ]);
    }

    public async load_top_releases(): Promise<any> {
        this.top_releases = await this.media.get_top_releases();
        console.log('Top releases loaded:', this.top_releases);
    }

    public async load_mood_genres(): Promise<any> {
        this.mood_genres = await this.media.get_mood_categories();
        console.log('Mood genres loaded:', this.mood_genres);
    }

    public load_followed_artists(): void {
        this.media.artists_loaded.pipe(take(1)).subscribe(() => {
            this.followed_artists = this.media.get_followed_artists();
            this.load_new_releases_by_followed_artists();
        });
    }

    public async load_new_releases_by_followed_artists(): Promise<any> {
        if (this.followed_artists.length === 0) {
            console.log('No followed artists found');
            return;
        }
        const artist_ids = this.followed_artists.map((a: any) => a.id);
        this.new_releases_by_followed_artists = await this.media.get_new_releases_by_artists(artist_ids);
        console.log('New releases by followed artists loaded:', this.new_releases_by_followed_artists);
        console.log('Artist IDs:', this.followed_artists);
    }

    public get_followed_artist_by_id(artist_id: string): any {
        return this.followed_artists.find((artist: any) => artist.id === artist_id);
    }
}
