import numpy as np
import scipy.io.wavfile as wavfile
import subprocess
import os
import tempfile

def generate_constant_noise_mp3():
    """
    Generate a 1-minute MP3 file with constant noise at around 30dB
    """
    # Audio parameters
    sample_rate = 44100  # CD quality
    duration = 60  # 1 minute in seconds
    
    # Calculate number of samples
    total_samples = int(sample_rate * duration)
    
    # Create time array
    t = np.linspace(0, duration, total_samples, False)
    
    # Generate constant noise (white noise) at ~30dB
    # For ~30dB, we need relatively low amplitude
    # 30dB corresponds to about 3.16% of full scale (0.0316)
    noise_amplitude = 0.03  # Approximately 30dB below full scale
    
    # Generate white noise
    noise = np.random.normal(0, noise_amplitude, total_samples)
    
    # Normalize to prevent clipping
    noise = np.clip(noise, -1.0, 1.0)
    
    # Convert to 16-bit PCM
    noise_16bit = (noise * 32767).astype(np.int16)
    
    # Create temporary WAV file first
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_wav:
        temp_wav_path = temp_wav.name
        wavfile.write(temp_wav_path, sample_rate, noise_16bit)
    
    # Output MP3 path
    output_mp3_path = "/Users/norbertzych/Desktop/Projects/study_sinc/audio/constant_noise_30db_1min.mp3"
    
    try:
        # Convert WAV to MP3 using ffmpeg
        # -q:a 2 sets high quality MP3 encoding (equivalent to ~190 kbps)
        subprocess.run([
            'ffmpeg', 
            '-i', temp_wav_path,
            '-q:a', '2',
            '-y',  # Overwrite output file if it exists
            output_mp3_path
        ], check=True, capture_output=True)
        
        print(f"Generated MP3 file: {output_mp3_path}")
        print(f"Duration: {duration} seconds")
        print(f"Sample rate: {sample_rate} Hz")
        print(f"Noise level: ~30dB (constant white noise)")
        print(f"File format: MP3")
        
        # Clean up temporary WAV file
        os.unlink(temp_wav_path)
        
        return output_mp3_path
        
    except subprocess.CalledProcessError as e:
        print(f"Error converting to MP3: {e}")
        print("Make sure ffmpeg is installed on your system")
        print("You can install it with: brew install ffmpeg")
        
        # Fallback: keep the WAV file
        fallback_path = "/Users/norbertzych/Desktop/Projects/study_sinc/audio/constant_noise_30db_1min.wav"
        os.rename(temp_wav_path, fallback_path)
        print(f"Created WAV file instead: {fallback_path}")
        return fallback_path
        
    except FileNotFoundError:
        print("ffmpeg not found. Please install it with: brew install ffmpeg")
        
        # Fallback: keep the WAV file
        fallback_path = "/Users/norbertzych/Desktop/Projects/study_sinc/audio/constant_noise_30db_1min.wav"
        os.rename(temp_wav_path, fallback_path)
        print(f"Created WAV file instead: {fallback_path}")
        return fallback_path

if __name__ == "__main__":
    generate_constant_noise_mp3()
