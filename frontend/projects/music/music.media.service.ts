import { Injectable, Injector, Output, EventEmitter } from '@angular/core';
import { set, get } from 'idb-keyval';
import { lastValueFrom } from 'rxjs';

import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../src/app/auth.service';
import { MusicPlayerService } from './music.player.service';
import { PlaylistsService } from './playlists.service';

export enum DownloadQuality {
    "Q0" = '0', // high
    "Q1" = '1',
    "Q2" = '2',
    "Q3" = '3',
    "Q4" = '4',
    "Q5" = '5',
    "Q6" = '6',
    "Q7" = '7',
    "Q8" = '8',
    "Q9" = '9', //low

}

export interface Song_Data {
    original_song_name: string;
    original_artists: Artist_Identifier[];
    song_name: string; // modifiable
    downloaded: boolean;
    download_audio_blob?: Blob | null; // the actual audio blob, if downloaded
    download_artwork_blob?: Blob | null; // the artwork blob, if available
    download_options?: { 
        quality: DownloadQuality,
        bit_rate: string // set to specifrics laters
    } | null; 
    url?: {
        audio: string | null; // the URL to the audio stream, if available
        artwork: {
            low: string | null; // low quality artwork URL
            high: string | null; // high quality artwork URL
        };
    };
    colors?: {
        primary: string | null; 
        common?: string[] | null
    }
    video_duration?: number; // the duration of the video in ms, if available
    lyrics?: Song_Lyrics,
    id: Song_Identifier; // the where this song was downloaded
    liked?: boolean; // whether the song is liked by the user
    date_added: Date; // date when the song was added to the library
}

export interface Song_Identifier {
    video_id: string; // the video ID from which this song was downloaded
    source_id?: string; // optional, for other sources like Spotify
    source: Song_Source;
}

export interface Song_Lyrics {
    // nothing for now
}

export interface Song_Playlist_Identifier {
    id: string; 
    name: string; 
    track_count?: number;
    duration?: number; // total duration of the playlist in ms
    default?: boolean;
    images?: string[]; // array of image URLs for the playlist (max 4)
    colors?: {
        primary?: string | null; 
    }
}

export interface Song_Playlist {
    songs: Map<string, Song_Identifier>;
    name: string; 
    default?: boolean; // whether this is a default playlist
}

export interface Song_Search_Result {
    catalog?: any[], // combined and sorted list of tracks and artists by popularity
    artists?: 
        { total: number, results: any[], next_page_token?: string } |
        { href: string, items: any[], limit: number, next: string | null, previous: string | null,  offset: number, total: number } | any,
    videos?: { total: number, results: any[], next_page_token?: string },
    albums?: { href: string, items: any[], limit: number, next: string | null, previous: string | null,  offset: number, total: number },
    tracks?: { href: string, items: any[], limit: number, next: string | null, previous: string | null,  offset: number, total: number },
    playlists?: { href: string, items: any[], limit: number, next: string | null, previous: string | null,  offset: number, total: number },
}

export interface Artist_Identifier {
    id: string; 
    name: string; 
    source: Song_Source; 
}

export type Song_Source = 'youtube' | 'spotify' | 'musi' | 'musix' | 'other';

@Injectable({
  providedIn: 'root'
})
export class MusicMediaService {
    @Output() song_data_updated: EventEmitter<Song_Data> = new EventEmitter<Song_Data>();
    @Output() artists_loaded: EventEmitter<void> = new EventEmitter<void>();

    private player?: MusicPlayerService;
    private playlist_service?: PlaylistsService;

    constructor(
        private Auth: AuthService, 
        private http: HttpClient,
        private injector: Injector
    ) { }

    private get playerService(): MusicPlayerService {
        if (!this.player) {
            this.player = this.injector.get(MusicPlayerService);
        }
        return this.player;
    }

    private get playlists(): PlaylistsService {
        if (!this.playlist_service) {
            this.playlist_service = this.injector.get(PlaylistsService);
        }
        return this.playlist_service;
    }

    private playlist_songs_cache: Map<string, Set<string>> = new Map(); // song key -> Set of playlist_ids
    private all_songs_cache: Set<string> = new Set(); // song key
    private all_songs_cache_initialized: boolean = false;

    private artists_cache: Map<string, any> = new Map(); // artist id -> artist data

    private _preload_duration: number = 15; // seconds (3-20)

    async initialize_all_songs_cache(playlist_identifiers: Song_Playlist_Identifier[]): Promise<void> {
        if (this.all_songs_cache_initialized) return;

        this.all_songs_cache.clear();
        for (const playlist of playlist_identifiers) {
            const playlist_data = await this.get_playlist_from_indexDB(playlist);
            if (playlist_data && playlist_data.songs) {
                for (const song_id of playlist_data.songs.values()) {
                    const bare_song_key = this.bare_song_key(song_id);
                    this.all_songs_cache.add(bare_song_key);

                    if (!this.playlist_songs_cache.has(bare_song_key)) {
                        this.playlist_songs_cache.set(bare_song_key, new Set());
                    }
                    this.playlist_songs_cache.get(bare_song_key)!.add(playlist.id);
                }
            }
        }
        this.all_songs_cache_initialized = true;
        console.log('All songs cache initialized with', this.all_songs_cache.size, 'songs.');
        console.log(this.playlist_songs_cache);

        //  also initialize artists cache
        await this.load_all_artists_from_indexDB();
        this.artists_loaded.emit();
    }

