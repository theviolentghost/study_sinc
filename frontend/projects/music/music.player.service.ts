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
    @Output() hls_level_changed: EventEmitter<{index: number, details: any}> = new EventEmitter<{index: number, details: any}>();

    set_audio_element(element: HTMLAudioElement | null): void {
        this.audio_element = element;

        this.setup_media_session_action_handlers();
        this.setup_audio_event_listeners();
        this.setup_visibility_change_listeners();
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
        // if()
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

    private is_ios_safari = /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase()) && /safari/.test(navigator.userAgent.toLowerCase()) && !/crios|fxios|edgios|opr\//.test(navigator.userAgent.toLowerCase());

    // outside paramaters
    private _shuffle: boolean = false;
    public repeat: number = 0; // 0 = no repeat, 1 = repeat infinitely
    private _disco_mode: boolean = false;

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

        if(this.playing_silent_audio) {
            // playing silent audio, switch back to real audio
            await this.switch_from_silent_audio_to_real_audio();
            return this.play_audio();
        }

        // Add to recently played
        if(this.audio_data.current.data) {
            this.playlist_service.add_to_recently_played(this.audio_data.current.data);
        }

        return this.play_audio();
    }

    private async play_audio(): Promise<boolean> {
        try {
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

            await this.load_audio(this.audio_data.current.audio_source, this.audio_data.current.source_type);
            this.audio_element.play();
            // this.audio_element.currentTime = this.real_audio_timestamp;
            this.update_playback_state();
            this.playing_silent_audio = false;
            this.switching_from_silent = true;
            this.update_media_session();
            return true;
        } catch (error) {
            console.error('Error switching from silent to real audio:', error);
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

        if(/*!this.is_app_in_foreground &&*/ this.use_silent_audio_to_preserve_audio_pipeline /*&& this.is_ios_safari*/) {
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
            this.track_loaded.emit();
            this.audio_data.current.loaded = true;
            if(this.wants_to_play) {
                this.play();
                this.wants_to_play = false;
            }
            // if(this.playing_silent_audio ) {
            //     // if we were playing silent audio, switch back to real audio now that real audio is loaded
            //     this.playing_silent_audio = false;
            //     // restore positions
            //     this.audio_element.currentTime = this.real_audio_timestamp;
            //     this.update_playback_state();
            // }
            if(this.switching_from_silent) {
                this.switching_from_silent = false;
                // start interval that waits until audio duration is greater or equal to real_aduio_timestamp then set current time
                const checkInterval = setInterval(() => {
                    if (this.audio_element!.duration >= this.real_audio_timestamp) {
                        this.audio_element!.currentTime = this.real_audio_timestamp;
                        this.update_playback_state();
                        clearInterval(checkInterval);
                    }
                }, 100);
            }
        });
        this.audio_element.addEventListener('play', () => {
            this.update_playback_state();
        });
        this.audio_element.addEventListener('pause', () => {
            this.update_playback_state();
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
        document.addEventListener('visibilitychange', () => {
            this.is_app_in_foreground = document.visibilityState === 'visible';
            console.log('App is in foreground:', this.is_app_in_foreground);
        });
        (document as any).addEventListener('webkitvisibilitychange', () => {
            this.is_app_in_foreground = document.visibilityState === 'visible';
        });
        window.addEventListener('focus', () => {
            this.is_app_in_foreground = true;
        });
        window.addEventListener('blur', () => {
            this.is_app_in_foreground = false;
        });
        window.addEventListener('pagehide', (e) => {
            this.is_app_in_foreground = false;
        }, { capture: true });

        window.addEventListener('pageshow', (e) => {
            this.is_app_in_foreground = true;
        }, { capture: true });
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
        await this.load_track(data);
        this.wants_to_play = true;
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

        // pause current audio
        if(load_type === 'current') {
            this.audio_element.pause();
            // this.preload_next_track();
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

        // song identifier must be set now
        // and so should song_data if it was available in the cache
        if(!song_identifier) {
            console.error('No valid song identifier provided to load_track');
            return;
        }

        audio_data_reference.identifier = song_identifier;

        if(song_data) {
            if(load_type === 'current') this.update_media_session(song_data);
            audio_data_reference.data = song_data;
        }
        if(load_type === 'current') this.song_changed.emit();

        audio_data_reference.loaded = false;

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
        return null; // no next track
    }

    private is_next_track_preloaded(): boolean {
        return this.audio_data.next.loaded;
    }
    private is_track_the_same_as_preloaded(track_identifier: Song_Identifier | null): boolean {
        if(!track_identifier || !this.audio_data.next.identifier) return false;
        return (track_identifier.video_id === this.audio_data.next.identifier.video_id);
    }

    private async preload_next_track(): Promise<void> {
        let next_identifier = this.get_next_track_identifier();
        if(!next_identifier) {
            // try refilling playlist and try again
            this.refill_playlist_queue_from_playlist_data();
            next_identifier = this.get_next_track_identifier();
            if(!next_identifier) return; // no next track
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
        console.log('Skipping to next song:', next_song_key);
        if(this.is_next_track_preloaded()) {
            // use preloaded next track
            console.log('Using preloaded next track:', next_song_key);
            console.log('Preloaded next track identifier:', this.audio_data.next.identifier);
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

        await this.load_and_play_track(next_song_key);
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
        if(this.playlist.history_stack.length === 0) {
            console.warn('No previous song in history to skip to.');
            return;
        }
        this.skipping_to_previous = true;

        const current_song_key = this.media.song_key(this.audio_data.current.identifier);
        const previous_song_key = this.playlist.history_stack.pop();
        await this.load_and_play_track(previous_song_key);
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

    public unshuffle_playlist(): void {
        const original_songs = Array.from(this.playlist.data.songs.values());

        if(this.playlist.data.song_added_timestamps.size === 0) {
            // using third party playlist without timestamps, cannot unshuffle
            console.warn('Cannot unshuffle playlist without song added timestamps.');
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
                    return (this.song_cache.get(this.media.song_key(a))?.song_name || '').localeCompare(this.song_cache.get(this.media.song_key(b))?.song_name || '');
                default:
                    return 0;
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
}
