import MusicPlaylistManager from "./playlist.manager";
import BufferController from "./buffer.controller";
import { MusicMediaService, Song_Data, Song_Identifier } from "../music.media.service";
import { Skip_Event } from "./playlist.manager";
import { SettingsService } from "../settings.service";
import { NotificationService } from "../notification.service";
import MediaMixer from "./media.mixer";
import { MusicPlayerService } from "../music.player.service";
import { SessionPlaylistInterceptorService, HLS_Bundle } from "./http.interceptor.service";
import { ProgressiveImageLoaderService } from "../progressive.image.loader.service";
import { firstValueFrom } from "rxjs";
import AudioVisualizer from "./audio.visualizer";

export enum Audio_Error {
    UNKNOWN = 5000,
    FETCH_VIDEO_ID = 5001,
    FETCH_PLAYBACK_URL = 5002,
    DOES_NOT_EXIST = 5003,
    PLAYBACK = 5004,
}
export enum Audio_Error_Message {
    UNKNOWN = "Unknown error",
    FETCH_VIDEO_ID = "Failed to fetch video ID",
    FETCH_PLAYBACK_URL = "Failed to fetch HTTP Live Streaming URL",
    DOES_NOT_EXIST = "The requested track does not exist",
    PLAYBACK = "Playback error",
}

class MusicMediaManager {
    public playlist_manager: MusicPlaylistManager;
    public buffer_controller: BufferController;
    public mixer: MediaMixer;
    public visualizer: AudioVisualizer;

    private thumbnail_element: HTMLImageElement | null = null;

    public song_cache: Map<string, Song_Data> = new Map<string, Song_Data>();
    private _media_data: Song_Data | null = null;
    public use_streaming_playlist: boolean = true;
    public streaming_playlist_in_use: boolean = false;
    
    // Image loading cancellation support
    private active_image_loads: Map<string, AbortController> = new Map();
    private current_artwork_song_key: string | null = null;

    public sleep_timer_to_end_of_track: boolean = false;
    public _sleep_time: number | null = null; // dont use settings because it shouldnt persisit between sessions
    public _sleep_time_remaining: number | null = null;


    public get sleep_time(): number | null {
        if(this.sleep_timer_to_end_of_track) {
            return this.song_duration;
        }
        return this._sleep_time;
    }
    public set sleep_time(value: number | null) {
        this._sleep_time = value;
        this._sleep_time_remaining = value;
        this.start_sleep_timer();
        this.sleep_timer_to_end_of_track = false;
    }
    public get sleep_time_remaining(): number | null {
        if(this.sleep_timer_to_end_of_track) {
            return this.song_duration - this.current_time;
        }
        return this._sleep_time_remaining;
    }
    public set sleep_time_remaining(value: number | null) {
        this.sleep_time = value; // use setter to keep in sync
    }
    public get sleep_timer_ended(): boolean {
        return this._sleep_time_remaining <= 0;
    }
    get current_song(): any {
        // return this.playlist_manager.current_song;
        const song_key = this.playlist_manager.current_song_key;
        return song_key ? this.song_cache.get(song_key) || null : null;
    }
    get media_data(): Song_Data | null {
        return this._media_data;
    }
    set current_song(song_key: string) {
        this.playlist_manager.current_song_key = song_key;
    }
    get playlist_queue(): string[] {
        return this.playlist_manager.queue;
    }
    set playlist_queue(songs: string[]) {
        this.playlist_manager.queue = songs;
    }
    get play_next_queue(): string[] {
        return this.playlist_manager.playnext;
    }
    set play_next_queue(songs: string[]) {
        this.playlist_manager.playnext = songs;
    }
    get current_time(): number {
        // return this.buffer_controller.current_time;
        if(this.buffer_controller.using_silent_source) {
            return 0;
        }
        if(this.use_streaming_playlist) {
            // console.log('current time requested, current track timestamp:', this.buffer_controller.current_track_timestamp, this.buffer_controller?.current_time - this.buffer_controller.current_track_timestamp?.start_timestamp);
            const difference = this.buffer_controller.current_time - (this.buffer_controller.current_track_timestamp?.start_timestamp || 0);
            if(difference < 0) return 0;
            return difference;
        } else {
            return this.buffer_controller.current_time;
        }
    }
    get song_duration(): number {
        if(this.use_streaming_playlist) {
            if(this.buffer_controller.current_track_timestamp) {
                // return (this.buffer_controller.current_time - this.buffer_controller.current_track_timestamp.start_timestamp);
                return this.buffer_controller.current_track_timestamp.end_timestamp - this.buffer_controller.current_track_timestamp.start_timestamp;
            } else {
                return this.buffer_controller.duration;
            }
        } else {
            return this.buffer_controller.duration;
        }
    }
    get real_time(): number {
        return this.buffer_controller.current_time;
    }
    get real_duration(): number {
        return this.buffer_controller.duration;
    }
    get shuffle(): boolean {
        return this.settings.shuffle_playback;
    }
    set shuffle(value: boolean) {
        this.settings.set_setting_value('shuffle_play', value);
        this.update_shuffle_queue();
    }
    get repeat(): boolean {
        return this.settings.repeat_playback;
    }
    set repeat(value: boolean) {
        this.settings.set_setting_value('repeat_play', value);
    }
    get preloaded_next_song(): boolean {
        if(!this.loading_tracks.has(this.playlist_manager.next_song_key)) return false;
        return this.loading_tracks.get(this.playlist_manager.next_song_key) === 'loaded' || this.loading_tracks.get(this.playlist_manager.next_song_key) === 'fetching_audio_data';
    }

