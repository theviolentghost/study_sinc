import numpy as np
import scipy.io.wavfile as wavfile
import os

def generate_test_audio():
    """
    Generate a 2-minute audio file:
    - First minute: quiet (near silence)
    - Second minute: noisy but quiet constant pitch at around 30dB
    """
    # Audio parameters
    sample_rate = 44100  # CD quality
    duration = 120  # 2 minutes in seconds
    
    # Calculate number of samples
    total_samples = int(sample_rate * duration)
    half_samples = total_samples // 2
    
    # Create time array
    t = np.linspace(0, duration, total_samples, False)
    
    # First minute: very quiet (near silence)
    # Generate very low amplitude white noise
    first_minute = np.random.normal(0, 0.001, half_samples)  # Very quiet noise
    
    # Second minute: noisy but quiet constant pitch at ~30dB
    # Generate a 440Hz tone (A4 note) with noise
    frequency = 440  # Hz
    second_minute_time = t[half_samples:]
    
    # Generate the base tone
    tone = np.sin(2 * np.pi * frequency * second_minute_time)
    
    # Add noise to the tone
    noise = np.random.normal(0, 0.1, half_samples)  # Background noise
    
    # Combine tone and noise
    second_minute = tone * 0.05 + noise  # Keep it quiet (~30dB)
    
    # Combine both parts
    audio_data = np.concatenate([first_minute, second_minute])
    
    # Normalize to prevent clipping
    audio_data = np.clip(audio_data, -1.0, 1.0)
    
    # Convert to 16-bit PCM
    audio_data_16bit = (audio_data * 32767).astype(np.int16)
    
    # Save the audio file
    output_path = "/Users/norbertzych/Desktop/Projects/study_sinc/audio/test_audio_quiet_noisy.wav"
    wavfile.write(output_path, sample_rate, audio_data_16bit)
    
    print(f"Generated audio file: {output_path}")
    print(f"Duration: {duration} seconds")
    print(f"Sample rate: {sample_rate} Hz")
    print("First minute: quiet (near silence)")
    print("Second minute: noisy constant pitch at ~440Hz (~30dB)")
    
    return output_path

if __name__ == "__main__":
    generate_test_audio()
