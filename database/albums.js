import sqlite3 from 'sqlite3';
import { promisify } from 'util';

const album_database = new sqlite3.Database('storage/albums.sqlite');

// Create promisified versions of database methods
const db_all = promisify(album_database.all.bind(album_database));
const db_get = promisify(album_database.get.bind(album_database));
const db_exec = promisify(album_database.exec.bind(album_database));

// Custom wrapper for db.run to properly return changes and lastID
function db_run(sql, params = []) {
    return new Promise((resolve, reject) => {
        album_database.run(sql, params, function(err) {
            if (err) {
                reject(err);
            } else {
                resolve({ changes: this.changes, lastID: this.lastID });
            }
        });
    });
}

// Initialize database tables
async function initializeDatabase() {
    try {
        // Create albums table to store all known albums for artists
        await db_exec(`
            CREATE TABLE IF NOT EXISTS albums (
                id TEXT PRIMARY KEY,
                artist_id TEXT NOT NULL,
                album_group TEXT,
                album_type TEXT,
                total_tracks INTEGER,
                name TEXT,
                release_date TEXT,
                image_url TEXT,
                first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_checked_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Add image_url column if it doesn't exist (for existing databases)
        try {
            await db_exec(`ALTER TABLE albums ADD COLUMN image_url TEXT;`);
            console.log('Added image_url column to albums table');
        } catch (error) {
            // Column already exists, ignore error
        }

        // Create new_music table to track recently released albums
        await db_exec(`
            CREATE TABLE IF NOT EXISTS new_music (
                album_id TEXT PRIMARY KEY,
                artist_id TEXT NOT NULL,
                discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME,
                FOREIGN KEY (album_id) REFERENCES albums(id)
            );
        `);

        // Create indexes for faster queries
        await db_exec(`CREATE INDEX IF NOT EXISTS idx_albums_artist_id ON albums (artist_id);`);
        await db_exec(`CREATE INDEX IF NOT EXISTS idx_new_music_artist_id ON new_music (artist_id);`);
        await db_exec(`CREATE INDEX IF NOT EXISTS idx_new_music_expires_at ON new_music (expires_at);`);
        
        console.log('Albums database initialized successfully');
    } catch (error) {
        console.error('Error initializing albums database:', error);
        throw error;
    }
}

// Call initialization
initializeDatabase();

// ALBUM FUNCTIONS

/**
 * Store or update albums for an artist
 * @param {string} artist_id - Spotify artist ID
 * @param {Array} albums - Array of album objects from Spotify API
 * @returns {Promise<Object>} - Summary of stored/updated albums
 */
async function store_albums(artist_id, albums) {
    const stored = [];
    const updated = [];
    
    for (const album of albums) {
        try {
            // Check if album exists
            const existing = await db_get(
                `SELECT id FROM albums WHERE id = ?`,
                [album.id]
            );
            
            // Extract image URL (first/best quality image)
            const image_url = album.images && album.images.length > 0 ? album.images[0].url : null;
            
            if (existing) {
                // Update last_checked_at
                await db_run(
                    `UPDATE albums 
                     SET last_checked_at = CURRENT_TIMESTAMP,
                         album_group = ?,
                         album_type = ?,
                         total_tracks = ?,
                         name = ?,
                         release_date = ?,
                         image_url = ?
                     WHERE id = ?`,
                    [
                        album.album_group,
                        album.album_type,
                        album.total_tracks,
                        album.name,
                        album.release_date,
                        image_url,
                        album.id
                    ]
                );
                updated.push(album.id);
            } else {
                // Insert new album
                await db_run(
                    `INSERT INTO albums (id, artist_id, album_group, album_type, total_tracks, name, release_date, image_url)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        album.id,
                        artist_id,
                        album.album_group,
                        album.album_type,
                        album.total_tracks,
                        album.name,
                        album.release_date,
                        image_url
                    ]
                );
                stored.push(album.id);
            }
        } catch (error) {
            console.error(`Error storing album ${album.id}:`, error);
        }
    }
    
    return { stored, updated, total: stored.length + updated.length };
}

/**
 * Get all albums for an artist
 * @param {string} artist_id - Spotify artist ID
 * @returns {Promise<Array>} - Array of album records
 */
async function get_albums_by_artist(artist_id) {
    return await db_all(
        `SELECT * FROM albums WHERE artist_id = ? ORDER BY release_date DESC`,
        [artist_id]
    );
}

/**
 * Detect new albums by comparing fetched albums with stored albums
 * @param {string} artist_id - Spotify artist ID
 * @param {Array} fetched_albums - Array of album objects from Spotify API
 * @returns {Promise<Array>} - Array of new album IDs
 */
