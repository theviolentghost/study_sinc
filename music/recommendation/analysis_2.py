import numpy as np
# import faiss
import glob
import os
import pickle
import threading
import concurrent.futures
import tempfile

import essentia
import essentia.standard as es
import subprocess
# from sklearn.decomposition import PCA

essentia.log.warningActive = False
essentia.log.infoActive = False
essentia.log.debugActive = False
essentia.log.errorActive = True

class Audio_Analyzer:
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    
    def __init__(self):
        self.music_extractor = es.MusicExtractor(
            lowlevelStats=['mean', 'stdev'],
            rhythmStats=['mean', 'stdev'],
            tonalStats=['mean', 'stdev'],
            lowlevelFrameSize=2048,
            lowlevelHopSize=1024
        )
        self.feature_groups = self.get_discriminative_features()
        self.embedding_dimensions = 162  # Actual extracted feature dimension
        
        # For incremental normalization - scalable approach
        self.running_stats = Running_Stats()

    def get_discriminative_features(self): 
        spectral_features = [
            'lowlevel.spectral_centroid.mean', 'lowlevel.spectral_centroid.stdev',
            'lowlevel.spectral_spread.mean', 'lowlevel.spectral_spread.stdev',
            'lowlevel.spectral_skewness.mean', 'lowlevel.spectral_skewness.stdev',
            'lowlevel.spectral_kurtosis.mean', 'lowlevel.spectral_kurtosis.stdev',
            'lowlevel.spectral_rolloff.mean', 'lowlevel.spectral_rolloff.stdev',
            'lowlevel.spectral_flux.mean', 'lowlevel.spectral_flux.stdev',
            'lowlevel.spectral_complexity.mean', 'lowlevel.spectral_complexity.stdev',
            'lowlevel.spectral_entropy.mean', 'lowlevel.spectral_entropy.stdev',
            'lowlevel.hfc.mean', 'lowlevel.hfc.stdev',  # High Frequency Content
        ]
        
        # MEL-FREQUENCY FEATURES - Most important for music similarity
        mel_features = [
            'lowlevel.mfcc.mean',  # 13 coefficients - most discriminative
            'lowlevel.melbands.mean',  # Mel-scale energy distribution
            'lowlevel.melbands_crest.mean', 'lowlevel.melbands_crest.stdev',
            'lowlevel.melbands_flatness_db.mean', 'lowlevel.melbands_flatness_db.stdev',
            'lowlevel.melbands_kurtosis.mean', 'lowlevel.melbands_skewness.mean',
        ]
        
        # HARMONIC/TONAL FEATURES - Musical content
        tonal_features = [
            'tonal.hpcp.mean',  # Harmonic Pitch Class Profile - 12 values
            'tonal.hpcp_entropy.mean', 'tonal.hpcp_entropy.stdev',
            'tonal.hpcp_crest.mean', 'tonal.hpcp_crest.stdev',
            'tonal.chords_strength.mean', 'tonal.chords_strength.stdev',
            'tonal.chords_changes_rate', 'tonal.chords_number_rate',
            'tonal.key_edma.strength', 'tonal.key_krumhansl.strength',
            'tonal.tuning_frequency', 'tonal.tuning_equal_tempered_deviation',
        ]
        
        # RHYTHMIC FEATURES - Temporal characteristics
        rhythm_features = [
            'rhythm.bpm', 'rhythm.danceability', 'rhythm.onset_rate',
            'rhythm.beats_loudness.mean', 'rhythm.beats_loudness.stdev',
            'rhythm.bpm_histogram_first_peak_bpm', 'rhythm.bpm_histogram_first_peak_weight',
            'rhythm.bpm_histogram_second_peak_bpm', 'rhythm.bpm_histogram_second_peak_weight',
        ]
        
        # LOUDNESS/DYNAMICS - Energy characteristics
        dynamics_features = [
            'lowlevel.average_loudness', 'lowlevel.dynamic_complexity',
            'lowlevel.loudness_ebu128.integrated', 'lowlevel.loudness_ebu128.loudness_range',
            'lowlevel.spectral_energy.mean', 'lowlevel.spectral_energy.stdev',
            'lowlevel.spectral_rms.mean', 'lowlevel.spectral_rms.stdev',
        ]
        
        # ADVANCED SPECTRAL - Perceptual characteristics
        perceptual_features = [
            'lowlevel.dissonance.mean', 'lowlevel.dissonance.stdev',
            'lowlevel.pitch_salience.mean', 'lowlevel.pitch_salience.stdev',
            'lowlevel.zerocrossingrate.mean', 'lowlevel.zerocrossingrate.stdev',
            'lowlevel.spectral_contrast_coeffs.mean',  # Spectral contrast
            'lowlevel.spectral_strongpeak.mean', 'lowlevel.spectral_strongpeak.stdev',
        ]
        
        # FREQUENCY BAND ENERGY - Different perceptual scales
        band_features = [
            'lowlevel.spectral_energyband_low.mean', 'lowlevel.spectral_energyband_middle_low.mean',
            'lowlevel.spectral_energyband_middle_high.mean', 'lowlevel.spectral_energyband_high.mean',
            'lowlevel.barkbands_crest.mean', 'lowlevel.erbbands_crest.mean',
        ]
        
        return {
            'spectral': spectral_features,
            'mel': mel_features,
            'tonal': tonal_features,
            'rhythm': rhythm_features,
            'dynamics': dynamics_features,
            'perceptual': perceptual_features,
            'bands': band_features
        }

    def decode_to_numpy(self, source: str, sample_rate: int = 44100, channels: int = 1, duration: float | None = None):
        """
        Decode any ffmpeg-readable source (file or URL like m3u8) to a mono float32 numpy array.
        """
        cmd = [
            "ffmpeg", "-i", source, "-f", "f32le",
            "-acodec", "pcm_f32le", "-ar", str(sample_rate), "-ac", str(channels), "-loglevel", "error", "-"
        ]
        if duration:
            # simple insertion of -t before output
            cmd.insert(3, "-t")
            cmd.insert(4, str(duration))
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        raw = p.stdout.read()
        p.stdout.close()
        p.wait()
        if p.returncode != 0:
            err = p.stderr.read().decode(errors='ignore')
            p.stderr.close()
            raise RuntimeError(f"ffmpeg failed: {err}")
        audio = np.frombuffer(raw, dtype=np.float32)
        if channels > 1:
            audio = audio.reshape(-1, channels).mean(axis=1)  # convert to mono
        return audio, sample_rate
    
    def extract_raw_features_from_array(self, audio_array: np.ndarray, sample_rate: int = 44100):
        """
        Extract raw features from a numpy audio array.
        Falls back to writing a temporary WAV if MusicExtractor can't be called
        with an in-memory essentia.array.
        """
        try:
            ess_audio = essentia.array(audio_array.astype(np.float32))
            
            # MusicExtractor expects a filename, not an audio array.
            # Use fallback: write to temp WAV and extract from file.
            try:
                import soundfile as sf
            except ImportError as e:
                raise RuntimeError("soundfile not available for WAV fallback; install via 'pip install soundfile'") from e
            
            tmpf = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
            tmp_path = tmpf.name
            tmpf.close()
            sf.write(tmp_path, audio_array, sample_rate, subtype='PCM_16')
            try:
                features, _ = self.music_extractor(tmp_path)
            finally:
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass
            
            embedding_parts = []
            
            for group_name, feature_list in self.feature_groups.items():
                for feature_name in feature_list:
                    try:
                        value = features[feature_name]
                        if isinstance(value, (list, np.ndarray)):
                            embedding_parts.extend(np.array(value).flatten())
                        else:
                            embedding_parts.append(float(value))
                    except KeyError:
                        # Use zeros for missing features (matching analysis.py)
                        if 'mfcc' in feature_name:
                            embedding_parts.extend([0.0] * 13)
                        elif 'melbands' in feature_name:
                            embedding_parts.extend([0.0] * 40)
                        elif 'hpcp' in feature_name:
                            embedding_parts.extend([0.0] * 36)
                        else:
                            embedding_parts.append(0.0)
                        continue
            
            if len(embedding_parts) != self.embedding_dimensions:
                raise ValueError(f"Expected {self.embedding_dimensions} features, got {len(embedding_parts)}")
            
            return np.array(embedding_parts, dtype=np.float32)
        except Exception as e:
            print(f"Error processing audio array: {e}")
            return None

    def extract_raw_features(self, audio_path):
        try:
            # ess_audio = essentia.array(audio_array.astype(np.float32))
            # features, _ = self.music_extractor(ess_audio)
            
            features, _ = self.music_extractor(audio_path)

            embedding_parts = []
            
            for group_name, feature_list in self.feature_groups.items():
                for feature_name in feature_list:
                    try:
                        value = features[feature_name]
                        if isinstance(value, (list, np.ndarray)):
                            embedding_parts.extend(np.array(value).flatten())
                        else:
                            embedding_parts.append(float(value))
                    except KeyError:
                        # Use zeros for missing features (matching analysis.py)
                        if 'mfcc' in feature_name:
                            embedding_parts.extend([0.0] * 13)
                        elif 'melbands' in feature_name:
                            embedding_parts.extend([0.0] * 40)
                        elif 'hpcp' in feature_name:
                            embedding_parts.extend([0.0] * 36)
                        else:
                            embedding_parts.append(0.0)
                        continue
            
            if len(embedding_parts) != self.embedding_dimensions:
                raise ValueError(f"Expected {self.embedding_dimensions} features, got {len(embedding_parts)}")
            
            return np.array(embedding_parts, dtype=np.float32)
        except Exception as e:
            print(f"Error processing {audio_path}: {e}")
            return None

    def process(self, song_id: str, max_duration=50, update_running_stats: bool = True, normalize: bool = True):
        try:
            file_path = os.path.join(self.project_root, 'storage', 'musik', 'hls', song_id, '32k.m3u8')
            audio_array, sample_rate = self.decode_to_numpy(file_path, duration=max_duration)
            raw_features = self.extract_raw_features_from_array(audio_array, sample_rate=sample_rate)

            if raw_features is None:
                return None
            
            if update_running_stats:
                self.running_stats.update(raw_features)
            
            # Only normalize if we have sufficient stats (at least 2 samples), otherwise return raw features
            if normalize and self.running_stats.is_fitted and self.running_stats.count > 1:
                normalized_features = self.running_stats.normalize(raw_features, method='standard')
                return normalized_features
            else:
                return raw_features
        except Exception as e:
            print(f"Error in processing {song_id}: {e}")
            return None
    
    def process_batch(self, audio_paths, max_duration=50, update_running_stats: bool = True, max_workers: int = 4):
        try:
            print(f"Processing batch of {len(audio_paths)} audio files with {max_workers} workers...")
            features_list = []
            with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = {executor.submit(self.process, path, max_duration, False): path for path in audio_paths}
                for future in concurrent.futures.as_completed(futures):
                    try:
                        features = future.result()
                        if features is not None:
                            features_list.append(features)
                    except Exception as e:
                        path = futures[future]
                        print(f"Error processing {path}: {e}")

            # Now, features_list has raw features
            if features_list:
                if update_running_stats:
                    self.running_stats.update(features_list)

                # Normalize features using standard normalization for better stability
                for i in range(len(features_list)):
                    if self.running_stats.is_fitted and self.running_stats.count > 1:
                        features_list[i] = self.running_stats.normalize(features_list[i], method='standard')
                    # else leave as raw

            return features_list
        except Exception as e:
            print(f"Error in batch processing: {e}")
            return None
    
    def load_running_stats(self, file_path):
        """Load running statistics from analysis.py compatible pickle file"""
        if not os.path.exists(file_path):
            raise ValueError(f"Running stats file not found: {file_path}")
        
        try:
            with open(file_path, 'rb') as f:
                stats_data = pickle.load(f)
            
            # Convert analysis.py format to analysis_2.py format
            if isinstance(stats_data, dict) and 'count' in stats_data:
                # Create new Running_Stats object and populate it
                self.running_stats = Running_Stats()
                
                # Map the data from analysis.py format
                self.running_stats.count = float(stats_data['count'])
                self.running_stats.mean = stats_data['mean'].copy()
                self.running_stats.sum_squared = stats_data['sum_sq'].copy()  # Note: sum_sq -> sum_squared
                self.running_stats.min = stats_data['min'].copy()
                self.running_stats.max = stats_data['max'].copy()
                
                # Map percentiles from sorted_percentiles format
                if 'sorted_percentiles' in stats_data:
                    self.running_stats.percentiles[25] = stats_data['sorted_percentiles']['p25'].copy()
                    self.running_stats.percentiles[50] = stats_data['sorted_percentiles']['p50'].copy()
                    self.running_stats.percentiles[75] = stats_data['sorted_percentiles']['p75'].copy()
                
                self.running_stats.is_fitted = True
                
                print(f"Loaded running stats from {file_path} ({self.running_stats.count} samples)")
            else:
                raise ValueError("Invalid stats file format")
                
        except Exception as e:
            raise ValueError(f"Failed to load running stats from {file_path}: {e}")

