const CACHE_NAME_PREFIX = 'sinc_music';
const VERSION_URL = '/music/app/version.txt';  
const LOGGING_ENABLED = false;

let CURRENT_CACHE_NAME = `${CACHE_NAME_PREFIX}_v1`;

// Track if we need to notify clients about critical updates
let pending_critical_update = false;

class File_Manager {
    static database_name = 'sinc_music_file_manager';
    static store_name = 'files';

    static STATIC_CACHE_URLS = [
        '/music/',
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
        '/music/audio/constant_noise_30db_1min.mp3',
    ];
    static STATIC_ASSET_DIRECTORIES = [
        '/music/app/'
    ];

    cache_all_static_files() {
        Promise.all(
            File_Manager.STATIC_CACHE_URLS.map(async (url) => {
                try {
                    const response = await fetch(url, { cache: 'no-cache' });
                    if (response.ok) {
                        const cache = await caches.open(CURRENT_CACHE_NAME);
                        await cache.put(url, response.clone());
                        if (LOGGING_ENABLED) console.log('Cached static file:', url);
                        // Store in IndexedDB as 'updated'
                        this.store_file(url, 'updated');
                    } else {
                        throw new Error(`Failed to fetch ${url}: ${response.status}`);
                    }
                } catch (error) {
                    console.warn('Error caching static file:', url, error.message);
                }
            })
        );

        // this.cache_all_static_files_in_directories();
    }

    cache_all_static_files_in_directories() {
        return Promise.all(
            File_Manager.STATIC_ASSET_DIRECTORIES.map(async (directory) => {
                try {
                    const response = await fetch(directory, { cache: 'no-cache' });
                    if (response.ok) {
                        const text = await response.text();
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(text, 'text/html');
                        const links = Array.from(doc.querySelectorAll('a'))
                            .map(a => a.getAttribute('href'))
                            .filter(href => href && !href.startsWith('http') && !href.startsWith('https') && !href.startsWith('//'))
                            .map(href => {
                                if (href.startsWith('/')) return href; // absolute path
                                if (directory.endsWith('/')) return directory + href; // relative to directory
                                return directory + '/' + href; // fallback
                            });
                        await Promise.all(
                            links.map(async (url) => {
                                try {
                                    const fileResponse = await fetch(url, { cache: 'no-cache' });
                                    if (fileResponse.ok) {
                                        const cache = await caches.open(CURRENT_CACHE_NAME);
                                        await cache.put(url, fileResponse.clone());
                                        if (LOGGING_ENABLED) console.log('Cached asset file:', url);
                                        // Store in IndexedDB as 'updated'
                                        this.store_file(url, 'updated');
                                    } else {
                                        throw new Error(`Failed to fetch ${url}: ${fileResponse.status}`);
                                    }
                                } catch (error) {
                                    console.warn('Error caching asset file:', url, error.message);
                                }
                            })
                        );
                    } else {
                        throw new Error(`Failed to fetch directory ${directory}: ${response.status}`);
                    }
                } catch (error) {
                    console.warn('Error processing directory:', directory, error.message);
                }
            })
        );
    }

