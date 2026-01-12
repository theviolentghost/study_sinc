const CACHE_NAME_PREFIX = 'sinc_music';
const VERSION_URL = 'app/version.txt';
const LOGGING = false;
const SW_VERSION = '1.0.15'; 

const CACHE_NAME = `${CACHE_NAME_PREFIX}_cache_v${SW_VERSION}`;

class Service_Worker {
    version = SW_VERSION;
    cached_app_version = "0.0.0";
    fetched_app_version = "0.0.0";
    
    constructor(service_worker) {
        this.file_manager = new File_Manager();
        this.database_ready = this.file_manager.open_database();
        this.network_manager = new Network_Manager(this.file_manager, this);
        this.self = service_worker;

        this.initialize();
    }

    initialize() {
        this.on_install_event();
        this.on_activate_event();
        this.initialize_fetch_event();
        this.initialize_message_event();
        this.check_for_app_update();
    }

    on_install_event() {
        this.self.addEventListener('install', (event) => {
            event.waitUntil(
                (async () => {
                    if (LOGGING) console.log(`Service Worker installing - Version: ${this.version}`);
                    
                    // Pre-cache static assets
                    this.network_manager.cache_all_static_files();

                    // Force the waiting service worker to become the active service worker
                    await this.self.skipWaiting();
                })()
            );
        });
    }

    on_activate_event() {
        this.self.addEventListener('activate', (event) => {
            event.waitUntil(
                (async () => {
                    if (LOGGING) console.log(`Service Worker activated - Version: ${this.version}`);
                    
                    // Wait for database to be ready
                    await this.database_ready;
                    
                    // Delete old caches
                    const cacheNames = await caches.keys();
                    await Promise.all(
                        cacheNames
                            .filter(cacheName => cacheName.startsWith(CACHE_NAME_PREFIX) && cacheName !== CACHE_NAME)
                            .map(cacheName => {
                                if (LOGGING) console.log('Deleting old cache:', cacheName);
                                return caches.delete(cacheName);
                            })
                    );
                    
                    // Check for app updates after activation
                    // this.check_for_app_update();
                    
                    // Notify all clients about the update
                    // const clients = await this.self.clients.matchAll();
                    // clients.forEach(client => {
                    //     client.postMessage({
                    //         type: 'SW_UPDATED',
                    //         version: this.version
                    //     });
                    // });
                    
                    await this.self.clients.claim();
                })()
            );
        });
    }

    initialize_fetch_event() {
        this.self.addEventListener('fetch', (event) => {
            event.respondWith(
                (async () => {
                    // Wait for database to be ready before handling fetch
                    await this.database_ready;
                    return this.network_manager.handle_fetch(event.request);
                })()
            );
        });
    }

    initialize_message_event() {
        this.self.addEventListener('message', (event) => {
            this.handle_message_event(event);
        });
    }

    handle_message_event(event) {
        const { type, payload } = event.data;
        if (LOGGING) console.log('SW received message:', type, payload);
        switch (type) {
            case 'CHECK_FOR_APP_UPDATE':
                this.check_for_app_update();
                break;
            case 'SESSION_RESPONSE':
                // Handle session response for pending requests
                if (this.network_manager.pending_session_requests.has(payload.url)) {
                    const pending_requests = this.network_manager.pending_session_requests.get(payload.url);
                    
                    // Create response with proper headers for HLS content
                    const headers = new Headers({
                        'Content-Type': 'application/vnd.apple.mpegurl',
                        'Cache-Control': 'no-cache',
                        'Access-Control-Allow-Origin': '*'
                    });
                    
                    if (LOGGING) console.log('📄 Playlist content length:', payload.data?.length || 0);
                    
                    // Resolve all pending requests
                    pending_requests.forEach(({ resolve, timeout_id }) => {
                        clearTimeout(timeout_id);
                        resolve(new Response(payload.data, { 
                            status: 200,
                            statusText: 'OK',
                            headers: headers
                        }));
                    });
                    
                    this.network_manager.pending_session_requests.delete(payload.url);
                } else {
                    if (LOGGING) console.warn('⚠️ No pending request found for:', payload.url);
                }
                break;
            default:
                if (LOGGING) console.warn('SW received unknown message type:', type);
        }
    }

