import { Component, Output, EventEmitter, HostBinding } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { Song_Data, Song_Identifier, Song_Playlist } from '../../music.media.service';
import { PlaylistsService } from '../../playlists.service';
import { HotActionService } from '../../hot.action.service';
import { MusicMediaService, DownloadQuality, Song_Playlist_Identifier, Song_Source } from '../../music.media.service';
import { MusicPlayerService } from '../../music.player.service';
import { ProgressiveLoadDirective } from '../../progressive.image.loader.directive';

@Component({
  selector: 'hot-action',
  standalone: true,
  imports: [CommonModule, FormsModule, ProgressiveLoadDirective],
  templateUrl: './hot.action.component.html',
  styleUrl: './hot.action.component.css'
})
export class HotActionComponent {
    @HostBinding('class.dragged') get is_dragged(): boolean {
        return this.header_drag_active;
    }

    @Output() close: EventEmitter<void> = new EventEmitter<void>();
    playlist_name: string = '';
    import_url: string = '';
    import_file: File | null = null;
    import_status: 'idle' | 'loading' | 'error' = 'idle';
    source_options: Map<Song_Source, string> = new Map([
        ['spotify', "#1cd760"],
        ['youtube', "#ff0033"],
        ['youtubemusic', "#ff0033"],
        ['musi', "#ff8843"],
        ['musix', "#ff8843"],
    ]);
    get action(): string {
        return this.hot_action.action;
    }
    get title(): string {
        switch (this.action) {
            case 'add_to_playlist': return '';
            case 'create_playlist': return 'Create Playlist';
            case 'import_playlist': return 'Import Playlist';
            case 'song_options': return this.song_data ? `Options for "${this.song_data.song_name}"` : 'Song Options';
            default: return 'Hot Action';
        }
    }

    get is_favorite(): boolean {
        return this.song_data?.liked ?? false;
    }
    get is_downloaded(): boolean {
        return (this.song_data?.downloaded && this.song_data?.download_audio_blob !== null) ?? false;
    }
    get song_data(): Song_Data | null {
        return this.hot_action.song_data;
    }
    get playlist_selectors_length(): number {
        // returns the length without the non playlists, like albums
        return this.playlist_selectors.filter(selector => selector.identifier.playlist_type !== 'album').length;
    }

    // get playlist_identifiers(): Song_Playlist_Identifier[] {
    //     return this.playlists.playlist_identifiers;
    // }
    playlist_identifiers: Song_Playlist_Identifier[] = [];
    playlist_selectors: { 
        identifier: Song_Playlist_Identifier, 
        selected: boolean, 
        select: () => void, 
        is_selectable: () => boolean, 
        action: () => void,
        images: ({ blob?: Blob; low?: string; high?: string; })[]
    }[] = [];
    private selected_playlists: Set<string> = new Set();

    private async update_playlist_selectors(): Promise<void> {
        this.playlist_identifiers = this.playlists.playlist_identifiers;
        this.selected_playlists.clear();
        
        // Create selectors with images loaded
        const selectors = await Promise.all(this.playlist_identifiers.map(async (playlist) => {
            let is_selected = this.selected_playlists.has(playlist.id);
            
            // Load images for this playlist
            const images = await this.get_images_for_playlist({ identifier: playlist });
        
            return {
                identifier: playlist,
                images: images,
                get selected() {
                    return is_selected;
                },
                select: () => {
                    if (is_selected) {
                        this.selected_playlists.delete(playlist.id);
                        is_selected = false;
                    } else {
                        this.selected_playlists.add(playlist.id);
                        is_selected = true;
                    }
                },
                is_selectable: () => {
                    if (!this.song_data) return false;
                    return !this.media.is_song_in_playlist(this.media.bare_song_key(this.song_data.id), playlist.id);
                },
                action: async () => {
                    if (!this.song_data) return console.error('No song data to add to playlist');
                    // console.log('Adding song to playlist:', playlist, this.song_data);
                    this.playlists.add_song_to_playlist(this.song_data, playlist, await this.playlists.get_playlist(playlist));
                    console.log(`Added song to playlist: ${playlist.id}`, this.song_data);
                },
            };
        }));
        
        this.playlist_selectors = selectors;
    }

