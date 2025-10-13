import { Injectable } from '@angular/core';

import { MusicMediaService } from './music.media.service';

@Injectable({
  providedIn: 'root'
})
export class GlobalInfoService {
    public top_releases: any[] = [];
    public mood_genres: any[] = [];

    constructor(private media: MusicMediaService) { }

    public async load_global_info(): Promise<void> {
        await Promise.all([
            this.load_top_releases(),
            this.load_mood_genres(),
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
}