    open_database() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(File_Manager.database_name, 1);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(File_Manager.store_name)) {
                    const store = db.createObjectStore(File_Manager.store_name, { keyPath: 'url' });

                    store.createIndex('status', 'status', { unique: false });
                    store.createIndex('class', 'class', { unique: false });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // gets the file's type and then returns the classification
    // depending on the files type, we can classify if it needs an update based on the version update scheme:

    // tiny update: (0.0.#) -> highest priority (tiny)
    //      This is for files that are frequently updated, like small assets or configuration files.
    // minor update: (0.#.0) -> medium priority (minor)
    //      This is for files that are updated less frequently, like images or stylesheets.
    // major update: (#.0.0) -> lowest priority (major)
    //      This is for files that are rarely updated, like scripts or libraries. but when they are updated, they are significant changes.
    get_file_classification(url) {
        if (!url) {
            if (LOGGING_ENABLED) console.warn('get_file_classification called with empty URL');
            return 'no_cache'; // Default to no_cache if no URL is provided
        }
        if (LOGGING_ENABLED) console.log('Classifying file:', url);
        const file_extension = url.split('.').pop().toLowerCase();

        const classifications = {
            'js': 'tiny', 
            'ts': 'no cache', // HLS song segments should not be cached
            'm3u8': 'no cache', // HLS playlists should not be cached
            'css': 'tiny', 
            'html': 'tiny', 
            'png': 'minor', 
            'jpg': 'minor',
            'jpeg': 'minor',
            'gif': 'minor',
            'svg': 'minor',
            'json': 'minor',
            'txt': 'tiny',
            'svg': 'minor',
        };

        return classifications[file_extension] || 'tiny'; // Default to tiny if not classified (meaning it is a frequently updated file)
    }

    // if true, then serve cache version first
    is_file_minor_or_major(url) {
        const classification = this.get_file_classification(url.pathname);
        return classification === 'minor' || classification === 'major';
    }

    // status = 'updated' | 'needs_update'
    async store_file(url, status = 'updated') {
        const db = await this.open_database();
        const classification = this.get_file_classification(url.pathname);
        if(classification === 'no cache') {
            if (LOGGING_ENABLED) console.warn('Skipping caching for no cache classification:', url);
            return; // Skip storing files that should not be cached
        }

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(File_Manager.store_name, 'readwrite');
            const store = transaction.objectStore(File_Manager.store_name);

            const record = {
                url: url,
                status: status,
                class: classification, // classify the file based on its type
            };

            const request = store.put(record);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);

            transaction.oncomplete = () => {
                if (LOGGING_ENABLED) console.log('File stored:', url, 'Status:', status);
                db.close();
            }
            transaction.onerror = () => {
                console.error('Transaction error:', transaction.error);
                reject(transaction.error);
            }
        });
    }

    async get_file(url) {
        const db = await this.open_database();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(File_Manager.store_name, 'readonly');
            const store = transaction.objectStore(File_Manager.store_name);
            const request = store.get(url);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);

            transaction.oncomplete = () => {
                if (LOGGING_ENABLED) console.log('File retrieved:', url);
                db.close();
            }
            transaction.onerror = () => {
                console.error('Transaction error:', transaction.error);
                reject(transaction.error);
            }
        });
    }

    async get_all_files_by_status(status) {
        const db = await this.open_database();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(File_Manager.store_name, 'readonly');
            const store = transaction.objectStore(File_Manager.store_name);
            const index = store.index('status');
            const request = index.getAll(status);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);

            transaction.oncomplete = () => {
                if (LOGGING_ENABLED) console.log('Files retrieved by status:', status);
                db.close();
            }
            transaction.onerror = () => {
                console.error('Transaction error:', transaction.error);
                reject(transaction.error);
            }
        });
    }

    async get_all_files_by_classification(classification) {
        const db = await this.open_database();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(File_Manager.store_name, 'readonly');
            const store = transaction.objectStore(File_Manager.store_name);
            const index = store.index('class');
            const request = index.getAll(classification);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);

            transaction.oncomplete = () => {
                if (LOGGING_ENABLED) console.log('Files retrieved by classification:', classification);
                db.close();
            }
            transaction.onerror = () => {
                console.error('Transaction error:', transaction.error);
                reject(transaction.error);
            }
        });
    }

    // Consume a fetch request and check IndexedDB for the file
    // If the file is updated, use the cache strategy: cache_first
    // if file not found or marked as 'needs_update', fetch from network and store in IndexedDB: network_first
    async get_strategy(url) {
        // consume fetch request
        const file = await this.get_file(url.pathname);

        if (file) {
            if (LOGGING_ENABLED) console.log('File found in IndexedDB:', file.url, 'Status:', file.status);
            // If the file is marked as 'needs_update', we can still serve it from cache
            if (file.status === 'needs_update') {
                if (LOGGING_ENABLED) console.log('needs_update status:', file.url);
                return 'network_first';
            }

            if(this.is_file_minor_or_major(url)) {
                return 'cache_first';
            }
        }

        // Default to network_first
        if (LOGGING_ENABLED) console.log('File not found in IndexedDB, proceeding with fetch:', url.pathname);
        return 'network_first';
    }

    async handle_fetch_request(request) {
        const url = new URL(request.url);
        const strategy = await this.get_strategy(url);

        if (LOGGING_ENABLED) console.log('Fetch strategy for', url.pathname, ':', strategy);

        try {
            if (strategy === 'cache_first') return await this.cache_first(request, url);
            else return await this.network_first(request, url); // default to network_first
        } catch (error) {
            // Log the error and return a fallback response
            console.error(`Error in fetch strategy for ${url.pathname}:`, error);
            return new Response('Error fetching resource', {
                status: 500,
                headers: { 'Content-Type': 'text/plain' }
            });
        }
    }

    async network_first(request, url) {
        try {
            const network_response = await fetch(request, { cache: 'no-cache' });
            if (!network_response.ok) throw new Error(`Network response not ok: ${network_response.status}`);

            // Check if this is a critical file (JS files that need reload)
            const is_critical = this.is_critical_file(url);
            
            // Cache successful responses
            const cache = await caches.open(CURRENT_CACHE_NAME);
            await cache.put(request, network_response.clone());
            if (LOGGING_ENABLED) console.log('Served from network and cached:', url);

            // Store in IndexedDB
            this.store_file(url.pathname, 'updated');

            // Clean up old versions of hashed files (Angular build files with hash in filename)
            if (this.is_hashed_file(url.pathname)) {
                await this.cleanup_old_hashed_files(url.pathname);
            }

            // If this is a critical JS file update, notify clients to reload
            if (is_critical) {
                pending_critical_update = true;
                this.notify_clients_critical_update();
            }

            return network_response; // Return the network response directly
        } catch (error) {
            // last resort, try to serve from cache
            const cached_response = await caches.match(request);
            if (!cached_response) throw new Error(`Network first strategy failed for "${url.pathname}": ${error.message}`);
            if (LOGGING_ENABLED) console.warn('Served from cache (network_first):', url.pathname);
            return cached_response;
        }
    }

    async cache_first(request, url) {
        try {
            const cached_response = await caches.match(request);
            if (cached_response) {
                if (LOGGING_ENABLED) console.log('🌐 Served from cache (cache_first):', url.pathname);
                return cached_response;
            }

            // not in cache, try network
            return await this.network_first(request, url);
        } catch (error) {
            throw new Error(`Cache first strategy failed for "${url.pathname}": ${error.message}`);
        }
    }

    async update_all_files_status_by_version_update(update_type) {
        if(update_type === 'tiny') {
            // update all files marked as 'updated' to 'needs_update'
            const files = await this.get_all_files_by_classification('tiny');
            for (const file of files) {
                await this.store_file(file.url, 'needs_update');
                if (LOGGING_ENABLED) console.log(`Updated file status to 'needs_update': ${file.url}`);
            }
        }
        else if(update_type === 'minor') {
            // update all files marked as 'updated' to 'needs_update'
            const files = [...(await this.get_all_files_by_classification('minor')), ...(await this.get_all_files_by_classification('tiny'))];
            for (const file of files) {
                await this.store_file(file.url, 'needs_update');
                if (LOGGING_ENABLED) console.log(`Updated file status to 'needs_update': ${file.url}`);
            }
        } 
        else if(update_type === 'major') {
            // CLEAR ALL FILES
            const files = await this.get_all_files_by_status('updated');
            for (const file of files) {
                await this.store_file(file.url, 'needs_update');
                if (LOGGING_ENABLED) console.log(`Updated file status to 'needs_update': ${file.url}`);
            }
        }
        else if (update_type === 'full') {
            // CLEAR CACHE AND DATABASE
            if( LOGGING_ENABLED) console.warn('Clearing all files in IndexedDB');
        }

        // For any version update, notify clients that a reload may be needed
        pending_critical_update = true;
        this.notify_clients_critical_update();
    }











    // Notify clients about critical updates that require reload
    async notify_clients_critical_update() {
        try {
            if (self.clients && self.clients.matchAll) {
                const clients = await self.clients.matchAll({ type: 'window' });
                clients.forEach(client => {
                    if (LOGGING_ENABLED) console.log('Notifying client of critical update');
                    client.postMessage({
                        type: 'critical_update_available',
                        payload: {
                            message: 'A critical update is available that requires a reload.',
                            requires_reload: true
                        }
                    });
                });
            }
        } catch (error) {
            console.error('Error notifying clients of critical update:', error);
        }
    }

    get_version_update_type(current_version, server_version) {
        const current_parts = current_version.split('.').map(Number);
        const server_parts = server_version.split('.').map(Number);

        if (server_parts[0] > current_parts[0]) return 'major'; // Major update
        if (server_parts[1] > current_parts[1]) return 'minor'; // Minor update
        if (server_parts[2] > current_parts[2]) return 'tiny'; // Tiny update

        return null; // No update needed
    }

    // Check if a file is critical (JS files that require full reload)
    is_critical_file(url) {
        const pathname = typeof url === 'string' ? url : url.pathname;
        
        // Angular critical files that require reload
        const critical_patterns = [
            'main.',           // Angular main bundle
            'polyfills.',      // Polyfills bundle
            'runtime.',        // Angular runtime
            'vendor.',         // Vendor libraries
            'chunk-',          // Lazy-loaded chunks
            'scripts.'         // Additional scripts
        ];
        
        // Must be a JavaScript file and match critical patterns
        if (!pathname.endsWith('.js')) return false;
        
        return critical_patterns.some(pattern => pathname.includes(pattern));
    }

    async check_and_notify_critical_updates() {
        const db = await this.open_database();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(File_Manager.store_name, 'readonly');
            const store = transaction.objectStore(File_Manager.store_name);
            const index = store.index('status');
            const request = index.getAll('updated');
            request.onsuccess = () => {
                const files = request.result;
                const critical_files = files.filter(file => this.is_critical_file(file.url));
                
                if (critical_files.length > 0) {
                    pending_critical_update = true;
                    if (LOGGING_ENABLED) console.log('Pending critical update for files:', critical_files);
                }
                
                resolve(request.result);
            };
            request.onerror = () => reject(request.error);

            transaction.oncomplete = () => {
                if (LOGGING_ENABLED) console.log('Checked for critical updates');
                db.close();
            }
            transaction.onerror = () => {
                console.error('Transaction error:', transaction.error);
                reject(transaction.error);
            }
        });
    }

    // Check if a file is a hashed build file (e.g., main-ABCD1234.js, polyfills-WXYZ5678.js)
    is_hashed_file(pathname) {
        const filename = pathname.split('/').pop();
        // Match Angular hashed files: name-HASH.extension
        const hashed_pattern = /^(main|polyfills|runtime|vendor|scripts|chunk-|styles)-[A-Z0-9]{8,}\.(js|css)$/i;
        return hashed_pattern.test(filename);
    }

    // Get the base name from a hashed file (e.g., "main" from "main-ABCD1234.js")
    get_hashed_file_base(pathname) {
        const filename = pathname.split('/').pop();
        const match = filename.match(/^(main|polyfills|runtime|vendor|scripts|chunk-\w+|styles)-[A-Z0-9]{8,}\.(js|css)$/i);
        if (match) {
            return match[1]; // Return the base name (e.g., "main", "polyfills")
        }
        return null;
    }

    // Clean up old versions of hashed files, keeping only the newest one
    async cleanup_old_hashed_files(new_pathname) {
        try {
            const base_name = this.get_hashed_file_base(new_pathname);
            if (!base_name) return;

            const cache = await caches.open(CURRENT_CACHE_NAME);
            const cached_keys = await cache.keys();
            
            // Find all cached files with the same base name
            const old_versions = cached_keys.filter(request => {
                const url = new URL(request.url);
                if (url.pathname === new_pathname) return false; // Don't delete the new version
                
                const cached_base = this.get_hashed_file_base(url.pathname);
                return cached_base === base_name;
            });

            // Delete old versions from cache
            for (const request of old_versions) {
                const url = new URL(request.url);
                await cache.delete(request);
                if (LOGGING_ENABLED) console.log('🗑️ Deleted old hashed file from cache:', url.pathname);
                
                // Also delete from IndexedDB
                await this.delete_file(url.pathname);
            }

            if (old_versions.length > 0) {
                console.log(`🧹 Cleaned up ${old_versions.length} old version(s) of ${base_name}`);
            }
        } catch (error) {
            console.error('Error cleaning up old hashed files:', error);
        }
    }

    // Delete a file from IndexedDB
    async delete_file(url) {
        try {
            const db = await this.open_database();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(File_Manager.store_name, 'readwrite');
                const store = transaction.objectStore(File_Manager.store_name);
                const request = store.delete(url);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);

                transaction.oncomplete = () => {
                    if (LOGGING_ENABLED) console.log('File deleted from IndexedDB:', url);
                    db.close();
                }
                transaction.onerror = () => {
                    console.error('Transaction error:', transaction.error);
                    reject(transaction.error);
                }
            });
        } catch (error) {
            console.warn('Error deleting file from IndexedDB:', error);
        }
    }
}

