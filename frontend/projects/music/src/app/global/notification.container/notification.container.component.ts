import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { trigger, transition, style, animate, query, stagger } from '@angular/animations';
import { Subscription } from 'rxjs';
import { NotificationService, Notification, NotificationType } from '../../services/notification.service';

@Component({
    selector: 'notification-container',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './notification.container.component.html',
    styleUrls: ['./notification.container.component.css'],
    animations: [
        // Smooth entrance animation (slide down from top with bounce)
        trigger('notificationAnimation', [
            transition(':enter', [
                style({ 
                    transform: 'translateY(-120%)', 
                    opacity: 0,
                    maxHeight: 0,
                    marginBottom: 0,
                    paddingTop: 0,
                    paddingBottom: 0
                }),
                animate('400ms cubic-bezier(0.34, 1.56, 0.64, 1)', style({ 
                    transform: 'translateY(0)', 
                    opacity: 1,
                    maxHeight: '500px',
                    marginBottom: '*',
                    paddingTop: '*',
                    paddingBottom: '*'
                }))
            ]),
            // Smooth dismissal animation (fade and slide to left)
            transition(':leave', [
                animate('300ms cubic-bezier(0.55, 0, 1, 0.45)', style({ 
                    opacity: 0,
                    transform: 'translateX(-30px) scale(0.9)',
                    maxHeight: 0,
                    marginBottom: 0,
                    paddingTop: 0,
                    paddingBottom: 0
                }))
            ])
        ])
    ]
})
export class NotificationContainerComponent implements OnInit, OnDestroy {
    notifications: Notification[] = [];
    expandedNotifications = new Set<string>();
    private subscription?: Subscription;
    private previousNotificationIds = new Set<string>();

    constructor(private notificationService: NotificationService) {}

    ngOnInit(): void {
        this.subscription = this.notificationService.notifications$.subscribe(
            notifications => {
                // Track which notifications were removed (not dismissed)
                const currentIds = new Set(notifications.map(n => n.id));
                const removedIds = Array.from(this.previousNotificationIds).filter(id => !currentIds.has(id));
                
                // Update notifications
                this.notifications = notifications;
                
                // Update previous IDs for next comparison
                this.previousNotificationIds = currentIds;
            }
        );
    }

    ngOnDestroy(): void {
        this.subscription?.unsubscribe();
    }

    getNotificationClass(type: NotificationType): string {
        const baseClass = 'notification';
        switch(type) {
            case NotificationType.INFO: return `${baseClass} info`;
            case NotificationType.WARNING: return `${baseClass} warning`;
            case NotificationType.ERROR: return `${baseClass} error`;
            default: return baseClass;
        }
    }

    dismiss(notification: Notification, event?: Event): void {
        if (event) {
            event.stopPropagation();
        }
        this.notificationService.dismiss(notification.id);
    }

    toggleExpanded(notificationId: string, event: Event): void {
        event.stopPropagation();
        if (this.expandedNotifications.has(notificationId)) {
            this.expandedNotifications.delete(notificationId);
        } else {
            this.expandedNotifications.add(notificationId);
        }
    }

    isExpanded(notificationId: string): boolean {
        return this.expandedNotifications.has(notificationId);
    }

    onActionClick(action: any, notification: Notification, event: Event): void {
        event.stopPropagation();
        action.callback();
        this.dismiss(notification);
    }

    onNotificationClick(notification: Notification): void {
        // Dismiss on click if it doesn't have actions
        if (!notification.actions || notification.actions.length === 0) {
            this.dismiss(notification);
        }
    }

    trackById(index: number, notification: Notification): string {
        return notification.id;
    }

    get_notification_icon_url(type: NotificationType): string {
        switch(type) {
            case NotificationType.INFO:
                return 'icons/icon-72x72.png';
            case NotificationType.WARNING:
                return 'alert-triangle.svg';
            case NotificationType.ERROR:
                return 'alert-circle.svg';
            default:
                return 'icons/icon-72x72.png';
        }
    }

    get_notification_icon_color(type: NotificationType): string {
        switch(type) {
            case NotificationType.INFO:
                return '#1b1b1b';
            case NotificationType.WARNING:
                return '#FFA000';
            case NotificationType.ERROR:
                return '#D32F2F';
            default:
                return '#1976D2';
        }
    }
}
