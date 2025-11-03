import Hls from 'hls.js';
import { Events } from 'hls.js';
import type { MediaAttachingData } from 'hls.js';

class BufferController {
    private audio_element: HTMLMediaElement;
    private media_source: MediaSource | null = null;
    private source_buffer: SourceBuffer | null = null;
    private hls: Hls | null = null;

    private is_media_source_attached: boolean = false;
    private is_first_track: boolean = true;
    private transfer_data: any = null;
    private codec = 'audio/mp4; codecs="mp4a.40.2"';
    
    // Store the original blob URL to verify it doesn't change
    private blob_url: string | null = null;

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
        await this.initialize_media_source();
    }

    private configure_media_session() {
        if (!('mediaSession' in navigator)) return;

        navigator.mediaSession.setActionHandler('play', () => {
            this.audio_element?.play();
        });
        
        navigator.mediaSession.setActionHandler('pause', () => {
            this.audio_element?.pause();
        });
    }

    private async initialize_media_source() {
        if (this.is_media_source_attached) {
            console.log('MediaSource already attached, skipping initialization');
            return;
        }
        
        if (!this.audio_element) throw new Error('Audio element not set.');

        this.media_source = new MediaSource();
        this.blob_url = URL.createObjectURL(this.media_source);
        this.audio_element.src = this.blob_url;

        console.log('🎵 Creating MediaSource with blob URL:', this.blob_url);

        await new Promise<void>((resolve, reject) => {
            this.media_source!.addEventListener('sourceopen', () => {
                if (!this.media_source) {
                    reject(new Error('MediaSource is null on sourceopen event.'));
                    return;
                }

                try {
                    this.source_buffer = this.media_source.addSourceBuffer(this.codec);
                    // IMPORTANT: Use 'segments' mode instead of 'sequence' for better seeking
                    this.source_buffer.mode = 'segments';

                    this.source_buffer.addEventListener('updateend', () => {
                        this.process_append_to_buffer();
                    });

                    this.source_buffer.addEventListener('error', (error) => {
                        console.error('SourceBuffer error:', error);
                    });

                    this.is_media_source_attached = true;
                    console.log('✅ MediaSource initialized with blob URL:', this.blob_url);
                    console.log('   SourceBuffer mode:', this.source_buffer.mode);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    private create_hls_instance(): Hls {
        const hls = new Hls({
            debug: false,
            enableWorker: true,
            lowLatencyMode: false,
            autoStartLoad: false,
            
            // Buffer management
            // maxBufferLength: 30,
            // maxMaxBufferLength: 40,
            // backBufferLength: 20,
        });

        this.configure_hls_events(hls);
        return hls;
    }

    private configure_hls_events(hls: Hls) {
        if (!hls) return;

        hls.on(Events.MANIFEST_LOADING, (e, data) => {
            console.log('📄 Manifest loading:', data.url);
        });

        hls.on(Events.MANIFEST_LOADED, (e, data) => {
            console.log('✅ Manifest loaded');
            hls?.startLoad();
        });

        hls.on(Events.MANIFEST_PARSED, (e, data) => {
            console.log('✅ Manifest parsed:', data.levels?.length, 'levels');
        });

        hls.on(Events.MEDIA_DETACHING, () => {
            console.log('⚠️ Media detaching event fired');
        });

        hls.on(Events.MEDIA_ATTACHING, (e, data) => {
            // Verify we're reusing the same MediaSource
            const currentBlobUrl = this.audio_element?.src;
            console.log('🔗 Media attaching');
            console.log('   Original blob URL:', this.blob_url);
            console.log('   Current audio.src:', currentBlobUrl);
            console.log('   URLs match:', this.blob_url === currentBlobUrl);
        });

        hls.on(Events.BUFFER_APPENDING, (event, data) => {
            console.log('📦 Intercepting buffer append, fragment:', data.frag.sn);
            
            if (data.data && data.type === 'audio') {
                const uint_8_data = new Uint8Array(data.data);
                this.append_to_buffer(uint_8_data);
            }
        });

        hls.on(Events.ERROR, (event, data) => {
            console.error('❌ HLS Error:', data.details, 'fatal:', data.fatal);
            
            if (data.fatal) {
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        console.log('🔄 Network error, attempting recovery...');
                        hls.startLoad();
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        console.log('🔄 Media error, attempting recovery...');
                        hls.recoverMediaError();
                        break;
                    default:
                        console.error('💥 Unrecoverable error');
                        break;
                }
            }
        });
    }

    public async play(url: string) {
        if (!this.audio_element) throw new Error('Audio element not set.');
        
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🎵 Playing track: ${url}`);
        console.log(`   Is first track: ${this.is_first_track}`);
        console.log(`   Current blob URL: ${this.audio_element.src}`);
        console.log(`   Original blob URL: ${this.blob_url}`);
        console.log(`${'='.repeat(60)}\n`);

        if (this.is_first_track) {
            // ✅ FIRST TRACK: Normal initialization
            console.log('🆕 First track - creating new HLS instance');
            
            this.hls = this.create_hls_instance();
            
            // Attach with our pre-created MediaSource
            this.hls.attachMedia({
                media: this.audio_element,
                mediaSource: this.media_source,
                overrides: { endOfStream: false }
            });
            
            this.is_first_track = false;
            
        } else {
            // ✅ SUBSEQUENT TRACKS: Clear buffer and transfer MediaSource
            console.log('🔄 Subsequent track - clearing buffer and transferring MediaSource');
            
            if (!this.hls) {
                throw new Error('HLS instance not initialized');
            }

            // 🗑️ CLEAR THE BUFFER BEFORE SWITCHING TRACKS
            await this.clear_buffer();

            // CRITICAL: Get transfer data BEFORE detaching
            this.transfer_data = this.hls.transferMedia();
            
            if (!this.transfer_data || !this.transfer_data.mediaSource) {
                console.error('❌ Transfer data is invalid:', this.transfer_data);
                throw new Error('Failed to transfer MediaSource');
            }

            console.log('📦 Transfer data obtained:');
            console.log('   MediaSource:', this.transfer_data.mediaSource);
            console.log('   Tracks:', Object.keys(this.transfer_data.tracks || {}));
            console.log('   MediaSource readyState:', this.transfer_data.mediaSource.readyState);

            // Verify the MediaSource is the same instance
            const isSameMediaSource = this.transfer_data.mediaSource === this.media_source;
            console.log('   Same MediaSource instance:', isSameMediaSource);

            // Detach old HLS instance
            this.hls.detachMedia();
            
            // Destroy old instance
            this.hls.destroy();
            
            // Create new HLS instance
            const new_hls = this.create_hls_instance();
            
            // CRITICAL: Attach with the SAME MediaSource
            const attach_data: MediaAttachingData = {
                media: this.audio_element,
                mediaSource: this.transfer_data.mediaSource, // ✅ Reuse!
                tracks: this.transfer_data.tracks,            // ✅ Reuse SourceBuffers!
                overrides: { 
                    endOfStream: false  // Keep MediaSource open
                }
            };
            
            new_hls.attachMedia(attach_data);
            
            // Update reference
            this.hls = new_hls;
            
            console.log('✅ MediaSource transferred successfully');
            console.log('   New audio.src:', this.audio_element.src);
            console.log('   Blob URL unchanged:', this.audio_element.src === this.blob_url);
        }

        // Load new source
        this.hls.loadSource(url);
        
        // Play
        try {
            await this.audio_element.play();
            console.log('✅ Playback started successfully');
        } catch (error) {
            console.error('❌ Playback failed:', error);
            throw error;
        }
    }

    /**
     * Clear all buffered data from ALL SourceBuffers and reset state
     */
    private async clear_buffer(): Promise<void> {
        if (!this.media_source) {
            console.warn('⚠️ No MediaSource to clear');
            return;
        }

        console.log('🗑️ Clearing all SourceBuffers');

        const sourceBuffers = this.media_source.sourceBuffers;
        
        // Clear ALL SourceBuffers (not just our audio one)
        for (let i = 0; i < sourceBuffers.length; i++) {
            const sb = sourceBuffers[i];
            const buffered = sb.buffered;
            
            if (buffered.length === 0) {
                console.log(`   SourceBuffer ${i}: already empty`);
                continue;
            }

            console.log(`   SourceBuffer ${i}: clearing ${buffered.length} range(s), mode: ${sb.mode}`);

            try {
                // Wait if SourceBuffer is currently updating
                if (sb.updating) {
                    console.log(`   ⏳ Waiting for SourceBuffer ${i} to finish updating...`);
                    await new Promise<void>((resolve) => {
                        const onUpdateEnd = () => {
                            sb.removeEventListener('updateend', onUpdateEnd);
                            resolve();
                        };
                        sb.addEventListener('updateend', onUpdateEnd);
                    });
                }

                // Remove all buffered ranges
                for (let j = buffered.length - 1; j >= 0; j--) {
                    const start = buffered.start(j);
                    const end = buffered.end(j);
                    
                    console.log(`      Removing range ${j + 1}: ${start.toFixed(2)}s - ${end.toFixed(2)}s`);
                    
                    sb.remove(start, end);
                    
                    // Wait for removal to complete
                    await new Promise<void>((resolve) => {
                        const onUpdateEnd = () => {
                            sb.removeEventListener('updateend', onUpdateEnd);
                            resolve();
                        };
                        sb.addEventListener('updateend', onUpdateEnd);
                    });
                }

                // CRITICAL: Reset timestampOffset for new track
                sb.timestampOffset = 0;
            } catch (error) {
                console.error(`❌ Error clearing SourceBuffer ${i}:`, error);
            }
        }

        // CRITICAL: Reset MediaSource duration
        try {
            if (this.media_source.readyState === 'open') {
                const oldDuration = this.media_source.duration;
                console.log(`   Old duration: ${oldDuration.toFixed(2)}s`);
                
                // Reset duration to allow new track to set its own
                // Setting to NaN signals that duration should be recalculated
                this.media_source.duration = 0;
                console.log(`   ✅ Reset duration to 0`);
            }
        } catch (error) {
            console.error('❌ Error resetting duration:', error);
        }

        // Reset audio element current time
        if (this.audio_element) {
            this.audio_element.currentTime = 0;
        }
    }

    public pause() {
        if (!this.audio_element) throw new Error('Audio element not set.');
        this.audio_element.pause();
    }

    get is_playing(): boolean {
        if (!this.audio_element) return false;
        return !this.audio_element.paused;
    }

    get current_time(): number {
        return this.audio_element?.currentTime || 0;
    }

    set current_time(time: number) {
        if (this.audio_element) {
            console.log(`⏩ Seeking to ${time.toFixed(2)}s`);
            this.audio_element.currentTime = time;
            
            // Trigger HLS.js to load fragments at new position
            if (this.hls) {
                this.hls.startLoad(time);
            }
        }
    }

    get duration(): number {
        return this.audio_element?.duration || 0;
    }

    // Buffer queue management
    private append_to_buffer_queue: Uint8Array[] = [];
    private is_processing_queue: boolean = false;

    public add_to_buffer_queue(data: Uint8Array) {
        this.append_to_buffer_queue.push(data);
        this.process_append_to_buffer();
    }

    private async process_append_to_buffer() {
        if (this.is_processing_queue) return;

        if (!this.source_buffer) {
            console.error('SourceBuffer not initialized, cannot process queue.');
            return;
        }

        this.is_processing_queue = true;

        try {
            while (this.append_to_buffer_queue.length > 0) {
                const data = this.append_to_buffer_queue.shift();
                
                if (!data) break;

                try {
                    // Wait if SourceBuffer is updating
                    if (this.source_buffer.updating) {
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
                    console.log('✅ Appended', data.byteLength, 'bytes to SourceBuffer');

                } catch (error) {
                    console.error('Error appending to buffer:', error);
                    
                    if (error instanceof Error && error.name === 'QuotaExceededError') {
                        console.warn('⚠️ Buffer quota exceeded, removing old data');
                        
                        if (this.source_buffer.buffered.length > 0) {
                            const currentTime = this.audio_element.currentTime;
                            const removeEnd = Math.max(0, currentTime - 30);
                            
                            try {
                                this.source_buffer.remove(0, removeEnd);
                                console.log('🗑️ Removed buffer from 0 to', removeEnd);
                                
                                // Wait for remove to complete
                                await new Promise<void>((resolve) => {
                                    const onUpdateEnd = () => {
                                        this.source_buffer?.removeEventListener('updateend', onUpdateEnd);
                                        resolve();
                                    };
                                    this.source_buffer?.addEventListener('updateend', onUpdateEnd);
                                });
                                
                                // Re-add data to try again
                                this.append_to_buffer_queue.unshift(data);
                            } catch (removeError) {
                                console.error('Error removing buffer:', removeError);
                            }
                        }
                        break;
                    }
                }
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
            this.add_to_buffer_queue(data);
            return;
        }

        try {
            this.source_buffer.appendBuffer(data);
        } catch (error) {
            console.error('Error appending to buffer:', error);
            this.add_to_buffer_queue(data);
        }
    }

    public destroy() {
        console.log('🗑️ Destroying BufferController');
        
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }

        if (this.blob_url) {
            URL.revokeObjectURL(this.blob_url);
            this.blob_url = null;
        }

        if (this.audio_element) {
            this.audio_element.pause();
            this.audio_element.src = '';
        }

        this.is_media_source_attached = false;
        this.is_first_track = true;
        this.transfer_data = null;
    }

    /**
     * Get detailed buffer and MediaSource state info for debugging
     */
    public get_debug_info() {
        if (!this.media_source) {
            return { error: 'MediaSource not initialized' };
        }

        const sourceBuffers = [];
        for (let i = 0; i < this.media_source.sourceBuffers.length; i++) {
            const sb = this.media_source.sourceBuffers[i];
            const ranges = [];
            
            for (let j = 0; j < sb.buffered.length; j++) {
                ranges.push({
                    start: sb.buffered.start(j),
                    end: sb.buffered.end(j),
                    length: sb.buffered.end(j) - sb.buffered.start(j)
                });
            }

            sourceBuffers.push({
                index: i,
                mode: sb.mode,
                timestampOffset: sb.timestampOffset,
                updating: sb.updating,
                bufferedRanges: ranges,
                totalBuffered: ranges.reduce((sum, r) => sum + r.length, 0)
            });
        }

        return {
            mediaSource: {
                readyState: this.media_source.readyState,
                duration: this.media_source.duration,
                sourceBufferCount: this.media_source.sourceBuffers.length
            },
            audioElement: {
                src: this.audio_element?.src,
                currentTime: this.audio_element?.currentTime,
                duration: this.audio_element?.duration,
                paused: this.audio_element?.paused,
                readyState: this.audio_element?.readyState
            },
            sourceBuffers,
            blobUrl: this.blob_url,
            isFirstTrack: this.is_first_track
        };
    }

    public log_state() {
        const info = this.get_debug_info();
        console.log('📊 BufferController State:', JSON.stringify(info, null, 2));
    }
}

export default BufferController;