const file_manager = new File_Manager();

// Install event - check version and cache accordingly
self.addEventListener('install', (event) => {
    if(LOGGING_ENABLED) console.log('installing sw...');
    event.waitUntil(
        check_version_and_cache()
            .then(() => {
                if(LOGGING_ENABLED) console.log('sw installed');
                return self.skipWaiting();
            })
            .catch(error => {
                console.error('sw installation failed:', error);
                return self.skipWaiting();
            })
    )
});

// Activate event
self.addEventListener('activate', event => {
    event.waitUntil(
        (async () => {
            // Take control of all clients immediately
            await self.clients.claim();
            
            // ✅ Send cached version to all clients after activation
            await send_version_to_clients();

            // If there was a critical update, notify clients to reload
            if (pending_critical_update) {
                file_manager.notify_clients_critical_update();
            }
        })()
    );
});

// ✅ Function to send the current cached version to all clients
async function send_version_to_clients() {
    try {
        if (self.clients && self.clients.matchAll) {
            const clients = await self.clients.matchAll({ type: 'window' });
            if (clients.length > 0) {
                // Get the cached version
                const cache = await caches.open(CURRENT_CACHE_NAME);
                const cached_version_response = await cache.match(VERSION_URL);
                
                if (cached_version_response) {
                    const cached_version = (await cached_version_response.text()).trim().toLowerCase();
                    if(LOGGING_ENABLED) console.log('Sending cached version to clients:', cached_version);
                    
                    clients.forEach(client => {
                        if(LOGGING_ENABLED) console.log('Posting version message to client');
                        client.postMessage({
                            type: 'update_stored_version',
                            payload: {
                                version: cached_version,
                            }
                        });
                    });
                } else {
                    if(LOGGING_ENABLED) console.log('No cached version found to send to clients');
                }
            } else {
                if(LOGGING_ENABLED) console.log('No clients found to send version to');
            }
        }
    } catch (error) {
        console.error('Error sending version to clients:', error);
    }
}

