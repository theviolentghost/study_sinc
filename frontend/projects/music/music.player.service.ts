import { Injectable } from '@angular/core';
import { Output, EventEmitter } from '@angular/core';

import { MusicMediaService, Song_Identifier, Song_Data, Song_Playlist, Song_Playlist_Identifier } from './music.media.service';
import { PlaylistsService } from './playlists.service';
import Hls from 'hls.js';

export enum Player_Error {
    NO_AUDIO = 'No audio playing',
    COULD_NOT_LOAD = 'Could not load audio',
    AUDIO_TIMED_OUT = 'Audio timed out',
}

@Injectable({
  providedIn: 'root'
})
export class MusicPlayerService {
    @Output() open_player: EventEmitter<void> = new EventEmitter<void>();
    @Output() reduce_player: EventEmitter<void> = new EventEmitter<void>();
    @Output() track_loaded: EventEmitter<void> = new EventEmitter<void>();
    @Output() song_changed: EventEmitter<void> = new EventEmitter<void>();
    @Output() song_error: EventEmitter<Player_Error> = new EventEmitter<Player_Error>();
    @Output() playlist_changed: EventEmitter<void> = new EventEmitter<void>();
    @Output() clear_playlist_color: EventEmitter<void> = new EventEmitter<void>();
    @Output() hls_level_changed: EventEmitter<{index: number, details: any, levels: number}> = new EventEmitter<{index: number, details: any, levels: number}>();

    set_audio_element(element: HTMLAudioElement | null): void {
        this.audio_element = element;

        // Initialize audio context for iOS
        if (this.is_ios_safari && element && !this.audio_context) {
            this.initialize_audio_context();
        }

        this.setup_media_session_action_handlers();
        this.setup_audio_event_listeners();
        this.setup_visibility_change_listeners();
    }

    private initialize_audio_context(): void {
        try {
            // Create audio context for iOS audio session management
            this.audio_context = new (window.AudioContext || (window as any).webkitAudioContext)();
            
            // Create a media element source and connect it to destination
            // This keeps the audio pipeline active on iOS
            if (this.audio_element && !this.audio_source_node) {
                this.audio_source_node = this.audio_context.createMediaElementSource(this.audio_element);
                this.audio_source_node.connect(this.audio_context.destination);
            }

            console.log('Audio context initialized for iOS:', this.audio_context.state);
        } catch (error) {
            console.error('Error initializing audio context:', error);
        }
    }

    private async resume_audio_context(): Promise<void> {
        if (this.audio_context && this.audio_context.state === 'suspended') {
            try {
                await this.audio_context.resume();
                console.log('Audio context resumed:', this.audio_context.state);
            } catch (error) {
                console.error('Error resuming audio context:', error);
            }
        }
    }

    set_thumbnail_element(element: HTMLImageElement | null): void {
        this.thumbnail_element = element;
    }

    get player_status(): 'loading' | 'playing' | 'paused' | 'stopped' {
        if (!this.audio_element) return 'stopped';
        if (!this.audio_data.current.loaded) return 'loading'; // middle of loading song/
        if (this.audio_element.readyState < 2) return 'loading'; // Not enough data to play
        
        // for iOS safari when in background
        if(this.playing_silent_audio) return 'paused';
        if (this.audio_element.paused) return 'paused';
        return 'playing';
    }

    private real_audio_timestamp: number = 0; // To track real audio time when using silent audio
    private real_audio_duration: number = 0; // To track real audio duration when using silent audio
    get timestamp(): number {
        if (this.playing_silent_audio) {
            return this.real_audio_timestamp;
        }
        return this.audio_element?.currentTime || 0;
    }

    get duration(): number {
        if (this.playing_silent_audio) {
            return this.real_audio_duration;
        }
        return ((this.audio_data.current?.data?.video_duration || 0) / 1000) || this.audio_element?.duration || 0;
    }

    get shuffle(): boolean {
        return this._shuffle;
    }

    set shuffle(value: boolean) {
        this._shuffle = value;
        if(value) {
            this.shuffle_playlist();
        } else {
            this.unshuffle_playlist();
        }
    }

    get disco_mode(): boolean {
        return this._disco_mode;
    }

    set disco_mode(value: boolean) {
        this._disco_mode = value;
        if (value) {
            this.start_visualizer();
        } else {
            this.stop_visualizer();
        }
    }

    get song_data(): Song_Data | null {
        return this.audio_data.current.data;
    }

    set song_data(value: Song_Data | null) {
        this.audio_data.current.data = value;
    }

    get loaded_current_song(): boolean {
        return this.audio_data.current.loaded;
    }

    get preloaded_next_song(): boolean {
        return this.audio_data.next.loaded;
    }

    get previous_song_exists(): boolean {
        return this.playlist.history_stack.length > 0;
    }

    get playlist_identifier(): Song_Playlist_Identifier | null {
        return this.playlist.identifier;
    }

    get playlist_data(): Song_Playlist | null {
        return this.playlist.data;
    }

    get play_next_queue(): string[] {
        return this.playlist.play_next;
    }

    set play_next_queue(value: string[]) {
        this.playlist.play_next = value;
    }

    get playlist_queue(): string[] {
        return this.playlist.queue;
    }

    set playlist_queue(value: string[]) {
        this.playlist.queue = value;
    }

    get is_silent_audio_allowed(): boolean {
        return this.is_ios_safari;
    }

    get use_silent_audio(): boolean {
        return this.use_silent_audio_to_preserve_audio_pipeline;
    }

    set use_silent_audio(value: boolean) {
        this.use_silent_audio_to_preserve_audio_pipeline = value;
    }   

    constructor(private media: MusicMediaService, private playlist_service: PlaylistsService) {}

    private audio_data: {
        current: {
            identifier: Song_Identifier | null;
            data: Song_Data | null;
            loaded: boolean;
            audio_source: string | null;
            source_type: 'm3u8' | 'blob' | 'external' | null; // where its coming from
        },
        next: {
            identifier: Song_Identifier | null;
            data: Song_Data | null;
            loaded: boolean;
            audio_source: string | null;
            source_type: 'm3u8' | 'blob' | 'external' | null; // where its coming from
        }
    } = {current: {identifier: null, data: null, loaded: false, audio_source: null, source_type: null}, next: {identifier: null, data: null, loaded: false, audio_source: null, source_type: null}};

    public song_cache: Map<string, Song_Data> = new Map<string, Song_Data>();
    private playlist: {
        data: Song_Playlist | null;
        identifier: Song_Playlist_Identifier | null;
        play_next: string[]; // same as queue, jus has priority and doesnt get changed on playlist changes
        queue: string[];
        history_stack: string[];
    } = { data: null, identifier: null, play_next: [], queue: [], history_stack: [] };

    private use_silent_audio_to_preserve_audio_pipeline: boolean = true;
    private readonly silent_audio_source: string = '/music/audio/silent.mp3';
    private playing_silent_audio: boolean = false;
    private is_app_in_foreground: boolean = true;

    private audio_element: HTMLAudioElement | null = null;
    private thumbnail_element: HTMLImageElement | null = null;
    private hls: Hls | null = null;
    private readonly hls_supported: boolean = Hls.isSupported();
    private audio_context: AudioContext | null = null;
    private audio_source_node: MediaElementAudioSourceNode | null = null;

