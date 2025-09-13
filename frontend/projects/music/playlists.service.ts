import { Injectable, Injector } from '@angular/core';
import { Router } from '@angular/router';

import { MusicMediaService, Song_Data, Song_Playlist, Song_Playlist_Identifier, Song_Identifier, DownloadQuality } from './music.media.service';
import { MusicPlayerService } from './music.player.service';

@Injectable({
  providedIn: 'root'
})
export class PlaylistsService {
    playlist_identifiers: Song_Playlist_Identifier[] = [];
    default_playlist_identifiers: Song_Playlist_Identifier[] = [];

    get all_playlist_identifiers(): Song_Playlist_Identifier[] {
        return [...this.default_playlist_identifiers, ...this.playlist_identifiers];
    }

    selected_playlist_identifier: Song_Playlist_Identifier | null = null;
    selected_playlist: Song_Playlist | null = null;
    selected_playlist_video_identifiers: Song_Identifier[] = [];

    private player?: MusicPlayerService;
    // sorting_method: 'recent_to_old' | 'old_to_recent' | 'alphabetical' = 'recent_to_old';

    constructor(
        private media: MusicMediaService, 
        private router: Router, 
        private injector: Injector
        // Remove MusicPlayerService from constructor
    ) {
        this.load_playlists();
    }

    private get playerService(): MusicPlayerService {
        if (!this.player) {
            this.player = this.injector.get(MusicPlayerService);
        }
        return this.player;
    }

    get favorite_playlist_identifier(): Song_Playlist_Identifier | null {
        return this.default_playlist_identifiers.find(p => p.name === 'Favorites') || null;
    }
    async add_to_favorites(song_data: Song_Data): Promise<void> {
        if (!this.favorite_playlist_identifier) return;

        const playlist = await this.get_playlist(this.favorite_playlist_identifier);
        if( !playlist) {
            console.warn(`Favorite playlist not found: ${this.favorite_playlist_identifier.name}`);
            return;
        }

        this.add_song_to_playlist(song_data, this.favorite_playlist_identifier, playlist);
        this.add_to_recently_added(song_data); // Also add to Recently Added
    }
    async remove_from_favorites(song_data: Song_Data): Promise<void> {
        if (!this.favorite_playlist_identifier) return;

        const playlist = await this.get_playlist(this.favorite_playlist_identifier);
        if( !playlist) {
            console.warn(`Favorite playlist not found: ${this.favorite_playlist_identifier.name}`);
            return;
        }

        this.remove_song_from_playlist(song_data, this.favorite_playlist_identifier, playlist);
    }
    get downloads_playlist_identifier(): Song_Playlist_Identifier | null {
        return this.default_playlist_identifiers.find(p => p.name === 'Downloads') || null;
    }
    async add_to_downloads(song_data: Song_Data): Promise<void> {
        if (!this.downloads_playlist_identifier) return;
        const playlist = await this.get_playlist(this.downloads_playlist_identifier);
        if (!playlist) {
            console.warn(`Downloads playlist not found: ${this.downloads_playlist_identifier.name}`);
            return;
        }

        this.add_song_to_playlist(song_data, this.downloads_playlist_identifier, playlist);
    }
    async remove_from_downloads(song_data: Song_Data): Promise<void> {
        if (!this.downloads_playlist_identifier) return;
        const playlist = await this.get_playlist(this.downloads_playlist_identifier);
        if (!playlist) {
            console.warn(`Downloads playlist not found: ${this.downloads_playlist_identifier.name}`);
            return;
        }

        this.remove_song_from_playlist(song_data, this.downloads_playlist_identifier, playlist);
    }
    get recently_played_playlist_identifier(): Song_Playlist_Identifier | null {
        return this.default_playlist_identifiers.find(p => p.name === 'Recently Played') || null;
    }
    async add_to_recently_played(song_data: Song_Data): Promise<void> {
        if (!this.recently_played_playlist_identifier) return;

        console.log('Adding to recently played:', song_data);

        const playlist = await this.get_playlist(this.recently_played_playlist_identifier);
        if (!playlist) {
            console.warn(`Recently Played playlist not found: ${this.recently_played_playlist_identifier.name}`);
            return;
        }

        this.add_song_to_playlist(song_data, this.recently_played_playlist_identifier, playlist);
    }
    async remove_from_recently_played(song_data: Song_Data): Promise<void> {
        if (!this.recently_played_playlist_identifier) return;

        const playlist = await this.get_playlist(this.recently_played_playlist_identifier);
        if (!playlist) {
            console.warn(`Recently Played playlist not found: ${this.recently_played_playlist_identifier.name}`);
            return;
        }

        this.remove_song_from_playlist(song_data, this.recently_played_playlist_identifier, playlist);
    }
    get recently_added_playlist_identifier(): Song_Playlist_Identifier | null {
        return this.default_playlist_identifiers.find(p => p.name === 'Recently Added') || null;
    }
    async add_to_recently_added(song_data: Song_Data): Promise<void> {
        if (!this.recently_added_playlist_identifier) return;

        const playlist = await this.get_playlist(this.recently_added_playlist_identifier);
        if (!playlist) {
            console.warn(`Recently Added playlist not found: ${this.recently_added_playlist_identifier.name}`);
            return;
        }

        this.add_song_to_playlist(song_data, this.recently_added_playlist_identifier, playlist);
    }
    async remove_from_recently_added(song_data: Song_Data): Promise<void> {
        if (!this.recently_added_playlist_identifier) return;

        const playlist = await this.get_playlist(this.recently_added_playlist_identifier);
        if (!playlist) {
            console.warn(`Recently Added playlist not found: ${this.recently_added_playlist_identifier.name}`);
            return;
        }

        this.remove_song_from_playlist(song_data, this.recently_added_playlist_identifier, playlist);
    }

