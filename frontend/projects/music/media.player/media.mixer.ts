class MediaMixer {
    private audio_context: AudioContext;
    private sample_rate: number;

    constructor(audio_context: AudioContext, sample_rate: number) {
        this.audio_context = audio_context;
        this.sample_rate = sample_rate;
    }

    public mix_audio_buffers(buffers: AudioBuffer[]): AudioBuffer | null {
        if (buffers.length === 0) return null;

        const max_length = Math.max(...buffers.map(buffer => buffer.length));
        const number_of_channels = Math.max(...buffers.map(buffer => buffer.numberOfChannels));

        const mixed_buffer = this.audio_context.createBuffer(
            number_of_channels,
            max_length,
            this.sample_rate
        );

        for (let channel = 0; channel < number_of_channels; channel++) {
            const mixed_data = mixed_buffer.getChannelData(channel);

            // Sum all tracks for this channel using TypedArray set() for performance
            for (const buffer of buffers) {
                if (buffer.length === 0) continue;
                
                const channel_index = Math.min(channel, buffer.numberOfChannels - 1);
                const channel_data = buffer.getChannelData(channel_index);

                // Use typed array addition instead of loop
                for (let i = 0; i < Math.min(channel_data.length, max_length); i++) {
                    mixed_data[i] += channel_data[i];
                }
            }

            // Normalize to prevent clipping
            let maxAmplitude = 0;
            for (let i = 0; i < mixed_data.length; i++) {
                maxAmplitude = Math.max(maxAmplitude, Math.abs(mixed_data[i]));
            }
            
            if (maxAmplitude > 1.0) {
                const normalizeRatio = 1.0 / maxAmplitude;
                for (let i = 0; i < mixed_data.length; i++) {
                    mixed_data[i] *= normalizeRatio;
                }
            }
        }

        return mixed_buffer;
    }

    /**
     * Mix audio buffers with chunked processing for memory efficiency
     * Use this for very large buffers to avoid stack overflow
     */
    public mix_audio_buffers_chunked(buffers: AudioBuffer[], chunkSize: number = 4096): AudioBuffer | null {
        if (buffers.length === 0) return null;

        const max_length = Math.max(...buffers.map(buffer => buffer.length));
        const number_of_channels = Math.max(...buffers.map(buffer => buffer.numberOfChannels));

        const mixed_buffer = this.audio_context.createBuffer(
            number_of_channels,
            max_length,
            this.sample_rate
        );

        // Process in chunks to avoid stack overflow
        for (let channel = 0; channel < number_of_channels; channel++) {
            const mixed_data = mixed_buffer.getChannelData(channel);

            // Process in chunks
            for (let chunkStart = 0; chunkStart < max_length; chunkStart += chunkSize) {
                const chunkEnd = Math.min(chunkStart + chunkSize, max_length);

                // Mix buffers for this chunk
                for (const buffer of buffers) {
                    const channel_index = Math.min(channel, buffer.numberOfChannels - 1);
                    const channel_data = buffer.getChannelData(channel_index);

                    for (let i = chunkStart; i < chunkEnd; i++) {
                        if (i < channel_data.length) {
                            mixed_data[i] += channel_data[i];
                        }
                    }
                }
            }
        }

        // Normalize
        for (let channel = 0; channel < number_of_channels; channel++) {
            const mixed_data = mixed_buffer.getChannelData(channel);
            let maxAmplitude = 0;

            for (let i = 0; i < mixed_data.length; i++) {
                maxAmplitude = Math.max(maxAmplitude, Math.abs(mixed_data[i]));
            }

            if (maxAmplitude > 1.0) {
                const normalizeRatio = 1.0 / maxAmplitude;
                for (let i = 0; i < mixed_data.length; i++) {
                    mixed_data[i] *= normalizeRatio;
                }
            }
        }

        return mixed_buffer;
    }

    private audio_buffer_to_wav(buffer: AudioBuffer): Blob {
        const numberOfChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const format = 1;
        const bitDepth = 16;
        const bytesPerSample = bitDepth / 8;
        const blockAlign = numberOfChannels * bytesPerSample;

        const data = new Float32Array(buffer.length * numberOfChannels);
        for (let channel = 0; channel < numberOfChannels; channel++) {
            const channelData = buffer.getChannelData(channel);
            for (let i = 0; i < buffer.length; i++) {
                data[i * numberOfChannels + channel] = channelData[i];
            }
        }

        const dataLength = data.length * bytesPerSample;
        const bufferLength = 44 + dataLength;
        const arrayBuffer = new ArrayBuffer(bufferLength);
        const view = new DataView(arrayBuffer);

        const writeString = (offset: number, string: string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        writeString(0, 'RIFF');
        view.setUint32(4, bufferLength - 8, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format, true);
        view.setUint16(22, numberOfChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);
        writeString(36, 'data');
        view.setUint32(40, dataLength, true);

        let offset = 44;
        for (let i = 0; i < data.length; i++) {
            const sample = Math.max(-1, Math.min(1, data[i]));
            view.setInt16(offset, sample * 0x7FFF, true);
            offset += 2;
        }

        return new Blob([arrayBuffer], { type: 'audio/wav' });
    }
}

export default MediaMixer;