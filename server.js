import Express from 'express';
import https from 'https';
import fs from 'fs';
import CORS from 'cors';
import Authentication from './authentication.js';
import Database from './database/main.js';
import youtubeSearch from './youtube-search.js'; 
import youtubeChannelSearch from './youtube-channel-search.js';
import youtubePlaylist from './youtube-playlist.js';
import path from 'path';
import { fileURLToPath } from 'url';
import Music from './music/music.js'; 
import os from 'os';
import 'dotenv/config';
import progress_emitter from './progress.emitter.js';
import playlist_importer from './music/import.js';
import multer from 'multer';
const upload = multer();

const app = Express();

//
//
// Get local network IPv4 address
function get_local_external_IP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const certPath = path.join(__dirname, 'certificates', 'cert.pem');
const keyPath = path.join(__dirname, 'certificates', 'key.pem');

const port = process.env.PORT || 3000;
// const host = get_local_external_IP() || '0.0.0.0';
const host = '0.0.0.0'; // Use localhost for development
// const https_options = {
//     cert: fs.readFileSync(certPath),
//     key: fs.readFileSync(keyPath),
// };

app.use(CORS());
app.use(Express.json());
app.use(Express.urlencoded({ extended: true }));

Music.stream.setup_endpoints(app);

//
//
// Auth

