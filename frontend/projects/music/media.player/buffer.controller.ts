import Hls from 'hls.js';
import { Events } from 'hls.js';
import type { MediaAttachingData } from 'hls.js';

// interface Audio_Chunk {
//     data: Uint8Array;
//     timestamp: number;
// };

class BufferController {
    private audio_element: HTMLMediaElement;
    private media_source: MediaSource | null = null;
    private source_buffer: SourceBuffer | null = null;
    // private dynamic_media_extension_buffer: Audio_Chunk[] = [];
    private hls: Hls | null = null;

    private is_media_source_attached: boolean = false;
    private codec = 'audio/mp4; codecs="mp4a.40.2"';

    public set_audio_element(audio: HTMLMediaElement | HTMLAudioElement) {
        this.audio_element = audio;
        this.configure_audio_element();
    }

    private async configure_audio_element() {
        if (!this.audio_element) throw new Error('Audio element not set.');
        this.audio_element.preload = 'auto';
        this.audio_element.setAttribute('playsinline', 'true');
        this.audio_element.setAttribute('webkit-playsinline', 'true');

        this.configure_media_session();
        this.initialize_media_source();
        this.create_hls_instance();
    }

    private configure_media_session() {
        if (!('mediaSession' in navigator)) return;

        // navigator.mediaSession.setActionHandler('play', () => null);
        // navigator.mediaSession.setActionHandler('pause', () => null);
        // navigator.mediaSession.setActionHandler('nexttrack', () => null);
        // navigator.mediaSession.setActionHandler('previoustrack', () => null);
    }