    constructor(
        private media: MusicMediaService, 
        private settings: SettingsService, 
        private player: MusicPlayerService, 
        public http_interceptor_service: SessionPlaylistInterceptorService,
        private image_loader_service: ProgressiveImageLoaderService,
        buffer_controller?: BufferController, 
        private notification_service?: NotificationService,
    ) {
        // Use the provided BufferController or create a new one
        // This allows the service to share a single BufferController instance
        this.buffer_controller = buffer_controller || new BufferController(this.settings, this);
        this.playlist_manager = new MusicPlaylistManager(this.media, this);
        this.visualizer = new AudioVisualizer();
        this.mixer = new MediaMixer(this.media);

        // this.buffer_controller.events.addEventListener('has_audio', () => {
        //     if(this.want_to_play && !this.buffer_controller.is_playing) {
        //         this.play();
        //     }
        //     this.auto_skip_failure_count = 0; // reset on successful load
        //     this.want_to_play = false;
        //     this.update_media_session_position();

        //     const song_key = this.playlist_manager.current_song_key;
        //     this.loading_tracks.set(song_key, 'loaded');
        // });
        // this.buffer_controller.events.addEventListener('fully_buffered', () => {
        //     // refresh media session position
        //     this.update_media_session_position();
        // });

        // this.shuffle = this.settings.shuffle_playback;
    }

    public set_streaming_playlist_queue(songs: string[], skip_buffer_flush: boolean = false): void {
        // before setting the queue, based on the current index of the current song, see if we need to flush the buffer after said index
        // we see which indices of 'songs' and 'this.http_interceptor_service.song_queue' match
        // to do
        if(!skip_buffer_flush) {
            for(let index = this.buffer_controller.current_track_index + 1; index < songs.length; index++) {
                if(!this.http_interceptor_service.song_queue?.[index]) continue;
                if(this.http_interceptor_service.song_queue[index] !== songs[index]) {
                    // mismatch found, flush buffer from this index onwards
                    // this.buffer_controller.flush_buffer_after_index(index);
                    setTimeout(() => this.buffer_controller.update_playlist(null), 50);
                    break;
                }
            }
        }

        this.http_interceptor_service.song_queue = songs;
    }

    public get_silent_audio_position(): number {
        for(let index = 0; index < this.buffer_controller.timestamps_of_tracks_cache.length; index++) {
            const track = this.buffer_controller.timestamps_of_tracks_cache[index];
            if(!track) continue;
            if(track.video_id === '#silent_audio') {
                return track.start_timestamp;
            }
        }
        return -1;
    }

    public on_fully_buffered(): void {
        // refresh media session position
        this.update_media_session_position();
    }