    async load_playlists(): Promise<void> {
        const all_playlist_identifiers = await this.media.get_all_playlist_identifiers_from_indexDB();
        this.media.initialize_all_songs_cache(all_playlist_identifiers);
        this.default_playlist_identifiers = all_playlist_identifiers.filter(p => p?.default === true);
        this.playlist_identifiers = all_playlist_identifiers.filter(p => !p?.default);
    }

    async save_playlists(): Promise<void> {
        await this.media.save_playlist_identifiers_to_indexDB(this.all_playlist_identifiers);
    }

    async create_playlist(name: string): Promise<Song_Playlist_Identifier | null> {
        if (name.trim().length === 0) {
            console.warn('Invalid playlist name:', name);
            return null;
        }

        const existing_playlist = this.all_playlist_identifiers.find(p => p.name === name);
        if (existing_playlist) {
            console.warn(`Playlist with name "${name}" already exists.`);
            // return null;
            // generate a unique name
            let suffix = 1;
            let new_name = `${name} (${suffix})`;
            while (this.all_playlist_identifiers.find(p => p.name === new_name)) {
                suffix++;
                new_name = `${name} (${suffix})`;
            }
            name = new_name;
        }

        const new_playlist: Song_Playlist = {
            name: name,
            songs: new Map(),
            song_added_timestamps: new Map(),
            sorting_method: 'recent_to_old'
        };

        const updated_indentifier: Song_Playlist_Identifier = {
            name: name,
            id: this.media.generate_playlist_id(),
            track_count: 0,
            duration: 0,
            images: [],
            default: false,
            colors: {
                primary: 'hsl(33, 72%, 50%)',
            }
        };

        this.playlist_identifiers.push(updated_indentifier);
        // this.media.add_playlist_to_cache(playlist.id);
        await this.save_playlist(updated_indentifier, new_playlist);
        return updated_indentifier;
    }

    async select_playlist(playlist: Song_Playlist_Identifier): Promise<void> {
        this.router.navigate(['/playlist', playlist.id]);
        if (this.selected_playlist_identifier && this.selected_playlist_identifier.id === playlist.id) return; // Already selected, no need to reload

        this.selected_playlist_identifier = playlist;
        await this.load_playlist(playlist);
    }

    async delete_playlist(playlist: Song_Playlist_Identifier): Promise<void> {
        
    }

