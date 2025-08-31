import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';

import musiX from './musix.mplit.parser.js';

async function get_html(url) {
    try {
        // Launch browser
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        // Set user agent to avoid blocking
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        // Navigate to the URL
        await page.goto(url, { 
            waitUntil: 'networkidle2',
            timeout: 30000 
        });

        const html = await page.content();
        
        await browser.close();
        // console.log(html)
        return html;
        
    } catch (error) {
        console.error('Error fetching HTML:', error);
        throw error;
    }
}

async function get_musi_playlist(url) {
    try {
        const html = await get_html(url);
        const $ = cheerio.load(html);
        
        const playlist = {
            name: $('#playlist_header_title').text().trim(),
            tracks: []
        }

        const track_elements = $('a');
        track_elements.each((index, element) => {
            const style = $(element).find('.icon').attr('style') || '';
            let artwork_url = '';
            const match = style.match(/url\(['"]?(.*?)['"]?\)/);
            if (match && match[1]) {
                artwork_url = match[1];
            }

            const url = $(element).attr('href');

            const track = {
                title: $(element).find('.video_title').text().trim(),
                artist: $(element).find('.video_artist').text().trim(),
                artwork_url,
                url,
                id: url.split('v=').pop() // Assuming the last part of the URL is the track ID
            };
            if (track.title && track.artist && track.url) {
                playlist.tracks.push(track);
            }
        });

        return playlist;
    } catch (error) {
        console.error('Error fetching music playlist:', error);
        throw error;
    }
}

// get_musi_playlist('https://feelthemusi.com/playlist/a1shah') // Replace with the actual URL

export default { 
    get_musi_playlist,
    get_musix_playlist: musiX.parse_musix_playlist,
};