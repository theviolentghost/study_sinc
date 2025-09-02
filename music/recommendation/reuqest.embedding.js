


async function request_embedding(song_id) {
    const response = await fetch('/api/request_embedding', {
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

export { request_embedding };