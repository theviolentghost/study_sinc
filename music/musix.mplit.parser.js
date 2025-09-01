import { parseFile, parseBuffer } from 'bplist-parser';
import fs from 'fs';

async function parse_musix_playlist(filePathOrBuffer) {
    try {
        // Handle both file paths and buffers
        let buffer;
        if (Buffer.isBuffer(filePathOrBuffer)) {
            // If it's already a buffer (from file upload), use it directly
            buffer = filePathOrBuffer;
        } else {
            // If it's a file path, read the file
            buffer = fs.readFileSync(filePathOrBuffer);
        }
        
        // Try multiple limits
        const limits = [100000, 200000, 500000];
        let result = null;
        
        for (const limit of limits) {
            try {
                console.log(`Attempting bplist parsing with limit ${limit}...`);
                result = await parseBuffer(buffer, { maxObjectCount: limit });
                console.log(`Successfully parsed with limit ${limit}`);
                break;
            } catch (error) {
                if (!error.message.includes('maxObjectCount exceeded')) {
                    throw error; // Different error, rethrow
                }
                console.log(`Limit ${limit} exceeded, trying next...`);
            }
        }
        
        if (!result) {
            throw new Error('All bplist parsing limits exceeded');
        }
        
        let lines, title;
        
        // Handle different possible data structures
        if (Array.isArray(result) && result[0] && result[0]['$objects']) {
            lines = result[0]['$objects'];
        } else if (result['$objects']) {
            lines = result['$objects'];
        } else if (Array.isArray(result)) {
            lines = result;
        } else {
            throw new Error('Unexpected plist structure');
        }

        console.log(`Parsing ${lines.length} objects from Musix playlist`);
        
        // Try to find title - check multiple possible indexes
        title = 'Untitled Playlist';
        for (let i = 0; i < Math.min(20, lines.length); i++) {
            if (lines[i] && typeof lines[i] === 'string' && lines[i].length > 0 && lines[i].length < 100) {
                // Look for a reasonable title (not a URL or empty)
                if (!lines[i].includes('youtube.com') && !lines[i].includes('http') && lines[i].trim().length > 0) {
                    title = lines[i].toString().trim();
                    break;
                }
            }
        }

        const youtubeUrls = [];
        const seenUrls = new Set(); // Prevent duplicates
        
        // More efficient parsing - use filter and map
        for (let i = 0; i < lines.length; i++) {
            if (lines[i] && typeof lines[i] === 'string') {
                const line = lines[i].toString().trim();
                if (line.includes('youtube.com/watch') && !seenUrls.has(line)) {
                    seenUrls.add(line);
                    youtubeUrls.push(line);
                }
            }
        }

        console.log(`Found ${youtubeUrls.length} unique YouTube URLs via bplist parsing`);

        return {
            name: title,
            tracks: youtubeUrls.map((url, index) => {
                // Extract video ID more robustly
                let videoId = '';
                const match = url.match(/[?&]v=([^&]+)/);
                if (match) {
                    videoId = match[1];
                } else {
                    videoId = `track-${index + 1}`;
                }

                return {
                    title: `Track ${index + 1}`,
                    url: url,
                    id: videoId,
                    artwork_url: '', 
                    artist: 'Unknown Artist' 
                };
            }),
        };
    } catch (error) {
        console.error('Error parsing Musix playlist with bplist:', error.message);
        
        // Fallback: try to parse as plain text if bplist parsing fails
        try {
            console.log('Attempting fallback text parsing...');
            return await parse_as_text_fallback(filePathOrBuffer);
        } catch (fallbackError) {
            console.error('Fallback parsing also failed:', fallbackError);
            throw new Error(`Failed to parse Musix playlist: ${error.message}`);
        }
    }
}

// Fallback parser in case bplist parsing completely fails
async function parse_as_text_fallback(filePathOrBuffer) {
    let buffer;
    
    // Handle both file paths and buffers
    if (Buffer.isBuffer(filePathOrBuffer)) {
        // If it's already a buffer (from file upload), use it directly
        buffer = filePathOrBuffer;
    } else {
        // If it's a file path, read the file
        buffer = fs.readFileSync(filePathOrBuffer);
    }
    
    // Try different encodings and search strategies
    let content = '';
    
    // Try UTF-8 first, then latin1 for binary data
    try {
        content = buffer.toString('utf8');
    } catch (e) {
        content = buffer.toString('latin1');
    }
    
    const youtubeUrls = [];
    const seenUrls = new Set();
    
    // More comprehensive URL extraction
    const urlPatterns = [
        /https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[\w-]+/g,
        /youtube\.com\/watch\?v=[\w-]+/g,
        /watch\?v=[\w-]+/g,
        /v=[\w-]{11}/g // YouTube video IDs are always 11 characters
    ];
    
    for (const pattern of urlPatterns) {
        let match;
        const regex = new RegExp(pattern.source, 'g');
        
        while ((match = regex.exec(content)) !== null) {
            let url = match[0];
            
            // Normalize URL
            if (!url.startsWith('http')) {
                if (url.startsWith('youtube.com')) {
                    url = 'https://www.' + url;
                } else if (url.startsWith('watch?v=')) {
                    url = 'https://www.youtube.com/' + url;
                } else if (url.startsWith('v=')) {
                    url = 'https://www.youtube.com/watch?' + url;
                }
            }
            
            // Extract video ID and validate
            const videoIdMatch = url.match(/[?&]v=([^&\s]{11})/);
            if (videoIdMatch && videoIdMatch[1].length === 11 && !seenUrls.has(videoIdMatch[1])) {
                seenUrls.add(videoIdMatch[1]);
                youtubeUrls.push(`https://www.youtube.com/watch?v=${videoIdMatch[1]}`);
            }
        }
    }
    
    // If still very few URLs found, try binary search for video ID patterns
    if (youtubeUrls.length < 10) {
        console.log('Performing deep binary search for video IDs...');
        const videoIdPattern = /[a-zA-Z0-9_-]{11}/g;
        let match;
        
        while ((match = videoIdPattern.exec(content)) !== null) {
            const potentialId = match[0];
            // YouTube video IDs are exactly 11 characters and typically contain both letters and numbers
            if (potentialId.length === 11 && /[a-zA-Z]/.test(potentialId) && /[0-9]/.test(potentialId) && !seenUrls.has(potentialId)) {
                seenUrls.add(potentialId);
                youtubeUrls.push(`https://www.youtube.com/watch?v=${potentialId}`);
            }
        }
    }
    
    console.log(`Fallback parsing found ${youtubeUrls.length} YouTube URLs`);
    
    return {
        name: 'Imported Playlist',
        tracks: youtubeUrls.map((url, index) => {
            const match = url.match(/[?&]v=([^&]+)/);
            const videoId = match ? match[1] : `track-${index + 1}`;
            
            return {
                title: `Track ${index + 1}`,
                url: url,
                id: videoId,
                artwork_url: '', 
                artist: 'Unknown Artist' 
            };
        }),
    };
}

export default {
    parse_musix_playlist,
};