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
}

class MusicMediaManager {
    public playlist_manager: MusicPlaylistManager;
    public buffer_controller: BufferController;

    private thumbnail_element: HTMLImageElement | null = null;

    public song_cache: Map<string, Song_Data> = new Map<string, Song_Data>();
    public shuffle: boolean = false;
    public repeat: boolean = false;
    private _media_data: Song_Data | null = null;

    get current_song(): any {
        return this.playlist_manager.current_song;
    }
    get media_data(): Song_Data | null {
        return this._media_data;
    }
    set current_song(song: any) {
        this.playlist_manager.current_song = song;
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

    constructor(private media: MusicMediaService, private settings: SettingsService, buffer_controller?: BufferController, private notification_service?: NotificationService) {
        // Use the provided BufferController or create a new one
        // This allows the service to share a single BufferController instance
        this.buffer_controller = buffer_controller || new BufferController(this.settings);
        this.playlist_manager = new MusicPlaylistManager(this.media, this);

        this.buffer_controller.events.addEventListener('has_audio', () => {
            if(this.want_to_play) {
                this.play();
            }
            this.want_to_play = false;
        });

        this.shuffle = this.settings.shuffle_playback;
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

    private async create_blob_url_from_stale_blob(blob: Blob, mime_type: string = 'audio/mpeg'): Promise<string> {
        // used mainly for safari compatibility where reusing old blob urls can cause issues
        const array_buffer = await blob.arrayBuffer();
        if( array_buffer.byteLength > 0) {
            // fresh url with fresh blob
            return URL.createObjectURL(new Blob([array_buffer], { type: mime_type }));
        }
        throw new Error('Failed to create blob URL');
    }

    private load_error(video_id: string, error: Audio_Error = Audio_Error.UNKNOWN): void {
        this.notification_service.error(`${error} - Failed to load track: ${video_id}`);
        this.playlist_manager.next(Skip_Event.FORCE);
    }

    public async load_track(data: Song_Identifier | Song_Data | string): Promise<void> {
        let song_data: Song_Data | null = null;
        let song_identifier: Song_Identifier | null = null;
        let song_key: string | null = null;

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
            this.load_error(song_key, Audio_Error.DOES_NOT_EXIST);
            return;
        }

        // pause current audio and reset silent audio state
        this.buffer_controller.set_audio_source_to_silent(); // request silent audio to stop current playback, b/c some browsers require user interaction to start audio again

        // song identifier must be set now
        // and so should song_data if it was available in the cache
        if(!song_identifier) {
            console.error('No valid song identifier provided to load_track');
            this.load_error(song_key, Audio_Error.FETCH_VIDEO_ID);
            return;
        }

        if(song_data) {
            // if(load_type === 'current') this.update_media_session(song_data);
            // audio_data_reference.data = song_data;
            this.playlist_manager.current_song = song_data;
        }
        // if(load_type === 'current') this.song_changed.emit();

        console.log('Loading track:', song_key, song_identifier);

        if(!song_data) {
            // load audio with the intent of streaming while fetching data in the background to make sure if it is downloaded: if so we can load it from blob
            let allow_optomistic_load: boolean = true;

            // load audio optimistically
            this.media.get_audio_stream(song_key).then(async (audio_source_url) => {
                if(!audio_source_url || audio_source_url === '') return this.load_error(song_key, Audio_Error.FETCH_PLAYBACK_URL);
                if(!allow_optomistic_load) return;
                await this.buffer_controller.load_and_play(audio_source_url);
            }).catch((error) => {
                this.load_error(song_key, Audio_Error.FETCH_PLAYBACK_URL);
                console.error('Error fetching audio stream for', song_key, error);
            });

            try {
                song_data = await this.media.get_song_data(song_key);
                if(song_data) {
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

                this.load_error(song_key, Audio_Error.DOES_NOT_EXIST);
                return console.error('Could not load song data for', song_key);
            } catch (error) {
                console.error('Error fetching song data for', song_key, error);
                this.load_error(song_key, Audio_Error.FETCH_PLAYBACK_URL);
                return;
            }
        }

        // here song_data and song_identifier must be set
        this.update_media_session(song_data);
        this.update_media_session_position(0, (song_data.video_duration / 1000) || 0);
        // this.song_changed.emit();
        
        // load audio source
        if(song_data.downloaded && song_data.download_audio_blob) {
            const blob = await this.create_blob_url_from_stale_blob(song_data.download_audio_blob);
            // if(load_source_into_audio_element) this.load_audio(blob, 'blob');
            // await this.buffer_controller.load_blob(blob);
            console.log('Loading audio from downloaded blob for', song_key);

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
            this.media.get_audio_stream(song_key).then(async (audio_source_url) => {
                if(!audio_source_url || audio_source_url === '') return this.load_error(song_key, Audio_Error.FETCH_PLAYBACK_URL);
                await this.buffer_controller.load_and_play(audio_source_url);
            }).catch((error) => {
                this.load_error(song_key, Audio_Error.FETCH_PLAYBACK_URL);
                console.error('Error fetching audio stream for', song_key, error);
            });
        }
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
    }
}

export default MusicMediaManager;