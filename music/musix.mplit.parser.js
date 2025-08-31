import { parseFile } from 'bplist-parser';

async function parse_musix_playlist(filePath) {
    try {
        const result = await parseFile(filePath);
        const lines = result[0]['$objects'];
        const youtubeUrls = [];

        const title = lines[9].toString().trim();

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].toString().trim();
            if (line.includes('youtube.com/watch')) {
                youtubeUrls.push(line);
            }
        }

        return {
            name: title,
            tracks: youtubeUrls.map((url, index) => ({
                title: `Track ${index + 1}`,
                url: url,
                id: url.split('v=')[1] || `track-${index + 1}`, // Extract ID from URL or use a fallback
                artwork_url: '', 
                artist: 'Unknown Artist' 
            })),
        };
    } catch (error) {
        console.error('Error parsing Musix playlist:', error);
        throw error;
    }
}

export default {
    parse_musix_playlist,
};