    public on_has_audio(): void {
        if(this.want_to_play && !this.buffer_controller.is_playing) {
            this.play();
        }
        this.auto_skip_failure_count = 0; // reset on successful load
        this.want_to_play = false;
        this.update_media_session_position();

        const song_key = this.playlist_manager.current_song_key;
        this.loading_tracks.set(song_key, 'loaded');
        // add song to recently played
        if(this.current_song) {
            this.media.add_to_recently_played(this.current_song).catch((error) => {
                console.error('Error adding to recently played:', error);
            });
        }
    }

    public on_song_ended(): void {
        if(this.use_streaming_playlist) {
            this.playlist_manager.next(Skip_Event.OMIT_SKIP);
        } else {
            if (
                this.buffer_controller.has_audio &&
                this.buffer_controller.fully_buffered
            ) {
                this.playlist_manager.next(Skip_Event.DEFAULT);
            }
        }
    }

    public update_shuffle_queue(): void {
        if(this.shuffle) {
            this.playlist_manager.shuffle();
        } else {
            this.playlist_manager.unshuffle();
        }
    }

    public set_thumbnail_element(element: HTMLImageElement): void {
        this.thumbnail_element = element;
    }

    public set_visualization_element(element: HTMLCanvasElement): void {
        this.visualizer?.set_canvas(element);
    }

    public want_to_play: boolean = false;
    public play(): void {
        if(this.buffer_controller.has_audio) this.buffer_controller?.play();
        else {
            // wait for audio
            this.want_to_play = true;
        }
        // add to recently played
        if(this.current_song) {
            this.media.add_to_recently_played(this.current_song).catch((error) => {
                console.error('Error adding to recently played:', error);
            });
        }
    }

    public pause(): void {
        this.buffer_controller?.pause();
    }

    public toggle_play(): void {
        if (this.buffer_controller.is_playing) {
            this.pause();
        } else {
            this.play();
        }
    }

    public configure_media_session() {
        if (!('mediaSession' in navigator)) return;

        navigator.mediaSession.setActionHandler('play', () => {
            this.buffer_controller?.play();
        });
        
        navigator.mediaSession.setActionHandler('pause', () => {
            this.buffer_controller?.pause();
        });

        navigator.mediaSession.setActionHandler('nexttrack', () => {
            this.playlist_manager?.next();
        });

        navigator.mediaSession.setActionHandler('previoustrack', () => {
            this.playlist_manager?.previous();
        });

        navigator.mediaSession.setActionHandler('seekto', (event) => {
            const seek_time = event.seekTime || 0;
            this.player.seek_to(seek_time);
        });
    }

    public seek_to(time: number): void {
        this.buffer_controller.current_time = time;
        this.update_media_session_position();
    }

