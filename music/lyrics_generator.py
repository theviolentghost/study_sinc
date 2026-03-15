import faster_whisper as whisper
from hls_audio_decoder import HLS_Audio_Decoder
import numpy as np
from scipy import signal
import warnings

# Suppress numerical warnings from Whisper's feature extractor
# These are often false positives from edge cases in mel spectrogram calculation
warnings.filterwarnings('ignore', category=RuntimeWarning, module='faster_whisper')

class Lyrics:
    def __init__(self, info, blocks, lyrics_list):
        self.info = info
        self.lyrics = lyrics_list
        self.blocks = blocks  # per line basis
    
    def get_blocks_json(self):
        return [
            {
                "start_time": block.start,
                "end_time": block.end,
                "text_time": block.text,
                "probability": 1.0  # Placeholder, can be extended to include block-level confidence
            }
            for block in self.blocks
        ]
    
    def get_lyrics_json(self):
        return [
            [
                {
                    "start_time": lyric.start,
                    "end_time": lyric.end,
                    "text_time": lyric.text,
                    "probability": lyric.probability
                }
                for lyric in segment
            ]
            for segment in self.lyrics
        ]
    
    def get_info_json(self):
        return {
            "source": self.info.source,
            "duration": self.info.duration,
            "language_probabilities": self.info.language_probabilities
        }

    def to_json(self):
        return {
            "info": self.get_info_json(),
            "blocks": self.get_blocks_json(),
            "lyrics": self.get_lyrics_json()
        }

class Lyric:
    def __init__(self, start, end, text, probability=0.0):
        self.start = start
        self.end = end
        self.text = text
        self.probability = probability

class Block:
    def __init__(self, start, end, text):
        self.start = start
        self.end = end
        self.text = text

class Lyrics_Info:
    def __init__(self, duration, language_probabilities=None):
        self.source = "musik"
        self.duration = duration
        self.language_probabilities = language_probabilities[0:5] or []

