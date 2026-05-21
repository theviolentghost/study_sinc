import ytmusicapi
import json

ytmusic = ytmusicapi.YTMusic()

# browseId for 'Blackout' from your example response
target_browse_id = 'MPREb_OiyfgMC9ayT'

print(f"Fetching details for: {target_browse_id}")
try:
    album_details = ytmusic.get_album(target_browse_id)
    
    print("\n--- Album Details from get_album ---")
    print(f"Title: {album_details.get('title')}")
    print(f"Year (from get_album): {album_details.get('year')}")
    print(f"Description: {album_details.get('description')}")
    
    # Try looking for a full date string in the description or other fields
    # Sometimes it's in the 'description' (e.g., 'Released April 9, 2026')
    
    # Alternatively, get the list version if possible (Oasis UCUDVBtnOQi4c7E8jebpjc9Q)
    # The browseId and params were:
    artist_browse_id = "MPADUCmMUZbaYdNH0bEd1PAlAqsA"
    params = "ggMIegYIARoCAQI%3D"
    
    print("\nFetching artist album list (looking for full date)...")
    all_albums = ytmusic.get_artist_albums(artist_browse_id, params)
    
    for a in all_albums:
        if a['browseId'] == target_browse_id:
            print("\nFound entry in artist album list:")
            print(a)
            # Sometimes 'year' is just the year, but other times it's the full date
    
except Exception as e:
    print(f"Error: {e}")