    private is_ios_safari = /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase()) && /safari/.test(navigator.userAgent.toLowerCase()) && !/crios|fxios|edgios|opr\//.test(navigator.userAgent.toLowerCase());
    private was_playing_before_background: boolean = false;
    private last_time_update: number = 0;
    private stall_check_interval: any = null;

    // outside paramaters
    private _shuffle: boolean = false;
    public repeat: number = 0; // 0 = no repeat, 1 = repeat infinitely
    private _disco_mode: boolean = false;

    private _audio_quality: number = -1; // -1 = automatic
    set audio_quality(value: number) {
        this._audio_quality = value;
        
        // Update HLS quality level if HLS is active
        if (this.hls) {
            // -1 means auto, otherwise set to specific level
            this.hls.currentLevel = value;
            console.log(`HLS quality level set to: ${value === -1 ? 'auto' : value}`);
        }
    }

    get audio_quality(): number {
        return this._audio_quality;
    }

    public seek_to(seconds: number): void {
        if(!this.audio_element) return;
        this.audio_element.currentTime = seconds;
        this.update_playback_state();
    }

    public toggle_play(): void {
        if (this.player_status === 'playing') {
            this.pause();
        } else {
            this.play();
        }
    }

    public async play(): Promise<boolean> {
        if(!this.audio_element) return false;

        console.log('starting visualizer');
        this.start_visualizer(); // temp

        // Resume audio context if suspended (iOS fix)
        if (this.is_ios_safari && this.audio_context) {
            await this.resume_audio_context();
        }

        if(this.playing_silent_audio) {
            // playing silent audio, switch back to real audio
            await this.switch_from_silent_audio_to_real_audio();
            return this.play_audio();
        }

        // Ensure audio element is not muted or at zero volume (iOS PWA safeguard)
        if(this.audio_element.muted) {
            console.warn('Audio element was muted, unmuting');
            this.audio_element.muted = false;
        }
        if(this.audio_element.volume === 0) {
            console.warn('Audio element volume was 0, resetting to 1');
            this.audio_element.volume = 1;
        }

        // Add to recently played
        if(this.audio_data.current.data) {
            this.playlist_service.add_to_recently_played(this.audio_data.current.data);
        }

        return this.play_audio();
    }

    private async play_audio(): Promise<boolean> {
        try {
            // Double-check we're not trying to play silent audio when we shouldn't be
            if(this.audio_element.src.includes(this.silent_audio_source) && !this.playing_silent_audio) {
                console.error('Detected silent audio source when not in silent mode, aborting play');
                // Try to reload the real audio
                if(this.audio_data.current.audio_source && this.audio_data.current.source_type) {
                    await this.load_audio(this.audio_data.current.audio_source, this.audio_data.current.source_type);
                    // Retry play after reloading
                    await this.audio_element.play();
                    this.update_playback_state();
                    return true;
                }
                return false;
            }
            
            await this.audio_element.play();
            this.update_playback_state();
            return true;
        } catch (error) {
            console.error('Error playing audio:', error);
            return false;
        }
    }

    private switching_from_silent: boolean = false;
    private async switch_from_silent_audio_to_real_audio(): Promise<boolean> {
        try {
            if(!this.audio_data.current.audio_source) return false; // no audio source to switch to

            console.log('Switching from silent to real audio, source:', this.audio_data.current.audio_source);
            
            // Mark that we're switching to prevent race conditions
            this.switching_from_silent = true;
            
            await this.load_audio(this.audio_data.current.audio_source, this.audio_data.current.source_type);
            
            // Reset the silent audio flag BEFORE calling play
            this.playing_silent_audio = false;
            
            this.audio_element.play();
            this.update_playback_state();
            this.update_media_session();
            return true;
        } catch (error) {
            console.error('Error switching from silent to real audio:', error);
            // Reset flags on error
            this.switching_from_silent = false;
            this.playing_silent_audio = false;
            return false;
        }
    }

    private async switch_from_real_audio_to_silent_audio(): Promise<boolean> {
        try {
            this.real_audio_duration = this.audio_element?.duration || 0;
            this.real_audio_timestamp = this.audio_element?.currentTime || 0;

            await this.load_audio(this.silent_audio_source, 'external');
            this.audio_element.play();

            this.playing_silent_audio = true;
            this.update_playback_state();
            this.update_media_session(); // update media session to show paused state

            return true;
        } catch (error) {
            console.error('Error switching from real to silent audio:', error);
            return false;
        }
    }

    public async pause(): Promise<boolean> {
        if(!this.audio_element) return false;
        if(this.audio_element.paused) return true; // already paused
        if(this.playing_silent_audio) return true; // silent audio is paused state

        if(!this.is_app_in_foreground && this.use_silent_audio_to_preserve_audio_pipeline && this.is_ios_safari) {
            // If the app is in the background on iOS Safari, we need to play silent audio to keep the audio pipeline alive
            this.switch_from_real_audio_to_silent_audio();
            return true;
        }

        return this.stop_audio();
    }

    private async stop_audio(): Promise<boolean> {
        try {
            this.audio_element?.pause();
            this.update_playback_state();
        } catch (error) {
            console.error('Error stopping audio:', error);
            return false;
        }
        return true;
    }

    private async load_audio(source_url: string, source_type: 'm3u8' | 'blob' | 'external' | null): Promise<boolean> {
        if (!this.audio_element) return false;

        console.log('Loading audio source:', source_url, 'type:', source_type, 'silent audio state:', this.playing_silent_audio);

        // pause current audio
        this.audio_element.pause();

        switch (source_type) {
            case 'm3u8':
                // use hls
                if(this.hls_supported) {
                    if(!this.hls) this.set_up_http_live_streaming();
                    if(this.is_m3u8_source(source_url)) {
                        this.hls.loadSource(source_url);
                        return true;
                    } else {
                        console.error('Provided source URL does not appear to be an m3u8 source:', source_url);
                    }
                    
                    return false;
                }
                // if not supported, fallback to normal loading
                return this.load_audio(source_url, 'external');
            case 'blob':
            case 'external':
            default:
                this.audio_element.src = source_url;
                this.audio_element.load();
                return true;
        }
    }

    public is_m3u8_source(source_url: string): boolean {
        return source_url.endsWith('.m3u8');
    }

    private set_up_http_live_streaming(): void {
        // hls
        if(!this.audio_element) return;
        if(!this.hls_supported) {
            console.warn('HLS is not supported in this browser.');
        }
        if (this.hls) {
            console.warn('HLS instance already exists, destroying existing instance.');
            this.hls.destroy();
        }

        this.hls = new Hls({
            startLevel: -1, // Start with auto quality selection
            autoStartLoad: true, 
            enableWorker: true, 
            maxBufferLength: 120, // Increase buffer length
            maxMaxBufferLength: 150, // Max buffer size
            maxBufferSize: 60 * 1000 * 1000, // 60MB buffer
            
            // ✅ Segment loading optimization
            fragLoadingTimeOut: 4000,   // Increase timeout
            fragLoadingMaxRetry: 3,     // More retries
            fragLoadingRetryDelay: 1000,
            
            // ✅ Manifest loading
            manifestLoadingTimeOut: 1000,
            manifestLoadingMaxRetry: 50,
            manifestLoadingRetryDelay: 500
        });

        this.hls.attachMedia(this.audio_element!);

        this.hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
            this.hls_level_changed.emit({index: data.level, details: this.hls?.levels[data.level] || null, levels: this.hls?.levels.length || 0});
        });
        this.hls.on(Hls.Events.ERROR, (event, data) => {
            // console.error('HLS error:', data);

            if(data.fatal) {
                this.song_error.emit(Player_Error.COULD_NOT_LOAD);
            }
        });
        console.log('🎵 HLS attached to audio element:', this.audio_element);
    }

    public update_media_session(song_data: Song_Data = this.audio_data.current.data): void {
        if (!('mediaSession' in navigator) || !navigator.mediaSession) return;

        if(!song_data) {
            console.warn('No song data provided to update_media_session');
            return;
        }
        this.audio_data.current.data = song_data;
        this.setup_media_session_action_handlers(); // ensure handlers are set up each time we update metadata

        const has_artwork_ready = 
            (song_data.download_artwork_blob) ||
            (song_data.url.artwork.low && song_data.url.artwork.low !== '') ||
            (song_data.url.artwork.high && song_data.url.artwork.high !== '');
        
        const artwork_url = 
            has_artwork_ready ? 
                song_data.download_artwork_blob
                    ? URL.createObjectURL(song_data.download_artwork_blob)
                : song_data.url.artwork.high ??
                song_data.url.artwork.low
            : '';

        this.thumbnail_element.src = artwork_url;
        if (!song_data?.colors?.common) {
            // generate colors from artwork
            this.media.get_top_colors_from_artwork(artwork_url).then(colors => {
                song_data.colors.common = colors;
            });
        }

        // Update album texture for visualizer when thumbnail changes
        if (this.visualizer_active && artwork_url) {
            // Wait a bit for the image to load, then update texture
            setTimeout(() => {
                this.create_album_texture();
            }, 100);
        }

        navigator.mediaSession.metadata = new MediaMetadata({
            title: song_data.song_name || '',
            artist: 
                (song_data?.original_artists.map(artist => artist.name).join(', ') || '') + (this.playing_silent_audio ? ' (paused)' : ''),
            album: '',
            artwork: [
                { 
                    src: artwork_url,
                    sizes: '512x512',
                    type: 'image/png' 
                }
            ]
        });

        if(!has_artwork_ready) {
            // fetch artwork url from backend then update media session again
        }
    }

    private update_playback_state(): void {
        if (!('mediaSession' in navigator) || !navigator.mediaSession || !this.audio_element) return;

        if(this.playing_silent_audio) {
            console.log('Updating playback state for silent audio');
            return this.update_playback_state_for_silent_audio();
        }

        this.audio_element.loop = false;

        const playback_state: MediaSessionPlaybackState = this.audio_element.paused ? 'paused' : 'playing';
        navigator.mediaSession.playbackState = playback_state;
        navigator.mediaSession.setPositionState({
            duration: this.duration || 0,
            playbackRate: 1.0,
            position: this.audio_element.currentTime || 0
        });
    }

    private update_playback_state_for_silent_audio(): void {
        if (!('mediaSession' in navigator) || !navigator.mediaSession) return;

        this.audio_element.loop = true;

        const playback_state: MediaSessionPlaybackState = 'paused';
        navigator.mediaSession.playbackState = playback_state;
        navigator.mediaSession.setPositionState({
            duration: this.real_audio_duration || 0,
            playbackRate: 1.0,
            position: this.real_audio_timestamp || 0
        });
    }

    private setup_media_session_action_handlers(): void {
        if (!('mediaSession' in navigator) || !navigator.mediaSession) return;
        
        navigator.mediaSession.setActionHandler('play', () => {
            // console.log('Media session play action triggered');
            this.play();
        });
        navigator.mediaSession.setActionHandler('pause', () => {
            // console.log('Media session pause action triggered');
            if(this.playing_silent_audio) {
                // account for visual mismatch
                this.play();
                return;
            }
            this.pause();
        });
        navigator.mediaSession.setActionHandler('previoustrack', () => {
            this.skip_to_previous();
        });
        navigator.mediaSession.setActionHandler('nexttrack', () => {
            this.skip_to_next();
        });
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if(this.audio_element && details.seekTime !== undefined) {
                this.seek_to(details.seekTime);
            }
        });
    }

    private setup_audio_event_listeners(): void {
        if(!this.audio_element) return;

        this.audio_element.addEventListener('loadedmetadata', () => {
            // Metadata loaded, ready to play
            console.log('Metadata loaded, switching_from_silent:', this.switching_from_silent, 'playing_silent:', this.playing_silent_audio);
            
            this.track_loaded.emit();
            this.audio_data.current.loaded = true;
            
            if (this.wants_to_play) {
                this.play();
                this.wants_to_play = false;
            }
            
            if(this.switching_from_silent) {
                this.switching_from_silent = false;
                // start interval that waits until audio duration is greater or equal to real_audio_timestamp then set current time
                const checkInterval = setInterval(() => {
                    if (this.audio_element!.duration >= this.real_audio_timestamp) {
                        this.audio_element!.currentTime = this.real_audio_timestamp;
                        this.update_playback_state();
                        // Reset the stored timestamp after restoring
                        this.real_audio_timestamp = 0;
                        this.real_audio_duration = 0;
                        clearInterval(checkInterval);
                    }
                }, 100);
            }
        });
        this.audio_element.addEventListener('play', () => {
            this.update_playback_state();
            this.start_visualizer();
            // Start monitoring for stalls on iOS
            if (this.is_ios_safari) {
                this.start_stall_detection();
            }
        });
        this.audio_element.addEventListener('pause', () => {
            this.update_playback_state();
            this.stop_visualizer();
            // Stop monitoring when paused
            if (this.is_ios_safari) {
                this.stop_stall_detection();
            }
        });
        this.audio_element.addEventListener('ended', () => {
            this.skip_to_next();
            this.update_playback_state();
        });
        this.audio_element.addEventListener('timeupdate', () => {
            this.update_playback_state();
        });
        this.audio_element.addEventListener('error', (event) => {
            console.error('Audio element error:', event);
            this.song_error.emit(Player_Error.COULD_NOT_LOAD);
            this.update_playback_state();
        });
    }

    private setup_visibility_change_listeners(): void {
        document.addEventListener('visibilitychange', async () => {
            const is_visible = document.visibilityState === 'visible';
            const was_in_foreground = this.is_app_in_foreground;
            this.is_app_in_foreground = is_visible;
            
            console.log('App visibility changed:', is_visible ? 'foreground' : 'background');
            
            if (is_visible && !was_in_foreground) {
                // Coming back to foreground
                await this.handle_return_to_foreground();
            } else if (!is_visible && was_in_foreground) {
                // Going to background
                this.handle_going_to_background();
            }
        });
        
        (document as any).addEventListener('webkitvisibilitychange', async () => {
            const is_visible = document.visibilityState === 'visible';
            const was_in_foreground = this.is_app_in_foreground;
            this.is_app_in_foreground = is_visible;
            
            if (is_visible && !was_in_foreground) {
                await this.handle_return_to_foreground();
            } else if (!is_visible && was_in_foreground) {
                this.handle_going_to_background();
            }
        });
        
        window.addEventListener('focus', async () => {
            if (!this.is_app_in_foreground) {
                this.is_app_in_foreground = true;
                await this.handle_return_to_foreground();
            }
        });
        
        window.addEventListener('blur', () => {
            if (this.is_app_in_foreground) {
                this.is_app_in_foreground = false;
                this.handle_going_to_background();
            }
        });
        
        window.addEventListener('pagehide', (e) => {
            this.is_app_in_foreground = false;
            this.handle_going_to_background();
        }, { capture: true });

        window.addEventListener('pageshow', async (e) => {
            if (!this.is_app_in_foreground) {
                this.is_app_in_foreground = true;
                await this.handle_return_to_foreground();
            }
        }, { capture: true });
    }

    private handle_going_to_background(): void {
        // Track if audio was playing when going to background
        this.was_playing_before_background = this.player_status === 'playing' && !this.playing_silent_audio;
        console.log('Going to background, was playing:', this.was_playing_before_background);
    }

    private start_stall_detection(): void {
        // Clear any existing interval
        this.stop_stall_detection();
        
        this.last_time_update = this.audio_element?.currentTime || 0;
        
        // Check every 2 seconds if audio is actually progressing
        this.stall_check_interval = setInterval(() => {
            if (!this.audio_element || this.audio_element.paused || this.playing_silent_audio) {
                return;
            }
            
            const current_time = this.audio_element.currentTime;
            
            // If time hasn't changed in 2 seconds and we're supposed to be playing
            if (current_time === this.last_time_update && !this.audio_element.paused) {
                console.warn('Audio stall detected on iOS! Attempting to recover...');
                this.recover_from_stall();
            }
            
            this.last_time_update = current_time;
        }, 2000);
    }

    private stop_stall_detection(): void {
        if (this.stall_check_interval) {
            clearInterval(this.stall_check_interval);
            this.stall_check_interval = null;
        }
    }

    private async recover_from_stall(): Promise<void> {
        if (!this.audio_element) return;
        
        console.log('Attempting to recover from stalled audio...');
        
        const currentTime = this.audio_element.currentTime;
        const wasPlaying = !this.audio_element.paused;
        
        try {
            // Resume audio context first
            if (this.audio_context) {
                await this.resume_audio_context();
            }
            
            // Force audio element refresh
            this.audio_element.pause();
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Check and fix volume/mute
            if (this.audio_element.muted) {
                this.audio_element.muted = false;
            }
            if (this.audio_element.volume === 0) {
                this.audio_element.volume = 1;
            }
            
            // Restore position and play if it was playing
            this.audio_element.currentTime = currentTime;
            if (wasPlaying) {
                await this.audio_element.play();
                console.log('Successfully recovered from stall');
            }
            
            this.update_playback_state();
        } catch (error) {
            console.error('Failed to recover from stall:', error);
        }
    }

    private async handle_return_to_foreground(): Promise<void> {
        console.log('Returning to foreground, was playing before:', this.was_playing_before_background);
        
        // Resume audio context if it was suspended
        if (this.is_ios_safari && this.audio_context) {
            await this.resume_audio_context();
        }

        // Check if HLS needs to be recovered
        if (this.hls && this.is_ios_safari && this.audio_data.current.source_type === 'm3u8') {
            // HLS might have lost connection, check if it needs recovery
            if (this.hls.media && this.hls.media.error) {
                console.warn('HLS has error after background, attempting recovery');
                this.hls.recoverMediaError();
            }
        }

        // If we were playing before going to background, try to resume
        if (this.was_playing_before_background && this.audio_element && !this.playing_silent_audio) {
            console.log('Attempting to resume playback after returning to foreground');
            
            // Double-check volume and mute state
            if (this.audio_element.muted) {
                console.warn('Audio was muted on return, unmuting');
                this.audio_element.muted = false;
            }
            if (this.audio_element.volume === 0) {
                console.warn('Volume was 0 on return, resetting');
                this.audio_element.volume = 1;
            }

            // If audio element thinks it's paused, try to play
            if (this.audio_element.paused) {
                console.log('Audio element is paused, attempting to resume');
                try {
                    await this.audio_element.play();
                    this.update_playback_state();
                } catch (error) {
                    console.error('Error resuming playback:', error);
                }
            } else {
                // Audio element thinks it's playing but might have no output
                // Force a reload by pausing and playing again
                console.log('Audio element reports playing, forcing refresh');
                const currentTime = this.audio_element.currentTime;
                this.audio_element.pause();
                await new Promise(resolve => setTimeout(resolve, 50));
                this.audio_element.currentTime = currentTime;
                try {
                    await this.audio_element.play();
                    this.update_playback_state();
                } catch (error) {
                    console.error('Error forcing audio refresh:', error);
                }
            }
        }
        
        // Reset the flag
        this.was_playing_before_background = false;
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

    private async create_blob_url_from_stale_blob(blob: Blob): Promise<string> {
        // used mainly for safari compatibility where reusing old blob urls can cause issues
        const array_buffer = await blob.arrayBuffer();
        if( array_buffer.byteLength > 0) {
            // fresh url with fresh blob
            return URL.createObjectURL(new Blob([array_buffer]));
        }
        throw new Error('Failed to create blob URL');
    }

    private wants_to_play: boolean = false;
    public async load_and_play_track(data: Song_Identifier | Song_Data | string): Promise<void> {
        this.wants_to_play = true;
        await this.load_track(data);
    }

    // use_refrence_source: if true, will use the source from the current audio data reference (useful for reloading same track after error or using preloaded track)
    public async load_track(data: Song_Identifier | Song_Data | string, load_type: 'current' | 'next' = 'current', use_reference_source: boolean = false): Promise<void> {
        let song_data: Song_Data | null = null;
        let song_identifier: Song_Identifier | null = null;
        let song_key: string | null = null;
        let load_source_into_audio_element: boolean = (load_type === 'current');

        if(load_type === 'current') {
            var audio_data_reference = this.audio_data.current;
        }
        else if(load_type === 'next') {
            var audio_data_reference = this.audio_data.next;
        } else {
            console.error('Invalid load_type provided to load_track:', load_type);
            return;
        }

        if(this.is_string(data)) {
            song_key = data;
            song_identifier = this.media.parse_song_key(data);
            console.log('Loading track by song key:', song_key, 'parsed identifier:', song_identifier);
            song_data = this.song_cache.get(song_key);


        }
        else if(this.is_song_identifier(data)) {
            song_key = this.media.song_key(data);
            song_identifier = data;
            song_data = this.song_cache.get(song_key);
        }
        else if(this.is_song_data(data)) {
            song_data = data;
            song_identifier = data.id;
            song_key = this.media.song_key(data.id);
        } else {
            console.error('Invalid data provided to load_track:', data);
            return;
        }

        // pause current audio and reset silent audio state
        if(load_type === 'current') {
            this.audio_element.pause();
            // Reset silent audio state when loading a new track
            this.playing_silent_audio = false;
            this.switching_from_silent = false;
            this.real_audio_timestamp = 0;
            this.real_audio_duration = 0;
            // this.preload_next_track();
        }

        // song identifier must be set now
        // and so should song_data if it was available in the cache
        if(!song_identifier) {
            console.error('No valid song identifier provided to load_track');
            return;
        }

        audio_data_reference.identifier = song_identifier;
        audio_data_reference.loaded = false;

        if(song_data) {
            if(load_type === 'current') this.update_media_session(song_data);
            audio_data_reference.data = song_data;
        }
        if(load_type === 'current') this.song_changed.emit();

        if(use_reference_source && audio_data_reference.audio_source && audio_data_reference.source_type) {
            // use existing source
            if(load_source_into_audio_element) this.load_audio(audio_data_reference.audio_source, audio_data_reference.source_type);
            return;
        }

        if(!song_data) {
            // load audio with the intent of streaming while fetching data in the background to make sure if it is downloaded: if so we can load it from blob
            let allow_optomistic_load: boolean = true;

            this.media.get_audio_stream(song_key).then((audio_source_url) => {
                if(!audio_source_url || audio_source_url === '' || !allow_optomistic_load) return;
                if(load_source_into_audio_element) this.load_audio(audio_source_url, 'm3u8');

                audio_data_reference.audio_source = audio_source_url;
                audio_data_reference.source_type = 'm3u8';
            });

            try {
                song_data = await this.media.get_song_data(song_key);
                if(song_data) {
                    // add to cache 
                    this.song_cache.set(song_key, song_data);
                    if(song_data.downloaded && song_data.download_audio_blob) {
                        allow_optomistic_load = false; // prevent stream and load from blob instead

                        const blob = await this.create_blob_url_from_stale_blob(song_data.download_audio_blob);
                        if(load_source_into_audio_element) this.load_audio(blob, 'blob');

                        audio_data_reference.audio_source = blob;
                        audio_data_reference.source_type = 'blob';
                    }

                    // allow original optimistic request stream to load if not downloaded
                    return;
                }

                return console.error('Could not load song data for', song_key);
            } catch (error) {
                console.error('Error fetching song data for', song_key, error);
                return;
            }
        }

        // here song_data and song_identifier must be set
        if(song_data && load_type === 'current') this.update_media_session(song_data);
        if(load_type === 'current') this.song_changed.emit();
        
        // load audio source
        if(song_data.downloaded && song_data.download_audio_blob) {
            const blob = await this.create_blob_url_from_stale_blob(song_data.download_audio_blob);
            if(load_source_into_audio_element) this.load_audio(blob, 'blob');

            audio_data_reference.audio_source = blob;
            audio_data_reference.source_type = 'blob';
        }
        else if(song_data.url.audio && song_data.url.audio !== '') {
            // using stored url
            if(load_source_into_audio_element) this.load_audio(song_data.url.audio, 'm3u8');

            audio_data_reference.audio_source = song_data.url.audio;
            audio_data_reference.source_type = 'm3u8';
        }
        else {
            await this.media.get_audio_stream(song_key).then((audio_source_url) => {
                if(load_source_into_audio_element) this.load_audio(audio_source_url, 'm3u8');

                audio_data_reference.audio_source = audio_source_url;
                audio_data_reference.source_type = 'm3u8';
            }).catch((error) => {
                console.error('Error fetching audio stream for', song_key, error);
            });
        }
    }

    private get_next_track_identifier(): Song_Identifier | null {
        if(this.playlist.play_next.length > 0) {
            // get next key without removing it from the array
            const next_key = this.playlist.play_next[0];
            return this.media.parse_song_key(next_key);
        }
        // if nothing in playnext check playlist queue
        if(this.playlist.queue.length > 0) {
            const next_key = this.playlist.queue[0];
            return this.media.parse_song_key(next_key);
        }
        
        // if gets to here try refilling playlist queue from playlist data
        if(this.playlist.data) {
            this.refill_playlist_queue_from_playlist_data();
            if(this.playlist.queue.length > 0) {
                const next_key = this.playlist.queue[0];
                return this.media.parse_song_key(next_key);
            }
        }

        return null; // no next track
    }

    private is_next_track_preloaded_in_play_next_queue(): boolean {
        if(this.playlist.play_next.length === 0) return false;
        const next_key = this.playlist.play_next[0];
        const next_identifier = this.media.parse_song_key(next_key);
        return this.is_track_the_same_as_preloaded(next_identifier);
    }

    private is_next_track_preloaded(): boolean {
        return this.audio_data.next.loaded;
    }
    private is_track_the_same_as_preloaded(track_identifier: Song_Identifier | null): boolean {
        if(!track_identifier || !this.audio_data.next.identifier) return false;
        return (track_identifier.video_id === this.audio_data.next.identifier.video_id);
    }

    public async preload_next_track(): Promise<void> {
        let next_identifier = this.get_next_track_identifier();
        console.log("next track", next_identifier);
        if(!next_identifier || next_identifier.video_id === null) {
            // try refilling playlist and try again
            this.refill_playlist_queue_from_playlist_data();
            next_identifier = this.get_next_track_identifier();
            if(!next_identifier || next_identifier.video_id === null) return; // no next track
        }
        if(this.is_track_the_same_as_preloaded(next_identifier)) return console.warn('Next track is already preloaded:', next_identifier); // already preloaded

        console.log('Preloading next track:', next_identifier);

        await this.load_track(next_identifier, 'next');
        // set next track loaded to true
        this.audio_data.next.loaded = true;
    }

    private skipping_to_next: boolean = false; // to prevent multiple skips at once
    public async skip_to_next(force: boolean = false): Promise<void> {
        if(this.skipping_to_next) return; // already skipping
        this.skipping_to_next = true;

        if(this.repeat === 1 && !force) {
            // repeat current song
            // this.load_and_play_track(this.audio_data.current.identifier);
            // set current some to start
            this.seek_to(0);
            this.play();
            this.skipping_to_next = false;
            return;
        }
        if(this.playlist.queue.length === 0) {
            // no next song
            console.warn('No next song in queue to skip to.');
            // refresh the queue using the songs in the current playlist
            if(this.playlist.data) {
                this.refill_playlist_queue_from_playlist_data();

                if(this.playlist.queue.length === 0) {
                    console.warn('Current playlist has no songs to load.');
                    this.skipping_to_next = false;
                    // restart song as there is nothing else to play
                    this.seek_to(0);
                    this.play();
                    return;
                }
            } else {
                this.skipping_to_next = false;
                return;
            }
            // return;
        }
        const current_song_key = this.media.song_key(this.audio_data.current.identifier);
        const next_song_key = this.playlist.play_next.length > 0 ? this.playlist.play_next.shift() : this.playlist.queue.shift();
        // console.log('Skipping to next song:', next_song_key);
        if(this.is_next_track_preloaded()) {
            // use preloaded next track
            console.log('Using preloaded next track:', next_song_key);
            console.log('Preloaded next track identifier:', this.audio_data.next.identifier);
            
            // Reset silent audio state before loading new track
            this.playing_silent_audio = false;
            this.switching_from_silent = false;
            this.real_audio_timestamp = 0;
            this.real_audio_duration = 0;
            
            this.load_and_play_track(this.audio_data.next.identifier);
            // switch next audio data to current
            this.audio_data.current = this.audio_data.next;
            // clear next audio data
            this.audio_data.next = {identifier: null, data: null, loaded: false, audio_source: null, source_type: null};
            this.preload_next_track(); // preload the next track after this one

            // add to history
            this.playlist.history_stack.push(current_song_key);
            this.skipping_to_next = false;
            return;
        }

        this.load_and_play_track(next_song_key);
        this.preload_next_track(); // preload the next track after this one

        // add to history
        this.playlist.history_stack.push(current_song_key);
        this.skipping_to_next = false;
    }

    private skipping_to_previous: boolean = false; // to prevent multiple skips at once
    public async skip_to_previous(): Promise<void> {
        if(this.skipping_to_previous) return; // already skipping
        // check to see if the song has been playing more than 15 seconds, if so just restart the song
        if(this.audio_element && this.audio_element.currentTime > 15) {
            this.seek_to(0);
            this.play();
            return;
        }
        if(!this.previous_song_exists) {
            console.warn('No previous song in history to skip to.');
            return;
        }
        this.skipping_to_previous = true;

        // set current track to preloaded track if it exists
        if(this.audio_data.current.loaded) {
            this.audio_data.next = {...this.audio_data.current};
        }

        const current_song_key = this.media.song_key(this.audio_data.current.identifier);
        const previous_song_key = this.playlist.history_stack.pop();
        this.load_and_play_track(previous_song_key);
        // add current to front of queue
        this.playlist.queue.unshift(current_song_key);
        this.skipping_to_previous = false;
    }

    private refill_playlist_queue_from_playlist_data(): void {
        if(this.playlist.data) {
            this.playlist.queue = Array.from(this.playlist.data.songs.values()).map(song_identifier => this.media.song_key(song_identifier));
            console.log('Refilled playlist queue with songs from current playlist:', this.playlist.queue);
            this.remove_track_from_playlist_queue(this.media.song_key(this.audio_data.current.identifier)); // remove current song from queue if it exists

            if(this._shuffle) {
                this.shuffle_playlist();
            } else {
                this.unshuffle_playlist();
            }
        }
    }

    public async load_playlist(identifier: Song_Playlist_Identifier | null, data: Song_Playlist | null, preserve_history: boolean = false, auto_play: boolean = false): Promise<void> {
        this.playlist.identifier = identifier;
        this.playlist.data = data;
        this.playlist.queue = Array.from(data?.songs.values()).map(song_identifier => this.media.song_key(song_identifier)) || [];
        this.playlist.play_next = [];
        this.playlist_changed.emit();

        await Promise.all(this.playlist.queue.map(song_key => {
            if(this.song_cache.has(song_key)) return Promise.resolve();
            return this.media.get_song_data(song_key).then(song_data => {
                if(song_data) this.song_cache.set(song_key, song_data);
            }).catch(error => {
                console.error('Error preloading song data for playlist:', song_key, error);
            });
        })).then(() => {
            console.log('Preloaded all song data for playlist.');
        });

        if(this._shuffle) {
            this.shuffle_playlist();
        } else {
            this.unshuffle_playlist();
        }

        if(!preserve_history) this.playlist.history_stack = [];
        if(auto_play && this.playlist.queue.length > 0) {
            if(!this.is_next_track_preloaded_in_play_next_queue()) {
                // the next preloaded track is not the next in the play next queue, so we need to remove it because the preloaded track is from the previous playlist
                this.audio_data.next = {identifier: null, data: null, loaded: false, audio_source: null, source_type: null};
            }
            this.skip_to_next();
        } else {
            this.preload_next_track();
        }
    }

    public add_song_to_cache(song_data: Song_Data): void {
        const song_key = this.media.song_key(song_data.id);
        this.song_cache.set(song_key, song_data);
    }

    public add_song_to_play_next(song_data: Song_Identifier | Song_Data | string): void {
        let song_key: string | null = null;
        
        if(this.is_string(song_data)) {
            song_key = song_data;
            this.playlist.play_next.push(song_key);
        } else if(this.is_song_identifier(song_data)) {
            song_key = this.media.song_key(song_data);
            this.playlist.play_next.push(song_key);
        } else if(this.is_song_data(song_data)) {

            song_key = this.media.song_key(song_data.id);
            this.playlist.play_next.push(song_key);
            // add to cache
            this.song_cache.set(song_key, song_data);
        } else {
            console.error('Invalid data provided to add_song_to_play_next:', song_data);
            return;
        }

        this.preload_next_track(); // preload next track in case it is the next to be played
    }

    public shuffle_playlist(): void {
        if (this.playlist.queue.length > 0) {
            this.playlist.queue.sort(() => Math.random() - 0.5);
        }
    }

    private custom_alpha_sort(a: string, b: string): number {
        const getFirst = (str: string) => str.trim()[0]?.toUpperCase() || '';
        const isAlpha = (char: string) => /^[A-Z]$/.test(char);

        const aFirst = getFirst(a);
        const bFirst = getFirst(b);

        const aIsAlpha = isAlpha(aFirst);
        const bIsAlpha = isAlpha(bFirst);

        if (!aIsAlpha && bIsAlpha) return -1; // a is non-letter, b is letter
        if (aIsAlpha && !bIsAlpha) return 1;  // a is letter, b is non-letter
        // Both are same type, sort normally
        return a.localeCompare(b);
    }

    public unshuffle_playlist(): void {
        const original_songs = Array.from(this.playlist.data.songs.values());

        if(!this.playlist.data?.song_added_timestamps || this.playlist.data?.song_added_timestamps?.size === 0) {
            // using third party playlist without timestamps, cannot unshuffle
            console.warn('Cannot unshuffle playlist without song added timestamps. Using order given as in in .songs');
            // make sure it only contains songs currently in queue
            const current_song_key = this.audio_data.current.identifier ? this.media.song_key(this.audio_data.current.identifier) : null;
            const queue_keys = new Set(this.playlist.queue);
            
            // Filter original songs to only include those in current queue
            const filtered_songs = original_songs.filter(song => queue_keys.has(this.media.song_key(song)));
            
            // If current song exists and is in the filtered list, place it at the beginning
            if (current_song_key && filtered_songs.some(song => this.media.song_key(song) === current_song_key)) {
                const current_index = filtered_songs.findIndex(song => this.media.song_key(song) === current_song_key);
                if (current_index > 0) {
                    // Move current song to front
                    const current_song = filtered_songs.splice(current_index, 1)[0];
                    filtered_songs.unshift(current_song);
                }
            }
            
            this.playlist.queue = filtered_songs.map(identifier => this.media.song_key(identifier));
            return;
        }

        // unshuffle playlist to how its sorted
        const original_order = original_songs.sort((a, b) => {
            if (!a || !b) return 0;

            switch (this.playlist.data.sorting_method || 'recent_to_old') {
                case 'recent_to_old':
                    return (this.playlist.data.song_added_timestamps.get(this.media.song_key(b)) || 0) - (this.playlist.data.song_added_timestamps.get(this.media.song_key(a)) || 0);
                case 'old_to_recent':
                    return (this.playlist.data.song_added_timestamps.get(this.media.song_key(a)) || 0) - (this.playlist.data.song_added_timestamps.get(this.media.song_key(b)) || 0);
                case 'alphabetical':
                case 'title':
                    return this.custom_alpha_sort(
                        this.song_cache.get(this.media.song_key(a))?.song_name || '',
                        this.song_cache.get(this.media.song_key(b))?.song_name || ''
                    );
                case 'artist':
                    return this.custom_alpha_sort(
                        this.song_cache.get(this.media.song_key(a))?.original_artists?.[0]?.name || '',
                        this.song_cache.get(this.media.song_key(b))?.original_artists?.[0]?.name || ''
                    );
                default: return 0;
            }
        });

        if (this.playlist.data && this.playlist.data.songs.size > 0) {
            // Reset to original order based on playlist

            if (this.audio_data.current.identifier) {
                // Find the current song's index in the original playlist
                const current_song_index = original_order.findIndex(song =>
                    this.media.song_key(song) === this.media.song_key(this.audio_data.current.identifier)
                );
                
                if (current_song_index !== -1) {
                    // Split the playlist: songs after current + songs before current
                    const songs_after_current = original_order.slice(current_song_index + 1).map(identifier => this.media.song_key(identifier));
                    const songs_before_current = original_order.slice(0, current_song_index).map(identifier => this.media.song_key(identifier));

                    // Combine: songs after current come first, then songs before current
                    this.playlist.queue = [...songs_after_current, ...songs_before_current];
                } else {
                    // Current song not found in playlist, use original order without current song
                    this.playlist.queue = original_order.filter(identifier =>
                        this.media.song_key(identifier) !== this.media.song_key(this.audio_data.current.identifier)
                    ).map(identifier => this.media.song_key(identifier));
                }
            } else {
                // No current song, use original order
                this.playlist.queue = [...original_order].map(identifier => this.media.song_key(identifier));
            }
        }
    }

    public remove_track_from_playlist_queue(song_key: string = this.media.song_key(this.audio_data.current.identifier)): void {
        this.playlist.queue = this.playlist.queue.filter(key => key !== song_key);
        // this.playlist.play_next = this.playlist.play_next.filter(key => key !== song_key);
    }

    // Visualizer properties
    private visualizer_canvas: HTMLCanvasElement | null = null;
    private gl: WebGLRenderingContext | null = null;
    private visualizer_program: WebGLProgram | null = null;
    private visualizer_animation_frame: number = 0;
    private visualizer_active: boolean = false;
    private album_texture: WebGLTexture | null = null;
    private texture_canvas: HTMLCanvasElement | null = null;
    
    // Sobel edge detection properties
    // Note: The Sobel texture contains:
    // - RGB channels: Edge magnitude (0-1, where 1 = strong edge)
    // - Alpha channel: Gradient direction (0-1, normalized angle from -π to π)
    private sobel_program: WebGLProgram | null = null;
    private sobel_framebuffer: WebGLFramebuffer | null = null;
    private sobel_texture: WebGLTexture | null = null;

    public start_visualizer(): void {
        return;
        if (this.visualizer_active) return;
        
        this.visualizer_canvas = document.getElementById('visualization-canvas') as HTMLCanvasElement;
        if (!this.visualizer_canvas) {
            console.warn('Visualization canvas not found');
            return;
        }

        this.setup_visualizer();
        this.visualizer_active = true;
        this.render_visualizer();
    }

    private setup_visualizer(): void {
        if (!this.visualizer_canvas) return;

        // Setup WebGL context
        this.gl = this.visualizer_canvas.getContext('webgl') as WebGLRenderingContext || 
                 this.visualizer_canvas.getContext('experimental-webgl') as WebGLRenderingContext;
        if (!this.gl) {
            console.warn('WebGL not supported');
            return;
        }

        this.render_steps = 0;

        // Vertex shader source
        const vertexShaderSource = `
            attribute vec2 a_position;
            varying vec2 v_texCoord;
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                // Flip Y coordinate to match texture orientation
                v_texCoord = vec2((a_position.x + 1.0) / 2.0, 1.0 - (a_position.y + 1.0) / 2.0);
            }
        `;

        // Fragment shader with smart album cover continuation
        const fragmentShaderSource = `
            precision mediump float;
            uniform vec2 u_resolution;
            uniform vec3 u_color;
            uniform sampler2D u_albumTexture;
            uniform sampler2D u_sobelTexture;
            uniform bool u_hasAlbumTexture;
            uniform bool u_hasSobelTexture;
            uniform vec4 u_thumbnailRect; // x, y, z: width, w: height in pixels
            uniform bool u_hasThumbnailRect;
            varying vec2 v_texCoord;

            #define PI 3.14159265359
            #define SAMPLE_STEPS 128              // Much more directions for better coverage 24
            #define MAX_FLOW_DISTANCE 1.5        // Much longer reach 
            #define EDGE_THRESHOLD 0.1          // Lower threshold to detect more edges
            
            // Function to check if current pixel is behind the thumbnail
            bool isInsideThumbnail(vec2 screenPos) {
                if (!u_hasThumbnailRect) return false;
                
                return screenPos.x >= u_thumbnailRect.x && 
                       screenPos.x <= u_thumbnailRect.x + u_thumbnailRect.z &&
                       screenPos.y >= u_thumbnailRect.y && 
                       screenPos.y <= u_thumbnailRect.y + u_thumbnailRect.w;
            }
            
            // Convert screen coordinates to album UV coordinates
            vec2 screenToAlbumUV(vec2 screenPos) {
                if (!u_hasThumbnailRect) return vec2(-1.0); // Invalid UV
                
                // Convert screen coordinates relative to thumbnail
                vec2 relativePos = (screenPos - u_thumbnailRect.xy) / u_thumbnailRect.zw;
                
                // Flip Y coordinate to match texture orientation
                return vec2(relativePos.x, 1.0 - relativePos.y);
            }
            
            // Check if screen coordinates are within the actual album thumbnail area
            bool isInsideAlbum(vec2 screenPos) {
                if (!u_hasThumbnailRect) return false;
                
                return screenPos.x >= u_thumbnailRect.x && 
                       screenPos.x <= u_thumbnailRect.x + u_thumbnailRect.z &&
                       screenPos.y >= u_thumbnailRect.y && 
                       screenPos.y <= u_thumbnailRect.y + u_thumbnailRect.w;
            }
            
            // Check if a UV coordinate is valid for texture sampling (0-1 range)
            bool isValidUV(vec2 uv) {
                return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
            }
            
            // Get gradient vector from Sobel texture (reconstructed from encoded data)
            vec2 getGradientVector(vec2 screenPos) {
                if (!u_hasSobelTexture || !isInsideAlbum(screenPos)) return vec2(0.0);
                
                vec2 uv = screenToAlbumUV(screenPos);
                if (!isValidUV(uv)) return vec2(0.0);

                vec4 sobelData = texture2D(u_sobelTexture, uv);
                
                // Extract gradient direction from alpha channel (0-1 normalized angle)
                float angle = sobelData.a * 2.0 * PI - PI; // Convert back to [-PI, PI]
                vec2 gradientDir = vec2(cos(angle), sin(angle));
                
                // Scale by edge magnitude (stored in RGB channels)
                float magnitude = sobelData.r;
                
                return gradientDir * magnitude;
            }
            
            // Get edge strength at a screen coordinate
            float getEdgeStrength(vec2 screenPos) {
                if (!u_hasSobelTexture || !isInsideAlbum(screenPos)) return 0.0;
                
                vec2 uv = screenToAlbumUV(screenPos);
                if (!isValidUV(uv)) return 0.0;
                
                vec4 sobelData = texture2D(u_sobelTexture, uv);
                return sobelData.r; // Edge magnitude
            }
            
            // Smart color sampling that follows edge directions
            vec3 sampleAlbumColorSmart(vec2 currentScreenPos, vec2 targetScreenPos) {
                if (!u_hasAlbumTexture) return vec3(0.0);
                
                // If target is inside album, sample directly
                if (isInsideAlbum(targetScreenPos)) {
                    vec2 uv = screenToAlbumUV(targetScreenPos);
                    if (isValidUV(uv)) {
                        return texture2D(u_albumTexture, uv).rgb;
                    }
                }
                
                // Find the nearest album boundary by stepping back along the line
                vec2 direction = normalize(targetScreenPos - currentScreenPos);
                vec2 step = -direction * 2.0; // Small step back towards album
                vec2 searchPos = targetScreenPos;
                
                // Step back until we're inside the album
                for (int i = 0; i < 100; i++) {
                    if (isInsideAlbum(searchPos)) {
                        vec2 uv = screenToAlbumUV(searchPos);
                        if (isValidUV(uv)) {
                            return texture2D(u_albumTexture, uv).rgb;
                        }
                    }
                    searchPos += step;
                    
                    // Safety check - if we've gone too far, break
                    if (length(searchPos - targetScreenPos) > 200.0) break;
                }
                
                // Fallback: return black if no valid sample found
                return vec3(0.0);
            }
            
            // Distance-based border averaging - samples from closest album border pixels
            vec3 averageBorderColors(vec2 screenPos) {
                if (!u_hasThumbnailRect) return vec3(0.0);







                return vec3(0.0);
                
                // Calculate distance from album
                vec2 albumCenter = u_thumbnailRect.xy + u_thumbnailRect.zw * 0.5;
                vec2 albumSize = u_thumbnailRect.zw;
                vec2 distVec = max(vec2(0.0), abs(screenPos - albumCenter) - albumSize * 0.5);
                float distanceFromAlbum = length(distVec);
                
                // Only use this method if we're far enough from the album
                if (distanceFromAlbum < 150.0) return vec3(0.0);
                
                vec3 borderColor = vec3(0.0);
                float totalWeight = 0.0;
                
                // Calculate sampling width based on distance - further = wider sampling
                float samplingWidth = min(distanceFromAlbum * 0.5, albumSize.x * 0.8);
                int numSamples = int(min(samplingWidth / 10.0, 30.0)); // Max 30 samples

                // Find the closest album border point to current pixel
                vec2 albumMin = u_thumbnailRect.xy;
                vec2 albumMax = u_thumbnailRect.xy + u_thumbnailRect.zw;
                
                // Determine which side of the album we're closest to
                vec2 closestBorderPoint = vec2(
                    clamp(screenPos.x, albumMin.x, albumMax.x),
                    clamp(screenPos.y, albumMin.y, albumMax.y)
                );
                
                // Sample horizontally along the border closest to our X position
                if (numSamples > 0) {
                    for (int i = 0; i < 20; i++) {
                        if (i >= numSamples) break;
                        
                        // Calculate sample offset from center
                        float offset = (float(i) - float(numSamples - 1) * 0.5) * (samplingWidth / float(numSamples));
                        
                        // Determine sampling position based on which side we're on
                        vec2 samplePos = closestBorderPoint;
                        
                        // If we're above/below the album, sample horizontally
                        if (screenPos.y < albumMin.y || screenPos.y > albumMax.y) {
                            samplePos.x = clamp(closestBorderPoint.x + offset, albumMin.x, albumMax.x);
                        }
                        // If we're left/right of the album, sample vertically  
                        else if (screenPos.x < albumMin.x || screenPos.x > albumMax.x) {
                            samplePos.y = clamp(closestBorderPoint.y + offset, albumMin.y, albumMax.y);
                        }
                        // If we're at a corner, sample both directions
                        else {
                            samplePos.x = clamp(closestBorderPoint.x + offset * 0.7, albumMin.x, albumMax.x);
                            samplePos.y = clamp(closestBorderPoint.y + offset * 0.3, albumMin.y, albumMax.y);
                        }
                        
                        // Sample the album color at this border position
                        if (isInsideAlbum(samplePos)) {
                            vec2 albumUV = screenToAlbumUV(samplePos);
                            if (isValidUV(albumUV)) {
                                vec3 albumColor = texture2D(u_albumTexture, albumUV).rgb;
                                
                                // Weight by distance from our target X position (closer = higher weight)
                                float positionDistance = abs(samplePos.x - screenPos.x) + abs(samplePos.y - screenPos.y);
                                // float weight = exp(-positionDistance * 0.01) * exp(-abs(offset) * 0.02);
                                // float weight = 1.0;
                                // make the weight biased to further pixels
                                // favor brighter colors
                                float weight = 1.0 / (1.0 + positionDistance * 0.1) + length(albumColor) * 0.35;
                                
                                borderColor += albumColor * weight;
                                totalWeight += weight;
                            }
                        }
                    }
                }
                
                if (totalWeight > 0.0) {
                    return borderColor / totalWeight;
                }
                
                return vec3(0.0);
            }
            
            // Flow-based color propagation
            vec3 flowBasedPropagation(vec2 uv) {
                vec2 screenPos = gl_FragCoord.xy;
                vec3 accumulatedColor = vec3(0.0);
                float totalWeight = 0.0;
                
                // Sample multiple directions around the current pixel
                for (int i = 0; i < SAMPLE_STEPS; i++) {
                    float angle = float(i) * 2.0 * PI / float(SAMPLE_STEPS);
                    vec2 sampleDir = vec2(cos(angle), sin(angle));
                    
                    // Fixed sampling distance 
                    float flowDistance = 0.05;
                    
                    vec2 flowScreenPos = screenPos;
                    vec3 flowColor = vec3(0.0);
                    float flowWeight = 1.0;
                    bool foundValidSample = false;
                    
                    // Flow in this direction, following gradients when possible
                    for (int step = 0; step < 45; step++) {
                        vec2 nextFlowScreenPos = flowScreenPos - sampleDir * flowDistance * 10.0;
                        
                        if (isInsideAlbum(nextFlowScreenPos)) {
                            // Found a valid album sample
                            vec2 albumUV = screenToAlbumUV(nextFlowScreenPos);
                            if (isValidUV(albumUV)) {
                                vec3 albumColor = texture2D(u_albumTexture, albumUV).rgb;
                                vec2 gradient = getGradientVector(nextFlowScreenPos);
                                float edgeStrength = getEdgeStrength(nextFlowScreenPos);
                                
                                // If there's a strong edge, bias the flow direction
                                if (edgeStrength > EDGE_THRESHOLD) {
                                    // Align sample direction with edge direction for strong edges
                                    float alignment = dot(normalize(gradient), sampleDir);
                                    flowWeight *= (1.0 + alignment * edgeStrength * 2.0);
                                }
                                
                                flowColor = albumColor;
                                foundValidSample = true;
                                break;
                            }
                        }
                        
                        flowScreenPos = nextFlowScreenPos;
                        flowWeight *= 0.9; // Decay weight with distance
                    }
                    
                    if (foundValidSample) {
                        // Distance-based weight
                        float distance = length(flowScreenPos - screenPos);
                        float distanceWeight = exp(-distance * 0.01);
                        
                        accumulatedColor += flowColor * flowWeight * distanceWeight;
                        totalWeight += flowWeight * distanceWeight;
                    }
                }
                
                if (totalWeight > 0.0) {
                    return accumulatedColor / totalWeight;
                }
                
                // Fallback to distance-based border averaging when smart prediction fails
                return averageBorderColors(screenPos);
            }
            
            // Edge continuation algorithm
            vec3 continueEdges(vec2 uv, vec3 fallbackColor) {
                if (!u_hasSobelTexture) return fallbackColor;
                
                vec2 screenPos = gl_FragCoord.xy;
                vec3 edgeColor = vec3(0.0);
                float totalEdgeWeight = 0.0;
                
                // Sample nearby album areas to find edge continuation
                for (int i = 0; i < 12; i++) {
                    float angle = float(i) * 2.0 * PI / 12.0;
                    vec2 searchDir = vec2(cos(angle), sin(angle));
                    
                    // Search for edges in this direction
                    for (int step = 1; step <= 25; step++) {
                        float searchDistance = float(step) * 0.05;
                        vec2 searchScreenPos = screenPos + searchDir * searchDistance;
                        
                        if (isInsideAlbum(searchScreenPos)) {
                            float edgeStrength = getEdgeStrength(searchScreenPos);
                            
                            if (edgeStrength > EDGE_THRESHOLD) {
                                vec2 gradient = getGradientVector(searchScreenPos);
                                
                                // Check if the gradient direction aligns with our search direction
                                float alignment = abs(dot(normalize(gradient), -searchDir));
                                
                                if (alignment > 0.7) { // Strong alignment means edge continues in this direction
                                    vec2 albumUV = screenToAlbumUV(searchScreenPos);
                                    if (isValidUV(albumUV)) {
                                        vec3 albumColor = texture2D(u_albumTexture, albumUV).rgb;
                                        
                                        // Weight by edge strength, alignment, and distance
                                        float weight = edgeStrength * alignment * exp(-searchDistance * 5.0);
                                        
                                        edgeColor += albumColor * weight;
                                        totalEdgeWeight += weight;
                                    }
                                }
                            }
                            break; // Found album boundary, stop searching in this direction
                        }
                    }
                }
                
                if (totalEdgeWeight > 0.0) {
                    return edgeColor / totalEdgeWeight;
                }
                
                // Fallback to distance-based border averaging when edge continuation fails
                vec3 borderAverage = averageBorderColors(screenPos);
                if (length(borderAverage) > 0.0) {
                    return borderAverage;
                }
                return fallbackColor;
            }
            
            // Region filling between edges
            vec3 fillRegions(vec2 uv, vec3 fallbackColor) {
                vec2 screenPos = gl_FragCoord.xy;
                vec3 regionColor = vec3(0.0);
                float totalWeight = 0.0;
                
                // Sample colors from multiple directions, avoiding strong edges
                for (int i = 0; i < 16; i++) {
                    float angle = float(i) * 2.0 * PI / 16.0;
                    vec2 sampleDir = vec2(cos(angle), sin(angle));
                    
                    bool hitEdge = false;
                    vec3 sampledColor = vec3(0.0);
                    float sampleWeight = 1.0;
                    
                    // Cast a ray in this direction until we hit the album or a strong edge
                    for (int step = 1; step <= 30; step++) {
                        float rayDistance = float(step) * 0.03;
                        vec2 rayScreenPos = screenPos + sampleDir * rayDistance;
                        
                        if (isInsideAlbum(rayScreenPos)) {
                            float edgeStrength = getEdgeStrength(rayScreenPos);
                            
                            // If we hit a strong edge, stop and don't use this sample
                            if (edgeStrength > EDGE_THRESHOLD * 1.5) {
                                hitEdge = true;
                                break;
                            }
                            
                            // Sample the color
                            vec2 albumUV = screenToAlbumUV(rayScreenPos);
                            if (isValidUV(albumUV)) {
                                sampledColor = texture2D(u_albumTexture, albumUV).rgb;
                                sampleWeight = exp(-rayDistance * 2.0);
                            }
                            break;
                        }
                    }
                    
                    if (!hitEdge && sampleWeight > 0.0) {
                        regionColor += sampledColor * sampleWeight;
                        totalWeight += sampleWeight;
                    }
                }
                
                if (totalWeight > 0.0) {
                    return regionColor / totalWeight;
                }
                
                // Fallback to distance-based border averaging when region filling fails
                vec3 borderAverage = averageBorderColors(screenPos);
                if (length(borderAverage) > 0.0) {
                    return borderAverage;
                }
                return fallbackColor;
            }
            
            void main() {
                vec2 screenPos = gl_FragCoord.xy;
                
                if (isInsideThumbnail(screenPos)) {
                    // if inside thumbnail just copy the thumbnail pixel at that location using the album texture
                    if (u_hasAlbumTexture) {
                        vec2 albumUV = screenToAlbumUV(screenPos);
                        if (isValidUV(albumUV)) {
                            vec4 albumData = texture2D(u_albumTexture, albumUV);
                            gl_FragColor = vec4(albumData.rgb, 1.0);
                            return;
                        }
                    }
                    // If no album texture, just use the base color
                    gl_FragColor = vec4(u_color, 1.0);
                    return;
                }
                
                // If we're inside the album area, show the original album
                if (u_hasAlbumTexture && isInsideAlbum(screenPos)) {
                    vec2 albumUV = screenToAlbumUV(screenPos);
                    if (isValidUV(albumUV)) {
                        vec4 albumData = texture2D(u_albumTexture, albumUV);
                        gl_FragColor = vec4(albumData.rgb, 1.0);
                        return;
                    }
                }
                
                // Outside album area: apply smart continuation
                vec3 finalColor = vec3(0.0);
                
                if (u_hasAlbumTexture && u_hasSobelTexture) {
                    // Combine different propagation methods
                    vec3 flowColor = flowBasedPropagation(v_texCoord);
                    vec3 edgeColor = continueEdges(v_texCoord, flowColor);
                    vec3 regionColor = fillRegions(v_texCoord, flowColor);
                    
                    // Calculate distance from album for fading
                    float distanceFromAlbum = 0.0;
                    if (u_hasThumbnailRect) {
                        vec2 albumCenter = u_thumbnailRect.xy + u_thumbnailRect.zw * 0.5;
                        vec2 albumSize = u_thumbnailRect.zw;
                        vec2 distVec = max(vec2(0.0), abs(screenPos - albumCenter) - albumSize * 0.5);
                        distanceFromAlbum = length(distVec);
                    }

                    if(distanceFromAlbum > 60.0) {
                        discard;
                    }
                    
                    // Weight the different methods
                    float edgeWeight = 0.0;
                    float flowWeight = 1.0;
                    float regionWeight = 0.0;
                    
                    // Normalize weights
                    float totalMethodWeight = edgeWeight + flowWeight + regionWeight;
                    edgeWeight /= totalMethodWeight;
                    flowWeight /= totalMethodWeight;
                    regionWeight /= totalMethodWeight;
                    
                    finalColor = edgeColor * edgeWeight + flowColor * flowWeight + regionColor * regionWeight;

                    if (finalColor.r == 0.0 && finalColor.g == 0.0 && finalColor.b == 0.0) {
                        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
                        return;
                    }

                    // use exponential fade
                    float alpha = sqrt(-(distanceFromAlbum / 35.0) + 1.0);
                    // float alpha = 1.0;

                    gl_FragColor = vec4(finalColor, alpha);
                    return;
                } else {
                    // Fallback to simple color
                    finalColor = u_color;
                }

                //check if black, if so make transparent
                if (finalColor.r == 0.0 && finalColor.g == 0.0 && finalColor.b == 0.0) {
                    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
                    return;
                }

                gl_FragColor = vec4(finalColor, 1.0);
            }
        `;

        // Create and compile shaders
        const vertexShader = this.create_shader(this.gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = this.create_shader(this.gl.FRAGMENT_SHADER, fragmentShaderSource);

        if (!vertexShader || !fragmentShader) {
            console.error('Failed to create shaders');
            return;
        }

        // Create program
        this.visualizer_program = this.gl.createProgram();
        if (!this.visualizer_program) {
            console.error('Failed to create WebGL program');
            return;
        }

        this.gl.attachShader(this.visualizer_program, vertexShader);
        this.gl.attachShader(this.visualizer_program, fragmentShader);
        this.gl.linkProgram(this.visualizer_program);

        if (!this.gl.getProgramParameter(this.visualizer_program, this.gl.LINK_STATUS)) {
            console.error('Failed to link program:', this.gl.getProgramInfoLog(this.visualizer_program));
            return;
        }

        // Setup vertices for full screen quad
        const vertices = new Float32Array([
            -1.0, -1.0,
             1.0, -1.0,
            -1.0,  1.0,
             1.0,  1.0,
        ]);

        const buffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);

        const positionLocation = this.gl.getAttribLocation(this.visualizer_program, 'a_position');
        this.gl.enableVertexAttribArray(positionLocation);
        this.gl.vertexAttribPointer(positionLocation, 2, this.gl.FLOAT, false, 0, 0);

        // Create album texture for edge blending
        this.create_album_texture();
        
        // Setup Sobel edge detection shader
        this.setup_sobel_shader();
    }

    private create_shader(type: number, source: string): WebGLShader | null {
        if (!this.gl) return null;

        const shader = this.gl.createShader(type);
        if (!shader) return null;

        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);

        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            console.error('Shader compilation error:', this.gl.getShaderInfoLog(shader));
            this.gl.deleteShader(shader);
            return null;
        }

        return shader;
    }

    private set_uniform_safe(name: string, setter: (location: WebGLUniformLocation) => void): void {
        if (!this.gl || !this.visualizer_program) return;
        
        const location = this.gl.getUniformLocation(this.visualizer_program, name);
        if (location !== null) {
            setter(location);
        }
    }

    private render_steps: number = 0;
    private max_render_steps: number = 5;
    private render_visualizer = (): void => {
        if (!this.visualizer_active || !this.gl || !this.visualizer_program || !this.visualizer_canvas) {
            return;
        }

        this.render_steps++;
        if (this.render_steps < this.max_render_steps) {
            this.visualizer_animation_frame = requestAnimationFrame(this.render_visualizer);
            return;
        }

        // Update canvas size
        const rect = this.visualizer_canvas.getBoundingClientRect();
        this.visualizer_canvas.width = rect.width * window.devicePixelRatio;
        this.visualizer_canvas.height = rect.height * window.devicePixelRatio;

        this.gl.viewport(0, 0, this.visualizer_canvas.width, this.visualizer_canvas.height);

        // Use program
        this.gl.useProgram(this.visualizer_program);

        // Set uniforms with safe uniform location checks
        const primaryColor = this.get_primary_color();

        this.set_uniform_safe('u_resolution', (location) => 
            this.gl!.uniform2f(location, this.visualizer_canvas!.width, this.visualizer_canvas!.height));
        this.set_uniform_safe('u_color', (location) => 
            this.gl!.uniform3f(location, primaryColor.r, primaryColor.g, primaryColor.b));

        // Get thumbnail position and pass to shader
        const thumbnailRect = this.get_thumbnail_rect();
        this.set_uniform_safe('u_thumbnailRect', (location) =>
            this.gl!.uniform4f(location, thumbnailRect.x, thumbnailRect.y, thumbnailRect.width, thumbnailRect.height));
        this.set_uniform_safe('u_hasThumbnailRect', (location) =>
            this.gl!.uniform1i(location, thumbnailRect.width > 0 ? 1 : 0));

        // Bind album texture if available
        const hasAlbumTexture = this.album_texture !== null;
        
        // Generate Sobel edge detection texture if we have an album texture
        if (hasAlbumTexture && this.sobel_program && this.sobel_framebuffer && this.sobel_texture) {
            this.render_sobel_texture();
        }
        
        const hasSobelTexture = this.sobel_texture !== null;
        
        this.set_uniform_safe('u_hasAlbumTexture', (location) =>
            this.gl!.uniform1i(location, hasAlbumTexture ? 1 : 0));
        this.set_uniform_safe('u_hasSobelTexture', (location) =>
            this.gl!.uniform1i(location, hasSobelTexture ? 1 : 0));
        
        if (hasAlbumTexture) {
            this.gl.activeTexture(this.gl.TEXTURE0);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.album_texture);
            this.set_uniform_safe('u_albumTexture', (location) =>
                this.gl!.uniform1i(location, 0));
        }
        
        if (hasSobelTexture) {
            this.gl.activeTexture(this.gl.TEXTURE1);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.sobel_texture);
            this.set_uniform_safe('u_sobelTexture', (location) =>
                this.gl!.uniform1i(location, 1));
        }

        // Enable blending for transparency
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

        // Clear and draw
        this.gl.clearColor(0.0, 0.0, 0.0, 0.0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);

        // Request next frame
        this.visualizer_animation_frame = requestAnimationFrame(this.render_visualizer);
    }

    private calculate_average(array: Uint8Array, start: number, end: number): number {
        let sum = 0;
        for (let i = start; i < end; i++) {
            sum += array[i];
        }
        return sum / (end - start);
    }

    private get_primary_color(): { r: number, g: number, b: number } {
        // Get primary color from current song or use default
        const colors = this.song_data?.colors?.common;
        if (colors && colors.length > 0) {
            const colorString = colors[0];
            // Parse color string (assuming format like "rgb(r, g, b)" or "#rrggbb")
            if (colorString.startsWith('rgb(')) {
                const match = colorString.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                if (match) {
                    return {
                        r: parseInt(match[1]) / 255.0,
                        g: parseInt(match[2]) / 255.0,
                        b: parseInt(match[3]) / 255.0
                    };
                }
            } else if (colorString.startsWith('#')) {
                const hex = colorString.slice(1);
                const r = parseInt(hex.slice(0, 2), 16);
                const g = parseInt(hex.slice(2, 4), 16);
                const b = parseInt(hex.slice(4, 6), 16);
                return {
                    r: r / 255.0,
                    g: g / 255.0,
                    b: b / 255.0
                };
            }
        }
        
        // Default blue color
        return { r: 0.2, g: 0.6, b: 1.0 };
    }

    private get_thumbnail_rect(): { x: number, y: number, width: number, height: number } {
        if (!this.thumbnail_element || !this.visualizer_canvas) {
            return { x: 0, y: 0, width: 0, height: 0 };
        }

        const thumbnailRect = this.thumbnail_element.getBoundingClientRect();
        const canvasRect = this.visualizer_canvas.getBoundingClientRect();

        const inset = 0; // pixels

        // Convert thumbnail position relative to canvas
        const x = (thumbnailRect.left - canvasRect.left) * window.devicePixelRatio + inset;
        const y = (thumbnailRect.top - canvasRect.top) * window.devicePixelRatio + inset;
        const width = thumbnailRect.width * window.devicePixelRatio - inset * 2;
        const height = thumbnailRect.height * window.devicePixelRatio - inset * 2;

        // Flip Y coordinate for WebGL (origin at bottom-left vs top-left in DOM)
        const flippedY = (canvasRect.height * window.devicePixelRatio) - y - height;

        return { x, y: flippedY, width, height };
    }

    public stop_visualizer(): void {
        this.visualizer_active = false;
        
        if (this.visualizer_animation_frame) {
            cancelAnimationFrame(this.visualizer_animation_frame);
            this.visualizer_animation_frame = 0;
        }
        
        // Clean up album texture resources
        if (this.album_texture && this.gl) {
            this.gl.deleteTexture(this.album_texture);
            this.album_texture = null;
        }
        
        // Clean up Sobel resources
        if (this.sobel_texture && this.gl) {
            this.gl.deleteTexture(this.sobel_texture);
            this.sobel_texture = null;
        }
        if (this.sobel_framebuffer && this.gl) {
            this.gl.deleteFramebuffer(this.sobel_framebuffer);
            this.sobel_framebuffer = null;
        }
        this.sobel_program = null;
        
        this.texture_canvas = null;
        
        this.gl = null;
        this.visualizer_program = null;
        this.visualizer_canvas = null;
    }

    private create_album_texture(): void {
        if (!this.gl || !this.thumbnail_element) return;

        // Create texture canvas if it doesn't exist
        if (!this.texture_canvas) {
            this.texture_canvas = document.createElement('canvas');
        }

        const ctx = this.texture_canvas.getContext('2d');
        if (!ctx) return;

        // Set canvas size to match thumbnail
        const size = 256; // Use fixed size for performance
        this.texture_canvas.width = size;
        this.texture_canvas.height = size;

        // Create a proxy image to handle CORS issues
        const proxyImage = new Image();
        proxyImage.crossOrigin = 'anonymous';
        
        const drawImageToCanvas = () => {
            try {
                // Clear canvas first
                ctx.clearRect(0, 0, size, size);
                ctx.drawImage(proxyImage, 0, 0, size, size);
                this.upload_texture_to_webgl();
            } catch (error) {
                console.warn('Failed to draw image to canvas:', error);
                // Fallback: create a solid color texture based on primary color
                this.create_fallback_texture();
            }
        };

        proxyImage.onload = drawImageToCanvas;
        proxyImage.onerror = () => {
            console.warn('Failed to load proxy image, using fallback texture');
            this.create_fallback_texture();
        };

        // Use the thumbnail src or create a data URL if needed
        if (this.thumbnail_element.src && this.thumbnail_element.src.startsWith('blob:')) {
            // For blob URLs, try to draw directly from the thumbnail element
            try {
                if (this.thumbnail_element.complete && this.thumbnail_element.naturalWidth > 0) {
                    ctx.clearRect(0, 0, size, size);
                    ctx.drawImage(this.thumbnail_element, 0, 0, size, size);
                    this.upload_texture_to_webgl();
                } else {
                    this.thumbnail_element.onload = () => {
                        try {
                            ctx.clearRect(0, 0, size, size);
                            ctx.drawImage(this.thumbnail_element!, 0, 0, size, size);
                            this.upload_texture_to_webgl();
                        } catch (error) {
                            console.warn('Failed to draw thumbnail to canvas:', error);
                            this.create_fallback_texture();
                        }
                    };
                }
            } catch (error) {
                console.warn('Failed to draw blob image:', error);
                this.create_fallback_texture();
            }
        } else if (this.thumbnail_element.src) {
            // For external URLs, use proxy image with CORS
            proxyImage.src = this.thumbnail_element.src;
        } else {
            // No image source, use fallback
            this.create_fallback_texture();
        }
    }

    private create_fallback_texture(): void {
        if (!this.gl || !this.texture_canvas) return;

        const ctx = this.texture_canvas.getContext('2d');
        if (!ctx) return;

        const size = 256;
        this.texture_canvas.width = size;
        this.texture_canvas.height = size;

        // Create a gradient based on the primary color
        const primaryColor = this.get_primary_color();
        const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
        
        gradient.addColorStop(0, `rgb(${Math.floor(primaryColor.r * 255)}, ${Math.floor(primaryColor.g * 255)}, ${Math.floor(primaryColor.b * 255)})`);
        gradient.addColorStop(1, `rgb(${Math.floor(primaryColor.r * 128)}, ${Math.floor(primaryColor.g * 128)}, ${Math.floor(primaryColor.b * 128)})`);
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);
        
        this.upload_texture_to_webgl();
    }

    private upload_texture_to_webgl(): void {
        if (!this.gl || !this.texture_canvas) return;

        try {
            // Delete existing texture
            if (this.album_texture) {
                this.gl.deleteTexture(this.album_texture);
            }

            // Create new texture
            this.album_texture = this.gl.createTexture();
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.album_texture);

            // Upload canvas to texture
            this.gl.texImage2D(
                this.gl.TEXTURE_2D,
                0,
                this.gl.RGBA,
                this.gl.RGBA,
                this.gl.UNSIGNED_BYTE,
                this.texture_canvas
            );

            // Set texture parameters
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        } catch (error) {
            console.warn('Failed to upload texture to WebGL:', error);
            // Set album_texture to null so shader knows there's no texture
            this.album_texture = null;
        }
    }

    private setup_sobel_shader(): void {
        if (!this.gl) return;

        // Vertex shader for Sobel (same as main visualizer)
        const vertexShaderSource = `
            attribute vec2 a_position;
            varying vec2 v_texCoord;
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = (a_position + 1.0) / 2.0;
            }
        `;

        // Fragment shader for Sobel edge detection
        const fragmentShaderSource = `
            precision mediump float;
            varying vec2 v_texCoord;
            uniform sampler2D u_albumTexture;
            uniform vec2 u_texelSize;
            uniform bool u_hasAlbumTexture;

            #define PI 3.14159265359

            // Convert RGB to grayscale
            float rgb2gray(vec3 color) {
                return dot(color, vec3(0.299, 0.587, 0.114));
            }

            // Sobel edge detection with gradient direction
            vec4 sobel_with_direction(vec2 uv) {
                if (!u_hasAlbumTexture) return vec4(0.0);

                // Sample neighboring pixels
                float tl = rgb2gray(texture2D(u_albumTexture, uv + vec2(-u_texelSize.x, -u_texelSize.y)).rgb); // top left
                float tm = rgb2gray(texture2D(u_albumTexture, uv + vec2(0.0, -u_texelSize.y)).rgb);              // top middle
                float tr = rgb2gray(texture2D(u_albumTexture, uv + vec2(u_texelSize.x, -u_texelSize.y)).rgb);   // top right
                float ml = rgb2gray(texture2D(u_albumTexture, uv + vec2(-u_texelSize.x, 0.0)).rgb);             // middle left
                float mr = rgb2gray(texture2D(u_albumTexture, uv + vec2(u_texelSize.x, 0.0)).rgb);              // middle right
                float bl = rgb2gray(texture2D(u_albumTexture, uv + vec2(-u_texelSize.x, u_texelSize.y)).rgb);   // bottom left
                float bm = rgb2gray(texture2D(u_albumTexture, uv + vec2(0.0, u_texelSize.y)).rgb);              // bottom middle
                float br = rgb2gray(texture2D(u_albumTexture, uv + vec2(u_texelSize.x, u_texelSize.y)).rgb);    // bottom right

                // Sobel X kernel (horizontal edges)
                float sobelX = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
                
                // Sobel Y kernel (vertical edges)
                float sobelY = (tl + 2.0 * tm + tr) - (bl + 2.0 * bm + br);
                
                // Calculate magnitude
                float magnitude = sqrt(sobelX * sobelX + sobelY * sobelY);
                
                // Calculate gradient direction (angle)
                // atan returns value in range [-PI, PI], normalize to [0, 1]
                float angle = atan(sobelY, sobelX);
                float normalizedAngle = (angle + PI) / (2.0 * PI);
                
                // Return: RGB = edge magnitude, Alpha = gradient direction
                return vec4(magnitude, magnitude, magnitude, normalizedAngle);
            }

            // Convert HSV to RGB
            vec3 hsv2rgb(vec3 c) {
                vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
                vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
                return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
            }

            void main() {
                vec4 sobelResult = sobel_with_direction(v_texCoord);
                
                // Extract edge magnitude and gradient direction
                float magnitude = sobelResult.r; // Edge intensity
                float direction = sobelResult.a;  // Gradient direction (0-1)
                
                // Convert gradient direction to color wheel:
                // 0.0 (0°) = Red (right)
                // 0.25 (90°) = Yellow (up) 
                // 0.5 (180°) = Cyan (left)
                // 0.75 (270°) = Magenta (down)
                // 1.0 (360°) = Red (right again)
                
                // Create HSV color where:
                // H = direction (hue from gradient angle)
                // S = saturation (full saturation for vivid colors)
                // V = magnitude (brightness based on edge strength)
                vec3 hsv = vec3(direction, 1.0, magnitude);
                vec3 rgb = hsv2rgb(hsv);
                
                // Output the colored edge result
                // RGB = directional color based on gradient
                // Alpha = preserve original magnitude for future use
                gl_FragColor = vec4(rgb, magnitude);
            }
        `;

        // Create and compile Sobel shaders
        const vertexShader = this.create_shader(this.gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = this.create_shader(this.gl.FRAGMENT_SHADER, fragmentShaderSource);

        if (!vertexShader || !fragmentShader) {
            console.error('Failed to create Sobel shaders');
            return;
        }

        // Create Sobel program
        this.sobel_program = this.gl.createProgram();
        if (!this.sobel_program) {
            console.error('Failed to create Sobel WebGL program');
            return;
        }

        this.gl.attachShader(this.sobel_program, vertexShader);
        this.gl.attachShader(this.sobel_program, fragmentShader);
        this.gl.linkProgram(this.sobel_program);

        if (!this.gl.getProgramParameter(this.sobel_program, this.gl.LINK_STATUS)) {
            console.error('Failed to link Sobel program:', this.gl.getProgramInfoLog(this.sobel_program));
            return;
        }

        // Create framebuffer for Sobel edge detection texture
        this.sobel_framebuffer = this.gl.createFramebuffer();
        this.sobel_texture = this.gl.createTexture();
        
        if (!this.sobel_framebuffer || !this.sobel_texture) {
            console.error('Failed to create Sobel framebuffer or texture');
            return;
        }

        // Setup Sobel texture
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.sobel_texture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, 256, 256, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

        // Attach texture to framebuffer
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.sobel_framebuffer);
        this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, this.sobel_texture, 0);

        // Check framebuffer completeness
        if (this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER) !== this.gl.FRAMEBUFFER_COMPLETE) {
            console.error('Sobel framebuffer is not complete');
        }

        // Restore default framebuffer
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    }

    private render_sobel_texture(): void {
        if (!this.gl || !this.sobel_program || !this.sobel_framebuffer || !this.sobel_texture || !this.album_texture) {
            return;
        }

        // Switch to Sobel framebuffer
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.sobel_framebuffer);
        this.gl.viewport(0, 0, 256, 256);

        // Use Sobel program
        this.gl.useProgram(this.sobel_program);

        // Bind album texture as input
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.album_texture);
        
        // Use safe uniform setting for Sobel shader
        const albumTextureLocation = this.gl.getUniformLocation(this.sobel_program, 'u_albumTexture');
        if (albumTextureLocation !== null) {
            this.gl.uniform1i(albumTextureLocation, 0);
        }

        const texelSizeLocation = this.gl.getUniformLocation(this.sobel_program, 'u_texelSize');
        if (texelSizeLocation !== null) {
            this.gl.uniform2f(texelSizeLocation, 1.0 / 256.0, 1.0 / 256.0);
        }

        const hasAlbumTextureLocation = this.gl.getUniformLocation(this.sobel_program, 'u_hasAlbumTexture');
        if (hasAlbumTextureLocation !== null) {
            this.gl.uniform1i(hasAlbumTextureLocation, 1);
        }

        // Setup vertex attributes for Sobel shader
        const positionLocation = this.gl.getAttribLocation(this.sobel_program, 'a_position');
        this.gl.enableVertexAttribArray(positionLocation);
        this.gl.vertexAttribPointer(positionLocation, 2, this.gl.FLOAT, false, 0, 0);

        // Clear and draw to generate Sobel texture
        this.gl.clearColor(0.0, 0.0, 0.0, 1.0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);

        // Switch back to default framebuffer and main visualizer program
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        this.gl.viewport(0, 0, this.visualizer_canvas!.width, this.visualizer_canvas!.height);
        this.gl.useProgram(this.visualizer_program);
    }
}