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
    
    def create_mixed_audio(
        self,
        song_id_1: str,
        song_id_2: str,
        mix_instruction: MixInstruction,
        quality: str = 'high'
    ) -> Tuple[str, dict]:
        """
        Create a mixed audio file from two songs using the mix instruction.
        
        Args:
            song_id_1: First song ID (current track)
            song_id_2: Second song ID (next track)
            mix_instruction: MixInstruction dataclass with mixing parameters
            quality: HLS quality to use for source audio
            
        Returns:
            Tuple of (mix_id, mix_info_dict)
        """
        print(f"🎛️  Creating DJ mix: {song_id_1} → {song_id_2}")
        
        # Generate mix ID
        mix_id = self.generate_mix_id(song_id_1, song_id_2, mix_instruction)
        mix_dir = os.path.join(self.hls_mixes_path, mix_id)
        
        # Check if mix already exists
        if os.path.exists(mix_dir) and os.path.exists(os.path.join(mix_dir, 'master.m3u8')):
            print(f"Mix already exists: {mix_id}")
            return mix_id, self._load_mix_info(mix_id)
        
        # Create mix directory
        os.makedirs(mix_dir, exist_ok=True)
        
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
        
        # Apply BPM sync (pitch shifting)
        print(f"Applying BPM sync: {mix_instruction.bpm_sync.sync_type.value}")
        if mix_instruction.bpm_sync.pitch_adjustment != 0:
            audio_2 = self._pitch_shift(
                audio_2, 
                mix_instruction.bpm_sync.pitch_adjustment
            )
        
        # Create the mix
        print(f"Creating crossfade mix...")
        mixed_audio = self._create_crossfade_mix(
            audio_1,
            audio_2,
            mix_instruction
        )
        
        # Save mixed audio as WAV (temporary)
        temp_wav = os.path.join(mix_dir, 'mixed.wav')
        sf.write(temp_wav, mixed_audio, self.sample_rate, subtype='PCM_16')
        
        # Generate HLS segments
        print(f"Generating HLS segments...")
        self._generate_hls_segments(temp_wav, mix_dir, mix_id)
        
        # Save mix info
        mix_info = {
            'mix_id': mix_id,
            'song_id_1': song_id_1,
            'song_id_2': song_id_2,
            'duration': len(mixed_audio) / self.sample_rate,
            'sample_rate': self.sample_rate,
            'mix_instruction': {
                'mix_out_time': mix_instruction.mix_out_point.time_seconds,
                'mix_in_time': mix_instruction.mix_in_point.time_seconds,
                'mix_type': mix_instruction.mix_type.value,
                'bpm_sync_type': mix_instruction.bpm_sync.sync_type.value,
                'pitch_adjustment': mix_instruction.bpm_sync.pitch_adjustment,
                'compatibility_score': mix_instruction.compatibility_score,
            }
        }
        
        with open(os.path.join(mix_dir, 'mix_info.json'), 'w') as f:
            json.dump(mix_info, f, indent=2)
        
        # Clean up temp WAV
        # os.remove(temp_wav)  # Keep it for now for debugging
        
        print(f"✅ Mix created successfully: {mix_id}")
        return mix_id, mix_info
    
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
        
        print(f"  Mix out at: {mix_instruction.mix_out_point.time_seconds:.2f}s")
        print(f"  Mix in at: {mix_instruction.mix_in_point.time_seconds:.2f}s")
        print(f"  Overlap: {mix_instruction.overlap_duration:.2f}s")
        
        # Part 1: Audio from song 1 before mix point
        part1 = audio_1[:mix_out_sample]
        
        # Part 2: Overlapping section with crossfade
        # Extract sections to crossfade
        song1_fade_out = audio_1[mix_out_sample:mix_out_sample + overlap_samples]
        song2_fade_in = audio_2[mix_in_sample:mix_in_sample + overlap_samples]
        
        # Make sure both sections are the same length
        min_length = min(len(song1_fade_out), len(song2_fade_in))
        song1_fade_out = song1_fade_out[:min_length]
        song2_fade_in = song2_fade_in[:min_length]
        
        # Create crossfade curve
        if mix_instruction.crossfade_curve == 'linear':
            fade_out_curve = np.linspace(1, 0, min_length)
            fade_in_curve = np.linspace(0, 1, min_length)
        elif mix_instruction.crossfade_curve == 'exponential':
            fade_out_curve = np.exp(np.linspace(0, -5, min_length))
            fade_in_curve = 1 - np.exp(np.linspace(0, -5, min_length))
        else:  # 'cut'
            # Quick cut with minimal fade
            cut_point = min_length // 2
            fade_out_curve = np.concatenate([np.ones(cut_point), np.zeros(min_length - cut_point)])
            fade_in_curve = 1 - fade_out_curve
        
        # Apply crossfade
        crossfaded = (song1_fade_out * fade_out_curve) + (song2_fade_in * fade_in_curve)
        
        # Part 3: Audio from song 2 after mix point
        part3_start = mix_in_sample + overlap_samples
        part3 = audio_2[part3_start:]
        
        # Concatenate all parts
        mixed_audio = np.concatenate([part1, crossfaded, part3])
        
        # Normalize to prevent clipping
        max_val = np.max(np.abs(mixed_audio))
        if max_val > 0.95:
            mixed_audio = mixed_audio * (0.95 / max_val)
        
        return mixed_audio
    
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
        
        # Create the mix
        print("\n4. Creating mixed audio file...")
        mix_id, mix_info = mixer.create_mixed_audio(songs[0], songs[1], mix_instruction)
        
        print(f"\n✅ Mix created successfully!")
        print(f"   Mix ID: {mix_id}")
        print(f"   Duration: {mix_info['duration']:.2f}s")
        print(f"   Playlist URL: {mixer.get_mix_playlist_url(mix_id)}")
        print(f"\n🎵 You can now play this mix in your player!")
        
    except Exception as e:
        print(f"❌ Error during mixing: {e}")
        import traceback
        traceback.print_exc()
