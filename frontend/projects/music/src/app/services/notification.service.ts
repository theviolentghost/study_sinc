import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export enum NotificationType {
    INFO = 'info',
    WARNING = 'warning',
    ERROR = 'error'
}

export interface NotificationAction {
    label: string;
    callback: () => void;
    icon?: string;
}

export interface Notification {
    id: string;
    type: NotificationType;
    message: string;
    icon?: string;
    timestamp: number;
    stackable: boolean;
    stackCount: number;
    stackedMessages: string[];
    actions?: NotificationAction[];
    autoDismiss?: boolean;
    dismissTime?: number;
    details?: string;
    hideStackCount?: boolean;
}

export interface NotificationOptions {
    stackable?: boolean;
    icon?: string;
    actions?: NotificationAction[];
    autoDismiss?: boolean;
    dismissTime?: number; // in milliseconds
    details?: string;
    hideStackCount?: boolean;
}

@Injectable({
    providedIn: 'root'
})
export class NotificationService {
    private notifications = new BehaviorSubject<Notification[]>([]);
    public notifications$ = this.notifications.asObservable();
    
    private readonly MAX_TOWERS = 3;
    private notificationIdCounter = 0;

    constructor() {}

    private generateId(): string {
        return `notification-${this.notificationIdCounter++}-${Date.now()}`;
    }

    private getNotificationKey(type: NotificationType, message: string): string {
        // Create a key for identifying similar notifications
        return `${type}-${message.toLowerCase().trim()}`;
    }

    public show(message: string, type: NotificationType = NotificationType.INFO, options: NotificationOptions = {}): void {
        const currentNotifications = this.notifications.value;
        const notificationKey = this.getNotificationKey(type, message);

        // Check if we should stack this notification
        if (options.stackable !== false) {
            const existingNotification = currentNotifications.find(n => 
                n.type === type && 
                n.stackable && 
                this.getNotificationKey(n.type, n.message) === notificationKey
            );

            if (existingNotification) {
                // Stack the notification
                if(existingNotification.hideStackCount) return;

                existingNotification.stackCount++;
                existingNotification.stackedMessages.push(message);
                existingNotification.timestamp = Date.now();
                this.notifications.next([...currentNotifications]);
                return;
            }
        }

        // Create new notification
        const newNotification: Notification = {
            id: this.generateId(),
            type,
            message,
            icon: options.icon,
            timestamp: Date.now(),
            stackable: options.stackable !== false,
            stackCount: 1,
            stackedMessages: [message],
            actions: options.actions,
            autoDismiss: options.autoDismiss ?? (type === NotificationType.INFO),
            dismissTime: options.dismissTime ?? 5000,
            details: options.details ?? '',
            hideStackCount: options.hideStackCount ?? false,
        };

        // Add notification and maintain MAX_TOWERS limit
        let updatedNotifications = [newNotification, ...currentNotifications];
        
        // Remove oldest notifications if we exceed MAX_TOWERS
        if (updatedNotifications.length > this.MAX_TOWERS) {
            updatedNotifications = updatedNotifications.slice(0, this.MAX_TOWERS);
        }

        this.notifications.next(updatedNotifications);

        // Auto dismiss if configured
        if (newNotification.autoDismiss) {
            setTimeout(() => {
                this.dismiss(newNotification.id);
            }, newNotification.dismissTime);
        }
    }

    public info(message: string, options: NotificationOptions = {}): void {
        console.log('NotificationService.info called with message:', message, 'and options:', options);
        this.show(message, NotificationType.INFO, options);
    }

    public warning(message: string, options: NotificationOptions = {}): void {
        this.show(message, NotificationType.WARNING, { ...options });
    }

    public error(message: string, options: NotificationOptions = {}): void {
        this.show(message, NotificationType.ERROR, { ...options });
    }

    public dismiss(notificationId: string): void {
        const currentNotifications = this.notifications.value;
        const updatedNotifications = currentNotifications.filter(n => n.id !== notificationId);
        this.notifications.next(updatedNotifications);
    }

    public dismissAll(): void {
        this.notifications.next([]);
    }

    public clear(): void {
        this.dismissAll();
    }
}
