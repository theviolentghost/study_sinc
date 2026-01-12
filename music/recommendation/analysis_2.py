import numpy as np
# import faiss
import glob
import os
import pickle
import threading
import concurrent.futures
import tempfile
import time
import traceback

import essentia
import essentia.standard as es
import subprocess
import soundfile as sf

import hls_audio_decoder as decoder

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
        self.embedding_dimensions = 162  
        
        # For incremental normalization
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
            file_path = os.path.join(self.project_root, 'storage', 'musik', 'hls', 'raw', song_id, 'audio', 'aac', 'ultra-low', '32k.m3u8')
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

class DJ_Audio_Analyzer(Audio_Analyzer):
    """Advanced DJ analyzer for professional mixing with sophisticated feature extraction."""
    
    def __init__(self):
        super().__init__()
        
        # Initialize HLS decoder for streaming audio
        self.hls_decoder = decoder.HLS_Audio_Decoder()
        
        # Core Essentia analyzers for DJ features
        self.rhythm_extractor = es.RhythmExtractor2013()
        self.key_detector = es.KeyExtractor()
        
        # Advanced analyzers for structure and mixing
        self.onset_detector = es.OnsetDetection(method='complex')
        self.onset_peak_picker = es.OnsetDetectionGlobal()
        self.spectral_peaks = es.SpectralPeaks()
        self.hpcp = es.HPCP()
        self.windowing = es.Windowing(type='hann')
        self.spectrum = es.Spectrum()
        self.mfcc = es.MFCC()
        
        # For tempo and beat analysis
        self.tempo_tap = es.TempoTapDegara()
        
        # For vocal detection  
        self.predominant_pitch = es.PredominantPitchMelodia()
        
        # Camelot wheel mapping for harmonic mixing
        self.camelot_wheel = {
            'C major': '8B',
            'G major': '9B', 
            'D major': '10B', 
            'A major': '11B',
            'E major': '12B', 
            'B major': '1B', 
            'F# major': '2B', 
            'C# major': '3B',
            'Ab major': '4B', 
            'Eb major': '5B', 
            'Bb major': '6B', 
            'F major': '7B',
            'A minor': '8A', 
            'E minor': '9A', 
            'B minor': '10A', 
            'F# minor': '11A',
            'C# minor': '12A', 
            'G# minor': '1A', 
            'D# minor': '2A', 
            'A# minor': '3A',
            'F minor': '4A', 
            'C minor': '5A', 
            'G minor': '6A', 
            'D minor': '7A'
        }
    
    def extract_dj_features(self, audio_array: np.ndarray, sample_rate: int = 44100):
        """Extract comprehensive DJ mixing features using advanced algorithms."""
        try:
            # Ensure audio is mono and the right format
            audio_float = audio_array.astype(np.float32)
            
            # Convert to mono if stereo (2D array)
            if len(audio_float.shape) == 2:
                print(f"Converting stereo audio ({audio_float.shape}) to mono...")
                audio_float = np.mean(audio_float, axis=1)
            
            # Ensure it's a 1D array
            if len(audio_float.shape) != 1:
                raise ValueError(f"Audio must be 1D or 2D, got shape: {audio_float.shape}")
            
            print("Extracting rhythm and beat information...")
            # 1. RHYTHM ANALYSIS - Use RhythmExtractor2013
            bpm, beat_times, confidence, estimates, bpm_intervals = self.rhythm_extractor(essentia.array(audio_float))
            
            # Convert beat times to standard Python list for JSON serialization
            if hasattr(beat_times, 'tolist'):
                beat_times_list = beat_times.tolist()
            else:
                beat_times_list = list(beat_times)
            
            # Calculate BPM stability from beat intervals
            bpm_stability = float(confidence)
            
            print("Detecting musical key...")
            # 2. KEY DETECTION
            key, scale, strength = self.key_detector(essentia.array(audio_float))
            camelot_key = self.camelot_wheel.get(f"{key} {scale}", "Unknown")
            
            print("Analyzing song structure...")
            # 3. ADVANCED STRUCTURE ANALYSIS
            structure_info = self._analyze_structure_advanced(audio_float, sample_rate, beat_times_list)
            
            print("Performing energy analysis...")
            # 4. ADVANCED ENERGY ANALYSIS
            energy_analyses = self._analyze_energy_advanced(audio_float, sample_rate)
            
            # print("Detecting vocal sections...")
            # # 5. VOCAL DETECTION
            # vocal_sections = self._detect_vocals(audio_float, sample_rate)
            
            print("Finding loop sections...")
            # 6. LOOP DETECTION
            loop_sections = self._detect_loops(audio_float, sample_rate, beat_times_list)
            
            print("Computing advanced mix points...")
            # 7. ADVANCED MIX POINTS
            mix_in_points, mix_out_points = self._find_mix_points_advanced(
                beat_times_list, structure_info, energy_analyses, len(audio_float) / sample_rate
            )
            
            # 8. Calculate additional metrics
            duration = len(audio_float) / sample_rate
            
            # Extract peak energy and variance from phrase-level analysis
            phrase_energy = energy_analyses.get('phrase', {})
            if phrase_energy.get('rms'):
                peak_energy = float(max(phrase_energy['rms']))
                energy_variance = float(np.var(phrase_energy['rms']))
            else:
                peak_energy = 0.0
                energy_variance = 0.0
            
            print("Compilation complete!")
            
            return {
                # Core timing info
                'bpm': float(bpm),
                'bpm_stability': bpm_stability,
                'bpm_confidence': float(confidence),
                'beat_times': beat_times_list,
                'num_beats': len(beat_times_list),
                'duration': duration,
                
                # Harmonic info
                'key': key,
                'scale': scale,
                'key_strength': float(strength),
                'camelot_key': camelot_key,
                'compatible_keys': self._get_compatible_keys(camelot_key),
                
                # Advanced structure analysis
                'structure': {
                    'intro_end': structure_info['intro_end'],
                    'outro_start': structure_info['outro_start'],
                    'breakdowns': structure_info['breakdowns'],
                    'buildups': structure_info['buildups']
                },
                
                # Energy analysis (multiple levels)
                'energy': {
                    'peak_energy': peak_energy,
                    'energy_variance': energy_variance,
                    'analyses': energy_analyses
                },
                
                # Vocal analysis
                # 'vocals': {
                #     'sections': vocal_sections,
                #     'has_vocals': len(vocal_sections) > 0
                # },
                
                # Loop analysis
                'loops': {
                    'sections': loop_sections,
                    'best_loop': loop_sections[0] if loop_sections else None
                },
                
                # Advanced mix recommendations
                'mix_points': {
                    'mix_in': mix_in_points,
                    'mix_out': mix_out_points,
                    'total_in_points': len(mix_in_points),
                    'total_out_points': len(mix_out_points)
                },
                
                # Technical info
                'sample_rate': sample_rate,
            }
            
        except Exception as e:
            print(f"Error extracting DJ features: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def _analyze_structure_advanced(self, audio, sample_rate, beat_times):
        """Advanced structure analysis with breakdown and vocal detection."""
        duration = len(audio) / sample_rate
        
        # 1. Energy-based structure analysis
        segment_length = int(sample_rate * 2)  # 2-second segments for finer detail
        segments = []
        segment_times = []
        
        for i in range(0, len(audio) - segment_length, segment_length // 2):  # 50% overlap
            segment = audio[i:i + segment_length]
            rms = np.sqrt(np.mean(segment ** 2))
            segments.append(rms)
            segment_times.append(i / sample_rate)
        
        if len(segments) < 5:
            return {'intro_end': 0.0, 'outro_start': duration, 'breakdowns': [], 'buildups': []}
        
        segments = np.array(segments)
        smooth_segments = self._smooth_signal(segments, window_size=3)
        
        # 2. Find intro/outro with improved algorithm
        energy_threshold = np.mean(smooth_segments) * 0.6
        energy_high_threshold = np.mean(smooth_segments) * 1.2
        
        # Intro end: first sustained period above threshold
        intro_end = self._find_sustained_change(smooth_segments, segment_times, 
                                               energy_threshold, direction='up', min_duration=4.0)
        
        # Outro start: last sustained period above threshold
        outro_start = self._find_sustained_change(smooth_segments, segment_times,
                                                 energy_threshold, direction='down', min_duration=4.0, reverse=True)
        
        # 3. Find breakdowns (energy drops) and buildups (energy rises)
        breakdowns = self._find_breakdowns(smooth_segments, segment_times, beat_times)
        buildups = self._find_buildups(smooth_segments, segment_times, beat_times)
        
        return {
            'intro_end': intro_end,
            'outro_start': min(outro_start, duration),
            'breakdowns': breakdowns,
            'buildups': buildups,
            'energy_curve': smooth_segments.tolist(),
            'energy_times': segment_times
        }
    
    def _smooth_signal(self, signal, window_size=5):
        """Apply moving average smoothing to reduce noise."""
        if len(signal) < window_size:
            return signal
        kernel = np.ones(window_size) / window_size
        return np.convolve(signal, kernel, mode='same')
    
    def _find_sustained_change(self, energy, times, threshold, direction='up', min_duration=3.0, reverse=False):
        """Find sustained energy changes for structure detection."""
        if reverse:
            energy = energy[::-1]
            times = times[::-1]
        
        for i in range(len(energy) - 3):
            if direction == 'up':
                if all(energy[i+j] > threshold for j in range(3)):
                    # Check if this is sustained
                    sustained_time = 0
                    for j in range(i, len(energy)):
                        if energy[j] > threshold:
                            sustained_time = times[j] - times[i]
                        else:
                            break
                    if sustained_time >= min_duration:
                        return times[i] if not reverse else times[len(times) - 1 - i]
            else:  # direction == 'down'
                if all(energy[i+j] < threshold for j in range(3)):
                    sustained_time = 0
                    for j in range(i, len(energy)):
                        if energy[j] < threshold:
                            sustained_time = times[j] - times[i]
                        else:
                            break
                    if sustained_time >= min_duration:
                        return times[i] if not reverse else times[len(times) - 1 - i]
        
        return 0.0 if not reverse else times[-1]
    
    def _find_breakdowns(self, energy, times, beat_times):
        """Find breakdown sections (significant energy drops)."""
        breakdowns = []
        mean_energy = np.mean(energy)
        
        # Look for significant drops followed by recovery
        for i in range(2, len(energy) - 8):  # Leave room for analysis
            if energy[i] > mean_energy * 0.8:  # Start from decent energy
                # Look for drop
                min_energy_idx = i
                for j in range(i + 1, min(i + 8, len(energy))):
                    if energy[j] < energy[min_energy_idx]:
                        min_energy_idx = j
                
                # Check if drop is significant
                if energy[min_energy_idx] < energy[i] * 0.6:
                    # Look for recovery
                    recovery_idx = None
                    for j in range(min_energy_idx + 1, min(min_energy_idx + 8, len(energy))):
                        if energy[j] > energy[min_energy_idx] * 1.5:
                            recovery_idx = j
                            break
                    
                    if recovery_idx:
                        breakdown_start = self._align_to_beat(times[i], beat_times)
                        breakdown_end = self._align_to_beat(times[recovery_idx], beat_times)
                        breakdowns.append({
                            'start': breakdown_start,
                            'end': breakdown_end,
                            'duration': breakdown_end - breakdown_start,
                            'confidence': min(1.0, (energy[i] - energy[min_energy_idx]) / energy[i])
                        })
        
        return breakdowns[:3]  # Return top 3 breakdowns
    
    def _find_buildups(self, energy, times, beat_times):
        """Find buildup sections (gradual energy increases)."""
        buildups = []
        
        # Look for sustained energy increases
        for i in range(len(energy) - 8):
            if i > 4:  # Need some history
                # Check for gradual increase over 8+ segments
                if all(energy[i + j] >= energy[i + j - 1] * 0.95 for j in range(1, min(8, len(energy) - i))):
                    total_increase = energy[i + 7] / max(energy[i], 1e-10)
                    if total_increase > 1.3:  # At least 30% increase
                        buildup_start = self._align_to_beat(times[i], beat_times)
                        buildup_end = self._align_to_beat(times[min(i + 7, len(times) - 1)], beat_times)
                        buildups.append({
                            'start': buildup_start,
                            'end': buildup_end,
                            'duration': buildup_end - buildup_start,
                            'confidence': min(1.0, (total_increase - 1.0) / 0.5)
                        })
        
        return buildups[:3]  # Return top 3 buildups
    
    def _analyze_energy_advanced(self, audio, sample_rate):
        """Advanced energy analysis for sophisticated mix point detection."""
        # Multiple window sizes for different analysis
        window_sizes = [
            int(sample_rate * 0.5),  # 0.5 second - beat-level analysis
            int(sample_rate * 2.0),   # 2 second - phrase-level analysis  
            int(sample_rate * 8.0)    # 8 second - section-level analysis
        ]
        
        energy_analyses = {}
        
        for window_name, window_size in zip(['beat', 'phrase', 'section'], window_sizes):
            energy_curve = []
            times = []
            
            hop_size = window_size // 4  # 75% overlap for smoother analysis
            
            for i in range(0, len(audio) - window_size, hop_size):
                window = audio[i:i + window_size]
                
                # Multiple energy metrics
                rms = np.sqrt(np.mean(window ** 2))
                peak = np.max(np.abs(window))
                spectral_centroid = self._calculate_spectral_centroid(window, sample_rate)
                
                energy_curve.append({
                    'rms': rms,
                    'peak': peak,
                    'spectral_centroid': spectral_centroid,
                    'time': i / sample_rate
                })
                times.append(i / sample_rate)
            
            if energy_curve:
                # Smooth the curves
                rms_values = [e['rms'] for e in energy_curve]
                peak_values = [e['peak'] for e in energy_curve]
                centroid_values = [e['spectral_centroid'] for e in energy_curve]
                
                energy_analyses[window_name] = {
                    'rms': self._smooth_signal(np.array(rms_values), window_size=3).tolist(),
                    'peak': self._smooth_signal(np.array(peak_values), window_size=3).tolist(),
                    'spectral_centroid': self._smooth_signal(np.array(centroid_values), window_size=5).tolist(),
                    'times': times,
                    'stats': {
                        'rms_mean': float(np.mean(rms_values)),
                        'rms_std': float(np.std(rms_values)),
                        'peak_mean': float(np.mean(peak_values)),
                        'spectral_centroid_mean': float(np.mean(centroid_values))
                    }
                }
        
        return energy_analyses
    
    def _calculate_spectral_centroid(self, audio_segment, sample_rate):
        """Calculate spectral centroid for brightness analysis."""
        try:
            # Simple FFT-based spectral centroid
            fft = np.fft.rfft(audio_segment)
            magnitude = np.abs(fft)
            
            # Frequency bins
            freqs = np.fft.rfftfreq(len(audio_segment), 1/sample_rate)
            
            # Weighted average of frequencies
            if np.sum(magnitude) > 0:
                centroid = np.sum(freqs * magnitude) / np.sum(magnitude)
                return min(centroid, sample_rate / 2)  # Cap at Nyquist
            else:
                return 0.0
        except:
            return 0.0
    
    def _find_mix_points_advanced(self, beat_times, structure_info, energy_analyses, duration):
        """Advanced mix point detection using multiple criteria."""
        mix_in_points = []
        mix_out_points = []
        
        if not beat_times or not energy_analyses:
            return mix_in_points, mix_out_points
        
        # Get energy data for analysis
        phrase_energy = energy_analyses.get('phrase', {})
        rms_curve = phrase_energy.get('rms', [])
        times = phrase_energy.get('times', [])
        
        if not rms_curve or not times:
            return self._find_mix_points_simple(beat_times, structure_info.get('intro_end', 0), 
                                              structure_info.get('outro_start', duration), duration)
        
        # 1. INTRO MIX POINTS - Points where the track is ready to be mixed in
        intro_end = structure_info.get('intro_end', 0)
        search_end = min(duration * 0.4, intro_end + 60)  # Search in first 40% or 60s after intro
        
        for beat_time in beat_times:
            if intro_end + 4.0 <= beat_time <= search_end:
                confidence = self._calculate_mix_point_confidence(
                    beat_time, times, rms_curve, beat_times, 'mix_in'
                )
                
                if confidence > 0.3:  # Only include decent confidence points
                    point_type = self._classify_mix_point(beat_time, structure_info, energy_analyses)
                    mix_in_points.append({
                        'time': beat_time,
                        'type': point_type,
                        'confidence': confidence,
                        'phrase_position': self._get_phrase_position(beat_time, beat_times)
                    })
        
        # 2. OUTRO MIX POINTS - Points where the track can be mixed out
        outro_start = structure_info.get('outro_start', duration)
        
        # Debug structure info
        print(f"  Structure info - outro_start: {outro_start}, duration: {duration}")
        
        # Ensure outro_start is reasonable - if not detected properly, use last 40% of track
        if outro_start <= 0 or outro_start > duration:
            outro_start = duration * 0.8  # Default to last 20% if outro not detected
            print(f"  Outro start invalid, using default: {outro_start:.1f}s")
        
        search_start = max(duration * 0.4, outro_start - 60)  # Search in last 60% or 60s before outro
        search_end = outro_start - 4.0  # Leave 4 seconds before outro
        
        print(f"  Searching for mix OUT points from {search_start:.1f}s to {search_end:.1f}s")
        
        # Only proceed if we have a valid search range
        if search_end <= search_start:
            print(f"  Invalid search range for mix OUT points, skipping")
            mix_out_candidates = []
        else:
            mix_out_candidates = []
            
            for beat_time in beat_times:
                if search_start <= beat_time <= search_end:
                    confidence = self._calculate_mix_point_confidence(
                        beat_time, times, rms_curve, beat_times, 'mix_out'
                    )
                    
                    mix_out_candidates.append((beat_time, confidence))
                    
                    # Very low threshold for mix OUT points since they're about timing, not energy
                    if confidence > 0.05:  # Much more lenient threshold
                        point_type = self._classify_mix_point(beat_time, structure_info, energy_analyses)
                        mix_out_points.append({
                            'time': beat_time,
                            'type': point_type,
                            'confidence': confidence,
                            'phrase_position': self._get_phrase_position(beat_time, beat_times)
                        })
        
        # Debug: show top candidates
        mix_out_candidates.sort(key=lambda x: -x[1])  # Sort by confidence descending
        
        # 3. ADD BREAKDOWN AND BUILDUP POINTS (with proper timing logic)
        for breakdown in structure_info.get('breakdowns', []):
            if breakdown['confidence'] > 0.5:
                # Use time-based logic for breakdown points
                breakdown_time = breakdown['start']
                breakdown_end_time = breakdown['end']
                
                # If breakdown is in first half of song, breakdown end is good for mixing IN
                # If breakdown is in second half of song, breakdown start is good for mixing OUT
                if breakdown_time < duration * 0.5:
                    # Early breakdown - use end for mixing IN (energy returns)
                    if breakdown_end_time <= duration * 0.6:  # Still in reasonable mix-in range
                        mix_in_points.append({
                            'time': breakdown_end_time,
                            'type': 'breakdown_end',
                            'confidence': breakdown['confidence'],
                            'phrase_position': 'post_breakdown'
                        })
                else:
                    # Late breakdown - use start for mixing OUT (energy drops)
                    if breakdown_time >= duration * 0.4:  # In reasonable mix-out range
                        mix_out_points.append({
                            'time': breakdown_time,
                            'type': 'breakdown_start',
                            'confidence': breakdown['confidence'],
                            'phrase_position': 'breakdown'
                        })
        
        for buildup in structure_info.get('buildups', []):
            if buildup['confidence'] > 0.5:
                buildup_time = buildup['start']
                
                # If buildup is in first half, it's good for mixing IN (energy building)
                # If buildup is in second half, it might be good for mixing OUT (before peak)
                if buildup_time < duration * 0.5:
                    # Early buildup - good for mixing IN
                    if buildup_time <= duration * 0.6:  # Still in reasonable mix-in range
                        mix_in_points.append({
                            'time': buildup_time,
                            'type': 'buildup_start',
                            'confidence': buildup['confidence'],
                            'phrase_position': 'buildup'
                        })
                else:
                    # Late buildup - could be used for mixing OUT (before peak energy)
                    if buildup_time >= duration * 0.4:  # In reasonable mix-out range
                        mix_out_points.append({
                            'time': buildup_time,
                            'type': 'buildup_start',
                            'confidence': buildup['confidence'] * 0.8,  # Slightly lower confidence for late buildups
                            'phrase_position': 'buildup'
                        })
        
        # Sort by confidence and time, return top candidates
        mix_in_points.sort(key=lambda x: (-x['confidence'], x['time']))
        mix_out_points.sort(key=lambda x: (-x['confidence'], x['time']))
        
        # Final filtering to ensure logical time ranges
        # Mix IN points should be in first 60% of song
        mix_in_points = [p for p in mix_in_points if p['time'] <= duration * 0.6]
        
        # Mix OUT points should be in last 60% of song  
        mix_out_points = [p for p in mix_out_points if p['time'] >= duration * 0.4]
        
        # Debug information
        print(f"Duration: {duration:.1f}s")
        print(f"Mix IN range: 0 - {duration * 0.6:.1f}s")
        print(f"Mix OUT range: {duration * 0.4:.1f}s - {duration:.1f}s")
        print(f"Found {len(mix_in_points)} mix IN points, {len(mix_out_points)} mix OUT points")
        
        return mix_in_points[:8], mix_out_points[:8]  # Return top 8 of each
    
    def _calculate_mix_point_confidence(self, beat_time, times, rms_curve, beat_times, mix_type):
        """Calculate confidence score for a potential mix point."""
        if not times or not rms_curve:
            return 0.5
        
        # Find closest energy measurement
        closest_idx = min(range(len(times)), key=lambda i: abs(times[i] - beat_time))
        
        # 1. Energy stability (prefer stable energy for mixing)
        window_start = max(0, closest_idx - 2)
        window_end = min(len(rms_curve), closest_idx + 3)
        local_energy = rms_curve[window_start:window_end]
        
        stability_score = 0.7  # Default
        if len(local_energy) > 1:
            energy_variance = np.var(local_energy)
            if mix_type == 'mix_in':
                stability_score = 1.0 / (1.0 + energy_variance * 10)  # Require stability for mix in
            else:  # mix_out
                stability_score = 1.0 / (1.0 + energy_variance * 5)   # More lenient for mix out
        
        # 2. Beat alignment quality (prefer strong beat positions)
        beat_strength = self._get_beat_strength(beat_time, beat_times)
        
        # 3. Energy level appropriateness 
        current_energy = rms_curve[closest_idx]
        mean_energy = np.mean(rms_curve)
        
        if mix_type == 'mix_in':
            # For mixing in, prefer moderate to high energy
            energy_score = min(1.0, current_energy / (mean_energy * 0.8))
        else:  # mix_out
            # For mixing out, be much more lenient with energy requirements
            # Almost any energy level can work for mix out points
            if current_energy < mean_energy * 0.1:
                # Only exclude extremely low energy (complete silence)
                energy_score = 0.3
            elif current_energy > mean_energy * 2.0:
                # Only penalize extremely high energy peaks
                energy_score = 0.6
            else:
                # Accept a very wide range of energy levels for mix out
                # Mix out points are about timing and beat alignment, not energy level
                energy_score = 0.8  # High base score for mix out energy
        
        energy_score = max(0.0, energy_score)
        
        # 4. Phrase position bonus
        phrase_pos = self._get_phrase_position(beat_time, beat_times)
        if phrase_pos in ['phrase_start', 'phrase_end']:
            phrase_score = 0.9
        else:
            phrase_score = 0.6
        
        # Different calculation for mix_in vs mix_out
        if mix_type == 'mix_in':
            # For mix in, all factors are important
            confidence_factors = [stability_score, beat_strength, energy_score, phrase_score]
            return min(1.0, np.mean(confidence_factors))
        else:  # mix_out
            # For mix out, prioritize beat alignment and timing over energy
            # Use weighted average with beat strength being most important
            weighted_score = (
                beat_strength * 0.4 +      # Beat alignment is critical for mix out
                phrase_score * 0.3 +       # Phrase position important for timing
                energy_score * 0.2 +       # Energy less critical for mix out
                stability_score * 0.1      # Stability least important for mix out
            )
            # Add a base score boost for mix out points to make them easier to find
            return min(1.0, weighted_score + 0.1)
    
    def _classify_mix_point(self, beat_time, structure_info, energy_analyses):
        """Classify the type of mix point based on musical context."""
        # Check if it's near a breakdown or buildup
        for breakdown in structure_info.get('breakdowns', []):
            if abs(beat_time - breakdown['start']) < 2.0:
                return 'breakdown_start'
            elif abs(beat_time - breakdown['end']) < 2.0:
                return 'breakdown_end'
        
        for buildup in structure_info.get('buildups', []):
            if abs(beat_time - buildup['start']) < 2.0:
                return 'buildup_start'
            elif abs(beat_time - buildup['end']) < 2.0:
                return 'buildup_end'
        
        # Check energy characteristics
        phrase_energy = energy_analyses.get('phrase', {})
        if phrase_energy:
            times = phrase_energy.get('times', [])
            rms_curve = phrase_energy.get('rms', [])
            
            if times and rms_curve:
                closest_idx = min(range(len(times)), key=lambda i: abs(times[i] - beat_time))
                current_energy = rms_curve[closest_idx]
                mean_energy = np.mean(rms_curve)
                
                if current_energy > mean_energy * 1.2:
                    return 'high_energy'
                elif current_energy < mean_energy * 0.6:
                    return 'low_energy'
        
        return 'beat_aligned'
    
    def _get_phrase_position(self, beat_time, beat_times):
        """Determine position within musical phrase (8-beat phrases assumed)."""
        if not beat_times:
            return 'unknown'
        
        # Find beat position
        beat_idx = min(range(len(beat_times)), key=lambda i: abs(beat_times[i] - beat_time))
        
        # Assume 8-beat phrases (common in electronic music)
        phrase_position = beat_idx % 8
        
        if phrase_position == 0:
            return 'phrase_start'
        elif phrase_position == 7:
            return 'phrase_end'
        elif phrase_position in [3, 4]:
            return 'phrase_middle'
        else:
            return 'phrase_interior'
    
    def _get_beat_strength(self, beat_time, beat_times):
        """Calculate how strong/aligned this beat position is."""
        if not beat_times:
            return 0.5
        
        # Find closest beat
        closest_beat_idx = min(range(len(beat_times)), key=lambda i: abs(beat_times[i] - beat_time))
        time_diff = abs(beat_times[closest_beat_idx] - beat_time)
        
        # Score based on proximity to actual beat (within 0.1 seconds is considered strong)
        if time_diff < 0.05:
            return 1.0
        elif time_diff < 0.1:
            return 0.8
        elif time_diff < 0.2:
            return 0.6
        else:
            return 0.3
    
    def _detect_vocals(self, audio, sample_rate):
        """Detect vocal sections using spectral analysis."""
        try:
            # Use spectral features to detect vocals
            hop_length = 512
            frame_length = 2048
            
            vocal_indicators = []
            times = []
            
            for i in range(0, len(audio) - frame_length, hop_length):
                frame = audio[i:i + frame_length]
                time = i / sample_rate
                
                # Calculate spectral features that indicate vocals
                spectral_centroid = self._calculate_spectral_centroid(frame, sample_rate)
                spectral_rolloff = self._calculate_spectral_rolloff(frame, sample_rate)
                zero_crossing_rate = self._calculate_zero_crossing_rate(frame)
                
                # Vocal likelihood heuristic
                # Vocals typically have:
                # - Moderate spectral centroid (1000-4000 Hz)
                # - Moderate zero crossing rate
                # - Specific spectral rolloff characteristics
                vocal_score = 0.0
                
                if 1000 <= spectral_centroid <= 4000:
                    vocal_score += 0.4
                elif 800 <= spectral_centroid <= 5000:
                    vocal_score += 0.2
                
                if 0.05 <= zero_crossing_rate <= 0.3:
                    vocal_score += 0.3
                
                if 3000 <= spectral_rolloff <= 8000:
                    vocal_score += 0.3
                
                vocal_indicators.append(vocal_score)
                times.append(time)
            
            # Smooth vocal detection curve
            if vocal_indicators:
                smooth_vocals = self._smooth_signal(np.array(vocal_indicators), window_size=9)
                
                # Find vocal sections (sustained high vocal probability)
                vocal_threshold = np.mean(smooth_vocals) + np.std(smooth_vocals) * 0.5
                vocal_sections = []
                
                in_vocal_section = False
                section_start = 0
                
                for i, (score, time) in enumerate(zip(smooth_vocals, times)):
                    if score > vocal_threshold and not in_vocal_section:
                        section_start = time
                        in_vocal_section = True
                    elif score <= vocal_threshold and in_vocal_section:
                        if time - section_start > 3.0:  # Minimum 3 seconds
                            vocal_sections.append({
                                'start': section_start,
                                'end': time,
                                'confidence': float(np.mean(smooth_vocals[
                                    max(0, i - int((time - section_start) * len(smooth_vocals) / (times[-1] - times[0]))):i
                                ]))
                            })
                        in_vocal_section = False
                
                return vocal_sections[:5]  # Return up to 5 vocal sections
            
        except Exception as e:
            print(f"Error in vocal detection: {e}")
        
        return []
    
    def _calculate_spectral_rolloff(self, audio_segment, sample_rate, rolloff_percent=0.85):
        """Calculate spectral rolloff frequency."""
        try:
            fft = np.fft.rfft(audio_segment)
            magnitude = np.abs(fft)
            freqs = np.fft.rfftfreq(len(audio_segment), 1/sample_rate)
            
            total_energy = np.sum(magnitude)
            if total_energy == 0:
                return 0.0
            
            cumulative_energy = np.cumsum(magnitude)
            rolloff_index = np.where(cumulative_energy >= total_energy * rolloff_percent)[0]
            
            if len(rolloff_index) > 0:
                return freqs[rolloff_index[0]]
            else:
                return freqs[-1]
        except:
            return 0.0
    
    def _calculate_zero_crossing_rate(self, audio_segment):
        """Calculate zero crossing rate."""
        try:
            zero_crossings = np.where(np.diff(np.sign(audio_segment)))[0]
            return len(zero_crossings) / len(audio_segment)
        except:
            return 0.0
    
    def _detect_loops(self, audio, sample_rate, beat_times):
        """Detect repetitive sections suitable for looping."""
        if not beat_times or len(beat_times) < 8:
            return []
        
        loops = []
        
        # Common loop lengths in beats (4, 8, 16, 32 beats)
        loop_lengths = [4, 8, 16, 32]
        
        for loop_length in loop_lengths:
            if len(beat_times) < loop_length * 2:
                continue
            
            # Search for good loop points
            for start_idx in range(0, len(beat_times) - loop_length, 4):  # Every 4 beats
                start_time = beat_times[start_idx]
                end_time = beat_times[start_idx + loop_length - 1]
                
                # Extract loop audio
                start_sample = int(start_time * sample_rate)
                end_sample = int(end_time * sample_rate)
                
                if end_sample > len(audio):
                    continue
                
                loop_audio = audio[start_sample:end_sample]
                
                # Analyze loop quality
                loop_score = self._analyze_loop_quality(loop_audio, sample_rate)
                
                if loop_score > 0.6:  # Good loop threshold
                    loops.append({
                        'start': start_time,
                        'end': end_time,
                        'length_beats': loop_length,
                        'duration': end_time - start_time,
                        'quality_score': loop_score,
                        'type': 'rhythmic_loop'
                    })
        
        # Sort by quality and return best loops
        loops.sort(key=lambda x: -x['quality_score'])
        return loops
    
    def _analyze_loop_quality(self, loop_audio, sample_rate):
        """
        Analyze how well a section would work as a loop.
        should sample points between start and end to check for consistency. (aka make more complex)
        """
        try:
            # Check energy consistency
            segment_length = len(loop_audio) // 8  # 8 segments
            if segment_length < sample_rate // 10:  # Too short
                return 0.0
            
            energies = []
            for i in range(8):
                start = i * segment_length
                end = min((i + 1) * segment_length, len(loop_audio))
                segment = loop_audio[start:end]
                energy = np.sqrt(np.mean(segment ** 2))
                energies.append(energy)
            
            # Good loops have consistent energy
            energy_consistency = 1.0 - (np.std(energies) / max(np.mean(energies), 1e-10))
            
            # Check for seamless transitions (beginning vs end)
            fade_length = min(len(loop_audio) // 20, sample_rate // 4)  # 0.25 seconds or 5% of loop
            beginning = loop_audio[:fade_length]
            ending = loop_audio[-fade_length:]
            
            # Compare energy and spectral characteristics
            beginning_energy = np.sqrt(np.mean(beginning ** 2))
            ending_energy = np.sqrt(np.mean(ending ** 2))
            
            energy_match = 1.0 - abs(beginning_energy - ending_energy) / max(beginning_energy + ending_energy, 1e-10)
            
            # Combine factors
            loop_quality = 0.6 * energy_consistency + 0.4 * energy_match
            
            return max(0.0, min(1.0, loop_quality))
            
        except:
            return 0.0
    
    def _get_compatible_keys(self, camelot_key):
        """Get harmonically compatible keys for mixing."""
        if camelot_key == "Unknown":
            return []
        
        try:
            number = int(camelot_key[:-1])
            letter = camelot_key[-1]
            
            compatible = [camelot_key]  # Same key
            
            # Adjacent keys (+1, -1)
            for offset in [-1, 1]:
                new_number = ((number - 1 + offset) % 12) + 1
                compatible.append(f"{new_number}{letter}")
            
            # Relative major/minor
            opposite_letter = 'A' if letter == 'B' else 'B'
            compatible.append(f"{number}{opposite_letter}")
            
            return compatible
            
        except (ValueError, IndexError):
            return []
    
    def calculate_mix_compatibility(self, track1_features, track2_features):
        """Calculate how well two tracks can be mixed together."""
        if not track1_features or not track2_features:
            return {'compatibility': 0.0, 'recommendations': []}
        
        compatibility_factors = {}
        recommendations = []
        
        # BPM Compatibility
        bpm1, bpm2 = track1_features['bpm'], track2_features['bpm']
        bpm_ratio = max(bpm1, bpm2) / min(bpm1, bpm2) if min(bpm1, bpm2) > 0 else float('inf')
        
        if bpm_ratio <= 1.06:
            compatibility_factors['bpm'] = 1.0
        elif bpm_ratio <= 1.25:
            compatibility_factors['bpm'] = 0.7
            recommendations.append(f"Adjust tempo: {bpm1:.1f} → {bpm2:.1f} BPM")
        else:
            compatibility_factors['bpm'] = 0.3
            recommendations.append(f"Large tempo difference: {bpm1:.1f} vs {bpm2:.1f} BPM")
        
        # Key Compatibility
        key1, key2 = track1_features['camelot_key'], track2_features['camelot_key']
        if key2 in track1_features.get('compatible_keys', []):
            compatibility_factors['key'] = 1.0
        else:
            compatibility_factors['key'] = 0.4
            recommendations.append(f"Key clash: {key1} → {key2}")
        
        # Energy Compatibility
        energy1 = track1_features.get('peak_energy', 0)
        energy2 = track2_features.get('peak_energy', 0)
        energy_ratio = max(energy1, energy2) / max(min(energy1, energy2), 1e-10)
        
        if energy_ratio <= 2.0:
            compatibility_factors['energy'] = 1.0
        elif energy_ratio <= 4.0:
            compatibility_factors['energy'] = 0.7
        else:
            compatibility_factors['energy'] = 0.4
            recommendations.append("Significant energy level difference")
        
        # Overall compatibility
        weights = {'bpm': 0.4, 'key': 0.3, 'energy': 0.3}
        overall_compatibility = sum(
            compatibility_factors[factor] * weights[factor] 
            for factor in weights
        )
        
        return {
            'compatibility': overall_compatibility,
            'factors': compatibility_factors,
            'recommendations': recommendations
        }
    
    def process_dj_analysis(self, song_id: str, max_duration=None):
        """Process a song for DJ mixing analysis."""
        try:
            file_path = os.path.join(self.project_root, 'storage', 'musik', 'hls', song_id, '32k.m3u8')
            audio_array, sample_rate = self.decode_to_numpy(file_path, duration=max_duration)
            
            # Get DJ features
            dj_features = self.extract_dj_features(audio_array, sample_rate)
            
            if dj_features is None:
                return None
            
            return {
                'song_id': song_id,
                'dj_features': dj_features,
                'analysis_timestamp': __import__('time').time()
            }
            
        except Exception as e:
            print(f"Error processing DJ analysis for {song_id}: {e}")
            return None

    def _align_to_beat(self, time, beat_times):
        """Align a time point to the nearest beat."""
        if not beat_times:
            return time
        
        closest_beat = min(beat_times, key=lambda bt: abs(bt - time))
        return closest_beat
    
    def _find_mix_points_simple(self, beat_times, intro_end, outro_start, duration):
        """Fallback simple mix point detection for when advanced analysis fails."""
        mix_in_points = []
        mix_out_points = []
        
        if not beat_times:
            return mix_in_points, mix_out_points
        
        # Find beats suitable for mixing in (after intro, in first 60%)
        for beat_time in beat_times:
            if intro_end + 8.0 <= beat_time <= duration * 0.6:
                mix_in_points.append({
                    'time': beat_time,
                    'type': 'beat_aligned',
                    'confidence': 0.8,
                    'phrase_position': 'unknown'
                })
        
        # Find beats suitable for mixing out (before outro, in last 60%)
        for beat_time in beat_times:
            if duration * 0.4 <= beat_time <= outro_start - 8.0:
                mix_out_points.append({
                    'time': beat_time,
                    'type': 'beat_aligned',
                    'confidence': 0.8,
                    'phrase_position': 'unknown'
                })
        
        return mix_in_points[:5], mix_out_points[:5]  # Return top 5 of each


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


from enum import Enum
from dataclasses import dataclass
from typing import List, Optional, Dict, Tuple

class MixType(Enum):
    CROSSFADE = "crossfade"
    CUT = "cut"
    ECHO_TRANSITION = "echo_transition"
    FILTER_SWEEP = "filter_sweep"
    BREAKDOWN_MIX = "breakdown_mix"
    BUILDUP_MIX = "buildup_mix"

class BPMSync(Enum):
    NONE = "none"
    PITCH_UP = "pitch_up"
    PITCH_DOWN = "pitch_down" 
    DOUBLE_TIME = "double_time"
    HALF_TIME = "half_time"

class KeyAdjustment(Enum):
    NONE = "none"
    PITCH_SHIFT = "pitch_shift"
    KEY_LOCK = "key_lock"

@dataclass
class MixPoint:
    time_seconds: float
    bar_position: int  # Which bar in the phrase (1-8)
    phrase_position: int  # Which phrase in the song 
    energy_level: float  # 0.0 to 1.0
    confidence: float  # 0.0 to 1.0
    beat_strength: float  # How strong the beat is at this point
    
@dataclass 
class BPMSyncInstruction:
    sync_type: BPMSync
    pitch_adjustment: float  # Percentage change needed (-50% to +50%)
    target_bpm: float
    current_bpm: float
    
@dataclass
class MixInstruction:
    # Current song mix out
    mix_out_point: MixPoint
    mix_out_duration: float  # How long to take mixing out
    
    # Next song mix in  
    mix_in_point: MixPoint
    mix_in_duration: float  # How long to take mixing in
    
    # Technical parameters
    bpm_sync: BPMSyncInstruction
    key_shift_semitones: int  # -12 to +12
    
    # Mix execution
    mix_type: MixType
    crossfade_curve: str  # "linear", "exponential", "cut"
    overlap_duration: float  # How long both tracks play together
    
    # Timing precision
    beat_sync_offset: float  # Fine timing adjustment in milliseconds
    phrase_alignment: bool  # Whether to align to phrase boundaries
    
    # Quality metrics
    compatibility_score: float
    energy_flow_score: float  # How well energy transitions
    harmonic_compatibility: float
    timing_precision: float

class DJ_Mix_Calculator:
    """Advanced DJ mixing calculator that determines optimal mix points and transitions."""
    
    def __init__(self):
        self.bpm_tolerance = 0.06  # 6% BPM difference tolerance
        self.key_compatibility_bonus = 0.2
        self.energy_match_bonus = 0.15
        
    def calculate_optimal_mix(self, current_song_features, next_song_features, current_position=None) -> MixInstruction:
        """
        Calculate optimal mixing strategy between two songs.
        
        Args:
            current_song_features: DJ features of currently playing song
            next_song_features: DJ features of song to mix in
            current_position: Current playback position in current song (seconds)
            
        Returns:
            MixInstruction with precise, programmatic mixing data
        """
        
        if not current_song_features or not next_song_features:
            return self._create_fallback_mix_instruction()
            
        # 1. Find optimal mix points with minimal waste
        mix_points = self._find_optimal_mix_timing(
            current_song_features, next_song_features, current_position
        )
        
        # 2. Calculate BPM synchronization requirements
        bpm_sync = self._calculate_bpm_sync(
            current_song_features['bpm'], 
            next_song_features['bpm']
        )
        
        # 3. Determine key adjustments
        key_shift = self._calculate_key_shift(
            current_song_features.get('camelot_key', 'Unknown'),
            next_song_features.get('camelot_key', 'Unknown')
        )
        
        # 4. Select optimal mix type based on musical characteristics
        mix_type = self._determine_mix_type(
            current_song_features, next_song_features, mix_points
        )
        
        # 5. Calculate timing precision
        timing_params = self._calculate_timing_precision(
            current_song_features, next_song_features, mix_points
        )
        
        # 6. Score the mix quality
        quality_scores = self._calculate_mix_quality_scores(
            current_song_features, next_song_features, mix_points, bpm_sync
        )
        
        return MixInstruction(
            mix_out_point=mix_points['out'],
            mix_out_duration=timing_params['out_duration'],
            mix_in_point=mix_points['in'],
            mix_in_duration=timing_params['in_duration'],
            bpm_sync=bpm_sync,
            key_shift_semitones=key_shift,
            mix_type=mix_type,
            crossfade_curve=timing_params['curve'],
            overlap_duration=timing_params['overlap'],
            beat_sync_offset=timing_params['beat_offset'],
            phrase_alignment=timing_params['phrase_align'],
            compatibility_score=quality_scores['compatibility'],
            energy_flow_score=quality_scores['energy_flow'],
            harmonic_compatibility=quality_scores['harmonic'],
            timing_precision=quality_scores['timing']
        )
    
    def _find_optimal_mix_timing(self, current_features, next_features, current_position=None):
        """Find optimal mix points that minimize wasted time in both tracks."""
        
        current_duration = current_features.get('duration', 180)
        next_duration = next_features.get('duration', 180)
        
        # Get available mix points
        current_mix_outs = current_features.get('mix_points', {}).get('mix_out', [])
        next_mix_ins = next_features.get('mix_points', {}).get('mix_in', [])
        
        # Filter mix out points based on current position
        if current_position is not None:
            min_mix_out_time = current_position + 8.0  # At least 8 seconds from now
        else:
            min_mix_out_time = current_duration * 0.7  # Last 30% of track
            
        valid_mix_outs = [
            point for point in current_mix_outs 
            if point['time'] >= min_mix_out_time and point['time'] <= current_duration - 4.0
        ]
        
        # For mix in points, prefer early positions to minimize waste
        # But ensure we're past the intro (use first 20% as maximum)
        intro_end = current_features.get('structure', {}).get('intro_end', 0)
        max_mix_in_time = min(next_duration * 0.2, intro_end + 16.0)  # Max 20% of song or 16s after intro
        
        valid_mix_ins = [
            point for point in next_mix_ins
            if point['time'] <= max_mix_in_time and point['time'] >= intro_end
        ]
        
        # If no early mix ins found, allow up to 30% of the song
        if not valid_mix_ins:
            max_mix_in_time = next_duration * 0.3
            valid_mix_ins = [
                point for point in next_mix_ins
                if point['time'] <= max_mix_in_time and point['time'] >= intro_end
            ]
        
        # Select best mix out point (prefer high confidence, late in song)
        best_mix_out = None
        if valid_mix_outs:
            best_mix_out = max(valid_mix_outs, key=lambda p: p['confidence'] + (p['time'] / current_duration) * 0.3)
        else:
            # Fallback: create a basic mix out point
            fallback_time = max(min_mix_out_time, current_duration - 16.0)
            best_mix_out = {
                'time': fallback_time,
                'type': 'beat_aligned',
                'confidence': 0.6,
                'phrase_position': 'phrase_start'
            }
            
        # Select best mix in point (prefer high confidence, early in song)
        best_mix_in = None
        if valid_mix_ins:
            best_mix_in = max(valid_mix_ins, key=lambda p: p['confidence'] - (p['time'] / next_duration) * 0.5)
        else:
            # Fallback: create a basic mix in point
            fallback_time = min(max_mix_in_time, intro_end + 8.0)
            best_mix_in = {
                'time': fallback_time,
                'type': 'beat_aligned', 
                'confidence': 0.6,
                'phrase_position': 'phrase_start'
            }
        
        # Convert to MixPoint objects with additional data
        beats_current = current_features.get('beat_times', [])
        beats_next = next_features.get('beat_times', [])
        
        mix_out_point = self._create_mix_point(best_mix_out, beats_current, current_features)
        mix_in_point = self._create_mix_point(best_mix_in, beats_next, next_features)
        
        return {
            'out': mix_out_point,
            'in': mix_in_point
        }
    
    def _create_mix_point(self, point_data, beat_times, song_features):
        """Convert mix point data to structured MixPoint object."""
        time_seconds = point_data['time']
        
        # Calculate bar and phrase positions
        bar_position = 1
        phrase_position = 1
        energy_level = 0.5
        beat_strength = 0.8
        
        if beat_times:
            # Find closest beat
            closest_beat_idx = min(range(len(beat_times)), key=lambda i: abs(beat_times[i] - time_seconds))
            
            # Estimate bar position (assuming 4 beats per bar)
            bar_position = (closest_beat_idx % 4) + 1
            
            # Estimate phrase position (assuming 8 bars per phrase)
            phrase_position = ((closest_beat_idx // 4) % 8) + 1
            
            # Calculate beat strength based on proximity to actual beat
            beat_distance = abs(beat_times[closest_beat_idx] - time_seconds)
            beat_strength = max(0.3, 1.0 - (beat_distance * 10))  # Strong if within 0.1s of beat
        
        # Get energy level from song analysis
        energy_data = song_features.get('energy', {})
        if 'peak_energy' in energy_data:
            energy_level = min(1.0, energy_data['peak_energy'] / max(energy_data.get('analyses', {}).get('phrase', {}).get('stats', {}).get('rms_mean', 1.0), 0.1))
        
        return MixPoint(
            time_seconds=float(time_seconds),
            bar_position=bar_position,
            phrase_position=phrase_position,
            energy_level=float(energy_level),
            confidence=float(point_data['confidence']),
            beat_strength=float(beat_strength)
        )
    
    def _calculate_bpm_sync(self, current_bpm, next_bpm):
        """Calculate BPM synchronization requirements."""
        if current_bpm <= 0 or next_bpm <= 0:
            return BPMSyncInstruction(
                sync_type=BPMSync.NONE,
                pitch_adjustment=0.0,
                target_bpm=next_bpm,
                current_bpm=current_bpm
            )
        
        bpm_ratio = next_bpm / current_bpm
        
        # Determine sync strategy
        if 0.94 <= bpm_ratio <= 1.06:  # Within 6%
            sync_type = BPMSync.NONE
            pitch_adjustment = 0.0
            target_bpm = next_bpm
        elif 0.47 <= bpm_ratio <= 0.53:  # Half time
            sync_type = BPMSync.HALF_TIME
            pitch_adjustment = -50.0
            target_bpm = current_bpm / 2
        elif 1.9 <= bpm_ratio <= 2.1:  # Double time
            sync_type = BPMSync.DOUBLE_TIME
            pitch_adjustment = 100.0
            target_bpm = current_bpm * 2
        elif bpm_ratio < 1.0:  # Slow down
            sync_type = BPMSync.PITCH_DOWN
            pitch_adjustment = (bpm_ratio - 1.0) * 100
            target_bpm = next_bpm
        else:  # Speed up
            sync_type = BPMSync.PITCH_UP
            pitch_adjustment = (bpm_ratio - 1.0) * 100
            target_bpm = next_bpm
        
        return BPMSyncInstruction(
            sync_type=sync_type,
            pitch_adjustment=pitch_adjustment,
            target_bpm=target_bpm,
            current_bpm=current_bpm
        )
    
    def _calculate_key_shift(self, current_key, next_key):
        """Calculate semitone shift needed for key matching."""
        if current_key == 'Unknown' or next_key == 'Unknown':
            return 0
            
        # Use simplified semitone calculation for Camelot keys
        try:
            current_num = int(current_key[:-1])
            next_num = int(next_key[:-1])
            current_letter = current_key[-1]
            next_letter = next_key[-1]
            
            # If same mode (A or B), calculate difference
            if current_letter == next_letter:
                diff = (next_num - current_num) % 12
                if diff > 6:
                    diff -= 12
                return diff
            else:
                # Different modes, use relative major/minor (3 semitones)
                base_diff = (next_num - current_num) % 12
                if base_diff > 6:
                    base_diff -= 12
                
                # Add mode difference
                if current_letter == 'A' and next_letter == 'B':  # Minor to major
                    return base_diff + 3
                else:  # Major to minor
                    return base_diff - 3
                    
        except (ValueError, IndexError):
            return 0
        
        return 0
    
    def _determine_mix_type(self, current_features, next_features, mix_points):
        """Determine the best mixing technique based on musical characteristics."""
        
        # Get energy levels at mix points
        current_energy = mix_points['out'].energy_level
        next_energy = mix_points['in'].energy_level
        
        # Get structural information
        current_type = current_features.get('mix_points', {}).get('mix_out', [{}])[0].get('type', 'beat_aligned')
        next_type = next_features.get('mix_points', {}).get('mix_in', [{}])[0].get('type', 'beat_aligned')
        
        # Decision logic for mix type
        if 'breakdown' in current_type or 'breakdown' in next_type:
            return MixType.BREAKDOWN_MIX
        elif 'buildup' in current_type or 'buildup' in next_type:
            return MixType.BUILDUP_MIX
        elif abs(current_energy - next_energy) > 0.3:
            return MixType.FILTER_SWEEP  # Large energy difference
        elif current_energy > 0.8 and next_energy > 0.8:
            return MixType.CUT  # High energy, quick cut
        else:
            return MixType.CROSSFADE  # Default smooth transition
    
    def _calculate_timing_precision(self, current_features, next_features, mix_points):
        """Calculate precise timing parameters for the mix."""
        
        # Base durations based on mix type and energy
        current_bpm = current_features.get('bpm', 128)
        next_bpm = next_features.get('bpm', 128)
        
        # Calculate beat length for timing
        beat_length_current = 60.0 / current_bpm
        beat_length_next = 60.0 / next_bpm
        
        # Get energy levels at mix points
        energy_out = mix_points['out'].energy_level
        energy_in = mix_points['in'].energy_level
        energy_diff = abs(energy_out - energy_in)
        
        # Dynamic overlap duration based on energy matching
        # Better energy match = shorter, tighter mix
        # Worse energy match = longer, smoother transition
        if energy_diff < 0.15:
            # Very similar energy - tight DJ blend (6-10 beats)
            overlap_beats = 6 + (energy_diff * 26)  # 6-10 beats
            curve = "dj_blend"  # Professional DJ crossfade
        elif energy_diff < 0.3:
            # Moderate energy difference - smooth DJ blend (8-14 beats)
            overlap_beats = 8 + (energy_diff * 20)  # 8-14 beats
            curve = "dj_blend"  # Keep both tracks present
        elif energy_diff < 0.5:
            # Large energy difference - extended DJ blend (10-16 beats)
            overlap_beats = 10 + (energy_diff * 12)  # 10-16 beats
            curve = "exponential"  # Smoother for big energy changes
        else:
            # Very different energy - quick cut (4-6 beats)
            overlap_beats = 4 + min(energy_diff * 4, 2)  # 4-6 beats
            curve = "cut"
        
        # Use average beat length for overlap calculation
        avg_beat_length = (beat_length_current + beat_length_next) / 2
        overlap_duration = avg_beat_length * overlap_beats
        
        # Adjust overlap caps for better DJ mixing
        overlap_duration = min(overlap_duration, 20.0)  # Max 20 seconds (allow longer blends)
        overlap_duration = max(overlap_duration, 3.0)   # Min 3 seconds (enough time to hear both)
        
        # Mix out/in durations match the overlap
        out_duration = overlap_duration
        in_duration = overlap_duration
        
        # Beat sync offset (fine timing adjustment)
        beat_offset = 0.0  # Will be calculated in real-time
        
        # Phrase alignment - prefer phrase-aligned mixes
        phrase_align = mix_points['out'].bar_position == 1 and mix_points['in'].bar_position == 1
        
        return {
            'out_duration': out_duration,
            'in_duration': in_duration,
            'overlap': overlap_duration,
            'beat_offset': beat_offset,
            'phrase_align': phrase_align,
            'curve': curve
        }
    
    def _calculate_mix_quality_scores(self, current_features, next_features, mix_points, bpm_sync):
        """Calculate quality scores for the mix."""
        
        # Compatibility score (BPM + Key + Energy)
        bpm_score = 1.0 if bpm_sync.sync_type == BPMSync.NONE else max(0.6, 1.0 - abs(bpm_sync.pitch_adjustment) / 100)
        
        # Key compatibility
        key_current = current_features.get('camelot_key', 'Unknown') 
        key_next = next_features.get('camelot_key', 'Unknown')
        key_score = 1.0 if key_next in current_features.get('compatible_keys', []) else 0.6
        
        # Energy flow score  
        energy_diff = abs(mix_points['out'].energy_level - mix_points['in'].energy_level)
        energy_flow_score = max(0.3, 1.0 - energy_diff)
        
        # Overall compatibility
        compatibility = (bpm_score * 0.4 + key_score * 0.3 + energy_flow_score * 0.3)
        
        # Timing precision score
        timing_precision = (mix_points['out'].confidence + mix_points['in'].confidence) / 2
        
        return {
            'compatibility': compatibility,
            'energy_flow': energy_flow_score,
            'harmonic': key_score,
            'timing': timing_precision
        }
    
    def _create_fallback_mix_instruction(self):
        """Create a basic fallback mix instruction when analysis fails."""
        return MixInstruction(
            mix_out_point=MixPoint(60.0, 1, 1, 0.5, 0.5, 0.8),
            mix_out_duration=8.0,
            mix_in_point=MixPoint(8.0, 1, 1, 0.5, 0.5, 0.8),
            mix_in_duration=8.0,
            bpm_sync=BPMSyncInstruction(BPMSync.NONE, 0.0, 128.0, 128.0),
            key_shift_semitones=0,
            mix_type=MixType.CROSSFADE,
            crossfade_curve="linear",
            overlap_duration=8.0,
            beat_sync_offset=0.0,
            phrase_alignment=True,
            compatibility_score=0.5,
            energy_flow_score=0.5,
            harmonic_compatibility=0.5,
            timing_precision=0.5
        )
        """Analyze how well two tracks work together for mixing."""
        compatibility = {
            'bpm': 0.0,
            'key': 0.0, 
            'energy': 0.0,
            'structure': 0.0,
            'overall_score': 0.0,
            'issues': [],
            'strengths': []
        }
        
        # BPM Compatibility
        bpm1, bpm2 = current_features['bpm'], next_features['bpm']
        bpm_ratio = max(bpm1, bpm2) / min(bpm1, bpm2) if min(bpm1, bpm2) > 0 else float('inf')
        
        if bpm_ratio <= 1.0 + self.bpm_tolerance:
            compatibility['bpm'] = 1.0
            compatibility['strengths'].append(f"Perfect BPM match: {bpm1:.1f} ≈ {bpm2:.1f}")
        elif bpm_ratio <= 1.25:
            compatibility['bpm'] = 0.8
            compatibility['strengths'].append(f"Good BPM compatibility: {bpm1:.1f} → {bpm2:.1f}")
        elif bpm_ratio <= 1.5:
            compatibility['bpm'] = 0.6
            compatibility['issues'].append(f"Moderate BPM difference: {bpm1:.1f} vs {bpm2:.1f}")
        elif bpm_ratio <= 2.0:
            compatibility['bpm'] = 0.4
            compatibility['issues'].append(f"Large BPM difference: {bpm1:.1f} vs {bpm2:.1f}")
        else:
            compatibility['bpm'] = 0.2
            compatibility['issues'].append(f"Extreme BPM difference: {bpm1:.1f} vs {bpm2:.1f}")
        
        # Key Compatibility
        key1 = current_features.get('camelot_key', 'Unknown')
        key2 = next_features.get('camelot_key', 'Unknown')
        compatible_keys = current_features.get('compatible_keys', [])
        
        if key1 == key2:
            compatibility['key'] = 1.0
            compatibility['strengths'].append(f"Same key: {key1}")
        elif key2 in compatible_keys:
            compatibility['key'] = 0.9
            compatibility['strengths'].append(f"Harmonically compatible: {key1} → {key2}")
        elif key1 != 'Unknown' and key2 != 'Unknown':
            # Check if they're close on Camelot wheel
            key_distance = self._calculate_camelot_distance(key1, key2)
            if key_distance <= 2:
                compatibility['key'] = 0.7
                compatibility['strengths'].append(f"Nearby keys: {key1} → {key2}")
            else:
                compatibility['key'] = 0.4
                compatibility['issues'].append(f"Key clash: {key1} → {key2}")
        else:
            compatibility['key'] = 0.6  # Unknown key, neutral score
            
        # Energy Compatibility
        energy1 = current_features.get('energy', {}).get('peak_energy', 0)
        energy2 = next_features.get('energy', {}).get('peak_energy', 0)
        
        if energy1 > 0 and energy2 > 0:
            energy_ratio = max(energy1, energy2) / min(energy1, energy2)
            if energy_ratio <= 1.5:
                compatibility['energy'] = 1.0
                compatibility['strengths'].append("Excellent energy match")
            elif energy_ratio <= 2.5:
                compatibility['energy'] = 0.8
                compatibility['strengths'].append("Good energy compatibility")
            elif energy_ratio <= 4.0:
                compatibility['energy'] = 0.6
                compatibility['issues'].append("Moderate energy difference")
            else:
                compatibility['energy'] = 0.4
                compatibility['issues'].append("Large energy difference")
        else:
            compatibility['energy'] = 0.7  # Default when energy data unavailable
            
        # Structure Compatibility (based on available mix points)
        current_mix_outs = len(current_features.get('mix_points', {}).get('mix_out', []))
        next_mix_ins = len(next_features.get('mix_points', {}).get('mix_in', []))
        
        if current_mix_outs >= 3 and next_mix_ins >= 3:
            compatibility['structure'] = 1.0
            compatibility['strengths'].append("Plenty of mix points available")
        elif current_mix_outs >= 1 and next_mix_ins >= 1:
            compatibility['structure'] = 0.8
            compatibility['strengths'].append("Adequate mix points available")
        else:
            compatibility['structure'] = 0.5
            compatibility['issues'].append("Limited mix points available")
            
        # Calculate overall score with weights
        weights = {'bpm': 0.35, 'key': 0.25, 'energy': 0.25, 'structure': 0.15}
        compatibility['overall_score'] = sum(
            compatibility[factor] * weights[factor] for factor in weights
        )
        
        return compatibility
        
    def _calculate_camelot_distance(self, key1, key2):
        """Calculate distance between two Camelot keys."""
        try:
            # Extract number and letter
            num1, letter1 = int(key1[:-1]), key1[-1]
            num2, letter2 = int(key2[:-1]), key2[-1]
            
            # Same letter (major/minor), calculate number distance
            if letter1 == letter2:
                return min(abs(num1 - num2), 12 - abs(num1 - num2))
            else:
                # Different letter, add penalty
                num_distance = min(abs(num1 - num2), 12 - abs(num1 - num2))
                return num_distance + 1  # +1 penalty for major/minor difference
        except:
            return 6  # Maximum distance if parsing fails
            
    def _select_optimal_mix_points(self, current_features, next_features, current_position, compatibility):
        """Select the best mix points for both tracks."""
        mix_points = {
            'current_song_out': None,
            'next_song_in': None,
            'alternative_windows': []
        }
        
        # Get available mix points
        current_mix_outs = current_features.get('mix_points', {}).get('mix_out', [])
        next_mix_ins = next_features.get('mix_points', {}).get('mix_in', [])
        
        current_duration = current_features.get('duration', 180)
        
        # Filter mix out points based on current position
        if current_position is not None:
            # Only consider mix out points that are in the future
            valid_mix_outs = [
                point for point in current_mix_outs 
                if point['time'] > current_position + 10  # At least 10 seconds ahead
            ]
        else:
            # If no current position, prefer mix points in the last 40% of the track
            valid_mix_outs = [
                point for point in current_mix_outs
                if point['time'] > current_duration * 0.6
            ]
            
        # Score and select best mix out point
        if valid_mix_outs:
            scored_mix_outs = []
            for point in valid_mix_outs:
                score = point['confidence']
                
                # Bonus for good phrase positions
                if point.get('phrase_position') in ['phrase_start', 'phrase_end']:
                    score += 0.1
                    
                # Bonus for breakdown starts (good for mixing out)
                if point.get('type') == 'breakdown_start':
                    score += 0.15
                    
                scored_mix_outs.append((score, point))
                
            # Select highest scoring mix out point
            scored_mix_outs.sort(reverse=True)
            mix_points['current_song_out'] = scored_mix_outs[0][1]
            
        # Score and select best mix in point
        if next_mix_ins:
            scored_mix_ins = []
            for point in next_mix_ins:
                score = point['confidence']
                
                # Bonus for good phrase positions
                if point.get('phrase_position') in ['phrase_start', 'phrase_end']:
                    score += 0.1
                    
                # Bonus for buildup starts and breakdown ends (good for mixing in)
                if point.get('type') in ['buildup_start', 'breakdown_end']:
                    score += 0.15
                    
                scored_mix_ins.append((score, point))
                
            # Select highest scoring mix in point
            scored_mix_ins.sort(reverse=True)
            mix_points['next_song_in'] = scored_mix_ins[0][1]
            
        # Generate alternative timing windows for flexibility
        if len(valid_mix_outs) > 1 and len(next_mix_ins) > 1:
            # Create alternative combinations
            for i in range(1, min(3, len(valid_mix_outs), len(next_mix_ins))):
                alt_out = scored_mix_outs[i][1] if i < len(scored_mix_outs) else None
                alt_in = scored_mix_ins[i][1] if i < len(scored_mix_ins) else None
                
                if alt_out and alt_in:
                    mix_points['alternative_windows'].append({
                        'mix_out': alt_out,
                        'mix_in': alt_in,
                        'combined_confidence': (alt_out['confidence'] + alt_in['confidence']) / 2
                    })
                    
        return mix_points
        
    def _calculate_mixing_adjustments(self, current_features, next_features, compatibility):
        """Calculate BPM and key adjustments needed for smooth mixing."""
        adjustments = {
            'bpm': {'type': 'none', 'factor': 1.0, 'description': ''},
            'key': {'type': 'none', 'semitones': 0, 'description': ''},
            'notes': []
        }
        
        # BPM Adjustment
        bpm1 = current_features['bpm']
        bpm2 = next_features['bpm']
        
        if bpm1 > 0 and bpm2 > 0:
            bpm_ratio = bpm2 / bpm1
            
            if abs(bpm_ratio - 1.0) <= self.bpm_tolerance:
                adjustments['bpm'] = {
                    'type': 'none',
                    'factor': 1.0,
                    'description': f'No BPM adjustment needed ({bpm1:.1f} ≈ {bpm2:.1f})'
                }
            elif 0.75 <= bpm_ratio <= 1.33:
                # Direct tempo adjustment
                adjustments['bpm'] = {
                    'type': 'pitch_bend',
                    'factor': bpm_ratio,
                    'percentage': (bpm_ratio - 1.0) * 100,
                    'description': f'Adjust incoming track by {(bpm_ratio - 1.0) * 100:+.1f}% ({bpm2:.1f} → {bpm1:.1f})'
                }
            elif 0.5 <= bpm_ratio <= 0.75 or 1.33 <= bpm_ratio <= 2.0:
                # Half-time or double-time mixing
                if bpm_ratio < 1.0:
                    adjustments['bpm'] = {
                        'type': 'half_time',
                        'factor': bpm_ratio * 2,
                        'description': f'Use half-time mixing: play current track at half speed'
                    }
                else:
                    adjustments['bpm'] = {
                        'type': 'double_time', 
                        'factor': bpm_ratio / 2,
                        'description': f'Use double-time mixing: incoming track at double speed'
                    }
            else:
                adjustments['bpm'] = {
                    'type': 'difficult',
                    'factor': bpm_ratio,
                    'description': f'Extreme BPM difference - consider creative mixing techniques'
                }
                adjustments['notes'].append('Consider using loops, effects, or manual beatmatching')
                
        # Key Adjustment
        if compatibility['key'] < 0.7:
            key1 = current_features.get('camelot_key', 'Unknown')
            key2 = next_features.get('camelot_key', 'Unknown')
            
            if key1 != 'Unknown' and key2 != 'Unknown':
                semitone_difference = self._calculate_semitone_difference(key1, key2)
                
                if abs(semitone_difference) <= 6:
                    adjustments['key'] = {
                        'type': 'pitch_shift',
                        'semitones': -semitone_difference,  # Adjust incoming track
                        'description': f'Pitch shift incoming track by {-semitone_difference:+d} semitones ({key2} → {key1})'
                    }
                else:
                    adjustments['key'] = {
                        'type': 'creative',
                        'semitones': semitone_difference,
                        'description': f'Large key difference - consider using effects or EQ filtering'
                    }
                    adjustments['notes'].append('Use low-pass/high-pass filters during transition')
                    
        return adjustments
        
    def _calculate_semitone_difference(self, key1, key2):
        """Calculate semitone difference between two Camelot keys."""
        # Simplified calculation - in practice would need full key mapping
        try:
            num1, letter1 = int(key1[:-1]), key1[-1]
            num2, letter2 = int(key2[:-1]), key2[-1]
            
            # Each Camelot number represents a different key center
            # This is a simplified calculation
            base_diff = (num2 - num1) % 12
            if base_diff > 6:
                base_diff -= 12
                
            # Add offset for major/minor difference
            if letter1 != letter2:
                base_diff += 3 if letter2 == 'A' else -3
                
            return base_diff
        except:
            return 0
            
    def _determine_transition_strategy(self, current_features, next_features, compatibility, adjustments):
        """Determine the best transition strategy based on track characteristics."""
        
        # Base transition duration based on BPM
        current_bpm = current_features.get('bpm', 128)
        beats_per_second = current_bpm / 60
        
        # Default transition duration (32 beats is common)
        base_duration = 32 / beats_per_second
        
        transition = {
            'type': 'crossfade',
            'duration': base_duration,
            'style': 'smooth',
            'effects': [],
            'description': ''
        }
        
        # Adjust based on compatibility
        if compatibility['overall_score'] >= 0.8:
            # High compatibility - can use longer, smoother transitions
            transition.update({
                'type': 'extended_blend',
                'duration': base_duration * 1.5,
                'style': 'smooth',
                'description': 'Extended smooth blend - tracks are highly compatible'
            })
        elif compatibility['overall_score'] >= 0.6:
            # Good compatibility - standard crossfade
            transition.update({
                'type': 'crossfade',
                'duration': base_duration,
                'style': 'standard',
                'description': 'Standard crossfade with good compatibility'
            })
        elif compatibility['overall_score'] >= 0.4:
            # Moderate compatibility - quicker transition with effects
            transition.update({
                'type': 'quick_cut',
                'duration': base_duration * 0.5,
                'style': 'creative',
                'effects': ['low_pass_filter', 'reverb'],
                'description': 'Quick transition with creative effects'
            })
        else:
            # Low compatibility - use creative techniques
            transition.update({
                'type': 'creative_mix',
                'duration': base_duration * 0.75,
                'style': 'dramatic',
                'effects': ['filter_sweep', 'echo', 'silence_gap'],
                'description': 'Creative mixing techniques for challenging transition'
            })
            
        # Adjust for specific issues
        if adjustments['bpm']['type'] == 'difficult':
            transition['effects'].append('tempo_sync')
            transition['description'] += ' - Use sync effects for BPM matching'
            
        if adjustments['key']['type'] in ['pitch_shift', 'creative']:
            transition['effects'].append('harmonic_filter')
            transition['description'] += ' - Use harmonic filtering for key transition'
            
        return transition
        
    def _generate_mixing_instructions(self, mix_points, adjustments, transition, compatibility):
        """Generate step-by-step mixing instructions."""
        instructions = {
            'preparation': [],
            'execution': [],
            'monitoring': [],
            'troubleshooting': []
        }
        
        # Preparation steps
        if mix_points['current_song_out']:
            out_time = mix_points['current_song_out']['time']
            instructions['preparation'].append(f"Prepare to mix out at {self._format_time(out_time)}")
            
        if mix_points['next_song_in']:
            in_time = mix_points['next_song_in']['time']
            instructions['preparation'].append(f"Cue next track to {self._format_time(in_time)}")
            
        if adjustments['bpm']['type'] != 'none':
            instructions['preparation'].append(f"BPM: {adjustments['bpm']['description']}")
            
        if adjustments['key']['type'] != 'none':
            instructions['preparation'].append(f"Key: {adjustments['key']['description']}")
            
        # Execution steps
        instructions['execution'].append(f"Start {transition['type']} over {transition['duration']:.1f} seconds")
        
        if transition['effects']:
            for effect in transition['effects']:
                instructions['execution'].append(f"Apply {effect.replace('_', ' ')} during transition")
                
        instructions['execution'].append("Monitor beat alignment and adjust as needed")
        instructions['execution'].append("Watch energy levels and crowd response")
        
        # Monitoring
        instructions['monitoring'].append("Check beat sync throughout transition")
        instructions['monitoring'].append("Monitor EQ levels to prevent muddiness")
        instructions['monitoring'].append("Adjust crossfader position smoothly")
        
        if compatibility['overall_score'] < 0.6:
            instructions['monitoring'].append("Extra attention needed - compatibility issues detected")
            
        # Troubleshooting
        instructions['troubleshooting'].append("If beats drift: use pitch bend or sync button")
        instructions['troubleshooting'].append("If keys clash: use high/low pass filters")
        instructions['troubleshooting'].append("If transition feels rushed: extend using loops")
        
        if mix_points['alternative_windows']:
            alt_times = [w['mix_out']['time'] for w in mix_points['alternative_windows']]
            instructions['troubleshooting'].append(f"Alternative mix points available at: {[self._format_time(t) for t in alt_times]}")
            
        return instructions
        
    def _format_time(self, seconds):
        """Format time in MM:SS format."""
        minutes = int(seconds // 60)
        secs = int(seconds % 60)
        return f"{minutes}:{secs:02d}"
        
    def _create_fallback_mix(self):
        """Create a basic fallback mix when features are insufficient."""
        return {
            'compatibility_score': 0.5,
            'mix_out_point': None,
            'mix_in_point': None,
            'bpm_adjustment': {'type': 'manual', 'description': 'Manual beatmatching required'},
            'key_adjustment': {'type': 'manual', 'description': 'Manual key matching required'},
            'transition_duration': 16.0,  # 16 seconds default
            'transition_type': 'manual_crossfade',
            'mixing_instructions': {
                'preparation': ['Analyze tracks manually', 'Find suitable mix points by ear'],
                'execution': ['Use manual beatmatching', 'Apply standard crossfade'],
                'monitoring': ['Listen carefully for beat alignment', 'Adjust tempo as needed'],
                'troubleshooting': ['Rely on manual DJ skills', 'Use EQ to resolve conflicts']
            },
            'technical_notes': ['Insufficient feature data - manual mixing recommended']
        }


def pretty_print_dj_analysis(features):
    """Pretty print DJ analysis results in a formatted, readable way."""
    if not features:
        print("❌ No DJ analysis data available")
        return
        
    print("🎵 " + "="*60)
    print("🎧 DJ ANALYSIS REPORT")
    print("🎵 " + "="*60)
    
    # Basic Info
    print(f"\n📊 BASIC INFO:")
    print(f"   Duration: {features.get('duration', 0):.1f} seconds ({features.get('duration', 0)//60:.0f}:{features.get('duration', 0)%60:02.0f})")
    print(f"   BPM: {features.get('bpm', 0):.2f} (confidence: {features.get('bpm_confidence', 0):.1%}, stability: {features.get('bpm_stability', 0):.1%})")
    print(f"   Beats detected: {features.get('num_beats', 0)}")
    
    # Musical Key
    print(f"\n🎼 HARMONIC INFO:")
    key = features.get('key', 'Unknown')
    scale = features.get('scale', 'Unknown') 
    camelot = features.get('camelot_key', 'Unknown')
    key_strength = features.get('key_strength', 0)
    print(f"   Key: {key} {scale} (Camelot: {camelot})")
    print(f"   Key strength: {key_strength:.1%}")
    
    compatible = features.get('compatible_keys', [])
    if compatible:
        print(f"   Compatible keys: {', '.join(compatible[:4])}{' ...' if len(compatible) > 4 else ''}")
    
    # Energy Analysis
    energy = features.get('energy', {})
    print(f"\n⚡ ENERGY ANALYSIS:")
    print(f"   Peak energy: {energy.get('peak_energy', 0):.4f}")
    print(f"   Energy variance: {energy.get('energy_variance', 0):.6f}")
    
    # Structure Analysis
    structure = features.get('structure', {})
    print(f"\n🏗️  STRUCTURE:")
    print(f"   Intro ends: {structure.get('intro_end', 0):.1f}s")
    print(f"   Outro starts: {structure.get('outro_start', features.get('duration', 0)):.1f}s")
    
    breakdowns = structure.get('breakdowns', [])
    if breakdowns:
        print(f"   Breakdowns ({len(breakdowns)}):")
        for i, bd in enumerate(breakdowns[:3]):
            print(f"     {i+1}. {bd['start']:.1f}s - {bd['end']:.1f}s (confidence: {bd['confidence']:.1%})")
    
    buildups = structure.get('buildups', [])
    if buildups:
        print(f"   Buildups ({len(buildups)}):")
        for i, bu in enumerate(buildups[:3]):
            print(f"     {i+1}. {bu['start']:.1f}s - {bu['end']:.1f}s (confidence: {bu['confidence']:.1%})")
    
    # Mix Points
    mix_points = features.get('mix_points', {})
    mix_ins = mix_points.get('mix_in', [])
    mix_outs = mix_points.get('mix_out', [])
    
    print(f"\n🎚️  MIX POINTS:")
    print(f"   Mix IN points: {len(mix_ins)} found")
    if mix_ins:
        print("   Top Mix IN candidates:")
        for i, point in enumerate(mix_ins[:5]):
            time_str = f"{point['time']//60:.0f}:{point['time']%60:02.0f}"
            conf_pct = point.get('confidence', 0) * 100
            point_type = point.get('type', 'unknown')
            phrase = point.get('phrase_position', 'unknown')
            print(f"     {i+1}. {time_str} - {point_type} ({conf_pct:.0f}%) [{phrase}]")
    
    print(f"   Mix OUT points: {len(mix_outs)} found")
    if mix_outs:
        print("   Top Mix OUT candidates:")
        for i, point in enumerate(mix_outs[:5]):
            time_str = f"{point['time']//60:.0f}:{point['time']%60:02.0f}"
            conf_pct = point.get('confidence', 0) * 100
            point_type = point.get('type', 'unknown')
            phrase = point.get('phrase_position', 'unknown')
            print(f"     {i+1}. {time_str} - {point_type} ({conf_pct:.0f}%) [{phrase}]")
    
    # Loops
    loops = features.get('loops', {}).get('sections', [])
    if loops:
        print(f"\n🔄 LOOP SECTIONS:")
        for i, loop in enumerate(loops[:3]):
            start_time = f"{loop['start']//60:.0f}:{loop['start']%60:02.0f}"
            end_time = f"{loop['end']//60:.0f}:{loop['end']%60:02.0f}"
            print(f"     {i+1}. {start_time} - {end_time} ({loop['length_beats']} beats, quality: {loop['quality_score']:.1%})")
    
    print("\n" + "="*60)


def pretty_print_mix_instructions(mix_result):
    """Pretty print mixing instructions in a formatted way."""
    if not mix_result:
        print("❌ No mix calculation available")
        return
        
    print("🎛️  " + "="*60)
    print("🎧 MIXING INSTRUCTIONS")
    print("🎛️  " + "="*60)
    
    # Compatibility Overview
    compat_score = mix_result.get('compatibility_score', 0)
    print(f"\n📊 COMPATIBILITY: {compat_score:.1%}", end="")
    if compat_score >= 0.8:
        print(" 🟢 EXCELLENT")
    elif compat_score >= 0.6:
        print(" 🟡 GOOD") 
    elif compat_score >= 0.4:
        print(" 🟠 MODERATE")
    else:
        print(" 🔴 CHALLENGING")
    
    # Key Mix Points
    print(f"\n🎯 MIX POINTS:")
    mix_out = mix_result.get('mix_out_point')
    mix_in = mix_result.get('mix_in_point')
    
    if mix_out:
        out_time = f"{mix_out['time']//60:.0f}:{mix_out['time']%60:02.0f}"
        print(f"   Mix OUT: {out_time} ({mix_out.get('type', 'unknown')}, {mix_out.get('confidence', 0):.1%} confidence)")
    else:
        print("   Mix OUT: ⚠️  No optimal point found - manual selection needed")
        
    if mix_in:
        in_time = f"{mix_in['time']//60:.0f}:{mix_in['time']%60:02.0f}"
        print(f"   Mix IN:  {in_time} ({mix_in.get('type', 'unknown')}, {mix_in.get('confidence', 0):.1%} confidence)")
    else:
        print("   Mix IN:  ⚠️  No optimal point found - manual selection needed")
    
    # Technical Adjustments
    print(f"\n🔧 TECHNICAL ADJUSTMENTS:")
    
    bpm_adj = mix_result.get('bpm_adjustment', {})
    if bpm_adj.get('type') != 'none':
        print(f"   BPM: {bpm_adj.get('description', 'Manual adjustment needed')}")
    else:
        print("   BPM: ✅ No adjustment needed")
        
    key_adj = mix_result.get('key_adjustment', {})
    if key_adj.get('type') != 'none':
        print(f"   Key: {key_adj.get('description', 'Manual adjustment needed')}")
    else:
        print("   Key: ✅ No adjustment needed")
    
    # Transition Strategy
    print(f"\n🎚️  TRANSITION:")
    transition_type = mix_result.get('transition_type', 'crossfade')
    transition_duration = mix_result.get('transition_duration', 16)
    print(f"   Type: {transition_type.replace('_', ' ').title()}")
    print(f"   Duration: {transition_duration:.1f} seconds")
    
    # Step-by-step Instructions
    instructions = mix_result.get('mixing_instructions', {})
    
    if instructions.get('preparation'):
        print(f"\n📋 PREPARATION:")
        for step in instructions['preparation']:
            print(f"   • {step}")
    
    if instructions.get('execution'):
        print(f"\n▶️  EXECUTION:")
        for step in instructions['execution']:
            print(f"   • {step}")
            
    if instructions.get('monitoring'):
        print(f"\n👁️  MONITORING:")
        for step in instructions['monitoring']:
            print(f"   • {step}")
    
    # Compatibility Details
    compat_analysis = mix_result.get('compatibility_analysis', {})
    if compat_analysis.get('strengths'):
        print(f"\n✅ STRENGTHS:")
        for strength in compat_analysis['strengths']:
            print(f"   • {strength}")
            
    if compat_analysis.get('issues'):
        print(f"\n⚠️  CHALLENGES:")
        for issue in compat_analysis['issues']:
            print(f"   • {issue}")
    
    # Alternative Options
    alt_windows = mix_result.get('timing_windows', [])
    if alt_windows:
        print(f"\n🔄 ALTERNATIVE TIMING:")
        for i, window in enumerate(alt_windows[:2]):
            out_time = f"{window['mix_out']['time']//60:.0f}:{window['mix_out']['time']%60:02.0f}"
            in_time = f"{window['mix_in']['time']//60:.0f}:{window['mix_in']['time']%60:02.0f}"
            conf = window.get('combined_confidence', 0)
            print(f"   {i+1}. OUT: {out_time} → IN: {in_time} (confidence: {conf:.1%})")
    
    print("\n" + "="*60)

if __name__ == "__main__":
    print("🎧 Testing Enhanced DJ Mixing System...")
    
    analyzer = DJ_Audio_Analyzer()
    mix_calculator = DJ_Mix_Calculator()
    hls_decoder = decoder.HLS_Audio_Decoder()

    # Test with audio files
    # file_path_1 = os.path.join(analyzer.project_root, 'storage', 'musik', 'temp.music', 'song2.wav')
    # file_path_2 = os.path.join(analyzer.project_root, 'storage', 'musik', 'temp.music', 'song6.wav')

    songs = hls_decoder.get_available_songs()
    print(songs)

    try:
        print("Analyzing first track...")
        # audio_array_1, sample_rate_1 = analyzer.decode_to_numpy(file_path_1)
        audio_array_1, sample_rate_1 = hls_decoder.decode_chunks_to_numpy(songs[0], 'high', max_duration=None)
        features_1 = analyzer.extract_dj_features(audio_array_1, sample_rate_1)
        
        print("Analyzing second track...")
        # audio_array_2, sample_rate_2 = analyzer.decode_to_numpy(file_path_2)
        audio_array_2, sample_rate_2 = hls_decoder.decode_chunks_to_numpy(songs[1], 'high', max_duration=None)
        features_2 = analyzer.extract_dj_features(audio_array_2, sample_rate_2)

        print("Calculating optimal mix...")
        mix_instruction = mix_calculator.calculate_optimal_mix(features_1, features_2)

        print("\n" + "="*80)
        print("🎛️  ENHANCED DJ MIXING RESULT (PROGRAMMATIC FORMAT)")
        print("="*80)
        
        print(f"Mix OUT Point:")
        print(f"  Time: {mix_instruction.mix_out_point.time_seconds:.2f}s")
        print(f"  Bar Position: {mix_instruction.mix_out_point.bar_position}/4")
        print(f"  Phrase Position: {mix_instruction.mix_out_point.phrase_position}/8") 
        print(f"  Energy Level: {mix_instruction.mix_out_point.energy_level:.3f}")
        print(f"  Confidence: {mix_instruction.mix_out_point.confidence:.3f}")
        print(f"  Beat Strength: {mix_instruction.mix_out_point.beat_strength:.3f}")
        
        print(f"\nMix IN Point:")
        print(f"  Time: {mix_instruction.mix_in_point.time_seconds:.2f}s")
        print(f"  Bar Position: {mix_instruction.mix_in_point.bar_position}/4")
        print(f"  Phrase Position: {mix_instruction.mix_in_point.phrase_position}/8")
        print(f"  Energy Level: {mix_instruction.mix_in_point.energy_level:.3f}")
        print(f"  Confidence: {mix_instruction.mix_in_point.confidence:.3f}")
        print(f"  Beat Strength: {mix_instruction.mix_in_point.beat_strength:.3f}")
        
        print(f"\nBPM Synchronization:")
        print(f"  Sync Type: {mix_instruction.bpm_sync.sync_type.value}")
        print(f"  Pitch Adjustment: {mix_instruction.bpm_sync.pitch_adjustment:+.1f}%")
        print(f"  Current BPM: {mix_instruction.bpm_sync.current_bpm:.1f}")
        print(f"  Target BPM: {mix_instruction.bpm_sync.target_bpm:.1f}")
        
        print(f"\nMix Parameters:")
        print(f"  Mix Type: {mix_instruction.mix_type.value}")
        print(f"  Key Shift: {mix_instruction.key_shift_semitones:+d} semitones")
        print(f"  Crossfade Curve: {mix_instruction.crossfade_curve}")
        print(f"  Mix OUT Duration: {mix_instruction.mix_out_duration:.2f}s")
        print(f"  Mix IN Duration: {mix_instruction.mix_in_duration:.2f}s") 
        print(f"  Overlap Duration: {mix_instruction.overlap_duration:.2f}s")
        print(f"  Phrase Alignment: {mix_instruction.phrase_alignment}")
        
        print(f"\nQuality Scores:")
        print(f"  Compatibility: {mix_instruction.compatibility_score:.3f}")
        print(f"  Energy Flow: {mix_instruction.energy_flow_score:.3f}")
        print(f"  Harmonic Compatibility: {mix_instruction.harmonic_compatibility:.3f}")
        print(f"  Timing Precision: {mix_instruction.timing_precision:.3f}")
        
        print("\n" + "="*80)
        print("✅ This structured data can be used programmatically by DJ software!")
        print("✅ Much more useful than verbose text descriptions!")
        print("✅ Mix IN point is early in song (minimal waste)!")
        print("✅ Mix OUT point is late in current song (optimal timing)!")
        
        # Show time utilization
        # next_song_duration = features_2.get('duration', 180)
        # waste_percentage = (mix_instruction.mix_in_point.time_seconds / next_song_duration) * 100
        # print(f"✅ Only {waste_percentage:.1f}% of next song wasted (vs {43.9:.1f}% in old system)!")
        
    except Exception as e:
        print(f"❌ Error during test: {e}")
        import traceback
        traceback.print_exc()
