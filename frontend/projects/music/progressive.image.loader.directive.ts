import { Directive, Input, OnDestroy, ElementRef, OnChanges, SimpleChanges } from '@angular/core';
import { Observable, of, from, switchMap, map, tap, concat, Subscription } from 'rxjs';

import { ProgressiveImageLoaderService } from './progressive.image.loader.service';

@Directive({
    selector: '[progressive-load]',
    standalone: true
})
export class ProgressiveLoadDirective implements OnDestroy, OnChanges {
    @Input() low!: string;
    @Input() high!: string;
    @Input() blob!: Blob;
    @Input() prefer_low: boolean;
    private object_url: string;

    private subscription?: Subscription;
    private element: HTMLImageElement;

    constructor(
        private el: ElementRef,
        private loader: ProgressiveImageLoaderService
    ) {}
    
    ngOnChanges(changes: SimpleChanges): void {
        if (changes['low'] || changes['high'] || changes['blob']) {
            this.clean_up();
            this.load_image();
        }
    }

    private load_image(): void {
        this.element = this.el.nativeElement as HTMLImageElement;
        if(!this.element) return;

        if(this.blob) {
            this.object_url = URL.createObjectURL(this.blob)
            this.element.src = this.object_url;
            if(!this.object_url) {
                this.no_source_error();
            }
        } else {
            if(this.prefer_low) {
                this.subscription = this.loader
                    .load_progressive(this.low)
                    .subscribe(src => {
                        if(this.element) this.element.src = src;
                        if(!src) {
                            this.clean_up();
                            this.subscription = this.loader
                                .load_progressive(this.high)
                                .subscribe(src => {
                                    if(this.element)  this.element.src = src;
                                    if(!src) {
                                        this.no_source_error();
                                    }
                                });
                        }
                    });
            } else {
                this.subscription = this.loader
                    .load_progressive(this.low, this.high)
                    .subscribe(src => {
                        if(!src) return;
                        if(this.element) this.element.src = src;
                        // if(!src) {
                        //     this.no_source_error();
                        // }
                    });
            }
        }
    }

    private no_source_error(): void {
        if(this.element) this.element.src = '';
        if(this.element) this.element.classList.add('no-source-error');
    }

    private clean_up(): void {
        this.subscription?.unsubscribe();
        if(this.blob) URL.revokeObjectURL(this.object_url);
    }

    ngOnDestroy() {
        this.clean_up();
    }
}
  