    async get_playlist(playlist_identifier: Song_Playlist_Identifier): Promise<Song_Playlist | null> {
        if (!playlist_identifier) return null;
        const playlist = await this.media.get_playlist_from_indexDB(playlist_identifier);
        if (!playlist) return null;
        return playlist;
    }

    async load_playlist(playlist_identifier: Song_Playlist_Identifier): Promise<void> {
        const playlist = await this.media.get_playlist_from_indexDB(playlist_identifier);
        if (!playlist) return;
        // find proper identifier in playlist_identifiers
        const existing_identifier = this.all_playlist_identifiers.find(p => p.id === playlist_identifier.id);
        console.log('Loading playlist:', playlist_identifier, 'Existing identifier:', existing_identifier);
        this.selected_playlist_identifier = existing_identifier ?? playlist_identifier; // Use existing identifier if available, otherwise use the provided one as default 
        this.selected_playlist = playlist;
        this.selected_playlist_video_identifiers = Array.from(playlist.songs.values());
        // this.playerService.load_playlist(playlist, false, false); // Use playerService instead of this.player
    }

    async save_playlist(playlist_identifier: Song_Playlist_Identifier | null = this.selected_playlist_identifier, playlist: Song_Playlist | null = this.selected_playlist): Promise<void> {
        if (!playlist || !playlist_identifier) return;
        if (!playlist_identifier.default && !this.playlist_identifiers.some(p => p.id === playlist_identifier.id)) {
            // not in the list, add it
            this.playlist_identifiers.push(playlist_identifier);
        }
        await Promise.all([
            this.media.save_playlist_to_indexDB(playlist_identifier, playlist),
            this.save_playlists()
        ]);
    }

    async add_song_to_playlist(song_data: Song_Data, playlist_identifier: Song_Playlist_Identifier | null = this.selected_playlist_identifier, playlist: Song_Playlist | null = this.selected_playlist): Promise<void> {
        if (!playlist || !playlist_identifier) return;
        if( playlist.songs.has(this.media.song_key(song_data.id))) {
            console.warn(`Song ${this.media.song_key(song_data.id)} already exists in playlist ${playlist_identifier.name}`);
            return;
        }

        this.media.add_song_to_cache(this.media.bare_song_key(song_data.id), playlist_identifier.id);

        playlist.songs.set(this.media.song_key(song_data.id), song_data.id);
        playlist.song_added_timestamps.set(this.media.song_key(song_data.id), Date.now());
        playlist_identifier.track_count = (playlist_identifier.track_count || 0) + 1;
        playlist_identifier.duration = (playlist_identifier.duration || 0) + (song_data.video_duration || 0);
        if(!playlist_identifier.images || playlist_identifier.images.length < 4) {
            playlist_identifier.images = playlist_identifier.images || [];
            if(song_data?.url?.artwork.high) {
                playlist_identifier.images.push(song_data?.url?.artwork?.high);
            } else if(song_data?.url?.artwork.low) {
                playlist_identifier.images.push(song_data?.url?.artwork?.low);
            }
        }
        this.media.save_song_to_indexDB(this.media.song_key(song_data.id), song_data);

        this.save_playlist(playlist_identifier, playlist);
    }
    async update_song_in_playlist(song_data: Song_Data, playlist_identifier: Song_Playlist_Identifier | null = this.selected_playlist_identifier, playlist: Song_Playlist | null = this.selected_playlist): Promise<void> {
        if (!playlist || !playlist_identifier) return;
        if (!playlist.songs.has(this.media.song_key(song_data.id))) {
            console.warn(`Song ${this.media.song_key(song_data.id)} does not exist in playlist ${playlist_identifier.name}`);
            return;
        }

        playlist.songs.set(this.media.song_key(song_data.id), song_data.id);
        // this.media.save_song_to_indexDB(this.media.song_key(song_data.id), song_data);
        this.save_playlist(playlist_identifier, playlist);
    }

