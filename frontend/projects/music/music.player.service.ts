import { Injectable } from '@angular/core';
import { Output, EventEmitter } from '@angular/core';

import { MusicMediaService, Song_Identifier, Song_Data, Song_Playlist, Song_Playlist_Identifier } from './music.media.service';
import { PlaylistsService } from './playlists.service';
import Hls from 'hls.js';


export interface Song_Queue {
    queue: Song_Identifier[];
}

interface Noise_Node {
    x: number;
    y: number;
    intesnity: number; 
    color: [number, number, number]; 
}

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
    @Output() hls_level_changed: EventEmitter<{index: number, details: any}> = new EventEmitter<{index: number, details: any}>();
    // private song_blob_cache: Map<string, Blob> = new Map();

    private current_media: Song_Data | null = null; // Current media data for media session
    private current_song: Song_Identifier | null = null; // Current song being played
    private current_song_data: Song_Data | null = null; // Current song data

    public preloaded_next_song: boolean = false; // Whether HLS is preloaded
    private next_song: Song_Identifier | null = null; // Next song to be played
    private next_song_data: Song_Data | null = null; // Next song data
    private preloaded_hls_data: any = null; // Preloaded HLS data for next song

    public playlist_song_data_map: Map<string, Song_Data> = new Map(); // Cache for playlist song data

    public play_next_queue: Song_Queue = {queue:[]};
    public playlist_queue: Song_Queue = {queue:[]};
    private history_stack: Song_Queue = {queue:[]};
    private current_playlist: Song_Playlist | null = null;
    private current_playlist_identifier: Song_Playlist_Identifier | null = null;

    private audio_element: HTMLAudioElement | null = null;
    private source_element: HTMLSourceElement | null = null; // For setting audio source
    public thumbnail_element: HTMLImageElement | null = null;
    loading: boolean = true;
    started_playing: boolean = false; 
    error: string | null = null; // Error message if any

    private audio_context: AudioContext | null = null; // For advanced audio processing
    private audio_analyser: AnalyserNode | null = null; // For audio visualizations
    private audio_source: MediaElementAudioSourceNode | null = null; // For connecting audio element to context
    private audio_data_array: Uint8Array | null = null; // For frequency data analysis

    private hls: Hls | null = null; // For HLS streaming support

    private setup_hls(): void {
        if(!this.audio_element) return;
        if (this.hls) {
            this.hls.destroy();
        }

        if (Hls.isSupported()) {
            this.hls = new Hls({
                startLevel: -1, // Start with auto quality selection
                autoStartLoad: true, // Start loading immediately
                enableWorker: true, // Disable worker for immediate processing
                maxBufferLength: 120, // Increase from 5 to 10 seconds
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

            // Custom playlist parsing
            this.hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
                // console.log(`🎵 Manifest loaded with ${data.levels.length} quality levels`);
            });
            this.hls.attachMedia(this.audio_element!);
            
            this.hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
                if(this.audio_element) this.audio_element!.currentTime = 0; // Reset to start
            });
            
            // Listen for manifest updates (when new qualities are added)
            this.hls.on(Hls.Events.MANIFEST_LOADED, (event, data) => {
                // console.log(`🎵 Manifest loaded with ${data.levels.length} quality levels`);
                
                // If multiple levels are available, enable auto quality
                if (data.levels.length > 1) {
                    this.hls.nextLevel = -1; // Enable auto quality selection
                }
            });

            this.hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
                // console.log('HLS level switched to:', data.level);
                if(this.current_song_data && this.current_song_data.downloaded) return; // don't emit for downloaded songs
                this.hls_level_changed.emit({index: data.level, details: this.hls?.levels[data.level]});

            });
            
            this.hls.on(Hls.Events.ERROR, (event, data) => {
                // console.error('HLS Error:', data);
                if (data.fatal) {
                    this.song_error.emit(Player_Error.COULD_NOT_LOAD);
                    console.error('Fatal HLS error encountered:', data);
                }
            });
            
        } else if (this.audio_element!.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari native HLS support
            // audio.src = playlistUrl;
            console.warn('HLS is not supported in this browser, using native support if available.');
        } else {
            console.error('HLS is not supported in this browser.');
        }
    }

    private load_source_to_hls(hls_data: any): void {
        if (this.hls) {
            console.log(`Loading HLS playlist from URL: ${hls_data.playlist_url}`);
            this.hls.loadSource(hls_data.playlist_url);
            this.hls.startLoad();
        } else if (this.audio_element) {
            this.audio_element.src = hls_data.playlist_url;
            this.audio_element.load();
        }
    }

    get player_status(): 'loading' | 'playing' | 'paused' | 'stopped' {
        if (!this.audio_element) return 'stopped';
        if (this.loading) return 'loading'; // middle of loading song
        if (this.audio_element.paused) return 'paused';
        if (this.audio_element.readyState < 2) return 'loading'; // Not enough data to play
        return 'playing';
    }

    set shuffle(value: boolean) {
        this._shuffle = value;
        if (value) this.shuffle_playlist();
        else this.unshuffle_playlist();
    }
    get shuffle(): boolean {
        return this._shuffle;
    }
    set disco_mode(value: boolean) {
        this._disco_mode = value;
        if (value) {
            // Start disco mode visualizations
            this.start_visualization();
        } else {
            // Stop disco mode visualizations
            this.stop_visualization();
        }
    }
    get disco_mode(): boolean {
        return this._disco_mode;
    }
    get playlist(): Song_Playlist | null {
        return this.current_playlist;
    }
    get playlist_identifier(): Song_Playlist_Identifier | null {
        return this.current_playlist_identifier;
    }
    get media_data(): Song_Data | null {
        return this.current_media;
    }
    get song_data(): Song_Data | null {
        return this.current_song_data;
    }
    set song_data(data: Song_Data | null) {
        this.current_song_data = data;
        this.current_media = data;
    }
    get current_time(): number {
        return this.audio_element ? this.audio_element.currentTime : 0; 
    }
    get duration(): number {
        if(this._song_duration) return this._song_duration / 1000; // Use known duration if available
        if(this.audio_element && !isNaN(this.audio_element.duration)) return this.audio_element.duration;
        return 0; // Default to 0 if no duration is available
    }

    private _shuffle: boolean = false;
    private _repeat: number = 0; // how many times to repeat the current track (0 = no repeat, 1 = repeat once, etc.)
    // private _crossfade_duration: number = 2; // default crossfade duration in seconds
    private _disco_mode: boolean = false; 
    private _song_duration: number = 0; // Duration of the current song in seconds
    private _preload_next: boolean = true; // Whether to preload the next track

    set audio_source_element(element: HTMLAudioElement) {
        this.audio_element = element;
        this.source_element = element.querySelector('source');
        console.log("Audio element set:", element);
        console.log("Source element set:", this.source_element);
        this.intialize_audio_enviroment();
        this.setup_hls();
    }
    set thumbnail_source_element(element: HTMLImageElement) {
        this.thumbnail_element = element;
    }

    constructor(private media: MusicMediaService, private playlist_service: PlaylistsService) {
        this.song_changed.subscribe(() => {
            this.current_song_data = null;
            this.loading = true; 
        });
        this.track_loaded.subscribe(() => {
            this.loading = false;
        });
    }

    public async load_playlist(playlist: Song_Playlist | null, keep_hsitroy?: boolean, play_imediately: boolean = true, load_track: boolean = false, playlist_identifier?: Song_Playlist_Identifier | null | undefined, use_old_data: boolean = false): Promise<void> {
        if (!playlist) {
            console.warn("No playlist provided to load.");  
            return;
        }

        if(playlist.songs.size === 0) return;

        this.current_playlist_identifier = playlist_identifier || this.current_playlist_identifier;
        this.current_playlist = playlist;
        const all_songs_in_playlist = Array.from(playlist.songs.values());
        this.playlist_queue.queue = [...all_songs_in_playlist]
        if(!use_old_data) this.playlist_song_data_map.clear(); // Clear previous song data cache
        
        const song_data_promises = this.playlist_queue.queue.map(async (song) => {
            try {
                const data = this.playlist_song_data_map.get(this.media.song_key(song)) || await this.media.get_song_data(this.media.song_key(song));
                if (data) {
                    this.playlist_song_data_map.set(this.media.song_key(song), data);
                }
                return { song: this.media.song_key(song), success: true, data };
            } catch (err) {
                console.error(`Failed to load song data for ${this.media.song_key(song)}:`, err);
                return { song: this.media.song_key(song), success: false, error: err };
            }
        });

        // Wait for all song data to load (or fail)
        const results = await Promise.allSettled(song_data_promises);
        
        // Log results for debugging
        const successful_loads = results.filter(result => 
            result.status === 'fulfilled' && result.value.success
        ).length;
        console.log(song_data_promises)
        console.log(`Loaded song data for ${successful_loads}/${this.playlist_queue.queue.length} songs`);

        if(this.playlist_queue.queue.length > 1) this.remove_current_song_from_queue(); // Ensure current song is not in the queue
        if(!keep_hsitroy) this.history_stack.queue = []; // Clear history stack when loading a new playlist

        if(this._shuffle) this.shuffle_playlist();

        // Only skip to next if we don't have a current song
        if (play_imediately) {
            this.open_player.emit(); 
            this.song_changed.emit(); 
            await this.skip_to_next(); // Load the first track in the playlist
        }
        else {
            if(load_track) this.load_track(this.media.song_key(this.playlist_queue.queue[0]));
        }
    }

    public async load_song_data_array_into_playlist_cache(song_data_array: Song_Data[]): Promise<void> {
        if (!song_data_array || song_data_array.length === 0) return;

        for (const song_data of song_data_array) {
            const song_key = this.media.song_key(song_data.id);
            this.playlist_song_data_map.set(song_key, song_data);
        }
    }

    remove_current_song_from_queue(): void {
        if (!this.current_song || !this.playlist_queue.queue.length) return;

        this.playlist_queue.queue = this.playlist_queue.queue.filter(song => song.video_id !== this.current_song?.video_id);
    }

    private async load_track(track_key: string, track_data?: Song_Data | null): Promise<void> {
        if (!this.audio_element) throw new Error("Audio element is not set.");

        this.song_changed.emit();
        this.loading = true;
        this.started_playing = false;

        // console.log("Loading track:", track_key, "with preloaded key:", this.media.song_key(this.next_song_data?.id), 'and next song data:', this.next_song_data);
        if(this.preloaded_next_song) {
            if(track_key === this.media.song_key(this.next_song_data?.id)) {
                console.log("Loading preloaded next track:", this.next_song);
                // song is preloaded as next song, use that data
                return this.load_track_with_preloaded_track();
            }
            this.preloaded_next_song = false;
            // // Clear preloaded data
            // this.next_song = null;
            // this.next_song_data = null;
            // this.preloaded_hls_data = null;
        }

        const next_song_identifier = this.get_next_song_identifier();
        if (next_song_identifier) {
            this.preload_next_track(this.media.song_key(next_song_identifier));
        }

        let [source_url, song_data]: [string | null | undefined, Song_Data | null | undefined] = [null, track_data];
        if(this.playlist_song_data_map.has(track_key)) {
            // If we have the song data cached, use it
            song_data = this.playlist_song_data_map.get(track_key) || null;
        }

        if(song_data) {
            // optomistic loading
            this.current_song_data = song_data;
            this.update_media_session(song_data, track_key);
            // this.current_song = song_data.id;
        }

        // Run both async operations in parallel
        if( !song_data) {
            [source_url, song_data] = await Promise.all([
                this.media.get_audio_source_from_indexDB(track_key),
                this.media.get_song_data(track_key)
            ]);
            if( !song_data || track_key === this.media.song_key(this.current_song)) {
                // If no song data or same as current song, just return
                // set to begining of track
                this.loading = false;
                if (this.audio_element) {
                    this.audio_element.currentTime = 0;
                    this.play();
                }
                return;
            }
            this.current_song = song_data.id;
        } else {
            song_data = track_data;
            if( !song_data || track_key === this.media.song_key(this.current_song)) {
                // If no song data or same as current song, just return
                // set to begining of track
                this.loading = false;
                if (this.audio_element) {
                    this.audio_element.currentTime = 0;
                    this.play();
                }
                return;
            }
            this.current_song = song_data.id;
        }

        this.current_song_data = song_data;
        this.current_media = song_data; 
        this.current_song = song_data.id;

        this.update_media_session(song_data, track_key);
        await this.load_audio(track_key, song_data);
    } 

    private async load_track_with_preloaded_track(): Promise<void> {
        if (!this.next_song || !this.next_song_data) {
            console.warn("No preloaded next song available.");
            return;
        }

        this.preloaded_next_song = false;

        if(this.next_song_data.downloaded) {
            this.load_audio(this.media.song_key(this.next_song), this.next_song_data);
            return; // use downloaded media
        }

        this.current_song = this.next_song;
        this.current_song_data = this.next_song_data;
        this.current_media = this.next_song_data; 
        const track_key = this.media.song_key(this.next_song);

        this.update_media_session(this.next_song_data, track_key);
        this.load_source_to_hls(this.preloaded_hls_data);

        // Clear preloaded data
        this.next_song = null;
        this.next_song_data = null;
        this.preloaded_hls_data = null;

        const next_song_identifier = this.get_next_song_identifier();
        if (next_song_identifier) {
            this.preload_next_track(this.media.song_key(next_song_identifier));
        }
    }

    private loadAudioController: AbortController | null = null;
    private updateMediaSessionController: AbortController | null = null;

    async load_audio(track_key: string, track_data: Song_Data | null | undefined): Promise<void> {
        if (!this.audio_element) throw new Error("Audio element is not set.");

        this.setup_media_session();

        // Cancel any existing load_audio operation
        if (this.loadAudioController) {
            this.loadAudioController.abort();
        }

        // Create new controller for this operation
        this.loadAudioController = new AbortController();
        const signal = this.loadAudioController.signal;

        let source_url: string | null = null; 

        try {
            // Check if aborted before starting
            signal.throwIfAborted();

            // Check abort status before getting source URL
            if (signal.aborted) return;

            let is_local_content = false;

            if (track_data?.downloaded && track_data.download_audio_blob) {
                // Use downloaded blob if available
                const blob = track_data.download_audio_blob;
                const array_buffer = await blob.arrayBuffer();
                if( array_buffer.byteLength > 0) {
                    // fresh url with fresh blob
                    source_url = URL.createObjectURL(new Blob([array_buffer]));
                    is_local_content = true; // Local content, safe to use audio context

                    // in future, when download quality matters, change index based on quality
                    this.hls_level_changed.emit({index: 3, details: {downloaded: true}});
                }
            } else {
                const hls_stream_data = await this.media.get_hls_stream(track_key);
                if( !hls_stream_data || !hls_stream_data?.success) {
                    // could not get HLS stream, fallback to audio source
                    console.log(`No HLS stream available for track ${track_key}, using audio source.`, hls_stream_data);
                    this.song_error.emit(Player_Error.COULD_NOT_LOAD);
                    return;
                }
                this.load_source_to_hls(hls_stream_data!);
                // this.hls.startLoad(); // Ensure HLS starts loading if applicable

                is_local_content = false; // External content, likely CORS restricted
                return; // Don't use audio context for external content
            }

            // source_url = (track_data?.downloaded && track_data?.download_audio_blob && track_data.download_audio_blob instanceof Blob && track_data.download_audio_blob.size > 0
            //     ? URL.createObjectURL(track_data.download_audio_blob) 
            //     : (track_data?.url?.audio || await this.media.get_audio_stream(track_key)));
            if (signal.aborted) return;

            if (!source_url) {
                console.error(`No audio source found for track key: ${track_key}`);
                // only emit error if it's the current song
                if(track_data.id.video_id === this.current_song_data.id.video_id) this.song_error.emit(Player_Error.COULD_NOT_LOAD);
                // this.unload_audio();
                this.loading = false;
                return;
            }

            if (signal.aborted) return;
            
            this.audio_element.src = source_url;
            this.audio_element.load();

            this.connect_audio_context(is_local_content);
        } catch (error: any) {
            if (error.name === 'AbortError') {
                console.log('Load audio operation was aborted for track:', track_key);
                return;
            }
            // Re-throw other errors
            throw error;
        } finally {
            // Clean up controller if this operation completed
            if (this.loadAudioController && this.loadAudioController.signal === signal) {
                this.loadAudioController = null;
            }
        }
    }

    private unload_audio(): void {
        if (!this.audio_element) return;

        // this.audio_element.pause();
        if(this.audio_element.src === '') return; // No source to unload
        
        // Only revoke blob URLs, not regular HTTP/HTTPS URLs
        if (this.audio_element.src.startsWith('blob:')) {
            URL.revokeObjectURL(this.audio_element.src);
        }
        
        this.audio_element.src = '';
        this.audio_element.load();

        // Reset HLS if it exists
        if (this.hls) {
            // this.hls.loadSource('');
            // console.log("Unloading HLS stream...");
            this.hls.stopLoad();
            // this.hls.detachMedia();
        }
    }

    async load_and_play_track(track_key: string, track_data?: Song_Data): Promise<void> {
        if (!this.audio_element) throw new Error("Audio element is not set.");

        await this.pause(); 
        await this.load_track(track_key, track_data);
        await this.play();
    }

    // Preload next track for smooth transitions
    private async preload_next_track(track_key: string): Promise<void> {
        if (!this.audio_element) throw new Error("Audio element is not set.");
        if(!this._preload_next) return; // Preloading is disabled

        const song_data = this.playlist_song_data_map.get(track_key) || await this.media.get_song_data(track_key);

        // console.log("Requesting Preload...:", track_key);
        if((this.next_song && this.media.song_key(this.next_song) === track_key) || song_data?.downloaded) {
            this.preloaded_next_song = true; // for visualization
            return; // Already preloaded
        }
        this.preloaded_hls_data = await this.media.preload_hls_stream(track_key);

        this.next_song_data = song_data;
        this.next_song = this.next_song_data?.id || null;

        this.preloaded_next_song = true;

        // console.log("Preloaded next track:", this.next_song, "with data:", this.next_song_data);
    }

    private async intialize_audio_enviroment(): Promise<void> {
        if(!this.audio_element) throw new Error("Audio element is not set.");

        this.setup_audio_listeners();
        this.setup_media_session();

        if(!this.audio_context) {
            this.audio_context = new AudioContext({
                sampleRate: 44100  // Options: 22050, 44100, 48000, 96000, 192000
            });
            this.audio_analyser = this.audio_context.createAnalyser();
            this.audio_analyser.fftSize = 512; // Options: 256, 512, 1024, 2048, 4096, 8192, 16384, 32768
            this.audio_data_array = new Uint8Array(this.audio_analyser.frequencyBinCount);

            console.log("Audio context initialized:", this.audio_context);

            // this.audio_source = this.audio_context.createMediaElementSource(this.audio_element);
            // this.audio_source.connect(this.audio_analyser);
            // this.audio_source.connect(this.audio_context.destination);
        }
        // setTimeout(()=>{this.setup_media_session();},3000); //temp
    }

    private connect_audio_context(is_local_content: boolean): void {
        if (!this.audio_context || !this.audio_element) return;

        // Disconnect existing connections
        // if (this.audio_source) {
        //     this.audio_source.disconnect();
        //     this.audio_source = null;
        // }

        if (is_local_content) {
            try {
                if (!this.audio_source) {
                    this.audio_source = this.audio_context.createMediaElementSource(this.audio_element);
                    this.audio_source.connect(this.audio_analyser!);
                    this.audio_source.connect(this.audio_context.destination);
                }
                console.log('Audio context connected for local content');

                if(this.disco_mode) this.start_visualization(); 
            } catch (error) {
                console.warn('Failed to connect audio context:', error);
                // Fallback: audio will play normally without analysis
            }
        } else {
            // For external content, don't use audio context
            console.log('Skipping audio context connection for external content due to CORS');
        }
    }
    
    private setup_media_session(): void {
        if ('mediaSession' in navigator) {
            // alert("Media Session API is supported in this browser.");
            // Set up media session handlers
            navigator.mediaSession.setActionHandler('play', () => {
                this.play();
            });

            navigator.mediaSession.setActionHandler('pause', () => {
                this.pause();
            });

            navigator.mediaSession.setActionHandler('nexttrack', () => {
                this.skip_to_next();
            });

            navigator.mediaSession.setActionHandler('previoustrack', () => {
                this.skip_to_previous();
            });

            navigator.mediaSession.setActionHandler('seekto', (details) => {
                if (details.seekTime && this.audio_element) {
                    this.audio_element.currentTime = details.seekTime;
                }
            });
        }

        this.update_playback_state();
    }

    private update_playback_state(): void {
        if ('mediaSession' in navigator && navigator.mediaSession) {
            // Set playback state based on current audio state
            if (!this.audio_element) {
                navigator.mediaSession.playbackState = 'none';
                return;
            }

            if (this.loading) {
                navigator.mediaSession.playbackState = 'none';
            } else if (this.audio_element.paused) {
                navigator.mediaSession.playbackState = 'paused';
            } else {
                navigator.mediaSession.playbackState = 'playing';
            }

            // Update position state to help iOS understand track capabilities
            if (this.audio_element && !isNaN(this.audio_element.duration)) {
                try {
                    navigator.mediaSession.setPositionState({
                        duration: this.audio_element.duration,
                        playbackRate: this.audio_element.playbackRate,
                        position: this.audio_element.currentTime
                    });
                } catch (error) {
                    console.warn('Could not set position state:', error);
                }
            }
        }
    }

    // Update media session metadata
    async update_media_session(song: Song_Data | null, track_key: string): Promise<void> {
        // Cancel any existing update_media_session operation
        if (this.updateMediaSessionController) {
            this.updateMediaSessionController.abort();
        }

        // Create new controller for this operation
        this.updateMediaSessionController = new AbortController();
        const signal = this.updateMediaSessionController.signal;

        try {
            // Check if aborted before starting
            signal.throwIfAborted();

            this.current_media = song; 
            let artwork: string = "";
            
            if (song) {
                // Check abort status before processing artwork
                if (signal.aborted) return;

                // Set media session metadata immediately
                if ('mediaSession' in navigator && navigator.mediaSession && song) {
                    navigator.mediaSession.metadata = new MediaMetadata({
                        title: song.song_name,
                        artist: song.original_artists[0]?.name || 'Unknown Artist',
                    });
                }

                try {
                    navigator.mediaSession.setPositionState({
                        duration: (song.video_duration || 0) / 1000, // ms to s if needed
                        playbackRate: 1,
                        position: 0
                    });
                } catch (e) {
                    // Some browsers may throw if not supported
                    console.warn('Could not set position state:', e);
                }

                // HIGH PRIORITY: Use downloaded artwork blob first
                if (song.download_artwork_blob) {
                    artwork = URL.createObjectURL(song.download_artwork_blob);
                }
                // MEDIUM PRIORITY: Use high quality URL
                else if (song.url?.artwork?.high) {
                    artwork = song.url.artwork.high;
                }

                else if (song.url?.artwork?.low) {
                    artwork = song.url.artwork.low;
                }
                // LOW PRIORITY: Get artwork from media service
                else {
                    const fallback_artwork = await this.media.get_song_artwork(song);
                    
                    // Check if aborted after async operation
                    if (signal.aborted) return;
                    
                    artwork = fallback_artwork || "";
                }
            } else {
                // Fallback for when no song data is available
                artwork = `/audio/artwork/${track_key}`;
            }

            // Final check before updating UI elements
            if (signal.aborted) return;

            // Update thumbnail element
            if (this.thumbnail_element) {
                this.thumbnail_element.src = artwork;
            }

            // Update media session
            if ('mediaSession' in navigator && navigator.mediaSession && song) {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: song.song_name,
                    artist: song.original_artists[0]?.name || 'Unknown Artist',
                    artwork: [
                        { src: artwork, sizes: '512x512', type: 'image/png' }
                    ]
                });
            }

            this._song_duration = song.video_duration || await this.media.get_audio_duration(track_key) || 0;

            // if colors are not set generate them
            if (song && (!song.colors.primary || !song.colors.common)) {
                song.colors = {
                    primary: song.colors?.primary || await this.media.get_primary_color_from_artwork(artwork),
                    common: song.colors?.common ||  await this.media.get_top_colors_from_artwork(artwork)
                };

                // Update song data with new colors
                this.playlist_song_data_map.set(track_key, song);
                this.current_song_data = song; // Update current song data
                this.media.save_song_to_indexDB(track_key, song); // Save updated song data
                this.media.song_data_updated.emit(song); // Emit updated song data event
            }

        } catch (error: any) {
            if (error.name === 'AbortError') {
                console.log('Update media session operation was aborted for track:', track_key);
                return;
            }
            // Re-throw other errors
            throw error;
        } finally {
            // Clean up controller if this operation completed
            if (this.updateMediaSessionController && this.updateMediaSessionController.signal === signal) {
                this.updateMediaSessionController = null;
            }
        }
    }

    // Audio event listeners
    private setup_audio_listeners(): void {
        if (!this.audio_element) return;

        this.audio_element.addEventListener('loadedmetadata', () => {
            if(this.want_to_play) this._play();
            this.track_loaded.emit();
            this.loading = false;
        });

        // this.audio_element.addEventListener('timeupdate', () => {
        //     this.get_audio_data_array();
        // });

        this.audio_element.addEventListener('play', () => {
            this.started_playing = true;
            if(this.disco_mode) this.start_visualization();
        });

        this.audio_element.addEventListener('pause', () => {
            if(this.disco_mode) this.stop_visualization();
        });

        this.audio_element.addEventListener('ended', () => {
            this.handle_track_ended();
        });
    }

    private handle_track_ended(): void {
        this.skip_to_next();
    }

    private want_to_play: boolean = false;
    async play(): Promise<void> {
        if (!this.audio_element) throw new Error("Audio element is not set.");
        this.want_to_play = true; 
        if(!this.loading) {
            await this._play();
        }
    }
    async _play(): Promise<void> {
        if (!this.audio_element) throw new Error("Audio element is not set.");
        await this.audio_element.play();
        if (this.audio_context && this.audio_context.state === 'suspended') {
            await this.audio_context.resume();
        }
        this.update_playback_state();
        if(!this.current_song_data) return console.warn("No current song data available to put into recently played.");
        this.playlist_service.add_to_recently_played(this.current_song_data);
    }

    async pause(): Promise<void> {
        if (!this.audio_element) throw new Error("Audio element is not set.");
        this.want_to_play = false; 
        this.audio_element.pause();
        this.update_playback_state();
    }

    toggle_play(): void {
        if (!this.audio_element) throw new Error("Audio element is not set.");
        if (this.audio_element.paused) {
            this.play();
        } else {
            this.pause();
        }
    }

    async crossfade_to_next(fade_duration: number = 2): Promise<void> {
        
    }

    skipping_to_next = false; // Flag to prevent multiple skips
    async skip_to_next(): Promise<void> {
        if(this._repeat) {
            // If repeat is enabled, just replay the current track
            this._repeat--;
            if (this.audio_element) {
                this.audio_element.currentTime = 0; 
                await this.play();
                return;
            }
        }

        if(this.skipping_to_next) return;
        this.skipping_to_next = true;

        // Add current song to history BEFORE moving to next
        if(this.current_song) {
            this.history_stack.queue.push(this.current_song);
            // Limit history size
            if (this.history_stack.queue.length > 100) {
                this.history_stack.queue.shift();
            }
        }

        // Check play_next_queue first (priority)
        let next_song: Song_Identifier | null = null;
        if (this.play_next_queue.queue.length > 0) {
            next_song = this.play_next_queue.queue.shift()!;
        } else if (this.playlist_queue.queue.length > 0) {
            next_song = this.playlist_queue.queue.shift()!;
        }

        if (next_song) {
            this.pause();
            if(this.thumbnail_element) this.thumbnail_element.src = "";
            // console.log(`Skipping to next track: ${next_song.video_id}`, this.playlist_song_data_map.get(next_song.video_id));
            this.skipping_to_next = false;

            if(this.current_playlist) {
                this.load_and_play_track(this.media.song_key(next_song), this.playlist_song_data_map.get(this.media.song_key(next_song)));
            } else {
                this.load_and_play_track(this.media.song_key(next_song));
            }
            return;
        }

        // If no more songs, reload playlist
        if(this.current_playlist) {
            if(this.current_playlist.songs.size <= 1) {
                // Only one song in playlist, just restart it
                this.load_and_play_track(this.media.song_key(this.current_song));
            }
            console.log("No next track available, reloading current playlist...");
            this.load_playlist(this.current_playlist, true, true); // Keep history
            // console.log(this.current_playlist);

        } else {
            this.skipping_to_next = false;
            throw new Error("No next track available and no current playlist loaded.");
        }
        this.skipping_to_next = false;
    }

    private get_next_song_identifier(): Song_Identifier | null {
        if (this.play_next_queue.queue.length > 0) {
            return this.play_next_queue.queue[0];
        } else if (this.playlist_queue.queue.length > 0) {
            return this.playlist_queue.queue[0];
        }
        return null;
    }

    skipping_to_previous = false; // Flag to prevent multiple skips
    async skip_to_previous(): Promise<void> {
        // If more than 5 seconds in, restart current song
        if (this.audio_element && this.audio_element.currentTime > 5) {
            this.audio_element.currentTime = 0;
            return;
        }

        if( this.skipping_to_previous) return;
        this.skipping_to_previous = true;

        // Get previous song from history
        const previous_song = this.history_stack.queue.pop();
        
        if (previous_song) {
            this.pause();
            if(this.thumbnail_element) this.thumbnail_element.src = "";
            // Put current song back at front of playlist queue for future navigation
            if (this.current_song) {
                this.playlist_queue.queue.unshift(this.current_song);
            }
            
            // Update current song and play
            this._repeat = 0; // Reset repeat 
            if(this.current_playlist) {
                this.load_and_play_track(this.media.song_key(previous_song), this.playlist_song_data_map.get(this.media.song_key(previous_song)));
            } else {
                this.load_and_play_track(this.media.song_key(previous_song));
            }
            this.skipping_to_previous = false;
        } else {
            // No history, just restart current song
            if (this.audio_element) {
                this.audio_element.currentTime = 0;
                this.skipping_to_previous = false;
            }
        }
    }

    set_volume(volume: number): void {
        if (this.audio_element) {
            this.audio_element.volume = Math.max(0, Math.min(1, volume));
        }
    }

    seek_to(time: number): void {
        if (this.audio_element) {
            this.audio_element.currentTime = time;
        }
    }

    shuffle_playlist(): void {
        if (this.playlist_queue.queue.length > 0) {
            this.playlist_queue.queue.sort(() => Math.random() - 0.5);
        }
    }

    unshuffle_playlist(): void {
        if (this.current_playlist && this.current_playlist.songs.size > 0) {
            // Reset to original order based on playlist
            const original_order = Array.from(this.current_playlist.songs.values());
            
            if (this.current_song) {
                // Find the current song's index in the original playlist
                const current_song_index = original_order.findIndex(song => 
                    this.media.song_key(song) === this.media.song_key(this.current_song!)
                );
                
                if (current_song_index !== -1) {
                    // Split the playlist: songs after current + songs before current
                    const songs_after_current = original_order.slice(current_song_index + 1);
                    const songs_before_current = original_order.slice(0, current_song_index);
                    
                    // Combine: songs after current come first, then songs before current
                    this.playlist_queue.queue = [...songs_after_current, ...songs_before_current];
                } else {
                    // Current song not found in playlist, use original order without current song
                    this.playlist_queue.queue = original_order.filter(song => 
                        this.media.song_key(song) !== this.media.song_key(this.current_song!)
                    );
                }
            } else {
                // No current song, use original order
                this.playlist_queue.queue = [...original_order];
            }
        }
    }
    load_and_play_random_song(): void {
        if (this.playlist_queue.queue.length === 0) {
            console.warn("No songs available to load.");
            return;
        }

        const random_index = Math.floor(Math.random() * this.playlist_queue.queue.length);
        const random_song = this.playlist_queue.queue[random_index];

        // remove from queue to prevent duplicates
        this.playlist_queue.queue.splice(random_index, 1);

        this.load_and_play_track(this.media.song_key(random_song));
    }

    add_song_to_play_next(song: Song_Data | Song_Identifier): void {
        if (typeof song === 'object' && 'id' in song) {
            // song_data
            this.play_next_queue.queue.push(song.id);
        } else if (typeof song === 'object' && 'video_id' in song) {
            // song_identifier
            this.play_next_queue.queue.push(song);
        } else {
            console.error("Invalid song type provided to add to play next queue.");
        }
    }


































































































    update_audio_data_array(): void {
        if (this.audio_analyser && this.audio_data_array) {
            this.audio_analyser.getByteFrequencyData(this.audio_data_array);
        }
    }

    get_audio_data_array(): Uint8Array | null {
        this.update_audio_data_array();
        return this.audio_data_array;
    }

    private readonly frequency_ranges: {[key: string]: {min: number, max: number}} = {
        // Sub-bass (20-60 Hz)
        sub_bass_1: { min: 20, max: 30 },
        sub_bass_2: { min: 30, max: 40 },
        sub_bass_3: { min: 40, max: 50 },
        sub_bass_4: { min: 50, max: 60 },
        
        // Bass (60-250 Hz)
        bass_1: { min: 60, max: 80 },
        bass_2: { min: 80, max: 100 },
        bass_3: { min: 100, max: 125 },
        bass_4: { min: 125, max: 160 },
        bass_5: { min: 160, max: 200 },
        bass_6: { min: 200, max: 250 },
        
        // Low-midrange (250-500 Hz)
        low_mid_1: { min: 250, max: 315 },
        low_mid_2: { min: 315, max: 400 },
        low_mid_3: { min: 400, max: 500 },
        
        // Midrange (500-2000 Hz)
        mid_1: { min: 500, max: 630 },
        mid_2: { min: 630, max: 800 },
        mid_3: { min: 800, max: 1000 },
        mid_4: { min: 1000, max: 1250 },
        mid_5: { min: 1250, max: 1600 },
        mid_6: { min: 1600, max: 2000 },
        
        // Upper-midrange (2000-4000 Hz)
        upper_mid_1: { min: 2000, max: 2500 },
        upper_mid_2: { min: 2500, max: 3150 },
        upper_mid_3: { min: 3150, max: 4000 },
        
        // Presence (4000-8000 Hz)
        presence_1: { min: 4000, max: 5000 },
        presence_2: { min: 5000, max: 6300 },
        presence_3: { min: 6300, max: 8000 },
        
        // Treble (8000-16000 Hz)
        treble_1: { min: 8000, max: 10000 },
        treble_2: { min: 10000, max: 12500 },
        treble_3: { min: 12500, max: 16000 },
        
        // Air (16000-20000 Hz)
        air: { min: 16000, max: 20000 }
    }

    frequency_to_bin(frequency: number) {
        if(!this.audio_analyser) return 0;
        return Math.floor(frequency * this.audio_analyser.fftSize / (this.audio_context?.sampleRate || 44100));
    }

    private bin_to_frequency(bin: number): number {
        if (!this.audio_context || !this.audio_analyser) return 0;
        return (bin * this.audio_context.sampleRate) / this.audio_analyser.fftSize;
    }

    get_frequency_range_amplitude(min_frequqncy: number, max_frequency: number) {
        if(!this.audio_data_array || !this.audio_analyser) return 0;

        const startBin = this.frequency_to_bin(min_frequqncy);
        const endBin = this.frequency_to_bin(max_frequency);
        
        let sum = 0;
        let count = 0;
        for (let i = startBin; i <= endBin && i < this.audio_data_array.length; i++) {
            sum += this.audio_data_array[i];
            count++;
        }
        return count > 0 ? sum / count : 0;
    }

    get_frequency_analysis(key: string): number {
        if (!this.frequency_ranges[key]) {
            console.warn(`Invalid frequency range key: ${key}`);
            return 0;
        }
        const { min, max } = this.frequency_ranges[key];
        return this.get_frequency_range_amplitude(min, max);
    }

    get_frequency_analysis_all(): {[key: string]: number} {
        const analysis: {[key: string]: number} = {};
        for (const key in this.frequency_ranges) {
            analysis[key] = this.get_frequency_analysis(key);
        }
        return analysis;
    }

    get_averaged_frequency_data(group_size: number = 2): number[] {
        if (!this.audio_data_array) return [];
        this.update_audio_data_array();
        
        const grouped_data: number[] = [];
        
        for (let i = 0; i < this.audio_data_array.length; i += group_size) {
            let sum = 0;
            let count = 0;
            
            // Average the next 'group_size' bins
            for (let j = i; j < i + group_size && j < this.audio_data_array.length; j++) {
                sum += this.audio_data_array[j];
                count++;
            }
            
            grouped_data.push(count > 0 ? sum / count : 0);
        }
        
        return grouped_data;
    }

    private disco_animation_frame: number | null = null;
    start_visualization(): void {
        if (!this.audio_context || !this.audio_analyser || !this.audio_element) return;
        if (this.disco_animation_frame) {
            cancelAnimationFrame(this.disco_animation_frame);
        }
        this.canvas = document.getElementById('visualization-canvas') as HTMLCanvasElement;
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        // this.ctx = this.canvas?.getContext('2d');
        this.gl = (this.canvas?.getContext('webgl') || this.canvas?.getContext('experimental-webgl')) as WebGLRenderingContext | null;
        this.disco_animation_frame = requestAnimationFrame(this.render_disco_mode.bind(this));
        this.render_disco_mode(); // Start rendering immediately
    }

    stop_visualization(): void {
        if (this.disco_animation_frame) {
            cancelAnimationFrame(this.disco_animation_frame);
            this.disco_animation_frame = null;
        }
        if (this.canvas) {
            this.canvas.width = 0;
            this.canvas.height = 0;
        }
        if (this.gl) {
            this.gl.clearColor(0, 0, 0, 0); // Clear to black
            this.gl.clear(this.gl.COLOR_BUFFER_BIT);
            this.gl = null;
        }
        if (this.shader_program) {
            this.gl!.deleteProgram(this.shader_program);
            this.shader_program = null;
        }
        if (this.position_buffer) {
            this.gl!.deleteBuffer(this.position_buffer);
            this.position_buffer = null;
        }
    }

    canvas: HTMLCanvasElement | null = null;
    gl: WebGLRenderingContext | null = null;
    private shader_program: WebGLProgram | null = null;
    private position_buffer: WebGLBuffer | null = null;

    private noise_node_count: number = 64; 
    private max_node_influence_distance: number = 75; // pixels must be integer
    render_disco_mode(): void {
        this.disco_animation_frame = requestAnimationFrame(this.render_disco_mode.bind(this));

        // 512 / 16 = 32
        this.update_audio_data_array();
        const frequency_data = this.get_averaged_frequency_data(Math.floor(this.audio_analyser!.frequencyBinCount / this.noise_node_count)); 
        
        this.render_perimiter(this.smooth_frequency_transition(frequency_data));
    }

    prepare_spatial_grid_for_shader(nodes: Noise_Node[]): {
        grid_data: Int32Array,
        grid_offsets: Int32Array,
        grid_counts: Int32Array,
        cell_size: number,
        grid_width: number,
        grid_height: number
    } {
        if(!this.canvas) throw new Error("Canvas is not initialized.");

        const max_influence_distance = this.max_node_influence_distance; // pixels
        const cell_size = max_influence_distance; 
        const grid_width = Math.ceil(this.canvas.width / cell_size);
        const grid_height = Math.ceil(this.canvas.height / cell_size);

        const temporary_grid: number[][] = [];
        for (let i = 0; i < grid_width * grid_height; i++) {
            temporary_grid[i] = []; // Each cell starts as empty array
        }

        // Place each node in the appropriate grid cell(s)
        nodes.forEach((node, node_index) => {
            // Calculate which grid cell this node belongs to
            const grid_x = Math.floor(node.x / cell_size);
            const grid_y = Math.floor(node.y / cell_size);
            
            // Make sure we're within bounds
            if (grid_x >= 0 && grid_x < grid_width && grid_y >= 0 && grid_y < grid_height) {
                const cell_index = grid_y * grid_width + grid_x;
                temporary_grid[cell_index].push(node_index); // Add this node's index to the cell
            }
        });

        // flattened grid data
        const grid_data: number[] = [];
        const grid_offsets: number[] = [];
        const grid_counts: number[] = [];

        for (let i = 0; i < temporary_grid.length; i++) {
            grid_offsets[i] = grid_data.length; // Where this cell's data starts
            grid_counts[i] = temporary_grid[i].length; // How many nodes in this cell
            
            // Add all node indices from this cell to the flat array
            for (const node_index of temporary_grid[i]) {
                grid_data.push(node_index);
            }
        }

        return {
            grid_data: new Int32Array(grid_data),
            grid_offsets: new Int32Array(grid_offsets),
            grid_counts: new Int32Array(grid_counts),
            cell_size,
            grid_width,
            grid_height
        };
    }

    render_perimiter(frequency_data: number[]): void {
        if (!this.canvas || !this.gl) return;

        if (!this.shader_program) {
            this.shader_program = this.create_simple_shader_program();
            this.create_perimeter_geometry();
        }

        if (!this.shader_program) return;

        const noise_nodes = this.generate_noise_nodes(frequency_data);
        const spatial_grid = this.prepare_spatial_grid_for_shader(noise_nodes);

        this.gl.useProgram(this.shader_program);

        // Create textures for node data
        const texture_size = 32;
        const nodes_data = new Float32Array(texture_size * texture_size * 4);
        const colors_data = new Float32Array(texture_size * texture_size * 4);
        
        for (let i = 0; i < Math.min(noise_nodes.length, texture_size * texture_size); i++) {
            const node = noise_nodes[i];
            const base_index = i * 4;
            
            nodes_data[base_index] = node.x / this.canvas.width;      // Normalize x
            nodes_data[base_index + 1] = node.y / this.canvas.height; // Normalize y
            nodes_data[base_index + 2] = node.intesnity / 255.0;      // Normalize intensity
            nodes_data[base_index + 3] = 1.0;                         // Unused
            
            colors_data[base_index] = node.color[0];
            colors_data[base_index + 1] = node.color[1];
            colors_data[base_index + 2] = node.color[2];
            colors_data[base_index + 3] = 1.0;
        }

        // Create and bind textures
        const nodes_texture = this.create_data_texture(nodes_data, texture_size, texture_size);
        const colors_texture = this.create_data_texture(colors_data, texture_size, texture_size);
        const { grid_data_texture, grid_meta_texture, meta_tex_width } = this.create_grid_textures(spatial_grid);

        // Bind all textures
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, nodes_texture);
        this.gl.uniform1i(this.gl.getUniformLocation(this.shader_program, 'u_node_positions'), 0);
        
        this.gl.activeTexture(this.gl.TEXTURE1);
        this.gl.bindTexture(this.gl.TEXTURE_2D, colors_texture);
        this.gl.uniform1i(this.gl.getUniformLocation(this.shader_program, 'u_node_colors'), 1);
        
        this.gl.activeTexture(this.gl.TEXTURE2);
        this.gl.bindTexture(this.gl.TEXTURE_2D, grid_data_texture);
        this.gl.uniform1i(this.gl.getUniformLocation(this.shader_program, 'u_grid_data_texture'), 2);
        
        this.gl.activeTexture(this.gl.TEXTURE3);
        this.gl.bindTexture(this.gl.TEXTURE_2D, grid_meta_texture);
        this.gl.uniform1i(this.gl.getUniformLocation(this.shader_program, 'u_grid_meta_texture'), 3);

        // Send uniforms
        this.gl.uniform2f(this.gl.getUniformLocation(this.shader_program, 'u_resolution'), this.canvas.width, this.canvas.height);
        this.gl.uniform1f(this.gl.getUniformLocation(this.shader_program, 'u_time'), performance.now() / 1000.0);
        this.gl.uniform1f(this.gl.getUniformLocation(this.shader_program, 'u_influence_radius'), this.max_node_influence_distance);
        this.gl.uniform1f(this.gl.getUniformLocation(this.shader_program, 'u_falloff_power'), 2.0);
        this.gl.uniform1i(this.gl.getUniformLocation(this.shader_program, 'u_node_count'), noise_nodes.length);
        
        // Grid uniforms
        this.gl.uniform1f(this.gl.getUniformLocation(this.shader_program, 'u_grid_cell_size'), spatial_grid.cell_size);
        this.gl.uniform1f(this.gl.getUniformLocation(this.shader_program, 'u_grid_width'), spatial_grid.grid_width);
        this.gl.uniform1f(this.gl.getUniformLocation(this.shader_program, 'u_grid_height'), spatial_grid.grid_height);

        this.gl.uniform1f(this.gl.getUniformLocation(this.shader_program, 'u_grid_meta_tex_width'), meta_tex_width || 10);

        // Draw
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        this.gl.clearColor(0.0, 0.0, 0.0, 0.0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        
        this.draw_perimeter_geometry();

        // Cleanup
        [nodes_texture, colors_texture, grid_data_texture, grid_meta_texture].forEach(texture => {
            if (texture) this.gl!.deleteTexture(texture);
        });
    }

    private create_data_texture(data: Float32Array, width: number, height: number): WebGLTexture | null {
        if (!this.gl) return null;

        const texture = this.gl.createTexture();
        if (!texture) return null;

        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);

        // Convert float data to RGBA bytes (more compatible)
        const rgba_data = new Uint8Array(width * height * 4);
        for (let i = 0; i < data.length; i++) {
            rgba_data[i] = Math.floor(Math.max(0, Math.min(1, data[i])) * 255);
        }
        
        this.gl.texImage2D(
            this.gl.TEXTURE_2D,
            0,                    // level
            this.gl.RGBA,         // internal format
            width,                // width
            height,               // height
            0,                    // border
            this.gl.RGBA,         // format
            this.gl.UNSIGNED_BYTE,// type
            rgba_data             // data
        );

        // Set texture parameters
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);

        return texture;
    }

    private create_grid_textures(spatial_grid: any): {
        grid_data_texture: WebGLTexture | null,
        grid_meta_texture: WebGLTexture | null,
        meta_tex_width?: number
    } {
        if (!this.gl) return { grid_data_texture: null, grid_meta_texture: null };

        // Create grid data texture (node indices)
        const data_tex_size = 32; // Adjust based on your max grid data size
        const grid_data_array = new Uint8Array(data_tex_size * data_tex_size);
        for (let i = 0; i < Math.min(spatial_grid.grid_data.length, data_tex_size * data_tex_size); i++) {
            grid_data_array[i] = spatial_grid.grid_data[i];
        }

        const grid_data_texture = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, grid_data_texture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.LUMINANCE, data_tex_size, data_tex_size, 0, 
                        this.gl.LUMINANCE, this.gl.UNSIGNED_BYTE, grid_data_array);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);

        // Create grid metadata texture (offsets and counts)
        const meta_tex_width = Math.ceil(Math.sqrt(spatial_grid.grid_offsets.length));
        const grid_meta_array = new Uint8Array(meta_tex_width * meta_tex_width * 4);
        
        for (let i = 0; i < spatial_grid.grid_offsets.length; i++) {
            const offset = spatial_grid.grid_offsets[i];
            const count = spatial_grid.grid_counts[i];

            // Store offset as two bytes (little endian)
            grid_meta_array[i * 4 + 0] = offset & 0xFF;         // R: low byte
            grid_meta_array[i * 4 + 1] = (offset >> 8) & 0xFF;  // G: high byte
            grid_meta_array[i * 4 + 2] = count & 0xFF;          // B: count
            grid_meta_array[i * 4 + 3] = 255;                     // A: unused   
        }

        const grid_meta_texture = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, grid_meta_texture);
        this.gl.texImage2D(
            this.gl.TEXTURE_2D, 0, this.gl.RGBA, meta_tex_width, meta_tex_width, 0,
            this.gl.RGBA, this.gl.UNSIGNED_BYTE, grid_meta_array
        );
        // this.gl.texImage2D(
        //     this.gl.TEXTURE_2D,
        //     0,                    // level
        //     this.gl.RGBA,         // internal format
        //     32,                // width
        //     32,               // height
        //     0,                    // border
        //     this.gl.RGBA,         // format
        //     this.gl.UNSIGNED_BYTE,// type
        //     grid_meta_array             // data
        // );
        // this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
        // this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);

        return { grid_data_texture, grid_meta_texture, meta_tex_width };
    }

    private create_simple_shader_program(): WebGLProgram | null {
        if (!this.gl) return null;

        // STEP 1: Create vertex shader (positions)
        const vertex_shader_code = `
            attribute vec2 a_position;
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
            }
        `;

        // STEP 2: Create fragment shader (colors)
        const fragment_shader_code = `
            precision mediump float;
            uniform vec2 u_resolution;
            uniform float u_time;

            uniform float u_influence_radius;
            uniform float u_falloff_power;
            uniform int u_node_count;
            
            // Node data as textures for efficiency
            uniform sampler2D u_node_positions;  // RG = position, B = intensity, A = unused
            uniform sampler2D u_node_colors;     // RGB = color, A = unused

            // Spatial grid uniforms for O(1) collision detection
            uniform float u_grid_cell_size;
            uniform float u_grid_width;
            uniform float u_grid_height;
            uniform sampler2D u_grid_data_texture;    // Grid data in texture format
            uniform sampler2D u_grid_meta_texture;    // Grid offsets and counts

            uniform float u_grid_meta_tex_width;

            vec3 get_node_data(int node_index) {
                float texture_size = 32.0;
                float x = mod(float(node_index), texture_size) / texture_size + 0.5 / texture_size;
                float y = floor(float(node_index) / texture_size) / texture_size + 0.5 / texture_size;
                vec4 texel = texture2D(u_node_positions, vec2(x, y));
                // Convert normalized coordinates back to pixel coordinates
                return vec3(texel.r * u_resolution.x, texel.g * u_resolution.y, texel.b);
            }

            vec3 get_node_color(int node_index) {
                float texture_size = 32.0;
                float x = mod(float(node_index), texture_size) / texture_size + 0.5 / texture_size;
                float y = floor(float(node_index) / texture_size) / texture_size + 0.5 / texture_size;
                return texture2D(u_node_colors, vec2(x, y)).rgb;
            }

            vec3 get_grid_meta(int cell_index) {
                float tex_w = 32.0;
                float x = mod(float(cell_index), tex_w) / tex_w + 0.5 / tex_w;
                float y = floor(float(cell_index) / tex_w) / tex_w + 0.5 / tex_w;
                vec4 meta = texture2D(u_grid_meta_texture, vec2(x, y));
                int offset = int(meta.r * 255.0) + int(meta.g * 255.0) * 256;
                int count = int(meta.b * 255.0);
                return vec3(float(offset), float(count), 0.0);
            }
            
            // Get node index from grid data texture
            int get_grid_node_index(int data_index) {
                float data_tex_width = 32.0;
                float x = mod(float(data_index), data_tex_width) / data_tex_width + 0.5 / data_tex_width;
                float y = floor(float(data_index) / data_tex_width) / data_tex_width + 0.5 / data_tex_width;
                return int(texture2D(u_grid_data_texture, vec2(x, y)).r * 255.0);
            }

            float interpolate_nodes(vec2 pixel_pos) {
                float total_weight = 0.0;                 
                float total_value = 0.0;  
                int influenced_count = 0; // Count of nodes influencing this pixel
                // int max_influence_count = 8; // Maximum number of nodes to consider
                
                float smoothness = 70.0;
                // float max_influence_distance = smoothness * 3.0; // pixels

                // float grid_x = pixel_pos.x / u_grid_cell_size;
                // float grid_y = pixel_pos.y / u_grid_cell_size;
                // int grid_cell_x = int(floor(grid_x));
                // int grid_cell_y = int(floor(grid_y));

                // int cell_index = grid_cell_y * int(u_grid_width) + grid_cell_x;

                // // vec3 meta = get_grid_meta(cell_index);
                // // float count = meta.x; // count is in meta.y
                // // gl_FragColor = vec4(meta.x/ 8.0, meta.y / 8.0, 0.0, 1.0); // Red channel shows count (0=black, 1=full red)
                // // return 1.0;

                // for(int dy = -1; dy <= 1; dy++) {
                //     for(int dx = -1; dx <= 1; dx++) {
                //         int cell_x = grid_cell_x + dx;
                //         int cell_y = grid_cell_y + dy;

                //         // Check if cell is within bounds
                //         if (cell_x < 0 || cell_x >= int(u_grid_width) || cell_y < 0 || cell_y >= int(u_grid_height)) {
                //             continue; // Skip out of bounds cells
                //         }

                //         int cell_index = cell_y * int(u_grid_width) + cell_x;
                //         vec3 meta = get_grid_meta(cell_index);
                //         int offset = int(meta.x);
                //         int count = int(meta.y);
                //         float o = meta.x; // Offset is in meta.x
                //         float c = meta.y; // Count is in meta.y

                //         // vec4 meta_uv = vec4(o / 60.0, 0.0, 0.0, 1.0);
                //         // vec4 meta_uv = vec4(0.0, c / 4.0, 0.0, 1.0);
                //         // gl_FragColor = meta_uv; // Debugging meta UV
                //         // return 1.0; // Return early for debugging

                //         for (int i = 0; i < 8; i++) {
                //             // if (i >= count) break; // Skip if no more nodes in this cell

                //             // int node_index = get_grid_node_index(offset + i);
                //             vec3 node_data = get_node_data(offset + i);
                //             vec2 node_pos = vec2(node_data.x, node_data.y);
                //             // gl_FragColor = vec4(node_pos / u_resolution, 0.0, 1.0); // Debugging node position


                //             float node_intensity = node_data.z;

                //             float distance = length(pixel_pos - node_pos);
                //             // float intensity = distance / (max_influence_distance * 4.0);
                //             // if (distance > max_influence_distance) continue; // Skip nodes too far away

                //             float intensity = exp(
                //                 -1.0 * (distance * distance) / (
                //                     2.0 * (smoothness * smoothness) * (node_intensity * node_intensity)
                //                 )
                //             );

                //             if (intensity > 0.001) { // Threshold to avoid counting negligible influences
                //                 total_weight += intensity;
                //                 total_value += intensity * node_intensity;
                //                 influenced_count++;
                //             }
                //         }
                //     }
                // }   

                // return influenced_count > 0 ? total_weight / float(influenced_count) : 0.0; // Normalize by total weight



             
                for (int i = 0; i < 64; i++) {                     
                    // int node_index = get_grid_node_index(i);                     
                    vec3 node_data = get_node_data(i);                     
                    vec2 node_pos = vec2(node_data.x, node_data.y);                     
                    float node_intensity = node_data.z;      
                    float distance = length(pixel_pos - node_pos);                
                    float intensity = exp(
                        -1.0 * (distance * distance) / (
                            2.0 * (smoothness * smoothness) * (node_intensity * node_intensity)
                        )
                    );
                    

                    total_weight += intensity;                                    
                }           

                return total_weight / 6.40;             
            } 

            // float get_alpha(vec2 pixel_pos, float node_intensity) {
                
            // }
            
            void main() {
                vec2 pixel_pos = gl_FragCoord.xy;

                // vec2 uv = gl_FragCoord.xy / u_resolution.xy;
                // float tex_w = u_grid_meta_tex_width;
                // vec2 meta_uv = fract(uv * tex_w);
                // vec4 meta = texture2D(u_grid_data_texture, meta_uv);
                // gl_FragColor = meta;

                float intensity = interpolate_nodes(pixel_pos);
                // float alpha = get_alpha(pixel_pos / u_resolution, intensity);
                gl_FragColor = vec4(1.0, 1.0, 1.0, intensity); 
            }
        `;

        // STEP 3: Compile shaders
        const vertex_shader = this.compile_shader(this.gl.VERTEX_SHADER, vertex_shader_code);
        const fragment_shader = this.compile_shader(this.gl.FRAGMENT_SHADER, fragment_shader_code);

        if (!vertex_shader || !fragment_shader) return null;

        // STEP 4: Create program and link shaders
        const program = this.gl.createProgram();
        if (!program) return null;

        this.gl.attachShader(program, vertex_shader);
        this.gl.attachShader(program, fragment_shader);
        this.gl.linkProgram(program);

        // STEP 5: Check if linking worked
        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            console.error('Program linking failed:', this.gl.getProgramInfoLog(program));
            return null;
        }

        return program;
    }

    private compile_shader(type: number, source: string): WebGLShader | null {
        if (!this.gl) return null;

        const shader = this.gl.createShader(type);
        if (!shader) return null;

        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);

        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            console.error('Shader compilation failed:', this.gl.getShaderInfoLog(shader));
            this.gl.deleteShader(shader);
            return null;
        }

        return shader;
    }

    private create_perimeter_geometry(): void {
        // if (!this.gl) return;

        // // Create a simple fullscreen rectangle
        // const vertices = new Float32Array([
        //     -1.0, -1.0,  // Bottom left
        //     1.0, -1.0,  // Bottom right
        //     -1.0,  1.0,  // Top left
        //     1.0,  1.0   // Top right
        // ]);

        // this.position_buffer = this.gl.createBuffer();
        // this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.position_buffer);
        // this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);

        if (!this.gl) return;

        const distance_from_edge = 0;
        const band_width = 100;
        
        // Convert screen coordinates to WebGL coordinates (-1 to 1)
        const left = -1;
        const right = 1;
        const top = 1;
        const bottom = -1;
        
        // Calculate inner bounds (where the perimeter band ends)
        const inner_left = -1 + (2 * (distance_from_edge + band_width)) / this.canvas!.width;
        const inner_right = 1 - (2 * (distance_from_edge + band_width)) / this.canvas!.width;
        const inner_top = 1 - (2 * (distance_from_edge + band_width)) / this.canvas!.height;
        const inner_bottom = -1 + (2 * (distance_from_edge + band_width)) / this.canvas!.height;
        
        // Create 4 rectangles for the perimeter (top, bottom, left, right)
        const vertices = new Float32Array([
            // Top rectangle
            left, top,           // Top-left
            right, top,          // Top-right
            left, inner_top,     // Bottom-left
            right, inner_top,    // Bottom-right
            
            // Bottom rectangle
            left, inner_bottom,  // Top-left
            right, inner_bottom, // Top-right
            left, bottom,        // Bottom-left
            right, bottom,       // Bottom-right
            
            // Left rectangle (excluding corners already covered)
            left, inner_top,     // Top-left
            inner_left, inner_top, // Top-right
            left, inner_bottom,  // Bottom-left
            inner_left, inner_bottom, // Bottom-right
            
            // Right rectangle (excluding corners already covered)
            inner_right, inner_top,   // Top-left
            right, inner_top,         // Top-right
            inner_right, inner_bottom, // Bottom-left
            right, bottom       // Bottom-right
        ]);

        this.position_buffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.position_buffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);
    }

    private draw_perimeter_geometry(): void {
        if (!this.gl || !this.shader_program || !this.position_buffer) return;

        // Bind the vertex buffer
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.position_buffer);

        // Get the attribute location
        const position_location = this.gl.getAttribLocation(this.shader_program, 'a_position');
        
        // Enable the attribute
        this.gl.enableVertexAttribArray(position_location);
        
        // Tell the attribute how to get data out of the buffer
        this.gl.vertexAttribPointer(position_location, 2, this.gl.FLOAT, false, 0, 0);

        // Draw each rectangle (4 rectangles × 4 vertices each)
        for (let i = 0; i < 4; i++) {
            this.gl.drawArrays(this.gl.TRIANGLE_STRIP, i * 4, 4);
        }
    }

    private generate_noise_nodes(frequency_data: number[]): Noise_Node[] {
        if (!this.canvas) return [];
        
        const nodes: Noise_Node[] = [];

        let colors = this.song_data?.colors?.common || null;
        if(!colors) {
            // generate coomon colors if not provided
            this.media.get_top_colors_from_artwork(this.song_data?.url?.artwork.high || this.song_data?.url?.artwork.low || '', 5).then((top_colors) => {
                this.song_data!.colors!.common = top_colors;
                // should save song
                colors = top_colors;
            });
        }
        
        frequency_data.forEach((amplitude, index) => {
            // Get position around perimeter using your existing function
            const position = this.get_position_from_index(index, frequency_data.length, this.canvas!.width, this.canvas!.height);
            
            // Create color based on frequency (hue mapping)
            // const hue = (index / frequency_data.length) * 360;
            const color_group_size = this.noise_node_count / 10; 
            const color_index = Math.floor(index / color_group_size) % (colors?.length || 1);
            const color = this.string_rgba_to_array(colors?.[color_index] || 'rgba(255, 255, 255, 1)');
        
            nodes.push({
                x: position.x,
                y: position.y,
                intesnity: amplitude <= 100 ? 100 : amplitude, // Note: keeping typo consistent with interface
                color: [color[0] / 255, color[1] / 255, color[2] / 255] // Normalize to 0-1
            });
        });
        
        return nodes;
    }

    // Helper function to convert HSL to RGB
    // private hsl_to_rgb(h: number, s: number, l: number): [number, number, number] {
    //     const c = (1 - Math.abs(2 * l - 1)) * s;
    //     const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    //     const m = l - c / 2;
        
    //     let r: number, g: number, b: number;
        
    //     if (h < 60) [r, g, b] = [c, x, 0];
    //     else if (h < 120) [r, g, b] = [x, c, 0];
    //     else if (h < 180) [r, g, b] = [0, c, x];
    //     else if (h < 240) [r, g, b] = [0, x, c];
    //     else if (h < 300) [r, g, b] = [x, 0, c];
    //     else [r, g, b] = [c, 0, x];
        
    //     return [
    //         Math.round((r + m) * 255),
    //         Math.round((g + m) * 255),
    //         Math.round((b + m) * 255)
    //     ];
    // }
    
    private string_rgba_to_array(color: string): [number, number, number, number] {
        const rgba = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+(?:\.\d+)?)\s*)?\)/);
        if (!rgba) return [0, 0, 0, 1]; // Default to black with full opacity
        return [
            parseInt(rgba[1]),
            parseInt(rgba[2]),
            parseInt(rgba[3]),
            rgba[4] ? parseFloat(rgba[4]) : 1 // Default alpha
        ];
    }

    get_position_from_index(index: number, total: number, width: number, height: number): {x: number, y: number} {
        const progress = index / total; // 0 to 1
        let x: number, y: number;
        let distance_from_edge = 0;

        const half_width = width / 2;
        const half_height = height / 2;
        
        if (progress <= 0.25) {
            // Bottom edge: Low frequencies (inward from outward)
            const bottom_progress = progress / 0.25;
            const direction = index % 2 === 0 ? 1 : -1; 
            const offset = direction * bottom_progress * half_width; 

            x = half_width + offset;
            y = height - distance_from_edge;
        } else if (progress <= 0.75) {
            // Left / right edge
            const left_right_progress = (progress - 0.25) / 0.5;
            const side = index % 2 === 0 ? 'left' : 'right'; 

            if (side === 'left') {
                // Left edge:
                x = distance_from_edge;
                y = height - (left_right_progress * height);
            } else {
                // Right edge:
                x = width - distance_from_edge;
                y = height - (left_right_progress * height);
            }
        } else {
            // top edge: High frequencies (outward towards inward)
            const top_progress = (progress - 0.75) / 0.25;
            const direction = index % 2 === 0 ? 1 : -1;
            const offset = direction * ( 1 - top_progress ) * half_width;

            x = half_width + offset;
            y = distance_from_edge;
        }
        
        return { x, y };
    }

    private frequency_history: number[][] = [];
    private history_length: number = 5; // Reduced for better performance
    private smoothing_weights: number[] = [0.4, 0.25, 0.2, 0.1, 0.05]; // These add up to 1.0

    private smooth_frequency_transition(current_data: number[]): number[] {
        // Add current frame to history
        this.frequency_history.unshift([...current_data]);
        
        // Keep only the last N frames
        if (this.frequency_history.length > this.history_length) {
            this.frequency_history.pop();
        }
        
        // If we don't have enough history yet, just return current data
        if (this.frequency_history.length === 1) {
            return current_data;
        }
        
        // Calculate weighted average
        const smoothed_data = current_data.map((_, index) => {
            let weighted_sum = 0;
            let total_weight = 0;
            
            for (let frame = 0; frame < this.frequency_history.length; frame++) {
                const weight = this.smoothing_weights[frame] || 0;
                const value = this.frequency_history[frame][index] || 0;
                
                weighted_sum += value * weight;
                total_weight += weight;
            }
            
            return total_weight > 0 ? weighted_sum / total_weight : 0;
        });
        
        return smoothed_data;
    }
}
