import os
import sys
import librosa
import numpy as np
import faiss
import pickle
import time
from typing import Optional, List, Dict, Tuple

# Add the parent directory to path to import analysis
sys.path.append(os.path.dirname(__file__))
from analysis import Audio_Analyzer
from analysis_2 import Audio_Analyzer as Audio_Analyzer_2

class Music_Recommender:
    index_name = "music_index.faiss"
    embeddings_name = "embeddings.pkl"
    running_stats_name = "running_stats.pkl"
    metadata_name = "song_metadata.pkl"
    song_order_name = "song_order.pkl"  # Track song order for FAISS index

    def __init__(self):
        self.audio_analyzer = Audio_Analyzer()
        self.audio_analyzer_2 = Audio_Analyzer_2()
        self.embedding_dimensions = self.audio_analyzer.embedding_dimensions

        self.project_root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        self.storage_dir = os.path.join(self.project_root, "storage", "musik", "recommendation")
        os.makedirs(self.storage_dir, exist_ok=True)
        
        self.index_path = os.path.join(self.storage_dir, self.index_name)
        self.embeddings_path = os.path.join(self.storage_dir, self.embeddings_name)
        self.running_stats_path = os.path.join(self.storage_dir, self.running_stats_name)
        self.metadata_path = os.path.join(self.storage_dir, self.metadata_name)
        self.song_order_path = os.path.join(self.storage_dir, self.song_order_name)

        # Load existing data
        self._load_all_data()

    def _load_all_data(self):
        """Load all existing data (index, embeddings, stats, metadata)"""
        # Load running stats for normalization
        try:
            self.audio_analyzer.load_running_stats(self.running_stats_path)
            print(f"✅ Loaded normalization stats ({self.audio_analyzer.running_stats['count']} samples)")
        except:
            print("⚠️  No normalization stats found. Will initialize on first batch.")

        # Load FAISS index
        self.load_index(self.index_path)
        
        # Load embeddings
        self.embeddings = self.load_embeddings(self.embeddings_path)
        
        # Load metadata
        self.metadata = self.load_metadata(self.metadata_path)

        # Load song order for FAISS index consistency
        self.song_order = self.load_song_order()

    def load_index(self, index_path):
        """Load FAISS index from file"""
        if os.path.exists(index_path):
            self.index = faiss.read_index(index_path)
            print(f"Loaded index from {index_path}")
        else:
            print(f"Index file {index_path} does not exist. Creating new index...")
            self.create_index(self.embedding_dimensions)  
    
    def create_index(self, dimension):
        """Create a new FAISS index optimized for cosine similarity"""
        self.index = faiss.IndexFlatL2(dimension)  # L2 distance 
        print(f"Created L2 index with dimension {dimension}")

    def save_index(self, index, index_path):
        """Save FAISS index to file"""
        faiss.write_index(index, index_path)
        print(f"Saved index to {index_path}")
    
    def add_embeddings_to_index(self, embeddings):
        """Add embeddings to the FAISS index"""
        if self.index is not None:
            self.index.add(embeddings)
            print(f"Added {embeddings.shape[0]} embeddings to the index.")
            self.save_index(self.index, self.index_path)
        else:
            print("Index is not initialized.")
    
    def load_embeddings(self, file_path) -> Optional[Dict]:
        """Load embeddings from file"""
        if os.path.exists(file_path):
            with open(file_path, 'rb') as f:
                embeddings = pickle.load(f)
            print(f"✅ Loaded {len(embeddings)} embeddings")
            return embeddings
        else:
            print("No existing embeddings found.")
            return {}

    def load_metadata(self, file_path) -> Dict:
        """Load song metadata"""
        if os.path.exists(file_path):
            with open(file_path, 'rb') as f:
                metadata = pickle.load(f)
            print(f"✅ Loaded metadata for {len(metadata)} songs")
            return metadata
        else:
            return {}

    def save_metadata(self):
        """Save song metadata"""
        with open(self.metadata_path, 'wb') as f:
            pickle.dump(self.metadata, f)
    
    def add_embedding(self, song_id, embedding):
        """Add embeddings to the embeddings dict and save"""
        if self.embeddings is None:
            self.embeddings = {}
        self.embeddings[song_id] = embedding
        self.save_embeddings(self.embeddings, self.embeddings_path)
        print(f"Added embedding for {song_id} and saved to {self.embeddings_path}")

    def save_embeddings(self):
        """Save embeddings to file"""
        with open(self.embeddings_path, 'wb') as f:
            pickle.dump(self.embeddings, f)
        print(f"💾 Saved {len(self.embeddings)} embeddings")

    def save_index(self):
        """Save FAISS index to file"""
        faiss.write_index(self.index, self.index_path)
        print(f"💾 Saved index to {self.index_path}")

    def load_song_order(self) -> List[str]:
        """Load song order list for FAISS index mapping"""
        if os.path.exists(self.song_order_path):
            with open(self.song_order_path, 'rb') as f:
                song_order = pickle.load(f)
            print(f"✅ Loaded song order for {len(song_order)} songs")
            return song_order
        else:
            return []

    def save_song_order(self):
        """Save song order list"""
        with open(self.song_order_path, 'wb') as f:
            pickle.dump(self.song_order, f)

    def _ensure_normalizer_ready(self):
        """Ensure normalizer is ready, initialize if needed"""
        if not self.audio_analyzer.is_fitted:
            print("🔧 Initializing normalizer from existing songs...")
            music_dir = os.path.join(self.project_root, "storage/musik/temp.music")
            audio_files = [os.path.join(music_dir, f) for f in os.listdir(music_dir) if f.endswith('.wav')]
            
            if audio_files:
                # Use existing embeddings if available, otherwise process files
                if self.embeddings:
                    sample_files = audio_files[:min(10, len(audio_files))]
                    self.audio_analyzer.batch_initialize_from_existing_songs(sample_files)
                else:
                    sample_files = audio_files[:min(5, len(audio_files))]
                    self.audio_analyzer.batch_initialize_from_existing_songs(sample_files)
                
                # Save the stats
                self.audio_analyzer.save_running_stats(self.running_stats_path)
            else:
                raise ValueError("No audio files found to initialize normalizer")
    
    def is_music_in_database(self, song_id: str) -> bool:
        """Check if a song ID is already in the database"""
        return song_id in self.embeddings

    def add_music_to_database(self, song_id: str, metadata: Optional[Dict] = None) -> bool:
        """
        Add a single song to the database efficiently using scalable normalization
        Returns True if successfully added, False if already exists or failed
        """
        if self.is_music_in_database(song_id):
            print(f"Song '{song_id}' already in database. Skipping.")
            return False

        print(f"🎵 Adding song: {song_id}")
        start_time = time.time()

        try:
            # Ensure normalizer is ready
            self._ensure_normalizer_ready()

            # Process the audio file
            file_path = self.get_music_file_path(song_id)
            if not os.path.exists(file_path):
                print(f"❌ Audio file not found: {file_path}")
                return False

            embedding = self.audio_analyzer.add_single_song_fast(file_path)
            # embedding = self.audio_analyzer_2.process(file_path)
            
            # Add to embeddings
            self.embeddings[song_id] = embedding

            # Add to FAISS index and maintain song order
            embedding_2d = embedding.reshape(1, -1).astype(np.float32)
            self.index.add(embedding_2d)
            self.song_order.append(song_id)  # Track order for FAISS index mapping

            # Add metadata
            if metadata:
                self.metadata[song_id] = metadata

            # Save everything
            self.save_embeddings()
            self.save_index()
            self.save_metadata()
            self.save_song_order()
            self.audio_analyzer.save_running_stats(self.running_stats_path)

            processing_time = time.time() - start_time
            print(f"✅ Added '{song_id}' in {processing_time:.3f}s")
            return True

        except Exception as e:
            print(f"❌ Error adding '{song_id}': {e}")
            return False

    def add_batch_of_songs(self, song_ids: List[str], metadata_list: Optional[List[Dict]] = None) -> Tuple[int, int]:
        """
        Add multiple songs efficiently using scalable batch processing
        Returns (success_count, total_count)
        """
        print(f"🎵 Adding batch of {len(song_ids)} songs...")
        start_time = time.time()

        # Filter out songs already in database
        new_song_ids = [sid for sid in song_ids if not self.is_music_in_database(sid)]
        if len(new_song_ids) < len(song_ids):
            print(f"⚠️  {len(song_ids) - len(new_song_ids)} songs already in database")

        if not new_song_ids:
            print("All songs already in database")
            return 0, len(song_ids)

        try:
            # Ensure normalizer is ready
            self._ensure_normalizer_ready()

            # Get file paths
            file_paths = []
            valid_song_ids = []
            for song_id in new_song_ids:
                file_path = self.get_music_file_path(song_id)
                if os.path.exists(file_path):
                    file_paths.append(file_path)
                    valid_song_ids.append(song_id)
                else:
                    print(f"❌ File not found: {song_id}")

            if not file_paths:
                print("❌ No valid audio files found")
                return 0, len(song_ids)

            # Process batch
            embeddings_dict = self.audio_analyzer.add_batch_of_songs_fast(file_paths, normalize_method='robust')

            # Add to database
            embeddings_to_add = []
            new_song_ids = []
            for song_id in valid_song_ids:
                if song_id in embeddings_dict:
                    embedding = embeddings_dict[song_id]
                    self.embeddings[song_id] = embedding
                    embeddings_to_add.append(embedding)
                    new_song_ids.append(song_id)

            # Add to FAISS index and maintain song order
            if embeddings_to_add:
                embeddings_matrix = np.vstack(embeddings_to_add).astype(np.float32)
                self.index.add(embeddings_matrix)
                self.song_order.extend(new_song_ids)  # Track order for FAISS index mapping

            # Add metadata
            if metadata_list:
                for i, song_id in enumerate(valid_song_ids):
                    if i < len(metadata_list) and song_id in embeddings_dict:
                        self.metadata[song_id] = metadata_list[i]

            # Save everything
            self.save_embeddings()
            self.save_index()
            self.save_metadata()
            self.save_song_order()
            self.audio_analyzer.save_running_stats(self.running_stats_path)
            self.save_embeddings()
            self.save_index()
            self.save_metadata()
            self.save_song_order()
            self.audio_analyzer.save_running_stats(self.running_stats_path)

            processing_time = time.time() - start_time
            success_count = len(embeddings_dict)
            print(f"✅ Added {success_count} songs in {processing_time:.3f}s ({processing_time/success_count:.3f}s per song)")
            
            return success_count, len(song_ids)

        except Exception as e:
            print(f"❌ Error in batch processing: {e}")
            return 0, len(song_ids)
    
    def calculate_weight_for_query_entry(self, entry, params) -> float:
        """
        Calculate weight for a recommendation entry based on parameters
        entry: {
            liked: bool,
            just_liked: bool,
            duration: float,
            duration_listened: float,
            replay_count: int, // number of times the song was replayed in a session
            skip_count: int, // number of times the song was skipped in a session
        }
        params: {
            liked_weight: float,
            just_liked_weight: float,
            duration_listened_weight: float,
            replay_count_weight: float,
            skip_count_weight: float,
        }
        """

        default_params = {
            'liked_weight': 1.0,
            'just_liked_weight': 0.5,
            'duration_listened_weight': 1.0,
            'replay_count_weight': 0.3,
            'skip_count_weight': 0.7,
        }

        for key, value in default_params.items():
            if key not in params:
                params[key] = value

        weights = [
            self.min_max_minus_bell_curve(entry['duration_listened'] / entry['duration'], 0.0, 1.0, 1.0) * params['duration_listened_weight'],
            entry['liked'] * params['liked_weight'],
            entry['just_liked'] * params['just_liked_weight'],
            self.min_max_minus_bell_curve(entry['replay_count'], 0.0, 1.0, 5.0) * params['replay_count_weight'],
            -1.0 * self.min_max_minus_bell_curve(entry['skip_count'], 0.0, 1.0, 2.0) * params['skip_count_weight'],
        ]

        return sum(weights) / len(weights)

    def min_max_minus_bell_curve(self, input: float, min: float, max: float, stretch: float = 1.0) -> float:
        return max - ((max - min) * ( np.exp(-1.0 * (1 / stretch) * ( input ** 2 ))))
    
    def get_music_embedding(self, song_id: str) -> Optional[np.ndarray]:
        """
        Get embedding for a song by its ID
        """
        if song_id in self.embeddings:
            return self.embeddings[song_id]
        else:
            print(f"Song '{song_id}' not found in database")
            return None

    def get_music_file_path(self, song_id: str) -> str:
        return os.path.join(self.project_root, f"storage/musik/temp.music/{song_id}.wav") # temp

    def generate_short_term_query_embedding(self, song_ids: list, song_data: list, params: dict = None) -> tuple:
        """
        Generate a short-term query embedding based on recent songs and their data
        Returns: (embedding, is_negative_query)
        song_ids: list of song IDs
        song_data: list of dicts with keys:
            liked: bool,
            just_liked: bool,
            duration: float,
            duration_listened: float,
            replay_count: int,
            skip_count: int,
        params: dict with weights for each factor
        """
        if params is None:
            params = {}

        embedding_sum = None
        total_weight = 0
        total_absolute_weight = 0  # Track absolute weights for normalization

        for song_id, data in zip(song_ids, song_data):
            embedding = self.get_music_embedding(song_id)
            if embedding is None:
                print(f"⚠️  Song '{song_id}' not found for query")
                continue
            
            # weight = self.calculate_weight_for_query_entry(data, params)
            # print(f"Weight for {song_id}: {weight:.4f}")
            weight = 1
            weighted_embedding = embedding * weight
            
            if embedding_sum is None:
                embedding_sum = np.zeros_like(weighted_embedding)
            
            embedding_sum += weighted_embedding
            total_weight += weight
            total_absolute_weight += abs(weight)

        if embedding_sum is not None and total_absolute_weight > 0:
            # Normalize by absolute weight to handle negative weights properly
            averaged_embedding = embedding_sum / total_absolute_weight
            
            # If the total weight is negative, we want to "invert" the preference
            is_negative_query = total_weight < 0
            if is_negative_query:
                print(f"Negative total weight ({total_weight:.4f}) - searching for dissimilar songs")
                
            return averaged_embedding, is_negative_query
        else:
            return None, False

    def recommend(self, query_embedding: np.ndarray, top_k: int = 5, 
                 exclude_ids: Optional[List[str]] = None) -> List[Dict]:
        """
        Recommend top_k similar songs using the best method for current database size
        Automatically chooses between exact cosine similarity and FAISS based on performance
        """
        return self.recommend_smart(query_embedding, top_k, exclude_ids)

    def recommend_exact(self, query_embedding: np.ndarray, top_k: int = 5, 
                       exclude_ids: Optional[List[str]] = None) -> List[Dict]:
        """Recommend using exact cosine similarity (renamed from original recommend method)"""
        if not self.embeddings:
            print("❌ No embeddings available")
            return []

        exclude_ids = exclude_ids or []
        
        # Use exact cosine similarity for accurate results
        from sklearn.metrics.pairwise import cosine_similarity
        
        # Get all song IDs and embeddings (excluding specified IDs)
        available_song_ids = [sid for sid in self.embeddings.keys() if sid not in exclude_ids]
        if not available_song_ids:
            print("❌ No available songs after exclusions")
            return []

        embeddings_matrix = np.vstack([self.embeddings[sid] for sid in available_song_ids])
        
        # Calculate similarities using proper cosine similarity
        query_reshaped = query_embedding.reshape(1, -1)
        similarities = cosine_similarity(query_reshaped, embeddings_matrix)[0]
        
        # Get top_k most similar songs
        top_indices = np.argsort(similarities)[::-1][:top_k]
        
        results = []
        for idx in top_indices:
            song_id = available_song_ids[idx]
            similarity = similarities[idx]
            
            result = {
                'song_id': song_id,
                'similarity': float(similarity)
            }
            
            # Add metadata if available
            if hasattr(self, 'metadata') and song_id in self.metadata:
                result.update(self.metadata[song_id])
            
            results.append(result)
        
        return results

    def recommend_scalable(self, query_embedding: np.ndarray, top_k: int = 5, 
                          exclude_ids: Optional[List[str]] = None) -> List[Dict]:
        """
        Scalable recommendation using FAISS with proper cosine similarity
        For large databases (>10K songs), this will be much faster than exact cosine similarity
        """
        if not self.embeddings:
            print("❌ No embeddings available")
            return []

        exclude_ids = exclude_ids or []
        
        # Normalize query embedding for cosine similarity (L2 norm = 1)
        query_norm = np.linalg.norm(query_embedding)
        if query_norm > 0:
            query_normalized = query_embedding / query_norm
        else:
            query_normalized = query_embedding
            
        query_reshaped = query_normalized.reshape(1, -1).astype(np.float32)
        
        # For cosine similarity with FAISS, we need normalized embeddings
        # Check if we need to rebuild index with normalized embeddings
        if not hasattr(self, '_normalized_index_built'):
            self._rebuild_normalized_faiss_index()
        
        # Search for more candidates than needed to handle exclusions
        search_k = min(top_k + len(exclude_ids) + 10, self.index.ntotal)
        distances, indices = self.index.search(query_reshaped, search_k)
        
        # For normalized embeddings with L2 distance: cosine_similarity = 1 - (L2_distance^2 / 2)
        # Since embeddings are normalized, ||a||=||b||=1, so: d²(a,b) = 2(1 - cos(a,b))
        cosine_similarities = 1.0 - (distances[0] ** 2) / 2.0
        
        # Use song_order for consistent mapping
        if self.song_order and len(self.song_order) == len(self.embeddings):
            all_song_ids = self.song_order
        else:
            all_song_ids = list(self.embeddings.keys())
            print("⚠️  Song order not available, using embeddings key order")
        
        results = []
        for i, (idx, similarity) in enumerate(zip(indices[0], cosine_similarities)):
            if len(results) >= top_k:
                break
                
            song_id = all_song_ids[idx]
            
            # Skip excluded songs
            if song_id in exclude_ids:
                continue
                
            result = {
                'song_id': song_id,
                'similarity': float(similarity)
            }
            
            # Add metadata if available
            if hasattr(self, 'metadata') and song_id in self.metadata:
                result.update(self.metadata[song_id])
            
            results.append(result)
        
        return results

    def _rebuild_normalized_faiss_index(self):
        """Rebuild FAISS index with L2-normalized embeddings for proper cosine similarity"""
        print("🔧 Rebuilding FAISS index with normalized embeddings for cosine similarity...")
        
        if not self.embeddings:
            print("❌ No embeddings to rebuild index from")
            return
        
        # Create new index
        self.create_index(self.embedding_dimensions)
        
        # Normalize all embeddings and rebuild song order
        self.song_order = list(self.embeddings.keys())
        embeddings_list = []
        
        for song_id in self.song_order:
            embedding = self.embeddings[song_id]
            # L2 normalize for cosine similarity
            norm = np.linalg.norm(embedding)
            if norm > 0:
                normalized_embedding = embedding / norm
            else:
                normalized_embedding = embedding
            embeddings_list.append(normalized_embedding)
        
        embeddings_matrix = np.vstack(embeddings_list).astype(np.float32)
        self.index.add(embeddings_matrix)
        
        # Save
        self.save_index()
        self.save_song_order()
        self._normalized_index_built = True
        print(f"✅ Rebuilt normalized index with {self.index.ntotal} vectors")

    def get_database_stats(self) -> Dict:
        """Get current database statistics"""
        return {
            'total_songs': len(self.embeddings),
            'faiss_index_size': self.index.ntotal if hasattr(self, 'index') else 0,
            'normalization_samples': self.audio_analyzer.running_stats['count'] if self.audio_analyzer.is_fitted else 0,
            'metadata_entries': len(getattr(self, 'metadata', {})),
            'embedding_dimension': self.embedding_dimensions
        }

    def rebuild_faiss_index(self):
        """Rebuild FAISS index from scratch"""
        print("🔧 Rebuilding FAISS index...")
        
        if not self.embeddings:
            print("❌ No embeddings to rebuild index from")
            return
        
        # Create new index
        self.create_index(self.embedding_dimensions)
        
        # Rebuild song order and add all embeddings in consistent order
        self.song_order = list(self.embeddings.keys())
        embeddings_matrix = np.vstack([self.embeddings[sid] for sid in self.song_order]).astype(np.float32)
        self.index.add(embeddings_matrix)
        
        # Save
        self.save_index()
        self.save_song_order()
        print(f"✅ Rebuilt index with {self.index.ntotal} vectors")

    def recommend_smart(self, query_embedding: np.ndarray, top_k: int = 5, 
                       exclude_ids: Optional[List[str]] = None, force_method: str = None) -> List[Dict]:
        """
        Smart recommendation that automatically chooses the best method based on database size
        
        Args:
            query_embedding: Query vector
            top_k: Number of recommendations
            exclude_ids: Song IDs to exclude
            force_method: Force specific method ('exact', 'faiss', 'annoy', 'hnswlib')
        """
        if not self.embeddings:
            print("❌ No embeddings available")
            return []

        database_size = len(self.embeddings)
        
        # Choose method based on database size and forced method
        if force_method:
            method = force_method
        elif database_size < 1000:
            method = 'exact'
        elif database_size < 50000:
            method = 'faiss'
        else:
            method = 'hnswlib'  # Best for very large databases
        
        print(f"🧠 Using {method} method for {database_size} songs")
        
        if method == 'exact':
            return self.recommend_exact(query_embedding, top_k, exclude_ids)
        elif method == 'faiss':
            return self.recommend_faiss_cosine(query_embedding, top_k, exclude_ids)
        elif method == 'hnswlib':
            return self.recommend_hnswlib(query_embedding, top_k, exclude_ids)
        else:
            # Fallback to exact
            return self.recommend_exact(query_embedding, top_k, exclude_ids)

    def recommend_faiss_cosine(self, query_embedding: np.ndarray, top_k: int = 5, 
                              exclude_ids: Optional[List[str]] = None) -> List[Dict]:
        """
        Optimized FAISS cosine similarity using IndexFlatIP (Inner Product)
        This is the most accurate FAISS method for cosine similarity
        """
        if not self.embeddings:
            print("❌ No embeddings available")
            return []

        exclude_ids = exclude_ids or []
        
        # Build or use cached cosine similarity index
        if not hasattr(self, '_cosine_index') or not hasattr(self, '_cosine_song_order'):
            self._build_cosine_index()
        
        # Normalize query embedding
        query_norm = np.linalg.norm(query_embedding)
        if query_norm > 0:
            query_normalized = query_embedding / query_norm
        else:
            query_normalized = query_embedding
        
        query_reshaped = query_normalized.reshape(1, -1).astype(np.float32)
        
        # Search for more candidates than needed to handle exclusions
        search_k = min(top_k + len(exclude_ids) + 10, self._cosine_index.ntotal)
        
        # Use IndexFlatIP which directly computes inner product (= cosine similarity for normalized vectors)
        similarities, indices = self._cosine_index.search(query_reshaped, search_k)
        
        results = []
        for i, (idx, similarity) in enumerate(zip(indices[0], similarities[0])):
            if len(results) >= top_k:
                break
                
            song_id = self._cosine_song_order[idx]
            
            # Skip excluded songs
            if song_id in exclude_ids:
                continue
                
            result = {
                'song_id': song_id,
                'similarity': float(similarity)  # Already cosine similarity
            }
            
            # Add metadata if available
            if hasattr(self, 'metadata') and song_id in self.metadata:
                result.update(self.metadata[song_id])
            
            results.append(result)
        
        return results

    def _build_cosine_index(self):
        """Build optimized FAISS index for cosine similarity using IndexFlatIP"""
        print("🔧 Building optimized cosine similarity index...")
        
        # Use IndexFlatIP for exact cosine similarity (inner product on normalized vectors)
        self._cosine_index = faiss.IndexFlatIP(self.embedding_dimensions)
        
        # Normalize all embeddings and track order
        self._cosine_song_order = list(self.embeddings.keys())
        normalized_embeddings = []
        
        for song_id in self._cosine_song_order:
            embedding = self.embeddings[song_id]
            # L2 normalize for cosine similarity
            norm = np.linalg.norm(embedding)
            if norm > 0:
                normalized_embedding = embedding / norm
            else:
                normalized_embedding = embedding
            normalized_embeddings.append(normalized_embedding)
        
        embeddings_matrix = np.vstack(normalized_embeddings).astype(np.float32)
        self._cosine_index.add(embeddings_matrix)
        
        print(f"✅ Built cosine index with {self._cosine_index.ntotal} normalized vectors")

    def recommend_hnswlib(self, query_embedding: np.ndarray, top_k: int = 5, 
                         exclude_ids: Optional[List[str]] = None) -> List[Dict]:
        """
        Ultra-fast approximate nearest neighbor search using HNSWLIB
        Best for databases >50K songs. Requires: pip install hnswlib
        """
        print("🧠 Using HNSWLIB for ultra-fast approximate search")
        try:
            import hnswlib
        except ImportError:
            print("⚠️  hnswlib not installed. Falling back to FAISS method.")
            return self.recommend_faiss_cosine(query_embedding, top_k, exclude_ids)
        
        if not self.embeddings:
            print("❌ No embeddings available")
            return []

        exclude_ids = exclude_ids or []
        
        # Build or use cached HNSW index
        if not hasattr(self, '_hnsw_index') or not hasattr(self, '_hnsw_song_order'):
            self._build_hnsw_index()
        
        # Normalize query embedding
        query_norm = np.linalg.norm(query_embedding)
        if query_norm > 0:
            query_normalized = query_embedding / query_norm
        else:
            query_normalized = query_embedding
        
        # Search for more candidates than needed to handle exclusions
        search_k = min(top_k + len(exclude_ids) + 10, len(self.embeddings))
        
        # HNSW search returns labels and distances
        labels, distances = self._hnsw_index.knn_query(query_normalized, k=search_k)
        
        # Convert distances to cosine similarities
        # For normalized vectors with cosine distance: similarity = 1 - distance
        similarities = 1.0 - distances[0]
        
        results = []
        for i, (label, similarity) in enumerate(zip(labels[0], similarities)):
            if len(results) >= top_k:
                break
                
            song_id = self._hnsw_song_order[label]
            
            # Skip excluded songs
            if song_id in exclude_ids:
                continue
                
            result = {
                'song_id': song_id,
                'similarity': float(similarity)
            }
            
            # Add metadata if available
            if hasattr(self, 'metadata') and song_id in self.metadata:
                result.update(self.metadata[song_id])
            
            results.append(result)
        
        return results

    def _build_hnsw_index(self):
        """Build HNSWLIB index for ultra-fast approximate search"""
        try:
            import hnswlib
        except ImportError:
            raise ImportError("Please install hnswlib: pip install hnswlib")
        
        print("🔧 Building HNSWLIB index for ultra-fast search...")
        
        # Create HNSW index
        self._hnsw_index = hnswlib.Index(space='cosine', dim=self.embedding_dimensions)
        
        # Initialize with reasonable parameters
        max_elements = max(len(self.embeddings) * 2, 1000)  # Allow for growth
        self._hnsw_index.init_index(max_elements=max_elements, ef_construction=200, M=16)
        
        # Prepare normalized embeddings
        self._hnsw_song_order = list(self.embeddings.keys())
        normalized_embeddings = []
        
        for song_id in self._hnsw_song_order:
            embedding = self.embeddings[song_id]
            # L2 normalize
            norm = np.linalg.norm(embedding)
            if norm > 0:
                normalized_embedding = embedding / norm
            else:
                normalized_embedding = embedding
            normalized_embeddings.append(normalized_embedding)
        
        embeddings_matrix = np.vstack(normalized_embeddings).astype(np.float32)
        
        # Add to index with labels (0, 1, 2, ...)
        labels = np.arange(len(self._hnsw_song_order))
        self._hnsw_index.add_items(embeddings_matrix, labels)
        
        # Set query time parameter
        self._hnsw_index.set_ef(50)  # Tradeoff between speed and accuracy
        
        print(f"✅ Built HNSW index with {len(self._hnsw_song_order)} vectors")