async function check_version_and_cache() {
    try {
        const cache = await caches.open(CURRENT_CACHE_NAME);
        const stored_version_response = await cache.match(VERSION_URL);
        const stored_version = stored_version_response ?
            (await stored_version_response.text()).trim().toLowerCase() :
            '0.0.0'; // Default version if not found

        if(LOGGING_ENABLED) console.log('Stored version:', stored_version);

        // Fetch the current version from the server
        let server_version = null;
        try {
            const response = await fetch(VERSION_URL, {
                cache: 'no-cache',
                headers: { 'Cache-Control': 'no-cache' }
            });
            if (response.ok) {
                server_version = (await response.text()).trim().toLowerCase();
                if(LOGGING_ENABLED) console.log('Server version:', server_version);
                
                // ✅ Cache the server version immediately
                const cache = await caches.open(CURRENT_CACHE_NAME);
                await cache.put(VERSION_URL, new Response(server_version, { 
                    headers: { 'Content-Type': 'text/plain' } 
                }));
                if(LOGGING_ENABLED) console.log('Cached server version:', server_version);
                
            } else {
                throw new Error(`${response.status}`);
            }
        } catch (error) {
            console.warn('Could not fetch server version:', error.message);
        }

        // compare versions
        if (server_version && server_version !== stored_version) {
            // version mismatch - update cache
            const update_type = file_manager.get_version_update_type(stored_version, server_version);
            if(LOGGING_ENABLED) console.log('Version update detected:', stored_version, '->', server_version, 'Type:', update_type);
            
            file_manager.update_all_files_status_by_version_update(update_type);
            
            // For any version change, we should consider it critical since Angular apps
            // can have breaking changes even in minor updates
            pending_critical_update = true;
        } else {
            // version match or no server version available (use existing cache)
            console.log(server_version ? 'Version match, using existing cache' : 'No server version available, using existing cache');
        }

    } catch (error) {
        console.error('Error during version check and cache update:', error);
        throw error; // Rethrow to let the install event handle it
    }
}

