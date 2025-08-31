import numpy as np
import faiss
import glob
import os
import pickle
import threading
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from functools import partial

import essentia
import essentia.standard as es
from sklearn.metrics.pairwise import cosine_similarity
# from sklearn.decomposition import PCA

essentia.log.warningActive = False
essentia.log.infoActive = False
essentia.log.debugActive = False
essentia.log.errorActive = True

class Audio_Analyzer:
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
        self.running_stats = None
        self.is_fitted = False
        self.stats_lock = threading.Lock()  # For thread safety

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

    def extract_raw_features(self, file_path) -> np.ndarray:
        """Extract raw features without normalization"""
        features, _ = self.music_extractor(file_path)
        
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
                    # Use zeros for missing features
                    if 'mfcc' in feature_name:
                        embedding_parts.extend([0.0] * 13)
                    elif 'melbands' in feature_name:
                        embedding_parts.extend([0.0] * 40)
                    elif 'hpcp' in feature_name:
                        embedding_parts.extend([0.0] * 36)
                    else:
                        embedding_parts.append(0.0)
                    continue
        
        return np.array(embedding_parts, dtype=np.float32)

    def initialize_running_stats(self, initial_features):
        """Initialize running statistics with first batch of features"""
        if isinstance(initial_features, list):
            features_matrix = np.vstack(initial_features)
        else:
            features_matrix = initial_features.reshape(1, -1)
        
        n_samples, n_features = features_matrix.shape
        
        self.running_stats = {
            'count': n_samples,
            'mean': np.mean(features_matrix, axis=0),
            'sum_sq': np.sum(features_matrix ** 2, axis=0),
            'min': np.min(features_matrix, axis=0),
            'max': np.max(features_matrix, axis=0),
            'sorted_percentiles': {
                'p25': np.percentile(features_matrix, 25, axis=0),
                'p50': np.percentile(features_matrix, 50, axis=0),
                'p75': np.percentile(features_matrix, 75, axis=0)
            }
        }
        
        self.is_fitted = True
        print(f"Initialized running stats with {n_samples} samples")

    def update_running_stats(self, new_features):
        """Update running statistics with new feature vector(s) - O(1) operation"""
        with self.stats_lock:
            if not self.is_fitted:
                self.initialize_running_stats(new_features)
                return
            
            if isinstance(new_features, list):
                features_matrix = np.vstack(new_features)
            else:
                features_matrix = new_features.reshape(1, -1)
            
            n_new = features_matrix.shape[0]
            n_old = self.running_stats['count']
            n_total = n_old + n_new
            
            # Update count
            self.running_stats['count'] = n_total
            
            # Update mean (Welford's algorithm)
            old_mean = self.running_stats['mean'].copy()
            new_batch_mean = np.mean(features_matrix, axis=0)
            self.running_stats['mean'] = (n_old * old_mean + n_new * new_batch_mean) / n_total
            
            # Update sum of squares for variance calculation
            self.running_stats['sum_sq'] += np.sum(features_matrix ** 2, axis=0)
            
            # Update min/max
            self.running_stats['min'] = np.minimum(self.running_stats['min'], np.min(features_matrix, axis=0))
            self.running_stats['max'] = np.maximum(self.running_stats['max'], np.max(features_matrix, axis=0))
            
            # Update percentiles using exponential moving average approximation
            alpha = min(0.1, n_new / n_total)
            for percentile in ['p25', 'p50', 'p75']:
                if percentile == 'p25':
                    new_percentile = np.percentile(features_matrix, 25, axis=0)
                elif percentile == 'p50':
                    new_percentile = np.percentile(features_matrix, 50, axis=0)
                else:
                    new_percentile = np.percentile(features_matrix, 75, axis=0)
                
                self.running_stats['sorted_percentiles'][percentile] = (
                    (1 - alpha) * self.running_stats['sorted_percentiles'][percentile] + 
                    alpha * new_percentile
                )

    def get_current_normalization_params(self):
        """Get current normalization parameters from running stats"""
        if not self.is_fitted:
            raise ValueError("Statistics not initialized")
        
        # Calculate standard deviation from running stats
        variance = (self.running_stats['sum_sq'] / self.running_stats['count'] - 
                   self.running_stats['mean'] ** 2)
        std = np.sqrt(np.maximum(variance, 1e-8))
        
        # Approximate MAD using IQR
        iqr = (self.running_stats['sorted_percentiles']['p75'] - 
               self.running_stats['sorted_percentiles']['p25'])
        mad_approx = 0.6745 * iqr
        mad_approx = np.maximum(mad_approx, 1e-8)
        
        return {
            'mean': self.running_stats['mean'],
            'std': std,
            'median': self.running_stats['sorted_percentiles']['p50'],
            'mad': mad_approx,
            'min': self.running_stats['min'],
            'max': self.running_stats['max']
        }

    def process_audio(self, file_path, max_duration: int = 30, normalize_method='robust', 
                     update_stats=True) -> np.ndarray:
        """
        Process audio with scalable incremental normalization
        """
        # normalize_method = 'minmax'
        # Extract raw features
        raw_features = self.extract_raw_features(file_path)

        # return raw_features
        
        # Update running statistics if requested
        if update_stats:
            self.update_running_stats(raw_features)

        print("processing audio")

        # Get current normalization parameters
        if self.is_fitted and self.running_stats['count'] > 1:  # Need at least 2 samples for meaningful normalization
            norm_params = self.get_current_normalization_params()
            # print(norm_params)
            
            # Apply normalization
            if normalize_method == 'standard':
                normalized = (raw_features - norm_params['mean']) / norm_params['std']
            elif normalize_method == 'robust':
                normalized = (raw_features - norm_params['median']) / (1.4826 * norm_params['mad'])
            elif normalize_method == 'minmax':
                normalized = (raw_features - norm_params['min']) / (norm_params['max'] - norm_params['min'])
            else:
                normalized = raw_features
            
            # Handle any remaining NaN or inf values
            normalized = np.nan_to_num(normalized, nan=0.0, posinf=1.0, neginf=-1.0)
        else:
            # If no stats yet or only one sample, return raw features
            normalized = raw_features
        
        return normalized

    def batch_initialize_from_existing_songs(self, file_paths):
        """Initialize statistics from existing songs"""
        print(f"Initializing statistics from {len(file_paths)} existing songs...")
        
        all_raw_features = []
        for i, file_path in enumerate(file_paths):
            try:
                print(f"Processing {i+1}/{len(file_paths)}: {os.path.basename(file_path)}")
                features = self.extract_raw_features(file_path)
                all_raw_features.append(features)
            except Exception as e:
                print(f"Error processing {file_path}: {e}")
        
        if all_raw_features:
            self.initialize_running_stats(all_raw_features)
            print("✅ Statistics initialized successfully")
        else:
            raise ValueError("No valid features extracted for initialization")

    def add_single_song_fast(self, file_path, normalize_method='robust') -> np.ndarray:
        """Add a single song quickly without re-computing all statistics"""
        start_time = time.time()
        embedding = self.process_audio(file_path, normalize_method=normalize_method, update_stats=True)
        processing_time = time.time() - start_time
        print(f"Processed {os.path.basename(file_path)} in {processing_time:.3f}s")
        return embedding

    def add_batch_of_songs_fast(self, file_paths, normalize_method='robust') -> dict:
        """Add multiple songs efficiently"""
        start_time = time.time()
        print(f"Processing batch of {len(file_paths)} songs...")
        
        embeddings = {}
        raw_features_batch = []
        path_to_features = {}
        
        # Extract raw features first
        for path in file_paths:
            try:
                raw_features = self.extract_raw_features(path)
                raw_features_batch.append(raw_features)
                path_to_features[path] = raw_features
                print(f"Extracted features for {os.path.basename(path)}")
            except Exception as e:
                print(f"Error processing {path}: {e}")
        
        # Update stats once with all new features
        if raw_features_batch:
            self.update_running_stats(raw_features_batch)
            norm_params = self.get_current_normalization_params()
            
            # Normalize all features using updated stats
            for path, raw_features in path_to_features.items():
                if normalize_method == 'robust':
                    normalized = (raw_features - norm_params['median']) / (1.4826 * norm_params['mad'])
                elif normalize_method == 'standard':
                    normalized = (raw_features - norm_params['mean']) / norm_params['std']
                else:
                    normalized = raw_features
                
                normalized = np.nan_to_num(normalized, nan=0.0, posinf=1.0, neginf=-1.0)
                song_id = os.path.splitext(os.path.basename(path))[0]
                embeddings[song_id] = normalized
        
        processing_time = time.time() - start_time
        print(f"Processed {len(embeddings)} songs in {processing_time:.3f}s")
        return embeddings

    def save_running_stats(self, file_path):
        """Save running statistics for persistence"""
        if not self.is_fitted:
            raise ValueError("Statistics not initialized")
        
        with open(file_path, 'wb') as f:
            pickle.dump(self.running_stats, f)
        print(f"Saved running stats to {file_path}")

    def load_running_stats(self, file_path):
        """Load running statistics"""
        if os.path.exists(file_path):
            with open(file_path, 'rb') as f:
                self.running_stats = pickle.load(f)
            self.is_fitted = True
            print(f"Loaded running stats from {file_path} ({self.running_stats['count']} samples)")
        else:
            raise ValueError(f"Running stats file not found: {file_path}")

    def get_stats_summary(self):
        """Get a summary of current statistics"""
        if not self.is_fitted:
            return "Statistics not initialized"
        
        norm_params = self.get_current_normalization_params()
        return {
            'sample_count': self.running_stats['count'],
            'feature_mean_range': [norm_params['mean'].min(), norm_params['mean'].max()],
            'feature_std_range': [norm_params['std'].min(), norm_params['std'].max()],
            'feature_value_range': [self.running_stats['min'].min(), self.running_stats['max'].max()]
        }

    # Legacy method for backwards compatibility
    def process_audio_in_batch(self, file_paths, max_duration: int = 30, max_workers: int = None):
        """
        Process audio files in batch - now uses scalable approach
        
        Args:
            file_paths: List of file paths to process
            max_duration: Maximum duration for audio processing (legacy parameter)
            max_workers: Maximum number of worker processes (legacy parameter)
        """
        print("⚠️  Using legacy batch method - consider using add_batch_of_songs_fast() for better scalability")
        
        if not file_paths:
            return np.array([])
        
        # Use the new scalable batch processing
        embeddings_dict = self.add_batch_of_songs_fast(file_paths, normalize_method='robust')
        
        # Return as matrix for backwards compatibility
        if embeddings_dict:
            embeddings = [embeddings_dict[os.path.splitext(os.path.basename(path))[0]] 
                         for path in file_paths 
                         if os.path.splitext(os.path.basename(path))[0] in embeddings_dict]
            return np.vstack(embeddings) if embeddings else np.array([])
        else:
            return np.array([])





