async function detect_new_albums(artist_id, fetched_albums) {
    const stored_albums = await get_albums_by_artist(artist_id);
    const stored_ids = new Set(stored_albums.map(a => a.id));
    
    const new_albums = fetched_albums.filter(album => !stored_ids.has(album.id));
    
    return new_albums;
}

/**
 * Add albums to the new_music table
 * @param {string} artist_id - Spotify artist ID
 * @param {Array} album_ids - Array of album IDs to mark as new
 * @param {number} new_duration_days - How many days to keep albums in new_music table (default: 30)
 * @returns {Promise<number>} - Number of albums added
 */
async function mark_as_new_music(artist_id, album_ids, new_duration_days = 30) {
    let added = 0;
    
    for (const album_id of album_ids) {
        try {
            // Check if already marked as new
            const existing = await db_get(
                `SELECT album_id FROM new_music WHERE album_id = ?`,
                [album_id]
            );
            
            if (!existing) {
                // Calculate expiration date
                const expires_at = new Date();
                expires_at.setDate(expires_at.getDate() + new_duration_days);
                
                await db_run(
                    `INSERT INTO new_music (album_id, artist_id, expires_at)
                     VALUES (?, ?, ?)`,
                    [album_id, artist_id, expires_at.toISOString()]
                );
                added++;
            }
        } catch (error) {
            console.error(`Error marking album ${album_id} as new:`, error);
        }
    }
    
    return added;
}

/**
 * Get all new music entries (not expired)
 * @param {string} artist_id - Optional artist ID to filter by
 * @returns {Promise<Array>} - Array of new music records with album details
 */
async function get_new_music(artist_id = null) {
    const query = artist_id
        ? `SELECT n.*, a.* FROM new_music n
           JOIN albums a ON n.album_id = a.id
           WHERE n.artist_id = ? AND n.expires_at > CURRENT_TIMESTAMP
           ORDER BY n.discovered_at DESC`
        : `SELECT n.*, a.* FROM new_music n
           JOIN albums a ON n.album_id = a.id
           WHERE n.expires_at > CURRENT_TIMESTAMP
           ORDER BY n.discovered_at DESC`;
    
    const params = artist_id ? [artist_id] : [];
    return await db_all(query, params);
}

/**
 * Remove expired entries from new_music table
 * @returns {Promise<number>} - Number of entries removed
 */
async function cleanup_expired_new_music() {
    const result = await db_run(
        `DELETE FROM new_music WHERE expires_at <= CURRENT_TIMESTAMP`
    );
    return result.changes || 0;
}

/**
 * Manually remove an album from new_music table
 * @param {string} album_id - Album ID to remove
 * @returns {Promise<boolean>} - True if removed, false if not found
 */
async function remove_from_new_music(album_id) {
    const result = await db_run(
        `DELETE FROM new_music WHERE album_id = ?`,
        [album_id]
    );
    return result.changes > 0;
}

/**
 * Get count of albums for an artist
 * @param {string} artist_id - Spotify artist ID
 * @returns {Promise<number>} - Count of albums
 */
async function get_album_count(artist_id) {
    const result = await db_get(
        `SELECT COUNT(*) as count FROM albums WHERE artist_id = ?`,
        [artist_id]
    );
    return result.count;
}

/**
 * Check if an album was released within the last N days
 * @param {string} release_date - Release date string (YYYY-MM-DD or YYYY-MM or YYYY)
 * @param {number} days - Number of days to check
 * @returns {boolean} - True if released within the last N days
 */
function is_recently_released(release_date, days = 30) {
    if (!release_date) return false;
    
    try {
        // Parse release date (handle different formats: YYYY-MM-DD, YYYY-MM, YYYY)
        const date_parts = release_date.split('-');
        const year = parseInt(date_parts[0]);
        const month = date_parts.length > 1 ? parseInt(date_parts[1]) - 1 : 0; // 0-indexed
        const day = date_parts.length > 2 ? parseInt(date_parts[2]) : 1;
        
        const release = new Date(year, month, day);
        const now = new Date();
        const diff_ms = now - release;
        const diff_days = diff_ms / (1000 * 60 * 60 * 24);
        
        return diff_days >= 0 && diff_days <= days;
    } catch (error) {
        console.error(`Error parsing release date: ${release_date}`, error);
        return false;
    }
}

/**
 * Check for new albums and update database
 * @param {string} artist_id - Spotify artist ID
 * @param {Array} fetched_albums - Array of album objects from Spotify API
 * @param {number} new_duration_days - How many days to keep albums in new_music table
 * @returns {Promise<Object>} - Summary of operation
 */