    constructor(private playlists: PlaylistsService, public hot_action: HotActionService, private media: MusicMediaService, private player: MusicPlayerService, private router: Router) {
        this.hot_action.hot_action_opened.subscribe((opened: boolean) => {
            if(opened) this.update_playlist_selectors();
        });
    }

    get actions(): {no_check?:boolean, name: string, icon: () => string, selected: boolean, select: () => void, action: () => void, is_selectable: () => boolean}[] {
        const actions = this.default_actions;
        if(!this.player.is_playing) {
            // remove up next option
            return actions.slice(0,3);
        }
        return actions;
    }

    readonly default_actions: {no_check?:boolean, name: string, icon: () => string, selected: boolean, select: () => void, action: () => void, is_selectable: () => boolean}[] = [
        {
            no_check: true,
            name: 'Create Playlist',
            icon: () => 'plus.svg',
            selected: false,
            select: () => {
                this.hot_action.action = 'create_playlist';
            },
            action: () => {},
            is_selectable: () => true
        },
        {
            name: 'Add to Favorites',
            icon: () => this.actions[1].selected ? 'heart-fill.svg' : 'heart.svg',
            selected: false,
            select: () => {
                this.actions[1].selected = !this.actions[1].selected;
            },
            action: async () => {
                if(!this.song_data) return;

                this.song_data.liked = true;
                this.playlists.add_to_favorites(this.song_data);

                if(this.player?.current?.id && this.media.song_key(this.player.current.id) === this.media.song_key(this.song_data.id)) {
                    this.player.set_current_song(this.song_data); // Update player song data to reflect changes
                }
            },
            is_selectable: () => !!this.song_data && !this.is_favorite
        },
        {
            name: 'Download',
            icon: () => 'cloud-download.svg',
            selected: false,
            select: () => {
                this.actions[2].selected = !this.actions[2].selected;
            },
            action: async () => {
                if(!this.song_data) return;

                this.media.request_download(this.media.song_key(this.song_data.id), { quality: DownloadQuality.Q0, bit_rate: '128K' });
            },
            is_selectable: () => !!this.song_data && !this.is_downloaded
        },
        {
            name: 'Up Next',
            icon: () => 'playlist.svg',
            selected: false,
            select: () => {
                this.actions[3].selected = !this.actions[3].selected;
            },
            action: async () => {
                if(!this.song_data) return;
                const run = async () => {
                    this.media.save_song_to_indexDB(this.media.song_key(this.song_data.id), this.song_data);
                    this.player.add_song_to_play_next(this.song_data);
                };
                run();
            },
            is_selectable: () => !!this.song_data
        }
    ];