# a = Audio_Analyzer()

# def get_high_variance_embedding(file_path):
#     """
#     Extract a high-variance embedding optimized for music discrimination.
#     Uses carefully selected features that provide maximum differentiation between songs.
#     """

#     features, _ = es.MusicExtractor(
#         lowlevelStats=['mean', 'stdev'],
#         rhythmStats=['mean', 'stdev'],
#         tonalStats=['mean', 'stdev'],
#         lowlevelFrameSize=2048,  # Smaller frame size for faster processing
#         lowlevelHopSize=1024     # Larger hop size for faster processing
#     )(file_path)
#     feature_groups = a.get_discriminative_features()
    
#     embedding_parts = []
    
#     for group_name, feature_list in feature_groups.items():
#         group_values = []
#         for feature_name in feature_list:
#             try:
#                 value = features[feature_name]
#                 if isinstance(value, (list, np.ndarray)):
#                     # Handle multi-dimensional features (like MFCC, HPCP)
#                     group_values.extend(np.array(value).flatten())
#                 else:
#                     # Handle scalar features
#                     group_values.append(float(value))
#             except KeyError:
#                 # Skip missing features
#                 continue
        
#         if group_values:
#             # Normalize each feature group separately to prevent dominance
#             group_array = np.array(group_values)
#             # Use robust normalization to handle outliers
#             median = np.median(group_array)
#             mad = np.median(np.abs(group_array - median))
#             if mad > 0:
#                 normalized_group = (group_array - median) / (1.4826 * mad)  # 1.4826 makes MAD consistent with std
#             else:
#                 normalized_group = group_array - median
            