class Running_Stats:
    percentiles_to_track = [25, 50, 75]
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    storage_path = os.path.join(project_root, 'storage', 'musik', 'recommendation')
    stats_path = os.path.join(storage_path, 'running_stats.pkl')

    def __init__(self, file_path=None):
        self.is_fitted = False
        self.stats_lock = threading.Lock()  # For thread safety

        self.count = 0.0
        self.mean = None
        self.sum_squared = None
        self.min = None
        self.max = None
        self.percentiles = {p: None for p in self.percentiles_to_track}

        if file_path:
            self.stats_path = file_path

        self.load()
    
    def initialize_stats(self, values: np.ndarray, skip_save=False):
        if isinstance(values, list):
            values = np.vstack(values)
        else:
            values = values.reshape(1, -1) if values.ndim == 1 else values
            
        self.count = values.shape[0]
        self.mean = np.mean(values, axis=0)
        self.sum_squared = np.sum(values ** 2, axis=0)  # Fix: sum of squares, not sum of squared differences
        self.min = np.min(values, axis=0)
        self.max = np.max(values, axis=0)
        for p in self.percentiles_to_track:
            self.percentiles[p] = np.percentile(values, p, axis=0)  # Fix: ensure axis=0 for vector percentiles
        self.is_fitted = True

        if not skip_save:
            self.save()

    def update(self, values: np.ndarray, skip_save=False):
        with self.stats_lock:
            # Ensure values is 2D
            if isinstance(values, list):
                values = np.vstack(values)
            else:
                values = values.reshape(1, -1) if values.ndim == 1 else values
            
            if not self.is_fitted:
                self.initialize_stats(values, skip_save=skip_save)
                return
            
            n_new = values.shape[0]
            n_old = self.count
            n_total = n_old + n_new
            self.count = n_total

            # update mean (Welford's algorithm)
            old_mean = self.mean.copy()
            new_batch_mean = np.mean(values, axis=0)
            self.mean = (n_old * old_mean + n_new * new_batch_mean) / n_total

            # update sum of squares for variance calculation
            self.sum_squared += np.sum(values ** 2, axis=0)

            # update min and max
            self.min = np.minimum(self.min, np.min(values, axis=0))
            self.max = np.maximum(self.max, np.max(values, axis=0))

            # update percentiles using exponential moving average approximation
            alpha = min(0.1, n_new / n_total)  # Cap alpha to avoid instability
            for p in self.percentiles_to_track:
                new_percentile = np.percentile(values, p, axis=0)
                self.percentiles[p] = (1 - alpha) * self.percentiles[p] + alpha * new_percentile

            # mark as fitted
            self.is_fitted = True

            # save state for persistence
            if not skip_save:
                self.save()
    
    def get_normalization_params(self):
        if not self.is_fitted:
            raise ValueError("RunningStats must be updated with data before getting normalization parameters.")
        if self.count == 0:
            raise ValueError("Insufficient data to compute reliable statistics.")
        
        # Calculate standard deviation from running stats (matching analysis.py approach)
        variance = (self.sum_squared / self.count) - self.mean ** 2
        standard_deviation = np.sqrt(np.maximum(variance, 1e-8))

        # approximate MAD using IQR (matching analysis.py approach)
        iqr = self.percentiles[75] - self.percentiles[25]
        mad_approximation = 0.6745 * iqr
        # avoid too small mad (but don't override small legitimate values)
        mad_approximation = np.maximum(mad_approximation, 1e-8)

        return {
            'mean': self.mean,
            'std': standard_deviation,  # Match analysis.py key name
            'median': self.percentiles[50],
            'min': self.min,
            'max': self.max,
            'mad': mad_approximation  # Match analysis.py key name
        }

    def normalize(self, values: np.ndarray, method='robust'):
        if not self.is_fitted:
            raise ValueError("RunningStats must be updated with data before normalization.")
        
        params = self.get_normalization_params()
        
        if method == 'robust':
            # Check for very small MAD values that would cause explosion
            safe_mad = np.maximum(params['mad'], 1e-2)  # Use safe minimum threshold
            normalized = (values - params['median']) / (1.4826 * safe_mad)
        elif method == 'standard':
            # Standard z-score normalization - more stable for batch processing
            safe_std = np.maximum(params['std'], 1e-8)  # Prevent division by zero
            normalized = (values - params['mean']) / safe_std
        elif method == 'minmax':
            range_val = params['max'] - params['min']
            safe_range = np.maximum(range_val, 1e-8)  # Prevent division by zero
            normalized = (values - params['min']) / safe_range
        else:
            raise ValueError(f"Unknown normalization method: {method}")
        
        # Handle any remaining NaN or inf values
        return np.nan_to_num(normalized, nan=0.0, posinf=1.0, neginf=-1.0)

    def save(self):
        print(f"Saving running stats to {self.stats_path}")
        # Create a copy of the state without the lock (which can't be pickled)
        state_to_save = {
            'is_fitted': self.is_fitted,
            'count': self.count,
            'mean': self.mean,
            'sum_squared': self.sum_squared,
            'min': self.min,
            'max': self.max,
            'percentiles': self.percentiles
        }

        # Ensure parent directory exists (self.stats_path is a file path)
        parent_dir = os.path.dirname(self.stats_path)
        os.makedirs(parent_dir, exist_ok=True)

        # Write atomically to avoid corruption from concurrent writes
        tmp_path = self.stats_path + ".tmp"
        try:
            with open(tmp_path, 'wb') as f:
                pickle.dump(state_to_save, f)
            os.replace(tmp_path, self.stats_path)
        except Exception as e:
            # Clean up tmp file if something went wrong
            try:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except Exception:
                pass
            print(f"Failed to save running stats to {self.stats_path}: {e}")

    def load(self):
        # Ensure parent dir exists
        parent_dir = os.path.dirname(self.stats_path)
        if not os.path.exists(parent_dir):
            # nothing to load
            print(f"No existing running stats directory at {parent_dir}. Starting fresh.")
            os.makedirs(parent_dir, exist_ok=True)
            return

        # Guard against the case where someone accidentally created a directory named like the file
        if os.path.isdir(self.stats_path):
            print(f"Expected file but found directory at {self.stats_path}. Please remove/rename it.")
            return

        if os.path.exists(self.stats_path):
            try:
                with open(self.stats_path, 'rb') as f:
                    data = pickle.load(f)
                    # Load only attributes that exist in the current class
                    if isinstance(data, dict):
                        for key in data:
                            if hasattr(self, key):
                                setattr(self, key, data[key])
                print(f"Loaded running stats from {self.stats_path} (count={getattr(self, 'count', None)})")
            except Exception as e:
                print(f"Failed to load running stats from {self.stats_path}: {e}. Using defaults.")
        else:
            print(f"No existing running stats found at {self.stats_path}. Starting fresh.")
