import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { trigger, transition, style, animate, query, stagger } from '@angular/animations';
import { Subscription } from 'rxjs';
import { NotificationService, Notification, NotificationType } from '../../services/notification.service';

@Component({
    selector: 'notification-container',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './notification-container.component.html',
    styleUrls: ['./notification-container.component.css'],
    animations: [
        trigger('notificationAnimation', [
            transition(':enter', [
                style({ transform: 'translateY(-100%)', opacity: 0 }),
                animate('300ms ease-out', style({ transform: 'translateY(0)', opacity: 1 }))
            ]),
            transition(':leave', [
                animate('200ms ease-in', style({ transform: 'translateY(-100%)', opacity: 0 }))
            ])
        ]),
        trigger('listAnimation', [
            transition('* => *', [
                query(':enter', [
                    style({ transform: 'translateY(-100%)', opacity: 0 }),
                    stagger(50, [
                        animate('300ms ease-out', style({ transform: 'translateY(0)', opacity: 1 }))
                    ])
                ], { optional: true })
            ])
        ])
    ]
})
export class NotificationContainerComponent implements OnInit, OnDestroy {
    notifications: Notification[] = [];
    expandedNotifications = new Set<string>();
    private subscription?: Subscription;

    constructor(private notificationService: NotificationService) {}

    ngOnInit(): void {
        this.subscription = this.notificationService.notifications$.subscribe(
            notifications => {
                this.notifications = notifications;
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
}
