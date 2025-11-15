"""
HLS Audio Decoder for DJ Analysis
Handles decoding and concatenating HLS playlist chunks (.ts files) for audio analysis
"""

import os
import numpy as np
import subprocess
import tempfile
from pathlib import Path
from typing import Tuple, Optional, List
import re


class HLS_Audio_Decoder:
    """Decodes HLS playlist chunks into numpy arrays for audio analysis."""
    
    def __init__(self, hls_base_path: str = None):
        """
        Initialize HLS Audio Decoder.
        
        Args:
            hls_base_path: Base path where HLS files are stored.
                          Defaults to project's storage/musik/hls/raw/
        """
        if hls_base_path is None:
            # Auto-detect based on script location
            project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            self.hls_base_path = os.path.join(project_root, 'storage', 'musik', 'hls', 'raw')
        else:
            self.hls_base_path = hls_base_path
            
        self.default_quality = 'high'  # Default to high quality (192k)
        self.sample_rate = 44100  # Target sample rate for analysis
        
    def get_available_songs(self) -> List[str]:
        """Get list of available song IDs in HLS storage."""
        if not os.path.exists(self.hls_base_path):
            return []
            
        return [d for d in os.listdir(self.hls_base_path) 
                if os.path.isdir(os.path.join(self.hls_base_path, d))]
    
    def get_song_path(self, song_id: str) -> Optional[str]:
        """Get the full path to a song's HLS directory."""
        song_path = os.path.join(self.hls_base_path, song_id)
        if os.path.exists(song_path):
            return song_path
        return None
    
    def get_playlist_info(self, song_id: str, quality: str = None) -> dict:
        """
        Get information about an HLS playlist.
        
        Args:
            song_id: Song identifier (directory name)
            quality: Quality level (ultra-low, low, medium, high, ultra-high)
                    If None, uses default_quality
            
        Returns:
            Dictionary with playlist information
        """
        if quality is None:
            quality = self.default_quality
            
        song_path = self.get_song_path(song_id)
        if not song_path:
            raise FileNotFoundError(f"Song ID '{song_id}' not found in {self.hls_base_path}")
        
        # Map quality to bitrate and directory
        quality_map = {
            'ultra-low': ('32k', '32k.m3u8'),
            'low': ('64k', '64k.m3u8'),
            'medium': ('128k', '128k.m3u8'),
            'high': ('192k', '192k.m3u8'),
            'ultra-high': ('256k', '256k.m3u8')
        }
        
        if quality not in quality_map:
            raise ValueError(f"Invalid quality '{quality}'. Must be one of: {list(quality_map.keys())}")
        
        bitrate, playlist_file = quality_map[quality]
        playlist_path = os.path.join(song_path, 'audio', 'aac', quality, playlist_file)
        
        if not os.path.exists(playlist_path):
            raise FileNotFoundError(f"Playlist not found: {playlist_path}")
        
        # Parse playlist to get chunk information
        chunks = []
        chunk_dir = os.path.dirname(playlist_path)
        
        with open(playlist_path, 'r') as f:
            duration = None
            for line in f:
                line = line.strip()
                if line.startswith('#EXTINF:'):
                    # Extract duration
                    duration = float(line.split(':')[1].split(',')[0])
                elif line and not line.startswith('#'):
                    # This is a chunk filename
                    chunk_path = os.path.join(chunk_dir, line)
                    if os.path.exists(chunk_path):
                        chunks.append({
                            'path': chunk_path,
                            'filename': line,
                            'duration': duration
                        })
        
        total_duration = sum(chunk['duration'] for chunk in chunks if chunk['duration'])
        
        return {
            'song_id': song_id,
            'quality': quality,
            'bitrate': bitrate,
            'playlist_path': playlist_path,
            'chunks': chunks,
            'num_chunks': len(chunks),
            'total_duration': total_duration
        }
    
    def decode_chunks_to_numpy(self, song_id: str, quality: str = None, 
                               max_duration: float = None) -> Tuple[np.ndarray, int]:
        """
        Decode HLS chunks to a numpy array.
        
        Args:
            song_id: Song identifier
            quality: Quality level to decode
            max_duration: Maximum duration in seconds to decode (None for full song)
            
        Returns:
            Tuple of (audio_array, sample_rate)
            audio_array shape: (num_samples, num_channels) or (num_samples,) for mono
        """
        playlist_info = self.get_playlist_info(song_id, quality)
        chunks = playlist_info['chunks']
        
        if not chunks:
            raise ValueError(f"No chunks found for song '{song_id}' at quality '{quality}'")
        
        # Filter chunks by max_duration if specified
        if max_duration is not None:
            filtered_chunks = []
            accumulated_duration = 0
            for chunk in chunks:
                if accumulated_duration >= max_duration:
                    break
                filtered_chunks.append(chunk)
                accumulated_duration += chunk['duration'] or 0
            chunks = filtered_chunks
        
        print(f"Decoding {len(chunks)} HLS chunks for song '{song_id}' (quality: {quality})...")
        
        # Use FFmpeg to concatenate and decode all chunks
        # This is more efficient than decoding chunks individually
        audio_array, sample_rate = self._decode_chunks_with_ffmpeg(chunks)
        
        print(f"Decoded audio: {audio_array.shape} at {sample_rate}Hz")
        return audio_array, sample_rate
    
    def _decode_chunks_with_ffmpeg(self, chunks: List[dict]) -> Tuple[np.ndarray, int]:
        """
        Use FFmpeg to concatenate and decode .ts chunks efficiently.
        
        Args:
            chunks: List of chunk dictionaries with 'path' keys
            
        Returns:
            Tuple of (audio_array, sample_rate)
        """
        # Create a temporary file list for FFmpeg concat
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
            concat_file = f.name
            for chunk in chunks:
                # FFmpeg concat requires paths to be escaped
                escaped_path = chunk['path'].replace("'", "'\\''")
                f.write(f"file '{escaped_path}'\n")
        
        try:
            # Use FFmpeg to concatenate and decode to raw PCM
            # -f concat: concatenate files
            # -safe 0: allow absolute paths
            # -i: input concat file
            # -f f32le: output as 32-bit float little-endian PCM
            # -acodec pcm_f32le: PCM codec
            # -ar: resample to target sample rate
            # -ac 2: force stereo output
            # pipe:1: output to stdout
            
            cmd = [
                'ffmpeg',
                '-f', 'concat',
                '-safe', '0',
                '-i', concat_file,
                '-f', 'f32le',
                '-acodec', 'pcm_f32le',
                '-ar', str(self.sample_rate),
                '-ac', '2',  # Stereo
                'pipe:1'
            ]
            
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True
            )
            
            # Convert raw PCM bytes to numpy array
            audio_data = np.frombuffer(result.stdout, dtype=np.float32)
            
            # Reshape to stereo (2 channels)
            audio_array = audio_data.reshape(-1, 2)
            
            return audio_array, self.sample_rate
            
        except subprocess.CalledProcessError as e:
            error_msg = e.stderr.decode('utf-8') if e.stderr else str(e)
            raise RuntimeError(f"FFmpeg decoding failed: {error_msg}")
        finally:
            # Clean up temporary concat file
            try:
                os.unlink(concat_file)
            except:
                pass
    
    def decode_to_mono(self, song_id: str, quality: str = None, 
                      max_duration: float = None) -> Tuple[np.ndarray, int]:
        """
        Decode HLS chunks to mono audio array.
        
        Args:
            song_id: Song identifier
            quality: Quality level to decode
            max_duration: Maximum duration in seconds to decode
            
        Returns:
            Tuple of (audio_array, sample_rate)
            audio_array shape: (num_samples,)
        """
        audio_array, sample_rate = self.decode_chunks_to_numpy(song_id, quality, max_duration)
        
        # Convert to mono by averaging channels
        if len(audio_array.shape) == 2 and audio_array.shape[1] == 2:
            audio_mono = np.mean(audio_array, axis=1)
        else:
            audio_mono = audio_array
            
        return audio_mono, sample_rate
    
    def list_song_qualities(self, song_id: str) -> List[str]:
        """
        List available quality levels for a song.
        
        Args:
            song_id: Song identifier
            
        Returns:
            List of available quality levels
        """
        song_path = self.get_song_path(song_id)
        if not song_path:
            return []
        
        aac_path = os.path.join(song_path, 'aac')
        if not os.path.exists(aac_path):
            return []
        
        available = []
        for quality in ['ultra-low', 'low', 'medium', 'high', 'ultra-high']:
            quality_path = os.path.join(aac_path, quality)
            if os.path.exists(quality_path):
                available.append(quality)
        
        return available
    
    def get_song_metadata(self, song_id: str) -> dict:
        """
        Get song metadata from properties.json if available.
        
        Args:
            song_id: Song identifier
            
        Returns:
            Dictionary with song metadata
        """
        song_path = self.get_song_path(song_id)
        if not song_path:
            return {}
        
        properties_file = os.path.join(song_path, 'properties.json')
        if os.path.exists(properties_file):
            import json
            with open(properties_file, 'r') as f:
                return json.load(f)
        
        return {}


