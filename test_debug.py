import ytmusicapi
import json

ytmusic = ytmusicapi.YTMusic()

artist_id = "UCUDVBtnOQi4c7E8jebpjc9Q"
print(f"Fetching artist: {artist_id}")
channel = ytmusic.get_artist(artist_id)

print("\nArtist record head keys:", list(channel.keys()))

albums_data = channel.get('albums', {})
print("\n'albums' field in get_artist response keys:", list(albums_data.keys()))

results = albums_data.get('results', [])
print(f"\nInitial albums in results: {len(results)}")
for a in results:
    print(f" - {a.get('title')} ({a.get('year')})")

browse_id = albums_data.get('browseId')
params = albums_data.get('params')

print(f"\nbrowse_id: {browse_id}")
print(f"params: {params}")

if browse_id and params:
    print("\nAttempting to fetch ALL albums via get_artist_albums...")
    try:
        all_albums = ytmusic.get_artist_albums(browse_id, params)
        print(f"Total albums fetched: {len(all_albums)}")
        for a in all_albums:
            print(f" - {a.get('title')} ({a.get('year')})")
    except Exception as e:
        print(f"Failed to fetch artist albums: {e}")
else:
    print("\nCannot fetch more albums; browseId or params missing.")
