import { Component, HostListener, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DragDropModule, CdkDragEnd, CdkDragMove, CdkDragStart } from '@angular/cdk/drag-drop';
import { PlaylistsService } from '../../playlists.service';

@Component({
  selector: 'app-discover',
  imports: [CommonModule, DragDropModule],
  templateUrl: './discover.component.html',
  styleUrl: './discover.component.css'
})
export class DiscoverComponent implements AfterViewInit {
    @ViewChild('activeCard', { static: false }) active_card_ref!: ElementRef<HTMLElement>;

    discover_cards = Array(10).fill(0).map((_, index) => ({
        id: index,
        title: `Song ${index + 1}`,
        artists: [{ id: `artist_${index}`, name: `Artist ${index + 1}` }],
        image: 'music.svg'
    }));

    // Card swipe state
    current_card_index = 0;
    is_dragging = false;
    is_exiting = false; // Track if card is currently exiting
    is_card_hidden = false; // Track if card should be hidden from DOM
    current_rotation = 0; // Track current rotation separately
    exit_transform = ''; // Transform for exit animations only
    drag_position = { x: 0, y: 0 }; // CDK drag position - always reset
    swipe_direction: 'left' | 'right' | null = null;
    swipe_threshold = 150; // Minimum distance to trigger swipe
    
    // Background cards for stacking - static to prevent re-renders
    background_cards: any[] = [];
    is_shuffling_cards = false; // Track when cards are shuffling forward
    
    // Visual feedback
    show_left_glint = false;
    show_right_glint = false;
    glint_opacity = 0;

    constructor(private _playlists: PlaylistsService) {}

    is_playlist_dropdown_open = false;
    toggle_playlist_dropdown(): void {
        this.is_playlist_dropdown_open = !this.is_playlist_dropdown_open;
    }

    exclude_playlists = ['#recently_played', '#recently_added', '#downloads'];
    get playlists() {
        const list = this._playlists.all_playlist_identifiers;
        // filter out recently played, added and downloaded
        return list.filter(playlist => !this.exclude_playlists.includes(playlist.id));
    }

    selected_playlist: any = null;
    select_playlist(playlist: any): void {
        if(this.selected_playlist && this.selected_playlist.id === playlist.id) {
            this.is_playlist_dropdown_open = false;
            return; // No change
        }
        this.selected_playlist = playlist;
        this.is_playlist_dropdown_open = false;
    }

    // Throttling for smooth dragging
    private last_update_time = 0;
    private update_throttle_ms = 16; // ~60fps max update rate

    get current_card() {
        return this.discover_cards[this.current_card_index];
    }

    get remaining_cards() {
        return this.discover_cards.length - this.current_card_index;
    }

    get card_classes() {
        return {
            'active-card': true,
            'cdk-drag-dragging': this.is_dragging
        };
    }

    ngAfterViewInit() {
        // Component initialized
        this.update_background_cards();
    }

    open_artist(artist: any): void {
        console.log("Open artist with ID:", artist.id);
        // Implement navigation to artist page here
    }

    private update_background_cards(): void {
        // Update the background cards for stacking effect
        const maxBackgroundCards = 4;
        const startIndex = this.current_card_index + 1;
        const endIndex = Math.min(startIndex + maxBackgroundCards, this.discover_cards.length);
        
        this.background_cards = this.discover_cards.slice(startIndex, endIndex).map((card, index) => ({
            ...card,
            stackIndex: index // For positioning
        }));
    }

    onDragStarted(event: CdkDragStart): void {
        if (this.is_exiting) return; // Prevent dragging during exit
        
        this.is_dragging = true;
        this.swipe_direction = null;
        this.show_left_glint = false;
        this.show_right_glint = false;
        this.glint_opacity = 0;
        this.last_update_time = 0; // Reset throttling
        this.current_rotation = 0; // Reset rotation
        this.exit_transform = ''; // Clear any exit transform
        this.drag_position = { x: 0, y: 0 }; // Ensure clean start
        
        // Ensure element starts clean
        if (this.active_card_ref && this.active_card_ref.nativeElement) {
            const element = this.active_card_ref.nativeElement;
            element.style.transition = '';
            element.style.transform = '';
            element.classList.remove('snap-back');
        }
        
        console.log('Drag started');
    }

    get_transform_style() {
        // During exit animation, only use exit transform
        if (this.exit_transform) {
            return this.exit_transform;
        }
        // During drag, only use rotation
        if (this.current_rotation !== 0) {
            return `rotate(${this.current_rotation}deg)`;
        }
        // Default state
        return '';
    }