// async function update_cache(new_version) {
//     try {
//         // first update the local cache version
//         let cache = await caches.open(CURRENT_CACHE_NAME);
//         await cache.put(VERSION_URL, new Response(new_version, { headers: { 'Content-Type': 'text/plain' } }));
//         if(LOGGING_ENABLED) console.log('Updated local version to:', new_version);

//         // then update the cache with static files
//         if(LOGGING_ENABLED) console.log('static files');
//         const static_files_promises = STATIC_CACHE_URLS.map(async (url) => {
//             try {
//                 const response = await fetch(url, { cache: 'no-cache' });
//                 if (response.ok) {
//                     await cache.put(url, response.clone());
//                     if(LOGGING_ENABLED) console.log('Cached:', url);
//                 } else {
//                     throw new Error(`Failed to fetch ${url}: ${response.status}`);
//                 }
//             } catch (error) {
//                 console.warn('Error caching:', url, error.message);
//             }
//         });

//         await Promise.allSettled(static_files_promises);
//         if(LOGGING_ENABLED) console.log('Static files cached');

//     } catch (error) {
//         console.error('Error updating cache:', error);
//         throw error; // Rethrow to let the install event handle it
//     }
// }

// Clean up old caches
// async function cleanupOldCaches() {
//   const cacheNames = await caches.keys();
//   const deletionPromises = cacheNames
//     .filter(name => name.startsWith(CACHE_NAME_PREFIX) && name !== CURRENT_CACHE_NAME)
//     .map(name => {
//       console.log('🗑️ Deleting old cache:', name);
//       return caches.delete(name);
//     });
  
