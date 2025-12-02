import { Component, ViewChild, ElementRef, AfterViewInit, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

import { MusicMediaService, Song_Data, Song_Identifier, Song_Search_Result, Song_Source} from '../../music.media.service';
import { MusicPlayerService } from '../../music.player.service';
import { HotActionService } from '../../hot.action.service';
import { GlobalInfoService } from '../../global.info.service';
import { InViewDirective } from './in-view.directive';
import { LoadingService } from '../app/services/loading.service';

@Component({
  selector: 'media-search',
  imports: [FormsModule, CommonModule, InViewDirective],
  templateUrl: './search.component.html',
  styleUrl: './search.component.css'
})
export class SearchComponent implements AfterViewInit, OnInit, OnDestroy {
    ngOnInit(): void {
        this.load_search_history();
        // Preload colors for first few visible albums after a short delay
        setTimeout(() => {
            this.preload_visible_album_colors();
        }, 100);
        this.loading_service.loading = true;
    }
    
    ngOnDestroy(): void {
        if (this.update_viewing_timer) {
            clearTimeout(this.update_viewing_timer);
        }
        if (this.debounce_input_timeout) {
            clearTimeout(this.debounce_input_timeout);
        }
    }
    @ViewChild('searchInput', { static: false }) searchInput!: ElementRef<HTMLInputElement>;

    album_viewing_states: boolean[] = [ 
        true, false, false, false, false,
        false, false, false, false, false,
        false, false, false, false, false,
        false, false, false, false, false,
        false, false, false, false, false,
        false, false, false, false, false,
        false, false, false, false, false,
        false, false, false, false, false,
        false, false, false, false, false,
        false, false, false, false, false,
    ]; // Track which albums are in view
    viewing_album_index: number = 0; // Track the single album that should be viewing
    album_distances: Map<number, number> = new Map(); // Track distance from center for each album
    update_viewing_timer?: any;

    search_source: Song_Source = 'spotify'; // default search source
    search_query: string = '';
    searched: boolean = false; // whether the user has performed a search
    search_history: Map<string, any> = new Map(); //list of previous queries to their results
    max_history: number = 5; // maximum number of previous searches to store
    search_results: Song_Search_Result = {
        artists: { total: 0, results: [] },
        videos: { total: 0, results: [] }
    };
    catalog: any[] = [];
    song_data_cache: Map<string, Song_Data | null> = new Map(); // bare_song_key to Song_Data mapping for quick playback
    search_recommendations: any[] = []; 

    source_dropdown_open: boolean = false;
    source_dropdown_options: {source: Song_Source, color: string}[] = [{source: 'spotify', color: "#1cd760"}, {source: 'youtube', color: "#ff0033"}];

    // mood_categories: {params: string, title: string}[] = [];
    // mood_playlists: any[] = [];

    toggle_source_dropdown(): void {
        this.source_dropdown_open = !this.source_dropdown_open;
    }
    select_source(source: Song_Source): void {
        this.source_dropdown_open = false;
        if(this.search_source === source) return;
        this.search_source = source;
        this.search_results = {};
    }
    store_search_history(): void {
        const history = Array.from(this.search_history.entries()).slice(-this.max_history); // keep last 5 searches
        localStorage.setItem('search_history', JSON.stringify(history));
    }
    get search_history_length(): number {
        return this.search_history.size;
    }
    load_search_history(): void {
        const history = localStorage.getItem('search_history');
        if(history) {
            const log = JSON.parse(history);
            // convert back to Map
            this.search_history = new Map(log);
            // console.log("Search history loaded:", this.search_history);
                // load most recent search
            const lastEntry = Array.from(this.search_history.entries()).pop();
            // console.log("Most recent search entry:", lastEntry);
            if (lastEntry) {
                this.search_query = lastEntry[0];
                this.search_results = lastEntry[1];
                this.set_catalog();
                this.searched = true;
                // remove most recent entry
                // this.search_history.delete(this.search_query);
            }
        }
    }

    get artist_results(): any[] {
        const artists = this.search_results?.artists;
        if (!artists) return [];
        // Spotify-style
        if ('items' in artists) return artists.items;
        // YouTube-style
        if ('results' in artists) return artists.results;
        return [];
    }

    debounce_input_timeout: any = null;
    debounce_input_time: number = 400; 
    on_search_input_change(): void {
        if (this.debounce_input_timeout) {
            clearTimeout(this.debounce_input_timeout);
        }
        this.debounce_input_timeout = setTimeout(() => {
            this.get_search_recommendations(this.search_query);
        }, this.debounce_input_time);
    }

    async get_search_recommendations(query: string): Promise<void> {
        if (query.trim() === '') {
            this.search_recommendations = [];
            return;
        }
        try {
            const recommendations = await this.media.get_search_recommendations(query);
            console.log('Search recommendations:', recommendations);
            this.search_recommendations = recommendations;
        } catch (error) {
            console.error('Error fetching search recommendations:', error);
            this.search_recommendations = [];
        }
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

    constructor(private media: MusicMediaService, private player: MusicPlayerService, private hot_action: HotActionService, private router: Router, private global: GlobalInfoService, private loading_service: LoadingService) {}

    ngAfterViewInit(): void {
        // Auto-focus the search input when component loads
        if (this.searchInput) {
            this.searchInput.nativeElement.focus();
        }
        this.loading_service.loading = false;
        
        // clear local storage search history
        // localStorage.removeItem('search_history');
        // this.media.get_mood_categories().then(categories => {
        //     this.mood_categories = categories;
        //     console.log('Mood categories:', this.mood_categories);
        // }).catch(error => {
        //     console.error('Error fetching mood categories:', error);
        // });
    }

    clear_input(): void {
        this.search_query = '';
        this.search_recommendations = [];
        // Keep focus on input after clearing
        if (this.searchInput) {
            this.searchInput.nativeElement.focus();
        }
    }

    left_quick_action_click(): void {
        if(this.search_history.size === 0) {
            // Perform search action
            this.search(this.search_query);
        }
        else {
            // Go back to previous search
            if (this.search_history.size > 0) {
                const list = Array.from(this.search_history.keys());
                const current_entry = list.pop();
                this.search_query = list.pop() || '';
                this.search_results = this.search_history.get(this.search_query) || {};
                // remove most recent entry
                this.search_history.delete(current_entry);
                this.set_catalog();
                this.searched = true;   
                this.store_search_history();
            }
        }
    }

    searching: boolean = false;
    async search(query: string = this.search_query): Promise<void> {
        if (query.trim() === '') return;

        this.search_query = query.trim();
        this.search_recommendations = []; // Clear recommendations on new search
        // get rid of search focus
        if (this.searchInput) {
            this.searchInput.nativeElement.blur();
        }
        console.log(`Searching for: ${query}:`, this.search_source);

        this.song_data_cache.clear();
        this.searching = true;
        this.search_results = await this.media.search(query, this.search_source);
        this.searching = false;
        this.set_catalog();
        this.searched = true; 
        console.log('Search results:', this.search_results);

        this.search_history.set(query, this.search_results);
        this.store_search_history();
    }

    async youtube_play(video: any): Promise<void> {
        this.player.song_changed.emit();
        const cache = this.song_data_cache.get(this.media.bare_song_key({source: 'youtube', video_id: video.snippet?.videoId || video.id?.videoId}));
        let track_data: Song_Data | null = cache || await this.hot_action.youtube_track_data(video);
        if(!track_data) return;

        this.player.open_player.emit();

        this.player.add_song_to_cache(track_data);
        this.player.update_media_session(track_data);

        this.media.get_watch_playlist(track_data.id.video_id).then(async (playlist) => {
            if (playlist && playlist.songs && playlist.songs.length > 0) {
                // convert the array of songs to a map of song_key to song_identifier
                const song_map = new Map<string, Song_Identifier>();
                playlist.song_data.forEach((song) => {
                    song_map.set(this.media.bare_song_key(song.id), song.id);
                });
                playlist.songs = song_map;

                playlist.song_data.map((song) => {
                    this.player.add_song_to_cache(song);
                });

                await this.player.load_playlist(null, playlist, false);
            } else {
                console.warn('No tracks found in the watch playlist for:', track_data?.id.video_id);
            }
        }).catch((error) => {
            console.error('Error fetching watch playlist:', error);
        });

        await this.player.load_and_play_track(track_data);
        if(!cache) {
            track_data = await this.media.get_song_from_indexDB(this.media.song_key(track_data.id)); // Ensure player has the latest song data
            if(!track_data) return;
            this.player.set_current_song(track_data);
            this.media.save_song_to_indexDB(this.media.song_key(track_data.id), track_data);
        }
    }

    async spotify_play(video: any): Promise<void> {
        this.player.song_changed.emit(); 
        this.player.update_media_session({
            original_song_name: video.name || '',
            original_artists: video.artists.map((artist: any) => ({ name: artist.name, id: artist.id, source: 'spotify' })) || [],
            song_name: video.name || '',
            artists: video.artists.map((artist: any) => ({ name: artist.name, id: artist.id, source: 'spotify' })) || [],
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

        this.media.get_watch_playlist(track_data.id.video_id).then(async (playlist) => {
            if (playlist && playlist.songs && playlist.songs.length > 0) {
                // convert the array of songs to a map of song_key to song_identifier
                const song_map = new Map<string, Song_Identifier>();
                playlist.song_data.forEach((song) => {
                    song_map.set(this.media.bare_song_key(song.id), song.id);
                });
                playlist.songs = song_map;

                playlist.song_data.map((song) => {
                    this.player.add_song_to_cache(song);
                });

                await this.player.load_playlist(null, playlist, false);
            } else {
                console.warn('No tracks found in the watch playlist for:', track_data?.id.video_id);
            }
        }).catch((error) => {
            console.error('Error fetching watch playlist:', error);
        });

        await this.player.load_and_play_track(track_data);
        if(!cache) {
            track_data = await this.media.get_song_from_indexDB(this.media.song_key(track_data.id)); // Ensure player has the latest song data
            if(!track_data) return;
            this.player.set_current_song(track_data);
            this.media.save_song_to_indexDB(this.media.song_key(track_data.id), track_data);
        }
    }

    async open_hot_action(video: any, source: Song_Source): Promise<void> {
        this.hot_action.open_hot_action(video, source);
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

    get_song_data_in_collection(video: any, source: Song_Source): Song_Data | null {
        if (!video || !source) return null;
        let identifier: Song_Identifier | null = this.get_video_identifier(video, source);
        if (!identifier) return null;
        const bare_song_key = this.media.bare_song_key(identifier);
        if (this.song_data_cache.has(bare_song_key)) {
            return this.song_data_cache.get(bare_song_key) || null; // Return cached song data or null if not found
        }
        return null; // Not cached
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

    get current_song_identifier(): Song_Identifier | null {
        return this.player.current ? this.player.current.id : null;
    }

    get_bare_song_key(identifier: Song_Identifier | null | undefined): string {
        if (!identifier) return '';
        return this.media.bare_song_key(identifier);
    }

    source_options: Map<Song_Source, string> = new Map([
        ['spotify', "#1cd760"],
        ['youtube', "#ff0033"],
        ['musi', "#ff8843"],
        ['musix', "#ff8843"],
    ]);

    get_search_primary_color(): string {
        // const source_color = this.source_options.get(this.search_source);
        const source_color = "";
        return source_color || 'var(--color-primary)'; // Default color if not found
    }

    format_followrs(num: number | undefined): string {
        if (num === undefined || num === null) return '';
        if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (num >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
        return num.toString();
    }

    is_following_artist(artist_id: string | undefined): boolean {
        if (!artist_id) return false;
        return this.media.is_artist_followed(artist_id);
    }

    async toggle_follow_artist(artist: any): Promise<void> {
        if (!artist || !artist.id) return;
        const is_following = this.media.is_artist_followed(artist.id);
        if (is_following) {
            await this.media.unfollow_artist(artist.id);
        } else {
            await this.media.follow_artist(artist);
        }
    }

    search_filter: string = 'all'; // Default filter
    select_filter(filter: string): void {
        this.search_filter = filter;
        this.set_catalog();
    }

    set_catalog(): void {
        switch(this.search_filter) {
            case 'tracks':
                this.catalog = this.search_results?.tracks?.items || [];
                // this.catalog.sort((a: any, b: any) => (b.popularity || 0) - (a.popularity || 0)); // Sort by popularity descending
                break;
            case 'artists':
                this.catalog = this.search_results?.artists?.items || [];
                // this.catalog.sort((a: any, b: any) => (b.popularity || 0) - (a.popularity || 0)); // Sort by popularity descending
                break;
            case 'albums':
                this.catalog = this.search_results?.albums?.items || [];
                break;
            case 'playlists':
                this.catalog = this.search_results?.playlists?.items || [];
                break;
            case 'all':
            default:
                // Combine all results into a single catalog array
                this.catalog = [
                    ...(this.search_results?.catalog || []),
                ];
                break;
        }
    }

    spotify_open_artist(artist: any): void {
        const artist_id = artist.id;
        if (!artist_id) return;

        // add to media cache
        this.media.add_artist_to_recents(artist);
        this.router.navigate(['/artist', artist_id], { 
            queryParams: {
                source: 'spotify'
            }
        });
    }

    youtube_open_channel(channel: any): void {
        // null for now
    }

    spotify_open_album(album: any): void {
        const album_id = album.id;
        if (!album_id) return;

        this.router.navigate(['/album', album_id], { 
            queryParams: {
                source: 'spotify'
            }
        });
        this.add_album_to_collection(album);
    }

    spotify_open_playlist(playlist: any): void {
        const playlist_id = playlist.id;
        if (!playlist_id) return;

        // console.log('Opening playlist:', playlist);
        // // Navigate to playlist view or handle playlist selection
        // // this.router.navigate(['/playlist', playlist_id], { 
        // //     queryParams: {
        // //         source: 'spotify'
        // //     }
        // // });

        // // For now, you could add the playlist to collection
        // this.add_playlist_to_collection(playlist);
    }

    is_album_saved(album_id: string): boolean {
        // Check if album is in user's collection
        // Implement your logic here
        return false;
    }

    is_playlist_saved(playlist_id: string): boolean {
        // Check if playlist is in user's collection
        // Implement your logic here
        return false;
    }

    add_album_to_collection(album: any): void {
        // Add all tracks from the album to the user's collection
        console.log('Adding album to collection:', album);
        
        // You can fetch album tracks and add them
        // For now, just log
        // TODO: Implement album track fetching and addition to collection
    }

    add_playlist_to_collection(playlist: any): void {
        // Add all tracks from the playlist to the user's collection
        console.log('Adding playlist to collection:', playlist);
        
        // You can fetch playlist tracks and add them
        // For now, just log
        // TODO: Implement playlist track fetching and addition to collection
    }

    get top_releases(): any[] {
        // Example: returns a cleaned array of top releases (albums)
        return this.global.top_releases;
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
        } catch (error) {
            console.error('Error loading album color:', error);
            this.primary_colors.set(source, 'rgba(255, 255, 255, 0.1)');
        } finally {
            this.color_loading.delete(source);
        }
    }

    private async preload_visible_album_colors(): Promise<void> {
        // Preload colors for the first 5 albums (initially visible)
        const releases = this.top_releases.slice(0, 5);
        for (const album of releases) {
            const imageUrl = album.images?.[0]?.url;
            if (imageUrl && !this.primary_colors.has(imageUrl)) {
                // Load colors asynchronously without waiting
                this.load_album_primary_color(imageUrl);
                // Add a small delay between requests to avoid blocking
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
    }

    on_album_view_change(index: number, event: { ratio: number; distance: number }): void {
        // Store the distance for this album
        this.album_distances.set(index, event.distance);
        
        // Debounce to avoid too many updates - increased from 50ms to 150ms
        if (this.update_viewing_timer) {
            clearTimeout(this.update_viewing_timer);
        }
        
        this.update_viewing_timer = setTimeout(() => {
            // Find the album closest to center
            let closestIndex = 0;
            let closestDistance = Infinity;
            
            this.album_distances.forEach((distance, idx) => {
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestIndex = idx;
                }
            });
            
            // Only update if it's a different album
            if (this.viewing_album_index !== closestIndex) {
                this.viewing_album_index = closestIndex;
                // Reset all states to false
                this.album_viewing_states.fill(false);
                // Set only the closest one
                if (closestIndex < this.album_viewing_states.length) {
                    this.album_viewing_states[closestIndex] = true;
                }
            }
        }, 150); // Increased debounce to 150ms for better performance
    }

    track_by_index(index: number): number {
        return index;
    }

    get mood_categories(): {params: string, title: string}[] {
        return this.global.mood_genres;
    }
}