    public is_song_in_collection(bare_song_key: string, exclude_defaults: boolean = false): boolean {
        if (!this.all_songs_cache_initialized) {
            console.warn('Playlist cache not initialized, performing slow lookup');
            return false; // Or trigger async initialization
        }
        if(exclude_defaults) {
            // Check if the song is in any non-default playlist
            const playlists = this.playlist_songs_cache.get(bare_song_key);
            if (!playlists || playlists.size === 0) {
                return this.all_songs_cache.has(bare_song_key);
            }
            
            const filtered = Array.from(playlists).filter(
                id => id !== '#recently_played' && id !== '#recently_added'
            );

            return filtered.length > 0;
            
        }
        return this.all_songs_cache.has(bare_song_key);
    }

    public get_playlists_containing_song(bare_song_key: string): string[] {
        if (!this.playlist_songs_cache.has(bare_song_key)) {
            // console.warn(`No playlists found for song key: ${bare_song_key}`);
            return [];
        }
        return Array.from(this.playlist_songs_cache.get(bare_song_key) || []);
    }

    public is_song_in_playlist(bare_song_key: string, playlist_id: string): boolean {
        if (!this.playlist_songs_cache.has(bare_song_key)) {
            // console.warn(`No playlists found for song key: ${bare_song_key}`);
            return false;
        }
        return this.playlist_songs_cache.get(bare_song_key)?.has(playlist_id) || false;
    }

    public add_song_to_cache(bare_song_key: string, playlist_id: string): void {
        if (!this.all_songs_cache_initialized) {
            console.warn('Playlist cache not initialized, cannot add song to cache');
            return;
        }
        if (!bare_song_key) {
            console.warn('add_song_to_cache called with empty song_key');
            return;
        }
        if (this.all_songs_cache.has(bare_song_key)) {
            // song already exists in cache, just add to playlist to set
            this.playlist_songs_cache.get(bare_song_key)?.add(playlist_id);
            return;
        }
        this.all_songs_cache.add(bare_song_key);
        if (!this.playlist_songs_cache.has(bare_song_key)) {
            this.playlist_songs_cache.set(bare_song_key, new Set());
        }
        // console.log(`Adding song key ${bare_song_key} to playlist ${playlist_id}`);
        this.playlist_songs_cache.get(bare_song_key)!.add(playlist_id);
    }

    public remove_song_from_cache(bare_song_key: string, playlist_id: string): void {
        if (!this.all_songs_cache_initialized) {
            console.warn('Playlist cache not initialized, cannot remove song from cache');
            return;
        }
        if (!bare_song_key) {
            console.warn('remove_song_from_cache called with empty song_key');
            return;
        }
        if (this.playlist_songs_cache.has(bare_song_key)) {
            this.playlist_songs_cache.get(bare_song_key)?.delete(playlist_id);
            if (this.playlist_songs_cache.get(bare_song_key)?.size === 0) {
                this.playlist_songs_cache.delete(bare_song_key);
                this.all_songs_cache.delete(bare_song_key);
            }
        } else {
            console.warn(`Song key ${bare_song_key} not found in cache`);
        }
    }

    public bare_song_key(identifier: Song_Identifier | null | undefined): string {
        if (!identifier) {
            console.warn('bare_song_key called with null or undefined identifier');
            return '';
        }
        if (!identifier.source_id) return `${identifier.source}:${identifier.video_id}`;
        return `${identifier.source}:${identifier.source_id}`;
    }

    public song_key(identifier: Song_Identifier | null | undefined): string {
        if (!identifier) {
            console.warn('song_key called with null or undefined identifier');
            return '';
        }
        if(!identifier.source_id) return `${identifier.source}:${identifier.video_id}`;
        return `${identifier.source}:${identifier.source_id}:${identifier.video_id}`;
    }

    public validate_song_key(song_key: string): boolean {
        if (!song_key) {
            console.warn('validate_song_key called with empty song_key');
            return false;
        }
        const parts = song_key.split(':');
        if (parts.length !== 3 && parts[0] !== 'youtube' && parts[0] !== 'musi') {
            console.warn('validate_song_key: song_key does not have exactly 3 parts:', song_key);
            return false;
        }
        if (parts.some(part => !part || part.trim() === '')) {
            console.warn('validate_song_key: one or more parts are empty:', song_key);
            return false;
        }
        return true;
    }

    public download_progress(video_id: string): number {
        if (!this.download_progress_map.has(video_id)) {
            return 0; // No progress available
        }
        return this.download_progress_map.get(video_id) || 0; // Return the progress percentage
    }
    public is_in_download_queue(song_key: string): boolean {
        return this.download_queue_set.has(song_key);
    }
    private download_progress_interval: number = 1000; // interval in ms to check download progress
    private max_downloads: number = 2; // maximum concurrent downloads
    private download_progress_map: Map<string, number> = new Map(); // video_id -> progress percentage
    private download_queue_set: Set<string> = new Set(); // to prevent duplicate downloads
    private download_queue: {song_key: string, download_options: { quality: DownloadQuality, bit_rate: string } }[] = [];
    public is_downloading(video_id: string): boolean {
        return (this.download_progress_map.has(video_id) && this.download_progress_map.get(video_id)! < 100) || this.download_queue_set.has(video_id);
    }
    public async request_download(song_key: string, download_options: { quality: DownloadQuality, bit_rate: string }): Promise<void> {
        if(this.download_queue_set.has(song_key)) return console.warn('Download already requested for this song:', song_key);

        const video_id = song_key.split(':').pop() || ''; 
        const song_data = await this.get_song_from_indexDB(song_key);
        if(song_data && song_data.downloaded) return console.warn('Song already downloaded:', song_key);
        this.download_queue_set.add(video_id);
        this.download_queue.push({ song_key, download_options });

        this.proccess_download_queue();
    }

