import { Component, Output, EventEmitter, HostBinding } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { Song_Data } from '../../music.media.service';
import { PlaylistsService } from '../../playlists.service';
import { HotActionService } from '../../hot.action.service';
import { MusicMediaService, DownloadQuality, Song_Playlist_Identifier, Song_Source } from '../../music.media.service';
import { MusicPlayerService } from '../../music.player.service';

@Component({
  selector: 'hot-action',
  standalone: true,
  imports: [CommonModule, FormsModule],
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
    get meta_song_data(): Song_Data | null {
        return this.hot_action.meta_song_data;
    }

    // get playlist_identifiers(): Song_Playlist_Identifier[] {
    //     return this.playlists.playlist_identifiers;
    // }
    playlist_identifiers: Song_Playlist_Identifier[] = [];
    playlist_selectors: { identifier: Song_Playlist_Identifier, selected: boolean, select: () => void, is_selectable: () => boolean, action: () => void }[] = [];
    private selected_playlists: Set<string> = new Set();

    private update_playlist_selectors(): void {
        this.playlist_identifiers = this.playlists.playlist_identifiers;
        this.selected_playlists.clear();
        this.playlist_selectors = this.playlist_identifiers.map(playlist => {
            let is_selected = this.selected_playlists.has(playlist.id);
        
            return {
                identifier: playlist,
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
                    if (!this.song_data) return true;
                    return !this.media.is_song_in_playlist(this.media.bare_song_key(this.song_data.id), playlist.id);
                },
                action: async () => {
                    if (!this.song_data) return;
                    this.playlists.add_song_to_playlist(this.song_data, playlist, await this.playlists.get_playlist(playlist));
                    console.log(`Adding song to playlist: ${playlist.id}`, this.song_data);
                },
            };
        });
    }

    constructor(private playlists: PlaylistsService, public hot_action: HotActionService, private media: MusicMediaService, private player: MusicPlayerService, private router: Router) {
        this.hot_action.hot_action_opened.subscribe((opened: boolean) => {
            if(opened) this.update_playlist_selectors();
        });
    }

    get actions(): {no_check?:boolean, name: string, icon: () => string, selected: boolean, select: () => void, action: () => void, is_selectable: () => boolean}[] {
        return this.default_actions;
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

                if(this.media.song_key(this.player.current.id) === this.media.song_key(this.song_data.id)) {
                    this.player.current = this.song_data; // Update player song data to reflect changes
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
                console.log('Up next');
                if(!this.song_data) return;
                // console.log('Adding to play next:', this.song_data);
                const run = async () => {
                    this.media.save_song_to_indexDB(this.media.song_key(this.song_data.id),this.song_data);
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

                await this.playlists.add_songs_to_playlist(response.tracks.map((track: any) => this.hot_action.musix_track_data(track)), playlist_identifier, playlist);

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

    import_type: 'spotify' | 'youtube' | 'musi' | 'musix' = 'musi';

    set_import_type(type: 'spotify' | 'youtube' | 'musi' | 'musix'): void {
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
}
