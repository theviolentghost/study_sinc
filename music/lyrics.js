import path from 'path';
import fs from 'fs/promises';

/* 
{
    source: 'lrclib' | 'musik'
    lyrics: [
        {
            start_time: int (ms)
            end_time: int (ms)
            text: string
            probability?: float (0.0 - 1.0) // only for musik source
        }
    ]
}
*/

async function get_video_properties(youtube_video_id) {
    const file_path = path.join('storage', 'musik', 'hls', 'raw', youtube_video_id, 'properties.json');
    try {
        const data = await fs.readFile(file_path, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error reading video properties for ${youtube_video_id}:`, error);
        return null;
    }
}

async function fetch_lyrics_for_song_using_lrclib(youtube_video_id, track_name, artist_name, album_name, duration_seconds) {
    if(!track_name || !artist_name) {
        // try to fetch from video properties if possible
        const video_properties = await get_video_properties(youtube_video_id);
        if (video_properties) {
            track_name = track_name || video_properties.title;
            artist_name = artist_name || (video_properties.artist.split(',')?.[0] || video_properties.artists);
            album_name = album_name || video_properties.album;
            duration_seconds = duration_seconds || video_properties.duration;
        }
        if(!track_name || !artist_name) {
            throw new Error('Track name, artist name, album name, and duration are required to fetch lyrics.');
        }
        // fall through
    }

    let fetch_url = path.join('https://lrclib.net', 'api', 'get');
    const query_params = new URLSearchParams({
        track_name: track_name,
        artist_name: artist_name,
    });

    if (album_name) {
        query_params.append('album_name', album_name);
    }
    if (duration_seconds) {
        query_params.append('duration', duration_seconds.toString());
    }

    fetch_url += `?${query_params.toString()}`;
    const result = await fetch(fetch_url, {
        method: 'GET',
    });
    if (!result.ok) {
        if(result.status === 404) throw new Error('Lyrics not found.');
        throw new Error(result.error || 'Unknown error while fetching lyrics.');
    }
    const data = await result.json();

    return format_lyrics_from_lrclib_response(data);
}
async function format_lyrics_from_lrclib_response(lrclib_response) {
    const { plainLyrics, syncedLyrics, duration } = lrclib_response;
    if(syncedLyrics && syncedLyrics.length > 0) {
        // format synced lyrics
        const split_lines = syncedLyrics.split('\n');
        let last_start_timestamp_object = null;
        const formatted_lines = split_lines.map(line => {
            const match = line.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)$/);
            if(match) {
                const minutes = parseInt(match[1], 10);
                const seconds = parseInt(match[2], 10);
                const milliseconds = parseInt(match[3], 10);
                const text = match[4].trim();
                const time_stamp_milliseconds = (minutes * 60 * 1000) + (seconds * 1000) + milliseconds;
                let lyric_object = {
                    start_time: time_stamp_milliseconds,
                    end_time: Infinity,
                    text: text,
                    probability: 1.0
                };
                if (last_start_timestamp_object) {
                    last_start_timestamp_object.end_time = time_stamp_milliseconds;
                }
                last_start_timestamp_object = lyric_object;
                return lyric_object;
            }
        });

        return {
            info: {
                source: 'lrclib',
                duration: duration * 1000,
                language_probabilities: [{ language: '#unknown', probability: 1.0 }]
            },
            blocks: formatted_lines.filter(line => line !== undefined),
            lyrics: null,
        };
    }
}

/*
    song_metadata: {
        id: youtube_video_id (string),
        track_name: string,
        artist_name: string,
        album_name?: string,
        duration_seconds?: number,
    }
*/
async function fetch_lyrics(song_metadata, source_preference = 'lrclib') {
    const { id, track_name, artist_name, album_name, duration_seconds } = song_metadata;
    try {
        if (source_preference === 'lrclib') {
            return await fetch_lyrics_for_song_using_lrclib(id, track_name, artist_name, album_name, duration_seconds);
        } else {
            // return await fetch_lyrics_from_musik(song_metadata);
        }
    } catch (fallback_error) {
        // try the other source as a fallback
        console.warn(`Failed to fetch lyrics using ${source_preference}, trying fallback source. Error:`, fallback_error.message);
        try {
            if (source_preference === 'lrclib') {
                // return await fetch_lyrics_from_musik(song_metadata);
            } else {
                return await fetch_lyrics_for_song_using_lrclib(id, track_name, artist_name, album_name, duration_seconds);
            }
        } catch (final_error) {
            console.error(`Failed to fetch lyrics using both sources. Error:`, final_error.message);
            return null;
        }
    }
}

async function fetch_lyrics_from_musik(song_metadata) {
    try {
        const { id, track_name, artist_name, album_name, duration_seconds } = song_metadata;
        const response = await fetch('http://localhost:5003/transcribe_lyrics', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ video_id: id })
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch lyrics from musik service: ${response.statusText}`);
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error(`Error fetching lyrics from musik for song ID ${song_metadata.id}:`, error.message);
        return null;
    }
}

// (async () => {
//     const lyrics = await fetch_lyrics({
//         id: 'e3dx1iVs6Ro',  // Uncomment for fallback to work
//         // track_name: 'Dead2me',
//         // artist_name: 'loveshy',
//         // album_name: `Baldur's Gate 3 (Original Game Soundtrack)`,
//         // duration_seconds: 233
//     });
//     console.log(lyrics);
// })();

export {
    fetch_lyrics
};