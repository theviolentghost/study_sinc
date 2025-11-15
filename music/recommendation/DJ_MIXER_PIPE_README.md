# DJ Mixer Pipe Implementation

## Overview
Modified `dj_mixer.py` to create a subprocess pipe (like yt-dlp) instead of manually creating HLS files. This allows `stream_v2.js` to handle all HLS segmentation consistently.

## Changes Made

### Modified: `dj_mixer.py`

#### New Method: `create_mixed_audio_pipe()`
Replaced `create_mixed_audio_stream()` with a new method that:

1. **Analyzes and mixes audio** (same as before):
   - Decodes HLS chunks from both songs
   - Converts to mono if needed
   - Resamples to 44.1kHz if needed
   - Applies BPM sync (pitch shifting)
   - Creates crossfade mix

2. **Returns subprocess.Popen** (NEW behavior):
   - Writes mixed audio to temporary WAV file
   - Starts FFmpeg process that encodes to M4A format
   - Outputs to stdout (`pipe:1`)
   - Returns the process object with stdout ready to read

#### FFmpeg Command
```python
cmd = [
    'ffmpeg',
    '-i', tmp_wav_path,
    '-c:a', 'aac',           # AAC codec
    '-b:a', '192k',          # High quality bitrate
    '-ar', '44100',          # Sample rate
    '-ac', '2',              # Stereo
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',  # Streamable MP4
    '-f', 'mp4',             # MP4 container (M4A)
    'pipe:1'                 # Output to stdout
]
```

The output format (M4A) matches what yt-dlp provides with `bestaudio[ext=m4a]`, making it compatible with `stream_v2.js`.

## Usage

### Python Side
```python
from dj_mixer import DJ_Audio_Mixer
from analysis_2 import DJ_Audio_Analyzer, DJ_Mix_Calculator

# Initialize
analyzer = DJ_Audio_Analyzer()
mix_calculator = DJ_Mix_Calculator()
mixer = DJ_Audio_Mixer()

# Analyze songs
features_1 = analyzer.extract_dj_features(audio_1, sr_1)
features_2 = analyzer.extract_dj_features(audio_2, sr_2)

# Calculate mix instruction
mix_instruction = mix_calculator.calculate_optimal_mix(features_1, features_2)

# Create pipe (returns subprocess.Popen)
audio_process = mixer.create_mixed_audio_pipe(
    song_id_1='video_id_1',
    song_id_2='video_id_2',
    mix_instruction=mix_instruction,
    quality='high'
)

# audio_process.stdout is now ready to be piped!
```

### Node.js Side (Future Integration)
```javascript
// In stream_v2.js - conceptual example
async create_hls_stream_from_dj_mix(song_id_1, song_id_2) {
    // Call Python to create mix pipe
    const audio_process = await this.create_dj_mix_process(song_id_1, song_id_2);
    
    // Pipe through FFmpeg (same as yt-dlp flow)
    const ffmpeg_process = await this.create_ffmpeg_process(
        audio_process,  // <-- Use Python subprocess here!
        output_directory,
        mix_id,
        this.codecs,
        this.profile_progression
    );
    
    // Rest is handled by existing HLS logic
    return ffmpeg_process;
}
```

## Key Benefits

1. **Consistent with yt-dlp flow**: The subprocess output format is identical to what yt-dlp provides
2. **No duplicate HLS logic**: All HLS segmentation happens in `stream_v2.js`
3. **Clean separation**: Python does audio mixing, Node.js does streaming
4. **Process-based**: Uses subprocess pipes, just like yt-dlp integration

## Process Flow

```
DJ Mixer Flow:
┌─────────────────────────────────────────────────────────┐
│ Python: dj_mixer.py                                     │
├─────────────────────────────────────────────────────────┤
│ 1. Decode HLS chunks (song 1 + song 2)                 │
│ 2. Analyze audio features                              │
│ 3. Apply BPM sync & pitch shifting                     │
│ 4. Create crossfade mix                                │
│ 5. Write to temp WAV                                   │
│ 6. Start FFmpeg: WAV → M4A → stdout                   │
│ 7. Return subprocess.Popen                             │
└────────────────┬────────────────────────────────────────┘
                 │ (subprocess with stdout pipe)
                 ▼
┌─────────────────────────────────────────────────────────┐
│ Node.js: stream_v2.js                                   │
├─────────────────────────────────────────────────────────┤
│ 1. Receive subprocess from Python                      │
│ 2. Pipe to FFmpeg (existing create_ffmpeg_process)    │
│ 3. Generate HLS segments (all qualities)              │
│ 4. Create master playlist                             │
│ 5. Serve via /hls/raw/ endpoints                      │
└─────────────────────────────────────────────────────────┘
```

## Testing

Run the test script:
```bash
cd music/recommendation
python test_dj_pipe.py
```

This will:
1. Find available songs in HLS storage
2. Analyze and calculate optimal mix
3. Create the mix pipe
4. Optionally save output to test file
5. Verify file integrity with ffprobe

## Technical Details

### Output Format
- **Container**: MP4 (M4A)
- **Codec**: AAC
- **Bitrate**: 192k
- **Sample Rate**: 44.1kHz
- **Channels**: Stereo
- **Streaming**: Fragmented MP4 with `frag_keyframe+empty_moov`

### Cleanup
The subprocess has attached cleanup methods:
- `process._cleanup_temp_file()` - Removes temporary WAV
- `process._temp_wav_path` - Path to temp file

Call cleanup after consuming the stream:
```python
process.wait()
if hasattr(process, '_cleanup_temp_file'):
    process._cleanup_temp_file()
```

### Memory Considerations
- Mixed audio is written to temp file (not held in memory)
- FFmpeg streams from temp file (low memory usage)
- Temp file is cleaned up after process completes

## Next Steps

To integrate with `stream_v2.js`:

1. **Create Python bridge** - Add method to call Python mixer from Node.js
2. **Modify create_hls_stream** - Add DJ mix variant that uses Python subprocess
3. **Handle mix IDs** - Generate unique IDs for mix sessions
4. **Add endpoint** - Create `/dj/mix` endpoint to request mixes
5. **Test end-to-end** - Verify HLS playback of mixed audio

The Python side is now complete and ready for integration!