    private async proccess_download_queue(): Promise<void> {
        if (this.download_progress_map.size >= this.max_downloads) {
            setTimeout(this.proccess_download_queue.bind(this), this.download_progress_interval); 
            return;
        }
        if (this.download_queue.length === 0) {
            console.log('Download queue is empty, nothing to process'); // temporary debug log
            return;
        }

        const next_download = this.download_queue.shift();
        if (!next_download) return;

        const { song_key, download_options } = next_download;
        const video_id = song_key.split(':').pop() || ''; 
        this.download_queue_set.delete(video_id);

        this.download_progress_map.set(video_id, 0); // reset progress for this download

        await this.download_audio(song_key, download_options);
        this.proccess_download_queue();
    }

    public get_total_downloads(): number {
        return this.download_queue.length + this.download_progress_map.size;
    }

    public is_song_in_playlist_download_queue(playlist_identifier: Song_Playlist_Identifier): boolean {
        return this.download_queue.some((item) => {
            const playlists_that_song_is_in_set = this.playlist_songs_cache.get(item.song_key);
            return playlists_that_song_is_in_set && playlists_that_song_is_in_set.has(playlist_identifier.id);
        });
    }

    public how_many_songs_in_playlist_download_queue(playlist_identifier: Song_Playlist_Identifier): number {
        return this.download_queue.filter((item) => {
            const playlists_that_song_is_in_set = this.playlist_songs_cache.get(item.song_key);
            return playlists_that_song_is_in_set && playlists_that_song_is_in_set.has(playlist_identifier.id);
        }).length;
    }

    public async download_audio(song_key: string, download_options: {quality: DownloadQuality, bit_rate: string}): Promise<void> {
        try {
            const video_id = song_key.split(':').pop() || ''; 
            let song_data = (song_key === this.song_key(this.playerService.song_data?.id) ? this.playerService.song_data : await this.get_song_from_indexDB(song_key)) || {
                original_song_name: '#no name', 
                original_artists: [{ id: '', name: '#no name', source: 'youtube' as Song_Source }], 
                song_name: '#no name', 
                downloaded: false,
                download_audio_blob: null,
                download_artwork_blob: null,
                download_options: download_options,
                id: { video_id, source: 'youtube' as Song_Source },
                video_duration: undefined, 
                lyrics: undefined,
                date_added: new Date(),
            };
            
            this.download_progress_map.set(video_id, 0); 
            const event_source = this.listen_to_progress(video_id);
            let [audio_blob, artwork_blob] = await Promise.all([
                lastValueFrom(
                    this.http.post(
                        `/audio/download/${video_id}`,
                        { ...download_options },
                        { responseType: 'blob' }
                    )
                ),
                null
                // lastValueFrom(
                //     this.http.get(
                //         `/audio/artwork/${video_id}`,
                //         { responseType: 'blob' }
                //     )
                // )
            ]);
            console.log('Audio blob received:', audio_blob);

            setTimeout(()=>{
                this.download_progress_map.delete(video_id); //temp
            }, 850); // allow the progress bar to finish visually before removing it
            (await event_source).close();

            if(!audio_blob || audio_blob.size === 0 || audio_blob.type !== 'audio/mpeg') {
                console.error('No audio blob received from server');
                clearInterval(this._fake_update_interval);
                this.download_progress_map.delete(video_id);
                this.download_queue_set.delete(video_id); // just in case
                return;
            }
            if(!artwork_blob) {
                console.warn('No artwork blob received from server, using default');
                // artwork_blob = new Blob(); // Create an empty blob if no artwork is available
            }
            
            console.log('Audio blob downloaded:', audio_blob);
            console.log('Artwork blob downloaded:', artwork_blob);

            this.playlists.add_to_downloads(song_data);

            song_data.downloaded = true;
            song_data.download_audio_blob = audio_blob;
            song_data.download_artwork_blob = artwork_blob;
            song_data.download_options = download_options;

            // alert(`got audio blob of size ${audio_blob.size} bytes, Mb: ${(audio_blob.size / (1024 * 1024)).toFixed(2)}`);

            const result = await this.save_song_to_indexDB(song_key, song_data);
            if (!result) {
                alert('Failed to save song data to IndexedDB');
                return;
            }

            if(this.bare_song_key(this.playerService.song_data?.id) === this.bare_song_key(song_data.id)) {
                this.playerService.song_data = song_data; // Update the player service with the new song data if the song is currently playing
                // this.playerService.playlist_song_data_map.set(this.bare_song_key(song_data.id), song_data);
                // this.playlists.update_song_in_playlist(song_data, null, null);
                // this.song_data_updated.emit(song_data); 
                // this.playlists.add_song_to_playlist(song_data, null, null)
            }
            this.song_data_updated.emit(song_data); 
        } catch (error) {
            console.error('Error downloading audio blob:', error);
        }
    }

