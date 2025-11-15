import { Injectable } from '@angular/core';
import { Output, EventEmitter } from '@angular/core';

import BufferController from './media.player/buffer.controller';
import MusicMediaManager from './media.player/media.manager';
import { MusicMediaService, Song_Data, Song_Identifier, Song_Playlist, Song_Playlist_Identifier } from './music.media.service';
import { Skip_Event, Skip_Result } from './media.player/playlist.manager';

@Injectable({
  providedIn: 'root'
})
export class MusicPlayerService {
    @Output() open_player: EventEmitter<void> = new EventEmitter();
    @Output() reduce_player: EventEmitter<void> = new EventEmitter();
    @Output() song_changed: EventEmitter<void> = new EventEmitter();
    @Output() playlist_changed: EventEmitter<void> = new EventEmitter();
    @Output() clear_playlist_color: EventEmitter<void> = new EventEmitter();


    private buffer_controller: BufferController;
    private media_controller: MusicMediaManager;

    get current(): Song_Data | null {
        return this.media_controller.current_song;
    }
    set current(song: Song_Data | null) {
        this.media_controller.current_song = song;
    }
    get media_data(): Song_Data | null {
        return this.media_controller.media_data;
    }
    get preloaded_next_song(): boolean {
        return false;
    }
    get previous_song_exists(): boolean {
        return this.media_controller.playlist_manager.has_previous_song;
    }
    get player_status(): 'playing' | 'paused' | 'stopped' {
        // if(this.buffer_controller?.is_stalled) return 'stopped';
        if(!this.media_controller?.audio_ready) return 'stopped';
        if(this.buffer_controller?.is_playing) return 'playing';
        return 'paused';
    }
    get song_time_elapsed(): number {
        return this.buffer_controller.current_time;
    }
    get song_duration(): number {
        return this.buffer_controller.duration;
    }
    get shuffle(): boolean {
        return this.media_controller.shuffle;
    }
    set shuffle(value: boolean) {
        this.media_controller.shuffle = value;
        this.media_controller.update_shuffle_queue();
    }
    get repeat(): boolean {
        return this.media_controller.repeat;
    }
    set repeat(value: boolean) {
        this.media_controller.repeat = value;
    }
    get playlist_identifier(): Song_Playlist_Identifier | null {
        return this.media_controller.playlist_manager.identifier;
    }
    get play_next_queue(): string[] {
        return this.media_controller.play_next_queue;
    }
    set play_next_queue(songs: string[]) {
        this.media_controller.play_next_queue = songs;
    }
    get playlist_queue(): string[] {
        return this.media_controller.playlist_queue;
    }
    set playlist_queue(songs: string[]) {
        this.media_controller.playlist_queue = songs; 
    }
    get song_cache(): Map<string, Song_Data> {
        return this.media_controller.song_cache;
    }
    get playlist_data(): Song_Playlist | null {
        return this.media_controller.playlist_manager.data;
    }
    get buffered_percent(): number {
        return this.buffer_controller.buffered_percent;
    }

    constructor(private media: MusicMediaService) {
        this.buffer_controller = new BufferController();
        // Pass the buffer_controller to media_controller so they share the same instance
        this.media_controller = new MusicMediaManager(this.media, this.buffer_controller);
    }

    public play(): void {
        this.media_controller?.play();
    }
    
    public pause(): void {
        this.media_controller?.pause();
    }

    public toggle_play(): void {
        this.media_controller?.toggle_play();
    }

    public async set_audio_element(element: HTMLMediaElement | HTMLAudioElement): Promise<void> {
        this.buffer_controller.set_audio_element(element);
        this.media_controller.configure_media_session();
        console.log('Audio element set in MusicPlayerService.');

        // Listen for custom songEnded event from BufferController
        // this.buffer_controller.events.addEventListener('songEnded', (event: Event) => {
        //     const customEvent = event as CustomEvent;

        //     // if(customEvent.detail.reason === 'buffered_to_end') {
        //     //     // dont skip, juts confirm length and that we are fully buffered
        //     //     return;
        //     // }
            
        //     // Auto-skip to next track
        //     if (
        //         this.media_controller.buffer_controller.has_audio &&
        //         this.media_controller.buffer_controller.is_fully_buffered
        //     ) {
        //         this.skip_to_next(Skip_Event.DEFAULT);
        //     }
        // });

        element.addEventListener('ended', () => {
            console.log('ended event fired on audio element.');
            // if(this.media_controller.buffer_controller.has_audio) {
                // this.skip_to_next(Skip_Event.DEFAULT);
            // }
            
            // this.skip_to_next(Skip_Event.DEFAULT);
        });

        element.addEventListener('loadeddata', () => {
            console.log('Audio element loaded data.');
            this.media_controller.on_data_loaded();
        });

        element.addEventListener('canplay', () => {
            this.media_controller.on_data_loaded();
        });

    }