//   await Promise.all(deletionPromises);
// }

// Fetch event - serve from cache with network fallback
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') return;

    // Skip external requests (YouTube thumbnails, Spotify images, etc.)
    // Only intercept requests from our own origin
    const is_same_origin = url.origin === self.location.origin;
    const is_music_path = url.pathname.startsWith('/music/');
    
    if (!is_same_origin || !is_music_path) {
        // Let external requests pass through - browser's HTTP cache will handle them
        if (LOGGING_ENABLED) console.log('⏭️ Skipping service worker cache for external/non-music resource:', url.href);
        return;
    }

    // Handle version.txt requests specially
    if (url.pathname === VERSION_URL) {
        event.respondWith(handle_version_request(request));
        return;
    }

    // For all other local requests, use our caching strategy
    event.respondWith(
        file_manager.handle_fetch_request(request)
    );
});


// Handle version.txt requests - cache first for regular requests
async function handle_version_request(request) {
    try {
        const network_response = await fetch(request, { cache: 'no-cache' });
        if (network_response.ok) {
            // Clone the response before consuming its body
            const response_clone = network_response.clone();
            const version_text = await response_clone.text();
            const cache = await caches.open(CURRENT_CACHE_NAME);
            await cache.put(VERSION_URL, new Response(version_text, { headers: { 'Content-Type': 'text/plain' } }));

            // ✅ Send message to clients to update version
            if (self.clients && self.clients.matchAll) {
                const clients = await self.clients.matchAll({ type: 'window' });
                clients.forEach(client => {
                    if(LOGGING_ENABLED) console.log('Sending version update to client:', version_text.trim().toLowerCase());
                    client.postMessage({
                        type: 'update_stored_version',
                        payload: {
                            version: version_text.trim().toLowerCase(),
                        }
                    });
                });
            }
            
            if(LOGGING_ENABLED) console.log('🌐 Served version from network and stored');
            // Return a new response with the version text to avoid body lock issues
            return new Response(version_text, { 
                status: network_response.status,
                statusText: network_response.statusText,
                headers: network_response.headers 
            });
        }
    } catch (error) {
        console.warn('⚠️ Network failed for version check:', error.message);
    }
  
    // ✅ If network fails, try to serve from cache and still send to clients
    try {
        const cache = await caches.open(CURRENT_CACHE_NAME);
        const cached_response = await cache.match(VERSION_URL);
        if (cached_response) {
            const cached_version = await cached_response.text();
            
            // Send cached version to clients
            if (self.clients && self.clients.matchAll) {
                const clients = await self.clients.matchAll({ type: 'window' });
                clients.forEach(client => {
                    if(LOGGING_ENABLED) console.log('Sending cached version to client:', cached_version.trim().toLowerCase());
                    client.postMessage({
                        type: 'update_stored_version',
                        payload: {
                            version: cached_version.trim().toLowerCase(),
                        }
                    });
                });
            }
            
            if(LOGGING_ENABLED) console.log('📦 Served version from cache');
            return new Response(cached_version, { 
                headers: { 'Content-Type': 'text/plain' }
            });
        }
    } catch (cache_error) {
        console.warn('⚠️ Cache failed for version check:', cache_error.message);
    }
  
    // Fallback response if both network and cache fail
    return new Response('0.0.0', { 
        headers: { 'Content-Type': 'text/plain' }
    });
}

