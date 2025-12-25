import MusicPlaylistManager from "./playlist.manager";
import BufferController from "./buffer.controller";
import { MusicMediaService, Song_Data, Song_Identifier } from "../music.media.service";
import { Skip_Event } from "./playlist.manager";
import { SettingsService } from "../settings.service";
import { NotificationService } from "../notification.service";
import MediaMixer from "./media.mixer";
import { MusicPlayerService } from "../music.player.service";
import { SessionPlaylistInterceptorService, HLS_Bundle } from "./http.interceptor.service";

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
    FETCH_PLAYBACK_URL = "Failed to fetch playback URL",
    DOES_NOT_EXIST = "The requested track does not exist",
    PLAYBACK = "Playback error",
}

class MusicMediaManager {
    public playlist_manager: MusicPlaylistManager;
    public buffer_controller: BufferController;
    public mixer: MediaMixer;

    private thumbnail_element: HTMLImageElement | null = null;

    public song_cache: Map<string, Song_Data> = new Map<string, Song_Data>();
    private _media_data: Song_Data | null = null;
    public use_streaming_playlist: boolean = true;
    public streaming_playlist_in_use: boolean = false;

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
        return this.loading_tracks.get(this.playlist_manager.next_song_key) === 'loaded';
    }

    constructor(
        private media: MusicMediaService, 
        private settings: SettingsService, 
        private player: MusicPlayerService, 
        public http_interceptor_service: SessionPlaylistInterceptorService,
        buffer_controller?: BufferController, 
        private notification_service?: NotificationService,
    ) {
        // Use the provided BufferController or create a new one
        // This allows the service to share a single BufferController instance
        this.buffer_controller = buffer_controller || new BufferController(this.settings, this);
        this.playlist_manager = new MusicPlaylistManager(this.media, this);
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

    public set_streaming_playlist_queue(songs: string[]): void {
        // before setting the queue, based on the current index of the current song, see if we need to flush the buffer after said index
        // we see which indices of 'songs' and 'this.http_interceptor_service.song_queue' match
        // to do
        for(let index = this.buffer_controller.current_track_index + 1; index < songs.length; index++) {
            if(!this.http_interceptor_service.song_queue?.[index]) continue;
            if(this.http_interceptor_service.song_queue[index] !== songs[index]) {
                // mismatch found, flush buffer from this index onwards
                // this.buffer_controller.flush_buffer_after_index(index);
                setTimeout(() => this.buffer_controller.update_playlist(null), 50);
                console.log('Flushed buffer due to playlist queue change at index:', index);
                break;
            }
        }

        this.http_interceptor_service.song_queue = songs;
    }

    public get_silent_audio_position(): number {
        // if(this.buffer_controller.timestamps_of_tracks_cache[this.buffer_controller.timestamps_of_tracks_cache.length - 1].video_id === '#silent_audio') {
        //     return this.buffer_controller.timestamps_of_tracks_cache[this.buffer_controller.timestamps_of_tracks_cache.length - 1].start_timestamp;
        // }
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
        console.log('Toggling play state. Currently playing:', this.buffer_controller.is_playing);
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

        try {
            navigator.mediaSession.setPositionState({
                duration: Math.max(duration, 0),
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

    private load_error(video_id: string, error: Audio_Error = Audio_Error.UNKNOWN, auto_skip: boolean = false): void {
        this.notification_service.error(`${error} - Failed to load track: ${video_id}`, {dismissTime: 7000, autoDismiss: true});
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
        return this.loading_tracks.get(this.playlist_manager.current_song_key) !== 'loaded';
    }
    private loading_tracks: Map<string, 'fetching_video_id' | 'fetching_audio_stream' | 'fetching_audio_data' | 'loaded'> = new Map<string, 'fetching_video_id' | 'fetching_audio_stream' | 'fetching_audio_data' | 'loaded'>(); // song_keys currently being loaded, to its state
    // private loading_types: Map<string, 'current' | 'preload'> = new Map<string, 'current' | 'preload'>(); // song_keys being loaded, to its type
    // if load_into_source is false, we are just telling the server to create the stream
    public async load_track(data: Song_Identifier | Song_Data | string, load_into_source: boolean = true): Promise<void> {
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
            console.log('string')
        }
        else if(this.is_song_identifier(data)) {
            song_key = this.media.song_key(data);
            song_identifier = data;
            song_data = this.song_cache.get(song_key) || null;
            // Only set cache if we have data - don't overwrite with null
            if (song_data) {
                this.song_cache.set(song_key, song_data);
            }
            console.log('identifier')
        }
        else if(this.is_song_data(data)) {
            song_data = data;
            song_identifier = data.id;
            song_key = this.media.song_key(data.id);
            console.log('data')
        } else {
            console.error('Invalid data provided to load_track:', data);
            this.load_error(song_key, Audio_Error.DOES_NOT_EXIST, true);
            return;
        }

        // at this point, song_key and song_identifier must be set
        if(!song_key || !song_identifier) {
            console.error('Failed to determine song key or identifier in load_track:', data);
            this.load_error(song_key || 'unknown', Audio_Error.DOES_NOT_EXIST, true);
            return;
        }

        if(load_into_source) {
            // we are loading this specific song to play
            // this.buffer_controller.clear_buffer();
            this.playlist_manager.current_song_key = song_key;
            if(song_data) {
                this.update_media_session(song_data);
                // this.update_media_session_position(0, ((song_data?.video_duration || 0) / 1000));
            }
        }

        // now check to see if video_id is missing and needs to be fetched
        if(this.media.song_key_missing_only_video_id(song_key)) {
            // valid key, missing only video id which can be fetched, start by fetching it
            this.loading_tracks.set(song_key, 'fetching_video_id');
            switch(song_identifier.source) {
                case 'spotify': {
                    const spotify_id = song_identifier.source_id;
                    // Fetch the video ID from Spotify
                    const video_id = await this.media.get_video_id_from_spotify_uri(`spotify:track:${spotify_id}`);
                    if(video_id && video_id !== '') {
                        const old_song_key = song_key;
                        this.loading_tracks.delete(song_key);// remove old key from loading

                        song_identifier.video_id = video_id;
                        song_key = this.media.song_key(song_identifier);
                        this.loading_tracks.set(song_key, 'fetching_video_id');
                        // check to make sure if we are still loading the same song
                        if(this.is_song_key_equal_to_current(old_song_key)) this.playlist_manager.current_song_key = song_key;
                        if(song_data && song_data?.id) song_data.id.video_id = video_id;

                        await this.media.replace_song_key(old_song_key, song_key, song_data !== null ? song_data : undefined);
                    } else {
                        if(this.is_song_key_equal_to_current(song_key)) this.load_error(song_key, Audio_Error.FETCH_VIDEO_ID, this.is_song_key_equal_to_current(song_key));
                        return;
                    }
                    break;
                }
                default: {
                    console.error('Unsupported source for fetching video ID:', song_identifier.source);
                    if(this.is_song_key_equal_to_current(song_key)) this.load_error(song_key, Audio_Error.FETCH_VIDEO_ID, this.is_song_key_equal_to_current(song_key));
                    return;
                }
            }
        }

        // by now video_id must be present
        if(!song_identifier.video_id || song_identifier.video_id === '') {
            console.error('No valid video ID found in song identifier for load:', song_identifier);
            this.loading_tracks.delete(song_key);
            this.load_error(song_key, Audio_Error.DOES_NOT_EXIST, this.is_song_key_equal_to_current(song_key));
            return;
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
                return;
            }

            this.media.request_song_to_streaming_hls_bundle(song_identifier.video_id, { mix: false }).then((hls_stream_bundle) => {
                // handle the appended song data
                this.http_interceptor_service.add_bundle(hls_stream_bundle);
                this.loading_tracks.set(song_key, 'loaded'); // technically not loaded yet, but close enough
            });
        } else {
            // old method 
            // do later
        }
    }

    //     if(this.use_streaming_playlist) {
    //         // use streaming playlist
    //         console.log('Loading track via streaming playlist:', song_key);
    //         if(this.media.song_key_missing_only_video_id(song_key)) {
    //             // valid key, missing only video id which can be fetched, start by fetching it
    //             if(this.loading_types.get(song_key) === 'current') this.loading_tracks.set(song_key, 'fetching_video_id');
    //             switch(song_identifier.source) {
    //                 case 'spotify': {
    //                     const spotify_id = song_identifier.source_id;
    //                     // Fetch the video ID from Spotify
    //                     const video_id = await this.media.get_video_id_from_spotify_uri(`spotify:track:${spotify_id}`);
    //                     if(video_id && video_id !== '') {
    //                         const old_song_key = song_key;
    //                         this.loading_tracks.delete(song_key);// remove old key from loading
    //                         const original_loading_type = this.loading_types.get(song_key);
    //                         this.loading_types.delete(song_key);

    //                         song_identifier.video_id = video_id;
    //                         song_key = this.media.song_key(song_identifier);
    //                         this.loading_tracks.set(song_key, 'fetching_video_id');
    //                         this.loading_types.set(song_key, original_loading_type);
    //                         // check to make sure if we are still loading the same song
    //                         if(this.is_song_key_equal_to_current(old_song_key)) this.currently_loading_song_key = song_key;
    //                         if(song_data && song_data?.id) song_data.id.video_id = video_id;

    //                         await this.media.replace_song_key(old_song_key, song_key, song_data);
    //                         this.song_cache.delete(old_song_key);
    //                         this.song_cache.set(song_key, song_data);
    //                     } else {
    //                         if(this.loading_types.get(song_key) === 'current') this.load_error(song_key, Audio_Error.FETCH_VIDEO_ID, this.is_song_key_equal_to_current(song_key));
    //                         return;
    //                     }
    //                     break;
    //                 }
    //             }
    //         }
    //         // when streaming playlist is used, we change current time stamp 
    //         // check if we have a streaming playlist url set
    //         if(!song_identifier.video_id || song_identifier.video_id === '') {
    //             console.error('No valid video ID found in song identifier for streaming playlist load:', song_identifier);
    //             this.load_error(song_key, Audio_Error.DOES_NOT_EXIST, load_into_source);
    //             return;
    //         }

    //         if(!this.streaming_playlist_in_use) {
    //             await this.media.get_streaming_playlist_url().then(url => {
    //                 this.set_streaming_playlist(url);
    //             });
    //         } 

    //         this.media.request_song_to_streaming_hls_bundle(song_identifier.video_id, { mix: false }).then((hls_stream_bundle) => {
    //             // handle the appended song data
    //             console.log('hls stream bundle received for streaming playlist load:', hls_stream_bundle);
    //             this.http_interceptor_service.add_bundle(hls_stream_bundle);
    //         });

    //         if(this.loading_types.get(song_key) === 'current' && this.is_song_key_equal_to_current(song_key)) {
    //             this.update_media_session(song_data);
    //             this.update_media_session_position(0, (song_data.video_duration / 1000) || 0);
    //             // this.playlist_manager.current_song_key = this.currently_loading_song_key;
    //             this.playlist_manager.current_song_key = song_key;
    //             this.currently_loading_song_key = song_key;
    //         }
    //     } else {
    //         // use normal song by song loading

    //         // pause current audio and reset silent audio state
    //         if(load_into_source) this.buffer_controller.set_audio_source_to_silent(); // request silent audio to stop current playback, b/c some browsers require user interaction to start audio again

    //         // song identifier must be set now
    //         // and so should song_data if it was available in the cache
    //         if(!song_identifier) {
    //             console.error('No valid song identifier provided to load_track');
    //             if(load_into_source) this.load_error(song_key, Audio_Error.DOES_NOT_EXIST, false);
    //             return;
    //         }

    //         // Check if we're upgrading from preload to current
    //         const was_preloaded = this.loading_tracks.get(song_key) === 'loaded' && this.loading_types.get(song_key) === 'preload';
            
    //         // Update the loading type - if upgrading from preload, this is critical
    //         this.loading_types.set(song_key, load_into_source ? 'current' : 'preload');

    //         if(this.loading_types.get(song_key) === 'current') {
    //             // if(load_type === 'current') this.update_media_session(song_data);
    //             // audio_data_reference.data = song_data;
    //             if(!song_data) {
    //                 (async ()=> {
    //                     try {
    //                         let fetched_song_data = await this.media.get_song_data(song_key!);
    //                         this.song_cache.set(song_key!, fetched_song_data);
    //                         this.update_media_session(fetched_song_data);
    //                         this.update_media_session_position(0, (fetched_song_data.video_duration / 1000) || 0);
    //                     } catch (error) {
    //                         console.error('Error fetching song data for', song_key, error);
    //                     }
    //                 })();
                    
    //             } else {
    //                 this.update_media_session(song_data);
    //                 this.update_media_session_position(0, (song_data.video_duration / 1000) || 0);
    //                 this.song_cache.set(song_key, song_data);
    //             }
    //             this.playlist_manager.current_song_key = song_key;
    //             this.currently_loading_song_key = song_key;
    //         }
    //         // if(load_type === 'current') this.song_changed.emit();
            
    //         // Check if track is already being loaded
    //         if(this.loading_tracks.has(song_key)) {
    //             const current_state = this.loading_tracks.get(song_key);
                
    //             // If it was preloaded and now we want to play it, continue to load it into source
    //             if(current_state === 'loaded' && was_preloaded && load_into_source) {
    //                 console.log('Track was preloaded, now loading into audio source:', song_key);
    //                 // Reset the state so we can load it properly
    //                 this.loading_tracks.set(song_key, 'fetching_audio_stream');
    //             } else if(current_state !== 'loaded') {
    //                 // Still loading, wait for it
    //                 console.log('Track is already being loaded:', song_key);
    //                 return;
    //             } else if(current_state === 'loaded' && !load_into_source) {
    //                 // Already preloaded, nothing to do
    //                 console.log('Track is already preloaded:', song_key);
    //                 return;
    //             }
    //         } else {
    //             this.loading_tracks.set(song_key, null); // default to fetching video id
    //         }

    //         if(this.media.song_key_missing_only_video_id(song_key)) {
    //             // valid key, missing only video id which can be fetched, start by fetching it
    //             if(this.loading_types.get(song_key) === 'current') this.loading_tracks.set(song_key, 'fetching_video_id');
    //             switch(song_identifier.source) {
    //                 case 'spotify': {
    //                     const spotify_id = song_identifier.source_id;
    //                     // Fetch the video ID from Spotify
    //                     const video_id = await this.media.get_video_id_from_spotify_uri(`spotify:track:${spotify_id}`);
    //                     if(video_id && video_id !== '') {
    //                         const old_song_key = song_key;
    //                         this.loading_tracks.delete(song_key);// remove old key from loading
    //                         const original_loading_type = this.loading_types.get(song_key);
    //                         this.loading_types.delete(song_key);

    //                         song_identifier.video_id = video_id;
    //                         song_key = this.media.song_key(song_identifier);
    //                         this.loading_tracks.set(song_key, 'fetching_video_id');
    //                         this.loading_types.set(song_key, original_loading_type);
    //                         // check to make sure if we are still loading the same song
    //                         if(this.is_song_key_equal_to_current(old_song_key)) this.currently_loading_song_key = song_key;
    //                         if(song_data && song_data?.id) song_data.id.video_id = video_id;

    //                         await this.media.replace_song_key(old_song_key, song_key, song_data);
    //                         this.song_cache.delete(old_song_key);
    //                         this.song_cache.set(song_key, song_data);
    //                     } else {
    //                         if(this.loading_types.get(song_key) === 'current') this.load_error(song_key, Audio_Error.FETCH_VIDEO_ID, this.is_song_key_equal_to_current(song_key));
    //                         return;
    //                     }
    //                     break;
    //                 }
    //             }
    //         }

    //         if(this.loading_types.get(song_key) === 'preload') {
    //             // just request stream creation
    //             await this.media.get_audio_stream(song_key).then((audio_source_url) => {
    //                 if(!audio_source_url || audio_source_url === '') {
    //                     // failed to get stream
    //                     console.error('Could not fetch audio stream for', song_key);
    //                     return;
    //                 }
    //                 console.log('Audio stream URL ready for', song_key);
    //             }).catch((error) => {
    //                 console.error('Error fetching audio stream for', song_key, error);
    //             }).finally(() => {
    //                 this.loading_tracks.set(song_key, 'loaded');
    //             });
    //             // return;
    //         }

    //         if(this.loading_types.get(song_key) === 'current' && this.is_song_key_equal_to_current(song_key)) this.loading_tracks.set(song_key, 'fetching_audio_stream');
    //         if(!song_data) {
    //             // load audio with the intent of streaming while fetching data in the background to make sure if it is downloaded: if so we can load it from blob
    //             let allow_optomistic_load: boolean = true;

    //             // load audio optimistically
    //             // if(this.is_song_key_equal_to_current(song_key)) {
    //                 this.media.get_audio_stream(song_key).then(async (audio_source_url) => {
    //                     // only force skip if the current song is the one being loaded
    //                     if(!audio_source_url || audio_source_url === '') return this.load_error(song_key, Audio_Error.FETCH_PLAYBACK_URL, this.is_song_key_equal_to_current(song_key));
    //                     if(!allow_optomistic_load) return;
    //                     if(this.loading_types.get(song_key) === 'current' && this.is_song_key_equal_to_current(song_key)) this.loading_tracks.set(song_key, 'fetching_audio_data');
    //                     if(this.is_song_key_equal_to_current(song_key)) await this.buffer_controller.load_and_play(audio_source_url);
    //                 }).catch((error) => {
    //                     // only force skip if the current song is the one being loaded
    //                     this.load_error(song_key, Audio_Error.PLAYBACK, this.is_song_key_equal_to_current(song_key));
    //                     console.error('Error fetching audio stream for', song_key, error);
    //                 }).finally(() => {
    //                     this.loading_tracks.set(song_key, 'loaded');
    //                 });
    //             // }

    //             try {
    //                 song_data = await this.media.get_song_data(song_key);
    //                 this.song_cache.set(song_key, song_data);
    //                 if(song_data && this.is_song_key_equal_to_current(song_key)) {
    //                     this.update_media_session(song_data);
    //                     // add to song cache
    //                     this.song_cache.set(song_key, song_data);
    //                     if(song_data.downloaded && song_data.download_audio_blob) {
    //                         allow_optomistic_load = false; // prevent optimistic load if we have the blob
    //                         return;
    //                     }
    //                     // if not downloaded, allow for optimistic load to continue
    //                     return;
    //                 }

    //                 this.load_error(song_key, Audio_Error.DOES_NOT_EXIST, this.is_song_key_equal_to_current(song_key));
    //                 return console.error('Could not load song data for', song_key);
    //             } catch (error) {
    //                 console.error('Error fetching song data for', song_key, error);
    //                 this.load_error(song_key, Audio_Error.PLAYBACK, this.is_song_key_equal_to_current(song_key));
    //                 return;
    //             }
    //         }

    //         // here song_data and song_identifier must be set
    //         if(this.loading_types.get(song_key) === 'current' && this.is_song_key_equal_to_current(song_key)) {
    //             this.update_media_session(song_data);
    //             this.update_media_session_position(0, (song_data.video_duration / 1000) || 0);
    //             // this.playlist_manager.current_song_key = this.currently_loading_song_key;
    //         }
    //         // this.song_changed.emit();
            
    //         // load audio source - check for downloaded content first
    //         if(song_data.downloaded) {
    //             // Check for HLS bundle first (new format - preferred)
    //             if(song_data.download_hls_bundle) {
    //                 console.log('Loading audio from downloaded HLS bundle for', song_key);
    //                 if(this.loading_types.get(song_key) === 'current' && this.is_song_key_equal_to_current(song_key)) {
    //                     this.loading_tracks.set(song_key, 'fetching_audio_data');
    //                 }
                    
    //                 try {
    //                     // Create blob URLs from the stored HLS bundle
    //                     const hls_urls = await this.media.create_hls_blob_urls_from_bundle(song_key, song_data.download_hls_bundle);
                        
    //                     if(hls_urls && hls_urls.playlist_url) {
    //                         // If this is the current song, load it into the audio source
    //                         if(this.is_song_key_equal_to_current(song_key)) {
    //                             await this.buffer_controller.load_and_play(hls_urls.playlist_url);
    //                         }
    //                         this.loading_tracks.set(song_key, 'loaded');
                            
    //                         // Preload next song
    //                         const following_song_key = this.playlist_manager.next_song_key;
    //                         this.load_track(following_song_key, false);
    //                         return;
    //                     } else {
    //                         console.warn('Failed to create HLS blob URLs, falling back to other methods');
    //                     }
    //                 } catch (error) {
    //                     console.error('Error loading HLS bundle:', error);
    //                     // Fall through to try other methods
    //                 }
    //             }
                
    //             // Fallback to legacy MP3 blob (old format)
    //             if(song_data.download_audio_blob) {
    //                 const blob = await this.create_blob_url_from_stale_blob(song_data.download_audio_blob);
    //                 console.log('Loading audio from downloaded MP3 blob for', song_key);
    //                 if(this.loading_types.get(song_key) === 'current' && this.is_song_key_equal_to_current(song_key)) {
    //                     this.loading_tracks.set(song_key, 'fetching_audio_data');
    //                 }
                    
    //                 // If this is the current song, load it into the audio source
    //                 if(this.is_song_key_equal_to_current(song_key)) {
    //                     await this.buffer_controller.load_and_play(blob);
    //                 }
                    
    //                 this.loading_tracks.set(song_key, 'loaded');

    //                 // Preload next song
    //                 const following_song_key = this.playlist_manager.next_song_key;
    //                 this.load_track(following_song_key, false);
    //                 return;
    //             }
    //         }
            
    //         // No downloaded content available, stream from network
    //         this.media.get_audio_stream(song_key).then(async (audio_source_url) => {
    //             if(!audio_source_url || audio_source_url === '') return this.load_error(song_key, Audio_Error.FETCH_PLAYBACK_URL, this.is_song_key_equal_to_current(song_key));
    //             if(this.loading_types.get(song_key) === 'current' && this.is_song_key_equal_to_current(song_key)) this.loading_tracks.set(song_key, 'fetching_audio_data');
    //             if(this.is_song_key_equal_to_current(song_key)) await this.buffer_controller.load_and_play(audio_source_url);
    //         }).catch((error) => {
    //             this.load_error(song_key, Audio_Error.PLAYBACK, this.is_song_key_equal_to_current(song_key));
    //             console.error('Error fetching audio stream for', song_key, error);
    //         }).finally(() => {
    //             this.loading_tracks.set(song_key, 'loaded');
    //         });

    //         // preload next song
    //         const following_song_key = this.playlist_manager.next_song_key;
    //         const following_song_identifier = this.media.parse_song_key(following_song_key);
    //         this.load_track(following_song_key, false);

    //         // if(!load_into_source) return; // no need to setup mixer if not loading into source

    //         // if(song_key === following_song_key) return; // no need to mix same song // temp for now
    //         // console.log('Setting up mixer for', song_key, 'and', following_song_key);
    //         // this.mixer.set_song_ids(
    //         //     song_identifier.video_id,
    //         //     following_song_identifier.video_id
    //         // );
    //         // this.mixer.mix_and_load_into_player(this.player);
    //     }
    // }

    public async load_track_and_play(data: Song_Identifier | Song_Data | string): Promise<void> {
        await this.load_track(data, true);
        this.play();
    }

    public queue_updated(): void {
        this.set_streaming_playlist_queue(this.playlist_manager.full_queue);
    }

    public async set_streaming_playlist(playlist_url: string | null): Promise<void> {
        if(!playlist_url) return;
        this.streaming_playlist_in_use = true;
        await this.buffer_controller.load_and_play(playlist_url);
    }

    public async update_media_session(data: Song_Identifier | Song_Data | string): Promise<void> {
        if (!('mediaSession' in navigator) || !data) return;
        this.configure_media_session();
        console.log('Updating media session with data:', data);

        let metadata: Song_Data | null = null;

        if(this.is_string(data)) {
            const song_key = data;
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
            const song_key = this.media.song_key(data);
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
            const song_key = this.media.song_key(metadata.id);
            this.song_cache.set(song_key, metadata);
        } else {
            console.error('Invalid data provided to update_media_session:', data);
            return;
        }

        if(!metadata) {
            console.error('No metadata found for media session update:', data);
            return;
        }

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

        this.thumbnail_element.src = artwork_url;

        navigator.mediaSession.metadata = new MediaMetadata({
            title: metadata.song_name,
            artist: metadata.artists.map(artist => artist.name).join(', '),
            album: '',
            artwork: [
                { src: artwork_url, sizes: '512x512', type: 'image/png' }
            ]
        });

        // Update position state when metadata changes
        this.update_media_session_position();
        this.update_colors_from_artwork(metadata);
    }

    private async update_colors_from_artwork(song_data: Song_Data): Promise<void> {
        if(!song_data) return;
        if(song_data.colors?.primary && song_data.colors?.common) return;
        if(!song_data.colors?.primary) {
            const artwork_url = song_data.download_artwork_blob
                ? URL.createObjectURL(song_data.download_artwork_blob)
                : song_data.url.artwork.high ?? song_data.url.artwork.low;

            if(artwork_url) {
                const primary = await this.media.get_primary_color_from_artwork(artwork_url);
                song_data.colors.primary = primary;
            }
        }

        if(!song_data.colors?.common) {
            const artwork_url = song_data.download_artwork_blob
                ? URL.createObjectURL(song_data.download_artwork_blob)
                : song_data.url.artwork.high ?? song_data.url.artwork.low;

            if(artwork_url) {
                const common = await this.media.get_top_colors_from_artwork(artwork_url);
                song_data.colors.common = common;
            }
        }

        this.media.save_song_to_indexDB(this.media.song_key(song_data.id), song_data);
        this._media_data = song_data;
    }
}

export default MusicMediaManager;