if __name__ == '__main__':    
    print("="*60)
    print("TESTING UPDATED SCALABLE MUSIC RECOMMENDER")
    print("="*60)
    
    recommender = Music_Recommender()
    
    # Show current stats
    # stats = recommender.get_database_stats()
    # print(f"📊 Current database stats: {stats}")
    
    # Test adding songs using the new scalable approach
    print("\n🎵 Testing scalable song addition...")

    # print("1. Adding single song...")
    success = recommender.add_music_to_database("song1")
    success = recommender.add_music_to_database("song2")
    success = recommender.add_music_to_database("rick")
    success = recommender.add_music_to_database("alesso")
    success = recommender.add_music_to_database("song5")
    print(f"   Single song add result: {success}")
    
    # Test batch addition
    print("2. Adding batch of songs...")
    batch_songs = ["song2", "rick", "alesso", "song4", "song5"]
    # success_count, total_count = recommender.add_batch_of_songs(
    #     batch_songs
    # )
    
    # Test recommendation with the scalable system
    print("\n🎯 Testing recommendations...")
    result = recommender.generate_short_term_query_embedding(
        ["song1"],
        [
            {
                'liked': False,
                'just_liked': False,
                'duration': 180.0,
                'duration_listened': 180.0,
                'replay_count': 0,
                'skip_count': 0,
            }
        ]
    )
    
    if result[0] is not None:
        query_embedding, is_negative_query = result
        print(f"Generated query embedding shape: {query_embedding.shape}")
        print(f"Is negative query: {is_negative_query}")
        
        print("\nRecommendations using scalable approach:")
        recommendations = recommender.recommend_smart(query_embedding, top_k=10, exclude_ids=["song1"], force_method='hnswlib')
        for i, rec in enumerate(recommendations, 1):
            print(f"{i}. {rec['song_id']} (similarity: {rec['similarity']:.4f})")
            if 'artist' in rec:
                print(f"   Artist: {rec['artist']}, Genre: {rec.get('genre', 'unknown')}")
    else:
        print("Failed to generate query embedding")
    
    # Final stats
    final_stats = recommender.get_database_stats()