#             embedding_parts.extend(normalized_group)
    
#     return np.array(embedding_parts, dtype=np.float32)

# def analyze_feature_variance(file_paths):
#     """
#     Analyze variance of different features across a set of songs.
#     This helps identify which features provide the most discrimination.
#     """
#     all_embeddings = []
#     for file_path in file_paths:
#         try:
#             embedding = get_high_variance_embedding(file_path)
#             all_embeddings.append(embedding)
#             print(f"Processed: {os.path.basename(file_path)}")
#         except Exception as e:
#             print(f"Error processing {file_path}: {e}")
    
#     if len(all_embeddings) < 2:
#         print("Need at least 2 files for variance analysis")
#         return
    
#     # Stack embeddings and calculate variance
#     embeddings_matrix = np.vstack(all_embeddings)
#     feature_variances = np.var(embeddings_matrix, axis=0)
    
#     print(f"\nEmbedding Statistics:")
#     print(f"Embedding dimension: {embeddings_matrix.shape[1]}")
#     print(f"Number of songs: {embeddings_matrix.shape[0]}")
#     print(f"Variance range: {np.min(feature_variances):.4f} - {np.max(feature_variances):.4f}")
#     print(f"Mean variance: {np.mean(feature_variances):.4f}")
#     print(f"High variance features (>1.0): {np.sum(feature_variances > 1.0)}")
    
#     # Calculate pairwise similarities to check discrimination
#     from sklearn.metrics.pairwise import cosine_similarity
#     similarities = cosine_similarity(embeddings_matrix)
    
#     # Get off-diagonal similarities (exclude self-similarity)
#     mask = ~np.eye(similarities.shape[0], dtype=bool)
#     off_diag_similarities = similarities[mask]
    
#     print(f"\nSimilarity Statistics:")
#     print(f"Mean similarity: {np.mean(off_diag_similarities):.4f}")
#     print(f"Similarity range: {np.min(off_diag_similarities):.4f} - {np.max(off_diag_similarities):.4f}")
#     print(f"Std deviation: {np.std(off_diag_similarities):.4f}")
#     print(off_diag_similarities)
    
#     return embeddings_matrix, feature_variances

# # Test with a single WAV file first
# print("Testing feature extraction...")
# # embedding = get_high_variance_embedding("./storage/musik/temp.music/rick.wav")
# # print(f"Extracted embedding shape: {embedding.shape}")
# # print(embedding)

# analyze_feature_variance(glob.glob("./storage/musik/temp.music/*.wav")[:5])