class Lyrics_Transcriber:
    def __init__(self):
        # M1 best config
        self.model = whisper.WhisperModel(
            "base",
            device="cpu",
            compute_type="int8",
            num_workers=4,
            cpu_threads=4
        )
    
    def transcribe(self, audio_input, original_sample_rate=44100, silence_threshold=6.5):
        """
        Transcribe audio to lyrics with timestamps.
        
        Args:
            audio_input: Can be either:
                - str/Path: File path to audio file
                - numpy.ndarray: Audio data as numpy array (float32, shape: (samples,) or (samples, channels))
            original_sample_rate: Sample rate of input audio (default: 44100Hz for HLS)
            silence_threshold: Minimum silence duration (seconds) to insert blank line
        
        Returns:
            Lyrics object with blocks and word-level timestamps
        """
        # Check if input is numpy array or file path
        print("Transcribing audio...")
        if isinstance(audio_input, np.ndarray):
            print(f"Input audio shape: {audio_input.shape}, dtype: {audio_input.dtype}")
            
            # Ensure audio is float32
            if audio_input.dtype != np.float32:
                audio_input = audio_input.astype(np.float32)
            
            # If stereo, convert to mono by averaging channels
            if len(audio_input.shape) > 1 and audio_input.shape[1] > 1:
                print(f"Converting stereo to mono...")
                audio_input = audio_input.mean(axis=1)
            
            # Whisper expects audio in range [-1, 1]
            # If audio is in range [0, 1] or [-32768, 32767], normalize it
            max_val = np.abs(audio_input).max()
            if max_val > 1.0:
                print(f"Normalizing audio (max value: {max_val})...")
                audio_input = audio_input / max_val
            elif max_val < 1e-8:
                # Audio is essentially silent, add tiny noise to prevent divide-by-zero
                print(f"Audio has very low amplitude (max: {max_val}), adding noise floor...")
                audio_input = audio_input + np.random.normal(0, 1e-8, audio_input.shape).astype(np.float32)
            
            # Resample to 16000Hz (Whisper's expected sample rate)
            if original_sample_rate != 16000:
                print(f"Resampling from {original_sample_rate}Hz to 16000Hz...")
                # Use a simple linear interpolation which is more numerically stable
                # Calculate number of samples after resampling
                duration_seconds = len(audio_input) / original_sample_rate
                num_samples = int(duration_seconds * 16000)
                
                # Create time arrays for interpolation
                original_time = np.linspace(0, duration_seconds, len(audio_input))
                target_time = np.linspace(0, duration_seconds, num_samples)
                
                # Linear interpolation (more stable than FFT-based resampling)
                audio_input = np.interp(target_time, original_time, audio_input).astype(np.float32)
                print(f"Resampled audio shape: {audio_input.shape}")
            
            # Clean up audio data to prevent numerical issues
            # Remove any NaN or inf values
            audio_input = np.nan_to_num(audio_input, nan=0.0, posinf=1.0, neginf=-1.0)
            
            # Ensure audio is in valid range [-1, 1]
            audio_input = np.clip(audio_input, -1.0, 1.0)
            
            # Add a tiny DC offset removal (remove mean) to prevent drift
            audio_input = audio_input - audio_input.mean()
            
            # Add tiny noise floor to prevent completely silent sections from causing numerical issues
            # This helps prevent divide-by-zero in mel spectrogram calculation
            noise_floor = 1e-7
            audio_input = audio_input + np.random.normal(0, noise_floor, audio_input.shape).astype(np.float32)
            
            # Ensure it's contiguous in memory and float32
            audio_input = np.ascontiguousarray(audio_input, dtype=np.float32)
            
        segments, info = self.model.transcribe(
            audio=audio_input,  # Can accept both numpy array or file path
            word_timestamps=True,
            beam_size=5,              
            best_of=3,                
            patience=1.0,             
            length_penalty=1.1,       
            temperature=0.0,         
            compression_ratio_threshold=2.2,  
            log_prob_threshold=-1.0, 
            no_speech_threshold=0.6,  
            condition_on_previous_text=False,  
            vad_filter=True,          
            vad_parameters=dict(
                threshold=0.0,        
                min_speech_duration_ms=120,  
                min_silence_duration_ms=2000  
            )
        )
        
        segment_list = list(segments)
        
        # Create blocks with silence gaps
        blocks = []
        lyrics_list = []
        
        for i, segment in enumerate(segment_list):
            # Add current segment as a block
            blocks.append(Block(segment.start, segment.end, segment.text))
            
            # Add word-level lyrics for this segment
            word_lyrics = [
                Lyric(word.start, word.end, word.word, word.probability) 
                for word in segment.words
            ]
            lyrics_list.append(word_lyrics)
            
            # Check if there's a next segment and add silence block if gap is large
            if i < len(segment_list) - 1:
                next_segment = segment_list[i + 1]
                gap = next_segment.start - segment.end
                
                # If gap is long enough, insert silence block
                if gap >= silence_threshold:
                    silence_block = Block(
                        start=segment.end,
                        end=next_segment.start,
                        text=""  
                    )
                    blocks.append(silence_block)
                    # Add empty lyrics list for silence block
                    lyrics_list.append([])
        
        print(f"Found {len(segment_list)} segments, created {len(blocks)} blocks (including silence)")
        print("Final Transcription Segments:")
        for block in blocks:
            print(f"[{block.start:.2f}-{block.end:.2f}] {block.text}")

        return Lyrics(
            Lyrics_Info(info.duration, info.all_language_probs),
            blocks,
            lyrics_list
        )

    def decode_to_numpy(self, song_id, extension="wav"):
        decoder = HLS_Audio_Decoder()
        return decoder.decode_chunks_to_numpy(song_id, 'low')

if __name__ == "__main__":
    trans = Lyrics_Transcriber()
    lyrics = trans.transcribe("/Users/norbertzych/Desktop/Projects/study_sinc/storage/musik/temp.music/alesso.mp3")
    for block in lyrics.blocks:
        print(f"[{block.start:.2f}-{block.end:.2f}]{block.text}")
