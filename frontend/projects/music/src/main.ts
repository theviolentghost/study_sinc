import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { isDevMode } from '@angular/core';
import { VersionService } from '../version.service';
import { ServiceWorkerMessageDistributorService } from './service.worker.message.distributor';

const LOGGING_ENABLED = false; 

declare global {
    interface Window {
        needs_update: boolean;
        version_service: VersionService;
        message_distributor: ServiceWorkerMessageDistributorService;
        app_reference: any;
    }
}

async function initialize_app(): Promise<{ version_service: VersionService, app_reference: any, message_distributor: ServiceWorkerMessageDistributorService }> {
    const app_reference = await bootstrapApplication(AppComponent, appConfig)
        .catch((err) => console.error(err));

    if (!app_reference) throw new Error('Failed to bootstrap application');

    const version_service = app_reference.injector.get(VersionService);
    const message_distributor = app_reference.injector.get(ServiceWorkerMessageDistributorService);

    return { version_service, app_reference, message_distributor };
}
window.needs_update = false;

// const CACHE_NAME_PREFIX = 'sinc_music';
// const VERSION_URL = '/music/app/version.txt';
// let CURRENT_CACHE_NAME = `${CACHE_NAME_PREFIX}_v1`;

// ✨ Bootstrap app immediately - don't wait for anything
(async () => {
    const { version_service, app_reference, message_distributor } = await initialize_app();
    window.version_service = version_service;
    window.app_reference = app_reference;
    window.message_distributor = message_distributor;
    
    if (LOGGING_ENABLED) console.log('✅ App bootstrapped and ready');
})();

// Register service worker and check for updates in the background
if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('/music/sw.js', {
                scope: '/music/' 
            });

            registration.onupdatefound = () => {
                const installingWorker = registration.installing;
                if (installingWorker) {
                    installingWorker.onstatechange = () => {
                        if (installingWorker.state === 'installed') {
                            if (navigator.serviceWorker.controller) {
                                // New update available
                                window.needs_update = true;
                                if (LOGGING_ENABLED) console.log('🔄 New service worker update found');
                            } else {
                                // First install
                                if (LOGGING_ENABLED) console.log('✅ Service worker installed for the first time');
                            }
                        }
                    };
                }
            };
            
            // console.log('SW registered: ', registration);

            // Listen for messages from service worker
            window.message_distributor.initialize();
            window.message_distributor.post_message('CHECK_FOR_APP_UPDATE', {});

            // Check for updates in the background (non-blocking)
            // check_for_updates_background(stored_version);
            
        } catch (registration_error) {
            console.error('SW registration failed: ', registration_error );
        }
    });
}

// async function handle_update_notification(payload: any) {
//     const { stored_version, server_version, update_type } = payload;
//
//     if (!window.app_reference) {
//         if (LOGGING_ENABLED) console.warn('App reference not ready yet');
//         return;
//     }
    
//     // Get notification service from the app
//     const notification_service = window.app_reference.injector.get(
//         await import('./app/services/notification.service').then(m => m.NotificationService)
//     );
    
//     // Show notification with update button
//     notification_service.info(
//         `New version ${server_version} available (current: ${stored_version})`,
//         {
//             autoDismiss: false,
//             actions: [
//                 {
//                     label: 'Update Now',
//                     callback: () => {
//                         if (LOGGING_ENABLED) console.log('🔄 User requested update');
//                         window.location.reload();
//                     }
//                 },
//                 {
//                     label: 'Later',
//                     callback: () => {
//                         if (LOGGING_ENABLED) console.log('⏰ User deferred update');
//                     }
//                 }
//             ]
//         }
//     );
    
//     // Set version flags
//     window.version_service.minor_outdated = update_type === 'minor' || update_type === 'major';
//     window.version_service.major_outdated = update_type === 'major';
// }

// async function check_for_updates_background(stored_version: string) {
//     try {
//         if (!stored_version || stored_version === '0.0.0') {
//             if (LOGGING_ENABLED) console.log('First visit, skipping update check');
//             return;
//         }
        
//         // Fetch server version with cache busting
//         if (LOGGING_ENABLED) console.log('🔍 Checking for updates in background...');
//         const server_version_response = await fetch(VERSION_URL, { cache: 'no-cache' });
        
//         if (!server_version_response.ok) {
//             throw new Error(`Failed to fetch version.txt: ${server_version_response.status}`);
//         }

//         const server_version = (await server_version_response.text()).trim().toLowerCase();
        
//         if (!server_version || server_version === stored_version) {
//             if (LOGGING_ENABLED) console.log('✅ App is up to date');
//             return;
//         }

//         // Version mismatch - determine update type
//         const { minor, major, update_type } = version_update_severity(stored_version, server_version);
        
//         if (LOGGING_ENABLED) console.log(`🔄 Update available: ${stored_version} → ${server_version} (${update_type})`);
        
//         // Post message to self to trigger notification
//         handle_update_notification({
//             stored_version,
//             server_version,
//             update_type
//         });
        
//     } catch (error) {
//         if (LOGGING_ENABLED) console.error('❌ Error checking for updates:', error);
//     }
// }



// function version_update_severity(stored_version: string, server_version: string): { minor: boolean, major: boolean, update_type: string } {
//     const stored_parts = stored_version.split('.').map(Number);
//     const server_parts = server_version.split('.').map(Number);

//     if (stored_parts.length !== 3 || server_parts.length !== 3) {
//         if (LOGGING_ENABLED) console.error('Invalid version format:', stored_version, server_version);
//         return { minor: false, major: false, update_type: 'none' };
//     }

//     // Compare major versions
//     if (server_parts[0] > stored_parts[0]) {
//         return { minor: false, major: true, update_type: 'major' }; // Major update
//     }
//     if (server_parts[0] === stored_parts[0]) {
//         // Compare minor versions
//         if (server_parts[1] > stored_parts[1]) {
//             return { minor: true, major: false, update_type: 'minor' }; // Minor update
//         }
//         if (server_parts[1] === stored_parts[1]) {
//             // Compare patch versions
//             if (server_parts[2] > stored_parts[2]) {
//                 return { minor: false, major: false, update_type: 'tiny' }; // Patch update
//             }
//         }
//     }

//     // No update needed
//     return { minor: false, major: false, update_type: 'none' };
// }
