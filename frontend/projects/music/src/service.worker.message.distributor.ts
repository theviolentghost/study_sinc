import { Injectable } from '@angular/core';
import { Output, EventEmitter } from '@angular/core';

export interface ServiceWorkerMessage {
    type: string;
    payload?: any;
}
export interface AppVersionMessage {
    cached_version: string;
    latest_version: string;
    should_update: boolean;
    update_type: 'major' | 'minor' | 'patch' | 'none';
    service_worker_version: string;
}

@Injectable({
  providedIn: 'root'
})
export class ServiceWorkerMessageDistributorService {
    @Output() message: EventEmitter<ServiceWorkerMessage> = new EventEmitter<ServiceWorkerMessage>();
    @Output() app_version: EventEmitter<AppVersionMessage> = new EventEmitter<AppVersionMessage>();
    @Output() session_request: EventEmitter<string> = new EventEmitter<string>();

    constructor() {
        this.initialize();
    }

    initialize(): void {
        if (!('serviceWorker' in navigator)) return;

        // console.log('SW message registration successfully');

        navigator.serviceWorker.addEventListener('message', this.handle_message.bind(this));
    }

    private handle_message(event: MessageEvent): void {
        const { type, payload } = event.data;

        // console.log('Service Worker Distributor Message received:', type, payload);

        switch (type) {
            case 'APP_VERSION':
                this.app_version.emit({
                    cached_version: payload?.cached_version,
                    latest_version: payload?.latest_version,
                    should_update: payload?.should_update,
                    update_type: payload?.update_type,
                    service_worker_version: payload?.service_worker_version,
                });
                break;
            case 'SESSION_REQUEST':
                this.session_request.emit(payload?.url);
                break;
            default:
                this.message.emit({ type, payload });
                break;
        }
    }

    public post_message(type: string, payload?: any): void {
        if (!navigator.serviceWorker.controller) {
            console.warn('No active service worker to send message to');
            return;
        }

        navigator.serviceWorker.controller.postMessage({ type, payload });
    }
}