    post_message_to_all_clients(type, payload) {
        const message = { type, payload };
        this.self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage(message);
            });
        });
    }

    async check_for_app_update() {
        // Wait for database to be ready before checking for updates
        await this.database_ready;
        
        const [cached_version = "0.0.0", latest_version = "0.0.0"] = await Promise.all([
            this.fetch_cached_app_version(),
            this.fetch_latest_app_version()
        ]);
        this.cached_app_version = cached_version.trim();
        this.fetched_app_version = latest_version.trim();

        // Cache the latest version
        if(this.fetched_app_version && this.fetched_app_version !== "0.0.0" && this.cached_app_version !== this.fetched_app_version) await this.cache_app_version(this.fetched_app_version);

        const should_update = this.should_update_app();
        this.post_message_to_all_clients('APP_VERSION', {
            cached_version: this.cached_app_version,
            latest_version: this.fetched_app_version,
            should_update,
            update_type: this.determine_update_type(this.cached_app_version, this.fetched_app_version),
            service_worker_version: this.version,
        });
    }

    should_update_app() {
        if(LOGGING) console.log('Comparing app versions - Cached:', this.cached_app_version, 'Fetched:', this.fetched_app_version);
        if(this.cached_app_version === "0.0.0" || this.fetched_app_version === "0.0.0") return false;
        const should_update =  this.cached_app_version !== this.fetched_app_version; 
        if(should_update) {
            const update_type = this.determine_update_type(this.cached_app_version, this.fetched_app_version);
            if(LOGGING) console.log(`App update available: ${this.cached_app_version} -> ${this.fetched_app_version} (${update_type})`);
            this.file_manager.set_file_priority_threshold(
                update_type === 'major' ? 3 :
                update_type === 'minor' ? 2 :
                update_type === 'patch' ? 1 : 0);
        }
        return should_update;
    }
    // 0.0.# => patch
    // 0.#.0 => minor
    // #.0.0 => major
    determine_update_type(old_version, new_version) {
        const old_parts = old_version.split('.').map(Number);
        const new_parts = new_version.split('.').map(Number);

        if (old_parts[0] !== new_parts[0]) return 'major';
        if (old_parts[1] !== new_parts[1]) return 'minor';
        if (old_parts[2] !== new_parts[2]) return 'patch';
        return 'none';
    }

    async fetch_cached_app_version() {
        try {
            const response = await this.file_manager.cache_fetch(new Request(VERSION_URL));
            if (response) {
                return response.text();
            } else {
                return "0.0.0";
            }
        } catch (error) {
            console.error('Error fetching cached app version:', error);
        }
    }

    async cache_app_version(version) {
        try {
            const response = new Response(version, {
                headers: { 'Content-Type': 'text/plain' }
            });
            await this.file_manager.cache_file(new Request(VERSION_URL), response);
            if (LOGGING) console.log('Cached app version:', version);
        } catch (error) {
            console.error('Error caching app version:', error);
        }
    }

    async fetch_latest_app_version() {
        try {
            const response = await fetch(VERSION_URL, { cache: 'no-store' });
            if (response.ok) {
                return response.text();
            } else {
                throw new Error(`Network response was not ok: ${response.statusText}`);
            }
        } catch (error) {
            console.error('Error fetching latest app version:', error);
        }
    }
}

