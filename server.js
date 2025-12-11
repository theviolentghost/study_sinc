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
import Music from './music.js'; 
import os from 'os';
import 'dotenv/config';
import progress_emitter from './progress.emitter.js';
import playlist_importer from './import.js';
import multer from 'multer';
import youtubeAccount from './youtube-account.js';
import fetch from 'node-fetch';
import crypto from 'crypto';
import youtubeHomepage from './youtube-homepage.js';
const upload = multer();

const app = Express();

const youtubeLoginSessions = {};

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
    const nextPageToken = req.query.nextPageToken;
    let accountId = req.query.accountId;
    if(!accountId) accountId = '';

    if (!query) {
        return res.status(400).json({ error: 'Search query is required' });
    }
    try {
        const results = await youtubeSearch.search(query, nextPageToken, accountId);

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
        const results = await youtubeChannelSearch.getFullChannel(id);

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

app.get('/youtube_get_search_suggestions', async (req, res) => {
    const query = req.query.q;

    if(!query) return [];

    try{
        const results = await youtubeSearch.getSearchSuggestions(query);

        res.json(results);
    }catch(error){
        console.error('error getting search suggestions', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/youtube_get_video_data', async (req, res) => {
    const videoId = req.query.videoId;

    if(!videoId) return;

    try{
        const results = await youtubePlaylist.getVideoData(videoId);

        res.json(results);
    }catch(error){
        console.error('error getting video data', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/youtube_get_homepage', async (req, res) => {
    let accountId = req.query.accountId;
    let nextPageToken = req.query.nextPageToken;
    if(!accountId) accountId = '';
    if(!nextPageToken) nextPageToken = '';

    try{
        const results = await youtubeHomepage.getHompage(accountId, nextPageToken);

        res.json(results);
    }catch(error){
        console.error('error getting homepage', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/start_youtube_login', async (req, res) => {
    const id = crypto.randomUUID();
    res.status(200).json({id: id});
    console.log(id);

    const browserInfo = await youtubeAccount.initializeLogin();

    youtubeLoginSessions[id] = { browser: browserInfo.browser, page: browserInfo.page, interval: null };
    youtubeAccount.awaitLogin(browserInfo.page, id);
});

app.get('/is_login_session_active/:id', async (req, res) => {
    const { id } = req.params;
    const session = youtubeLoginSessions[id];
    res.send(session ? true : false);
});

app.get('/stream_youtube_login/:id', async (req, res) => {
    const { id } = req.params;
    const session = youtubeLoginSessions[id];
    if (!session) return res.status(404).send('Session not found');

    res.status(200);
    const page = session.page;
    if(!page) return res.status(410).send('session ended');

    try {
        const client = await page.target().createCDPSession();

        const { data } = await client.send('Page.captureScreenshot', { fromSurface: true });

        const buffer = Buffer.from(data, 'base64');

        res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': buffer.length,
        'Cache-Control': 'no-cache',
        });
        res.end(buffer);
    } catch (err) {
        res.status(410);
    }
});

app.post('/login_click/:id', async (req, res) => {
    const { id } = req.params;
    const xPercentage = req.query.xPercentage;
    const yPercentage = req.query.yPercentage;

    const session = youtubeLoginSessions[id];
    if (!session) return res.status(404).send('Session not found');

    youtubeAccount.login_click(session.page, xPercentage, yPercentage);
    res.status(200).send({data:'clicked'});
});

app.post('/login_type/:id', async (req, res) => {
    const { id } = req.params;
    const input = req.query.input;

    const session = youtubeLoginSessions[id];
    if (!session) return res.status(404).send('Session not found');

    youtubeAccount.login_type(session.page, input);
    res.status(200).send({data:'typed ' + input});
});

app.get('/is_youtube_account_logged_in/:id', async (req, res) => {
    const { id } = req.params;

    let response = youtubeAccount.isLoggedIn(id);
    res.status(200).json({isLoggedIn: response});
    if(response && youtubeLoginSessions[id]) {
        await youtubeLoginSessions[id].browser.close();
        delete youtubeLoginSessions[id];
    }
});

app.get('/end_youtube_login_session/:id', async (req, res) => {
    const { id } = req.params;

    if(!youtubeLoginSessions[id]) res.status(404).send('Session not found');

    try{
        await youtubeLoginSessions[id].browser.close();
        delete youtubeLoginSessions[id];
    } catch(err){
        
    }
});


import { MongoClient } from "mongodb";

let db;
let client;

async function connectToMongo() {
    client = new MongoClient("mongodb+srv://adrianzych05_db_user:Z%23aych3482@cluster0.tacdasz.mongodb.net/?appName=Cluster0");
    await client.connect();
    db = client.db("youtube");
    console.log("Connected to Atlas");
}

connectToMongo();

app.post('/mongodb/addhistory', async (req, res) => {
  try {  
    const { sessionId, videoId, videoData } = req.body;

    if (!sessionId || !videoId)
      return res.status(400).json({ error: "Missing sessionId or videoId" });

    const user = await db.collection("users").findOne({
      "session_id": sessionId 
    });

    if (!user)
      return res.status(401).json({ error: "Invalid session" });

    const result = await db.collection("history-videos").updateOne(
      {
        user_id: user._id,
        video_id: videoId
      },
      {
        $set: {
          date_time_viewed: new Date(),
          video_data: videoData
        }
      },
      { upsert: true }
    );

    res.json({ insertedId: result.insertedId });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to insert history" });
  }
});

app.delete("/mongodb/cleanup-history", async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

    const result = await db.collection("history-videos").deleteMany({
      "date_time_viewed": { $lt: cutoff }
    });

    res.json({
      deletedCount: result.deletedCount
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete old history videos" });
  }
});

app.post("/mongodb/get-history", async (req, res) => {
  try {
    const { sessionId, lastToken } = req.body;

    if (!sessionId)
      return res.status(400).json({ error: "Missing sessionId" });

    const pipeline = [
      {
        $lookup: {
          from: "users",
          localField: "user_id",
          foreignField: "_id",
          as: "user"
        }
      },
      { $unwind: "$user" },

      {
        $match: {
          "user.session_id": sessionId,
          ...(lastToken
            ? { "date_time_viewed": { $lt: new Date(lastToken) } }
            : {})
        }
      },
      { $sort: { "date_time_viewed": -1 } },
      { $limit: lastToken ? 11 : 10 },
      { $project: { user: 0 } }
    ];

    const results = await db
      .collection("history-videos")
      .aggregate(pipeline)
      .toArray();

    if (!lastToken) {
      return res.json({
        items: results,
        nextPageToken: results.length === 10 
          ? results[results.length - 1].date_time_viewed 
          : null
      });
    }

    let nextToken = null;
    if (results.length === 11) {
      const lastItem = results[10];
      nextToken = lastItem.date_time_viewed;
      results.pop();
    }

    res.json({
      items: results,
      nextPageToken: nextToken
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

app.post("/mongodb/add-subscription", async (req, res) => {
  try {
    const { sessionId, channelId } = req.body;
    if (!sessionId || !channelId)
      return res.status(400).json({ error: "Missing sessionId or channelId" });

    const user = await db.collection("users").findOne({ session_id: sessionId });
    if (!user) return res.status(404).json({ error: "User not found" });

    await db.collection("subscriptions").updateOne(
      { user_id: user._id, channel_id: channelId },
      { $setOnInsert: { user_id: user._id, channel_id: channelId } },
      { upsert: true }
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add subscription" });
  }
});

app.post("/mongodb/remove-subscription", async (req, res) => {
  try {
    const { sessionId, channelId } = req.body;
    if (!sessionId || !channelId) return res.status(400).json({ error: "Missing sessionId or channelId" });

    const user = await db.collection("users").findOne({ session_id: sessionId });
    if (!user) return res.json({ deleted: 0 });

    const result = await db.collection("subscriptions").deleteMany({
      user_id: user._id,
      channel_id: channelId
    });

    res.json({ deleted: result.deletedCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to remove subscription" });
  }
});


app.post("/mongodb/get-subscriptions", async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });

    const user = await db.collection("users").findOne({ session_id: sessionId });
    if (!user) return res.json([]);

    const subscriptions = await db.collection("subscriptions")
      .find({ user_id: user._id })
      .project({ _id: 0, channel_id: 1 })
      .toArray();

    const channelIds = subscriptions.map(s => s.channel_id);

    res.json(channelIds);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch subscriptions" });
  }
});


app.post("/mongodb/upsert-user", async (req, res) => {
  try {
    const { email, password, sessionId } = req.body;

    if (!email || !password || !sessionId) {
      return res.status(400).json({ error: "Missing email, password, or sessionId" });
    }

    await db.collection("users").updateOne(
      { email },
      { $set: { password, session_id: sessionId } },
      { upsert: true }
    );

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to upsert user", error: err });
  }
});
import { ObjectId } from "mongodb";

app.post("/mongodb/delete-user", async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: "Missing userId" });
  }

  const session = client.startSession();

  try {
    session.startTransaction();

    const usersCollection = db.collection("users");
    const subsCollection = db.collection("subscriptions");
    const historyCollection = db.collection("history-videos");

    const uid = new ObjectId(userId);

    await usersCollection.deleteOne({ _id: uid }, { session });
    await subsCollection.deleteMany({ user_id: uid }, { session });
    await historyCollection.deleteMany({ user_id: uid }, { session });

    await session.commitTransaction();
    session.endSession();

    res.json({ success: true });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("Transaction aborted:", err);
    res.status(500).json({ error: "Failed to delete user" });
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
        console.error('Error fetching audio file:', error);
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
        console.error('Error fetching audio file:', error);
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
        console.error('Error fetching audio file:', error);
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
        console.error('Error fetching audio file:', error);
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
        console.error('Error fetching MusiX playlist:', error);
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

Music.stream.setup_endpoints(app);























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
    // console.log(req.url);
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
    // console.log(`Server is running on http://${host}:${port}`);
    console.log(`Server is running on http://localhost:${port}`);
});