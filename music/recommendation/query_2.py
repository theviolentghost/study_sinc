import os
import sys
import librosa
import numpy as np
import faiss
import pickle
import hnswlib
import time

sys.path.append(os.path.dirname(__file__))
from analysis_2 import Audio_Analyzer

class Audio_Search:
    MAX_TOP_K = 50  # maximum number of recommendations to return

    def __init__(self):
        self.analyzer = Audio_Analyzer()
        self.embedding_dimensions = self.analyzer.embedding_dimensions

        # Load the same running stats as query.py for consistent normalization
        # stats_path = '/Users/norbertzych/Desktop/Projects/study_sinc/storage/musik/recommendation/running_stats.pkl'
        # if os.path.exists(stats_path):
        #     try:
        #         self.analyzer.load_running_stats(stats_path)
        #         print(f"✅ Loaded shared running stats from query.py")
        #     except Exception as e:
        #         print(f"⚠️ Failed to load running stats: {e}")

        # Mapping for song IDs to integer indices (required by HNSWLIB)
        self.song_id_to_index = {}
        self.next_index = 0
        
        # later load data
        # self.create_hnsw_index() # temp
        self.embeddings = {} # temp
    
    # def create_hnsw_index(self):
    #     print("Creating HNSW index...")
    #     self.index = hnswlib.Index(space='cosine', dim=self.embedding_dimensions)
    #     self.index.init_index(
    #         max_elements=10000,
    #         ef_construction=200, 
    #         M=16
    #     )
    #     print("HNSW index created.")

    def _create_hnsw_index(self):
        print("Creating HNSW index...")
        self.index = hnswlib.Index(space='cosine', dim=self.embedding_dimensions)
        self.index.init_index(
            max_elements=10000,
            ef_construction=200, 
            M=16
        )
        print("HNSW index created.")
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
        self.index.add_items(embeddings_matrix, labels)
        
        # Set query time parameter
        self.index.set_ef(50)
    
    def add_embedding_to_hnsw(self, song_id: str, embedding: np.ndarray):
        if embedding.ndim == 1:
            embedding = embedding.reshape(1, -1)
        elif embedding.ndim != 2 or embedding.shape[0] != 1:
            raise ValueError("Embedding must be a 1D array or a 2D array with a single row.")
        
        # Normalize the embedding to unit length for cosine similarity
        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding = embedding / norm
        
        # Get or create integer index for this song ID
        if song_id not in self.song_id_to_index:
            index = self.next_index
            self.song_id_to_index[song_id] = index
            self.index_to_song_id[index] = song_id
            self.next_index += 1
        else:
            index = self.song_id_to_index[song_id]
        
        self.index.add_items(embedding, [index])
    
    def process_and_add_embedding(self, audio_path: str, song_id: str):
        features = self.analyzer.process(audio_path)
        if features is not None:
            self.embeddings[song_id] = features
            print(f"Added old embeddings for {song_id} to HNSW index.")
        else:
            print(f"Failed to process {audio_path}.")
    
    def process_batch_and_add_embeddings(self, audio_paths: list[str], song_ids: list[str] = None):
        if song_ids is not None and len(audio_paths) != len(song_ids):
            raise ValueError("audio_paths and song_ids must have the same length.")

        # self.analyzer.process_batch(audio_paths)
        print(f"Processing batch of {len(audio_paths)} audio files in batch...")
        if song_ids is not None:
            for song_id, features in zip(song_ids, self.analyzer.process_batch(audio_paths)):
                if features is not None:
                    self.embeddings[song_id] = features
                    print(f"Added embedding for {song_id} to HNSW index.")
                else:
                    print(f"Failed to process {song_id}.")
    
    def get_music_file_path(self, song_id: str) -> str:
        return os.path.join(self.project_root, f"storage/musik/temp.music/{song_id}.wav") # temp
    
    def recommend_similar_songs(self, query_embedding: np.ndarray, top_k: int = 5, exclude_ids: list[str] = []) -> list[dict]:
        """
        query_embedding: should already be normalized
        """
        if not self.embeddings:
            print("No embeddings available.")
            return []
        
        # Build or use cached HNSW index (lazy loading)
        if not hasattr(self, 'index') or self.index is None:
            self._create_hnsw_index()
        
        # normalize query embedding
        norm = np.linalg.norm(query_embedding)
        if norm > 0:
            query_embedding = query_embedding / norm

        # Limit top_k to the number of items in the index
        num_items = len(self.embeddings)
        if num_items == 0:
            print("No items in the index.")
            return []
        
        effective_top_k = min(top_k, num_items)
        
        # Set ef to be at least equal to top_k (required by HNSWLIB)
        # self.index.set_ef(max(effective_top_k, 50))  # ef must be >= top_k
        
        # Search for similar songs
        indices, distances = self.index.knn_query(query_embedding, k=effective_top_k)

        recommendations = []
        for i, (index, distance) in enumerate(zip(indices[0], distances[0])):
            song_id = self._hnsw_song_order[index]  # Use the song order from index building
            if song_id in exclude_ids:
                continue
            recommendations.append({
                "song_id": song_id,
                "distance": distance,
                "similarity": 1 - distance  # since using cosine distance
            })

        return recommendations
    
    def request_audio_to_be_processed(self, audio_path: str, song_id: str):
        # Placeholder for queuing logic
        print(f"Request to process {audio_path} for song ID {song_id} has been queued.")

