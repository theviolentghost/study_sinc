// import * as MP4Box from 'mp4box';

// class FragmentParser {
//     private audio_context: AudioContext;
//     private sample_rate: number;

//     private init_segment: Uint8Array | null = null;
//     private decoded_buffers: Map<number, AudioBuffer> = new Map(); // key: fragment sequence number, value: AudioBuffer
//     private full_decoded_buffers: Map<string, AudioBuffer> = new Map(); // key: song identifier, value: full AudioBuffer

//     constructor(audio_context: AudioContext = new (window.AudioContext || (window as any).webkitAudioContext)()) {
//         this.audio_context = audio_context;
//         this.sample_rate = this.audio_context.sampleRate;
//     }

//     public get_context(): AudioContext {
//         return this.audio_context;
//     }

//     public get_decoded_buffer(sn: number): AudioBuffer | null {
//         return this.decoded_buffers.get(sn) || null;
//     }

//     public clear_decoded_buffers(): void {
//         this.decoded_buffers.clear();
//     }

//     public store_decoded_song_buffer(key: string, buffer: AudioBuffer | null): void {
//         if(buffer) {
//             this.full_decoded_buffers.set(key, buffer);
//         }
//     }

//     public get_stored_decoded_song_buffer(key: string): AudioBuffer | null {
//         return this.full_decoded_buffers.get(key) || null;
//     }

//     public get_all_stored_decoded_song_keys(): string[] {
//         return Array.from(this.full_decoded_buffers.keys());
//     }

//     public async get_song_decoded_buffer(): Promise<AudioBuffer | null> {
//         // returns the full decoded buffer for the current song by concatenating all decoded fragments
//         if(this.decoded_buffers.size === 0) return null;
//         if(this.is_decoding) {
//             await this.wait_to_decode();
//         }

//         const total_length = Array.from(this.decoded_buffers.values()).reduce((sum, buffer) => sum + buffer.length, 0);
//         const number_of_channels = Math.max(...Array.from(this.decoded_buffers.values()).map(buffer => buffer.numberOfChannels));

//         const full_buffer = this.audio_context.createBuffer(
//             number_of_channels,
//             total_length,
//             this.sample_rate
//         );

//         let offset = 0;
//         const sorted_sns = Array.from(this.decoded_buffers.keys()).sort((a, b) => a - b);
//         for (const sn of sorted_sns) {
//             const buffer = this.decoded_buffers.get(sn)!;
//             for (let channel = 0; channel < number_of_channels; channel++) {
//                 const channel_index = Math.min(channel, buffer.numberOfChannels - 1);
//                 const channel_data = buffer.getChannelData(channel_index);
//                 full_buffer.getChannelData(channel).set(channel_data, offset);
//             }
//             offset += buffer.length;
//         }

//         return full_buffer;
//     }

//     get is_decoding(): boolean {
//         return this.decoding_fragment || this.pending_fragments.length > 0;
//     }

//     private wait_to_decode(interval: number = 200): Promise<void> {
//         return new Promise((resolve) => {
//             const check = () => {
//                 if (!this.is_decoding) {
//                     resolve();
//                 } else {
//                     setTimeout(check, interval);
//                 }
//             };
//             check();
//         });
//     }

//     public async set_initialization_segment(init_segment: Uint8Array): Promise<void> {
//         this.init_segment = init_segment;
//         this.decode_pending_fragments();
//     }

//     private decode_pending_fragments(): void {
//         for(const fragment of this.pending_fragments) {
//             this.decode_audio_fragment(fragment.data, fragment.sn).then(() => {
//                 console.log('Decoded pending fragment SN=' + fragment.sn);
//             }).catch(error => {
//                 console.error('Error decoding pending fragment SN=' + fragment.sn, error);
//             });
//         }
//         this.pending_fragments = [];
//     }

//     private pending_fragments: { sn: number, data: Uint8Array }[] = [];
//     private decoding_fragment: boolean = false;
//     public async decode_audio_fragment(fragment_data: Uint8Array, sn: number | 'initSegment' = -1): Promise<AudioBuffer> {
//         try {
//             if(sn === 'initSegment') sn = -2; // compatibility
//             if (!this.init_segment) {
//                 if(sn === -2) {
//                     this.set_initialization_segment(fragment_data);
//                 } else {
//                     throw new Error('Initialization segment not set.');
//                 }
//             }
//             // early return cached buffer
//             if(sn >= 0 && this.decoded_buffers.has(sn)) {
//                 return this.decoded_buffers.get(sn)!;
//             }

//             this.decoding_fragment = true;

//             if (sn !== -2) {
//                 // Combine init segment and fragment data
//                 const combined_length = this.init_segment.length + fragment_data.length;
//                 var combined_data = new Uint8Array(combined_length);
//                 combined_data.set(this.init_segment, 0);
//                 combined_data.set(fragment_data, this.init_segment.length);
//             } else {
//                 // For the initialization segment itself
//                 console.log('Decoding initialization segment');
//                 var combined_data = new Uint8Array(fragment_data.length);
//                 combined_data.set(fragment_data, 0);
//             }

