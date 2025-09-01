import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { isDevMode } from '@angular/core';
import { VersionService } from '../version.service';

const LOGGING_ENABLED = false; 

declare global {
    interface Window {
        needs_update: boolean;
        version_service: VersionService;
        app_reference: any;
    }
}

async function initialize_app(): Promise<{ version_service: VersionService, app_reference: any }> {
    const app_reference = await bootstrapApplication(AppComponent, appConfig)
        .catch((err) => console.error(err));

    if (!app_reference) throw new Error('Failed to bootstrap application');

    const version_service = app_reference.injector.get(VersionService);

    return { version_service, app_reference };
}
window.needs_update = false;

const CACHE_NAME_PREFIX = 'sinc_music';
const VERSION_URL = '/music/app/version.txt';
let CURRENT_CACHE_NAME = `${CACHE_NAME_PREFIX}_v1`;


// Register service worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        const { version_service, app_reference } = await initialize_app();
        window.version_service = version_service;
        window.app_reference = app_reference;   

        navigator.serviceWorker.register('/music/sw.js', {
            scope: '/music/' 
        })
            .then(async (registration) => {
                console.log('SW registered: ', registration);

                // Listen for messages from service worker
                navigator.serviceWorker.addEventListener('message', (event) => {
                    const { type, payload } = event.data;
                    
                    switch(type) {
                        case 'update_stored_version':
                            if (LOGGING_ENABLED) console.log('Received update_stored_version message:', payload);
                            if (payload && payload.version) {
                                window.version_service.version = payload.version.trim().toLowerCase();
                                if (LOGGING_ENABLED) console.log('Updated version:', window.version_service.version);
                            }
                            break;
                    }
                });

                const cache = await caches.open(CURRENT_CACHE_NAME);
                const stored_version_response = await cache.match(VERSION_URL);
                const stored_version = stored_version_response ?
                    (await stored_version_response.text()).trim().toLowerCase() :
                    '0.0.0'; // Default version if not found
                window.version_service.version = stored_version;
                if (LOGGING_ENABLED) console.log(window.version_service.version);
                if (LOGGING_ENABLED) console.log(stored_version);

                const should_update = await should_update_app(stored_version);
                if (LOGGING_ENABLED) console.log('🔄 Update check complete, should update:', should_update);
                window.needs_update = should_update;

                // refresh the app if needed
                if (should_update) window.location.reload();
                    
                
            })
            .catch((registrationError) => {
                console.log('SW registration failed: ', registrationError);
            });
    });
}

async function should_update_app(stored_version: string): Promise<boolean> {
    try {
        if(!stored_version || stored_version === '0.0.0') {
            if (LOGGING_ENABLED) console.warn('No stored version found, assuming first visit');
            // If no stored version, assume first visit and always prompt for update
            return false; // Do not prompt for update on first visit, or cause infinte loop
        }
        // Fetch server version with cache busting
        if (LOGGING_ENABLED) console.log('Checking server version...');
        const server_version_response = await fetch(VERSION_URL, { cache: 'no-cache' });
        if (!server_version_response.ok) {
            throw new Error(`Failed to fetch version.txt: ${server_version_response.status}`);
        }

        const server_version = (await server_version_response.text()).trim();
        

        if(!server_version) return false;

        // Compare versions
        if (stored_version !== server_version) {
            const { minor, major } = version_update_severity(stored_version, server_version);
            window.version_service.minor_outdated = minor;
            window.version_service.major_outdated = major;

            // Only prompt if there was a previous version (not first visit)
            const should_prompt = stored_version !== null;
            return should_prompt;
        }

        if (LOGGING_ENABLED) console.log('✅ Versions match - no update needed');
        return false;
    } catch (error) {
        if (LOGGING_ENABLED) console.error('❌ Error checking version:', error);
        return false;
    }
}

function version_update_severity(stored_version: string, server_version: string): { minor: boolean, major: boolean } {
    const stored_parts = stored_version.split('.').map(Number);
    const server_parts = server_version.split('.').map(Number);

    if (stored_parts.length !== 3 || server_parts.length !== 3) {
        if (LOGGING_ENABLED) console.error('Invalid version format:', stored_version, server_version);
        return { minor: false, major: false };
    }

    // Compare major versions
    if (server_parts[0] > stored_parts[0]) {
        return { minor: false, major: true }; // Major update
    }
    if (server_parts[0] === stored_parts[0]) {
        // Compare minor versions
        if (server_parts[1] > stored_parts[1]) {
            return { minor: true, major: false }; // Minor update
        }
        if (server_parts[1] === stored_parts[1]) {
            // Compare patch versions
            if (server_parts[2] > stored_parts[2]) {
                return { minor: false, major: false }; // Patch update
            }
        }
    }

    // No update needed
    return { minor: false, major: false };
}
