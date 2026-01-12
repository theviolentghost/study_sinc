import { ApplicationConfig, provideZoneChangeDetection, inject } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors, HTTP_INTERCEPTORS, HttpInterceptorFn } from '@angular/common/http';
import { AuthInterceptor } from '../../../../src/app/auth.interceptor';
import { SessionPlaylistInterceptorService } from '../../media.player/http.interceptor.service';
import { provideAnimations } from '@angular/platform-browser/animations';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
    providers: [
        provideZoneChangeDetection({ eventCoalescing: true }),
        provideRouter(routes),
        provideHttpClient(
            withInterceptors([])
        ),
        provideAnimations(),
        // Traditional interceptor registration for AuthInterceptor
        { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
        // Make sure SessionPlaylistInterceptorService is available
        SessionPlaylistInterceptorService,
        // Removed Angular service worker - using custom sw.js instead
    ]
};