class File_Manager {
    static DATABASE_NAME = 'sinc_music_file_manager';
    static OBJECT_STORE_NAME = 'files';
    static STATIC_FILE_URLS = [
        '/music/index.html',
        '/music/app/manifest.webmanifest',
        '/music/app/version.txt',
        '/music/alert-triangle.svg',
        '/music/antenna-bars-1.svg',
        '/music/antenna-bars-2.svg',
        '/music/antenna-bars-3.svg',
        '/music/antenna-bars-4.svg',
        '/music/antenna-bars-5.svg',
        '/music/antenna-bars-off.svg',
        '/music/arrow-narrow-down.svg',
        '/music/arrow-narrow-up.svg',
        '/music/arrows-shuffle.svg',
        '/music/badge-cc-fill.svg',
        '/music/badge-cc.svg',
        '/music/bookmark.svg',
        '/music/bookmark-fill.svg',
        '/music/brand-musi.svg',
        '/music/brand-musix.svg',
        '/music/brand-spotify.svg',
        '/music/brand-youtube.svg',
        '/music/check.svg',
        '/music/chevron-down.svg',
        '/music/chevron-left.svg',
        '/music/chevron-up.svg',
        '/music/cloud-down.svg',
        '/music/cloud-download.svg',
        '/music/disco-ball-fill.svg',
        '/music/dots.svg',
        '/music/download.svg',
        '/music/edit.svg',
        '/music/grip-horizontal.svg',
        '/music/heart-fill.svg',
        '/music/heart.svg',
        '/music/loader.svg',
        '/music/music.svg',
        '/music/palette.svg',
        '/music/player-pause.svg',
        '/music/player-play.svg',
        '/music/player-skip-back.svg',
        '/music/player-skip-forward.svg',
        '/music/playlist.svg',
        '/music/plus.svg',
        '/music/reload.svg',
        '/music/repeat.svg',
        '/music/search.svg',
        '/music/share.svg',
        '/music/trash.svg',
        '/music/users.svg',
        '/music/world-search.svg',
        '/music/x.svg',
        '/music/audio/silent/audio/master.m3u8',
        '/music/audio/silent/audio/aac/ultra-low/32k.m3u8',
        '/music/audio/silent/audio/aac/ultra-low/32k_60.ts',
    ];

    database = null;
    database_opened = false;
    // file class 
    // 0 => no_cache
    // 1 => tiny change
    // 2 => minor change
    // 3 => major change
    // 4 => static
    file_priority_threshold = 0; // any file with classification <= this value will be refreshed (network first) but 0 is no_cache
    constructor () { }

    set_file_priority_threshold(threshold) {
        this.file_priority_threshold = threshold;
        if (LOGGING) console.log('File priority threshold set to:', this.file_priority_threshold);

        const files_to_update = this.get_all_files_less_equal_classification(this.file_priority_threshold);
        files_to_update.then((files) => {
            files.forEach((file) => {
                this.index_file(file.url, 'need_update');
            });
        }).catch((error) => {
            this.handle_error(error);
        });
    }

    handle_error(error) {
        if(LOGGING) console.error('File_Manager Error:', error);
        else { 
            // Handle error silently
        };
    }

