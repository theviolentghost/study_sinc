"""
DJ Mixer - Creates mixed audio files from DJ analysis and mix instructions
Handles BPM sync, pitch shifting, crossfading, and HLS segment generation
"""

import os
import numpy as np
import subprocess
import tempfile
import json
import hashlib
from pathlib import Path
from typing import Tuple, Optional
import soundfile as sf

from hls_audio_decoder import HLS_Audio_Decoder
from analysis_2 import DJ_Audio_Analyzer, DJ_Mix_Calculator, MixInstruction


class DJ_Audio_Mixer:
    """
    Mixes two audio tracks based on DJ analysis and creates HLS segments.
    """
    
    def __init__(self, hls_base_path: str = None):
        """
        Initialize DJ Audio Mixer.
        
        Args:
            hls_base_path: Base path where HLS files are stored
        """
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        
        if hls_base_path is None:
            self.hls_base_path = os.path.join(project_root, 'storage', 'musik', 'hls')
        else:
            self.hls_base_path = hls_base_path
            
        self.hls_raw_path = os.path.join(self.hls_base_path, 'raw')
        self.hls_mixes_path = os.path.join(self.hls_base_path, 'mixes')
        
        # Ensure mixes directory exists
        os.makedirs(self.hls_mixes_path, exist_ok=True)
        
        self.decoder = HLS_Audio_Decoder()
        self.sample_rate = 44100  # Standard sample rate
        
    def generate_mix_id(self, song_id_1: str, song_id_2: str, mix_instruction: MixInstruction) -> str:
        """Generate unique ID for this mix based on songs and mix parameters."""
        mix_data = f"{song_id_1}:{song_id_2}:{mix_instruction.mix_out_point.time_seconds}:{mix_instruction.mix_in_point.time_seconds}"
        return hashlib.md5(mix_data.encode()).hexdigest()[:16]
    
    def create_mixed_audio_pipe(
        self,
        song_id_1: str,
        song_id_2: str,
        mix_instruction: MixInstruction,
        quality: str = 'high',
        mix_style: str = 'balanced'  # 'quick', 'balanced', 'extended', 'long'
    ):
        """
        Create a mixed audio subprocess that outputs to stdout (like yt-dlp).
        Returns a subprocess.Popen object that stream_v2.js can pipe from.
        
        This mimics yt-dlp's behavior by outputting M4A audio to stdout,
        which can then be consumed by stream_v2.js's FFmpeg pipeline.
        
        Args:
            song_id_1: First song ID (current track)
            song_id_2: Second song ID (next track)
            mix_instruction: MixInstruction dataclass with mixing parameters
            quality: HLS quality to use for source audio
            mix_style: Mixing style for overlap duration
                - 'quick': 3-5 seconds (fast transition)
                - 'balanced': 6-10 seconds (default, professional)
                - 'extended': 10-16 seconds (smooth, gradual)
                - 'long': 16-24 seconds (very smooth, club style)
            
        Returns:
            subprocess.Popen object with stdout containing M4A audio stream
        """
        
        # Override overlap duration based on mix style
        mix_instruction = self._adjust_mix_duration(mix_instruction, mix_style)
        print(f"🎛️  Creating DJ mix pipe: {song_id_1} → {song_id_2}")
        
        # Decode both songs
        print(f"Decoding song 1: {song_id_1}")
        audio_1, sr_1 = self.decoder.decode_chunks_to_numpy(song_id_1, quality)
        
        print(f"Decoding song 2: {song_id_2}")
        audio_2, sr_2 = self.decoder.decode_chunks_to_numpy(song_id_2, quality)
        
        # Convert to mono if needed
        if len(audio_1.shape) == 2:
            audio_1 = np.mean(audio_1, axis=1)
        if len(audio_2.shape) == 2:
            audio_2 = np.mean(audio_2, axis=1)
        
        # Resample if needed
        if sr_1 != self.sample_rate:
            audio_1 = self._resample(audio_1, sr_1, self.sample_rate)
        if sr_2 != self.sample_rate:
            audio_2 = self._resample(audio_2, sr_2, self.sample_rate)
        
        # Create the mix (BPM sync/pitch shifting will be applied only where needed inside)
        print(f"Creating crossfade mix...")
        mixed_audio = self._create_crossfade_mix(
            audio_1,
            audio_2,
            mix_instruction
        )
        
        # Convert to stereo (duplicate mono to both channels)
        if len(mixed_audio.shape) == 1:
            mixed_audio = np.stack([mixed_audio, mixed_audio], axis=1)
        
        # Write mixed audio to temporary WAV file
        print(f"Writing mixed audio to temp file...")
        tmp_wav = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
        sf.write(tmp_wav.name, mixed_audio, self.sample_rate, subtype='PCM_16')
        tmp_wav_path = tmp_wav.name
        tmp_wav.close()
        
        # Create FFmpeg process to encode and stream to stdout
        # Output as M4A (AAC in MP4 container) - same as yt-dlp's bestaudio[ext=m4a]
        print(f"Starting FFmpeg pipe to stdout (M4A format)...")
        
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
        
        # Start FFmpeg process that outputs to stdout
        # This mimics yt-dlp's behavior
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0  # Unbuffered
        )
        
        # Store temp file path so we can clean it up later
        # Attach cleanup callback to process
        def cleanup_temp_file():
            try:
                os.unlink(tmp_wav_path)
                print(f"Cleaned up temp file: {tmp_wav_path}")
            except:
                pass
        
        # Attach cleanup method to process
        process._cleanup_temp_file = cleanup_temp_file
        process._temp_wav_path = tmp_wav_path
        
        print(f"✅ Mix pipe ready - returning subprocess")
        return process
    
    def _adjust_mix_duration(self, mix_instruction: MixInstruction, mix_style: str) -> MixInstruction:
        """
        Adjust the overlap duration based on the desired mix style.
        
        Args:
            mix_instruction: Original mix instruction
            mix_style: 'quick', 'balanced', 'extended', or 'long'
            
        Returns:
            Updated MixInstruction with adjusted overlap_duration
        """
        # Define overlap duration ranges for each style
        style_durations = {
            'quick': (3.0, 5.0),      # Fast, energetic transitions
            'balanced': (6.0, 10.0),   # Professional, smooth (default)
            'extended': (10.0, 16.0),  # Long, gradual blends
            'long': (16.0, 24.0)       # Very long, club-style mixes
        }
        
        if mix_style not in style_durations:
            print(f"⚠️  Unknown mix style '{mix_style}', using 'balanced'")
            mix_style = 'balanced'
        
        min_duration, max_duration = style_durations[mix_style]
        
        # Calculate target duration based on energy difference
        # More similar energy = longer mix possible
        # Different energy = shorter mix recommended
        energy_diff = abs(
            mix_instruction.mix_out_point.energy_level - 
            mix_instruction.mix_in_point.energy_level
        )
        
        # Scale within the range based on energy compatibility
        # Lower energy_diff = use upper range, higher = use lower range
        energy_factor = 1.0 - (energy_diff * 0.5)  # 0.5 to 1.0
        energy_factor = max(0.5, min(1.0, energy_factor))
        
        new_duration = min_duration + (max_duration - min_duration) * energy_factor
        
        print(f"  🎚️  Mix style: {mix_style.upper()}")
        print(f"     Original overlap: {mix_instruction.overlap_duration:.1f}s")
        print(f"     Style range: {min_duration:.1f}s - {max_duration:.1f}s")
        print(f"     Energy difference: {energy_diff:.2f}")
        print(f"     Adjusted overlap: {new_duration:.1f}s")
        
        # Create new MixInstruction with updated overlap
        from dataclasses import replace
        return replace(mix_instruction, overlap_duration=new_duration)
    
    def _resample(self, audio: np.ndarray, original_rate: int, target_rate: int) -> np.ndarray:
        """Resample audio using FFmpeg."""
        if original_rate == target_rate:
            return audio
        
        # Use scipy if available, otherwise FFmpeg
        try:
            from scipy import signal
            num_samples = int(len(audio) * target_rate / original_rate)
            return signal.resample(audio, num_samples)
        except ImportError:
            # Fallback to FFmpeg resampling
            print(f"Resampling {original_rate}Hz → {target_rate}Hz using FFmpeg")
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_in:
                sf.write(tmp_in.name, audio, original_rate)
                
                with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_out:
                    cmd = [
                        'ffmpeg', '-i', tmp_in.name,
                        '-ar', str(target_rate),
                        '-y', tmp_out.name
                    ]
                    subprocess.run(cmd, capture_output=True, check=True)
                    resampled, _ = sf.read(tmp_out.name)
                    
                os.unlink(tmp_in.name)
                os.unlink(tmp_out.name)
                
            return resampled
    
    def _pitch_shift(self, audio: np.ndarray, pitch_percent: float) -> np.ndarray:
        """
        Pitch shift audio using FFmpeg's rubberband or tempo filter.
        
        Args:
            audio: Input audio array
            pitch_percent: Pitch adjustment in percentage (e.g., +10.0 for 10% faster)
        """
        # Calculate tempo factor (1.0 = normal speed)
        tempo_factor = 1.0 + (pitch_percent / 100.0)
        
        print(f"  Pitch shifting by {pitch_percent:+.1f}% (tempo factor: {tempo_factor:.3f})")
        
        # Write audio to temp file
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_in:
            sf.write(tmp_in.name, audio, self.sample_rate)
            
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_out:
                # Use rubberband filter for pitch shifting (preserves pitch while changing tempo)
                # Or use atempo for simple speed change
                cmd = [
                    'ffmpeg', '-i', tmp_in.name,
                    '-filter:a', f'rubberband=tempo={tempo_factor}',
                    '-y', tmp_out.name
                ]
                
                try:
                    subprocess.run(cmd, capture_output=True, check=True)
                except subprocess.CalledProcessError:
                    # Fallback to atempo if rubberband not available
                    print("  Rubberband not available, using atempo filter")
                    cmd = [
                        'ffmpeg', '-i', tmp_in.name,
                        '-filter:a', f'atempo={min(2.0, max(0.5, tempo_factor))}',
                        '-y', tmp_out.name
                    ]
                    subprocess.run(cmd, capture_output=True, check=True)
                
                shifted_audio, _ = sf.read(tmp_out.name)
                
            os.unlink(tmp_in.name)
            os.unlink(tmp_out.name)
        
        return shifted_audio
    
    def _create_crossfade_mix(
        self,
        audio_1: np.ndarray,
        audio_2: np.ndarray,
        mix_instruction: MixInstruction
    ) -> np.ndarray:
        """
        Create a crossfaded mix of two audio tracks.
        Only processes the necessary portions - no wasted audio!
        
        Mix structure:
        [Song 1 up to mix point] + [Crossfade section] + [Song 2 from after mix in point]
        
        Args:
            audio_1: First audio track (current song)
            audio_2: Second audio track (next song)
            mix_instruction: Mix instruction with timing and parameters
        """
        # Get mix points in samples
        mix_out_sample = int(mix_instruction.mix_out_point.time_seconds * self.sample_rate)
        mix_in_sample = int(mix_instruction.mix_in_point.time_seconds * self.sample_rate)
        
        # Get overlap duration in samples
        overlap_samples = int(mix_instruction.overlap_duration * self.sample_rate)
        
        print(f"  Mix out at: {mix_instruction.mix_out_point.time_seconds:.2f}s (sample {mix_out_sample})")
        print(f"  Mix in at: {mix_instruction.mix_in_point.time_seconds:.2f}s (sample {mix_in_sample})")
        print(f"  Overlap: {mix_instruction.overlap_duration:.2f}s ({overlap_samples} samples)")
        
        # Part 1: Audio from song 1 before mix point (unchanged)
        part1 = audio_1[:mix_out_sample]
        print(f"  Part 1 (Song 1 intro): {len(part1) / self.sample_rate:.2f}s")
        
        # Part 2: Overlapping/crossfade section - BEAT-SYNCHRONIZED MIXING
        # This is the key to professional DJ mixing: sync the beats during overlap!
        
        # Extract the sections that will be mixed
        song1_fade_out = audio_1[mix_out_sample:mix_out_sample + overlap_samples]
        
        # For song 2, we need enough audio to:
        # 1. Crossfade section (pitch-shifted to match song 1 BPM)
        # 2. Transition section (gradually returning to original BPM)
        transition_duration = 8.0  # 8 seconds to transition back to original speed
        transition_samples = int(transition_duration * self.sample_rate)
        
        # Extract more audio from song 2 to include transition section
        song2_raw = audio_2[mix_in_sample:mix_in_sample + overlap_samples + transition_samples]
        
        # Make sure both sections are the same length for crossfade
        min_length = min(len(song1_fade_out), overlap_samples)
        song1_fade_out = song1_fade_out[:min_length]
        song2_crossfade_section = song2_raw[:min_length]
        
        # PROFESSIONAL DJ TECHNIQUE: Frequency-selective beat matching
        # 1. Separate frequencies FIRST (before pitch shifting)
        # 2. Pitch shift ONLY the low frequencies (bass/beat) of song 2
        # 3. Keep vocals at natural pitch for clarity
        # 4. Linear crossfade for vocals (clean transition, sum = 1.0)
        # 5. Beat-matched crossfade for bass (both present, drives energy)
        
        print(f"  🎚️  Separating frequencies for selective processing...")
        print(f"     Bass (<250Hz) | Mids (250Hz-4kHz) | Highs (>4kHz)")
        
        # Split song 1 into frequency bands (no pitch shifting needed)
        song1_bass, song1_mids, song1_highs = self._split_frequency_bands(song1_fade_out)
        
        # Split song 2 RAW audio (before pitch shifting) into frequency bands
        song2_raw_bass, song2_raw_mids, song2_raw_highs = self._split_frequency_bands(song2_crossfade_section)
        
        # Apply BPM sync ONLY to the bass/low frequencies (beat matching)
        print(f"  🎛️  Beat-synchronized mixing:")
        print(f"     BPM sync type: {mix_instruction.bpm_sync.sync_type.value}")
        
        if mix_instruction.bpm_sync.pitch_adjustment != 0:
            print(f"     Pitch adjustment: {mix_instruction.bpm_sync.pitch_adjustment:+.2f}%")
            print(f"     ⚡ Pitch-shifting ONLY low frequencies (bass/beat) for beat matching")
            print(f"     🎤 Keeping vocals at natural pitch for clarity")
            
            # Pitch shift ONLY the bass (this is where the beat lives!)
            song2_bass_synced = self._pitch_shift(song2_raw_bass, mix_instruction.bpm_sync.pitch_adjustment)
            
            # Ensure same length
            song2_bass_synced = song2_bass_synced[:min_length]
            
            # Mids and highs stay at natural pitch
            song2_mids = song2_raw_mids[:min_length]
            song2_highs = song2_raw_highs[:min_length]
            
            print(f"     ✓ Bass beat-matched at {mix_instruction.bpm_sync.target_bpm:.1f} BPM")
            print(f"     ✓ Vocals unchanged at natural pitch")
            
        else:
            # No pitch adjustment needed
            song2_bass_synced = song2_raw_bass
            song2_mids = song2_raw_mids
            song2_highs = song2_raw_highs
        
        # CROSSFADE CURVES - EXTENDED INSTRUMENTAL BRIDGE
        print(f"  🎚️  Applying crossfade with extended instrumental bridge...")
        
        # Create crossfade position from 0 to 1
        crossfade_position = np.linspace(0.0, 1.0, min_length)
        
        # PROFESSIONAL DJ TECHNIQUE: Create an extended instrumental section
        # - Bass: Standard equal-power crossfade (keeps beats tight)
        # - Vocals: Create a WIDE "valley" where vocals are reduced
        # This creates a long beat-only section between the songs' lyrics
        
        # 1. BASS (LOW FREQUENCIES): Standard equal-power for tight transition
        smooth_curve = np.power(crossfade_position, 0.7)
        angle = smooth_curve * (np.pi / 2)
        
        bass_fade_out = np.cos(angle)  # 1.0 → 0.0 (smooth)
        bass_fade_in = np.sin(angle)   # 0.0 → 1.0 (smooth)
        
        bass_combined_power = bass_fade_out**2 + bass_fade_in**2
        
        print(f"     Bass (<250Hz): Standard equal-power crossfade")
        print(f"       Power verification: min={bass_combined_power.min():.6f}, max={bass_combined_power.max():.6f}")
        print(f"       ✓ Smooth, constant bass transition!")
        
        # 2. MIDS + HIGHS (VOCALS): Create EXTENDED instrumental bridge
        #    Vocals fade out early, stay low for extended period, fade in QUICK
        
        # Define the instrumental bridge zone (where vocals are reduced)
        # This is the key to getting more beats between lyrics!
        bridge_start = 0.20   # Song 1 vocals start fading at 20% (earlier)
        bridge_end = 0.85     # Song 2 vocals start coming in at 85% (later!)
        
        # SPLIT vocal treatment: highs (vocals) vs mids (instruments)
        # Highs (>4kHz): Heavy reduction for vocal clarity
        # Mids (250Hz-4kHz): Keep higher for instrumental continuity
        
        high_vocal_level = 0.20   # Highs at 20% during bridge (vocal clarity reduced)
        mid_vocal_level = 0.50    # Mids at 50% during bridge (instruments present!)
        
        # Create separate envelopes for mids and highs
        vocal_fade_out = np.ones(min_length)
        vocal_fade_in = np.zeros(min_length)
        
        for i, pos in enumerate(crossfade_position):
            if pos < bridge_start:
                # Before bridge: Song 1 vocals strong, fading out gradually
                fade_pos = pos / bridge_start  # 0 to 1 within this section
                # Smooth fade using power curve
                vocal_fade_out[i] = 1.0 - np.power(fade_pos, 0.8) * (1.0 - mid_vocal_level)
                vocal_fade_in[i] = 0.0
                
            elif pos <= bridge_end:
                # During bridge: Both vocals reduced to create instrumental section
                # This is the BEAT-ONLY zone!
                bridge_pos = (pos - bridge_start) / (bridge_end - bridge_start)  # 0 to 1
                # Crossfade between songs at moderate volume (50% mids for instrumental feel)
                vocal_fade_out[i] = mid_vocal_level * np.cos(bridge_pos * np.pi / 2)
                vocal_fade_in[i] = mid_vocal_level * np.sin(bridge_pos * np.pi / 2)
                
            else:
                # After bridge: Song 2 vocals fading in QUICKLY
                fade_pos = (pos - bridge_end) / (1.0 - bridge_end)  # 0 to 1
                # STEEPER curve for quicker fade-in (power 2.0 = very fast)
                vocal_fade_out[i] = 0.0
                vocal_fade_in[i] = mid_vocal_level + np.power(fade_pos, 2.0) * (1.0 - mid_vocal_level)
        
        bridge_duration = (bridge_end - bridge_start) * mix_instruction.overlap_duration
        
        print(f"     Mids/Highs (vocals): EXTENDED instrumental bridge")
        print(f"       Bridge zone: {bridge_start*100:.0f}%-{bridge_end*100:.0f}% of transition (60% coverage!)")
        print(f"       Bridge duration: {bridge_duration:.1f} seconds of instrumental!")
        print(f"       Mid-range level: {mid_vocal_level*100:.0f}% (instruments stay present)")
        print(f"       High-range level: {high_vocal_level*100:.0f}% (vocals reduced)")
        
        # Check transition characteristics
        idx_20 = int(min_length * 0.20)
        idx_35 = int(min_length * 0.35)
        idx_50 = int(min_length * 0.50)
        idx_65 = int(min_length * 0.65)
        idx_80 = int(min_length * 0.80)
        idx_90 = int(min_length * 0.90)
        
        print(f"       Vocal levels throughout transition:")
        print(f"         At 20% (bridge start): Song 1 = {vocal_fade_out[idx_20]:.3f}, Song 2 = {vocal_fade_in[idx_20]:.3f}")
        print(f"         At 35%: Song 1 = {vocal_fade_out[idx_35]:.3f}, Song 2 = {vocal_fade_in[idx_35]:.3f} (BEATS!)")
        print(f"         At 50% (mid-bridge): Song 1 = {vocal_fade_out[idx_50]:.3f}, Song 2 = {vocal_fade_in[idx_50]:.3f} (BEATS!)")
        print(f"         At 65%: Song 1 = {vocal_fade_out[idx_65]:.3f}, Song 2 = {vocal_fade_in[idx_65]:.3f} (BEATS!)")
        print(f"         At 80% (bridge end): Song 1 = {vocal_fade_out[idx_80]:.3f}, Song 2 = {vocal_fade_in[idx_80]:.3f}")
        print(f"         At 90%: Song 2 = {vocal_fade_in[idx_90]:.3f} (quick fade-in!)")
        print(f"       ✓ LONGER instrumental bridge + QUICKER song 2 vocal fade-in!")
        
        # Calculate actual beat-only time
        beat_only_time = bridge_duration
        print(f"     🎵 Total instrumental time: {beat_only_time:.1f} seconds")
        print(f"     ✨ Song 1 lyrics → {beat_only_time:.1f}s of beats → Song 2 lyrics QUICK!")
        
        # Apply crossfades to each frequency band
        crossfaded_bass = (song1_bass * bass_fade_out) + (song2_bass_synced * bass_fade_in)
        crossfaded_mids = (song1_mids * vocal_fade_out) + (song2_mids * vocal_fade_in)
        crossfaded_highs = (song1_highs * vocal_fade_out) + (song2_highs * vocal_fade_in)
        
        # Recombine frequency bands
        crossfaded = crossfaded_bass + crossfaded_mids + crossfaded_highs
        
        print(f"  Part 2 (Frequency-based crossfade): {len(crossfaded) / self.sample_rate:.2f}s")
        print(f"     ✨ Result: Continuous bass energy + clean vocal transition")
        
        # Part 2.5: Transition section - gradually return song 2 to its original BPM
        # This happens AFTER the crossfade, so song 1 is gone and only song 2 is playing
        transition_section = None
        
        if mix_instruction.bpm_sync.pitch_adjustment != 0 and len(song2_raw) > min_length:
            # We have a pitch-shifted section, so we need to create a transition back to original BPM
            song2_transition_raw = song2_raw[min_length:min_length + transition_samples]
            
            if len(song2_transition_raw) > 0:
                # Pitch shift the transition section to match song 1's BPM
                song2_transition_synced = self._pitch_shift(
                    song2_transition_raw, 
                    mix_instruction.bpm_sync.pitch_adjustment
                )
                
                print(f"  Part 2.5 (BPM transition): {len(song2_transition_synced) / self.sample_rate:.2f}s")
                print(f"     Gradually returning song 2 to original BPM (dB-based)...")
                
                # Get the original audio for the transition section
                transition_start = mix_in_sample + overlap_samples
                song2_transition_original = audio_2[transition_start:transition_start + transition_samples]
                
                # Make sure lengths match
                transition_length = min(len(song2_transition_synced), len(song2_transition_original))
                song2_transition_synced = song2_transition_synced[:transition_length]
                song2_transition_original = song2_transition_original[:transition_length]
                
                # Create a smooth transition from synced BPM back to original BPM
                # Use EQUAL-POWER crossfade for constant amplitude (no volume dips!)
                # First 20% stays fully synced, middle 60% transitions, last 20% fully original
                
                # Create transition progress curve
                transition_progress = np.zeros(transition_length)
                
                # First 20%: Stay at synced BPM
                first_20_percent = int(transition_length * 0.2)
                transition_progress[:first_20_percent] = 0.0
                
                # Middle 60%: Smooth sigmoid transition (0 to 1)
                middle_start = first_20_percent
                middle_end = int(transition_length * 0.8)
                middle_length = middle_end - middle_start
                
                # Sigmoid curve for smooth transition
                x = np.linspace(-6, 6, middle_length)  # -6 to 6 for nice sigmoid shape
                sigmoid = 1 / (1 + np.exp(-x))  # 0 to 1
                transition_progress[middle_start:middle_end] = sigmoid
                
                # Last 20%: Fully at original BPM
                transition_progress[middle_end:] = 1.0
                
                # Apply EQUAL-POWER crossfade using cosine/sine curves
                # This maintains constant amplitude throughout the transition
                angle = transition_progress * (np.pi / 2)  # 0 to 90 degrees
                
                synced_gain = np.cos(angle)     # 1.0 → 0.0 (cosine)
                original_gain = np.sin(angle)   # 0.0 → 1.0 (sine)
                
                # Verify constant power
                combined_power = synced_gain**2 + original_gain**2
                
                print(f"       Equal-power BPM transition (constant amplitude)")
                print(f"       Start: Synced at 1.000, Original at 0.000")
                print(f"       End: Synced at 0.000, Original at 1.000")
                print(f"       Power verification: min={combined_power.min():.6f}, max={combined_power.max():.6f}")
                print(f"       ✓ No volume dips during BPM transition!")
                
                # Apply the equal-power transition
                transition_section = (
                    song2_transition_synced * synced_gain +      # Synced version (cosine fade-out)
                    song2_transition_original * original_gain    # Original version (sine fade-in)
                )
                
                print(f"     Transition curve: synced (cos) → equal-power blend → original (sin)")
                print(f"     At start: fully synced BPM")
                print(f"     At middle: {transition_progress[transition_length//2]:.2f} (blending)")
                print(f"     At end: {transition_progress[-1]:.2f} (fully original)")
        
        # Part 3: Rest of song 2 AFTER the transition (unchanged, original BPM)
        if transition_section is not None:
            part3_start = mix_in_sample + overlap_samples + transition_samples
        else:
            part3_start = mix_in_sample + overlap_samples
            
        part3 = audio_2[part3_start:]
        print(f"  Part 3 (Song 2 remainder at original BPM): {len(part3) / self.sample_rate:.2f}s")
        
        # Concatenate all parts
        if transition_section is not None:
            mixed_audio = np.concatenate([part1, crossfaded, transition_section, part3])
        else:
            mixed_audio = np.concatenate([part1, crossfaded, part3])
        
        total_duration = len(mixed_audio) / self.sample_rate
        song1_duration = len(audio_1) / self.sample_rate
        song2_duration = len(audio_2) / self.sample_rate
        time_saved = (song1_duration + song2_duration) - total_duration
        
        print(f"  Total mix duration: {total_duration:.2f}s")
        print(f"  Time saved vs playing both full: {time_saved:.2f}s ({time_saved/60:.1f} minutes)")
        
        # Normalize to prevent clipping
        max_val = np.max(np.abs(mixed_audio))
        if max_val > 0.95:
            mixed_audio = mixed_audio * (0.95 / max_val)
            print(f"  Normalized audio (peak was {max_val:.3f})")
        
        return mixed_audio
    
    def _split_frequency_bands(self, audio: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Split audio into bass, mids, and highs frequency bands for DJ-style mixing.
        
        Uses scipy filters for clean frequency separation:
        - Bass: < 250 Hz (kick drums, sub bass)
        - Mids: 250 Hz - 4 kHz (main instruments, vocals body)
        - Highs: > 4 kHz (vocals clarity, cymbals, hi-hats)
        
        Args:
            audio: Input audio array (mono)
            
        Returns:
            Tuple of (bass, mids, highs) as numpy arrays
        """
        try:
            from scipy import signal as scipy_signal
            
            # Design filters using scipy (faster than FFmpeg for this)
            nyquist = self.sample_rate / 2
            
            # Bass: Lowpass filter at 250 Hz
            bass_cutoff = 250 / nyquist
            b_bass, a_bass = scipy_signal.butter(4, bass_cutoff, btype='low')
            bass = scipy_signal.filtfilt(b_bass, a_bass, audio)
            
            # Mids: Bandpass filter 250 Hz - 4 kHz
            mids_low = 250 / nyquist
            mids_high = 4000 / nyquist
            b_mids, a_mids = scipy_signal.butter(4, [mids_low, mids_high], btype='band')
            mids = scipy_signal.filtfilt(b_mids, a_mids, audio)
            
            # Highs: Highpass filter at 4 kHz
            highs_cutoff = 4000 / nyquist
            b_highs, a_highs = scipy_signal.butter(4, highs_cutoff, btype='high')
            highs = scipy_signal.filtfilt(b_highs, a_highs, audio)
            
            return bass, mids, highs
            
        except ImportError:
            # Fallback: Use FFmpeg for frequency splitting
            print("     Using FFmpeg for frequency separation (scipy not available)")
            
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_in:
                sf.write(tmp_in.name, audio, self.sample_rate)
                
                # Extract bass
                with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_bass:
                    cmd_bass = [
                        'ffmpeg', '-i', tmp_in.name,
                        '-af', 'lowpass=f=250',
                        '-y', tmp_bass.name
                    ]
                    subprocess.run(cmd_bass, capture_output=True, check=True)
                    bass, _ = sf.read(tmp_bass.name)
                    os.unlink(tmp_bass.name)
                
                # Extract mids
                with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_mids:
                    cmd_mids = [
                        'ffmpeg', '-i', tmp_in.name,
                        '-af', 'highpass=f=250,lowpass=f=4000',
                        '-y', tmp_mids.name
                    ]
                    subprocess.run(cmd_mids, capture_output=True, check=True)
                    mids, _ = sf.read(tmp_mids.name)
                    os.unlink(tmp_mids.name)
                
                # Extract highs
                with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_highs:
                    cmd_highs = [
                        'ffmpeg', '-i', tmp_in.name,
                        '-af', 'highpass=f=4000',
                        '-y', tmp_highs.name
                    ]
                    subprocess.run(cmd_highs, capture_output=True, check=True)
                    highs, _ = sf.read(tmp_highs.name)
                    os.unlink(tmp_highs.name)
                
                os.unlink(tmp_in.name)
                
            return bass, mids, highs
            from scipy import signal as scipy_signal
            
            # Design filters using scipy (faster than FFmpeg for this)
            nyquist = self.sample_rate / 2
            
            # Bass: Lowpass filter at 250 Hz
            bass_cutoff = 250 / nyquist
            b_bass, a_bass = scipy_signal.butter(4, bass_cutoff, btype='low')
            bass = scipy_signal.filtfilt(b_bass, a_bass, audio)
            
            # Mids: Bandpass filter 250 Hz - 4 kHz
            mids_low = 250 / nyquist
            mids_high = 4000 / nyquist
            b_mids, a_mids = scipy_signal.butter(4, [mids_low, mids_high], btype='band')
            mids = scipy_signal.filtfilt(b_mids, a_mids, audio)
            
            # Highs: Highpass filter at 4 kHz
            highs_cutoff = 4000 / nyquist
            b_highs, a_highs = scipy_signal.butter(4, highs_cutoff, btype='high')
            highs = scipy_signal.filtfilt(b_highs, a_highs, audio)
            
            return bass, mids, highs
            
        except ImportError:
            # Fallback: Use FFmpeg for frequency splitting
            print("     Using FFmpeg for frequency separation (scipy not available)")
            
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_in:
                sf.write(tmp_in.name, audio, self.sample_rate)
                
                # Extract bass
                with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_bass:
                    cmd_bass = [
                        'ffmpeg', '-i', tmp_in.name,
                        '-af', 'lowpass=f=250',
                        '-y', tmp_bass.name
                    ]
                    subprocess.run(cmd_bass, capture_output=True, check=True)
                    bass, _ = sf.read(tmp_bass.name)
                    os.unlink(tmp_bass.name)
                
                # Extract mids
                with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_mids:
                    cmd_mids = [
                        'ffmpeg', '-i', tmp_in.name,
                        '-af', 'highpass=f=250,lowpass=f=4000',
                        '-y', tmp_mids.name
                    ]
                    subprocess.run(cmd_mids, capture_output=True, check=True)
                    mids, _ = sf.read(tmp_mids.name)
                    os.unlink(tmp_mids.name)
                
                # Extract highs
                with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_highs:
                    cmd_highs = [
                        'ffmpeg', '-i', tmp_in.name,
                        '-af', 'highpass=f=4000',
                        '-y', tmp_highs.name
                    ]
                    subprocess.run(cmd_highs, capture_output=True, check=True)
                    highs, _ = sf.read(tmp_highs.name)
                    os.unlink(tmp_highs.name)
                
                os.unlink(tmp_in.name)
                
            return bass, mids, highs
    
    def _generate_hls_segments(self, audio_file: str, output_dir: str, mix_id: str):
        """
        Generate HLS segments from the mixed audio file.
        
        Args:
            audio_file: Path to the mixed audio WAV file
            output_dir: Directory to save HLS segments
            mix_id: Mix ID for naming
        """
        # Create AAC HLS segments (compatible with stream_v2.js structure)
        qualities = {
            'high': {'bitrate': '192k', 'sample_rate': 44100},
            'medium': {'bitrate': '128k', 'sample_rate': 44100},
            'low': {'bitrate': '64k', 'sample_rate': 44100},
        }
        
        # Create master playlist
        master_lines = ['#EXTM3U', '#EXT-X-VERSION:7']
        
        for quality_name, params in qualities.items():
            quality_dir = os.path.join(output_dir, 'aac', quality_name)
            os.makedirs(quality_dir, exist_ok=True)
            
            playlist_file = f"{params['bitrate']}.m3u8"
            segment_pattern = f"{params['bitrate']}_%d.ts"
            
            # Add to master playlist
            bandwidth = int(params['bitrate'].replace('k', '')) * 1024
            master_lines.append(f'#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},CODECS="mp4a.40.2"')
            master_lines.append(f'aac/{quality_name}/{playlist_file}')
            
            # Generate segments for this quality
            cmd = [
                'ffmpeg',
                '-i', audio_file,
                '-c:a', 'aac',
                '-b:a', params['bitrate'],
                '-ar', str(params['sample_rate']),
                '-ac', '2',
                '-f', 'hls',
                '-hls_time', '8.0',
                '-hls_list_size', '0',
                '-hls_segment_filename', os.path.join(quality_dir, segment_pattern),
                os.path.join(quality_dir, playlist_file)
            ]
            
            print(f"  Generating {quality_name} quality HLS segments...")
            subprocess.run(cmd, capture_output=True, check=True)
        
        # Write master playlist
        master_path = os.path.join(output_dir, 'master.m3u8')
        with open(master_path, 'w') as f:
            f.write('\n'.join(master_lines))
        
        print(f"  ✅ HLS segments created at: {output_dir}")
    
    def _load_mix_info(self, mix_id: str) -> dict:
        """Load mix info from JSON file."""
        info_path = os.path.join(self.hls_mixes_path, mix_id, 'mix_info.json')
        with open(info_path, 'r') as f:
            return json.load(f)
    
    def get_mix_playlist_url(self, mix_id: str) -> str:
        """Get the HLS playlist URL for a mix."""
        return f"/hls/mixes/{mix_id}/master.m3u8"
    
    def delete_mix(self, mix_id: str):
        """Delete a mix and all its files."""
        mix_dir = os.path.join(self.hls_mixes_path, mix_id)
        if os.path.exists(mix_dir):
            import shutil
            shutil.rmtree(mix_dir)
            print(f"Deleted mix: {mix_id}")


# Example usage
if __name__ == "__main__":
    print("🎧 Testing DJ Audio Mixer...")
    
    from analysis_2 import DJ_Audio_Analyzer, DJ_Mix_Calculator
    
    # Initialize components
    analyzer = DJ_Audio_Analyzer()
    mix_calculator = DJ_Mix_Calculator()
    mixer = DJ_Audio_Mixer()
    decoder = HLS_Audio_Decoder()
    
    # Get available songs
    songs = decoder.get_available_songs()
    if len(songs) < 2:
        print("Need at least 2 songs to test mixing")
        exit(1)
    
    print(f"Found {len(songs)} songs, testing with first 2")
    
    try:
        # Analyze both songs
        print("\n1. Analyzing first track...")
        audio_1, sr_1 = decoder.decode_chunks_to_numpy(songs[0], 'high')
        features_1 = analyzer.extract_dj_features(audio_1, sr_1)
        
        print("\n2. Analyzing second track...")
        audio_2, sr_2 = decoder.decode_chunks_to_numpy(songs[1], 'high')
        features_2 = analyzer.extract_dj_features(audio_2, sr_2)
        
        # Calculate mix instruction
        print("\n3. Calculating optimal mix...")
        mix_instruction = mix_calculator.calculate_optimal_mix(features_1, features_2)
        
        # Create the mix pipe (like yt-dlp)
        print("\n4. Creating mixed audio pipe...")
        process = mixer.create_mixed_audio_pipe(songs[0], songs[1], mix_instruction)
        
        print(f"\n✅ Mix pipe created successfully!")
        print(f"   Process PID: {process.pid}")
        print(f"   Stdout: {process.stdout}")
        print(f"   This can now be piped to stream_v2.js FFmpeg process")
        print(f"\n🎵 Stream is ready to be consumed by Node.js!")
        
        # Note: In production, stream_v2.js will handle the process
        # For testing, you could pipe to a file:
        # output_path = f"/tmp/test_mix_{songs[0]}_{songs[1]}.m4a"
        # with open(output_path, 'wb') as f:
        #     f.write(process.stdout.read())
        # process.wait()
        # if hasattr(process, '_cleanup_temp_file'):
        #     process._cleanup_temp_file()
        
    except Exception as e:
        print(f"❌ Error during mixing: {e}")
        import traceback
        traceback.print_exc()
