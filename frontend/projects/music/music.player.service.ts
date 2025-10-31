import { Injectable } from '@angular/core';
import { Output, EventEmitter } from '@angular/core';

// import { MusicMediaService, Song_Identifier, Song_Data, Song_Playlist, Song_Playlist_Identifier } from './music.media.service';
// import { PlaylistsService } from './playlists.service';
// import Hls from 'hls.js';
import BufferController from './media.player/buffer.controller';
import { MusicMediaService, Song_Data, Song_Playlist_Identifier } from './music.media.service';

export enum Skip_Event {
    DEFAULT,
    FORCE,
    SONG_BLEND,
}

@Injectable({
  providedIn: 'root'
})
export class MusicPlayerService {
    @Output() open_player: EventEmitter<void> = new EventEmitter();
    @Output() reduce_player: EventEmitter<void> = new EventEmitter();


    private buffer_controller: BufferController;

    public current: Song_Data | null = null;
    private _shuffle: boolean = false;
    private _repeat: boolean = false;
    public play_next_queue: string[] = [];
    public playlist_queue: string[] = [];
    public song_cache: Map<string, Song_Data> = new Map<string, Song_Data>();


    get preloaded_next_song(): boolean {
        return false;
    }
    get previous_song_exists(): boolean {
        return false;
    }
    get player_status(): 'loading' | 'playing' | 'paused' | 'stopped' {
        return 'stopped';
    }
    get song_time_elapsed(): number {
        return 0;
    }
    get song_duration(): number {
        return 0;
    }
    get shuffle(): boolean {
        return this._shuffle;
    }
    set shuffle(value: boolean) {
        this._shuffle = value;
    }
    get repeat(): boolean {
        return this._repeat;
    }
    set repeat(value: boolean) {
        this._repeat = value;
    }
    get playlist_identifier(): Song_Playlist_Identifier | null {
        return null;
    }


    constructor(private media: MusicMediaService) {
        this.buffer_controller = new BufferController();
    }

    public play(): void {
        this.buffer_controller.play("http://localhost:3000/hls/session/09d1380e-0cc1-4125-bb3a-bc68b0ac5ba9/master.m3u8");
    }
    
    public pause(): void {
        this.buffer_controller.pause();
    }

    public toggle_play(): void {
        // Implement play/pause toggle logic
        if (this.buffer_controller.is_playing) {
            this.pause();
        } else {
            this.play();
        }
    }

    public set_audio_element(element: HTMLMediaElement | HTMLAudioElement): void {
        this.buffer_controller.set_audio_element(element);
        console.log('Audio element set in MusicPlayerService.');
    }

    public skip_to_next(event: Skip_Event = Skip_Event.DEFAULT, event_data: any = {}): void {
        // Implement skip to next song logic
        this.buffer_controller.play('http://localhost:3000/hls/session/76599b37-c191-4df3-a219-aaffee496b97/master.m3u8');
    }

    public skip_to_previous(event: Skip_Event = Skip_Event.DEFAULT, event_data: any = {}): void {
        // Implement skip to previous song logic
        this.buffer_controller.play("http://localhost:3000/hls/session/09d1380e-0cc1-4125-bb3a-bc68b0ac5ba9/master.m3u8");
    }

    public seek_to(time: number): void {
        // Implement seek to specific time logic
    }

    public add_song_to_play_next(song: Song_Data): void {

    }

    public load_and_play_track(song: Song_Data): void {
        // Implement load and play track logic
    }

    public add_song_to_cache(song: Song_Data): void {
        const key = this.media.song_key(song.id);
        this.song_cache.set(key, song);
    }
}