// async function handle_fetch_request(request) {
//     try {
//         const url = new URL(request.url);

//         if(LOGGING_ENABLED) console.log('🔍 Fetching:', url.pathname);

//         // Check cache first
//         const cached_response = await caches.match(request);
//         if (cached_response) {
//             if(LOGGING_ENABLED) console.log('📦 Served from cache:', url.pathname);
//             return cached_response;
//         }

//         // not in cache, try network
//         try {
//             const network_response = await fetch(request, { cache: 'no-cache' });
//             if (network_response.ok) {
//                 // Cache successful responses
//                 const cache = await caches.open(CURRENT_CACHE_NAME);
//                 cache.put(request, network_response.clone());
//                 if(LOGGING_ENABLED) console.log('🌐 Served from network and cached:', url.pathname);
//                 return network_response;
//             } else {
//                 throw new Error(`Network response not ok: ${network_response.status}`);
//             }
//         } catch (network_error) {
//             // Network failed, try cache again
//             const fallback_response = await caches.match(request);
//             if (fallback_response) {
//                 if(LOGGING_ENABLED) console.log('📦 Served fallback from cache:', url.pathname);
//                 return fallback_response;
//             }
//             // Optionally, serve a custom offline page
//             if (url.pathname === '/music/' || url.pathname === '/music/index.html') {
//                 return new Response('<h1>Offline</h1><p>The app is offline and the server is unreachable.</p>', {
//                     headers: { 'Content-Type': 'text/html' }
//                 });
//             }
//             // Otherwise, return a generic offline response
//             return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
//         }

