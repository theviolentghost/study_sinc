import { Injectable, Injector } from '@angular/core';
import { Output, EventEmitter } from '@angular/core';

import BufferController from './media.player/buffer.controller';
import MusicMediaManager from './media.player/media.manager';
import { MusicMediaService, Song_Data, Song_Identifier, Song_Playlist, Song_Playlist_Identifier } from './music.media.service';
import { Skip_Event, Skip_Result } from './media.player/playlist.manager';
import { SettingsService } from './settings.service';
import { NotificationService } from './src/app/services/notification.service';
// import { DJMixingService, MixStyle } from './dj.mixing.service';

@Injectable({
  providedIn: 'root'
})
export class MusicPlayerService {
    @Output() open_player: EventEmitter<void> = new EventEmitter();
    @Output() reduce_player: EventEmitter<void> = new EventEmitter();
    @Output() song_changed: EventEmitter<void> = new EventEmitter();
    @Output() playlist_changed: EventEmitter<void> = new EventEmitter();
    @Output() clear_playlist_color: EventEmitter<void> = new EventEmitter();
    @Output() dj_mix_started: EventEmitter<void> = new EventEmitter();
    @Output() dj_crossfade_started: EventEmitter<void> = new EventEmitter();


    public buffer_controller: BufferController;
    public media_controller: MusicMediaManager;
    
    // DJ Mode integration
    // private dj_service: DJMixingService | null = null;
    private dj_prefetch_timeout: ReturnType<typeof setTimeout> | null = null;
    private dj_progress_check_interval: ReturnType<typeof setInterval> | null = null;

    // Track state for visibility change handling
    private was_playing_before_hide: boolean = false;
    private last_visibility_state: DocumentVisibilityState = 'visible';
    private visibility_change_handler: (() => void) | null = null;
    private page_show_handler: ((e: PageTransitionEvent) => void) | null = null;
    private page_hide_handler: ((e: PageTransitionEvent) => void) | null = null;
    private before_unload_handler: (() => void) | null = null;

