#!/usr/bin/env python3
"""
Test script for DJ mixer pipe functionality
Tests that the mixer creates a subprocess.Popen with stdout that can be piped
"""

import os
import sys

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dj_mixer import DJ_Audio_Mixer
from analysis_2 import DJ_Audio_Analyzer, DJ_Mix_Calculator
from hls_audio_decoder import HLS_Audio_Decoder


def test_dj_mix_pipe():
    """Test creating a DJ mix pipe (like yt-dlp output)"""
    print("🎧 Testing DJ Mix Pipe Creation...")
    print("=" * 60)
    
    # Initialize components
    analyzer = DJ_Audio_Analyzer()
    mix_calculator = DJ_Mix_Calculator()
    mixer = DJ_Audio_Mixer()
    decoder = HLS_Audio_Decoder()
    
    # Get available songs
    # songs = decoder.get_available_songs()
    songs = ['DXnS8mqUDyQ', 'oygrmJFKYZY']
    if len(songs) < 2:
        print("❌ Need at least 2 songs to test mixing")
        return False
    
    print(f"✅ Found {len(songs)} songs")
    print(f"   Testing with: {songs[0]} → {songs[1]}")
    print()
    
    try:
        # Analyze both songs
        print("Step 1: Analyzing first track...")
        audio_1, sr_1 = decoder.decode_chunks_to_numpy(songs[0], 'high')
        features_1 = analyzer.extract_dj_features(audio_1, sr_1)
        print(features_1.keys())
        print(f"   ✅ BPM: {features_1['bpm']:.1f}, Key: {features_1['key']}, Scale: {features_1['scale']}")
        print(f"   ✅ Camelot: {features_1['camelot_key']}, key_strength: {features_1['key_strength']:.2f}")

        print("\nStep 2: Analyzing second track...")
        audio_2, sr_2 = decoder.decode_chunks_to_numpy(songs[1], 'high')
        features_2 = analyzer.extract_dj_features(audio_2, sr_2)
        print(f"   ✅ BPM: {features_2['bpm']:.1f}, Key: {features_2['key']}, Scale: {features_2['scale']}")
        print(f"   ✅ Camelot: {features_2['camelot_key']}, key_strength: {features_2['key_strength']:.2f}")
        
        # Calculate mix instruction
        print("\nStep 3: Calculating optimal mix...")
        mix_instruction = mix_calculator.calculate_optimal_mix(features_1, features_2)
        print(f"   ✅ Mix out: {mix_instruction.mix_out_point.time_seconds:.2f}s (bar {mix_instruction.mix_out_point.bar_position}, phrase {mix_instruction.mix_out_point.phrase_position})")
        print(f"   ✅ Mix in: {mix_instruction.mix_in_point.time_seconds:.2f}s (bar {mix_instruction.mix_in_point.bar_position}, phrase {mix_instruction.mix_in_point.phrase_position})")
        print(f"   ✅ Overlap: {mix_instruction.overlap_duration:.2f}s")
        print(f"   ✅ Crossfade: {mix_instruction.crossfade_curve}")
        print(f"   ✅ BPM sync: {mix_instruction.bpm_sync.sync_type.value} ({mix_instruction.bpm_sync.pitch_adjustment:+.2f}%)")
        print(f"   ✅ Energy out: {mix_instruction.mix_out_point.energy_level:.2f}, in: {mix_instruction.mix_in_point.energy_level:.2f}")
        print(f"   ✅ Confidence: {mix_instruction.mix_out_point.confidence:.2f} / {mix_instruction.mix_in_point.confidence:.2f}")

        # Create the mix pipe
        print("\nStep 4: Creating mixed audio pipe...")
        
        # Ask user for mix style
        print("\n🎚️  Choose mix style:")
        print("   1. Quick (3-5 seconds) - Fast, energetic transitions")
        print("   2. Balanced (6-10 seconds) - Professional, smooth [DEFAULT]")
        print("   3. Extended (10-16 seconds) - Long, gradual blends")
        print("   4. Long (16-24 seconds) - Very smooth, club style")
        
        # For testing, just use balanced
        # style_choice = input("\nEnter choice (1-4, default=2): ").strip() or "2"
        style_choice = "1"  # Auto-select balanced for testing
        
        style_map = {
            "1": "quick",
            "2": "balanced",
            "3": "extended",
            "4": "long"
        }
        
        mix_style = style_map.get(style_choice, "balanced")
        print(f"\nUsing mix style: {mix_style.upper()}")
        
        process = mixer.create_mixed_audio_pipe(songs[0], songs[1], mix_instruction, mix_style=mix_style)
        
        print(f"\n{'=' * 60}")
        print("✅ SUCCESS! DJ Mix Pipe Created")
        print(f"{'=' * 60}")
        print(f"Process PID: {process.pid}")
        print(f"Process stdout: {process.stdout}")
        print(f"Process stderr: {process.stderr}")
        print(f"Temp WAV path: {process._temp_wav_path}")
        print()
        print("📌 This subprocess can now be used by stream_v2.js")
        print("   Just like it uses yt-dlp processes!")
        print()
        print("   Example usage in Node.js:")
        print("   const audio_process = mixer.create_mixed_audio_pipe(...)")
        print("   const ffmpeg_process = await this.create_ffmpeg_process(")
        print("       audio_process,  // <-- Use the Python subprocess here")
        print("       output_directory, video_id, codecs, profiles")
        print("   )")
        print()
        
        # Optional: Save output to test file
        # save_test = input("💾 Save mix to test file? (y/n): ").strip().lower() == 'y'
        save_test = False
        if save_test:
            output_path = f"/tmp/test_dj_mix_{songs[0]}_{songs[1]}.m4a"
            print(f"\nSaving to: {output_path}")
            with open(output_path, 'wb') as f:
                chunk_size = 8192
                total_bytes = 0
                while True:
                    chunk = process.stdout.read(chunk_size)
                    if not chunk:
                        break
                    f.write(chunk)
                    total_bytes += len(chunk)
                    print(f"\r   Written: {total_bytes / 1024 / 1024:.2f} MB", end='', flush=True)
            
            print(f"\n✅ Saved: {output_path}")
            print(f"   Size: {total_bytes / 1024 / 1024:.2f} MB")
            
            # Wait for process to complete
            process.wait()
            print(f"   FFmpeg exit code: {process.returncode}")
            
            # Cleanup
            if hasattr(process, '_cleanup_temp_file'):
                process._cleanup_temp_file()
            
            # Test playback with ffprobe
            print("\n🔍 Testing file integrity with ffprobe...")
            import subprocess
            probe = subprocess.run(
                ['ffprobe', '-v', 'error', '-show_format', '-show_streams', output_path],
                capture_output=True,
                text=True
            )
            if probe.returncode == 0:
                print("   ✅ File is valid and playable!")
            else:
                print(f"   ⚠️  File may have issues: {probe.stderr}")
        else:
            print("\nSkipping file save. Process is ready but not consumed.")
            print("⚠️  Remember to consume the stdout or the process will block!")
        
        return True
        
    except Exception as e:
        print(f"\n❌ Error during test: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = test_dj_mix_pipe()
    sys.exit(0 if success else 1)
