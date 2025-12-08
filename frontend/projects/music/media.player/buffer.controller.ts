import Hls from 'hls.js';
import { Events } from 'hls.js';
import type { MediaAttachingData } from 'hls.js';
import { SettingsService } from '../settings.service';
import MusicMediaManager from './media.manager';
import { set } from 'idb-keyval';

class BufferController {
    private audio_element: HTMLMediaElement;
    private media_source: MediaSource | null = null;
    private source_buffer: SourceBuffer | null = null;
    private hls: Hls | null = null;

    private is_media_source_attached: boolean = false;
    private transfer_data: any = null;
    private codec = 'audio/mp4; codecs="mp4a.40.2"';
    
    private blob_url: string | null = null;
    
    // Event target for custom events
    // public events: EventTarget = new EventTarget();
    public has_audio: boolean = false;
    public fully_buffered: boolean = false;
    public using_silent_source: boolean = false;

    get buffered_percent(): number {
        if (!this.audio_element || !this.media_source) return 0;
        try {
            const buffered = this.audio_element.buffered;
            const duration = this.audio_element.duration;
            if (duration === 0) return 0;

            let buffered_end = 0;
            for (let i = 0; i < buffered.length; i++) {
                if (buffered.end(i) > buffered_end) {
                    buffered_end = buffered.end(i);
                }
            }

            return (buffered_end / duration) * 100;
        } catch (error) {
            console.error('Error calculating buffered percent:', error);
            return 0;
        }
    }

    private get is_safari(): boolean {
        return this.settings.is_safari;
    }

    // public is_stalled(): boolean {
    //     return false;
    // }

    constructor(private settings: SettingsService, private controller: MusicMediaManager | null = null) {
        console.log('🌐 Browser:', this.is_safari ? 'Safari' : 'Chrome/Other');
    }

    public set_controller(controller: MusicMediaManager): void {
        this.controller = controller;
    }

    public set_audio_element(audio: HTMLMediaElement | HTMLAudioElement) {
        this.audio_element = audio;
        this.configure_audio_element();
    }

