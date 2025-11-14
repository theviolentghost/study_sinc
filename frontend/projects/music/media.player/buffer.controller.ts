import Hls, { MediaAttachingData } from 'hls.js';
import { Events } from 'hls.js';

import AudioMixer from './media.mixer';
import FragmentParser from './fragment.parser';

class BufferController {
    private audio_element: HTMLMediaElement | HTMLAudioElement;
    private media_source: MediaSource | null = null;
    private source_buffer: SourceBuffer | null = null;
    private audio_mixer: AudioMixer | null = null;
    private fragment_parser: FragmentParser | null = null;
    private hls: Hls | null = null;

    private is_media_source_attached: boolean = false;
    private is_first_track: boolean = true;
    private transfer_data: any = null;
    private codec = 'audio/mp4; codecs="mp4a.40.2"';
    // private codec = 'audio/mpeg';
    
    private blob_url: string | null = null;
    private is_safari: boolean = false;
    private _songEndedEmitted: boolean = false;
    public _is_fully_buffered: boolean = false;

    private _has_audio: boolean = false;
    public get has_audio(): boolean {
        return this._has_audio;
    }
    public set has_audio(value: boolean) {
        this._has_audio = value;
    }
    public get is_fully_buffered(): boolean {
        return this._is_fully_buffered;
    }

    public readonly events: EventTarget = new EventTarget();

    get element(): HTMLMediaElement {
        return this.audio_element;
    }

    get buffered_percent(): number {
        if (!this.source_buffer || !this.audio_element) return 0;
        return 0;
        const buffered = this.source_buffer?.buffered;
        const duration = this.audio_element?.duration;
        if (duration === 0) return 0;
        if(!buffered || buffered.length === 0) return 0;

        let buffered_end = 0;
        for (let i = 0; i < buffered.length; i++) {
            if (this.audio_element.currentTime >= buffered.start(i) && this.audio_element.currentTime <= buffered.end(i)) {
                buffered_end = buffered.end(i);
                break;
            }
        }

        return Math.min(100, (buffered_end / duration) * 100);
    }

    constructor() {
        this.fragment_parser = new FragmentParser();
        const audio_context = this.fragment_parser.get_context();
        this.audio_mixer = new AudioMixer(audio_context, audio_context.sampleRate);

        this.is_safari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        console.log('🌐 Browser:', this.is_safari ? 'Safari' : 'Chrome/Other');
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
        
        // Detect when playback reaches the end
        // this.audio_element.addEventListener('timeupdate', () => {
        //     const currentTime = this.audio_element?.currentTime || 0;
        //     const duration = this.audio_element?.duration || 0;
            
        //     // Trigger auto-skip when within 0.5 seconds of the end
        //     if (duration > 0 && duration - currentTime < 0.5 && duration - currentTime > 0) {
        //         if (!this._songEndedEmitted) {
        //             this._songEndedEmitted = true;
                    
        //             console.log('🎵 Song reached end via timeupdate');
        //             const ev = new CustomEvent('songEnded', { 
        //                 detail: { 
        //                     currentTime,
        //                     duration,
        //                     url: this.current_url,
        //                     reason: 'timeupdate'
        //                 } 
        //             });
        //             this.events.dispatchEvent(ev);
        //         }
        //     }
        // });
        
        // Safari needs these
        // if (this.is_safari) {
        //     this.audio_element.setAttribute('controls', 'false');
        // }

        await this.initialize_media_source();
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

        // await new Promise<void>((resolve, reject) => {
        //     const timeout = setTimeout(() => {
        //         reject(new Error('MediaSource sourceopen timeout after 10s'));
        //     }, 10000);

        //     this.media_source!.addEventListener('sourceopen', () => {
        //         clearTimeout(timeout);
                
        //         if (!this.media_source) {
        //             reject(new Error('MediaSource is null on sourceopen event.'));
        //             return;
        //         }

        //         try {
        //             this.source_buffer = this.media_source.addSourceBuffer(this.codec);
                    
        //             // Safari prefers segments mode
        //             this.source_buffer.mode = 'segments';

        //             this.source_buffer.addEventListener('updateend', () => {
        //                 this.process_append_to_buffer();
        //             });

        //             this.source_buffer.addEventListener('error', (error) => {
        //                 console.error('SourceBuffer error:', error);
        //             });

        //             this.is_media_source_attached = true;
        //             console.log('✅ MediaSource initialized');
        //             console.log('   SourceBuffer mode:', this.source_buffer.mode);
        //             resolve();
        //         } catch (error) {
        //             clearTimeout(timeout);
        //             console.error('Error creating SourceBuffer:', error);
        //             reject(error);
        //         }
        //     });
        // });
    }