    private _fake_update_interval: any = null;
    async listen_to_progress(video_id: string) {
        let fake_loading_limit = Math.floor(Math.random() * 50) + 15; // Random limit between 15 and 65
        let fake_loading_progress = 0;

        const eventSource = new EventSource(`/audio/progress/${video_id}`);
        eventSource.onmessage = (event) => {
            const progress = JSON.parse(event.data);
            clearInterval(this._fake_update_interval);
            let total = progress.total || progress.total_estimate;
            this.download_progress_map.set(video_id, ((fake_loading_limit / 100) + (progress.downloaded / (total)) * .75) * 100); 
        };
        eventSource.onerror = (err) => {
            this.download_progress_map.set(video_id, 100);
            eventSource.close();
            console.error('Error listening to progress:', err);
            clearInterval(this._fake_update_interval);
        };
        this._fake_update_interval = setInterval(() => {
            if (fake_loading_progress >= fake_loading_limit) {
                clearInterval(this._fake_update_interval);
                return;
            }
            fake_loading_progress += Math.floor(Math.random() * 2) + 1; // Simulate progress
            this.download_progress_map.set(video_id, Math.min(fake_loading_limit, fake_loading_progress));
        }, Math.floor(Math.random() * 340) + 140);

        return eventSource;
    }

    async save_song_to_indexDB(key: string, data: Song_Data): Promise<boolean> {
        try {
            console.log('Saving song to IndexedDB with key:', key);
            await set(key, data);
            console.log('Song successfully saved to IndexedDB');
            return true; // Success
        } catch (error) {
            console.error('Error saving song to IndexedDB:', error);
            return false; // Failure
        }
    }

    async get_song_from_indexDB(key: string): Promise<Song_Data | null> {
        try {
            const song_data = await get<Song_Data>(key);
            if (song_data) {
                // console.log('Song retrieved from IndexedDB:', song_data);
                return song_data;
            } else {
                console.log('No song found in IndexedDB for key:', key);
                return null;
            }
        } catch (error) {
            console.error('Error retrieving song from IndexedDB:', error);
            return null;
        }
    }

    async get_audio_source_from_indexDB(key: string): Promise<string | null> {
        const song_data = await this.get_song_from_indexDB(key);
        if (song_data && song_data.downloaded && song_data.download_audio_blob) {
            return URL.createObjectURL(song_data.download_audio_blob);
        }
        return await this.get_audio_stream(key); 
    }

    async get_audio_stream(key: string): Promise<string | null> {
        return (await this.get_hls_stream(key))?.playlist_url || null;
    }

    async get_hls_stream(key: string): Promise<any | null> {
        // returns hls data for the song
        const video_id = key.split(':').pop() || '';
        let response: any;
        try {
            response = ((await lastValueFrom(
                this.http.get(
                    `/stream?video_id=${encodeURIComponent(video_id)}`,
                )
            )) as any);
        } catch (error) {
            console.error('Error fetching HLS stream:', error);
            return null;
        }
        // console.log('HLS stream response:', response);
        return response || null;
    }

    async get_audio_duration(key: string): Promise<number | null> {
        const song_data = await this.get_song_from_indexDB(key);
        if (song_data && song_data.video_duration) {
            return song_data.video_duration;
        }

        const video_id = key.split(':').pop() || '';
        const response = ((await lastValueFrom(
            this.http.get(
                `/music/duration?video_id=${encodeURIComponent(video_id)}`,
            )
        )) as any);
        return response.duration || null;
    }

    async preload_hls_stream(key: string): Promise<any | null> {
        const video_id = key.split(':').pop() || '';
        const response = ((await lastValueFrom(
            this.http.get(
                `/stream/preload?video_id=${encodeURIComponent(video_id)}`,
            )
        )) as any);
        return response || null;
    }

    async get_song_artwork(song: Song_Data): Promise<string | null> {
        if (song.downloaded && song.download_artwork_blob) {
            return URL.createObjectURL(song.download_artwork_blob);
        }

        // If the song is not downloaded, we can try to fetch it from the server
        try {
            const response = await lastValueFrom(
                this.http.get(`${this.Auth.backendURL}/audio/artwork/${song.id.video_id}`, { responseType: 'blob' })
            );
            return response ? URL.createObjectURL(response) : null;
        } catch (error) {
            console.error('Error fetching song artwork:', error);
            return null;
        }
    }

    async get_song_data(key: string): Promise<Song_Data | null> {
        const song_data = await this.get_song_from_indexDB(key);
        if (song_data) {
            return song_data;
        } else {
            console.warn(`No song data found for key: ${key}`);
            return null;
        }
    }

    async get_playlist_from_indexDB(playlist_identifier: Song_Playlist_Identifier): Promise<Song_Playlist> {
        try {
            const playlist = await get(`#playlist_${playlist_identifier.id}`);
            if (playlist) {
                return playlist;
            } else {
                console.warn(`No playlist found in IndexedDB for identifier: ${playlist_identifier}`);
                console.log('Creating a new playlist with empty songs set.');
                if( this.requesting_a_default_playlist(playlist_identifier) ) {
                    console.log('Requesting a default playlist, using default values.');
                    let default_playlist = this.DEFAULT_PLAYLISTS.find(p => p.id === playlist_identifier.id);
                    if (!default_playlist) {
                        console.warn(`Default playlist not found for identifier: ${playlist_identifier.id}`);
                        default_playlist = { id: playlist_identifier.id, name: playlist_identifier.name, default: true, duration: 0, track_count: 0, images: [] };
                    }

                    var playlist_data: Song_Playlist = { songs: new Map(), name: default_playlist?.name, default: true };
                    playlist_identifier.track_count = default_playlist?.track_count || 0;
                    playlist_identifier.duration = default_playlist?.duration || 0;
                    playlist_identifier.images = default_playlist?.images || [];
                    playlist_identifier.default = true;
                    playlist_identifier.name = default_playlist?.name || playlist_identifier.name;
                } else {
                    var playlist_data: Song_Playlist = { songs: new Map(), name: playlist_identifier.name, default: false };
                }
                this.save_playlist_to_indexDB(playlist_identifier, playlist_data);
                return playlist_data;
            }
        } catch (error) {
            console.error('Error retrieving playlist from IndexedDB:', error);
            return { songs: new Map(), name: playlist_identifier.name, default: false };
        }
    }