    private async initialize_media_source() {
        if (this.is_media_source_attached) return;
        if (!this.audio_element) throw new Error('Audio element not set.');

        this.media_source = new MediaSource();
        const object_url = URL.createObjectURL(this.media_source);
        this.audio_element.src = object_url;

        await new Promise<void>((resolve, reject) => {
            this.media_source!.addEventListener('sourceopen', () => {
                if (!this.media_source) {
                    reject(new Error('MediaSource is null on sourceopen event.'));
                    return;
                }

                try {
                    this.source_buffer = this.media_source.addSourceBuffer(this.codec);
                    this.source_buffer.mode = 'sequence'; // Append mode, useful for seamless

                    this.source_buffer.addEventListener('updateend', () => {
                        this.process_append_to_buffer();
                        console.log('SourceBuffer update ended.');
                    });

                    this.source_buffer.addEventListener('error', (error) => {
                        console.error('SourceBuffer error:', error);
                    });

                    this.is_media_source_attached = true;
                    console.log('MediaSource initialized and ready');
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    private create_hls_instance() {
        if (this.hls) {
            console.warn('HLS instance already exists, destroying existing instance.');
            this.hls.destroy();
        }

        this.hls = new Hls({
            // startLevel: -1, // Start with auto quality selection
            autoStartLoad: true, // prevent automatic media attachment

            debug: false,
            
            enableWorker: true,
            lowLatencyMode: false,
        });

        this.hls.attachMedia({
            media: this.audio_element,
            // mediaSource: this.media_source, // <-- Same every time!
            overrides: { endOfStream: false }
        });

        this.configure_hls_events();
    }

    private configure_hls_events() {
        if (!this.hls) return;

        this.hls.on(Events.MANIFEST_LOADING, (e, data) => {
            console.log('Manifest loading:', data.url);
        });

        this.hls.on(Events.MANIFEST_LOADED, (e, data) => {
            console.log('Manifest loaded:', data);
            // data.details.fragments → array of all fragment objects
        });

        this.hls.on(Events.MANIFEST_PARSED, (e, data) => {
            console.log('Manifest parsed:', data.levels);
            // You can modify available levels here
        });

        // this.hls.on(Events.LEVEL_LOADED, (e, data) => {
        //     console.log('Level loaded:', data);
        // });

        // this.hls.on(Events.MEDIA_DETACHING, () => {
        //     console.log('Media detaching, cleaning up SourceBuffer if needed');
        //     // Optionally clean up SourceBuffer here
        // });

        this.hls.on(Events.BUFFER_APPENDING, (event, data) => {
            console.log('Intercepting buffer append:', data.frag.sn);
            console.log(data);
            
            // Get the data before HLS.js processes it
            if (data.data && data.type === 'audio') {
                const uint_8_data = new Uint8Array(data.data);
                this.append_to_buffer(uint_8_data);
            }
        });

        // // Listen for manifest parsed to start loading
        // this.hls.on(Events.MANIFEST_PARSED, () => {
        //     console.log('Manifest parsed, starting load');
        //     this.hls?.startLoad();
        // });
    }

    public play(url: string) {
        if (!this.audio_element) throw new Error('Audio element not set.');
        // const url = ;

        this.hls.loadSource(url);
        this.audio_element.play();
    }

    public pause() {
        if (!this.audio_element) throw new Error('Audio element not set.');
        this.audio_element.pause();
    }

    get is_playing(): boolean {
        if (!this.audio_element) return false;
        return !this.audio_element.paused;
    }

    private append_to_buffer_queue: Uint8Array[] = [];
    private is_processing_queue: boolean = false;

    public add_to_buffer_queue(data: Uint8Array) {
        this.append_to_buffer_queue.push(data);
        this.process_append_to_buffer();
    }

    private async process_append_to_buffer() {
        // Prevent concurrent processing
        if (this.is_processing_queue) {
            console.log('Already processing queue, skipping...');
            return;
        }

        if (!this.source_buffer) {
            console.error('SourceBuffer not initialized, cannot process queue.');
            return;
        }

        this.is_processing_queue = true;

        try {
            // Keep processing until queue is empty
            while (this.append_to_buffer_queue.length > 0) {
                const data = this.append_to_buffer_queue.shift();
                
                if (!data) {
                    console.log('No data in append queue.');
                    break;
                }

                try {
                    // Wait if SourceBuffer is updating
                    if (this.source_buffer.updating) {
                        console.log('SourceBuffer is updating, waiting...');
                        await new Promise<void>((resolve) => {
                            const onUpdateEnd = () => {
                                this.source_buffer?.removeEventListener('updateend', onUpdateEnd);
                                resolve();
                            };
                            this.source_buffer?.addEventListener('updateend', onUpdateEnd);
                        });
                    }

                    // Append the data
                    this.source_buffer.appendBuffer(data);
                    console.log('Appended data to SourceBuffer:', data.byteLength, 'bytes');

                } catch (error) {
                    console.error('Error appending to buffer:', error);
                    // Log the error but continue processing remaining queue items
                    if (error instanceof Error && error.message.includes('QuotaExceededError')) {
                        console.warn('Buffer quota exceeded, may need to remove old data');
                        // Optionally remove old buffered data
                        if (this.source_buffer.buffered.length > 0) {
                            const removeEnd = Math.max(0, this.audio_element.currentTime - 30);
                            try {
                                this.source_buffer.remove(0, removeEnd);
                                console.log('Removed old buffer data to make space');
                            } catch (removeError) {
                                console.error('Error removing buffer:', removeError);
                            }
                        }
                        // Re-add data to try again
                        this.append_to_buffer_queue.unshift(data);
                        break;
                    }
                }
            }

            if (this.append_to_buffer_queue.length === 0) {
                console.log('Buffer queue processed completely');
            }

        } catch (error) {
            console.error('Fatal error processing buffer queue:', error);
        } finally {
            this.is_processing_queue = false;
        }
    }

    private async append_to_buffer(data: Uint8Array) {
        if (!this.source_buffer) {
            throw new Error('SourceBuffer not initialized');
        }

        if (this.source_buffer.updating) {
            console.warn('SourceBuffer is updating, data will be queued');
            this.add_to_buffer_queue(data);
            return;
        }

        try {
            this.source_buffer.appendBuffer(data);
            console.log('Appended data to SourceBuffer:', data.byteLength, 'bytes');
        } catch (error) {
            console.error('Error appending to buffer:', error);
            window.requestAnimationFrame(() => this.add_to_buffer_queue(data));
        }
    }
}

export default BufferController;