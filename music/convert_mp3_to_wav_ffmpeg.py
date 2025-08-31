#!/usr/bin/env python3

import os
import subprocess
import glob

def convert_mp3_to_wav_with_ffmpeg(input_folder="./storage/musik/temp.music"):
    """Convert all MP3 files in the specified folder to WAV format using ffmpeg."""
    
    # Get all MP3 files in the folder
    mp3_pattern = os.path.join(input_folder, "*.mp3")
    mp3_files = glob.glob(mp3_pattern, recursive=False)
    mp3_files = [os.path.basename(f) for f in mp3_files]
    
    if not mp3_files:
        print("❌ No MP3 files found in the directory.")
        return
    
    print(f"Found {len(mp3_files)} MP3 files to convert:")
    for mp3_file in mp3_files:
        print(f"  - {mp3_file}")
    
    print("\n🎵 Starting conversion with ffmpeg...")
    
    for i, mp3_file in enumerate(mp3_files, 1):
        try:
            # Full paths
            mp3_path = os.path.join(input_folder, mp3_file)
            wav_file = mp3_file.replace('.mp3', '.wav').replace('.MP3', '.wav')
            wav_path = os.path.join(input_folder, wav_file)
            
            print(f"[{i}/{len(mp3_files)}] Converting {mp3_file} -> {wav_file}")
            
            # Use ffmpeg to convert MP3 to WAV
            cmd = [
                '/opt/homebrew/bin/ffmpeg',
                '-i', mp3_path,           # Input file
                '-acodec', 'pcm_s16le',   # PCM 16-bit little-endian
                '-ar', '16000',           # Sample rate 16kHz (good for speech models)
                '-ac', '1',               # Mono audio
                '-y',                     # Overwrite output file if it exists
                wav_path                  # Output file
            ]
            
            # Run ffmpeg
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode == 0:
                print(f"✅ Successfully converted: {wav_file}")
            else:
                print(f"❌ Error converting {mp3_file}: {result.stderr}")
                
        except Exception as e:
            print(f"❌ Error converting {mp3_file}: {e}")
    
    print(f"\n🎉 Conversion complete!")
    
    # Show final directory contents
    print("\nFinal directory contents:")
    for file in sorted(os.listdir(input_folder)):
        if file.lower().endswith(('.mp3', '.wav')):
            file_path = os.path.join(input_folder, file)
            size_mb = os.path.getsize(file_path) / (1024 * 1024)
            print(f"  {file} ({size_mb:.1f} MB)")

if __name__ == "__main__":
    convert_mp3_to_wav_with_ffmpeg()