    requesting_a_default_playlist(playlist_identifier: Song_Playlist_Identifier): boolean {
        return this.DEFAULT_PLAYLISTS.some(p => p.id === playlist_identifier.id);
    }

    async save_playlist_to_indexDB(playlist_identifier: Song_Playlist_Identifier, playlist: Song_Playlist): Promise<void> {
        try {
            // console.log('Playlist saved to IndexedDB:', playlist_identifier, playlist);
            await set(`#playlist_${playlist_identifier.id}`, playlist);
        } catch (error) {
            console.error('Error saving playlist to IndexedDB:', error);
        }
    }

    readonly DEFAULT_PLAYLISTS: Song_Playlist_Identifier[] = [
        {
            id: '#favorites',
            name: 'Favorites',
            default: true,
            duration: 0, 
            track_count: 0, 
            images: [], 
            colors: {
                primary: 'hsl(342deg 82% 50%)'
            }
        },
        {
            id: '#downloads',
            name: 'Downloads',
            default: true,
            duration: 0, 
            track_count: 0, 
            images: [],
            colors: {
                primary: 'hsl(33, 72%, 50%)'
            }
        },
        {
            id: '#recently_played',
            name: 'Recently Played',
            default: true,
            duration: 0, 
            track_count: 0, 
            images: [],
            colors: {
                primary: 'hsl(218, 79%, 65%)'
            }
        },
        {
            id: '#recently_added',
            name: 'Recently Added',
            default: true,
            duration: 0, 
            track_count: 0, 
            images: [],
            colors: {
                primary: 'hsl(150, 84%, 65%)'
            }
        },
    ];
    async get_all_playlist_identifiers_from_indexDB(): Promise<Song_Playlist_Identifier[]> {
        try {
            const playlists: Song_Playlist_Identifier[] = await get('#playlists') || [];
            if (playlists.length > 0) {
                // console.log('Playlists retrieved from IndexedDB:', playlists);
                return playlists;
            }
            console.log('No playlists found in IndexedDB.');
            return this.DEFAULT_PLAYLISTS;
        } catch (error) {
            console.error('Error retrieving playlists from IndexedDB:', error);
            return this.DEFAULT_PLAYLISTS;
        }
    }

    async save_playlist_identifiers_to_indexDB(playlists: Song_Playlist_Identifier[]): Promise<void> {
        try {
            await set('#playlists', playlists);
            console.log('Playlists saved to IndexedDB:', playlists);
        } catch (error) {
            console.error('Error saving playlists to IndexedDB:', error);
        }
    }

    async search(query: string, source: string = 'spotify'): Promise<Song_Search_Result> {
        try {
            const response = await lastValueFrom(
                this.http.get(`/music/search`, { params: { q: query, source } })
            );
            console.log('Search response:', response);
            return response as Song_Search_Result; 
        } catch (error) {
            console.error('Error during search:', error);
            return {};
        }
    }

    async get_video_id_from_spotify_uri(uri: string): Promise<string | null> {
        try {
            const response = await lastValueFrom(
                this.http.get(`${this.Auth.backendURL}/music/spotify/video-id`, { params: { uri } })
            ) as any;
            console.log('Response from Spotify URI to video ID:', response);
            if (response && response?.video_id) {
                return response?.video_id; 
            }
            return null;
        } catch (error) {
            console.error('Error fetching video ID from Spotify URI:', error);
            return null;
        }
    }

