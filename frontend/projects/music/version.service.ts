import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { ServiceWorkerMessageDistributorService, AppVersionMessage } from './src/service.worker.message.distributor';
import { NotificationService } from './notification.service';

@Injectable({
  providedIn: 'root'
})
export class VersionService {
    private _version: string = '0.0.0';
    private _server_version: string = '0.0.0';
    private _service_worker_version: string = '0.0.0';
    private _minor_outdated: boolean = false; // is app minor outdated? (0.0.0 -> 0.1.0) or (0.0.0 -> 0.0.1)
    private _major_outdated: boolean = false; // is app major outdated? (0.0.0 -> 1.0.0) or (0.0.0 -> 0.1.0)

    constructor(
        private sw_message_distributor: ServiceWorkerMessageDistributorService,
        private notification_service: NotificationService
    ) {
        this.sw_message_distributor.app_version.subscribe(this.handle_app_version_message.bind(this));
    }

    private handle_app_version_message(payload: AppVersionMessage) {
        const { cached_version, latest_version, should_update, update_type, service_worker_version } = payload;
        this._version = cached_version;
        this._server_version = latest_version;
        this._service_worker_version = service_worker_version;

        if(should_update) {
            switch(update_type) {
                // @ts-ignore
                case 'major':
                    this._major_outdated = true;
                case 'minor':
                    this._minor_outdated = true;
                    this.notification_service.info(
                        `New update available`,
                        {
                            details: `Update ${this._version} to ${this._server_version}`,
                            autoDismiss: false,
                            actions: [
                                {
                                    label: 'Update Now',
                                    callback: () => {
                                        window.location.reload();
                                    },
                                    icon: 'check.svg'
                                },
                                {
                                    label: 'Later',
                                    callback: () => {
                                        // Do nothing
                                    },
                                    icon: 'x.svg'
                                }
                            ],
                            hideStackCount: true
                        }
                    );
                    break;
                case 'patch':
                    // this.notification_service.info(`Patch update available: ${latest_version} (current: ${cached_version})`);
                    // break;
                case 'none':
                    break;
            }
        }
    }

    get version(): string {
        return this._version;
    }
    get server_version(): string {
        return this._server_version;
    }
    get service_worker_version(): string {
        return this._service_worker_version;
    }
    set minor_outdated(value: boolean) {
        this._minor_outdated = value;
    }
    get minor_outdated(): boolean {
        return this._minor_outdated;
    }
    set major_outdated(value: boolean) {
        this._major_outdated = value;
    }
    get major_outdated(): boolean {
        return this._major_outdated;
    }
}