    add_to_playlist_done(): void {
        const selected_actions = [...this.actions,...this.playlist_selectors].filter(action => action.selected);
        if(selected_actions.length > 0) {
            selected_actions.forEach(action => action.action());
        }
        this.hot_action.close_hot_action();
        selected_actions.forEach(action => action.select());
    }
    cancel(): void {
        this.hot_action.close_hot_action();
        const selected_actions = this.actions.filter(action => action.selected);
        selected_actions.forEach(action => action.select());
    }
    are_any_actions_selected(): boolean {
        return [...this.actions,...this.playlist_selectors].some(action => action.selected);
    }
    action_is_selectable(is_selectable: () => boolean): boolean {
        return is_selectable();
    }
    has_valid_playlist_name(): boolean {
        return (this.playlist_name && this.playlist_name.trim().length > 0) || false;
    }
    async create_playlist_done(): Promise<void> {
        this.hot_action.close_hot_action();
        const playlist_identifier = await this.playlists.create_playlist(this.playlist_name);
        if(!playlist_identifier) return;

        this.router.navigate(['/playlist', playlist_identifier.id]);
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
    select_playlist(playlist_selector: any): void {
        playlist_selector.select();
    }
    async import_playlist(): Promise<void> {
        switch (this.import_type) {
            case 'spotify':
            case 'youtube':
            case 'youtubemusic':
            case 'musi':
                this.import_playlist_done();
                break;
            case 'musix':
                // should already be handled by file input change
                // this.import_playlist_from_file_done();
                break;
        }
    }
    async import_playlist_done(): Promise<void> {
        this.import_status = 'loading';
        let url = this.import_url.trim();
        if(!url.includes('http://') && !url.includes('https://')) {
            // asume it's a musi url
            url = 'https://feelthemusi.com/playlist/' + url;
        }
        this.media.import_playlist(url).then(async (response) => {
            console.log('Playlist import response:', response);
            if (response.name.trim().length > 0 && response.tracks.length > 0) {
                const playlist_indentifier = await this.playlists.create_playlist(response.name);
                console.log('Created playlist identifier:', playlist_indentifier);
                if(!playlist_indentifier) return;
                playlist_indentifier.created_by = 'imported';
                const playlist = await this.playlists.get_playlist(playlist_indentifier);


                await this.playlists.add_songs_to_playlist(response.tracks.map((track: any) => this.hot_action.musi_track_data(track)), playlist_indentifier, playlist);


                await Promise.all(response.tracks.map(async (track: any) => {
                    const song_data: Song_Data | null = await this.hot_action.musi_track_data(track);
                    if(song_data) {
                        await this.playlists.add_song_to_playlist(song_data, playlist_indentifier, playlist);
                    }
                }));

                this.hot_action.close_hot_action();
                
                this.import_status = 'idle';
                this.import_url = '';

                this.router.navigate(['/playlist', playlist_indentifier.id]);
            }
        }).catch((error) => {
            console.error('Error importing playlist:', error);
            this.import_status = 'error';
        });
    }

    async import_playlist_from_file_done(): Promise<void> {
        if (!this.import_file) {
            console.error('No file selected for import');
            this.import_status = 'error';
            return;
        }

        this.import_status = 'loading';

        try {
            const response = await this.media.import_playlist_from_file(this.import_file);
            console.log('Playlist import response:', response);
            if (response.name.trim().length > 0 && response.tracks.length > 0) {
                const playlist_identifier = await this.playlists.create_playlist(response?.name || 'Imported Playlist');
                console.log('Created playlist identifier:', playlist_identifier);
                if (!playlist_identifier) return;
                const playlist = await this.playlists.get_playlist(playlist_identifier);

                // await this.playlists.add_songs_to_playlist(response.tracks.map((track: any) => this.hot_action.musix_track_data(track)), playlist_identifier, playlist);

                await Promise.all(response.tracks.map(async (track: any) => {
                    const song_data: Song_Data | null = await this.hot_action.musix_track_data(track);
                    if (song_data) {
                        await this.playlists.add_song_to_playlist(song_data, playlist_identifier, playlist);
                    }
                }));

                this.hot_action.close_hot_action();
                
                this.import_status = 'idle';
                this.import_file = null;

                this.router.navigate(['/playlist', playlist_identifier.id]);
            }
        } catch (error) {
            console.error('Error importing playlist from file:', error);
            this.import_status = 'error';
        }
    }

    on_file_import_change(event: Event): void {
        const input = event.target as HTMLInputElement;
        if (input.files && input.files.length === 1) {
            this.import_file = input.files[0];
            this.import_playlist_from_file_done();
        } else {
            this.import_file = null;
        }
    }

    import_type: 'spotify' | 'youtube' | 'youtubemusic' | 'musi' | 'musix' = 'musi';

    set_import_type(type: 'spotify' | 'youtube' | 'youtubemusic' | 'musi' | 'musix'): void {
        this.import_type = type;
        this.import_url = '';
        this.import_file = null;
        this.import_status = 'idle';
    }

    // Header drag properties
    header_drag_active = false;
    header_drag_start_y = 0;
    header_drag_y = 0;
    header_drag_threshold = 100; // Distance to pull down before closing
    get header_transform(): string {
        return this.header_drag_y > 0 ? `translateY(${this.header_drag_y}px)` : '';
    }

    header_on_drag_start(event: TouchEvent | MouseEvent): void {
        let clientY: number;
        
        if (event instanceof TouchEvent) {
            clientY = event.touches[0].clientY;
        } else {
            clientY = event.clientY;
        }

        this.header_drag_active = true;
        this.header_drag_start_y = clientY;
        this.header_drag_y = 0;

        event.stopPropagation();
    }

    header_on_drag_move(event: TouchEvent | MouseEvent): void {
        if (!this.header_drag_active) return;
        
        let clientY: number;
        
        if (event instanceof TouchEvent) {
            clientY = event.touches[0].clientY;
        } else {
            clientY = event.clientY;
        }

        const deltaY = clientY - this.header_drag_start_y;
        
        // Only allow downward drag (positive deltaY)
        this.header_drag_y = Math.max(0, deltaY);

        event.preventDefault();
        event.stopPropagation();
    }

    header_on_drag_end(event: TouchEvent | MouseEvent): void {
        if (!this.header_drag_active) return;

        const should_close = this.header_drag_y > this.header_drag_threshold;

        if (should_close) {
            // Animate to fully closed position
            this.animate_header_close();
        } else {
            // Snap back to original position
            this.animate_header_value(this.header_drag_y, 0);
        }

        this.header_drag_active = false;
        event.stopPropagation();
    }

    private animate_header_value(from: number, to: number, duration: number = 200): void {
        this.animateValue(from, to, duration, this.easeOutCubic).subscribe(value => {
            this.header_drag_y = value;
        });
    }

    private animate_header_close(): void {
        this.animateValue(this.header_drag_y, window.innerHeight, 300, this.easeOutCubic).subscribe({
            next: (value) => {
                this.header_drag_y = value;
            },
            complete: () => {
                // Close the hot action after animation
                this.hot_action.close_hot_action();
                this.header_drag_y = 0;
            }
        });
    }

    animateValue(
        from: number, 
        to: number, 
        duration: number, 
        easing: (t: number) => number = this.linear
    ): BehaviorSubject<number> {
        const subject = new BehaviorSubject<number>(from);
        const startTime = Date.now();
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easedProgress = easing(progress);
            const currentValue = from + (to - from) * easedProgress;
            
            subject.next(currentValue);
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                subject.complete();
            }
        };
        
