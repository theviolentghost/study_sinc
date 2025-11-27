import music from '../music.js';
import database from '../../database/main.js';

// Configuration
const max_albums_per_request = 50;
const max_total_albums = 1000;
const NEW_MUSIC_DURATION_DAYS = 21; // How many days to keep albums marked as "new"
const RECENTLY_RELEASED_THRESHOLD_DAYS = 30; // How many days back to consider an album "recently released"

async function fetch_all_albums_by_artist(artist_id) {
    try {
        const albums = [];
        let offset = 0;
        let has_next = true;
        do {
            const response = await music.spotify.spotify_api_with_retry(() => 
                music.spotify.api.getArtistAlbums(artist_id, { limit: max_albums_per_request, offset: offset })
            );
            const data = response.body;
            offset += data.items.length;
            has_next = data.next !== null;
            if(!data || !data.items) break;
            albums.push(...data.items);
        } while (has_next && offset < max_total_albums && albums.length < max_total_albums);

        return albums;
    } catch (error) {
        console.error('Error fetching albums:', error);
    }
}

async function check_and_sync_albums(artist_id, new_duration_days = NEW_MUSIC_DURATION_DAYS) {
    try {
        // Get current album count from database
        const stored_count = await database.albums.get_album_count(artist_id);

        const new_artist = stored_count === 0; // If no albums stored, consider as new artist
        
        // Fetch all albums from Spotify
        const fetched_albums = await fetch_all_albums_by_artist(artist_id);
        
        // Sync albums with database (detects new, stores/updates, marks as new)
        const sync_result = await database.albums.sync_albums(artist_id, fetched_albums, new_duration_days, new_artist);

        return sync_result;
    } catch (error) {
        console.error('Error checking and syncing albums:', error);
    }
}

/**
 * Get all new music for an artist
 * @param {string} artist_id - Spotify artist ID (optional)
 * @returns {Promise<Array>} - Array of new music entries
 */
async function get_new_music(artist_id = null) {
    try {
        await check_and_sync_albums(artist_id);
        const new_music = await database.albums.get_new_music(artist_id);
        
        return new_music;
    } catch (error) {
        console.error('Error getting new music:', error);
    }
}

const max_artists_per_request = 50;
async function get_new_music_from_multiple_artists(artist_ids = []) {
    try {
        // Limit to max_artists_per_request
        const limited_artist_ids = artist_ids.slice(0, max_artists_per_request);
        
        // Fetch new music for all artists in parallel
        const results = await Promise.all(
            limited_artist_ids.map(async (artist_id) => {
                const new_music = await get_new_music(artist_id);
                return { artist_id, new_music };
            })
        );
        
        // Convert results array to object
        const all_new_music = {};
        results.forEach(({ artist_id, new_music }) => {
            all_new_music[artist_id] = new_music;
        });
        
        return all_new_music;
    } catch (error) {
        console.error('Error getting new music from multiple artists:', error);
    }   
}

/**
 * Manually remove an album from new music table
 * @param {string} album_id - Album ID to remove
 * @returns {Promise<boolean>}
 */
async function remove_from_new_music(album_id) {
    try {
        const removed = await database.albums.remove_from_new_music(album_id);
        if (removed) {
            console.log(`✅ Removed album ${album_id} from new music`);
        } else {
            console.log(`⚠️ Album ${album_id} not found in new music`);
        }
        return removed;
    } catch (error) {
        console.error('Error removing from new music:', error);
    }
}

export default {
    fetch_all_albums_by_artist,
    check_and_sync_albums,
    get_new_music,
    get_new_music_from_multiple_artists,
    remove_from_new_music
};

// get_new_music('1LtlO7x7J1OCaUVKRBub5v').then(async result => {

//     console.log(result);
// }).catch(error => {
//     console.error('Error:', error);
// });

// get_new_music_from_multiple_artists(['1LtlO7x7J1OCaUVKRBub5v', '3TVXtAsR1Inumwj472S9r4']).then(async result => {
//     console.log(result);
// });