    onDragMoved(event: CdkDragMove): void {
        if (!this.is_dragging) return;

        // Throttle updates to reduce jitter
        const now = Date.now();
        if (now - this.last_update_time < this.update_throttle_ms) {
            return;
        }
        this.last_update_time = now;

        const deltaX = event.distance.x;
        const deltaY = event.distance.y;
        
        // Calculate rotation with constraints to prevent jitter
        const clampedDeltaX = Math.max(-400, Math.min(400, deltaX));
        const rotationFactor = 0.015; // Reduced for smoother rotation
        const maxRotation = 6; // Reduced max rotation for subtlety
        let rotation = clampedDeltaX * rotationFactor;
        
        // Apply rotation constraints
        rotation = Math.max(-maxRotation, Math.min(maxRotation, rotation));
        
        // Round rotation to reduce micro-movements
        rotation = Math.round(rotation * 100) / 100;
        
        // Store rotation for snap back animation
        this.current_rotation = rotation;
        
        // Determine swipe direction and show visual feedback
        if (Math.abs(deltaX) > 50) {
            const intensity = Math.min(Math.abs(deltaX) / this.swipe_threshold, 1);
            this.glint_opacity = intensity * 0.8;
            
            if (deltaX < 0) {
                this.swipe_direction = 'left';
                this.show_left_glint = true;
                this.show_right_glint = false;
            } else {
                this.swipe_direction = 'right';
                this.show_left_glint = false;
                this.show_right_glint = true;
            }
        } else {
            this.show_left_glint = false;
            this.show_right_glint = false;
            this.glint_opacity = 0;
            this.swipe_direction = null;
        }
    }

    onDragEnded(event: CdkDragEnd): void {
        this.is_dragging = false;
        
        const deltaX = event.distance.x;
        const deltaY = event.distance.y;
        
        // Reset visual feedback first
        this.show_left_glint = false;
        this.show_right_glint = false;
        this.glint_opacity = 0;
        this.swipe_direction = null;
        
        // Check if swipe threshold was met
        if (Math.abs(deltaX) >= this.swipe_threshold) {
            // Don't reset rotation or position - let exit animation handle it
            if (deltaX < 0) {
                this.reject_card();
            } else {
                this.accept_card();
            }
        } else {
            // Only snap back if we're not exiting
            this.current_rotation = 0;
            this.snap_back_to_center();
        }
    }

    accept_card(): void {
        if (this.is_exiting) return; // Prevent multiple exits
        
        const card = this.discover_cards[this.current_card_index]; // Get card before hiding
        console.log('Accepted card:', card.title);
        
        // Mark as exiting to disable dragging
        this.is_exiting = true;
        
        // Add animation class for right swipe
        this.animate_card_exit('right');
        
        // Add to playlist logic here
        this.add_to_playlist(card);
        
        // Start shuffling background cards forward after a short delay
        setTimeout(() => {
            this.start_card_shuffle();
        }, 200); // Start shuffle while exit animation is still happening
        
        // Hide card from DOM after animation completes, then move to next
        setTimeout(() => {
            this.is_card_hidden = true;
            setTimeout(() => {
                this.move_to_next_card();
            }, 50);
        }, 400); // Match CSS transition duration
    }

    reject_card(): void {
        if (this.is_exiting) return; // Prevent multiple exits
        
        const card = this.discover_cards[this.current_card_index]; // Get card before hiding
        console.log('Rejected card:', card.title);
        
        // Mark as exiting to disable dragging
        this.is_exiting = true;
        
        // Add animation class for left swipe
        this.animate_card_exit('left');
        
        // Start shuffling background cards forward after a short delay
        setTimeout(() => {
            this.start_card_shuffle();
        }, 200); // Start shuffle while exit animation is still happening
        
        // Hide card from DOM after animation completes, then move to next
        setTimeout(() => {
            this.is_card_hidden = true;
            setTimeout(() => {
                this.move_to_next_card();
            }, 50);
        }, 400); // Match CSS transition duration
    }

    private snap_back_to_center(): void {
        if (this.active_card_ref && this.active_card_ref.nativeElement) {
            const element = this.active_card_ref.nativeElement;
            
            // Add snap-back class for smooth animation
            element.classList.add('snap-back');
            
            // Reset CDK position to prevent offset issues
            this.drag_position = { x: 0, y: 0 };
            
            // Reset rotation smoothly
            this.current_rotation = 0;
            this.exit_transform = '';
            
            // Remove snap-back class after animation completes
            setTimeout(() => {
                if (element) {
                    element.classList.remove('snap-back');
                    element.style.transform = ''; // Clear manual transform
                }
            }, 300);
        }
    }

