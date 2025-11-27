import { Directive, ElementRef, AfterViewInit, OnDestroy, NgZone } from '@angular/core';

@Directive({
  selector: '[scrollSnapActive]',
  standalone: true
})
export class ScrollSnapActiveDirective implements AfterViewInit, OnDestroy {
  private observer: IntersectionObserver | null = null;

  constructor(
    private el: ElementRef,
    private ngZone: NgZone
  ) {}

  ngAfterViewInit() {
    const scrollContainer = this.el.nativeElement;
    
    if (!scrollContainer) return;

    // Run outside Angular zone to prevent change detection on scroll
    this.ngZone.runOutsideAngular(() => {
      this.observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            // Check if the item is in the center of the viewport
            if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
              entry.target.classList.add('snapped');
            } else {
              entry.target.classList.remove('snapped');
            }
          });
        },
        {
          root: scrollContainer,
          threshold: [0, 0.5, 1],
          rootMargin: '0px'
        }
      );

      // Observe all items in the scroll container
      const items = scrollContainer.querySelectorAll('.item');
      items.forEach((item) => this.observer?.observe(item));
    });
  }

  ngOnDestroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
  }
}
