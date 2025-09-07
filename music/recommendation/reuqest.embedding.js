


async function request_embedding(song_id) {
    console.log(`Requesting embedding for song ID JAVASCRIPT: ${song_id}...`);
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

export { request_embedding, is_song_in_process_queue };