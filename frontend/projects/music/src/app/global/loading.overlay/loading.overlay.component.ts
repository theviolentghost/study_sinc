import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { LoadingService } from '../../services/loading.service';

@Component({
    selector: 'loading-overlay',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './loading.overlay.component.html',
    styleUrl: './loading.overlay.component.css'
})
export class LoadingOverlayComponent {
    
}
