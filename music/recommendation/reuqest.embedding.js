import music from '../music.js'


async function request_embedding(song_id) {

    try {
        const response = await fetch('http://localhost:54321/request_embedding', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ song_id: song_id }),
        });
        const data = await response.json();
        console.log('Success:', data);
        if (!response.ok) {
            throw new Error(data.error || 'Unknown error');
        }
    } catch (error) {
        console.error('Error:', error);
        return;
    }
}

const spotify_track_embedding_queue = [];
async function request_embedding_for_spotify_items(spotify_items) {
    // spotify_items is an array of objects with { type: 'track' | 'album' | 'playlist', id: string }
    // creates a reuqest queue because it also has to request video_id which takes server resources.
    // so we handle the queue here.
    // wait till a track is done before moving on to next with a 5 second delay between each request.
    // confirm track is of type track, then also fecth video_id

    spotify_track_embedding_queue.push(...spotify_items);
    
    process_spotify_track_embedding_queue();
}

let processing_queue = false;
async function process_spotify_track_embedding_queue() {
    if (processing_queue) return;
    processing_queue = true;

    while (spotify_track_embedding_queue.length > 0) {
        const item = spotify_track_embedding_queue.shift();
        if (item.type === 'track') {
            const video_id = await music.spotify.uri_to_video_id(item.uri);
            await request_embedding(video_id);
            console.log(`Requested embedding for ${item.type} with ID ${video_id}`);
        }
        // wait 60 seconds before next request
        await new Promise(resolve => setTimeout(resolve, 60 * 1000));
    }

    processing_queue = false;
}

async function is_song_in_process_queue(song_id) {
    const response = await fetch(`http://localhost:54321/is_song_in_process_queue?song_id=${encodeURIComponent(song_id)}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
    });
    const data = await response.json();
    console.log('Success:', data);
    if (!response.ok) {
        throw new Error(data.error || 'Unknown error');
    }
    return data.in_queue;
}

export { request_embedding, is_song_in_process_queue, request_embedding_for_spotify_items };