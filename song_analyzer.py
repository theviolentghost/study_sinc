import os
import tempfile
import subprocess
import glob
import json
import numpy as np

try:
    import librosa
except ImportError:
    print("Error: The 'librosa' library is not installed. Please install it with: pip install librosa")
    exit(1)

SAMPLE_RATE = 22050
HOP_LENGTH  = 512
N_FFT       = 64 


def convert_hls_to_wav(ts_files, output_wav):
    if not ts_files:
        raise ValueError("No .ts files provided.")

    ts_files = sorted(ts_files)

    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        for ts_file in ts_files:
            f.write(f"file '{os.path.abspath(ts_file)}'\n")
        list_file = f.name

    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-f", "concat", "-safe", "0",
                "-i", list_file,
                "-vn", "-acodec", "pcm_s16le",
                "-ar", str(SAMPLE_RATE), "-ac", "1",
                output_wav,
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    finally:
        if os.path.exists(list_file):
            os.remove(list_file)


def detect_bpm(y, sr):
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP_LENGTH)

    tempo = librosa.feature.tempo(
        onset_envelope=onset_env,
        sr=sr,
        hop_length=HOP_LENGTH,
        start_bpm=120,
    )
    tempo = float(tempo.item()) if hasattr(tempo, "item") else float(tempo)

    if tempo < 90:
        tempo *= 2
    elif tempo > 200:
        tempo /= 2

    _, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_env,
        sr=sr,
        hop_length=HOP_LENGTH,
        bpm=tempo,
        tightness=100,
    )

    return tempo, beat_frames


def analyze_audio(wav_path):
    print("Loading audio...")
    y, sr = librosa.load(wav_path, sr=SAMPLE_RATE, mono=True)

    print("Detecting tempo...")
    bpm, beat_frames = detect_bpm(y, sr)

    print("Extracting relational features...")
    zcr               = float(np.mean(librosa.feature.zero_crossing_rate(y=y)))
    spectral_centroid = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))
    spectral_bandwidth= float(np.mean(librosa.feature.spectral_bandwidth(y=y, sr=sr)))
    spectral_rolloff  = float(np.mean(librosa.feature.spectral_rolloff(y=y, sr=sr)))
    spectral_contrast = float(np.mean(librosa.feature.spectral_contrast(y=y, sr=sr)))
    rms_energy        = float(np.mean(librosa.feature.rms(y=y)))
    y_harm, y_perc    = librosa.effects.hpss(y)
    harmonic_ratio    = float(np.mean(np.abs(y_harm)))
    percussive_ratio  = float(np.mean(np.abs(y_perc)))

    print("Computing 128-bin FFT visualizer...")

    # Full STFT with n_fft=256 → 128 positive-frequency bins × n_frames
    S = np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=HOP_LENGTH))
    # S shape: (129, n_frames) — drop DC bin 0, keep bins 1..128
    S = S[1:129, :]           # → (128, n_frames)
    n_frames = S.shape[1]

    # Per-bin normalization: each of the 128 bins gets its own max so every
    # frequency range has full 0-1 dynamic range regardless of absolute energy.
    bin_max = S.max(axis=1, keepdims=True)
    bin_max[bin_max == 0] = 1  # avoid divide-by-zero on silent bins
    S_norm = S / bin_max       # → (128, n_frames), values in [0, 1]

    # Transpose to (n_frames, 128) for JSON serialisation as a list-of-lists
    fft_frames = S_norm.T      # → (n_frames, 128)

    # Beat frames clipped to actual STFT length
    valid_beats = beat_frames[beat_frames < n_frames]
    downbeats   = valid_beats[::4]

    # Per-beat amplitude: RMS energy at each beat frame, normalised 0-1
    # Use a small window (±2 frames) around each beat for stability
    window = 2
    beat_rms = []
    for f in valid_beats:
        lo = max(0, f - window)
        hi = min(n_frames, f + window + 1)
        beat_rms.append(float(np.sqrt(np.mean(S[:, lo:hi] ** 2))))

    beat_rms = np.array(beat_rms, dtype=float)
    rms_max  = beat_rms.max()
    if rms_max > 0:
        beat_rms /= rms_max

    # Same for downbeats
    downbeat_rms = []
    for f in downbeats:
        lo = max(0, f - window)
        hi = min(n_frames, f + window + 1)
        downbeat_rms.append(float(np.sqrt(np.mean(S[:, lo:hi] ** 2))))

    downbeat_rms = np.array(downbeat_rms, dtype=float)
    db_max = downbeat_rms.max()
    if db_max > 0:
        downbeat_rms /= db_max

    frame_duration = HOP_LENGTH / sr

    print(f"Done — {n_frames} frames, {len(valid_beats)} beats, 128 FFT bins")

    return {
        "relational_features": {
            "bpm":                    bpm,
            "noise_zero_crossing_rate": zcr,
            "spectral_centroid":      spectral_centroid,
            "spectral_bandwidth":     spectral_bandwidth,
            "spectral_rolloff":       spectral_rolloff,
            "spectral_contrast":      spectral_contrast,
            "rms_energy":             rms_energy,
            "harmonic_ratio":         harmonic_ratio,
            "percussive_ratio":       percussive_ratio,
        },
        "timing": {
            "sample_rate":    sr,
            "hop_length":     HOP_LENGTH,
            "frame_duration": frame_duration,
            "frame_count":    n_frames,
            "fft_bins":       128,
            "subsample_ratio": 1,
        },
        "beats": {
            # parallel arrays: frame index + normalized amplitude
            "beat_frames":      valid_beats.tolist(),
            "beat_amplitudes":  beat_rms.tolist(),
            "downbeat_frames":  downbeats.tolist(),
            "downbeat_amplitudes": downbeat_rms.tolist(),
        },
        # (128, n_frames) stored as list[list[float]] — outer index = frame
        "fft_frames": fft_frames.tolist(),
    }


def analyze_audio_for_song(song_id):
    base_path     = os.path.join(os.getcwd(), f"storage/musik/hls/raw/{song_id}")
    analysis_file = os.path.join(base_path, "analysis.json")

    print(f"Analyzing: {song_id}")

    if os.path.exists(analysis_file):
        print("Using cached analysis")
        with open(analysis_file, "r") as f:
            return json.load(f)

    audio_path = os.path.join(base_path, "audio/aac/ultra-low")
    if not os.path.exists(audio_path):
        print("Audio directory not found")
        return None

    ts_files = glob.glob(os.path.join(audio_path, "*.ts"))
    if not ts_files:
        print("No TS files found")
        return None

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        wav_path = tmp.name

    try:
        convert_hls_to_wav(ts_files, wav_path)
        result = analyze_audio(wav_path)

        with open(analysis_file, "w") as f:
            json.dump(result, f, indent=2)

        print(f"Analysis saved to {analysis_file}")
        return result

    finally:
        if os.path.exists(wav_path):
            os.remove(wav_path)


if __name__ == "__main__":
    analyze_audio_for_song("LBhcqYqeu0U")