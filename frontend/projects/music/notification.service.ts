import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface Notification {
    message: string;
    visible: boolean;
}

@Injectable({
    providedIn: 'root'
})
export class NotificationService {
    private notification_subject = new BehaviorSubject<Notification>({ message: '', visible: false });
    public notification$ = this.notification_subject.asObservable();
    
    private notification_timeout?: number;
    private hide_timeout?: number;

    show_notification(message: string, duration: number = 3000): void {
        // Clear any existing timeouts
        if (this.notification_timeout) {
            clearTimeout(this.notification_timeout);
        }
        if (this.hide_timeout) {
            clearTimeout(this.hide_timeout);
        }

        // Show notification with push animation
        this.notification_subject.next({ message, visible: true });

        // Auto-hide after duration
        this.notification_timeout = window.setTimeout(() => {
            this.hide_notification();
        }, duration);
    }

    hide_notification(): void {
        this.notification_subject.next({ 
            message: this.notification_subject.value.message, 
            visible: false 
        });

        // Clear message after animation completes
        this.hide_timeout = window.setTimeout(() => {
            this.notification_subject.next({ message: '', visible: false });
        }, 300); // Match animation duration
    }
}