# test
if __name__ == "__main__":
    searcher = Audio_Search()

    # Process query using the working analyzer method
    base_path = '/Users/norbertzych/Desktop/Projects/study_sinc/storage/musik/temp.music'

    # searcher.process_and_add_embedding(f'{base_path}/song1.wav', 'song1')
    # searcher.process_and_add_embedding(f'{base_path}/song2.wav', 'song2')
    # searcher.process_and_add_embedding(f'{base_path}/song3.wav', 'song3')
    # searcher.process_and_add_embedding(f'{base_path}/rick.wav', 'rick')
    # searcher.process_and_add_embedding(f'{base_path}/song4.wav', 'song4')
    # searcher.process_and_add_embedding(f'{base_path}/song5.wav', 'song5')
    # searcher.process_and_add_embedding(f'{base_path}/song6.wav', 'song6')
    # searcher.process_and_add_embedding(f'{base_path}/song7.wav', 'song7')
    # searcher.process_and_add_embedding(f'{base_path}/song8.wav', 'song8')
    # searcher.process_and_add_embedding(f'{base_path}/song9.wav', 'song9')
    # searcher.process_and_add_embedding(f'{base_path}/alesso.wav', 'alesso')
    # searcher.process_batch_and_add_embeddings(
    #     [
    #         f'{base_path}/song1.wav',
    #         f'{base_path}/song2.wav',
    #         f'{base_path}/song3.wav',
    #         f'{base_path}/rick.wav',
    #         f'{base_path}/song4.wav',
    #         f'{base_path}/song5.wav',
    #         f'{base_path}/song6.wav',
    #         f'{base_path}/song7.wav',
    #         f'{base_path}/song8.wav',
    #         f'{base_path}/song9.wav',
    #         f'{base_path}/alesso.wav'
    #     ],
    #     [
    #         'song1', 'song2', 'song3', 'rick', 'song4', 
    #         'song5', 'song6', 'song7', 'song8', 'song9', 'alesso'
    #     ]
    # )

    # Use the stored embedding for the query (consistent normalization)
    query_embedding = searcher.embeddings['rick']

    recommendations = searcher.recommend_similar_songs(query_embedding, top_k=10, exclude_ids=[])
    for rec in recommendations:
        print(f"Recommended Song ID: {rec['song_id']}, Similarity: {rec['similarity']:.4f}")