    public set_thumbnail_element(element: HTMLImageElement): void {
        this.media_controller?.set_thumbnail_element(element);
    }

    public skip_to_next(event: Skip_Event = Skip_Event.DEFAULT, event_data: any = {}): Skip_Result {
        return this.media_controller?.playlist_manager?.next(event);
    }

    public skip_to_previous(event: Skip_Event = Skip_Event.DEFAULT, event_data: any = {}): Skip_Result {
        return this.media_controller?.playlist_manager?.previous(event);
    }

    public seek_to(time: number): void {
        this.media_controller?.seek_to(time);
    }

    public add_song_to_play_next(song: Song_Data): void {
        this.media_controller.playlist_manager.add_song_to_play_next(this.media.song_key(song.id));
    }

    public async load_and_play_track(song: Song_Data | Song_Identifier | string): Promise<void> {
        await this.media_controller.load_track(song);
        this.generate_colors_for_song(song);
        this.play();
    }

    public async load_track(song: Song_Data): Promise<void> {
        await this.media_controller.load_track(song);
    }

    private is_string(data: any): data is string {
        return typeof data === 'string' || data instanceof String;
    }

    private is_song_identifier(data: any): data is Song_Identifier {
        return (data as Song_Identifier).video_id !== undefined;
    }

    private is_song_data(data: any): data is Song_Data {
        return (data as Song_Data).song_name !== undefined;
    }

    public async generate_colors_for_song(song_data: Song_Data | Song_Identifier | string): Promise<void> {
        let song_key: string;
        let song_identifier: Song_Identifier;
        if(this.is_string(song_data)) {
            song_key = song_data;
            song_identifier = this.media.parse_song_key(song_data);
            console.log('Loading track by song key:', song_key, 'parsed identifier:', song_identifier);
            song_data = this.song_cache.get(song_key);


        }
        else if(this.is_song_identifier(song_data)) {
            song_key = this.media.song_key(song_data);
            song_identifier = song_data;
            song_data = this.song_cache.get(song_key);
        }
        else if(this.is_song_data(song_data)) {
            song_data = song_data;
            song_identifier = song_data.id;
            song_key = this.media.song_key(song_data.id);
        } else {
            console.error('Invalid data provided to load_track:', song_data);
            return;
        }

        if(!song_data) {
            console.log('Song data not found in cache for key:', song_key, 'Fetching from indexDB...');
            song_data = await this.media.get_song_from_indexDB(song_key);
            if(!song_data) {
                console.error('Song data not found in indexDB for key:', song_key, 'Cannot generate colors.');
                return;
            }
        }
        
        const common = await this.media.get_top_colors_from_artwork(song_data.url.artwork.low);
        const primary = await this.media.get_primary_color_from_artwork(song_data.url.artwork.low);

        song_data.colors = {
            primary: primary || null,
            common: common || null,
        };

        this.media_controller.song_cache.set(this.media.song_key(song_data.id), song_data);
        this.media.save_song_to_indexDB(this.media.song_key(song_data.id), song_data);

        if(this.media_controller.current_song && this.media.song_key(this.media_controller.current_song.id) === song_key) {
            this.media_controller.update_media_session(song_data);
        }
    }

    public add_song_to_cache(song: Song_Data): void {
        const key = this.media.song_key(song.id);
        this.media_controller.song_cache.set(key, song);
    }

    public async load_playlist(
        identifier: Song_Playlist_Identifier | null, 
        data: Song_Playlist | null, 
        preserve_history: boolean = false,
        auto_play: boolean = false
    ): Promise<void> {
        this.playlist_changed.emit();
        await this.media_controller.playlist_manager.load_playlist(identifier, data, preserve_history);
        if (auto_play) {
            const next_song_key = this.media_controller.playlist_manager.next_song_key!;
            this.skip_to_next(Skip_Event.OMIT_HISTORY);
            this.remove_song_from_playlist_queue(next_song_key);
        }
    }

    public update_media_session(metadata: Song_Data): void {
        this.media_controller.update_media_session(metadata);
    }

    public remove_current_song_from_queue(): void {
        // this.media_controller.playlist_manager.remove_current_track();
    }

    public remove_song_from_playlist_queue(song_key: string): void {
        this.media_controller.playlist_manager.remove_track_from_queue(song_key);
    }   
}