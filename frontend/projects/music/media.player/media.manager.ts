import MusicPlaylistManager from "./playlist.manager";
import BufferController from "./buffer.controller";
import { MusicMediaService, Song_Data, Song_Identifier } from "../music.media.service";
import { Skip_Event } from "./playlist.manager";
import { SettingsService } from "../settings.service";
import { NotificationService } from "../src/app/services/notification.service";

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

    private thumbnail_element: HTMLImageElement | null = null;

    public song_cache: Map<string, Song_Data> = new Map<string, Song_Data>();
    private _media_data: Song_Data | null = null;

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
        return this.buffer_controller.current_time;
    }
    get song_duration(): number {
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

    constructor(private media: MusicMediaService, private settings: SettingsService, buffer_controller?: BufferController, private notification_service?: NotificationService) {
        // Use the provided BufferController or create a new one
        // This allows the service to share a single BufferController instance
        this.buffer_controller = buffer_controller || new BufferController(this.settings);
        this.playlist_manager = new MusicPlaylistManager(this.media, this);

        this.buffer_controller.events.addEventListener('has_audio', () => {
            if(this.want_to_play && !this.buffer_controller.is_playing) {
                this.play();
            }
            this.auto_skip_failure_count = 0; // reset on successful load
            this.want_to_play = false;
            this.update_media_session_position();

            const song_key = this.playlist_manager.current_song_key;
            this.loading_tracks.set(song_key, 'loaded');
        });
        this.buffer_controller.events.addEventListener('fully_buffered', () => {
            // refresh media session position
            this.update_media_session_position();
        });

        // this.shuffle = this.settings.shuffle_playback;
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
            this.seek_to(seek_time);
        });
    }

    // public skip_to_next(event: Skip_Event = Skip_Event.DEFAULT): void {
    //     this.playlist_manager?.next(event);
    // }

    // public skip_to_previous(event: Skip_Event = Skip_Event.DEFAULT): void {
    //     this.playlist_manager?.previous(event);
    // }

    public seek_to(time: number): void {
        this.buffer_controller.current_time = time;
        this.update_media_session_position();
    }

    public update_media_session_position(progress: number = this.current_time, duration: number = this.song_duration): void {
        if (!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return;

        try {
            navigator.mediaSession.setPositionState({
                duration: duration,
                playbackRate: 1.0,
                position: progress
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
        // const current_song = this.playlist_manager.current_song;
        // if (!current_song) return false;

        // const current_song_key = this.media.song_key(current_song.id);
        // return current_song_key === song_key;
        return this.currently_loading_song_key === song_key;
    }

    private max_auto_skip_before_failure: number = 5; // number of auto skips before stopping
    private auto_skip_failure_count: number = 0;
    // public loading_state: 'fetching_video_id' | 'fetching_audio_stream' | 'fetching_audio_data' | null = null;
    public get loading_state(): 'fetching_video_id' | 'fetching_audio_stream' | 'fetching_audio_data' | 'loaded' | null {
        // return the state of the the current track;
        if(this.loading_tracks.has(this.currently_loading_song_key)) {
            return this.loading_tracks.get(this.currently_loading_song_key) || null;
        }
        return null; 
    }
    public is_current_song_loading(): boolean {
        if(!this.loading_tracks.has(this.currently_loading_song_key)) return false;
        return this.loading_tracks.get(this.currently_loading_song_key) !== 'loaded';
    }
    private loading_tracks: Map<string, 'fetching_video_id' | 'fetching_audio_stream' | 'fetching_audio_data' | 'loaded'> = new Map<string, 'fetching_video_id' | 'fetching_audio_stream' | 'fetching_audio_data' | 'loaded'>(); // song_keys currently being loaded, to its state
    private loading_types: Map<string, 'current' | 'preload'> = new Map<string, 'current' | 'preload'>(); // song_keys being loaded, to its type
    // if load_into_source is false, we are just telling the server to create the stream
    private currently_loading_song_key: string | null = null;
    public async load_track(data: Song_Identifier | Song_Data | string, load_into_source: boolean = true): Promise<void> {
        let song_data: Song_Data | null = null;
        let song_identifier: Song_Identifier | null = null;
        let song_key: string | null = null;

        if(this.is_string(data)) {
            song_key = data;
            song_identifier = this.media.parse_song_key(data);
            song_data = this.song_cache.get(song_key) || null;
            // cache hit or miss, either way we have the identifier
            this.song_cache.set(song_key, song_data);
            console.log('string')
        }
        else if(this.is_song_identifier(data)) {
            song_key = this.media.song_key(data);
            song_identifier = data;
            song_data = this.song_cache.get(song_key) || null;
            this.song_cache.set(song_key, song_data);
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

        // pause current audio and reset silent audio state
        if(load_into_source) this.buffer_controller.set_audio_source_to_silent(); // request silent audio to stop current playback, b/c some browsers require user interaction to start audio again

        // song identifier must be set now
        // and so should song_data if it was available in the cache
        if(!song_identifier) {
            console.error('No valid song identifier provided to load_track');
            if(load_into_source) this.load_error(song_key, Audio_Error.DOES_NOT_EXIST, false);
            return;
        }

        // Check if we're upgrading from preload to current
        const was_preloaded = this.loading_tracks.get(song_key) === 'loaded' && this.loading_types.get(song_key) === 'preload';
        
        // Update the loading type - if upgrading from preload, this is critical
        this.loading_types.set(song_key, load_into_source ? 'current' : 'preload');

        if(this.loading_types.get(song_key) === 'current') {
            // if(load_type === 'current') this.update_media_session(song_data);
            // audio_data_reference.data = song_data;
            if(!song_data) {
                (async ()=> {
                    try {
                        let fetched_song_data = await this.media.get_song_data(song_key!);
                        this.song_cache.set(song_key!, fetched_song_data);
                        this.update_media_session(fetched_song_data);
                        this.update_media_session_position(0, (fetched_song_data.video_duration / 1000) || 0);
                    } catch (error) {
                        console.error('Error fetching song data for', song_key, error);
                    }
                })();
                
            } else {
                this.update_media_session(song_data);
                this.update_media_session_position(0, (song_data.video_duration / 1000) || 0);
                this.song_cache.set(song_key, song_data);
            }
            this.playlist_manager.current_song_key = song_key;
            this.currently_loading_song_key = song_key;
        }
        // if(load_type === 'current') this.song_changed.emit();
        
        // Check if track is already being loaded
        if(this.loading_tracks.has(song_key)) {
            const current_state = this.loading_tracks.get(song_key);
            
            // If it was preloaded and now we want to play it, continue to load it into source
            if(current_state === 'loaded' && was_preloaded && load_into_source) {
                console.log('Track was preloaded, now loading into audio source:', song_key);
                // Reset the state so we can load it properly
                this.loading_tracks.set(song_key, 'fetching_audio_stream');
            } else if(current_state !== 'loaded') {
                // Still loading, wait for it
                console.log('Track is already being loaded:', song_key);
                return;
            } else if(current_state === 'loaded' && !load_into_source) {
                // Already preloaded, nothing to do
                console.log('Track is already preloaded:', song_key);
                return;
            }
        } else {
            this.loading_tracks.set(song_key, null); // default to fetching video id
        }

        if(this.media.song_key_missing_only_video_id(song_key)) {
            // valid key, missing only video id which can be fetched, start by fetching it
            if(this.loading_types.get(song_key) === 'current') this.loading_tracks.set(song_key, 'fetching_video_id');
            switch(song_identifier.source) {
                case 'spotify': {
                    const spotify_id = song_identifier.source_id;
                    // Fetch the video ID from Spotify
                    const video_id = await this.media.get_video_id_from_spotify_uri(`spotify:track:${spotify_id}`);
                    if(video_id && video_id !== '') {
                        const old_song_key = song_key;
                        this.loading_tracks.delete(song_key);// remove old key from loading
                        const original_loading_type = this.loading_types.get(song_key);
                        this.loading_types.delete(song_key);

                        song_identifier.video_id = video_id;
                        song_key = this.media.song_key(song_identifier);
                        this.loading_tracks.set(song_key, 'fetching_video_id');
                        this.loading_types.set(song_key, original_loading_type);
                        // check to make sure if we are still loading the same song
                        if(this.is_song_key_equal_to_current(old_song_key)) this.currently_loading_song_key = song_key;
                        if(song_data && song_data?.id) song_data.id.video_id = video_id;

                        await this.media.replace_song_key(old_song_key, song_key, song_data);
                        this.song_cache.delete(old_song_key);
                        this.song_cache.set(song_key, song_data);
                    } else {
                        if(this.loading_types.get(song_key) === 'current') this.load_error(song_key, Audio_Error.FETCH_VIDEO_ID, this.is_song_key_equal_to_current(song_key));
                        return;
                    }
                    break;
                }
            }
        }

        if(this.loading_types.get(song_key) === 'preload') {
            // just request stream creation
            await this.media.get_audio_stream(song_key).then((audio_source_url) => {
                if(!audio_source_url || audio_source_url === '') {
                    // failed to get stream
                    console.error('Could not fetch audio stream for', song_key);
                    return;
                }
                console.log('Audio stream URL ready for', song_key);
            }).catch((error) => {
                console.error('Error fetching audio stream for', song_key, error);
            }).finally(() => {
                this.loading_tracks.set(song_key, 'loaded');
            });
            // return;
        }

        if(this.loading_types.get(song_key) === 'current' && this.is_song_key_equal_to_current(song_key)) this.loading_tracks.set(song_key, 'fetching_audio_stream');
        if(!song_data) {
            // load audio with the intent of streaming while fetching data in the background to make sure if it is downloaded: if so we can load it from blob
            let allow_optomistic_load: boolean = true;

            // load audio optimistically
            // if(this.is_song_key_equal_to_current(song_key)) {
                this.media.get_audio_stream(song_key).then(async (audio_source_url) => {
                    // only force skip if the current song is the one being loaded
                    if(!audio_source_url || audio_source_url === '') return this.load_error(song_key, Audio_Error.FETCH_PLAYBACK_URL, this.is_song_key_equal_to_current(song_key));
                    if(!allow_optomistic_load) return;
                    if(this.loading_types.get(song_key) === 'current' && this.is_song_key_equal_to_current(song_key)) this.loading_tracks.set(song_key, 'fetching_audio_data');
                    if(this.is_song_key_equal_to_current(song_key)) await this.buffer_controller.load_and_play(audio_source_url);
                }).catch((error) => {
                    // only force skip if the current song is the one being loaded
                    this.load_error(song_key, Audio_Error.PLAYBACK, this.is_song_key_equal_to_current(song_key));
                    console.error('Error fetching audio stream for', song_key, error);
                }).finally(() => {
                    this.loading_tracks.set(song_key, 'loaded');
                });
            // }

            try {
                song_data = await this.media.get_song_data(song_key);
                this.song_cache.set(song_key, song_data);
                if(song_data && this.is_song_key_equal_to_current(song_key)) {
                    this.update_media_session(song_data);
                    // add to song cache
                    this.song_cache.set(song_key, song_data);
                    if(song_data.downloaded && song_data.download_audio_blob) {
                        allow_optomistic_load = false; // prevent optimistic load if we have the blob
                        return;
                    }
                    // if not downloaded, allow for optimistic load to continue
                    return;
                }

                this.load_error(song_key, Audio_Error.DOES_NOT_EXIST, this.is_song_key_equal_to_current(song_key));
                return console.error('Could not load song data for', song_key);
            } catch (error) {
                console.error('Error fetching song data for', song_key, error);
                this.load_error(song_key, Audio_Error.PLAYBACK, this.is_song_key_equal_to_current(song_key));
                return;
            }
        }

        // here song_data and song_identifier must be set
        if(this.loading_types.get(song_key) === 'current' && this.is_song_key_equal_to_current(song_key)) {
            this.update_media_session(song_data);
            this.update_media_session_position(0, (song_data.video_duration / 1000) || 0);
            // this.playlist_manager.current_song_key = this.currently_loading_song_key;
        }
        // this.song_changed.emit();
        
        // load audio source
        if(song_data.downloaded && song_data.download_audio_blob) {
            const blob = await this.create_blob_url_from_stale_blob(song_data.download_audio_blob);
            // if(load_source_into_audio_element) this.load_audio(blob, 'blob');
            // await this.buffer_controller.load_blob(blob);
            console.log('Loading audio from downloaded blob for', song_key);
            if(this.loading_types.get(song_key) === 'current' && this.is_song_key_equal_to_current(song_key)) this.loading_tracks.set(song_key, 'fetching_audio_data');
            
            // If this is the current song, load it into the audio source
            if(this.is_song_key_equal_to_current(song_key)) {
                await this.buffer_controller.load_and_play(blob);
            }
            
            this.loading_tracks.set(song_key, 'loaded');

            // audio_data_reference.audio_source = blob;
            // audio_data_reference.source_type = 'blob';
        }
        // else if(song_data.url.audio && song_data.url.audio !== '') {
            // using stored url
            // if(load_source_into_audio_element) this.load_audio(song_data.url.audio, 'm3u8');

            // audio_data_reference.audio_source = song_data.url.audio;
            // audio_data_reference.source_type = 'm3u8';
        // }
        else {
            // if(this.is_song_key_equal_to_current(song_key)) {
                this.media.get_audio_stream(song_key).then(async (audio_source_url) => {
                    if(!audio_source_url || audio_source_url === '') return this.load_error(song_key, Audio_Error.FETCH_PLAYBACK_URL, this.is_song_key_equal_to_current(song_key));
                    if(this.loading_types.get(song_key) === 'current' && this.is_song_key_equal_to_current(song_key)) this.loading_tracks.set(song_key, 'fetching_audio_data');
                    if(this.is_song_key_equal_to_current(song_key)) await this.buffer_controller.load_and_play(audio_source_url);
                }).catch((error) => {
                    this.load_error(song_key, Audio_Error.PLAYBACK, this.is_song_key_equal_to_current(song_key));
                    console.error('Error fetching audio stream for', song_key, error);
                }).finally(() => {
                    this.loading_tracks.set(song_key, 'loaded');
                });
            // }
        }

        // preload next song
        // const following_song_key = this.playlist_manager.next_song_key;
        // this.load_track(following_song_key, true);
    }

    public async update_media_session(metadata: Song_Data): Promise<void> {
        if (!('mediaSession' in navigator) || !metadata) return;
        this.configure_media_session();

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
            artist: metadata.original_artists.map(artist => artist.name).join(', '),
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