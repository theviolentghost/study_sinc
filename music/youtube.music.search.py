from ytmusicapi import YTMusic

class Youtube_Music_Search:
    def __init__(self):
        self.ytmusic = YTMusic()

    def search(self, query):
        return self.ytmusic.search(query)
    
    def format_search_results(self, results):
        formatted_results = dict(
            artists=[item for item in results if item['resultType'] == 'artist'],
            songs=[item for item in results if item['resultType'] == 'song'],
            playlists=[item for item in results if item['resultType'] == 'playlist'],
            albums=[item for item in results if item['resultType'] == 'album'],
            catalog=results,
        )
        return formatted_results