//             // Create a Blob from the combined data
//             const blob = new Blob([combined_data], { type: 'audio/mp4' });
//             const array_buffer = await blob.arrayBuffer();
            
//             // Decode the audio data
//             const audio_buffer = await this.audio_context.decodeAudioData(array_buffer);

//             // Cache the decoded buffer
//             if(sn >= 0) {
//                 this.decoded_buffers.set(sn, audio_buffer);
//             }
//             this.decoding_fragment = false;
//             return audio_buffer;
//         } catch (error) {
//             this.decoding_fragment = false;
//             if(error.message === 'Initialization segment not set.') {
//                 // cache fragment for later decoding when init segment is available
//                 console.warn('Initialization segment not set yet. Caching fragment SN=' + sn + ' for later decoding.');
//                 this.pending_fragments.push({ sn: sn as number, data: fragment_data });
//                 return Promise.reject(error);
//             }

//             console.error('Error decoding audio fragment SN=' + sn, error.message);
//         }
//     }

//     // private track_id: number = -1;
//     // private mp4box_file: any;
//     // private async initialize_mp4box(): Promise<void> {

//     //     this.mp4box_file = MP4Box.createFile();

//     //     this.mp4box_file.onReady = info => console.log('Ready:', info);
//     //     this.mp4box_file.onSegment = (id, user, buffer, sampleNum) => {
//     //         const segment = new Uint8Array(buffer);
//     //         console.log('MP4 fragment ready:', segment.byteLength);
//     //         // store / append to MSE
//     //     };

//     //     this.track_id = this.mp4box_file.addTrack({
//     //         timescale: 48000, // match your sample rate
//     //         hdlr: 'soun',
//     //         codec: 'mp4a.40.2',
//     //         samplerate: 48000,
//     //         channel_count: 2,
//     //         // duration: 0
//     //     });

//     //     this.mp4box_file.setSegmentOptions(this.track_id, null, {
//     //         nbSamples: 1024,         // how many AAC samples per fragment
//     //         rapAlignement: true,   // align to keyframes
//     //     });

//     //     await Promise.resolve().then(() => {
//     //         this.mp4box_file.initializeSegmentation();
//     //     });
//     // }

//     // public async encode_to_mp4(audio_buffer: AudioBuffer): Promise<Uint8Array> {
//     //     // console.log('🎬 Encoding with MediaRecorder (MP4)...');

//     //     this.initialize_mp4box();

//     //     const encoder = new AudioEncoder({
//     //         output: chunk => this.handle_encoded_aac_frame(chunk),
//     //         error: e => console.error(e),
//     //     });

//     //     encoder.configure({
//     //         codec: 'mp4a.40.2',
//     //         sampleRate: audio_buffer.sampleRate,
//     //         numberOfChannels: audio_buffer.numberOfChannels,
//     //         bitrate: 128000,
//     //     });

//     //     const channels = audio_buffer.numberOfChannels;
//     //     const frames = audio_buffer.length;

//     //     // Combine all channel data into one Float32Array in planar format
//     //     // (channel0 data first, then channel1 data, etc.)
//     //     const planar = new Float32Array(frames * channels);
//     //     for (let ch = 0; ch < channels; ch++) {
//     //         planar.set(audio_buffer.getChannelData(ch), ch * frames);
//     //     }

//     //     const frame = new AudioData({
//     //         format: 'f32-planar',
//     //         sampleRate: audio_buffer.sampleRate,
//     //         numberOfFrames: frames,
//     //         numberOfChannels: channels,
//     //         timestamp: 0,
//     //         data: planar,
//     //     });

//     //     encoder.encode(frame);
//     //     await encoder.flush();

//     //     return null;
//     // }

//     // private handle_encoded_aac_frame(chunk: EncodedAudioChunk) {
//     //     // console.log('Encoded AAC frame:', chunk);

//     //     const buffer = new Uint8Array(chunk.byteLength);
//     //     chunk.copyTo(buffer);

//     //     this.mp4box_file.addSample(this.track_id, {
//     //         duration: chunk.duration,
//     //         dts: chunk.timestamp,
//     //         cts: 0,
//     //         is_sync: true,
//     //         data: buffer.buffer
//     //     });
//     // }

//     private encoder: AudioEncoder | null = null;
//     private encoded_chunks: EncodedAudioChunk[] = [];

//     public async encode_to_mp4(audio_buffer: AudioBuffer): Promise<Uint8Array> {
//         this.encoded_chunks = [];

//         this.encoder = new AudioEncoder({
//             output: chunk => this.encoded_chunks.push(chunk),
//             error: e => console.error(e),
//         });

//         this.encoder.configure({
//             codec: 'mp4a.40.2',
//             sampleRate: audio_buffer.sampleRate,
//             numberOfChannels: audio_buffer.numberOfChannels,
//             bitrate: 128_000,
//         });

//         // convert audio buffer to interleaved PCM
//         const interleaved = this.interleave_audio_buffer(audio_buffer);
//         const frame_size = 1024;
//         const sample_rate = audio_buffer.sampleRate;
//         const channels = audio_buffer.numberOfChannels;
//         let offset = 0;