# Utility functions for easy access
def decode_hls_song(song_id: str, quality: str = 'high', max_duration: float = None) -> Tuple[np.ndarray, int]:
    """
    Convenience function to decode an HLS song.
    
    Args:
        song_id: Song identifier (directory name in HLS storage)
        quality: Quality level (ultra-low, low, medium, high, ultra-high)
        max_duration: Maximum duration to decode in seconds
        
    Returns:
        Tuple of (audio_array, sample_rate)
    """
    decoder = HLS_Audio_Decoder()
    return decoder.decode_chunks_to_numpy(song_id, quality, max_duration)


def list_available_songs() -> List[str]:
    """Get list of all available song IDs in HLS storage."""
    decoder = HLS_Audio_Decoder()
    return decoder.get_available_songs()


if __name__ == "__main__":
    # Test the decoder
    print("🎵 HLS Audio Decoder Test")
    print("=" * 60)
    
    decoder = HLS_Audio_Decoder()
    
    # List available songs
    songs = decoder.get_available_songs()
    print(f"\nFound {len(songs)} songs in HLS storage:")
    for song in songs[:10]:  # Show first 10
        print(f"  - {song}")
    
    if songs:
        # Test decoding the first song
        test_song = songs[0]
        print(f"\nTesting decode of '{test_song}'...")
        
        # Show available qualities
        qualities = decoder.list_song_qualities(test_song)
        print(f"Available qualities: {qualities}")
        
        # Get playlist info
        playlist_info = decoder.get_playlist_info(test_song, 'high')
        print(f"\nPlaylist info:")
        print(f"  Quality: {playlist_info['quality']}")
        print(f"  Bitrate: {playlist_info['bitrate']}")
        print(f"  Number of chunks: {playlist_info['num_chunks']}")
        print(f"  Total duration: {playlist_info['total_duration']:.2f}s")
        
        # Decode first 30 seconds
        print(f"\nDecoding first 30 seconds...")
        audio_array, sample_rate = decoder.decode_chunks_to_numpy(test_song, 'high', max_duration=None)
        print(f"Successfully decoded: {audio_array.shape} at {sample_rate}Hz")
        print(f"Duration: {len(audio_array) / sample_rate:.2f}s")
        
        # Get metadata
        metadata = decoder.get_song_metadata(test_song)
        if metadata:
            print(f"\nMetadata:")
            for key in ['title', 'artist', 'duration']:
                if key in metadata:
                    print(f"  {key}: {metadata[key]}")