    private animate_card_exit(direction: 'left' | 'right'): void {
        const card = this.current_card;
        console.log(`Animating card exit to the ${direction}`);
        
        // Reset CDK position first to prevent conflicts
        this.drag_position = { x: 0, y: 0 };
        this.current_rotation = 0;
        
        // Calculate exit transform values
        const translate_x = direction === 'left' ? -1000 : 1000;
        const rotation = direction === 'left' ? -30 : 30;
        
        // Set exit transform for the card content (via template binding)
        this.exit_transform = `translate3d(${translate_x}px, -100px, 0) rotate(${rotation}deg)`;
        
        console.log('Exit transform set:', this.exit_transform);
    }

    private reset_card_position(): void {
        this.exit_transform = '';
        this.current_rotation = 0;
        this.drag_position = { x: 0, y: 0 }; // Always reset position
        this.is_exiting = false; // Reset exit state
        this.is_card_hidden = false; // Reset hidden state
        this.is_shuffling_cards = false; // Reset shuffle state
        
        // Also reset the element transform and classes
        if (this.active_card_ref && this.active_card_ref.nativeElement) {
            const element = this.active_card_ref.nativeElement;
            element.style.transform = '';
            element.style.transition = '';
            element.classList.remove('snap-back');
        }
    }

    private move_to_next_card(): void {
        this.current_card_index++;
        this.reset_card_position();
        
        // Force a clean state for the next card
        setTimeout(() => {
            this.drag_position = { x: 0, y: 0 };
            this.current_rotation = 0;
            this.exit_transform = '';
            this.is_exiting = false;
            this.is_card_hidden = false;
            
            if (this.active_card_ref && this.active_card_ref.nativeElement) {
                const element = this.active_card_ref.nativeElement;
                element.style.transform = '';
                element.style.transition = '';
                element.classList.remove('snap-back');
            }
        }, 50);
        
        if (this.current_card_index >= this.discover_cards.length) {
            console.log('No more cards to show');
            // Load more cards or show completion message
            this.load_more_cards();
        }
    }

    private add_to_playlist(card: any): void {
        // Implement playlist addition logic here
        console.log('Adding to playlist:', card);
        // This would integrate with your playlist service
    }

    private load_more_cards(): void {
        // Implement logic to load more discovery cards
        console.log('Loading more cards...');
        // Reset index or load new cards from service
        this.current_card_index = 0;
        this.update_background_cards();
    }

    private start_card_shuffle(): void {
        this.is_shuffling_cards = true;
        
        // Don't update the array, just set the flag to trigger position changes
        // The template will handle the new positioning via the is_shuffling_cards flag
        
        // Reset shuffle flag after animation completes
        setTimeout(() => {
            this.is_shuffling_cards = false;
            // Now update the actual data after the animation
            this.update_background_cards();
        }, 400);
    }

    get_background_card_transform(index: number): string {
        // During shuffle, move each card up one position
        const adjustedIndex = this.is_shuffling_cards ? index : index + 1;
        const translateY = adjustedIndex * -10;
        const scale = 1 - adjustedIndex * 0.02;
        return `translateY(${translateY}px) scale(${scale})`;
    }

    get_background_card_opacity(index: number): number {
        // During shuffle, increase opacity as cards move forward
        const adjustedIndex = this.is_shuffling_cards ? index : index + 1;
        const totalCards = this.background_cards.length + 1; // +1 for the active card
        return Math.max(0.3, 1 - adjustedIndex * (0.7 / totalCards));
    }

    // Keyboard support for accessibility
    @HostListener('document:keydown', ['$event'])
    handle_keyboard_event(event: KeyboardEvent): void {
        if (this.is_dragging) return;
        
        switch (event.key) {
            case 'ArrowLeft':
                event.preventDefault();
                this.reject_card();
                break;
            case 'ArrowRight':
                event.preventDefault();
                this.accept_card();
                break;
        }
    }

    // Touch/swipe support for mobile
    on_swipe_left(): void {
        if (!this.is_dragging) {
            this.reject_card();
        }
    }

    on_swipe_right(): void {
        if (!this.is_dragging) {
            this.accept_card();
        }
    }
}
