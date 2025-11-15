# Professional DJ Mixing Technique

## Overview
The DJ mixer now implements **frequency-selective crossfading** - a professional technique used by real DJs to create seamless, energetic transitions between tracks.

## Key Concepts

### 1. Frequency Band Separation
Audio is split into three frequency bands:
- **Bass (< 250 Hz)**: Kick drums, sub-bass, low-end energy
- **Mids (250 Hz - 4 kHz)**: Main instruments, vocal body, melody
- **Highs (> 4 kHz)**: Vocal clarity, cymbals, hi-hats, sparkle

### 2. Beat Matching (Low Frequencies Only)
```
Problem: If you pitch-shift the entire song, vocals sound unnatural
Solution: Only pitch-shift the bass/beat, keep vocals at natural pitch
```

**How it works:**
1. Extract bass frequencies from song 2 (< 250 Hz)
2. Pitch-shift ONLY the bass to match song 1's BPM
3. Keep mids/highs at original pitch (natural vocal sound)
4. Recombine the frequencies

**Result:** Beats are perfectly synchronized, but vocals sound natural!

### 3. Frequency-Specific Crossfade Curves

#### Bass (<250 Hz): Layered Transition
```
Song 1 Bass:  100% ━━━━━━━━━━━━━━━━━━━━━━━━━━━> 30%
Song 2 Bass:   30% ━━━━━━━━━━━━━━━━━━━━━━━━━━━> 100%
                   ├───────────────────────────────┤
                       Both basses present!
```
- Both bass tracks stay prominent during overlap
- Creates energy continuity
- Classic DJ technique: "layered bass"

#### Mids + Highs (Vocals): Linear Crossfade (Sum = 1.0)
```
Song 1 Vocals: 100% ━━━━━━━━━━━━━━━━━━━━━━━━━━━> 0%
Song 2 Vocals:   0% ━━━━━━━━━━━━━━━━━━━━━━━━━━━> 100%
                    ├───────────────────────────────┤
Sum at any time:                1.0 (constant volume!)
```
- Clean, smooth vocal transition
- Constant volume (sum always = 1.0)
- No volume dips or peaks

## Customizable Mix Styles

### Quick (3-5 seconds)
- Fast, energetic transitions
- Good for high-energy mixes
- Less overlap, snappier feel

### Balanced (6-10 seconds) **[DEFAULT]**
- Professional, smooth transitions
- Most versatile
- Good for most genres

### Extended (10-16 seconds)
- Long, gradual blends
- Very smooth
- Good for downtempo/ambient

### Long (16-24 seconds)
- Very long, club-style mixes
- Maximum smoothness
- Good for house/techno

## Implementation Details

### Mix Structure
```
[Song 1 intro] + [Crossfade Section] + [BPM Transition] + [Song 2 continues]
     ↑                    ↑                    ↑                  ↑
  Unchanged     Bass beat-matched       Gradually         Original BPM
                Vocals linear fade    return to normal
```

### Crossfade Section (Overlap Duration)
1. **Bass frequencies**: Both tracks present with beat-matching
2. **Mid/high frequencies**: Linear crossfade (sum = 1.0)
3. **Result**: Energetic, consistent mix

### BPM Transition (8 seconds after crossfade)
After the crossfade, song 2 gradually returns to its original BPM:
```
Synced BPM ━━━━━━━━━━━━━━━━━━━━━━> Original BPM
           └──────────────────────┘
                8 seconds
            Sigmoid curve transition
```

## Audio Processing Flow

```
Song 1                          Song 2
  ↓                               ↓
Extract overlap section    Extract overlap + transition
  ↓                               ↓
Split frequencies          Split frequencies
  ↓                               ↓
Bass | Mids | Highs       Bass | Mids | Highs
  ↓      ↓      ↓           ↓      ↓      ↓
  ↓      ↓      ↓        Pitch    ↓      ↓
  ↓      ↓      ↓        shift    ↓      ↓
  ↓      ↓      ↓        (beat    ↓      ↓
  ↓      ↓      ↓        match)   ↓      ↓
  ↓      ↓      ↓           ↓      ↓      ↓
  └──────┴──────┴───────────┴──────┴──────┘
               ↓
         Apply crossfades:
         - Bass: Layered (both present)
         - Vocals: Linear (sum = 1.0)
               ↓
         Recombine all frequencies
               ↓
         Mixed audio output
```

## Benefits

### ✅ Professional Sound
- Beats stay aligned (no double-kick sounds)
- Vocals sound natural (no pitch artifacts)
- Energy stays consistent (no dips)

### ✅ Musical Intelligence
- BPM sync during overlap
- Gradual return to original speed
- Frequency-selective processing

### ✅ Customizable
- Multiple mix duration presets
- Energy-aware duration adjustment
- Adaptable to different genres

## Example Usage

```python
from dj_mixer import DJ_Audio_Mixer
from analysis_2 import DJ_Audio_Analyzer, DJ_Mix_Calculator

# Initialize
analyzer = DJ_Audio_Analyzer()
mix_calculator = DJ_Mix_Calculator()
mixer = DJ_Audio_Mixer()

# Analyze tracks
features_1 = analyzer.extract_dj_features(audio_1, sr_1)
features_2 = analyzer.extract_dj_features(audio_2, sr_2)

# Calculate optimal mix
mix_instruction = mix_calculator.calculate_optimal_mix(features_1, features_2)

# Create mix with custom style
process = mixer.create_mixed_audio_pipe(
    song_id_1='video_id_1',
    song_id_2='video_id_2',
    mix_instruction=mix_instruction,
    mix_style='balanced'  # or 'quick', 'extended', 'long'
)

# Process is ready to pipe to stream_v2.js!
```

## Technical Specifications

### Frequency Separation
- Method: Butterworth filters (4th order)
- Bass cutoff: 250 Hz (lowpass)
- Mids range: 250 Hz - 4 kHz (bandpass)
- Highs cutoff: 4 kHz (highpass)

### Crossfade Curves
- **Bass**: `np.linspace(1.0, 0.3, length)` for fade-out
- **Bass**: `np.linspace(0.3, 1.0, length)` for fade-in
- **Vocals**: `np.linspace(1.0, 0.0, length)` for fade-out
- **Vocals**: `np.linspace(0.0, 1.0, length)` for fade-in

### BPM Transition
- Duration: 8 seconds
- Curve: Sigmoid (smooth, natural)
- First 20%: Fully synced
- Middle 60%: Gradual transition
- Last 20%: Fully original

## Why This Works

### Problem: Traditional Crossfades
```
❌ Fade out song 1
❌ Fade in song 2
❌ Result: Boring, sequential transition
❌ Beats don't align → sounds messy
```

### Solution: Professional DJ Technique
```
✅ Beat-match the bass (both present)
✅ Crossfade the vocals (sum = 1.0)
✅ Result: Energetic, seamless mix
✅ Beats align perfectly → sounds professional
```

## Real-World DJ Analogy

Think of a DJ with a mixer:
1. **EQ knobs**: They adjust bass, mids, highs separately
2. **Beat matching**: They sync the BPMs by adjusting turntable speed
3. **Crossfader**: They keep bass from both tracks while swapping vocals
4. **Result**: Smooth, energetic transition

Our code does exactly this, but programmatically!

---

**Note**: This implementation mimics yt-dlp's output format, returning a subprocess with stdout containing M4A audio. This can be piped directly to `stream_v2.js` for HLS segmentation, maintaining consistency with existing infrastructure.