    async get_primary_color_from_artwork(artwork_url: string | null): Promise<string | null> {
        if (!artwork_url) return null;
        
        return new Promise((resolve, reject) => {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    resolve(null);
                    return;
                }

                const img = new Image();
                img.crossOrigin = 'Anonymous';
                img.src = artwork_url;

                let timeout = setTimeout(() => {
                    console.warn('Image loading timed out for artwork');
                    resolve(null);
                }, 10000);

                img.onload = () => {
                    try {
                        clearTimeout(timeout);
                        
                        // Resize for faster processing
                        const maxSize = 150;
                        const scale = Math.min(maxSize / img.width, maxSize / img.height);
                        const scaledWidth = Math.floor(img.width * scale);
                        const scaledHeight = Math.floor(img.height * scale);

                        canvas.width = scaledWidth;
                        canvas.height = scaledHeight;
                        ctx.drawImage(img, 0, 0, scaledWidth, scaledHeight);
                        
                        const imageData = ctx.getImageData(0, 0, scaledWidth, scaledHeight);
                        const data = imageData.data;

                        // console.log(`Processing image data: ${data.length} values for ${scaledWidth}x${scaledHeight} image`);

                        // Method 1: Find most frequent color with better grouping
                        const colorCount = new Map<string, number>();
                        let totalPixels = 0;
                        
                        for (let i = 0; i < data.length; i += 4) {
                            const r = data[i];
                            const g = data[i + 1];
                            const b = data[i + 2];
                            const a = data[i + 3];
                            
                            // Skip transparent or very dark pixels
                            if (a < 50 || (r < 10 && g < 10 && b < 10)) continue;
                            
                            // Less aggressive grouping - group by 8 instead of 16
                            const groupedR = Math.floor(r / 8) * 8;
                            const groupedG = Math.floor(g / 8) * 8;
                            const groupedB = Math.floor(b / 8) * 8;
                            
                            const colorKey = `${groupedR},${groupedG},${groupedB}`;
                            colorCount.set(colorKey, (colorCount.get(colorKey) || 0) + 1);
                            totalPixels++;
                        }

                        // console.log(`Processed ${totalPixels} pixels, found ${colorCount.size} unique colors`);

                        if (colorCount.size === 0) {
                            console.warn('No valid colors found in image');
                            resolve('#808080'); // Return gray as fallback
                            return;
                        }

                        // Find the most frequent color
                        let maxCount = 0;
                        let dominantColor = '128,128,128';

                        for (const [color, count] of colorCount.entries()) {
                            if (count > maxCount) {
                                maxCount = count;
                                dominantColor = color;
                            }
                        }

                        // console.log(`Most frequent color: ${dominantColor} (${maxCount} pixels, ${((maxCount/totalPixels)*100).toFixed(1)}%)`);

                        // Method 2: Fallback - Average color calculation
                        if (maxCount < totalPixels * 0.05) { // If no color dominates (less than 5%)
                            // console.log('No dominant color found, calculating average color instead');
                            
                            let totalR = 0, totalG = 0, totalB = 0, validPixels = 0;
                            
                            for (let i = 0; i < data.length; i += 4) {
                                const r = data[i];
                                const g = data[i + 1];
                                const b = data[i + 2];
                                const a = data[i + 3];
                                
                                if (a > 50 && (r > 10 || g > 10 || b > 10)) {
                                    totalR += r;
                                    totalG += g;
                                    totalB += b;
                                    validPixels++;
                                }
                            }
                            
                            if (validPixels > 0) {
                                const avgR = Math.round(totalR / validPixels);
                                const avgG = Math.round(totalG / validPixels);
                                const avgB = Math.round(totalB / validPixels);
                                dominantColor = `${avgR},${avgG},${avgB}`;
                                // console.log(`Average color: ${dominantColor}`);
                            }
                        }

                        const [r, g, b] = dominantColor.split(',').map(Number);
                        
                        // Ensure values are valid
                        const finalR = Math.max(0, Math.min(255, r));
                        const finalG = Math.max(0, Math.min(255, g));
                        const finalB = Math.max(0, Math.min(255, b));
                        
                        const color = `rgb(${finalR}, ${finalG}, ${finalB})`;
                        // console.log(`Final primary color: ${color}`);
                        resolve(color);

                    } catch (error) {
                        clearTimeout(timeout);
                        console.error('Error processing image data:', error);
                        resolve('#808080'); // Return gray as fallback
                    }
                };

                img.onerror = (error) => {
                    clearTimeout(timeout);
                    console.error('Error loading image:', error);
                    resolve(null);
                };
            } catch (error) {
                console.error('Error getting primary color from artwork:', error);
                resolve(null);
            }
        });
    }

    async get_top_colors_from_artwork(artwork_url: string | null, count: number = 4, diversity_threshold: number = 80): Promise<string[] | null> {
        if (!artwork_url) return null;
        
        return new Promise((resolve, reject) => {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    resolve(null);
                    return;
                }

                const img = new Image();
                img.crossOrigin = 'Anonymous';
                img.src = artwork_url;

                const timeout = setTimeout(() => {
                    console.warn('Image loading timed out for top colors extraction');
                    resolve(null);
                }, 10000);

                img.onload = () => {
                    try {
                        clearTimeout(timeout);
                        
                        // Resize for faster processing
                        const maxSize = 150;
                        const scale = Math.min(maxSize / img.width, maxSize / img.height);
                        const scaledWidth = Math.floor(img.width * scale);
                        const scaledHeight = Math.floor(img.height * scale);

                        canvas.width = scaledWidth;
                        canvas.height = scaledHeight;
                        ctx.drawImage(img, 0, 0, scaledWidth, scaledHeight);
                        
                        const imageData = ctx.getImageData(0, 0, scaledWidth, scaledHeight);
                        const data = imageData.data;

                        // Step 1: Collect all colors with their frequencies
                        const colorMap = new Map<string, { count: number, r: number, g: number, b: number }>();
                        
                        for (let i = 0; i < data.length; i += 4) {
                            const r = data[i];
                            const g = data[i + 1];
                            const b = data[i + 2];
                            const a = data[i + 3];
                            
                            // Skip transparent or very dark/light pixels
                            if (a < 50 || (r < 15 && g < 15 && b < 15) || (r > 240 && g > 240 && b > 240)) continue;
                            
                            // Group colors by reducing precision
                            const groupedR = Math.floor(r / 12) * 12;
                            const groupedG = Math.floor(g / 12) * 12;
                            const groupedB = Math.floor(b / 12) * 12;
                            
                            const colorKey = `${groupedR},${groupedG},${groupedB}`;
                            
                            if (colorMap.has(colorKey)) {
                                colorMap.get(colorKey)!.count++;
                            } else {
                                colorMap.set(colorKey, { count: 1, r: groupedR, g: groupedG, b: groupedB });
                            }
                        }

                        if (colorMap.size === 0) {
                            console.warn('No valid colors found for top colors extraction');
                            resolve(['#808080']);
                            return;
                        }

                        // Step 2: Sort colors by frequency
                        const sortedColors = Array.from(colorMap.entries())
                            .sort((a, b) => b[1].count - a[1].count)
                            .map(([key, data]) => data);

                        // console.log(`Found ${sortedColors.length} unique colors for diversity selection`);

                        // Step 3: Select diverse colors
                        const selectedColors: { r: number, g: number, b: number }[] = [];
                        
                        // Always include the most frequent color first
                        if (sortedColors.length > 0) {
                            selectedColors.push(sortedColors[0]);
                        }

                        // Step 4: Select remaining colors based on diversity
                        for (const candidate of sortedColors.slice(1)) {
                            if (selectedColors.length >= count) break;
                            
                            let isDiverse = true;
                            
                            // Check if this candidate is diverse enough from already selected colors
                            for (const selected of selectedColors) {
                                const distance = this.calculate_color_distance(candidate, selected);
                                if (distance < diversity_threshold) {
                                    isDiverse = false;
                                    break;
                                }
                            }
                            
                            if (isDiverse) {
                                selectedColors.push(candidate);
                            }
                        }

                        // Step 5: If we don't have enough diverse colors, add strategic colors
                        while (selectedColors.length < count) {
                            const strategicColor = this.get_strategic_color(selectedColors, selectedColors.length);
                            if (strategicColor) {
                                selectedColors.push(strategicColor);
                            } else {
                                break; // Can't find more strategic colors
                            }
                        }

                        // Step 6: Convert to RGB strings and sort by luminance for better visual arrangement
                        const finalColors = selectedColors
                            .map(color => ({ 
                                color, 
                                luminance: this.calculate_luminance(color.r, color.g, color.b),
                                rgb: `rgb(${color.r}, ${color.g}, ${color.b})`
                            }))
                            .sort((a, b) => b.luminance - a.luminance) // Light to dark
                            .map(item => item.rgb);

                        // console.log(`Final top colors (${finalColors.length}):`, finalColors);
                        resolve(finalColors);

                    } catch (error) {
                        clearTimeout(timeout);
                        console.error('Error processing top colors:', error);
                        resolve(['#808080']);
                    }
                };

                img.onerror = (error) => {
                    clearTimeout(timeout);
                    console.error('Error loading image for top colors:', error);
                    resolve(null);
                };

            } catch (error) {
                console.error('Error getting top colors from artwork:', error);
                resolve(null);
            }
        });
    }

    // Helper function to calculate color distance (Euclidean distance in RGB space)
    private calculate_color_distance(color1: { r: number, g: number, b: number }, color2: { r: number, g: number, b: number }): number {
        const deltaR = color1.r - color2.r;
        const deltaG = color1.g - color2.g;
        const deltaB = color1.b - color2.b;
        return Math.sqrt(deltaR * deltaR + deltaG * deltaG + deltaB * deltaB);
    }

    // Helper function to calculate luminance for sorting
    private calculate_luminance(r: number, g: number, b: number): number {
        // Using relative luminance formula
        return 0.299 * r + 0.587 * g + 0.114 * b;
    }

    // Helper function to generate strategic colors when we need more diversity
    private get_strategic_color(existingColors: { r: number, g: number, b: number }[], index: number): { r: number, g: number, b: number } | null {
        const strategies = [
            // Dark color
            () => ({ r: 30, g: 30, b: 30 }),
            // Light color  
            () => ({ r: 220, g: 220, b: 220 }),
            // Warm color
            () => ({ r: 200, g: 100, b: 50 }),
            // Cool color
            () => ({ r: 50, g: 100, b: 200 }),
            // Vibrant color
            () => ({ r: 200, g: 50, b: 150 })
        ];

        if (index - 1 < strategies.length) {
            const strategicColor = strategies[index - 1]();
            
            // Check if this strategic color is diverse enough
            let isDiverse = true;
            for (const existing of existingColors) {
                if (this.calculate_color_distance(strategicColor, existing) < 60) {
                    isDiverse = false;
                    break;
                }
            }
            
            return isDiverse ? strategicColor : null;
        }
        
        return null;
    }

    generate_playlist_id(): string {
        return `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 15)}_${Math.random().toString(36).substring(2, 15)}_${Math.random().toString(36).substring(2, 15)}_${performance.now().toString(36).replace('.', '')}`;
    }

    async import_playlist(url: string): Promise<any> {
        if (!url) {
            console.error('No URL provided for playlist import');
            return;
        }
        
        try {
            // call the backend endpoint to import the playlist
            const response = await lastValueFrom(
                this.http.get(`/import/musi`, { params: { url } })
            );
            return response;
        } catch (error) {
            console.error('Error importing playlist:', error);
            return null;
        }
    }

    async import_playlist_from_file(file: File): Promise<any> {
        if (!file) {
            console.error('No file provided for playlist import');
            return;
        }
        
        try {
            const form_data = new FormData();
            form_data.append('playlist_file', file);
            
            // call the backend endpoint to import the playlist
            const response = await lastValueFrom(
                this.http.post(`/import/musix`, form_data)
            );
            return response;
        } catch (error) {
            console.error('Error importing playlist from file:', error);
            return null;
        }
    }

    async get_search_recommendations(query: string): Promise<any> {
        try {
            const response = await lastValueFrom(
                this.http.get(`/music/search_recommendations`, { params: { q: query } })
            );
            return response; 
        } catch (error) {
            console.error('Error fetching search recommendations:', error);
            return [];
        }
    }

    async get_watch_playlist(track_id: string): Promise<any> {
        if (!track_id) {
            console.error('No track ID provided for watch playlist');
            return;
        }
        
        try {
            const response = await lastValueFrom(
                this.http.get(`/music/watch_playlist/${track_id}`)
            );
            return response; 
        } catch (error) {
            console.error('Error fetching watch playlist:', error);
            return null;
        }
    }

    is_artist_followed(artist_id: string): boolean {
        return this.followed_artists_cache?.has(artist_id) || false;
    }

    async add_artist_to_recents(artist_data: any): Promise<void> {
        if (!artist_data || !artist_data.id) return;
        this.artists_cache?.set(artist_data.id, artist_data);
        this.recent_artists_cache?.set(artist_data.id, artist_data);

        // Maintain max recent artists limit
        if (this.recent_artists_cache.size > this.max_recent_artists) {
            const firstKey = this.recent_artists_cache.keys().next().value;
            this.recent_artists_cache.delete(firstKey);
        }

        this.save_recent_artists_to_indexDB();
    }

    async follow_artist(artist_data: any): Promise<void> {
        if (!artist_data || !artist_data.id) return;
        this.followed_artists_cache?.set(artist_data.id, artist_data);
        this.artists_cache?.set(artist_data.id, artist_data);
        this.save_followed_artists_to_indexDB();
        this.artists_loaded.emit();
    }

    async unfollow_artist(artist_id: string): Promise<void> {
        if (!artist_id) return;
        this.artists_cache?.delete(artist_id);
        this.followed_artists_cache?.delete(artist_id);
        this.save_followed_artists_to_indexDB();
        this.artists_loaded.emit();
    }

    async save_followed_artists_to_indexDB(): Promise<void> {
        try {
            const artists_array = Array.from(this.followed_artists_cache?.values() || []);
            await set('#followed_artists', artists_array);
            console.log('Followed artists saved to IndexedDB:', artists_array);
        } catch (error) {
            console.error('Error saving followed artists to IndexedDB:', error);
        }
    }

    async save_all_artists_to_indexDB(): Promise<void> {
        await this.save_followed_artists_to_indexDB();
        await this.save_recent_artists_to_indexDB();
    }

    async load_all_artists_from_indexDB(): Promise<void> {
        await this.load_followed_artists_from_indexDB();
        await this.load_recent_artists_from_indexDB();
    }



    private followed_artists_cache: Map<string, any> = new Map();
    private recent_artists_cache: Map<string, any> = new Map();
    private max_recent_artists: number = 20;
    async save_recent_artists_to_indexDB(): Promise<void> {
        try {
            const artists_array = Array.from(this.recent_artists_cache?.values() || []);
            await set('#recent_artists', artists_array);
            console.log('Recent artists saved to IndexedDB:', artists_array);
        } catch (error) {
            console.error('Error saving recent artists to IndexedDB:', error);
        }
    }

    async load_followed_artists_from_indexDB(): Promise<void> {
        try {
            this.followed_artists_cache = new Map(); // reset
            const artists_array: any[] = await get('#followed_artists') || [];
            this.followed_artists_cache = new Map(artists_array.map(artist => [artist.id, artist]));
            // also add to main cache
            this.artists_cache = this.artists_cache || new Map();
            for(const artist of artists_array) {
                this.artists_cache?.set(artist.id, artist);
            }
            console.log('Followed artists loaded from IndexedDB:', artists_array);
        } catch (error) {
            console.error('Error loading followed artists from IndexedDB:', error);
            this.followed_artists_cache = new Map();
        }
    }

    async load_recent_artists_from_indexDB(): Promise<void> {
        try {
            this.recent_artists_cache = new Map(); // reset
            const artists_array: any[] = await get('#recent_artists') || [];
            this.recent_artists_cache = new Map(artists_array.map(artist => [artist.id, artist]));
            for(const artist of artists_array) {
                this.artists_cache?.set(artist.id, artist); // also add to main cache
            }
            console.log('Recent artists loaded from IndexedDB:', artists_array);
        } catch (error) {
            console.error('Error loading recent artists from IndexedDB:', error);
            this.recent_artists_cache = new Map();
        }   
    }

    public async get_artist_details(artist_id: string): Promise<any | null> {
        const result = this.artists_cache?.get(artist_id) || null;
        if(!result) {
            const response = await lastValueFrom(
                this.http.get(`/spotify/artist/${artist_id}`)
            );
            return (response as any) || null;
        }
        return result;
    }

    public async get_artist_top_tracks(artist_id: string): Promise<any[]> {
        try {
            const response = await lastValueFrom(
                this.http.get(`/spotify/artist/${artist_id}/top_tracks`)
            );
            return (response as any[]) || [];
        } catch (error) {
            console.error('Error fetching artist top tracks:', error);
            return [];
        }
    }

    public async get_artist_albums(artist_id: string): Promise<any[]> {
        try {
            const response = await lastValueFrom(
                this.http.get(`/spotify/artist/${artist_id}/albums`)
            );
            return (response as any[]) || [];
        } catch (error) {
            console.error('Error fetching artist albums:', error);
            return [];
        }
    }

    public get_followed_artists(): any[] {
        return Array.from(this.followed_artists_cache?.values() || []);
    }

    public get_recent_artists(): any[] {
        return Array.from(this.recent_artists_cache?.values() || []);
    }

    public get_mood_categories(): Promise<{params: string, title: string}[]> {
        return lastValueFrom(
            this.http.get(`/music/mood_categories`)
        ) as Promise<{params: string, title: string}[]>;
    }

    public async get_all_song_data(video_id: string): Promise<any> {
        return lastValueFrom(
            this.http.get(`/music/song_data/${video_id}`)
        ) as Promise<any>;
    }

    public async get_recommended_songs_for_song_using_musik(video_id: string): Promise<Song_Data[]> {
        return lastValueFrom(
            this.http.get(`/music/recommend/${video_id}`)
        ) as Promise<Song_Data[]>;
    }

    // public async get_recommended_songs_from_playlist (): Promise<Song_Data[]> {
        
    // }
}
