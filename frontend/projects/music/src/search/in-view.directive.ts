import { Directive, ElementRef, EventEmitter, OnDestroy, OnInit, Output, NgZone } from '@angular/core';

@Directive({
  selector: '[inView]',
  standalone: true
})
export class InViewDirective implements OnInit, OnDestroy {
  @Output() inView = new EventEmitter<{ index: number; ratio: number; distance: number }>();

  private observer?: IntersectionObserver;

  constructor(private element: ElementRef, private ngZone: NgZone) {}

  ngOnInit() {
    // Run observer outside Angular zone for better performance
    this.ngZone.runOutsideAngular(() => {
      this.observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.4) {
            // Calculate distance from center of viewport
            const rect = entry.boundingClientRect;
            const viewportHeight = window.innerHeight;
            const elementCenter = rect.top + rect.height / 2;
            const viewportCenter = viewportHeight / 2;
            const distanceFromCenter = Math.abs(elementCenter - viewportCenter);
            
            // Only trigger change detection when actually emitting
            this.ngZone.run(() => {
              this.inView.emit({
                index: -1, // Will be set by component
                ratio: entry.intersectionRatio,
                distance: distanceFromCenter
              });
            });
          }
        },
        {
          // Reduced thresholds for better performance
          threshold: [0.4, 0.5, 0.6, 0.7, 0.8],
          rootMargin: '0px'
        }
      );

      this.observer.observe(this.element.nativeElement);
    });
  }

  ngOnDestroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
  }
}