        requestAnimationFrame(animate);
        return subject;
    }
    
    // Easing functions
    easeOutCubic(t: number): number {
        return 1 - Math.pow(1 - t, 3);
    }

    linear(t: number): number {
        return t;
    }

    // Song options properties and methods
    song_options: [string, string, string, string, string][] = [
        // name, icon, color, song_color, source_restriction
        ['Rename', 'edit.svg', 'var(--color-primary)', '', ''],
        ['Use Artwork For Playlist', 'palette.svg', 'var(--color-primary)', '', ''],
        // ['Edit Artists', 'users.svg', 'var(--color-primary)', '', 'not_spotify'],
        // ['Song Color', 'palette.svg', '#song_color', '', ''],
        ['Add to Playlist', 'plus.svg', 'var(--color-primary)', '', ''],
        ['Play Similar', 'disco-ball-fill.svg', 'var(--color-primary)', '', ''],
        ['Share', 'share.svg', 'var(--color-primary)', '', ''],
        ['Remove from Playlist', 'trash.svg', 'var(--color-deny)', '', ''],
    ];

    // Rename song
    new_song_name: string = '';
    
    is_song_name_valid(): boolean {
        return this.new_song_name && this.new_song_name.trim().length > 0;
    }

    async confirm_rename_song(): Promise<void> {
        if (!this.song_data) return;
        
        this.song_data.song_name = this.new_song_name.trim();
        // await this.media.save_song_to_indexDB(this.media.song_key(this.song_data.id), this.song_data);
        
        // Update player if this is the current song
        if (this.player?.current?.id && this.media.song_key(this.player.current.id) === this.media.song_key(this.song_data?.id)) {
            this.player.set_current_song(this.song_data);
        }

        await this.confirm_edit_artists(); // Close hot action after renaming
        
        this.hot_action.close_hot_action();
    }

    reset_rename_song(): void {
        this.new_song_name = this.song_data ? this.song_data.original_song_name : '';
    }

    // Edit artists
    new_artists: string[] = [''];

    add_artist_input(): void {
        this.new_artists.push('');
    }

    remove_artist_input(index: number): void {
        if (this.new_artists.length > 1) {
            this.new_artists.splice(index, 1);
        }
    }

    reset_artist_input(index: number): void {
        this.new_artists[index] = this.song_data?.original_artists?.[index]?.name || '';
    }

    trackByArtistIndex(index: number): number {
        return index;
    }

    are_artists_valid(): boolean {
        return this.new_artists.some(artist => artist && artist.trim().length > 0);
    }

    is_renaming_valid(): boolean {
        return this.new_song_name.trim().length > 0 && this.new_song_name.trim() !== (this.song_data?.song_name || '');
    }

    async confirm_edit_artists(): Promise<void> {
        if (!this.song_data) return;
        
        // Filter out empty artists and create artist objects
        const valid_artists = this.new_artists
            .filter(name => name && name.trim().length > 0)
            .map(name => ({
                id: name.trim().toLowerCase().replace(/\s+/g, '-'),
                name: name.trim(),
                source: this.song_data!.id?.source
            }));

        this.song_data.artists = valid_artists;
        await this.media.save_song_to_indexDB(this.media.song_key(this.song_data?.id), this.song_data);
        
        // Update player if this is the current song
        if (this.player?.current?.id && this.media.song_key(this.player.current.id) === this.media.song_key(this.song_data?.id)) {
            this.player.set_current_song(this.song_data);
        }
    }

    // Song color picker
    song_view_color: string = '';
    song_text_contrast_color: string = 'white';
    song_color_options: string[][] = [
        ['hsl(0, 85%, 60%)', 'hsl(30, 85%, 60%)', 'hsl(60, 85%, 60%)', 'hsl(90, 85%, 60%)', 'hsl(120, 85%, 60%)'],
        ['hsl(150, 85%, 60%)', 'hsl(180, 85%, 60%)', 'hsl(210, 85%, 60%)', 'hsl(240, 85%, 60%)', 'hsl(270, 85%, 60%)'],
        ['hsl(300, 85%, 60%)', 'hsl(330, 85%, 60%)', 'hsl(0, 0%, 30%)', 'hsl(0, 0%, 50%)', 'hsl(0, 0%, 70%)']
    ];

    get is_song_color_same_as_original(): boolean {
        return this.song_view_color === (this.song_data?.colors?.primary || 'var(--color-primary)');
    }

    select_song_color(color: string): void {
        this.song_view_color = color;
        this.song_text_contrast_color = this.get_contrast_color(color);
    }

    async set_song_color(): Promise<void> {
        if (!this.song_data) return;
        
        if (!this.song_data.colors) {
            this.song_data.colors = { primary: this.song_view_color };
        } else {
            this.song_data.colors.primary = this.song_view_color;
        }
        
        await this.media.save_song_to_indexDB(this.media.song_key(this.song_data.id), this.song_data);
        
        // Update player if this is the current song
        if (this.player?.current?.id && this.media.song_key(this.player.current.id) === this.media.song_key(this.song_data.id)) {
            this.player.set_current_song(this.song_data);
        }
        
        this.hot_action.close_hot_action();
    }

    private get_contrast_color(hsl: string): string {
        // Extract lightness from HSL
        const match = hsl.match(/hsl\(\d+,\s*\d+%,\s*(\d+)%\)/);
        if (match) {
            const lightness = parseInt(match[1]);
            return lightness > 50 ? 'black' : 'white';
        }
        return 'white';
    }

    // Share song
    url_copied: boolean = false;

    get_song_share_url(): string {
        if (!this.song_data) return '';
        const base_url = window.location.origin;
        const song_key = this.media.song_key(this.song_data.id);
        return `${base_url}/track/${song_key}`;
    }

    async copy_song_url(url: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(url);
            this.url_copied = true;
            
            // Show notification
            // You can integrate with your notification service here
            console.log('URL copied to clipboard');
            
            setTimeout(() => {
                this.url_copied = false;
            }, 2000);
        } catch (error) {
            console.error('Failed to copy URL:', error);
        }
    }

    // Remove from playlist
    current_playlist_id: string | null = null;

    async confirm_remove_from_playlist(): Promise<void> {
        if (!this.song_data || !this.current_playlist_id) return;
        
        const playlist_identifier = this.playlists.playlist_identifiers.find(
            p => p.id === this.current_playlist_id
        );
        
        if (!playlist_identifier) return;
        
        const playlist = await this.playlists.get_playlist(playlist_identifier);
        await this.playlists.remove_song_from_playlist(this.song_data, playlist_identifier, playlist);
        
        this.hot_action.close_hot_action();
    }

    // Play similar
    async play_similar(): Promise<void> {
        if (!this.song_data || !this.song_data.id.video_id) return;
        
        try {
            const single_song_playlist: Song_Playlist = {
                name: `Similar to ${this.song_data.song_name}`,
                songs: new Map<string, Song_Identifier>(),
                song_added_timestamps: new Map<string, number>(),
                sorting_method: 'recent_to_old',
                default: false,
            };
            await this.player.load_playlist(null, single_song_playlist, false, false);
    
            this.player.pause();
            this.player.open_player.emit();

            const complete_song_data: Song_Data = await this.player.load_and_play_track(this.song_data);
            if(!complete_song_data) return;

            const media_controller = this.player.media_controller;
            this.media.get_watch_playlist(complete_song_data.id.video_id).then(async (playlist) => {
                if (playlist && playlist.songs && playlist.songs.length > 0) {
                    playlist.song_data.forEach((song: Song_Data) => {
                        media_controller.playlist_manager.add_song_to_end_of_queue(this.media.song_key(song.id));
                    });

                    playlist.song_data.map((song: Song_Data) => {
                        this.player.add_song_to_cache(song);
                    });
                } else {
                    console.warn('No tracks found in the watch playlist for:', complete_song_data?.id.video_id);
                }
            }).catch((error) => {
                console.error('Error fetching watch playlist:', error);
            });
            
            this.hot_action.close_hot_action();
        } catch (error) {
            console.error('Error fetching similar songs:', error);
        }
    }

    // Select song option handler
    select_song_option(option: string, enabled: boolean = true): void {
        // if (!enabled) return;

        console.log('Selecting song option:', option, enabled, this.song_data);
        switch (option) {
            case 'Rename':
                this.new_song_name = this.song_data?.song_name || '';
                this.hot_action.action = 'rename_song';
                this.new_artists = (this.song_data?.artists ?? this.song_data?.original_artists)?.map(a => a.name) || [''];
                break;
            case 'Use Artwork For Playlist':
                // set current artwork as playlist artwork
                this.playlists.set_current_playlist_artwork(this.song_data);
                break;
            case 'Song Color':
                this.song_view_color = this.song_data?.colors?.primary || 'var(--color-primary)';
                this.hot_action.action = 'pick_song_color';
                break;
            case 'Add to Playlist':
                this.hot_action.action = 'add_to_playlist';
                break;
            case 'Play Similar':
                this.play_similar();
                break;
            case 'Share':
                this.url_copied = false;
                this.hot_action.action = 'share_song';
                break;
            case 'Remove from Playlist':
                this.hot_action.action = 'remove_from_playlist_confirm';
                break;
        }
    }

    public async get_images_for_playlist(playlist: { identifier: Song_Playlist_Identifier }): Promise<({ blob?: Blob; low?: string; high?: string; })[]> {
        const images: ({ blob?: Blob; low?: string; high?: string; })[] = [];
        
        for(let image_key of playlist.identifier?.images || []) {
            const song_key = image_key.song_key;
            const song_data = await this.media.get_song_from_indexDB(song_key);
            images.push({
                low: song_data?.url?.artwork?.low,
                high: song_data?.url?.artwork?.high,
                blob: song_data?.download_artwork_blob
            });
        }
        
        return images;
    }

    public get sleep_time_remaining_display(): string {
        const sleep_time = this.player.sleep_time; // in seconds
        if(sleep_time <= 0) return 'No Sleep Timer Set';

        const minutes = Math.floor(sleep_time / 60);
        const seconds = sleep_time % 60;

        if(minutes > 0) {
            return `${minutes} minute${minutes !== 1 ? 's' : ''}${seconds > 0 ? ` and ${seconds} second${seconds !== 1 ? 's' : ''}` : ''} remaining`;
        } else {
            return `${seconds} second${seconds !== 1 ? 's' : ''} remaining`;
        }
    }
    public sleep_timer_options: {value: number, label: string}[] = [
        {value: 5, label: '5 minutes'},
        {value: 10, label: '10 minutes'},
        {value: 15, label: '15 minutes'},
        {value: 30, label: '30 minutes'},
        {value: 45, label: '45 minutes'},
        {value: 60, label: '1 hour'},
        {value: -1, label: 'Disable'},
        {value: -2, label: 'End of track'}
    ]; // in minutes, -1 for disable, -2 for end of track (-1 0nly there if sleep timer is active)

    public selected_sleep_timer_option: number = 0;
    public set_sleep_timer(minutes: number): void {
        if(minutes === -1) {
            this.player.clear_sleep_timer();
            this.selected_sleep_timer_option = -1;
        } else if(minutes === -2) {
            this.player.set_sleep_timer_to_end_of_track();
            this.selected_sleep_timer_option = -2;
        }
        else {
            this.player.sleep_time = minutes * 60; // convert to seconds 
            this.selected_sleep_timer_option = minutes;
        }
        this.hot_action.close_hot_action();
    }
}
