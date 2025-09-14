import os
import uuid
import time
import pickle
import numpy as np
import hnswlib
from typing import Dict, List, Optional, Tuple
from enum import Enum

class DJ_Weight(Enum):
    # positive for positive interactions, negative for negative interactions
    PLAY = 0.55
    SKIP = -0.8
    ADDED_TO_PLAYLIST = 1.0
    LISTENED = 0.3  # weight for listening to a proportion of the song

    REPEAT_PLAY_PENALTY = -0.1  # penalty for repeated plays of the same song
    RECENCY_DECAY = 0.95  # decay factor for older interactions

class Interaction_Type(Enum):
    PLAY = 1 # User interacted to play the song
             # Insight: check to see if the song was played before (aka repeated plays are good)
    SKIP = 2 # User interacted to skip the song
    ADDED_TO_PLAYLIST = 3 # User interacted to add the song to the playlist
    LISTENED = 4 # User listened to a proportion of the song (no explicit interaction) 

class Interaction:
    def __init__(self, song_id: str, interaction_type: Interaction_Type, proportion_listened: Optional[float] = None):
        self.song_id = song_id
        self.interaction_type = interaction_type
        self.proportion_listened = proportion_listened  # Value between 0 and 1

class DJ_Session:
    def __init__(self, audio_search_instance, configuration: Dict):
        self.audio_search = audio_search_instance
        self.session_id = str(uuid.uuid4())
        self.song_interactions: list[Interaction] = []
        self.available_songs: set = set()  # Songs available for recommendation as song_ids
        self.songs_played: set = set()  # Songs that have been played in this session
        self.song_embeddings: Dict[str, np.ndarray] = {}  # song_id -> embedding

        self.allow_repeats = configuration.get('allow_repeats', True)
        self.allow_wandering = configuration.get('allow_wandering', True) # allow songs outside the initial playlist
        self.songs_per_batch = configuration.get('songs_per_batch', 3) # songs to return per recommendation request

        self.create_index()

    def create_index(self):
        """Create an HNSW index for the available songs"""
        # get all embeddings that are in available songs
        for song_id in self.available_songs:
            embedding = self.audio_search.get_embedding(song_id)
            if embedding is not None:
                self.song_embeddings[song_id] = embedding


        dim = len(next(iter(self.song_embeddings.values())))
        self.index = hnswlib.Index(space='cosine', dim=dim)
        self.index.init_index(max_elements=len(self.song_embeddings), ef_construction=50, M=16)

        song_ids = list(self.song_embeddings.keys())
        embeddings = np.array([self.song_embeddings[song_id] for song_id in song_ids])

        self.index.add_items(embeddings, np.arange(len(song_ids)))
    
    def add_interaction(self, interaction: Interaction):
        self.song_interactions.append(interaction)
    
    def get_recommendations(self):
        pass