    private async configure_audio_element() {
        if (!this.audio_element) throw new Error('Audio element not set.');
        this.audio_element.preload = 'auto';
        this.audio_element.setAttribute('playsinline', 'true');
        this.audio_element.setAttribute('webkit-playsinline', 'true');
        
        // Safari needs these
        if (this.is_safari) {
            this.audio_element.setAttribute('controls', 'true');
        }

        // await this.initialize_media_source();
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
            const timeout = setTimeout(() => {
                reject(new Error('MediaSource sourceopen timeout after 10s'));
            }, 10000);

            this.media_source!.addEventListener('sourceopen', () => {
                clearTimeout(timeout);
                
                if (!this.media_source) {
                    reject(new Error('MediaSource is null on sourceopen event.'));
                    return;
                }

                try {
                    this.source_buffer = this.media_source.addSourceBuffer(this.codec);
                    
                    // Safari prefers segments mode
                    this.source_buffer.mode = 'segments';

                    this.source_buffer.addEventListener('updateend', () => {
                        this.process_append_to_buffer();
                    });

                    this.source_buffer.addEventListener('error', (error) => {
                        console.error('SourceBuffer error:', error);
                    });

                    this.is_media_source_attached = true;
                    console.log('✅ MediaSource initialized');
                    console.log('   SourceBuffer mode:', this.source_buffer.mode);
                    resolve();
                } catch (error) {
                    clearTimeout(timeout);
                    console.error('Error creating SourceBuffer:', error);
                    reject(error);
                }
            });
        });
    }

    private create_hls_instance(capture_events: boolean = false): Hls {
        const hls = new Hls({
            debug: false,
            // enableWorker: true,
            // lowLatencyMode: false,
            autoStartLoad: false,
            
            // Safari-friendly buffer settings
            // maxBufferLength: this.is_safari ? 20 : 30,
            // maxMaxBufferLength: this.is_safari ? 30 : 40,
            // backBufferLength: this.is_safari ? 10 : 20,
            // maxBufferHole: 0.5,
            
            // Safari needs more aggressive buffer management
            // nudgeMaxRetry: this.is_safari ? 5 : 3,
            // startPosition: 0,
            // startLevel: -1, // -1 = auto, will be set to highest after manifest loads
        });

        if (capture_events) this.configure_hls_events(hls);
        return hls;
    }

    private configure_hls_events(hls: Hls) {
        if (!hls) return;

        hls.on(Events.MANIFEST_LOADING, (e, data) => {});

        hls.on(Events.MANIFEST_LOADED, (e, data) => {
            hls?.startLoad(0);
        });

        // hls.on(Events.MANIFEST_PARSED, (e, data) => {
        //     console.log('✅ Manifest parsed:', data.levels?.length, 'levels');
        //     // Ensure we start at 0 after manifest is parsed
        //     if (this.audio_element && this.audio_element.currentTime !== 0) {
        //         console.log('⏮️ Resetting position to 0 after manifest parsed');
        //         this.audio_element.currentTime = 0;
        //     }

        //     if (hls.levels.length > 0) {
        //         const highestLevel = hls.levels.length - 1;
        //         console.log(`🎯 Setting start level to highest: ${highestLevel} (${hls.levels.length} levels available)`);
        //         hls.currentLevel = highestLevel;
        //     }
        // });

        // hls.on(Events.MEDIA_DETACHING, () => {
        //     console.log('⚠️ Media detaching event fired');
        // });

        // hls.on(Events.MEDIA_ATTACHING, (e, data) => {
        //     const currentBlobUrl = this.audio_element?.src;
        //     console.log('🔗 Media attaching');
        //     console.log('   URLs match:', this.blob_url === currentBlobUrl);
        // });

        hls.on(Events.BUFFER_APPENDING, (event, data) => {
            if(!this.has_audio) {
                this.has_audio = data.type === 'audio';
                this.controller?.on_has_audio();
                // Force position to 0 on first audio data
                if (this.audio_element && this.audio_element.currentTime > 0.5) {
                    this.audio_element.currentTime = 0;
                }
            }
            if(!this.using_silent_source) {
                this.has_audio = data.type === 'audio' || this.has_audio;
            } else if(this.current_url.indexOf('silent') === -1) {
                // non-silent source loaded, disable silent mode
                this.using_silent_source = false;
            }

            // console.log('📦 Buffer append, fragment:', data.frag.sn, 'type:', data.type);

            if (data.data && data.type === 'audio') {
                const uint_8_data = new Uint8Array(data.data);
                this.append_to_buffer(uint_8_data);
            }
        });

        hls.on(Events.BUFFERED_TO_END, async () => {
            // console.log('✅ Buffer has reached end of stream');
            // console.log(this.media_source.sourceBuffers);

            this.fully_buffered = true;
            // emit event
            // this.events.dispatchEvent(new Event('fully_buffered'));
            // this.controller?.on_fully_buffered();
        });

        hls.on(Events.ERROR, (event, data) => {
            console.error('HLS Error:', data.details, 'fatal:', data.fatal);

            if (data.details === 'bufferStalledError' && !data.fatal) {
                // Check if we're near the end of the track
                const current_time = this.audio_element?.currentTime || 0;
                const duration = this.audio_element?.duration || 0;
                
                // 3 second threshold
                if (duration > 0 && duration - current_time < 3) {

                    if(this.using_silent_source) {
                        this.current_time = 0; // Reset to start
                    }
                    console.log('✅ Song finished, emitting end event');
                    
                    // Emit song end event so your app can skip to next track
                    // const ev = new CustomEvent('song_ended', { 
                    //     detail: { 
                    //         current_time,
                    //         duration,
                    //         url: this.current_url
                    //     } 
                    // });
                    // this.events.dispatchEvent(ev);
                    // this.controller?.on_song_ended();
                }
            }
            
            if (data.fatal) {
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        console.log('🔄 Network error, attempting recovery...');
                        setTimeout(() => hls.startLoad(), 1000);
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

    private current_url: string = '';
    public async load_and_play(url: string, clear_buffer: boolean = true, force_start_time: boolean = true): Promise<void> {
        if (!this.audio_element) throw new Error('Audio element not set.');

        if(!this.using_silent_source) {
            if(clear_buffer) this.has_audio = false;
            this.fully_buffered = false;
        }

        if(this.controller.use_streaming_playlist) {
            await this.playlist_load(url);
        } else {
            await this.consistent_source_load(url, clear_buffer, force_start_time);
        }

        this.current_url = url;
    }

    private async playlist_load(url: string): Promise<void> {
        if (!this.audio_element) throw new Error('Audio element not set.');

        this.hls = this.create_hls_instance(true);
        this.hls.attachMedia(this.audio_element);
        this.hls.loadSource(url);
        this.hls.startLoad(0);

        // Handle errors and playlist refresh temp
        this.hls.on(Hls.Events.ERROR, (event, data) => {
            console.error('HLS.js error', data);
        });

        setInterval(() => {
            console.log('🔄 Refreshing playlist for URL:', this.current_url);
            this.reload_manifest();
        }, 10000);
    }

    private is_first_track: boolean = true;
    private async consistent_source_load(url: string, clear_buffer: boolean = true, force_start_time: boolean = true): Promise<void> {
        if (this.is_first_track) {
            // ✅ FIRST TRACK
            console.log('🆕 First track - creating new HLS instance');
            
            this.hls = this.create_hls_instance(true);
            
            this.hls.attachMedia({
                media: this.audio_element,
                mediaSource: this.media_source,
                overrides: { endOfStream: false }
            });
            
            this.is_first_track = false;
            
        } else {
            if (!this.hls) {
                throw new Error('HLS instance not initialized');
            }

            if (this.is_safari) {
                // Stop current loading
                this.hls.stopLoad();
                
                // Clear the buffer more gently for Safari
                if(clear_buffer) await this.safari_clear_buffer();
                
                // Don't create new HLS instance - reuse existing
                // Safari prefers keeping the same instance
                
            } else {
                // CHROME/OTHER: Use transfer approach

                if(clear_buffer) await this.clear_buffer();

                this.transfer_data = this.hls.transferMedia();
                
                if (!this.transfer_data || !this.transfer_data.mediaSource) {
                    console.warn('⚠️ Transfer failed, falling back to simple approach');
                    this.hls.stopLoad();
                } else {
                    this.hls.detachMedia();
                    this.hls.destroy();
                    
                    const new_hls = this.create_hls_instance();
                    
                    const attach_data: MediaAttachingData = {
                        media: this.audio_element,
                        mediaSource: this.transfer_data.mediaSource,
                        tracks: this.transfer_data.tracks,
                        overrides: { endOfStream: false }
                    };
                    
                    new_hls.attachMedia(attach_data);
                    this.hls = new_hls;
                }
            }
        }

        // Load new source
        this.hls.loadSource(url);
        this.hls.startLoad(0);

        // Force start at position 0 for cold starts
        if (this.audio_element && force_start_time) {
            this.audio_element.currentTime = 0;
        }
    }

    public async set_audio_source_to_silent(): Promise<void> {
        // return console.warn('⚠️ Silent source disabled temporarily');
        if(!this.is_safari) {
            this.pause();
            this.has_audio = false;
            return console.warn('⚠️ Silent source only needed for Safari, pausing instead'); // Silent source only needed for Safari
        }
        if(this.using_silent_source) return; // Already using silent source
        if (!this.audio_element) {
            console.warn('⚠️ Audio element not set for silent source');
            return;
        }
        this.using_silent_source = true;

        await this.load_and_play('/music/audio/silent/audio/master.m3u8');
    }

    /**
     * Safari-friendly buffer clearing (more conservative)
     */
    private async safari_clear_buffer(): Promise<void> {
        if (!this.media_source) return;

        console.log('🍎 Safari: Gentle buffer clear');

        const sourceBuffers = this.media_source.sourceBuffers;
        
        for (let i = 0; i < sourceBuffers.length; i++) {
            const sb = sourceBuffers[i];
            const buffered = sb.buffered;
            
            if (buffered.length === 0) continue;

            try {
                if (sb.updating) {
                    await new Promise<void>((resolve) => {
                        const onUpdateEnd = () => {
                            sb.removeEventListener('updateend', onUpdateEnd);
                            resolve();
                        };
                        sb.addEventListener('updateend', onUpdateEnd);
                    });
                }

                // Safari: Only clear old data, keep recent buffer
                const currentTime = this.audio_element.currentTime;
                
                for (let j = 0; j < buffered.length; j++) {
                    const start = buffered.start(j);
                    const end = buffered.end(j);
                    
                    // Only remove ranges that are well behind current time
                    if (end < currentTime - 5) {
                        console.log(`   Removing old range: ${start.toFixed(2)}s - ${end.toFixed(2)}s`);
                        sb.remove(start, end);
                        
                        await new Promise<void>((resolve) => {
                            const onUpdateEnd = () => {
                                sb.removeEventListener('updateend', onUpdateEnd);
                                resolve();
                            };
                            sb.addEventListener('updateend', onUpdateEnd);
                        });
                    }
                }

                // Don't reset timestampOffset in Safari
                // Safari handles this automatically

            } catch (error) {
                console.error(`❌ Safari buffer clear error:`, error);
                // Continue anyway
            }
        }

        console.log('✅ Safari buffer clear complete');
    }

    /**
     * Aggressive buffer clearing for Chrome/Firefox
     */
    private async clear_buffer(): Promise<void> {
        if (!this.media_source) {
            console.warn('⚠️ No MediaSource to clear');
            return;
        }

        console.log('🗑️ Clearing all SourceBuffers');

        const sourceBuffers = this.media_source.sourceBuffers;
        
        for (let i = 0; i < sourceBuffers.length; i++) {
            const sb = sourceBuffers[i];
            const buffered = sb.buffered;
            
            if (buffered.length === 0) {
                console.log(`   SourceBuffer ${i}: already empty`);
                continue;
            }

            console.log(`   SourceBuffer ${i}: clearing ${buffered.length} range(s)`);

            try {
                if (sb.updating) {
                    await new Promise<void>((resolve) => {
                        const onUpdateEnd = () => {
                            sb.removeEventListener('updateend', onUpdateEnd);
                            resolve();
                        };
                        sb.addEventListener('updateend', onUpdateEnd);
                    });
                }

                for (let j = buffered.length - 1; j >= 0; j--) {
                    const start = buffered.start(j);
                    const end = buffered.end(j);
                    
                    console.log(`      Removing range: ${start.toFixed(2)}s - ${end.toFixed(2)}s`);
                    
                    sb.remove(start, end);
                    
                    await new Promise<void>((resolve) => {
                        const onUpdateEnd = () => {
                            sb.removeEventListener('updateend', onUpdateEnd);
                            resolve();
                        };
                        sb.addEventListener('updateend', onUpdateEnd);
                    });
                }

                sb.timestampOffset = 0;

            } catch (error) {
                console.error(`❌ Error clearing SourceBuffer ${i}:`, error);
            }
        }

        try {
            if (this.media_source.readyState === 'open') {
                this.media_source.duration = 0;
            }
        } catch (error) {
            console.error('❌ Error resetting duration:', error);
        }

        if (this.audio_element) {
            this.audio_element.currentTime = 0;
        }

        console.log('✅ Buffer cleared');
    }

    public async slice_buffer(start: number, end: number): Promise<void> {
        if (!this.media_source) {
            return;
        }
        console.log(`✂️ Slicing buffer: keeping ${start.toFixed(2)}s to ${end === Infinity ? 'end' : end.toFixed(2) + 's'}`);
        const sourceBuffers = this.media_source.sourceBuffers;
        
        for (let i = 0; i < sourceBuffers.length; i++) {
            const sb = sourceBuffers[i];
            const buffered = sb.buffered;
            
            for (let j = 0; j < buffered.length; j++) {
                const range_start = buffered.start(j);
                const range_end = buffered.end(j);
                
                try {
                    // Wait if buffer is updating
                    if (sb.updating) {
                        await new Promise<void>((resolve) => {
                            const onUpdateEnd = () => {
                                sb.removeEventListener('updateend', onUpdateEnd);
                                resolve();
                            };
                            sb.addEventListener('updateend', onUpdateEnd);
                        });
                    }
                    
                    // Remove data BEFORE the start point
                    if (range_start < start && range_end > range_start) {
                        const remove_end = Math.min(range_end, start);
                        console.log(`   Removing before: ${range_start.toFixed(2)}s - ${remove_end.toFixed(2)}s`);
                        sb.remove(range_start, remove_end);
                        
                        await new Promise<void>((resolve) => {
                            const onUpdateEnd = () => {
                                sb.removeEventListener('updateend', onUpdateEnd);
                                resolve();
                            };
                            sb.addEventListener('updateend', onUpdateEnd);
                        });
                    }
                    
                    // Remove data AFTER the end point
                    if (end !== Infinity && range_end > end && range_start < range_end) {
                        const remove_start = Math.max(range_start, end);
                        console.log(`   Removing after: ${remove_start.toFixed(2)}s - ${range_end.toFixed(2)}s`);
                        sb.remove(remove_start, range_end);
                        
                        await new Promise<void>((resolve) => {
                            const onUpdateEnd = () => {
                                sb.removeEventListener('updateend', onUpdateEnd);
                                resolve();
                            };
                            sb.addEventListener('updateend', onUpdateEnd);
                        });
                    }
                } catch (error) {
                    console.error(`❌ Error slicing buffer:`, error);
                }
            }
        }
        console.log('✅ Buffer slice complete');
    }

    public async play(): Promise<void> {
        if (!this.audio_element) throw new Error('Audio element not set.');
        try {
            await this.audio_element.play();
            console.log('✅ Playback started successfully');
        } catch (error) {
            console.error('Playback failed:', error);
            
            // Safari sometimes needs a delay
            if (this.is_safari) {
                this.safari_play();
            } else {
                console.error('Playback failed:', error);
            }
        }
    }

    public async safari_play(timeout: number = 5000, delay: number = 500): Promise<void> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            try {
                await this.audio_element.play();
                return;
            } catch (error) {
                console.error('Playback failed:', error);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw new Error('Playback failed after timeout');
    }

    public pause(): void {
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
            
            if (this.hls) {
                this.hls.startLoad(time, true);
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
            console.error('SourceBuffer not initialized');
            return;
        }

        this.is_processing_queue = true;

        try {
            while (this.append_to_buffer_queue.length > 0) {
                const data = this.append_to_buffer_queue.shift();
                if (!data) break;

                try {
                    if (this.source_buffer.updating) {
                        await new Promise<void>((resolve) => {
                            const onUpdateEnd = () => {
                                this.source_buffer?.removeEventListener('updateend', onUpdateEnd);
                                resolve();
                            };
                            this.source_buffer?.addEventListener('updateend', onUpdateEnd);
                        });
                    }

                    this.source_buffer.appendBuffer(data);
                    // console.log('✅ Appended', data.byteLength, 'bytes');

                } catch (error) {
                    console.error('Error appending to buffer:', error);
                    
                    if (error instanceof Error && error.name === 'QuotaExceededError') {
                        console.warn('⚠️ Buffer quota exceeded');
                        
                        if (this.source_buffer.buffered.length > 0) {
                            const currentTime = this.audio_element.currentTime;
                            const removeEnd = Math.max(0, currentTime - 30);
                            
                            try {
                                this.source_buffer.remove(0, removeEnd);
                                
                                await new Promise<void>((resolve) => {
                                    const onUpdateEnd = () => {
                                        this.source_buffer?.removeEventListener('updateend', onUpdateEnd);
                                        resolve();
                                    };
                                    this.source_buffer?.addEventListener('updateend', onUpdateEnd);
                                });
                                
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
            console.error('Fatal error processing buffer:', error);
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

    /**
     * Manually trigger HLS.js to refetch the playlist/manifest.
     * Useful when the server has updated the playlist with new segments.
     * This is a lightweight refresh that doesn't interrupt playback.
     */
    public refresh_playlist(): void {
        if (!this.hls) {
            console.warn('⚠️ No HLS instance to refresh');
            return;
        }
        
        console.log('🔄 Manually refreshing playlist...');
        
        // For EVENT/LIVE playlists, clear the level details to trigger a refetch
        // HLS.js will reload the playlist when it needs the next segment
        const currentLevel = this.hls.currentLevel;
        if (currentLevel >= 0 && this.hls.levels && this.hls.levels[currentLevel]) {
            const level = this.hls.levels[currentLevel];
            const details = level.details;
            
            // Only refresh if this is a live/event playlist (no ENDLIST)
            if (details && details.live) {
                // Mark the playlist as needing refresh by clearing the advanced flag
                // This causes HLS.js to refetch sooner
                (details as any).updated = false;
                (details as any).advanced = false;
                console.log('🔄 Marked playlist for refresh');
            } else {
                // For VOD playlists, we need to clear details entirely
                (level as any).details = undefined;
                console.log('🔄 Cleared playlist details for refetch');
            }
        }
    }

    /**
     * Force HLS.js to reload the playlist without disrupting playback.
     * This clears the cached playlist details so HLS.js refetches on next segment request.
     */
    public async reload_manifest(): Promise<void> {
        if (!this.hls) {
            console.warn('⚠️ No HLS instance to reload');
            return;
        }
        
        const currentTime = this.audio_element?.currentTime ?? 0;
        console.log('🔄 Reloading playlist, preserving position:', currentTime);
        
        // Clear level details to force a playlist refetch
        // This is the non-disruptive approach - HLS.js will reload the playlist
        // on the next segment request without resetting playback state
        const currentLevel = this.hls.currentLevel;
        if (currentLevel >= 0 && this.hls.levels && this.hls.levels[currentLevel]) {
            // Clear the details to force a reload
            const level = this.hls.levels[currentLevel];
            (level as any).details = undefined;
            console.log('🔄 Cleared level details, triggering reload...');
        }
        
        // Stop and restart loading at current position
        // This triggers playlist reload while maintaining playback position
        this.hls.stopLoad();
        
        // Small delay to ensure clean state
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Restart loading at current position - this will refetch the playlist
        // The second parameter (true) skips seeking to start position
        this.hls.startLoad(currentTime, true);
    }

    /**
     * Release audio session without fully destroying.
     * Call this on pagehide/beforeunload to prevent stale audio state.
     */
    public release(): void {
        console.log('🔓 Releasing audio session');
        
        // Stop HLS loading but don't destroy
        if (this.hls) {
            this.hls.stopLoad();
        }
        
        // Pause and reset audio element
        if (this.audio_element) {
            this.audio_element.pause();
            this.audio_element.currentTime = 0;
        }
        
        // Reset state flags so next play reinitializes properly
        this.has_audio = false;
        this.fully_buffered = false;
        this.using_silent_source = false;
    }

    /**
     * Reinitialize after returning from background/closed state.
     * Call this on pageshow if audio was playing before.
     */
    public async reinitialize(): Promise<void> {
        console.log('🔄 Reinitializing audio session');
        
        // If HLS exists but media is detached, we need to reattach
        if (this.hls && this.audio_element && this.media_source) {
            // Check if media source is still valid
            if (this.media_source.readyState === 'closed') {
                console.log('   MediaSource closed, need full reinit');
                this.is_first_track = true;
                this.is_media_source_attached = false;
                await this.initialize_media_source();
            }
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
            browser: this.is_safari ? 'Safari' : 'Chrome/Other',
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