    open_database() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(File_Manager.DATABASE_NAME, 2);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(File_Manager.OBJECT_STORE_NAME)) {
                    const store = db.createObjectStore(File_Manager.OBJECT_STORE_NAME, { keyPath: 'url' });

                    store.createIndex('status', 'status', { unique: false });
                    store.createIndex('class', 'class', { unique: false });
                }
            };
            request.onsuccess = () => {
                this.database = request.result;
                this.database_opened = true;
                resolve(request.result);
            };
            request.onerror = () => reject(request.error);
        });
    }

    // gets the file's type and then returns the classification
    // depending on the files type, we can classify if it needs an update based on the version update scheme:

    // no cache (0)
    // tiny update: (0.0.#) -> highest priority (1)
    //      This is for files that are frequently updated, like small assets or configuration files.
    // minor update: (0.#.0) -> medium priority (2)
    //      This is for files that are updated less frequently, like images.
    // major update: (#.0.0) -> lowest priority (3)
    //      This is for files that are rarely updated, like scripts or libraries. but when they are updated, they are significant changes.
    get_file_classification(url) {
        if (!url) {
            if (LOGGING) console.warn('get_file_classification called with empty URL');
            return 'no_cache'; // Default to no_cache if no URL is provided
        }
        if (LOGGING) console.log('Classifying file:', url);
        const file_extension = url.split('.').pop().toLowerCase();

        const classifications = {
            'js': 1, 
            'css': 1, 
            'html': 1, 
            'ts': 0, // HLS song segments should not be cached
            'm3u8': 0, // HLS playlists should not be cached
            'png': 2, 
            'jpg': 2,
            'jpeg': 2,
            'gif': 2,
            'svg': 2,
            'json': 2,
            'txt': 1,
            'svg': 2,
            'webmanifest': 3,
            'manifest': 3,
            
        };
        if(!file_extension) return 0;

        return classifications[file_extension] || 0; // Default to tiny if not classified (meaning it is a frequently updated file)
    }

    // status => 'updated' | 'need_update'
    async index_file(url, status = 'updated') {
        if (!this.database_opened) return this.handle_error({message: 'Database not opened yet'});
        try {
            const classification = this.get_file_classification(url);
            if (!await this.should_cache_file(url)) return;

            const transaction = this.database.transaction([File_Manager.OBJECT_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(File_Manager.OBJECT_STORE_NAME);

            const file_record = {
                url: url,
                class: classification,
                status: status,
            };

            const request = store.put(file_record);
            request.onsuccess = () => {
                if (LOGGING) console.log(`File indexed successfully: ${url}`);
            };
            request.onerror = () => {
                this.handle_error(request.error);
            };
        } catch (error) {
            this.handle_error(error);
        }
    }

    async get_all_files_less_equal_classification(classification) {
        if (!this.database_opened) {
            this.handle_error({message: 'Database not opened yet'});
            return [];
        }
        try {
            const transaction = this.database.transaction([File_Manager.OBJECT_STORE_NAME], 'readonly');
            const store = transaction.objectStore(File_Manager.OBJECT_STORE_NAME);
            const index = store.index('class');
            // Get all files with classification between 1 and the specified classification (inclusive)
            // IDBKeyRange.bound(lower, upper, lowerOpen, upperOpen)
            const request = index.getAll(IDBKeyRange.bound(1, classification, false, false));

            return new Promise((resolve, reject) => {
                request.onsuccess = () => {
                    resolve(request.result);
                };
                request.onerror = () => {
                    reject(request.error);
                };
            });
        } catch (error) {
            this.handle_error(error);
            return [];
        }
    }

    async get_indexed_file(url) {
        if (!this.database_opened) {
            this.handle_error({message: 'Database not opened yet'});
            return null;
        }
        try {
            const transaction = this.database.transaction([File_Manager.OBJECT_STORE_NAME], 'readonly');
            const store = transaction.objectStore(File_Manager.OBJECT_STORE_NAME);
            const request = store.get(url);

            return new Promise((resolve, reject) => {
                request.onsuccess = () => {
                    resolve(request.result);
                };
                request.onerror = () => {
                    reject(request.error);
                };
            });
        } catch (error) {
            this.handle_error(error);
            return null;
        }
    }

    is_local_url(url) {
        try {
            const parsedUrl = new URL(url, self.location.href);
            return parsedUrl.origin === self.location.origin;
        } catch (error) {
            this.handle_error(error);
            return false;
        }
    }

    async should_cache_file(url) {
        const url_object = new URL(url);
        if (!this.is_local_url(url_object)) return false; // cache only local files
        const classification = this.get_file_classification(url_object.href) || 0;

        if (classification === 0) return false; // no_cache
        // check if cached at all, if not, cache it
        const cached = await this.get_indexed_file(url_object.href);
        if (!cached) return true;
        
        // if already cached, check classification against threshold to see if we should refresh
        if (classification <= this.file_priority_threshold) return true;
        return false;
    }

    async cache_fetch(request) {
        try {
            const cache = await caches.match(request);
            return cache || null;
        } catch (error) {
            this.handle_error(error);
            return null;
        }
    }

    async cache_file(request, response) {
        try {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, response);
            await this.index_file(request.url);
        } catch (error) {
            this.handle_error(error);
        }
    }
}

class Network_Manager {
    constructor(file_manager, service_worker) {
        this.service_worker = service_worker;
        this.file_manager = file_manager;
        this.pending_session_requests = new Map(); // Track pending session requests
        this.PLAYLIST_CACHE_NAME = 'sinc_music_playlists_v1';
    }

    async get_session_playlist_from_cache(url) {
        try {
            // Cache API is fast enough to not trigger browser cancellation
            const cache = await caches.open(this.PLAYLIST_CACHE_NAME);
            const cached_response = await cache.match(url);
            
            if (cached_response) {
                const playlist_data = await cached_response.text();
                if (LOGGING) console.log('📦 Retrieved playlist from Cache API:', url);
                return playlist_data;
            } else {
                if (LOGGING) console.log('⚠️ Playlist not found in Cache API:', url);
                return null;
            }
        } catch (error) {
            if (LOGGING) console.error('❌ Cache API error:', error);
            return null;
        }
    }