    get current(): Song_Data | null {
        return this.media_controller.current_song;
    }
    set current(song: string | null) {
        this.media_controller.current_song = song;
    }
    public set_current_song(song: Song_Data | null): void {
        if(song) {
            const song_key = this.media.song_key(song.id);
            this.media_controller.current_song = song_key;
            this.media_controller.song_cache.set(song_key, song);
            this.media.save_song_to_indexDB(song_key, song);
        } else {
            this.media_controller.current_song = null;
        }
    }
    get media_data(): Song_Data | null {
        return this.media_controller.media_data;
    }
    get preloaded_next_song(): boolean {
        return this.media_controller.preloaded_next_song;
    }
    get previous_song_exists(): boolean {
        return this.media_controller.playlist_manager.has_previous_song;
    }
    get player_status(): 'playing' | 'paused' | 'stopped' {
        if(this.buffer_controller.stalled) return 'stopped';
        if(this.media_controller.is_current_song_loading()) return 'stopped';
        if(!this.buffer_controller?.has_audio || this.buffer_controller?.using_silent_source) return 'stopped';
        if(this.buffer_controller?.is_playing) return 'playing';
        return 'paused';
    }
    get song_time_elapsed(): number {
        if(this.media_controller.is_current_song_loading()) return 0; // song loaded doesnt match media data (aka loading song)
        return this.buffer_controller.current_time || 0;
    }
    get song_duration(): number {
        if(this.media_controller?.current_song?.video_duration && this.media_controller?.current_song?.video_duration > 0) return (this.media_controller?.current_song?.video_duration || 0) / 1000;
        if(this.media_controller.is_current_song_loading()) return 0; // song loaded doesnt match media data (aka loading song)
        return this.buffer_controller.duration;
    }
    get shuffle(): boolean {
        return this.media_controller.shuffle;
    }
    set shuffle(value: boolean) {
        this.media_controller.shuffle = value;
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
    get current_playlist(): Song_Playlist | null {
        return this.media_controller.playlist_manager.data;
    }
    set current_playlist(playlist: Song_Playlist | null) {
        this.media_controller.playlist_manager.data = playlist;
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
    get is_duration_accurate(): boolean {
        return this.media_controller?.current_song?.video_duration || (this.buffer_controller.fully_buffered && this.media_controller.is_current_song_loading() === false);
    }
    get is_progress_accurate(): boolean {
        return this.is_duration_accurate || this.buffer_controller.using_silent_source === false;
    }
    get loading_state(): 'fetching_video_id' | 'fetching_audio_stream' | 'fetching_audio_data' | 'loaded' | null {
        return this.media_controller.loading_state;
    }
    get is_playing(): boolean {
        return this.media_controller.buffer_controller.is_playing;
    }
    
    // DJ Mode getters
    get is_dj_mode_enabled(): boolean {
        return this.settings.dj_mode_enabled;
    }
    
    // get dj_mix_style(): MixStyle {
    //     return this.settings.dj_mix_style as MixStyle;
    // }

    constructor(private media: MusicMediaService, private settings: SettingsService, private notification_service: NotificationService, private injector: Injector) {
        this.buffer_controller = new BufferController(this.settings, null);
        // Pass the buffer_controller to media_controller so they share the same instance
        this.media_controller = new MusicMediaManager(this.media, this.settings, this, this.buffer_controller, this.notification_service);
        // Now set the controller reference in buffer_controller
        this.buffer_controller.set_controller(this.media_controller);
        
        // Lazy load DJ service to avoid circular dependency
        // setTimeout(() => {
        //     this.dj_service = this.injector.get(DJMixingService);
        //     this.setup_dj_event_handlers();
        // }, 0);

        // Handle visibility change
        // this.visibility_change_handler = () => {
        //     if (document.visibilityState === 'hidden') {
        //         this.was_playing_before_hide = this.is_playing;
        //         this.pause();
        //     } else if (document.visibilityState === 'visible' && this.was_playing_before_hide) {
        //         this.play();
        //     }
        //     this.last_visibility_state = document.visibilityState;
        // };
        // document.addEventListener('visibilitychange', this.visibility_change_handler);

        // // Handle page hide (more reliable than beforeunload for PWAs)
        // this.page_hide_handler = (e: PageTransitionEvent) => {
        //     console.log('📴 Page hide event, persisted:', e.persisted);
        //     this.was_playing_before_hide = this.is_playing;
        //     // Release audio session to prevent stale state
        //     this.buffer_controller.release();
        // };
        // window.addEventListener('pagehide', this.page_hide_handler);

        // // Handle page show (returning to app)
        // this.page_show_handler = async (e: PageTransitionEvent) => {
        //     console.log('📱 Page show event, persisted:', e.persisted);
        //     if (e.persisted || this.last_visibility_state === 'hidden') {
        //         // Page was restored from bfcache or coming back from background
        //         await this.buffer_controller.reinitialize();
        //         if (this.was_playing_before_hide) {
        //             // Small delay to let audio session settle
        //             setTimeout(() => this.play(), 100);
        //         }
        //     }
        // };
        // window.addEventListener('pageshow', this.page_show_handler);

        // Handle before unload (backup for browsers that don't fire pagehide)
        this.before_unload_handler = () => {
            console.log('🚪 Before unload event');
            this.buffer_controller.release();
        };
        window.addEventListener('beforeunload', this.before_unload_handler);
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

        // Listen for custom song_ended event from BufferController
        // this.buffer_controller.events.addEventListener('song_ended', (event: Event) => {
        //     const customEvent = event as CustomEvent;

        //     // if(customEvent.detail.reason === 'buffered_to_end') {
        //     //     // dont skip, juts confirm length and that we are fully buffered
        //     //     return;
        //     // }

        //     console.log('song_ended event received in MusicPlayerService:', customEvent.detail);
            
        //     // Auto-skip to next track
        //     if (
        //         this.media_controller.buffer_controller.has_audio &&
        //         this.media_controller.buffer_controller.fully_buffered
        //     ) {
        //         this.skip_to_next(Skip_Event.DEFAULT);
        //     }
        // });

        // element.addEventListener('ended', () => {
        //     // for other browsers that dont need safari workaround
        //     if(this.media_controller.buffer_controller.has_audio) {
        //         this.skip_to_next(Skip_Event.DEFAULT);
        //     }
        // });
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
        this.add_song_to_cache(song);
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
            const next_song_key = this.media_controller.playlist_manager.next_song_key_in_queue!;
            // this.skip_to_next(Skip_Event.OMIT_HISTORY);
            this.load_and_play_track(next_song_key);
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
    
    // ==================== DJ Mode Methods ====================
    
    /**
     * Set up event handlers for DJ service
     */
    private setup_dj_event_handlers(): void {
        // if (!this.dj_service) return;
        
        // this.dj_service.mix_started.subscribe(() => {
        //     console.log('🎧 DJ mix started');
        //     this.dj_mix_started.emit();
        // });
        
        // this.dj_service.crossfade_started.subscribe(() => {
        //     console.log('🎧 DJ crossfade started');
        //     this.dj_crossfade_started.emit();
        // });
        
        // this.dj_service.mix_completed.subscribe(() => {
        //     console.log('🎧 DJ mix completed');
        //     // Update current song to the next song after mix completes
        //     const next_song = this.dj_service?.state.next_song;
        //     if (next_song) {
        //         this.set_current_song(next_song);
        //         this.song_changed.emit();
                
        //         // Start prefetching the next mix if auto-transition is enabled
        //         if (this.settings.dj_auto_transition) {
        //             this.schedule_dj_prefetch();
        //         }
        //     }
        // });
    }
    
    /**
     * Start DJ progress monitoring to trigger prefetch at the right time
     */
    public start_dj_progress_monitoring(): void {
        if (!this.settings.dj_mode_enabled || !this.settings.dj_auto_transition) return;
        
        this.stop_dj_progress_monitoring();
        
        // Check every 5 seconds
        this.dj_progress_check_interval = setInterval(() => {
            this.check_and_prefetch_dj_mix();
        }, 5000);
    }
    
    /**
     * Stop DJ progress monitoring
     */
    public stop_dj_progress_monitoring(): void {
        if (this.dj_progress_check_interval) {
            clearInterval(this.dj_progress_check_interval);
            this.dj_progress_check_interval = null;
        }
        if (this.dj_prefetch_timeout) {
            clearTimeout(this.dj_prefetch_timeout);
            this.dj_prefetch_timeout = null;
        }
    }
    
    /**
     * Check if we should prefetch the next DJ mix
     */
    private check_and_prefetch_dj_mix(): void {
        // if (!this.dj_service || !this.settings.dj_mode_enabled) return;
        // if (this.dj_service.is_dj_mode_active) return; // Already in a mix
        
        // const duration = this.song_duration;
        // const elapsed = this.song_time_elapsed;
        // const remaining = duration - elapsed;
        
        // // Prefetch when 60 seconds remaining (or 30% remaining for short songs)
        // const prefetch_threshold = Math.max(60, duration * 0.3);
        
        // if (remaining <= prefetch_threshold && remaining > 10) {
        //     this.schedule_dj_prefetch();
        // }
    }
    
    /**
     * Schedule a DJ mix prefetch
     */
    private schedule_dj_prefetch(): void {
        // if (this.dj_prefetch_timeout) return; // Already scheduled
        
        // const next_song_key = this.media_controller.playlist_manager.next_song_key;
        // if (!next_song_key) return;
        
        // const current_song = this.current;
        // if (!current_song) return;
        
        // console.log('🎧 Scheduling DJ mix prefetch...');
        
        // this.dj_prefetch_timeout = setTimeout(async () => {
        //     try {
        //         await this.dj_service?.prefetch_mix(
        //             current_song,
        //             next_song_key,
        //             'high',
        //             // this.dj_mix_style
        //         );
        //         console.log('🎧 DJ mix prefetched successfully');
        //     } catch (error) {
        //         console.error('Error prefetching DJ mix:', error);
        //     }
        //     this.dj_prefetch_timeout = null;
        // }, 1000);
    }
    
    /**
     * Trigger a DJ transition to the next song
     * This replaces the normal skip behavior when DJ mode is enabled
     */
    // public async dj_transition_to_next(): Promise<boolean> {
        // if (!this.dj_service || !this.settings.dj_mode_enabled) {
        //     return false;
        // }
        
        // const current_song = this.current;
        // const next_song_key = this.media_controller.playlist_manager.next_song_key;
        
        // if (!current_song || !next_song_key) {
        //     console.log('🎧 Cannot DJ transition: missing current or next song');
        //     return false;
        // }
        
        // try {
        //     console.log('🎧 Starting DJ transition...');
        //     await this.dj_service.create_and_play_mix(
        //         current_song,
        //         next_song_key,
        //         'high',
        //         // this.dj_mix_style
        //     );
            
        //     // Remove the next song from the queue since it's now part of the mix
        //     this.remove_song_from_playlist_queue(next_song_key);
            
        //     return true;
        // } catch (error) {
        //     console.error('DJ transition failed:', error);
        //     return false;
        // }
    // }
    
    /**
     * Stop the current DJ mix and return to normal playback
     */
    // public stop_dj_mix(): void {
    //     this.dj_service?.stop_mix();
    // }
    
    /**
     * Get the DJ service for direct access
     */
    // public get dj(): DJMixingService | null {
    //     return this.dj_service;
    // }
}