    async add_songs_to_playlist(songs: Song_Data[], playlist_identifier: Song_Playlist_Identifier | null = this.selected_playlist_identifier, playlist: Song_Playlist | null = this.selected_playlist): Promise<void> {
        // fatser bulk add
        // if (!playlist || !playlist_identifier) return;
        // const song_keys = songs.map(song => this.media.song_key(song.id));
        // const existing_songs = Array.from(playlist.songs.keys()).filter(key => song_keys.includes(key));
        // if (existing_songs.length > 0) {
        //     console.warn(`Songs ${existing_songs.join(', ')} already exist in playlist ${playlist_identifier.name}`);
        // }
        // for (const song_data of songs) {
        //     if (playlist.songs.has(this.media.song_key(song_data.id))) {
        //         console.warn(`Song ${this.media.song_key(song_data.id)} already exists in playlist ${playlist_identifier.name}`);
        //         continue;
        //     }

        //     this.media.add_song_to_cache(this.media.bare_song_key(song_data.id), playlist_identifier.id);

        //     playlist.songs.set(this.media.song_key(song_data.id), song_data.id);
        //     playlist_identifier.track_count = (playlist_identifier.track_count || 0) + 1;
        //     playlist_identifier.duration = (playlist_identifier.duration || 0) + (song_data.video_duration || 0);
        //     if(!playlist_identifier.images || playlist_identifier.images.length < 4) {
        //         playlist_identifier.images = playlist_identifier.images || [];
        //         if(song_data.url?.artwork?.low) {
        //             playlist_identifier.images.push(song_data.url.artwork.high || song_data.url.artwork.low);
        //         }
        //     }
        //     this.media.save_song_to_indexDB(this.media.song_key(song_data.id), song_data);
        // }
    }

    async remove_song_from_playlist(song_data: Song_Data, playlist_identifier: Song_Playlist_Identifier | null = this.selected_playlist_identifier, playlist: Song_Playlist | null = this.selected_playlist): Promise<void> {
        if (!playlist || !playlist_identifier) return;
        if (!playlist.songs.has(this.media.song_key(song_data.id))) {
            console.warn(`Song ${this.media.song_key(song_data.id)} does not exist in playlist ${playlist_identifier.name}`);
            return;
        }

        this.media.remove_song_from_cache(this.media.bare_song_key(song_data.id), playlist_identifier.id);

        playlist.songs.delete(this.media.song_key(song_data.id));
        playlist.song_added_timestamps.delete(this.media.song_key(song_data.id));
        playlist_identifier.track_count = (playlist_identifier.track_count || 1) - 1;
        playlist_identifier.duration = (playlist_identifier.duration || 0) - (song_data.video_duration || 0);
        if(playlist_identifier.track_count < 4) {
            // remove the corresponding image
            playlist_identifier.images = playlist_identifier.images?.filter(image => image !== song_data.url?.artwork?.high && image !== song_data.url?.artwork.low ) || [];
        } 

        this.media.save_song_to_indexDB(this.media.song_key(song_data.id), song_data);
        this.save_playlist(playlist_identifier, playlist);
        // Remove the song data from indexDB
    }

    async playlist_contains_song(song_identifier: Song_Identifier, playlist_identifier: Song_Playlist_Identifier | null = this.selected_playlist_identifier): Promise<boolean> {
        if (!playlist_identifier) return false;
        const playlist = await this.media.get_playlist_from_indexDB(playlist_identifier);
        if (!playlist) return false;
        return playlist.songs.has(song_identifier.video_id);
    }

    async set_playlist_color(playlist_id: string, color: string): Promise<void> {
        const playlist_identifier = this.all_playlist_identifiers.find(p => p.id === playlist_id);
        if (!playlist_identifier) return;

        playlist_identifier.colors = {
            primary: color,
        };

        // Update the playlist identifier in the cache
        const index = this.all_playlist_identifiers.findIndex(p => p.id === playlist_id);
        if (index !== -1) {
            this.all_playlist_identifiers[index] = playlist_identifier;
        }

        this.save_playlists();
    }

    public async download_playlist(playlist: Song_Playlist): Promise<void> {
        if (!playlist) return;

        const songs = Array.from(playlist.songs.values());
        for (const song of songs) {
            this.media.request_download(this.media.song_key(song), {quality: DownloadQuality.Q0, bit_rate: '128k'});
        }

    }
}
