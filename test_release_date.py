import ytmusicapi
import json

ytmusic = ytmusicapi.YTMusic()

# browseId for 'Blackout' from your example response
target_browse_id = 'MPREb_OiyfgMC9ayT'

print(f"Fetching details for: {target_browse_id}")
try:
    album_details = ytmusic.get_album(target_browse_id)
    
    print("\n--- Album Details ---")
    print(f"Title: {album_details.get('title')}")
    print(f"Year (from get_album): {album_details.get('year')}")
    
    # In newer versions of ytmusicapi, it might be nested or in 'releaseDate'
    if 'duration' in album_details:
        print(f"Duration: {album_details['duration']}")
    
    # Check for release date details
    # Sometimes it's in the 'description' or 'year' field
    # Let's inspect the whole object
    print("\nKeys in response:", list(album_details.keys()))
    
    # If the release date isn't directly here, it might be in the artist's albums list
    # but with more detail if we fetch the list explicitly.
    
except Exception as e:
    print(f"Error: {e}")
