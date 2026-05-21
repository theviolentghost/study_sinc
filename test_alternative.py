import ytmusicapi

ytmusic = ytmusicapi.YTMusic()

# Search for the specific song/single
query = "Blackout loveshy"
results = ytmusic.search(query, filter="songs")

print(f"Searching for: {query}")
for song in results:
    if song.get('videoId') == 'Tk3hQl3JSdc':
        print("\nFound song via search:")
        print(f"Title: {song.get('title')}")
        print(f"Year: {song.get('year')}")
        # In some cases search results have a different response structure with more details.

# Look at get_watch_playlist
print("\nChecking get_watch_playlist for videoId: Tk3hQl3JSdc")
watch = ytmusic.get_watch_playlist(videoId="Tk3hQl3JSdc")
print(f"Tracks in watch playlist: {len(watch['tracks'])}")
# Watch playlist track 0:
if watch['tracks']:
    track0 = watch['tracks'][0]
    print(f"Track0 title: {track0.get('title')}")
    # Often the release date is not in standard get_watch_playlist metadata either.