    async store_session_playlist_in_cache(url, data) {
        try {
            const cache = await caches.open(this.PLAYLIST_CACHE_NAME);
            const response = new Response(data, {
                headers: {
                    'Content-Type': 'application/vnd.apple.mpegurl',
                    'Cache-Control': 'no-cache',
                    'X-Timestamp': Date.now().toString()
                }
            });
            await cache.put(url, response);
            if (LOGGING) console.log('💾 Stored playlist in Cache API:', url);
        } catch (error) {
            if (LOGGING) console.error('❌ Error storing playlist in Cache API:', error);
        }
    }

    handle_error(error) {
        if(LOGGING) console.error('Network_Manager Error:', error);
        else {
            // Handle error silently
        };
    }

    is_session_request(url) {
        try {
            const parsed_url = new URL(url, self.location.href);
            return parsed_url.pathname.includes('session');
        } catch (error) {
            this.handle_error(error);
            return false;
        }
    }

    is_hls_request(url) {
        try {
            const parsed_url = new URL(url, self.location.href);
            // Check for HLS-related paths
            return parsed_url.pathname.includes('/hls/') || 
                   parsed_url.pathname.endsWith('.m3u8') || 
                   parsed_url.pathname.endsWith('.ts') ||
                   parsed_url.pathname.includes('session');
        } catch (error) {
            this.handle_error(error);
            return false;
        }
    }

    is_image_request(url) {
        try {
            const parsed_url = new URL(url, self.location.href);
            const image_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico'];
            return image_extensions.some(ext => parsed_url.pathname.toLowerCase().endsWith(ext));
        } catch (error) {
            this.handle_error(error);
            return false;
        }
    }

    is_svg_request(url) {
        try {
            const parsed_url = new URL(url, self.location.href);
            return parsed_url.pathname.toLowerCase().endsWith('.svg');
        } catch (error) {
            this.handle_error(error);
            return false;
        }
    }

    get_request_priority(url) {
        // HLS requests get highest priority
        if (this.is_hls_request(url)) {
            return 'high';
        }
        
        // Images get lowest priority
        if (this.is_image_request(url)) {
            if(this.is_svg_request(url)) {
                return 'medium'; // SVGs are vector and usually small, so medium priority
            }
            return 'low';
        }
        
        // Check for critical resources
        const parsed_url = new URL(url, self.location.href);
        const path = parsed_url.pathname.toLowerCase();
        
        // Scripts and styles are medium priority
        if (path.endsWith('.js') || path.endsWith('.css')) {
            return 'medium';
        }
        
        // Fonts are low priority
        if (path.endsWith('.woff') || path.endsWith('.woff2') || path.endsWith('.ttf')) {
            return 'low';
        }
        
        // Default to medium
        return 'medium';
    }

    async fetch(request, cache = false) {
        if (LOGGING) console.log('Network_Manager fetch called for:', request.url, 'Cache:', cache);
        
        if (this.is_session_request(request.url)) {
            if (LOGGING) console.log('📱 Session playlist request detected:', request.url);
            
            try {
                // Read playlist from Cache API (faster than IndexedDB)
                const playlist_data = await this.get_session_playlist_from_cache(request.url);
                
                if (playlist_data) {
                    if (LOGGING) console.log('✅ Returning playlist from Cache API');
                    return new Response(playlist_data, {
                        status: 200,
                        statusText: 'OK',
                        headers: {
                            'Content-Type': 'application/vnd.apple.mpegurl',
                            'Cache-Control': 'no-cache',
                            'Access-Control-Allow-Origin': '*'
                        }
                    });
                } else {
                    if (LOGGING) console.warn('⚠️ Playlist not found in cache, returning empty playlist');
                    // Return empty playlist rather than failing
                    return new Response('#EXTM3U\n#EXT-X-VERSION:7', {
                        status: 200,
                        statusText: 'OK',
                        headers: {
                            'Content-Type': 'application/vnd.apple.mpegurl',
                            'Cache-Control': 'no-cache'
                        }
                    });
                }
            } catch (error) {
                if (LOGGING) console.error('❌ Error reading from cache:', error);
                // Return empty playlist on error
                return new Response('#EXTM3U\n#EXT-X-VERSION:7', {
                    status: 200,
                    statusText: 'OK',
                    headers: {
                        'Content-Type': 'application/vnd.apple.mpegurl',
                        'Cache-Control': 'no-cache'
                    }
                });
            }
        }

        // Get priority for this request
        const priority = this.get_request_priority(request.url);
        
        // For high priority (HLS) requests, use fetch with priority hint if supported
        const fetch_options = {};
        if (priority === 'high') {
            // Use high priority for HLS requests
            fetch_options.priority = 'high';
        } else if (priority === 'low') {
            // Use low priority for images
            fetch_options.priority = 'low';
        }

        try {
            const response = fetch(request, fetch_options);
            
            if(!response || !response.ok) {
                this.handle_error(new Error(`Network request failed for ${request.url} with status ${response.status}`));
                return response;
            }

            if(cache) {
                try {
                    this.file_manager.cache_file(request, response.clone());
                } catch (error) {
                    this.handle_error(error);
                }
            }

            return response;
        } catch (error) {
            this.handle_error(error);
            throw error;
        }
    }