async function sync_albums(artist_id, fetched_albums, new_duration_days = 30, new_artist = false) {
    // Check if artist is actually new (has no stored albums)
    const existing_album_count = await get_album_count(artist_id);
    const is_new_artist = new_artist || existing_album_count === 0;
    
    let albums_to_mark;
    let new_albums = [];
    let recently_released = [];
    
    if (is_new_artist) {
        // For new artists, only use release date threshold (30 days)
        recently_released = fetched_albums.filter(album => 
            is_recently_released(album.release_date, 30)
        );
        albums_to_mark = recently_released;
    } else {
        // For existing artists, detect new albums AND recently released
        new_albums = await detect_new_albums(artist_id, fetched_albums);
        
        // Also find albums released in the last month (even if they're already in DB)
        recently_released = fetched_albums.filter(album => 
            is_recently_released(album.release_date, 30)
        );
        
        // Combine new albums and recently released albums (remove duplicates)
        albums_to_mark = [...new Map(
            [...new_albums, ...recently_released].map(album => [album.id, album])
        ).values()];
    }
    
    // Store/update all albums
    const store_result = await store_albums(artist_id, fetched_albums);
    
    // Mark albums in the new_music table
    let new_music_count = 0;
    if (albums_to_mark.length > 0) {
        const album_ids = albums_to_mark.map(a => a.id);
        new_music_count = await mark_as_new_music(artist_id, album_ids, new_duration_days);
    }
    
    // Cleanup expired entries
    const expired_count = await cleanup_expired_new_music();
    
    return {
        new_albums: new_albums,
        new_albums_count: new_albums.length,
        recently_released: recently_released,
        recently_released_count: recently_released.length,
        total_marked_as_new: albums_to_mark.length,
        stored_count: store_result.stored.length,
        updated_count: store_result.updated.length,
        total_albums: store_result.total,
        marked_as_new: new_music_count,
        expired_removed: expired_count
    };
}

/**
 * Advanced sync with custom recently released threshold
 * @param {string} artist_id - Spotify artist ID
 * @param {Array} fetched_albums - Array of album objects from Spotify API
 * @param {number} new_duration_days - How many days to keep albums in new_music table
 * @param {number} recently_released_threshold_days - How many days back to consider as "recently released"
 * @param {boolean} new_artist - Whether this is a new artist being added
 * @returns {Promise<Object>} - Summary of operation
 */
async function sync_albums_advanced(artist_id, fetched_albums, new_duration_days = 30, recently_released_threshold_days = 30, new_artist = false) {
    // Check if artist is actually new (has no stored albums)
    const existing_album_count = await get_album_count(artist_id);
    const is_new_artist = new_artist || existing_album_count === 0;
    
    let albums_to_mark;
    let new_albums = [];
    let recently_released = [];
    
    if (is_new_artist) {
        // For new artists, only use release date threshold
        recently_released = fetched_albums.filter(album => 
            is_recently_released(album.release_date, recently_released_threshold_days)
        );
        albums_to_mark = recently_released;
    } else {
        // For existing artists, detect new albums AND recently released
        new_albums = await detect_new_albums(artist_id, fetched_albums);
        
        // Also find albums released in the specified threshold
        recently_released = fetched_albums.filter(album => 
            is_recently_released(album.release_date, recently_released_threshold_days)
        );
        
        // Combine new albums and recently released albums (remove duplicates)
        albums_to_mark = [...new Map(
            [...new_albums, ...recently_released].map(album => [album.id, album])
        ).values()];
    }
    
    // Store/update all albums
    const store_result = await store_albums(artist_id, fetched_albums);
    
    // Mark albums in the new_music table
    let new_music_count = 0;
    if (albums_to_mark.length > 0) {
        const album_ids = albums_to_mark.map(a => a.id);
        new_music_count = await mark_as_new_music(artist_id, album_ids, new_duration_days);
    }
    
    // Cleanup expired entries
    const expired_count = await cleanup_expired_new_music();
    
    return {
        new_albums: new_albums,
        new_albums_count: new_albums.length,
        recently_released: recently_released,
        recently_released_count: recently_released.length,
        total_marked_as_new: albums_to_mark.length,
        stored_count: store_result.stored.length,
        updated_count: store_result.updated.length,
        total_albums: store_result.total,
        marked_as_new: new_music_count,
        expired_removed: expired_count,
        recently_released_threshold_days: recently_released_threshold_days
    };
}

export default {
    store_albums,
    get_albums_by_artist,
    detect_new_albums,
    mark_as_new_music,
    get_new_music,
    cleanup_expired_new_music,
    remove_from_new_music,
    get_album_count,
    sync_albums,
    sync_albums_advanced,
    is_recently_released
};