    private create_hls_instance(): Hls {
        const hls = new Hls({
            debug: false,
            enableWorker: true,
            lowLatencyMode: false,
            autoStartLoad: true,
            // maxBufferLength: 30,
            // maxMaxBufferLength: 60,
        
            
            // Ensure we start from the first segment
            // startPosition: 0,
            // startLevel: -1,
            
            // maxBufferHole: 0.5,
            // nudgeMaxRetry: this.is_safari ? 5 : 3,
            // manifestLoadingMaxRetry: 5,
            // manifestLoadingRetryDelay: 200,
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
            // Force start from beginning (segment 0) to prevent skipping to sn=2
            hls?.startLoad(0);
        });

        hls.on(Events.MANIFEST_PARSED, (e, data) => {
            console.log('✅ Manifest parsed:', data.levels?.length, 'levels');
        });

        hls.on(Events.MEDIA_DETACHING, () => {
            console.log('⚠️ Media detaching event fired');
        });

        hls.on(Events.MEDIA_ATTACHING, (e, data) => {
            const currentBlobUrl = this.audio_element?.src;
            console.log('🔗 Media attaching');
            console.log('   URLs match:', this.blob_url === currentBlobUrl);
        });

        hls.on(Events.BUFFER_APPENDING, async (event, data) => {
            // if( this.mixed_fragment ) {
            //     // this.append_to_buffer(this.mixed_fragment);
            //     console.log(' stopped appending original fragments due to mixed fragment presence');
            //     return;
            // }
            
            
            if (data.data && data.type === 'audio') {
                this.has_audio = true;
                // console.log('📦 Buffer append, fragment:', data.frag.sn, 'type:', data.type);
                // const uint_8_data = new Uint8Array(data.data);
                // this.append_to_buffer(uint_8_data);

                // console.log(this.fragment_parser.validate_mp4_data(uint_8_data) ? '✅ Fragment MP4 data is valid' : '❌ Fragment MP4 data is invalid');
                // console.log(this.fragment_parser.analyze_mp4_structure(uint_8_data, `Fragment SN ${data.frag.sn}`));

                // Emit event with raw audio fragment data
                // const ev = new CustomEvent('dataLoaded', { 
                //     detail: { 
                //         bytes: uint_8_data.byteLength,
                //         fragmentData: uint_8_data,
                //         fragmentNumber: data.frag.sn
                //     } 
                // });
                // this.events.dispatchEvent(ev);
                // this.fragment_parser.decode_audio_fragment(uint_8_data, data.frag.sn);
            }
        });

        hls.on(Events.BUFFERED_TO_END, async () => {
            console.log('✅ Buffer has reached end of stream');
            console.log(this.media_source.sourceBuffers);

            this._is_fully_buffered = true;
            
            // Emit song end event when buffering completes
            // const ev = new CustomEvent('songEnded', { 
            //     detail: { 
            //         currentTime: this.audio_element?.currentTime || 0,
            //         duration: this.audio_element?.duration || 0,
            //         url: this.current_url,
            //         reason: 'buffered_to_end'
            //     } 
            // });
            // this.events.dispatchEvent(ev);

            // const decoded_buffer = await this.fragment_parser.get_song_decoded_buffer();
            // console.log(decoded_buffer);
            // this.fragment_parser.store_decoded_song_buffer(this.current_url || '', decoded_buffer);
            // this.fragment_parser.clear_decoded_buffers();
            // const stored_keys = this.fragment_parser.get_all_stored_decoded_song_keys();
            // console.log('✅ Stored decoded song keys:', stored_keys);
            // if(stored_keys.length >= 2) {
            //     const mixed_buffer = this.audio_mixer.mix_audio_buffers_chunked(
            //         stored_keys.map(key => this.fragment_parser.get_stored_decoded_song_buffer(key))
            //             .filter(buf => buf !== null) as AudioBuffer[]
            //     );

            //     console.log('mixed buffer:', mixed_buffer);
            //     console.log('encoding mixed buffer to mp4...');
            //     // let mixed_buffer_wav = await this.audio_mixer.encode_to_wav(mixed_buffer);
            //     let mixed_buffer_wav = await this.fragment_parser.encode_to_mp4(mixed_buffer);
            //     console.log('Mixed buffer WAV:', mixed_buffer_wav);
            //     console.log(this.fragment_parser.validate_mp4_data(mixed_buffer_wav) ? '✅ Mixed MP4 data is valid' : '❌ Mixed MP4 data is invalid');
            //     console.log(this.fragment_parser.analyze_mp4_structure(mixed_buffer_wav, 'Mixed Buffer'));
            // }
        });

        hls.on(Events.BUFFER_EOS , async () => {
            console.log('🔚 Buffer end of stream reached');

            return;
        });

        hls.on(Events.FRAG_PARSING_INIT_SEGMENT, (event, data) => {
            console.log('📋 Init segment received');
            // @ts-ignore
            this.fragment_parser.set_initialization_segment(data?.tracks?.audio?.initSegment);
        });



        hls.on(Events.ERROR, (event, data) => {
            console.error('HLS Error:', data.details, 'fatal:', data.fatal);
            
            // Detect end of stream via bufferStalledError
            if (data.details === 'bufferStalledError' && !data.fatal) {
                console.log('🎵 Song appears to have ended (buffer stalled)');
                
                // Check if we're near the end of the track
                const currentTime = this.audio_element?.currentTime || 0;
                const duration = this.audio_element?.duration || 0;
                
                if (duration > 0 && duration - currentTime < 1) {
                    console.log('✅ Song finished, emitting end event');
                    
                    // Emit song end event so your app can skip to next track
                    const ev = new CustomEvent('songEnded', { 
                        detail: { 
                            currentTime,
                            duration,
                            url: this.current_url
                        } 
                    });
                    this.events.dispatchEvent(ev);
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

    public current_url: string | null = null;
    public async load(url: string) {
        if (!this.audio_element) throw new Error('Audio element not set.');
        
        this.has_audio = false;
        this._is_fully_buffered = false;
        this.current_url = url;

        if (this.is_first_track) {
            // ✅ FIRST TRACK - Create HLS and attach to MediaSource
            console.log('🆕 First track - creating new HLS instance');
            
            this.hls = this.create_hls_instance();
            
            this.hls.attachMedia({
                media: this.audio_element,
                mediaSource: this.media_source,
                overrides: { endOfStream: false }
            });
            
            this.is_first_track = false;
            
        } else {
            // ✅ SUBSEQUENT TRACKS - Keep same MediaSource, transfer to new HLS
            console.log('🔄 Subsequent track - using persistent MediaSource approach');
            
            if (!this.hls) {
                throw new Error('HLS instance not initialized');
            }

            // Stop current loading first
            console.log('   Stopping current HLS load...');
            this.hls.stopLoad();

            // Wait a brief moment for HLS to stop cleanly
            await new Promise(resolve => setTimeout(resolve, 50));

            // Clear all buffered data but keep MediaSource alive
            console.log('   Clearing old buffered data...');
            await this.clear_all_buffered_data();

            // Transfer the MediaSource to reuse it
            console.log('   Transferring MediaSource...');
            this.transfer_data = this.hls.transferMedia();
            
            if (!this.transfer_data || !this.transfer_data.mediaSource) {
                console.error('⚠️ Transfer failed - MediaSource may be invalid');
                console.log('   MediaSource state:', this.media_source?.readyState);
                throw new Error('Failed to transfer MediaSource - cannot continue');
            }

            console.log('   Transfer successful:');
            console.log('     - Same MediaSource:', this.transfer_data.mediaSource === this.media_source);
            console.log('     - MediaSource state:', this.transfer_data.mediaSource.readyState);
            console.log('     - SourceBuffers:', this.transfer_data.mediaSource.sourceBuffers.length);

            // Detach and destroy old HLS instance
            this.hls.detachMedia();
            this.hls.destroy();
            
            // Create new HLS instance
            const new_hls = this.create_hls_instance();
            
            // Attach with the transferred MediaSource and tracks
            const attach_data: MediaAttachingData = {
                media: this.audio_element,
                mediaSource: this.transfer_data.mediaSource,
                tracks: this.transfer_data.tracks,
                overrides: { endOfStream: false }
            };
            
            new_hls.attachMedia(attach_data);
            this.hls = new_hls;
            
            console.log('✅ New HLS instance attached to existing MediaSource');
        }

        // Load new source and start playback
        console.log('🎵 Loading new source:', url);
        this.hls.loadSource(url);
        this.hls.startLoad(0);

        // Reset playback position
        this.audio_element.currentTime = 0;
        
        console.log('✅ Load complete, HLS should start buffering...');
    }

    

    public async load_blob(blob_url: string) {
        
    }

    private async append_blob_data(data: Uint8Array): Promise<void> {
        
    }

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

                const currentTime = this.audio_element.currentTime;
                
                for (let j = 0; j < buffered.length; j++) {
                    const start = buffered.start(j);
                    const end = buffered.end(j);
                    
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

                this._has_audio = false;

            } catch (error) {
                console.error(`❌ Safari buffer clear error:`, error);
            }
        }

        console.log('✅ Safari buffer clear complete');
    }

    /**
     * Remove buffered audio data that's 10-20 seconds behind current playback position.
     * This helps manage memory and prevents buffer overflow.
     * 
     * @param behindRange - Time range in seconds behind current position to remove [min, max]. Default: [10, 20]
     * @returns Promise that resolves when cleanup is complete
     */
    public async cleanup_old_buffer(behindRange: [number, number] = [10, 20]): Promise<void> {
        if (!this.media_source || !this.audio_element) {
            console.warn('⚠️ No MediaSource or audio element available for buffer cleanup');
            return;
        }

        console.log('🧹 Starting buffer cleanup process');

        const currentTime = this.audio_element.currentTime;
        const [minBehind, maxBehind] = behindRange;

        if (currentTime < maxBehind) {
            // Not enough playback yet to have old data to remove
            return;
        }

        console.log(`🧹 Cleaning up buffer data ${minBehind}-${maxBehind}s behind current position (${currentTime.toFixed(2)}s)`);

        const sourceBuffers = this.media_source.sourceBuffers;
        let totalRemoved = 0;

        for (let i = 0; i < sourceBuffers.length; i++) {
            const sb = sourceBuffers[i];
            const buffered = sb.buffered;

            console.log(`   SourceBuffer ${i}: ${buffered.length} buffered range(s)`);

            if (buffered.length === 0) continue;

            try {
                // Wait for any pending updates
                if (sb.updating) {
                    await new Promise<void>((resolve) => {
                        const onUpdateEnd = () => {
                            sb.removeEventListener('updateend', onUpdateEnd);
                            resolve();
                        };
                        sb.addEventListener('updateend', onUpdateEnd);
                    });
                }

                // Check if MediaSource is still valid
                if (!this.media_source || this.media_source.sourceBuffers.length === 0) {
                    console.warn('⚠️ MediaSource became invalid during cleanup');
                    break;
                }

                // Calculate the removal range
                const removeStart = Math.max(0, currentTime - maxBehind);
                const removeEnd = Math.max(0, currentTime - minBehind);

                console.log(`   Removal range: ${removeStart.toFixed(2)}s - ${removeEnd.toFixed(2)}s`);

                // Find buffered ranges that overlap with our removal zone
                for (let j = 0; j < buffered.length; j++) {
                    const bufferStart = buffered.start(j);
                    const bufferEnd = buffered.end(j);

                    console.log(`   Buffered range ${j}: ${bufferStart.toFixed(2)}s - ${bufferEnd.toFixed(2)}s`);

                    // Check if this buffered range overlaps with our removal range
                    // The range overlaps if: bufferStart < removeEnd AND bufferEnd > removeStart
                    const overlaps = bufferStart < removeEnd && bufferEnd > removeStart;
                    
                    if (overlaps) {
                        // Calculate the actual portion to remove (intersection of buffer and removal ranges)
                        const actualRemoveStart = Math.max(bufferStart, removeStart);
                        const actualRemoveEnd = Math.min(bufferEnd, removeEnd);

                        if (actualRemoveStart < actualRemoveEnd) {
                            console.log(`   ✂️  Removing buffer ${i}, range ${j}: ${actualRemoveStart.toFixed(2)}s - ${actualRemoveEnd.toFixed(2)}s (${(actualRemoveEnd - actualRemoveStart).toFixed(2)}s)`);
                            
                            sb.remove(actualRemoveStart, actualRemoveEnd);
                            totalRemoved += (actualRemoveEnd - actualRemoveStart);

                            // Wait for removal to complete
                            await new Promise<void>((resolve) => {
                                const onUpdateEnd = () => {
                                    sb.removeEventListener('updateend', onUpdateEnd);
                                    resolve();
                                };
                                sb.addEventListener('updateend', onUpdateEnd);
                            });

                            // Check again if MediaSource is still valid
                            if (!this.media_source || this.media_source.sourceBuffers.length === 0) {
                                console.warn('⚠️ MediaSource became invalid during removal');
                                return;
                            }
                        }
                    }
                }

            } catch (error) {
                console.error(`❌ Error cleaning up buffer ${i}:`, error);
                // Continue with other buffers even if one fails
            }
        }

        if (totalRemoved > 0) {
            console.log(`✅ Buffer cleanup complete: removed ${totalRemoved.toFixed(2)}s of old data`);
        } else {
            console.log('✅ Buffer cleanup complete: no old data to remove');
        }
    }

    /**
     * Clear ALL buffered data from all source buffers.
     * Unlike cleanup_old_buffer which removes data in a specific range,
     * this removes everything that's currently buffered.
     * 
     * Useful when you want to completely reset the buffer state without
     * switching to a new track.
     * 
     * @returns Promise that resolves when all data is cleared
     */
    public async clear_all_buffered_data(): Promise<void> {
        if (!this.media_source || !this.audio_element) {
            console.warn('⚠️ No MediaSource or audio element available for buffer clearing');
            return;
        }

        console.log('🗑️ Clearing ALL buffered data from all source buffers');

        const sourceBuffers = this.media_source.sourceBuffers;
        let totalRemoved = 0;

        for (let i = 0; i < sourceBuffers.length; i++) {
            const sb = sourceBuffers[i];
            const buffered = sb.buffered;

            if (buffered.length === 0) {
                console.log(`   SourceBuffer ${i}: already empty`);
                continue;
            }

            console.log(`   SourceBuffer ${i}: ${buffered.length} buffered range(s) to clear`);

            try {
                // Wait for any pending updates
                if (sb.updating) {
                    await new Promise<void>((resolve) => {
                        const onUpdateEnd = () => {
                            sb.removeEventListener('updateend', onUpdateEnd);
                            resolve();
                        };
                        sb.addEventListener('updateend', onUpdateEnd);
                    });
                }

                // Check if MediaSource is still valid
                if (!this.media_source || this.media_source.sourceBuffers.length === 0) {
                    console.warn('⚠️ MediaSource became invalid during clearing');
                    break;
                }

                // If MediaSource ended, reopen it before removing
                if (this.media_source.readyState === 'ended') {
                    console.log('   MediaSource was ended, setting duration to Infinity to reopen');
                    try {
                        this.media_source.duration = Infinity;
                    } catch (error) {
                        console.warn('   Could not reopen MediaSource:', error);
                    }
                }

                // Remove all buffered ranges (iterate backwards to avoid index issues)
                for (let j = buffered.length - 1; j >= 0; j--) {
                    const bufferStart = buffered.start(j);
                    const bufferEnd = buffered.end(j);
                    const rangeSize = bufferEnd - bufferStart;

                    console.log(`   ✂️  Removing buffer ${i}, range ${j}: ${bufferStart.toFixed(2)}s - ${bufferEnd.toFixed(2)}s (${rangeSize.toFixed(2)}s)`);
                    
                    sb.remove(bufferStart, bufferEnd);
                    totalRemoved += rangeSize;

                    // Wait for removal to complete
                    await new Promise<void>((resolve) => {
                        const onUpdateEnd = () => {
                            sb.removeEventListener('updateend', onUpdateEnd);
                            resolve();
                        };
                        sb.addEventListener('updateend', onUpdateEnd);
                    });

                    // Check again if MediaSource is still valid after each removal
                    if (!this.media_source || this.media_source.sourceBuffers.length === 0) {
                        console.warn('⚠️ MediaSource became invalid during removal');
                        return;
                    }
                }

                // Reset timestamp offset after clearing
                sb.timestampOffset = 0;

            } catch (error) {
                console.error(`❌ Error clearing buffer ${i}:`, error);
                // Continue with other buffers even if one fails
            }
        }

        // Optionally reset the audio element position
        // Uncomment if you want to reset playback position when clearing all data
        // if (this.audio_element) {
        //     this.audio_element.currentTime = 0;
        // }

        if (totalRemoved > 0) {
            console.log(`✅ All buffered data cleared: removed ${totalRemoved.toFixed(2)}s total`);
        } else {
            console.log('✅ Buffer clear complete: no data was buffered');
        }
    }

    private async clear_buffer(): Promise<void> {
        if (!this.media_source) {
            console.warn('⚠️ No MediaSource to clear');
            return;
        }

        console.log('🗑️ Clearing all SourceBuffers');
        
        // Reopen if ended
        if (this.media_source.readyState === 'ended') {
            console.log('   MediaSource is ended, reopening...');
            this.media_source.duration = 0;
        }

        const sourceBuffers = this.media_source.sourceBuffers;
        this._has_audio = false;
        
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

        // Reset duration after clearing
        try {
            if (this.media_source.readyState === 'open') {
                this.media_source.duration = 0;
            }
        } catch (error) {
            console.error('Error resetting duration:', error);
        }

        if (this.audio_element) {
            this.audio_element.currentTime = 0;
        }
        
        console.log('✅ Buffer cleared, MediaSource state:', this.media_source.readyState);
    }

    public play() {
        if (!this.audio_element) throw new Error('Audio element not set.');
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

    get is_stalled(): boolean {
        if (!this.audio_element) return false;
        return this.audio_element.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
    }

    get current_time(): number {
        return this.audio_element?.currentTime || 0;
    }

    set current_time(time: number) {
        if (this.audio_element) {
            console.log(`Seeking to ${time.toFixed(2)}s`);
            this.audio_element.currentTime = time;
            
            if (this.hls) {
                // Ensure we start loading from the exact seek position
                this.hls.startLoad(time);
            }
        }
    }

    get duration(): number {
        return this.audio_element?.duration || 0;
    }

    // private append_to_buffer_queue: Uint8Array[] = [];
    // private is_processing_queue: boolean = false;

    // public add_to_buffer_queue(data: Uint8Array) {
    //     this.append_to_buffer_queue.push(data);
    //     this.process_append_to_buffer();
    // }

    // private async process_append_to_buffer() {
    //     if (this.is_processing_queue) return;

    //     if (!this.source_buffer) {
    //         console.error('SourceBuffer not initialized');
    //         return;
    //     }

    //     this.is_processing_queue = true;

    //     try {
    //         while (this.append_to_buffer_queue.length > 0) {
    //             const data = this.append_to_buffer_queue.shift();
    //             if (!data) break;

    //             try {
    //                 if (!this.source_buffer || !this.media_source || this.media_source.sourceBuffers.length === 0) {
    //                     console.warn('⚠️ SourceBuffer removed, discarding queued data');
    //                     this.append_to_buffer_queue = [];
    //                     break;
    //                 }

    //                 if (this.source_buffer.updating) {
    //                     await new Promise<void>((resolve) => {
    //                         const onUpdateEnd = () => {
    //                             this.source_buffer?.removeEventListener('updateend', onUpdateEnd);
    //                             resolve();
    //                         };
    //                         this.source_buffer?.addEventListener('updateend', onUpdateEnd);
    //                     });
    //                 }

    //                 if (!this.source_buffer || !this.media_source || this.media_source.sourceBuffers.length === 0) {
    //                     console.warn('⚠️ SourceBuffer removed during wait, discarding data');
    //                     this.append_to_buffer_queue = [];
    //                     break;
    //                 }

    //                 this.source_buffer.appendBuffer(data);

    //             } catch (error) {
    //                 console.error('Error appending to buffer:', error);
                    
    //                 if (error instanceof Error && error.name === 'QuotaExceededError') {
    //                     console.warn('⚠️ Buffer quota exceeded');
                        
    //                     if (this.source_buffer.buffered.length > 0) {
    //                         const currentTime = this.audio_element.currentTime;
    //                         const removeEnd = Math.max(0, currentTime - 30);
                            
    //                         try {
    //                             this.source_buffer.remove(0, removeEnd);
                                
    //                             await new Promise<void>((resolve) => {
    //                                 const onUpdateEnd = () => {
    //                                     this.source_buffer?.removeEventListener('updateend', onUpdateEnd);
    //                                     resolve();
    //                                 };
    //                                 this.source_buffer?.addEventListener('updateend', onUpdateEnd);
    //                             });
                                
    //                             this.append_to_buffer_queue.unshift(data);
    //                         } catch (removeError) {
    //                             console.error('Error removing buffer:', removeError);
    //                         }
    //                     }
    //                     break;
    //                 }
    //             }
    //         }
    //     } catch (error) {
    //         console.error('Fatal error processing buffer:', error);
    //     } finally {
    //         this.is_processing_queue = false;
    //     }
    // }

    // private async append_to_buffer(data: Uint8Array) {
    //     if (!this.source_buffer) {
    //         throw new Error('SourceBuffer not initialized');
    //     }

    //     if (!this.media_source || this.media_source.sourceBuffers.length === 0) {
    //         console.warn('⚠️ SourceBuffer has been removed from MediaSource, discarding data');
    //         return;
    //     }

    //     if (this.source_buffer.updating) {
    //         this.add_to_buffer_queue(data);
    //         return;
    //     }

    //     try {
    //         this.source_buffer.appendBuffer(data);
    //         this._has_audio = true;
    //     } catch (error) {
    //         if (error instanceof DOMException && error.name === 'InvalidStateError') {
    //             console.warn('⚠️ SourceBuffer removed, cannot append data');
    //             return;
    //         }
    //         console.error('Error appending to buffer:', error);
    //         this.add_to_buffer_queue(data);
    //     }
    // }

    // public destroy() {
    //     console.log('🗑️ Destroying BufferController');
        
    //     if (this.hls) {
    //         this.hls.destroy();
    //         this.hls = null;
    //     }

    //     if (this.blob_url) {
    //         URL.revokeObjectURL(this.blob_url);
    //         this.blob_url = null;
    //     }

    //     if (this.audio_element) {
    //         this.audio_element.pause();
    //         this.audio_element.src = '';
    //     }

    //     this.is_media_source_attached = false;
    //     this.is_first_track = true;
    //     this.transfer_data = null;
    //     this._has_audio = false;
    // }

    // public get_debug_info() {
    //     if (!this.media_source) {
    //         return { error: 'MediaSource not initialized' };
    //     }

    //     const sourceBuffers = [];
    //     for (let i = 0; i < this.media_source.sourceBuffers.length; i++) {
    //         const sb = this.media_source.sourceBuffers[i];
    //         const ranges = [];
            
    //         for (let j = 0; j < sb.buffered.length; j++) {
    //             ranges.push({
    //                 start: sb.buffered.start(j),
    //                 end: sb.buffered.end(j),
    //                 length: sb.buffered.end(j) - sb.buffered.start(j)
    //             });
    //         }

    //         sourceBuffers.push({
    //             index: i,
    //             mode: sb.mode,
    //             timestampOffset: sb.timestampOffset,
    //             updating: sb.updating,
    //             bufferedRanges: ranges,
    //             totalBuffered: ranges.reduce((sum, r) => sum + r.length, 0)
    //         });
    //     }

    //     return {
    //         browser: this.is_safari ? 'Safari' : 'Chrome/Other',
    //         mediaSource: {
    //             readyState: this.media_source.readyState,
    //             duration: this.media_source.duration,
    //             sourceBufferCount: this.media_source.sourceBuffers.length
    //         },
    //         audioElement: {
    //             src: this.audio_element?.src,
    //             currentTime: this.audio_element?.currentTime,
    //             duration: this.audio_element?.duration,
    //             paused: this.audio_element?.paused,
    //             readyState: this.audio_element?.readyState
    //         },
    //         sourceBuffers,
    //         blobUrl: this.blob_url,
    //         isFirstTrack: this.is_first_track
    //     };
    // }

    // public log_state() {
    //     const info = this.get_debug_info();
    //     console.log('📊 BufferController State:', JSON.stringify(info, null, 2));
    // }
}

export default BufferController;