app.post('/auth/register',
    Authentication.validate_login_registration_input,
    Authentication.is_email_in_use,
    async (req, res) => {
        const { email, password, displayName } = req.body;

        try {
            const result = await Database.users.register(email, password, displayName);
            if (!result) {
                return res.status(500).json({ error: 'Registration failed' });
            }

            const newUserData = await Database.users.find_by_email(email);

            const token = Authentication.JWT.token.generate(newUserData);
            const refreshToken = Authentication.JWT.refresh_token.generate(newUserData);
            if (!token || !refreshToken) {
                Database.users.delete_by_email(email);
                return res.status(500).json({ error: 'Registration failed' });
            }

            Database.users.refresh_tokens.store(newUserData.id, refreshToken);

            res.status(201).json({
                message: 'User registered successfully',
                token,
                refreshToken,
                user: Authentication.sanatize_user_data(newUserData),
            });
        } catch (error) {
            console.error('Error during registration:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);

app.post('/auth/login',
    Authentication.validate_login_registration_input,
    Authentication.authenticate_user,
    async (req, res) => {
        const user = req.user;
        try {
            const token = Authentication.JWT.token.generate(user);
            const refreshToken = Authentication.JWT.refresh_token.generate(user);
            if (!token || !refreshToken) {
                return res.status(401).json({ error: 'Token generation failed' });
            }
            Database.users.refresh_tokens.store(user.id, refreshToken);

            res.status(200).json({
                message: 'Login successful',
                token,
                refreshToken,
                user: Authentication.sanatize_user_data(user),
            });
        } catch (error) {
            console.error('Error during login:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);

app.delete('/auth/logout',
    Authentication.validate_authorization,
    async (req, res) => {
        const { email, id } = req.user;
        try {
            const user = await Database.users.find_by_id(id);
            if (!user) {
                const userByEmail = await Database.users.find_by_email(email);
                if (!userByEmail) {
                    return res.status(404).json({ error: 'User not found' });
                }
            }

            const result = await Database.users.refresh_tokens.delete(user.id);
            if (!result) {
                return res.status(500).json({ error: 'Logout failed' });
            }

            res.status(200).json({ message: 'Logout successful' });
        } catch (error) {
            console.error('Error during logout:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);

app.get('/auth/authorized',
    Authentication.validate_authorization,
    async (req, res) => {
        try {
            const user = req.authorization;
            if (!user) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            res.json({
                authorized: true,
                message: 'User is authorized',
            });
        } catch (error) {
            console.error('Error checking authorization:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);

app.post('/auth/refresh',
    async (req, res) => {
        try {
            const refreshToken = req.body.refreshToken;
            if(!refreshToken) return res.status(401).json({error: "No refresh token provided"});
            
            const tokenRecord = await Database.users.refresh_tokens.find(refreshToken);
            if (!tokenRecord) return res.status(403).json({ error: 'Invalid refresh token' });

            const verification = Authentication.JWT.refresh_token.verify(refreshToken);
            if(!verification) return res.status(403).json({ error: 'Invalid refresh token' });

            const accessToken = Authentication.JWT.token.generate(verification);
            if(!accessToken) return res.status(500).json({ error: "Error generating token" });

            res.json({ token: accessToken });
        } catch (error) {
            console.error('Error generating refresh token:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);

app.get('/auth/userinfo',
    Authentication.validate_authorization,
    async (req, res) => {
        try {
            const user = req.authorization;
            if (!user) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const userData = await Database.users.find_by_id(user.id);
            if (!userData) {
                return res.status(404).json({ error: 'User not found' });
            }

            res.json(Authentication.sanatize_user_data(userData));
        } catch (error) {
            console.error('Error fetching user info:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);

//
//
// Projects

app.get('/user/projects/all', 
    Authentication.validate_authorization,
    async (req, res) => {
        try {
            const user = req.authorization;
            if (!user || !user.id) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            
            const projects = await Database.storage.project.find_all_user_projects(user.id);
            if(!projects || projects.length === 0) {
                return res.status(404).json({ error: 'No projects found for this user' });
            }

            res.json(projects);
        } catch (error) {
            console.error('Error fetching projects:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);
app.get('/user/projects/hierarchy',
    Authentication.validate_authorization,
    async (req, res) => {
        try {
            const user = req.authorization;
            if (!user || !user.id) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const hierarchy = await Database.storage.hierarchy.get_user_project_hierarchy(user.id);
            if (!hierarchy || hierarchy.length === 0) {
                return res.status(404).json({ error: 'No projects found for this user' });
            }

            res.json(hierarchy);
        } catch (error) {
            console.error('Error fetching hierarchy:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
)
app.get('/user/project/:projectId',
    Authentication.validate_authorization,
    async (req, res) => {
        try {
            const projectId = req.params.projectId;
            if (!projectId) {
                return res.status(400).json({ error: 'Project ID is required' });
            }

            const project = await Database.storage.project.findById(projectId);
            if (!project) {
                return res.status(404).json({ error: 'Project not found' });
            }

            const files = await Database.storage.file.find_by_project_id(projectId);
            if (!files) {
                return res.status(404).json({ error: 'No files found for this project' });
            }

            res.json({ ...project, files });
        } catch(error) {
            console.error('Error fetching project:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);
app.post('/user/folder/create',
    Authentication.validate_authorization,
    async (req, res) => {
        const { name, parentId } = req.body;
        const user = req.authorization;

        if (!name || !user || !user.id) {
            return res.status(400).json({ error: 'Name and user ID are required' });
        }

        try {
            const folder = await Database.storage.folder.create(user.id, name, parentId);
            if (!folder) {
                return res.status(500).json({ error: 'Failed to create folder' });
            }

            res.status(201).json(folder);
        } catch (error) {
            console.error('Error creating folder:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);
app.post('/user/group/create',
    Authentication.validate_authorization,
    async (req, res) => {
        const { name, parentId } = req.body;
        const user = req.authorization;

        if (!name || !user || !user.id) {
            return res.status(400).json({ error: 'Name and user ID are required' });
        }

        try {
            const group = await Database.storage.group.create(user.id, parentId, name);
            if (!group) {
                return res.status(500).json({ error: 'Failed to create group' });
            }

            res.status(201).json(group);
        } catch (error) {
            console.error('Error creating group:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);
app.post('/user/project/create',
    Authentication.validate_authorization,
    async (req, res) => {
        const { name, description, type, groupId } = req.body;
        const user = req.authorization;

        if (!name || !type || !user || !user.id) {
            return res.status(400).json({ error: 'Name, type and user ID are required' });
        }

        try {
            const project = await Database.storage.project.create(user.id, groupId, name, description, type);
            if (!project) {
                return res.status(500).json({ error: 'Failed to create project' });
            }

            res.status(201).json(project);
        } catch (error) {
            console.error('Error creating project:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);
app.post('/user/file/create',
    Authentication.validate_authorization,
    async (req, res) => {
        const {fileName, filePath, fileType, projectId, data } = req.body;
        const user = req.authorization;

        if (!filePath || !fileType || !projectId || !user || !user.id) {
            return res.status(400).json({ error: 'Project ID, File Name, File Path, File Type and User ID are required' });
        }

        try {
            const file = await Database.storage.file.create(user.id, projectId, fileName, filePath, fileType, data);
            if (!file) {
                return res.status(500).json({ error: 'Failed to create file' });
            }

            res.status(201).json(file);
        } catch (error) {
            console.error('Error creating file:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);

// gets all files, including data. not recommended for large projects
app.get('/user/project/:projectId/files',
    Authentication.validate_authorization,
    async (req, res) => {
        try {
            const projectId = req.params.projectId;
            if (!projectId) {
                return res.status(400).json({ error: 'Project ID is required' });
            }

            const files = await Database.storage.file.find_by_project_id(projectId);
            if (!files || files.length === 0) {
                return res.status(404).json({ error: 'No files found for this project' });
            }

            res.json(files);
        } catch (error) {
            console.error('Error deleting project:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);
// get all file meta data project
app.get('/user/project/:projectId/files/meta',
    Authentication.validate_authorization,
    async (req, res) => {
        try {
            const projectId = req.params.projectId;
            if (!projectId) {
                return res.status(400).json({ error: 'Project ID is required' });
            }

            const files = await Database.storage.file.find_file_metadatas_by_project_id(projectId);
            if (!files || files.length === 0) {
                return res.status(404).json({ error: 'No files found for this project' });
            }

            res.json(files);
        } catch (error) {
            console.error('Error fetching file metadata:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);
app.get('/user/file/:fileId',
    Authentication.validate_authorization,
    async (req, res) => {
        try {
            const fileId = req.params.fileId;
            if (!fileId) {
                return res.status(400).json({ error: 'File ID is required' });
            }
            const file = await Database.storage.file.find_by_id(fileId);
            if (!file) {
                return res.status(404).json({ error: 'File not found' });
            }

            res.json(file);
        } catch (error) {
            console.error('Error fetching file:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);
app.put('/user/file/:fileId',
    Authentication.validate_authorization,
    async (req, res) => {
        try {
            const fileId = req.params.fileId;
            const { data } = req.body;
            // fileName, filePath, fileType are not used in update_data
            if (!fileId) {
                return res.status(400).json({ error: 'File ID is required' });
            }

            const updatedFile = await Database.storage.file.update_data(fileId, data);
            if (!updatedFile) {
                return res.status(500).json({ error: 'Failed to update file' });
            }

            res.json(updatedFile);
        } catch (error) {
            console.error('Error updating file:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);

//
//
// Newton

// app.post('/newton/chat',
//     Authentication.newton.validateChatAuthorization,
//     (req, res) => {
//         // Handle chat request
//     }
// )

app.get('/youtube_search', async (req, res) => {
    const query = req.query.q;
    const maxResults = req.query.maxResults || 5;
    const nextPageToken = req.query.nextPageToken || '';

    if (!query) {
        return res.status(400).json({ error: 'Search query is required' });
    }
    try {
        const results = await youtubeSearch.search(query,  maxResults, nextPageToken);

        res.json(results);
    } catch (error) {
        console.error('Error searching videos:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/youtube_full_channel', async (req, res) => {
    const id = req.query.id;

    if (!id) {
        return res.status(400).json({ error: 'id is required' });
    }
    try {
        const results = await youtubeChannelSearch.getFullChannel(id);;

        res.json(results);
    } catch (error) {
        console.error('Error searching videos:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/youtube_get_channel_playlists', async (req, res) => {
    const id = req.query.id;

    if (!id) {
        return res.status(400).json({ error: 'id is required' });
    }
    try {
        const results = await youtubePlaylist.getChannelPlaylists(id);

        res.json(results);
    } catch (error) {
        console.error('Error searching videos:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/youtube_get_playlist_videos', async (req, res) => {
    const id = req.query.id;
    const nextPageToken = req.query.nextPageToken;


    if (!id) {
        return res.status(400).json({ error: 'id is required' });
    }
    try {
        const results = await youtubePlaylist.getPlaylistVideos(id, nextPageToken);

        res.json(results);
    } catch (error) {
        console.error('Error searching videos:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// app.post('/newton/chat',
//     Authentication.newton.validateChatAuthorization,
//     (req, res) => {
//         // Handle chat request
//     }
// )

//
//
// Music

app.post("/audio/download/:audio_id", async (req, res) => {
    const audio_id = req.params.audio_id;

    if (!audio_id) {
        return res.status(400).json({ error: 'Audio ID is required' });
    }
    try {
        console.log('Downloading audio file with ID:', audio_id);
        Music.youtube.download_stream(res, audio_id, req.body);
    } catch (error) {
        console.error('Error fetching audio file:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.get("/audio/artwork/:audio_id", async (req, res) => {
    const audio_id = req.params.audio_id;

    if (!audio_id) {
        return res.status(400).json({ error: 'Audio ID is required' });
    }
    try {
        console.log('getting artwork with ID:', audio_id);
        Music.get_artwork(res, audio_id);
    } catch (error) {
        console.error('Error fetching audio file:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.get("/audio/stream/:audio_id", async (req, res) => {
    const audio_id = req.params.audio_id;

    if (!audio_id) {
        return res.status(400).json({ error: 'Audio ID is required' });
    }
    try {
        console.log('Streaming audio file with ID:', audio_id);
        Music.youtube.stream(res, audio_id);
    } catch (error) {
        console.error('Error fetching audio file:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.get("/music/stream/:audio_id", async (req, res) => {
    const audio_id = req.params.audio_id;

    if (!audio_id) {
        return res.status(400).json({ error: 'Audio ID is required' });
    }
    try {
        console.log('Streaming audio file with ID:', audio_id);
        Music.youtube.download_stream(res, audio_id);
    } catch (error) {
        console.error('Error fetching audio file:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.get('/audio/progress/:video_id', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const videoId = req.params.video_id;

    const on_progress = (progress) => {
        res.write(`data: ${JSON.stringify(progress)}\n\n`);
    };

    const on_done = () => {
        res.write(`event: done\ndata: {}\n\n`);
        res.end();
        progress_emitter.off(videoId, on_progress);
        progress_emitter.off(`${videoId}_done`, on_done);
    };

    progress_emitter.on(videoId, on_progress);
    progress_emitter.on(`${videoId}_done`, on_done);

    req.on('close', () => {
        progress_emitter.off(videoId, on_progress);
        progress_emitter.off(`${videoId}_done`, on_done);
    });
});

app.get('/music/search', async (req, res) => {
    const query = req.query.q;
    const source = req.query.source || 'spotify'; 
    console.log('Search query:', query);
    console.log('Search source:', source);
    if (!query) {
        return res.status(400).json({ error: 'Search query is required' });
    }
    try {
        const results = await Music.search(query, source);
        
        res.json(results);
    } catch (error) {
        console.error('Error searching music:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/music/search_recommendations', async (req, res) => {
    const query = req.query.q;
    if (!query) {
        return res.status(400).json({ error: 'Search query is required' });
    }
    try {
        const recommendations = await Music.get_search_recommendations(query);
        if (!recommendations || recommendations.length === 0) {
            return res.status(404).json({ error: 'No recommendations found for the given query' });
        }
        res.json(recommendations);
    } catch (error) {
        console.error('Error fetching search recommendations:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/music/spotify/video-id', async (req, res) => {
    const spotify_uri = req.query.uri;
    if (!spotify_uri) {
        return res.status(400).json({ error: 'Spotify URI is required' });
    }
    try {
        const video_id = await Music.spotify.uri_to_video_id(spotify_uri);
        if (!video_id) {
            return res.status(404).json({ error: 'Video ID not found for the given Spotify URI' });
        }

        res.json({ video_id });
    } catch (error) {
        console.error('Error fetching video ID from Spotify URI:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/import/musi', async (req, res) => {
    const url = req.query.url;
    if (!url) {
        return res.status(400).json({ error: 'Playlist URL is required' });
    }
    try {
        const playlist = await playlist_importer.get_musi_playlist(url);
        if (!playlist || !playlist.tracks || playlist.tracks.length === 0) {
            return res.status(404).json({ error: 'No tracks found in the playlist' });
        }
        res.json(playlist);
    } catch (error) {
        console.error('Error fetching Musi playlist:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/import/musix', upload.single('playlist_file'), async (req, res) => {
    const file = req.file; // multer puts the file here
    if (!file) {
        return res.status(400).json({ error: 'Playlist file is required' });
    }
    try {
        // file.buffer contains the file data as a Buffer
        const playlist = await playlist_importer.get_musix_playlist(file.buffer);
        if (!playlist || !playlist.tracks || playlist.tracks.length === 0) {
            return res.status(404).json({ error: 'No tracks found in the playlist' });
        }
        res.json(playlist);
    } catch (error) {
        console.error('Error fetching MusiX playlist:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/music/top_charts', async (req, res) => {
    try {
        const top_charts = await Music.get_top_charts();
        if (!top_charts) {
            return res.status(404).json({ error: 'No top charts found' });
        }
        res.json(top_charts);
    } catch (error) {
        console.error('Error fetching top charts:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/music/mood_categories', async (req, res) => {
    try {
        const mood_categories = await Music.get_mood_categories();
        if (!mood_categories) {
            return res.status(404).json({ error: 'No mood categories found' });
        }
        res.json(mood_categories);
    } catch (error) {
        console.error('Error fetching mood categories:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/music/mood_tracks', async (req, res) => {
    const mood = req.query.mood;
    if (!mood) {
        return res.status(400).json({ error: 'Mood is required' });
    }
    try {
        const mood_tracks = await Music.get_mood_playlists(mood);
        if (!mood_tracks || mood_tracks.length === 0) {
            return res.status(404).json({ error: 'No tracks found for the given mood' });
        }
        res.json(mood_tracks);
    } catch (error) {
        console.error('Error fetching mood tracks:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.get('/music/watch_playlist/:track_id', async (req, res) => {
    const track_id = req.params.track_id;
    if (!track_id) {
        return res.status(400).json({ error: 'Track ID is required' });
    }
    try {
        const watch_playlist = await Music.get_watch_playlist(track_id);
        if (!watch_playlist) {
            return res.status(404).json({ error: 'No tracks found in the watch playlist' });
        }

        res.json(watch_playlist);
    } catch (error) {
        console.error('Error fetching watch playlist:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
app.get('/spotify/artist/:artist_id', async (req, res) => {
    const artist_id = req.params.artist_id;
    if (!artist_id) {
        return res.status(400).json({ error: 'Artist ID is required' });
    }
    try {
        const artist = await Music.spotify.get_artist(artist_id);
        if (!artist) {
            return res.status(404).json({ error: 'Artist not found' });
        }
        res.json(artist);
    } catch (error) {
        console.error('Error fetching artist:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// /music/artist/${artist_id}/top_tracks
app.get('/spotify/artist/:artist_id/top_tracks', async (req, res) => {
    const artist_id = req.params.artist_id;
    if (!artist_id) {
        return res.status(400).json({ error: 'Artist ID is required' });
    }
    try {
        const top_tracks = await Music.spotify.get_artist_top_tracks(artist_id);
        if (!top_tracks || top_tracks.length === 0) {
            return res.status(404).json({ error: 'No top tracks found for the given artist' });
        }
        res.json(top_tracks);
    } catch (error) {
        console.error('Error fetching artist top tracks:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// /spotify/artist/${artist_id}/albums
app.get('/spotify/artist/:artist_id/albums', async (req, res) => {
    const artist_id = req.params.artist_id;
    if (!artist_id) {
        return res.status(400).json({ error: 'Artist ID is required' });
    }
    try {
        const albums = await Music.spotify.get_artist_albums(artist_id);
        if (!albums || albums.length === 0) {
            return res.status(404).json({ error: 'No albums found for the given artist' });
        }
        res.json(albums);
    } catch (error) {
        console.error('Error fetching artist albums:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// /music/song_data/:video_id
app.get('/music/song_data/:video_id', async (req, res) => {
    const video_id = req.params.video_id;
    if (!video_id) {
        return res.status(400).json({ error: 'Video ID is required' });
    }
    try {
        const song_data = await Music.get_song_data(video_id);
        if (!song_data) {
            return res.status(404).json({ error: 'No song data found for the given video ID' });
        }
        res.json(song_data);
    } catch (error) {
        console.error('Error fetching song data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/music/recommend/:video_id', async (req, res) => {
    const video_id = req.params.video_id;
    if (!video_id) {
        return res.status(400).json({ error: 'Video ID is required' });
    }
    try {
        const recommendations = await Music.get_recommendations(video_id);
        if (!recommendations || recommendations.length === 0) {
            return res.status(404).json({ error: 'No recommendations found for the given video ID' });
        }
        res.json(recommendations);
    } catch (error) {
        console.error('Error fetching recommendations:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// /spotify/album/
app.get('/spotify/album/:album_id', async (req, res) => {
    const album_id = req.params.album_id;
    if (!album_id) {
        return res.status(400).json({ error: 'Album ID is required' });
    }
    try {
        const album = await Music.spotify.get_album_details(album_id);
        if (!album) {
            return res.status(404).json({ error: 'Album not found' });
        }
        res.json(album);
    } catch (error) {
        console.error('Error fetching album:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// /music/top_releases
app.get('/music/top_releases', async (req, res) => {
    try {
        const top_releases = await Music.spotify.get_top_releases();
        res.json(top_releases);
    } catch (error) {
        console.error('Error fetching top releases:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});






// Serve static files for music app with no cache for index.html
app.use('/music', Express.static(
    path.join(__dirname, 'frontend/dist/music/browser'),
    {
        setHeaders: (res, filePath) => {
            // console.log(filePath);
            if (filePath.endsWith('index.html')) {
                res.setHeader('Cache-Control', 'no-store');
            }
        }
    }
));

// Serve static files for study app with no cache for index.html
app.use('/', Express.static(
    path.join(__dirname, 'frontend/dist/study/browser'),
    {
        setHeaders: (res, filePath) => {
            // console.log(filePath);
            if (filePath.endsWith('index.html')) {
                res.setHeader('Cache-Control', 'no-store');
            }
        }
    }
));

app.get('/.well-known/appspecific/:path', (req, res) => {
    res.status(404).end(); // Just return 404 for DevTools requests
});

// Serve the Angular study app (this should be LAST)
app.get(/.*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    console.log(req.url);
    if (req.path.startsWith('/music') || req.path.startsWith('music')) {
        res.sendFile(
            path.join(__dirname, 'frontend/dist/music/browser/index.html')
        );
    } else {
        res.sendFile(
            path.join(__dirname, 'frontend/dist/study/browser/index.html')
        );
    }
});

app.listen(port, host, () => {
    console.log(`Server is running on http://${host}:${port}`);
});