    public update_media_session_position(progress: number = this.current_time, duration: number = this.song_duration): void {
        if (!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return;

        if(!Number.isFinite(progress) || Number.isNaN(progress)) progress = 0;
        if(!Number.isFinite(duration) || Number.isNaN(duration)) duration = 0;

        try {
            navigator.mediaSession.setPositionState({
                duration: Math.min(Math.max(duration, 0), Number.MAX_SAFE_INTEGER),
                playbackRate: 1.0,
                position: Math.max(Math.min(progress, duration), 0),
            });
        } catch (error) {
            console.error('Error updating media session position:', error);
        }
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

    private async create_blob_url_from_stale_blob(blob: Blob, mime_type: string = 'audio/mp4a'): Promise<string> {
        // used mainly for safari compatibility where reusing old blob urls can cause issues
        const array_buffer = await blob.arrayBuffer();
        if( array_buffer.byteLength > 0) {
            // fresh url with fresh blob
            return URL.createObjectURL(new Blob([array_buffer], { type: mime_type }));
        }
        throw new Error('Failed to create blob URL');
    }

    private load_error(song_key: string, error: Audio_Error = Audio_Error.UNKNOWN, auto_skip: boolean = false, song_title: string = 'track'): void {
        // only notify if the song_key is the current song
        if(this.is_song_key_equal_to_current(song_key)) {
            this.notification_service.error(
                `Failed to load ${song_title}`,
                {
                    details: `${error} - ${Audio_Error_Message[error]} - ${song_key}`,
                    dismissTime: 7000,
                    autoDismiss: true
                }
            );
        }
        if (auto_skip) {
            if(this.auto_skip_failure_count < this.max_auto_skip_before_failure) {
                this.auto_skip_failure_count++;
                this.playlist_manager.next(Skip_Event.FORCE);
            }
        }
    }

    public is_song_key_equal_to_current(song_key: string): boolean {
        return this.playlist_manager.current_song_key === song_key;
    }

    private max_auto_skip_before_failure: number = 5; // number of auto skips before stopping
    private auto_skip_failure_count: number = 0;
    
    // Request cancellation support
    private active_load_requests: Map<string, AbortController> = new Map();
    private current_loading_song_key: string | null = null;
    
    // Helper method to cancel a load request
    private cancel_load_request(song_key: string): void {
        const abort_controller = this.active_load_requests.get(song_key);
        if(abort_controller) {
            abort_controller.abort();
            this.active_load_requests.delete(song_key);
            this.loading_tracks.delete(song_key);
            console.log('Cancelled load request for:', song_key);
        }
    }
    
    // public loading_state: 'fetching_video_id' | 'fetching_audio_stream' | 'fetching_audio_data' | null = null;
    public get loading_state(): 'fetching_video_id' | 'fetching_audio_stream' | 'fetching_audio_data' | 'loaded' | null {
        // return the state of the the current track;
        if(this.loading_tracks.has(this.playlist_manager.current_song_key)) {
            return this.loading_tracks.get(this.playlist_manager.current_song_key) || null;
        }
        return null; 
    }
    public is_current_song_loading(): boolean {
        if(!this.loading_tracks.has(this.playlist_manager.current_song_key)) return false;
        if(this.buffer_controller.current_track_timestamp?.video_id === '#silent_audio' || this.buffer_controller.current_time <= 60) return true; // the first 60 seconda are always silent
        const song_identifier = this.playlist_manager.current_song_identifier;
        if(this.buffer_controller.current_track_timestamp?.video_id === song_identifier.video_id && !this.buffer_controller.current_track_timestamp.has_audio_segments) return true;
        if(!this.http_interceptor_service.is_index_loaded(this.buffer_controller.current_track_index)) return true;
        return this.loading_tracks.get(this.playlist_manager.current_song_key) !== 'loaded';
    }
    private loading_tracks: Map<string, 'fetching_video_id' | 'fetching_audio_stream' | 'fetching_audio_data' | 'loaded'> = new Map<string, 'fetching_video_id' | 'fetching_audio_stream' | 'fetching_audio_data' | 'loaded'>(); // song_keys currently being loaded, to its state
    // private loading_types: Map<string, 'current' | 'preload'> = new Map<string, 'current' | 'preload'>(); // song_keys being loaded, to its type
    // if load_into_source is false, we are just telling the server to create the stream
    public async load_track(data: Song_Identifier | Song_Data | string, load_into_source: boolean = true): Promise<Song_Data | null> {
        let song_data: Song_Data | null = null;
        let song_identifier: Song_Identifier | null = null;
        let song_key: string | null = null;

        if(this.is_string(data)) {
            song_key = data;
            song_identifier = this.media.parse_song_key(data);
            song_data = this.song_cache.get(song_key) || null;
            // Only set cache if we have data - don't overwrite with null
            if (song_data) {
                this.song_cache.set(song_key, song_data);
            }
        }
        else if(this.is_song_identifier(data)) {
            song_key = this.media.song_key(data);
            song_identifier = data;
            song_data = this.song_cache.get(song_key) || null;
            // Only set cache if we have data - don't overwrite with null
            if (song_data) {
                this.song_cache.set(song_key, song_data);
            }
        }
        else if(this.is_song_data(data)) {
            song_data = data;
            song_identifier = data.id;
            song_key = this.media.song_key(data.id);
        } else {
            console.error('Invalid data provided to load_track:', data);
            this.load_error(song_key, Audio_Error.DOES_NOT_EXIST, true, song_data ? song_data.song_name : 'track');
            return null;
        }

        // at this point, song_key and song_identifier must be set
        if(!song_key || !song_identifier) {
            console.error('Failed to determine song key or identifier in load_track:', data);
            this.load_error(song_key || 'unknown', Audio_Error.DOES_NOT_EXIST, true, song_data ? song_data.song_name : 'track');
            return null;
        }

        if(load_into_source) {
            // we are loading this specific song to play
            // Cancel any previous load requests that are no longer relevant
            // if(this.current_loading_song_key && this.current_loading_song_key !== song_key) {
            //     this.cancel_load_request(this.current_loading_song_key);
            // }
            this.current_loading_song_key = song_key;
            this.playlist_manager.current_song_key = song_key;
            if(song_data) {
                this.update_media_session(song_data);
            }
        }

        if(this.loading_tracks.has(song_key) && this.loading_tracks.get(song_key) !== 'loaded') {
            // already loading
            return song_data;
        }

        // Create abort controller for this request
        const abort_controller = new AbortController();
        this.active_load_requests.set(song_key, abort_controller);

        try {
            // now check to see if video_id is missing and needs to be fetched
            if(this.media.song_key_missing_only_video_id(song_key)) {
                // ...existing code for fetching video_id...
                this.loading_tracks.set(song_key, 'fetching_video_id');
                switch(song_identifier.source) {
                    case 'spotify': {
                        const spotify_id = song_identifier.source_id;
                        // Fetch the video ID from Spotify
                        const video_id = await this.media.get_video_id_from_spotify_uri(`spotify:track:${spotify_id}`);
                        
                        // Check if request was cancelled
                        if(abort_controller.signal.aborted) {
                            console.log('Load cancelled for:', song_key);
                            return null;
                        }
                        
                        if(video_id && video_id !== '') {
                            const old_song_key = song_key;
                            this.loading_tracks.delete(song_key);

                            song_identifier.video_id = video_id;
                            song_key = this.media.song_key(song_identifier);
                            this.loading_tracks.set(song_key, 'fetching_video_id');
                            
                            // Update abort controller reference
                            this.active_load_requests.delete(old_song_key);
                            this.active_load_requests.set(song_key, abort_controller);
                            
                            // check to make sure if we are still loading the same song
                            if(this.is_song_key_equal_to_current(old_song_key)) {
                                this.playlist_manager.current_song_key = song_key;
                                this.current_loading_song_key = song_key;
                            }
                            if(song_data && song_data?.id) song_data.id.video_id = video_id;

                            await this.media.replace_song_key(old_song_key, song_key, song_data !== null ? song_data : undefined);
                            this.queue_updated();
                        } else {
                            this.loading_tracks.delete(song_key);
                            if(this.is_song_key_equal_to_current(song_key)) this.load_error(song_key, Audio_Error.FETCH_VIDEO_ID, this.is_song_key_equal_to_current(song_key), song_data ? song_data.song_name : 'track');
                            return null;
                        }
                        break;
                    }
                    default: {
                        console.error('Unsupported source for fetching video ID:', song_identifier.source);
                        this.loading_tracks.delete(song_key);
                        if(this.is_song_key_equal_to_current(song_key)) this.load_error(song_key, Audio_Error.FETCH_VIDEO_ID, this.is_song_key_equal_to_current(song_key), song_data ? song_data.song_name : 'track');
                        return null;
                    }
                }
            }

            // Check if request was cancelled
            if(abort_controller.signal.aborted) {
                console.log('Load cancelled for:', song_key);
                this.loading_tracks.delete(song_key);
                return null;
            }

            // by now video_id must be present
            if(!song_identifier.video_id || song_identifier.video_id === '') {
                console.error('No valid video ID found in song identifier for load:', song_identifier);
                this.loading_tracks.delete(song_key);
                this.load_error(song_key, Audio_Error.DOES_NOT_EXIST, this.is_song_key_equal_to_current(song_key), song_data ? song_data.song_name : 'track');
                return null;
            }

            this.loading_tracks.set(song_key, 'fetching_audio_stream');

            if(this.use_streaming_playlist) {
                if(!this.streaming_playlist_in_use) {
                    await this.media.get_streaming_playlist_url().then(url => {
                        this.set_streaming_playlist(url);
                    });
                } 

                if(song_data && song_data.downloaded) {
                    this.loading_tracks.set(song_key, 'loaded');
                    // use downloaded bundle
                    this.http_interceptor_service.add_bundle(song_data.download_hls_bundle);
                    return song_data;
                }

                if(!this.http_interceptor_service.hls_bundles.has(song_identifier.video_id)) {
                    this.media.request_song_to_streaming_hls_bundle(song_identifier.video_id, { mix: false }).then((hls_stream_bundle) => {
                        // Check if request was cancelled before processing
                        if(abort_controller.signal.aborted) {
                            console.log('Bundle load cancelled for:', song_key);
                            this.loading_tracks.delete(song_key);
                            return;
                        }
                        
                        // handle the appended song data
                        this.http_interceptor_service.add_bundle(hls_stream_bundle);
                        this.loading_tracks.set(song_key, 'fetching_audio_data');
                    }).catch(error => {
                        if(error.name !== 'AbortError') {
                            console.error('Error fetching HLS bundle:', error);
                            this.load_error(song_key, Audio_Error.FETCH_PLAYBACK_URL, this.is_song_key_equal_to_current(song_key), song_data ? song_data.song_name : 'track');
                        }
                        this.loading_tracks.delete(song_key);
                    });
                } else {
                    this.loading_tracks.set(song_key, 'fetching_audio_data');
                }

                return song_data;
            } else {
                // old method 
                // do later

                return song_data;
            }
        } finally {
            if(load_into_source) this.playlist_manager.preload_upcoming_songs();
            // Clean up abort controller after some delay
            setTimeout(() => {
                this.active_load_requests.delete(song_key);
            }, 5000);
        }
    }

    public async load_track_and_play(data: Song_Identifier | Song_Data | string): Promise<Song_Data | null> {
        const load_result = await this.load_track(data, true);
        this.play();
        return load_result;
    }

    public queue_updated(skip_buffer_flush: boolean = false): void {
        this.set_streaming_playlist_queue(this.playlist_manager.full_queue, skip_buffer_flush);
        this.playlist_manager.preload_upcoming_songs();
    }

    public async set_streaming_playlist(playlist_url: string | null): Promise<void> {
        if(!playlist_url) return;
        this.streaming_playlist_in_use = true;
        await this.buffer_controller.load_and_play(playlist_url);
    }

    public async update_media_session(data: Song_Identifier | Song_Data | string = this.current_song): Promise<void> {
        if (!('mediaSession' in navigator) || !data) return;
        this.configure_media_session();

        let metadata: Song_Data | null = null;
        let song_key: string | null = null;

        if(this.is_string(data)) {
            song_key = data;
            metadata = this.song_cache.get(song_key) || null;
            if(!metadata) {
                try {
                    metadata = await this.media.get_song_data(song_key);
                    this.song_cache.set(song_key, metadata);
                } catch (error) {
                    console.error('Error fetching song data for media session update:', error);
                    return;
                }
            }
        }
        else if(this.is_song_identifier(data)) {
            song_key = this.media.song_key(data);
            metadata = this.song_cache.get(song_key) || null;
            if(!metadata) {
                try {
                    metadata = await this.media.get_song_data(song_key);
                    this.song_cache.set(song_key, metadata);
                } catch (error) {
                    console.error('Error fetching song data for media session update:', error);
                    return;
                }
            }
        }
        else if(this.is_song_data(data)) {
            metadata = data;
            song_key = this.media.song_key(metadata.id);
            this.song_cache.set(song_key, metadata);
        } else {
            console.error('Invalid data provided to update_media_session:', data);
            return;
        }

        if(!metadata) {
            console.error('No metadata found for media session update:', data);
            return;
        }

        // Cancel any previous artwork loads if we're switching to a different song
        if(this.current_artwork_song_key && this.current_artwork_song_key !== song_key) {
            const abort_controller = this.active_image_loads.get(this.current_artwork_song_key);
            if(abort_controller) {
                abort_controller.abort();
                this.active_image_loads.delete(this.current_artwork_song_key);
                console.log('Cancelled artwork load for:', this.current_artwork_song_key);
            }
        }
        this.current_artwork_song_key = song_key;

        this._media_data = metadata;

        const has_artwork_ready = 
            (metadata.download_artwork_blob) ||
            (metadata.url.artwork.low && metadata.url.artwork.low !== '') ||
            (metadata.url.artwork.high && metadata.url.artwork.high !== '');
        
        const artwork_url = 
            has_artwork_ready ? 
                metadata.download_artwork_blob
                    ? URL.createObjectURL(metadata.download_artwork_blob)
                : metadata.url.artwork.high ??
                metadata.url.artwork.low
            : '';

        if(this.thumbnail_element && !artwork_url) {
            this.notification_service?.warning('No artwork available for the current track.');
        }

        navigator.mediaSession.metadata = new MediaMetadata({
            title: metadata.song_name,
            artist: (metadata.explicit ? '🅴 ' : '') + metadata.artists.map(artist => artist.name).join(', '),
            album: '',
            artwork: [
                { src: artwork_url, sizes: '512x512', type: 'image/png' }
            ]
        });

        // Update position state when metadata changes
        this.update_media_session_position();
        await this.update_colors_from_artwork(metadata);
        await this.media.save_song_to_indexDB(this.media.song_key(metadata.id), metadata);
        this.player.update_theme();
        // await this.update_lyrics(metadata);
        // await this.media.save_song_to_indexDB(this.media.song_key(metadata.id), metadata);
    }

    private async update_colors_from_artwork(song_data: Song_Data): Promise<void> {
        if(!song_data) return;
        if(song_data.colors?.primary && song_data.colors?.common) return;
        const artwork_object_url = song_data.download_artwork_blob ? URL.createObjectURL(song_data.download_artwork_blob) : await firstValueFrom(this.image_loader_service.load_progressive(song_data.url.artwork.high, song_data.url.artwork.low));
        if(!song_data.colors?.primary) {
            if(artwork_object_url) {
                const primary = await this.media.get_primary_color_from_artwork(artwork_object_url, 0.4);
                song_data.colors.primary = primary;
            }
        }

        if(!song_data.colors?.common) {
            if(artwork_object_url) {
                const common = await this.media.get_top_colors_from_artwork(artwork_object_url);
                song_data.colors.common = common;
            }
        }

        // this.media.save_song_to_indexDB(this.media.song_key(song_data.id), song_data);
        if(this.is_song_key_equal_to_current(this.media.song_key(this._media_data.id))) this._media_data = song_data;
    }

    private sleep_timer_interval: any = null;
    private async start_sleep_timer(): Promise<void> {
        if(this._sleep_time === null) return;
        if(this.sleep_timer_interval) {
            clearInterval(this.sleep_timer_interval);
        }
        const interval = 1000; // 1 second
        this.sleep_timer_interval = setInterval(() => {
            if(this._sleep_time_remaining !== null) {
                this._sleep_time_remaining -= interval / 1000;
                if(this._sleep_time_remaining <= 0) {
                    this._sleep_time_remaining = null;
                    this.pause();
                    clearInterval(this.sleep_timer_interval);
                }
            } else {
                clearInterval(this.sleep_timer_interval);
            }
        }, interval);
    }

    public clear_sleep_timer(): void {
        this._sleep_time = null;
        this._sleep_time_remaining = null;
        if(this.sleep_timer_interval) {
            clearInterval(this.sleep_timer_interval);
        }
    }

    public set_sleep_timer_to_end_of_track(): void {
        this.sleep_timer_to_end_of_track = true;
    }

    private async update_lyrics(song_data: Song_Data): Promise<void> {
        if(!song_data) return;
        if(song_data.lyrics) return;
        try {
            const lyrics = await this.media.get_song_lyrics(song_data.id.video_id);
            song_data.lyrics = lyrics;
            if(this.is_song_key_equal_to_current(this.media.song_key(this._media_data.id))) this._media_data = song_data;
        } catch (error) {
            console.error('Error fetching lyrics for song:', error);
        }
    }
}

export default MusicMediaManager;