//         const frame_data = new Float32Array(frame_size * channels);

//         while( offset < interleaved.length ) {
//             frame_data.set(
//                 interleaved.subarray(offset, offset + frame_size * channels)
//             );

//             const frame = new AudioData({
//                 format: 'f32',
//                 sampleRate: sample_rate,
//                 numberOfFrames: frame_size,
//                 numberOfChannels: channels,
//                 timestamp: (offset / channels) / sample_rate * 1_000_000, // in microseconds
//                 data: frame_data,
//             });

//             this.encoder.encode(frame);
//             frame.close();
//             offset += frame_size * channels;
//         }

//         await this.encoder.flush();

//         return await this.mux_to_mp4(this.encoded_chunks, sample_rate, channels);
//     }

//     private interleave_audio_buffer(audio_buffer: AudioBuffer): Float32Array {
//         const channels = audio_buffer.numberOfChannels;
//         const length = audio_buffer.length;
//         const interleaved = new Float32Array(length * channels);

//         for(let channel = 0; channel < channels; channel++) {
//             const channel_data = audio_buffer.getChannelData(channel);
//             for(let i = 0; i < length; i++) {
//                 interleaved[i * channels + channel] = channel_data[i];
//             }
//         }

//         return interleaved;
//     }

//     private async mux_to_mp4(chunks: EncodedAudioChunk[], sample_rate: number, channels: number): Promise<Uint8Array> {
//         const mp4box_file: MP4Box.ISOFile<unknown, unknown> = MP4Box.createFile();

//         const track_id = mp4box_file.addTrack({
//             timescale: sample_rate,
//             hdlr: 'soun',
//             // @ts-ignore
//             codec: 'mp4a.40.2',
//             kind : 'audio',
//             samplerate: sample_rate,
//             channel_count: channels,
//         });

//         let offset = 0;
//         chunks.forEach(chunk => {
//             const buffer = new Uint8Array(chunk.byteLength);
//             chunk.copyTo(buffer);

//             mp4box_file.addSample(track_id, buffer, {
//                 // @ts-ignore
//                 duration: chunk.duration ?? 1024,
//                 dts: chunk.timestamp,
//                 cts: chunk.timestamp,
//                 is_sync: true,
//                 // data: buffer.buffer
//             });

//             offset += buffer.byteLength;
//         });

//         // const blob = mp4box_file.save('audio/mp4');
//         // const array_buffer = await blob.arrayBuffer();
//         // return new Uint8Array(array_buffer);

//         mp4box_file.flush(); // triggers final segment writing

//         const stream = mp4box_file.getBuffer();
//         if (stream._dataView && stream._dataView.buffer) {
//             // Get the ArrayBuffer from the DataView
//             const arrayBuffer = stream._dataView.buffer.slice(0, stream._byteLength);
//             return new Uint8Array(arrayBuffer);
//         }
        
//         throw new Error('Could not extract buffer from MP4Box');

//     }

//     public validate_mp4_data(data: Uint8Array): boolean {
//         if (data.length < 20) return false;
        
//         // Check for ftyp box (file type box)
//         const ftyp_signature = Array.from(data.slice(4, 8))
//             .map(b => String.fromCharCode(b)).join('');
        
//         if (ftyp_signature !== 'ftyp') {
//             console.warn('No ftyp box found at expected position');
//             return false;
//         }
        
//         // Check for moov box (movie box) somewhere in the file
//         const data_str = Array.from(data.slice(0, Math.min(data.length, 1000)))
//             .map(b => String.fromCharCode(b)).join('');
        
//         if (!data_str.includes('moov')) {
//             console.warn('No moov box found in MP4 data');
//             return false;
//         }
        
//         console.log('✅ MP4 data validation passed');
//         return true;
//     }

//     // Add this method to better understand the data structure
//     public analyze_mp4_structure(data: Uint8Array, label: string) {
//         console.log(`📦 Analyzing ${label}:`, data.length, 'bytes');
        
//         // Look for MP4 box types
//         const boxes = [];
//         let offset = 0;
        
//         while (offset < Math.min(data.length, 200)) { // Only check first 200 bytes
//             if (offset + 8 > data.length) break;
            
//             const size = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
//             const type = String.fromCharCode(data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7]);
            
//             boxes.push({ type, size, offset });
            
//             if (size === 0 || size > data.length) break;
//             offset += size;
            
//             if (boxes.length > 10) break; // Limit output
//         }
        
//         console.log(`   Boxes found:`, boxes.map(b => `${b.type}(${b.size})`).join(', '));
        
//         // Check for common box types
//         const hasInit = boxes.some(b => ['ftyp', 'moov'].includes(b.type));
//         const hasMedia = boxes.some(b => ['moof', 'mdat'].includes(b.type));
        
//         console.log(`   Type: ${hasInit ? 'Complete MP4' : 'Fragment'} (init: ${hasInit}, media: ${hasMedia})`);
        
//         return { boxes, hasInit, hasMedia };
//     }
// }

// export default FragmentParser;