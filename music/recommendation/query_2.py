import os
import sys
import librosa
import numpy as np
import faiss
import pickle
import hnswlib
import hashlib as hash
import time
import requests
import threading

sys.path.append(os.path.dirname(__file__))
from analysis_2 import Audio_Analyzer

class Audio_Search:
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    storage_path = os.path.join(project_root, 'storage', 'musik', 'recommendation')

    index_path = os.path.join(storage_path, 'hnsw_index.bin')
    song_id_to_index_path = os.path.join(storage_path, 'song_id_to_index.pkl')
    process_queue_path = os.path.join(storage_path, 'process_queue.pkl')

    MAX_TOP_K = 50  # maximum number of recommendations to return

    def __init__(self):
        self.analyzer = Audio_Analyzer()
        self.embedding_dimensions = self.analyzer.embedding_dimensions

        self.load_hnsw_index()
        self.load_index_mappings()
        self.load_process_queue()
    
    def create_hnsw_index(self):
        print("Creating HNSW index...")
        self.index = hnswlib.Index(space='cosine', dim=self.embedding_dimensions)
        self.index.init_index(
            max_elements=10000,
            ef_construction=200, 
            M=16
        )
        print("HNSW index created.")
        self.index.set_ef(50)

    def load_hnsw_index(self):
        if not os.path.exists(self.index_path):
            print(f"HNSW index file not found at {self.index_path}.")
            print("Creating one...")
            self.create_hnsw_index()
            return

        print(f"Loading HNSW index from {self.index_path}...")
        self.index = hnswlib.Index(space='cosine', dim=self.embedding_dimensions)
        self.index.load_index(self.index_path)
        print("HNSW index loaded.")
        self.index.set_ef(50)
    
    def save_hnsw_index(self, index_path: str):
        print(f"Saving HNSW index to {index_path}...")
        self.index.save_index(index_path)
        print("HNSW index saved.")
        self.save_index_mappings()
    
    def load_index_mappings(self):
        if not os.path.exists(self.song_id_to_index_path):
            print(f"Index mapping file not found at {self.song_id_to_index_path}. Starting fresh.")
            self.index_to_song_id = {}
            return
        
        print(f"Loading index mappings from {self.song_id_to_index_path}...")
        with open(self.song_id_to_index_path, 'rb') as f:
            self.index_to_song_id = pickle.load(f)
        print("Index mappings loaded.")
    
    def save_index_mappings(self):
        print(f"Saving index mappings to {self.song_id_to_index_path}...")
        with open(self.song_id_to_index_path, 'wb') as f:
            pickle.dump(self.index_to_song_id, f)
        print("Index mappings saved.")
    
    def load_process_queue(self):
        if not os.path.exists(self.process_queue_path):
            print(f"Process queue file not found at {self.process_queue_path}. Starting fresh.")
            self.process_queue = []
            return
        
        print(f"Loading process queue from {self.process_queue_path}...")
        with open(self.process_queue_path, 'rb') as f:
            self.process_queue = pickle.load(f)
        print("Process queue loaded.")
    
    def save_process_queue(self):
        print(f"Saving process queue to {self.process_queue_path}...")
        with open(self.process_queue_path, 'wb') as f:
            pickle.dump(self.process_queue, f)
        print("Process queue saved.")

    def add_embedding(self, song_id: str, embedding: np.ndarray):
        if embedding.ndim == 1:
            embedding = embedding.reshape(1, -1)
        elif embedding.ndim != 2 or embedding.shape[0] != 1:
            raise ValueError("Embedding must be a 1D array or a 2D array with a single row.")
        
        # Normalize the embedding to unit length for cosine similarity
        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding = embedding / norm
        
        # Get or create integer index for this song ID
        label = self.label_from_song_id(song_id)
        self.index_to_song_id[label] = song_id

        self.index.add_items(embedding, [label])
        print(f"Added embedding for {song_id} with label {label} to HNSW index.")
        # save
        self.save_hnsw_index(self.index_path)

        return label
    
    def label_from_song_id(self, song_id: str) -> int:
        """
        Deterministic 64-bit label derived from song_id string.
        Note: not invertible. We keep a separate index_to_song_id map to reverse.
        """
        # Use SHA1 and take first 8 bytes -> 64-bit unsigned integer
        h = hash.sha1(song_id.encode('utf-8')).digest()[:8]
        label = int.from_bytes(h, 'big', signed=False)
        return label

    def song_id_from_label(self, label: int) -> str:
        """
        Reverse mapping from label to song_id.
        Note: This requires maintaining a separate mapping since the hash is not invertible.
        """
        return self.index_to_song_id.get(label, None)
    
    def process_and_add_embedding(self, song_id: str): 
        if self.embedding_exists(song_id):
            print(f"Embedding for song ID {song_id} already exists. Skipping processing.")
            return self.get_embedding(song_id)
        
        # check to see if the 32k.m3u8 file exists for song_id
        audio_path = self.get_music_file_path(song_id)
        if not os.path.exists(audio_path):
            print(f"Audio file not found for song ID {song_id} at {audio_path}. Requesting stream from main server.//")
            # request main server to create the stream
            try:
                response = requests.get(
                    "http://localhost:3000/stream",
                    params={"video_id": song_id, "quality": "ultra-low"},
                    timeout=25 # timeout to avoid hanging
                )
                if response.status_code == 200:
                    print(f"Successfully requested stream for {song_id}. Stream is ready...")
                else:
                    print(f"Failed to request stream for {song_id}: {response.status_code} - {response.text}")
                    return None
            except requests.RequestException as e:
                print(f"Error requesting stream for {song_id}: {e}")
                return None
            return None

        features = self.analyzer.process(song_id)
        if features is not None:
            # self.embeddings[song_id] = features # temp
            self.add_embedding(song_id, features)
            print(f"Added embeddings for {song_id} to HNSW index.")
            # send request to main server telling it embedding is done
            if song_id in self.process_queue:
                self.process_queue.remove(song_id)
                self.save_process_queue()
                # fetch(localhost:3000/stream/embedding_generated)
                try:
                    # notify main server its done
                    response = requests.post(
                        "http://localhost:3000/stream/embedding_generated",
                        json={"song_id": song_id},
                        timeout=5  # Optional: set a timeout to avoid hanging
                    )
                    if response.status_code == 200:
                        print(f"Successfully notified server for {song_id}.")
                    else:
                        print(f"Server notification failed for {song_id}: {response.status_code} - {response.text}")
                except requests.RequestException as e:
                    print(f"Error notifying server for {song_id}: {e}")


            return features
        else:
            print(f"Failed to process {song_id}.")
            return None

    # def process_batch_and_add_embeddings(self, song_ids: list[str]):
    #     if song_ids is not None and len(audio_paths) != len(song_ids):
    #         raise ValueError("audio_paths and song_ids must have the same length.")

    #     # self.analyzer.process_batch(audio_paths)
    #     if song_ids is not None:
    #         # filter out already existing embeddings
    #         filtered_audio_paths = []
    #         filtered_song_ids = []
    #         for path, sid in zip(audio_paths, song_ids):
    #             if not self.embedding_exists(sid):
    #                 filtered_audio_paths.append(path)
    #                 filtered_song_ids.append(sid)
    #             else:
    #                 print(f"Embedding for song ID {sid} already exists. Skipping processing.")
    #         audio_paths = filtered_audio_paths
    #         song_ids = filtered_song_ids

    #         for song_id, features in zip(song_ids, self.analyzer.process_batch(audio_paths)):
    #             if features is not None:
    #                 # self.embeddings[song_id] = features
    #                 self.add_embedding(song_id, features)
    #                 print(f"Added embedding for {song_id} to HNSW index.")
    #             else:
    #                 print(f"Failed to process {song_id}.")
    
    def get_music_file_path(self, song_id: str) -> str:
        return os.path.join(self.project_root, 'storage', 'musik', 'hls', song_id, '32k.m3u8') 

    def get_embedding(self, song_id: str) -> np.ndarray:
        # get embedding from index
        label = self.label_from_song_id(song_id)
        embedding = self.index.get_items([label])
        if embedding.size == 0:
            print(f"No embedding found for song ID {song_id}.")
            return None
        return embedding[0]

    def embedding_exists(self, song_id: str) -> bool:
        label = self.label_from_song_id(song_id)
        # Check if label exists in the index
        try:
            _ = self.index.get_items([label])
            return True
        except Exception:
            return False
    
    def get_all_song_ids(self) -> list[str]:
        """Returns a list of all song_ids currently stored in the index."""
        return list(self.index_to_song_id.values())
    
    def recommend_similar_songs_with_song_id(self, song_id: str, top_k: int = 5, exclude_ids: list[str] = []) -> list[dict]:
        if not self.embedding_exists(song_id):
            print(f"No embedding found for song ID {song_id}. Cannot recommend similar songs.")
            return []
        
        query_embedding = self.get_embedding(song_id)
        return self.recommend_similar_songs(query_embedding, top_k=top_k, exclude_ids=exclude_ids, normalize_query=False)

    def recommend_similar_songs(self, query_embedding: np.ndarray, top_k: int = 5, exclude_ids: list[str] = [], normalize_query: bool = True) -> list[dict]:
        """
        query_embedding: should already be normalized
        """
        
        # normalize query embedding
        if normalize_query:
            norm = np.linalg.norm(query_embedding)
            if norm > 0:
                query_embedding = query_embedding / norm
        
        effective_top_k = min(top_k + len(exclude_ids), len(self.index_to_song_id.keys()))  # max top_k is 50
        
        # Set ef to be at least equal to top_k (required by HNSWLIB)
        self.index.set_ef(max(effective_top_k, 50))  # ef must be >= top_k
        
        # Search for similar songs
        indices, distances = self.index.knn_query(query_embedding, k=effective_top_k)

        recommendations = []
        for i, (index, distance) in enumerate(zip(indices[0], distances[0])):
            song_id = self.song_id_from_label(index)  # Use the song order from index building
            # print(self.)

            if song_id in exclude_ids:
                continue
            recommendations.append({
                "song_id": song_id,
                "distance": float(distance),
                "similarity": float(1 - distance)  # since using cosine distance
            })

        return recommendations

    processing_queue: bool = False

    def start_processing_queue_async(self):
        """
        Starts the processing queue in a background thread to avoid blocking the main program.
        """
        processing_thread = threading.Thread(target=self.start_processing_queue, daemon=True)
        processing_thread.start()
        print("Processing queue started in background thread.")

    def start_processing_queue(self):
        self.processing_queue = True
        while True:  # Infinite loop to keep checking the queue
            if self.process_queue:
                print("Processing the queue...")
                while self.process_queue:
                    song_id = self.process_queue.pop(0)
                    self.process_and_add_embedding(song_id)
                    self.save_process_queue()
                    time.sleep(1)  # Brief pause between processing
            else:
                print("Queue is empty. Waiting for new requests...")
                time.sleep(60)  # Wait 60 seconds before checking again
                # No recursive call needed; the loop handles it

    def request_audio_to_be_processed(self, song_id: str):
        # Placeholder for queuing logic
        print(f"Request to process audio for song ID {song_id} has been queued.")
        self.process_queue.append(song_id)
        self.save_process_queue()
        
        if not self.processing_queue:
            self.start_processing_queue_async()

    def is_song_in_process_queue(self, song_id: str) -> bool:
        return song_id in self.process_queue

# test
if __name__ == "__main__":
    searcher = Audio_Search()

    print(f"All song IDs in index: {searcher.get_all_song_ids()}")

    # Process query using the working analyzer method
    # base_path = '/Users/norbertzych/Desktop/Projects/study_sinc/storage/musik/temp.music'

    # searcher.process_and_add_embedding('song1')
    # searcher.process_and_add_embedding('song2')
    # searcher.process_and_add_embedding('song3')
    # query_embedding = searcher.process_and_add_embedding('rick')
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

    # searcher.process_and_add_embedding('mOivOlP9GRk')

    # searcher.analyzer.decode_to_numpy('storage/musik/hls/mOivOlP9GRk/32k.m3u8')

    # query_embedding = searcher.get_embedding('6uVrP0Qj1cU')

    # Use the stored embedding for the query (consistent normalization)
    # query_embedding = searcher.embeddings['rick']

    # recommendations = searcher.recommend_similar_songs(query_embedding, top_k=10, exclude_ids=[])
    # for rec in recommendations:
    #     print(f"Recommended Song ID: {rec['song_id']}, Similarity: {rec['similarity']:.4f}")