//         // If we reach here, it means both cache and network failed
//     } catch (error) {
//         console.error('Fetch error:', error);
//     }
// }

// Message handler for cache management
self.addEventListener('message', (event) => {
  if (!event.data) return;
  
  const { type, payload } = event.data;

  console.log('🔧 Service Worker received message:', type, payload);
  
  switch(type) {
    case "GET_VERSION":
      event.waitUntil(
        (async () => {
          try {
            const cache = await caches.open(CURRENT_CACHE_NAME);
            const cached_version_response = await cache.match(VERSION_URL);
            let current_version = '0.0.0';
            
            if (cached_version_response) {
              current_version = (await cached_version_response.text()).trim().toLowerCase();
            }
            
            if (event.source && event.source.postMessage) {
              event.source.postMessage({
                type: "update_stored_version",
                payload: {
                  version: current_version
                }
              });
            }
          } catch (error) {
            console.error('❌ Get version failed:', error);
          }
        })()
      );
      break;

    case "SKIP_WAITING":
      // Force the service worker to become active immediately
      event.waitUntil(
        (async () => {
          try {
            await self.skipWaiting();
            pending_critical_update = false;
            if (LOGGING_ENABLED) console.log('Service worker skipped waiting');
          } catch (error) {
            console.error('❌ Skip waiting failed:', error);
          }
        })()
      );
      break;

    case "CHECK_CRITICAL_UPDATE":
      // Check if there's a pending critical update
      if (event.source && event.source.postMessage) {
        event.source.postMessage({
          type: "critical_update_status",
          payload: {
            has_critical_update: pending_critical_update
          }
        });
      }
      break;

    case "CLEANUP_OLD_HASHED_FILES":
      // Manually trigger cleanup of all old hashed files
      event.waitUntil(
        (async () => {
          try {
            const cache = await caches.open(CURRENT_CACHE_NAME);
            const cached_keys = await cache.keys();
            
            // Group files by their base name
            const file_groups = new Map();
            
            for (const request of cached_keys) {
              const url = new URL(request.url);
              if (file_manager.is_hashed_file(url.pathname)) {
                const base_name = file_manager.get_hashed_file_base(url.pathname);
                if (!file_groups.has(base_name)) {
                  file_groups.set(base_name, []);
                }
                file_groups.get(base_name).push({ request, url, pathname: url.pathname });
              }
            }
            
            let total_deleted = 0;
            
            // For each group, keep only the most recent one (last in array) and delete the rest
            for (const [base_name, files] of file_groups) {
              if (files.length > 1) {
                // Sort by pathname to ensure consistent ordering
                files.sort((a, b) => a.pathname.localeCompare(b.pathname));
                
                // Keep the last one, delete all others
                for (let i = 0; i < files.length - 1; i++) {
                  const file = files[i];
                  await cache.delete(file.request);
                  await file_manager.delete_file(file.pathname);
                  total_deleted++;
                  if (LOGGING_ENABLED) console.log('🗑️ Deleted old hashed file:', file.pathname);
                }
              }
            }
            
            console.log(`🧹 Cleanup complete: Deleted ${total_deleted} old hashed file(s)`);
            
            if (event.source && event.source.postMessage) {
              event.source.postMessage({
                type: "cleanup_complete",
                payload: {
                  deleted_count: total_deleted
                }
              });
            }
          } catch (error) {
            console.error('❌ Cleanup failed:', error);
            if (event.source && event.source.postMessage) {
              event.source.postMessage({
                type: "cleanup_error",
                payload: {
                  error: error.message
                }
              });
            }
          }
        })()
      );
      break;
      
    default:
      return;
  }
});

console.log('✅ Service Worker loaded successfully');