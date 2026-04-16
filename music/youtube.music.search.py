from ytmusicapi import YTMusic
from datetime import datetime

class Youtube_Music_Search:
    def __init__(self):
        self.ytmusic = YTMusic()

    def search(self, query):
        return self.ytmusic.search(query, limit=40, ignore_spelling=True)
    
    def format_search_results(self, query, results):
        formatted_results = dict(
            artists=[item for item in results if item['resultType'] == 'artist'],
            songs=[item for item in results if item['resultType'] == 'song'],
            playlists=[item for item in results if item['resultType'] == 'playlist'],
            albums=[item for item in results if item['resultType'] == 'album'],
            catalog=results,
            recommendations=self.ytmusic.get_search_suggestions(query=query, detailed_runs=False)
        )
        return formatted_results

    def find_albums_after_date(self, artist_id, date):
        def find_releases(data, date):
            albums = []
            results = data.get('results', [])
            unix_cutoff_date = int(date.timestamp())

            for albumMetadata in results:
                album_id = albumMetadata.get("browseId")
                if not album_id:
                    continue

                album = self.ytmusic.get_album(album_id)
                tracks = album.get("tracks", [])
                if not tracks:
                    continue

                firstSongId = tracks[0].get("videoId")
                if not firstSongId:
                    continue

                song = self.ytmusic.get_song(firstSongId)
                microformat = song.get('microformat', {})
                renderer = microformat.get('microformatDataRenderer', {})
                publish_date_str = renderer.get('publishDate')

                if publish_date_str:
                    dt = datetime.fromisoformat(publish_date_str)
                    unixtime = int(dt.timestamp())
                    if unixtime > unix_cutoff_date:
                        albums.append(album)
                    else:
                        break  # Stop if we find an album not after the date

            return albums
        
        catalog = {
            "albums": [],
            "singles": []
        }

        channel = self.ytmusic.get_artist(artist_id)
        
        albums_data = channel.get('albums', {})
        singles_data = channel.get('singles', {})

        catalog["albums"] = find_releases(albums_data, date)  
        catalog["singles"] = find_releases(singles_data, date)
        return catalog

    def find_lyrics(self, video_id):
        try:
            watch_playlist = self.ytmusic.get_watch_playlist(videoId=video_id)
            browse_id = watch_playlist.get("lyrics")
            if not browse_id:
                return {"lyrics": None, "source": None}

            try:
                # First attempt: with timestamps
                return self.ytmusic.get_lyrics(browseId=browse_id, timestamps=True)
            except Exception as e:
                # If it fails with 'cueRange' or context errors, try without timestamps
                if "'cueRange'" in str(e) or "cueRange" in str(e):
                    return self.ytmusic.get_lyrics(browseId=browse_id, timestamps=False)
                return {"error": "Search failed", "message": str(e)}
        except Exception as e:
            return {"error": "Search failed", "message": str(e)}