    async cache_first_fetch(request, cache_override = null) {
        try {
            const cachedResponse = await this.file_manager.cache_fetch(request);
            if (cachedResponse) return cachedResponse;

            // If no cache hit, fetch from network
            if(LOGGING) console.log('Cache miss, fetching from network for:', request.url);
            return await this.fetch(request, cache_override ?? await this.file_manager.should_cache_file(request.url));
        } catch (error) {
            this.handle_error(error);
            // Always return a valid Response
            return new Response('Network Error', { 
                status: 503, 
                statusText: 'Service Unavailable' 
            });
        }
    }

    async network_first_fetch(request, cache_override = null) {
        try {
            const response = await this.fetch(request, cache_override ?? await this.file_manager.should_cache_file(request));
            if (response && response.ok) {
                return response;
            }
            // If network fetch failed, try cache
            if(LOGGING) console.warn('Network fetch failed, trying cache for:', request.url);
            const cachedResponse = await this.file_manager.cache_fetch(request);
            if (cachedResponse) return cachedResponse;

            return response; // return the failed response
        } catch (error) {
            this.handle_error(error);
            
            // Network is completely offline, try cache as fallback
            const cachedResponse = await this.file_manager.cache_fetch(request);
            if (cachedResponse) {
                if (LOGGING) console.log('Serving cached response for offline request:', request.url);
                return cachedResponse;
            }
            
            // No cache available, return error
            return new Response('Network Error', { 
                status: 503, 
                statusText: 'Service Unavailable' 
            });
        }
    }

    is_local_url(url) {
        try {
            const parsed_url = new URL(url, self.location.href);
            return parsed_url.origin === self.location.origin;
        } catch (error) {
            this.handle_error(error);
            return false;
        }
    }

    async get_fetch_strategy(url) {
        if (!this.is_local_url(url)) return 'network_first';

        const file = await this.file_manager.get_indexed_file(url.href);
        if (!file) return 'network_first'; // no record
        if(file.status === 'need_update') return 'network_first';
        const classification = this.file_manager.get_file_classification(url.href);

        if (classification <= this.file_manager.file_priority_threshold) return 'network_first';
        return 'cache_first';
    }

    async handle_fetch(request, cache_override = null) {
        try {
            const url = new URL(request.url);
            const strategy = await this.get_fetch_strategy(url);
            if(LOGGING) console.log('Handling fetch for:', request.url, 'with strategy:', strategy);
            
            switch (strategy) {
                case 'no_cache':
                case 'network_first':
                    return await this.network_first_fetch(request, cache_override ?? await this.file_manager.should_cache_file(url));
                case 'cache_first':
                    return await this.cache_first_fetch(request, cache_override);
                default:
                    throw new Error(`Unknown fetch strategy: ${strategy}`);
            }
        } catch (error) {
            this.handle_error(error);
            return new Response('Service Worker Error', { 
                status: 500, 
                statusText: 'Internal Service Worker Error' 
            });
        }
    }

    cache_all_static_files() {
        Promise.all(
            File_Manager.STATIC_FILE_URLS.map((url) => {
                try {
                    // fetch and store
                    const request = new Request(url);
                    this.handle_fetch(request, true);
                } catch (error) {
                    this.handle_error(error);
                }
            })
        )
    }
}

if (LOGGING) console.log('Service Worker script loaded');

const service_worker_instance = new Service_Worker(self);