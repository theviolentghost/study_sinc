import { Component, HostListener, ViewChild, ElementRef, OnInit, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { MusicPlayerService } from '../../music.player.service';
import { DownloadQuality, MusicMediaService, Song_Source } from '../../music.media.service';
import { PlaylistsService } from '../../playlists.service';
import { Song_Data, Song_Identifier } from '../../music.media.service';
import { QuickActionService } from '../../quick.action.service';
import { HotActionService } from '../../hot.action.service';

@Component({
    selector: 'app-playlist',
    imports: [CommonModule],
    templateUrl: './playlist.component.html',
    styleUrl: './playlist.component.css',
    standalone: true
})
export class PlaylistComponent implements OnInit, AfterViewInit, OnDestroy {
    @ViewChild('resultVideos', { static: false }) result_videos_ref!: ElementRef<HTMLElement>;
    @ViewChild('searchInput', { static: false }) search_input_ref!: ElementRef<HTMLInputElement>;

    loaded: boolean = true;
    search_query: string = '';
    filtered_videos: (Song_Data | null)[] = [];
    use_playlist_color_for_main: boolean = true;

    order_type: 'recent_to_old' | 'old_to_recent' | 'alphabetical' = 'recent_to_old';

    ngOnInit(): void {
        // Component initialization
        this.loaded = false;
        this.player.playlist_changed.subscribe(() => {
            this.update_main_color();
        });
        this.update_main_color();
        this.player.clear_playlist_color.subscribe(() => {
            document.documentElement.style.setProperty('--color-primary', 'var(--default-primary-color)');
        });
    }

    ngAfterViewInit(): void {
        // Auto-scroll to hide search-filter when component loads
        this.auto_scroll_past_search_filter();
        this.loaded = true;
        this.update_main_color();
    }

    update_main_color(): void {
        if(this.use_playlist_color_for_main) {
            if(this.playlist_identifier.id !== this.player?.playlist_identifier?.id) return;
            const color = this.get_playlist_primary_color();
            if( color.trim() !== 'var(--color-primary)' ) {
                document.documentElement.style.setProperty('--color-primary', color);
            }
        }
    }

    ngOnDestroy(): void {
        // Reset primary color on destroy
        document.documentElement.style.setProperty('--color-primary', 'var(--default-primary-color)');
    }

    private auto_scroll_past_search_filter(smooth: boolean = false): void {
        // Wait for next tick to ensure DOM is fully rendered
        setTimeout(() => {
            this.update_main_color();
            if (this.result_videos_ref?.nativeElement) {
                // Find the search-filter element to get its height
                const host_element = this.result_videos_ref.nativeElement.closest('app-playlist');
                const search_filter = host_element?.querySelector('.search-filter') as HTMLElement;
                
                if (search_filter) {
                    // Get the height of the search-filter including margins
                    const search_filter_height = search_filter.offsetHeight;
                    const computed_style = getComputedStyle(search_filter);
                    const margin_top = parseInt(computed_style.marginTop) || 0;
                    const margin_bottom = parseInt(computed_style.marginBottom) || 0;
                    const total_height = search_filter_height + margin_top + margin_bottom;
                    
                    // Scroll the host element (component container) to hide the search-filter
                    const scroll_container = host_element as HTMLElement;
                    if (scroll_container && scroll_container.scrollTo) {
                        scroll_container.scrollTo({
                            top: total_height + 15, // for box shadow
                            behavior: smooth ? 'smooth' : 'instant' // Change to 'smooth' if you want a smooth scroll
                        });
                    }
                } else {
                    // Fallback: scroll a fixed amount if search-filter not found
                    const scroll_container = host_element as HTMLElement;
                    if (scroll_container && scroll_container.scrollTo) {
                        scroll_container.scrollTo({
                            top: 60, // Approximate height
                            behavior: smooth ? 'smooth' : 'instant' // Change to 'smooth' if you want a smooth scroll
                        });
                    }
                }
            }
        }, 100); // Small delay to ensure DOM is ready
    }

    // Sticky header state
    is_header_visible = true;

    videos: (Song_Data | null)[] = [];
    loaded_videos: Map<number, Song_Data | null> = new Map();
    
    
    // Virtual scrolling properties
    significant_change_size = 5; // how many elements you have to scroll past before loading new ones
    visible_start_index = 0;
    visible_end_index = 75; // Show 75 items initially
    buffer_size = 25; // Load 25 extra items after visible area
    item_height = 60; // Height of each playlist item in pixels
    container_height = 1000; // Height of scrollable container

    swiping_video: string = '';
    swiping_video_data: Song_Data | null = null;
    swipe_state: 'closed' | 'open' | 'dragging' = 'closed';
    swipe_start_x: number = 0;
    swipe_delta_x: number = 0;
    swipe_x: number = 0;
    idle_swipe_open_size: number = 160; 
    delete_swipe_open_size: number = 245; // distance to travel before deleting
    dont_play: boolean = false; 
    get swipe_width(): number {
        return Math.abs(this.swipe_x);
    }
    swipe_threshold: number = 10; 

    // Add mouse tracking properties
    is_mouse_down = false;

    // Enhanced gesture detection properties
    private gesture_start_x = 0;
    private gesture_start_y = 0;
    private gesture_current_x = 0;
    private gesture_current_y = 0;
    private gesture_threshold = 10;
    private gesture_type: 'none' | 'vertical' | 'horizontal' | 'tap' | 'hold' = 'none';
    private gesture_start_time = 0;
    private tap_timeout = 200;
    private hold_timeout = 330; // Time to trigger hold gesture 
    private is_gesture_active = false;
    private hold_timer: any = null;
    private hold_progress = 0;
    private hold_animation_frame: any = null;

    video_key(song_data: Song_Data | null | undefined): string {
        if (!song_data) return '';
        return this.media.bare_song_key(song_data.id);
    }
    
    video_on_swipe_start(event: TouchEvent | MouseEvent, video: Song_Data | null): void {
        let clientX: number, clientY: number;
        
        if (event instanceof TouchEvent) {
            clientX = event.touches[0].clientX;
            clientY = event.touches[0].clientY;
        } else {
            clientX = event.clientX;
            clientY = event.clientY;
            this.is_mouse_down = true;
        }

        // Initialize gesture detection
        this.gesture_start_x = clientX;
        this.gesture_start_y = clientY;
        this.gesture_current_x = clientX;
        this.gesture_current_y = clientY;
        this.gesture_type = 'none';
        this.gesture_start_time = Date.now();
        this.is_gesture_active = true;
        this.hold_progress = 0;

        // Store which video we're potentially swiping
        const new_song_key = this.video_key(video);
        if(this.swiping_video !== new_song_key) {
            this.swipe_start_x = clientX;
            this.swipe_x = 0;
        } else {
            // same video 
            if(this.swipe_state === 'open') {
                this.swipe_start_x = clientX + this.idle_swipe_open_size; // Keep it open
            } else {
                this.swipe_start_x = clientX;
                this.swipe_x = 0;
            }
        }
        this.swiping_video = new_song_key;
        this.swiping_video_data = video;

        // Start hold timer
        this.start_hold_timer(video);

        // Don't prevent default yet - let the gesture detection decide
        event.stopPropagation();
    }
    video_on_swipe_move(event: TouchEvent | MouseEvent): void {
        if (!this.is_gesture_active) return;
        
        let clientX: number, clientY: number;
        
        if (event instanceof TouchEvent) {
            clientX = event.touches[0].clientX;
            clientY = event.touches[0].clientY;
        } else {
            if (!this.is_mouse_down) return;
            clientX = event.clientX;
            clientY = event.clientY;
        }
        this.queued_to_next = false;

        this.gesture_current_x = clientX;
        this.gesture_current_y = clientY;

        const deltaX = Math.abs(clientX - this.gesture_start_x);
        const deltaY = Math.abs(clientY - this.gesture_start_y);
        const totalDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

        // If user moves too much, cancel hold gesture
        if (totalDistance > this.gesture_threshold && this.gesture_type === 'none') {
            this.cancel_hold_timer();
            
            if (deltaX > deltaY * 1.5) {
                // Horizontal gesture (swipe for actions)
                this.gesture_type = 'horizontal';
                this.swipe_delta_x = clientX - this.swipe_start_x;
                this.swipe_x = Math.min(0, this.swipe_delta_x); // Limit swipe to left
                this.swipe_state = 'dragging';
            } else if (deltaY > deltaX * 1.5) {
                // Vertical gesture (scrolling)
                this.gesture_type = 'vertical';
            }
        }

        // Handle the gesture based on type
        if (this.gesture_type === 'horizontal') {
            // Handle horizontal swipe for actions
            const swipeDistance = clientX - this.swipe_start_x;
            this.swipe_x = Math.min(0,swipeDistance);
            event.preventDefault();
        } else if (this.gesture_type === 'vertical') {
            // Allow natural scrolling - don't interfere
            this.is_gesture_active = false;
            this.cancel_hold_timer();
            return;
        }

        event.stopPropagation();
    }
    video_on_swipe_end(event: TouchEvent | MouseEvent): void {
        if (!this.is_gesture_active) return;

        let clientX: number, clientY: number;
        
        if (event instanceof TouchEvent) {
            const touch = event.changedTouches[0];
            clientX = touch.clientX;
            clientY = touch.clientY;
        } else {
            clientX = event.clientX;
            clientY = event.clientY;
            this.is_mouse_down = false;
        }

        const deltaX = Math.abs(clientX - this.gesture_start_x);
        const deltaY = Math.abs(clientY - this.gesture_start_y);
        const totalDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        const gestureDuration = Date.now() - this.gesture_start_time;

        // Cancel hold timer
        this.cancel_hold_timer();

        // Determine final action
        if (this.gesture_type === 'horizontal') {
            // Handle swipe actions
            const swipeDistance = clientX - this.swipe_start_x;
            if( swipeDistance < -this.delete_swipe_open_size) {
                this.play_delete_animation();
                this.delete_video_from_playlist(this.swiping_video_data);
                setTimeout(() => {
                    // delete from video array
                    const index = this.videos.findIndex(v => this.media.bare_song_key(v?.id) === this.swiping_video);
                    if (index !== -1) {
                        this.videos.splice(index, 1);
                    }
                    console.log(index)
                }, 600);
            }
            else if (swipeDistance < -this.idle_swipe_open_size / 2) {
                this.animate_swipe_value(this.swipe_x, -this.idle_swipe_open_size);
                this.swipe_state = 'open';
            } else {
                this.animate_swipe_value(this.swipe_x, 0);
                this.swipe_state = 'closed';
            }
            event.preventDefault();
        } else if (this.gesture_type === 'hold') {
            // Hold gesture completed - handled by timer
            this.swipe_x = 0; // Reset swipe position
            event.preventDefault();
        } else if (this.gesture_type === 'none' && totalDistance < this.gesture_threshold && gestureDuration < this.tap_timeout) {
            // This is a tap - play the song
            this.gesture_type = 'tap';
            if (this.swiping_video_data && !this.queued_to_next) {
                // prevents playing if we just queued to next
                setTimeout(() => this.play(this.swiping_video_data), 50);
            }
        }

        // Reset gesture state
        this.is_gesture_active = false;
        this.gesture_type = 'none';
        this.dont_play = false; 

        event.stopPropagation();
    }

    private queued_to_next: boolean = false;
    private start_hold_timer(video: Song_Data | null): void {
        const startTime = Date.now();
        
        // Start progress animation
        const updateProgress = () => {
            if (!this.is_gesture_active || this.gesture_type !== 'none') {
                this.hold_progress = 0;
                return;
            }
            
            const elapsed = Date.now() - startTime;
            this.hold_progress = Math.min(elapsed / this.hold_timeout, 1) * 100;
            
            if (elapsed >= this.hold_timeout) {
                // Hold gesture completed
                this.gesture_type = 'hold';
                this.swipe_x = 0;
                this.trigger_add_to_next(video);
                this.queued_to_next = true;
                this.hold_progress = 100;
            } else {
                this.hold_animation_frame = requestAnimationFrame(updateProgress);
            }
        };
        
        this.hold_animation_frame = requestAnimationFrame(updateProgress);
    }

    private cancel_hold_timer(): void {
        if (this.hold_timer) {
            clearTimeout(this.hold_timer);
            this.hold_timer = null;
        }
        if (this.hold_animation_frame) {
            cancelAnimationFrame(this.hold_animation_frame);
            this.hold_animation_frame = null;
        }
        this.hold_progress = 0;
    }

    private trigger_add_to_next(video: Song_Data | null): void {
        if (!video) return;
        this.player.add_song_to_play_next(video);
        
        // Trigger success animation
        this.play_add_to_next_animation();
        
        // Reset states
        this.is_gesture_active = false;
        this.gesture_type = 'none';
        this.hold_progress = 0;
    }

    private play_add_to_next_animation(): void {
        // Create a visual feedback animation
        const element = document.querySelector(`[data-video-key="${this.swiping_video}"]`) as HTMLElement;
        if (element) {
            element.classList.add('added-to-next');
            setTimeout(() => {
                element.classList.remove('added-to-next');
            }, 200);
        }
    }

    private play_delete_animation(): void {
        // Create a visual feedback animation for delete
        const element = document.querySelector(`[data-video-key="${this.swiping_video}"]`) as HTMLElement;
        if (element) {
            element.classList.add('delete-animation');
            this.animate_swipe_value(this.swipe_x, -window.innerWidth, 700);
        }
    }

    source_options: Map<Song_Source, string> = new Map([
        ['spotify', "#1cd760"],
        ['youtube', "#ff0033"],
        ['musi', "#ff8843"],
        ['musix', "#ff8843"],
    ]);

    get_source_color(source: Song_Source | undefined): string {
        if( !source ) return 'var(--color-primary)'; // gray color for undefined sources
        return this.source_options.get(source) || 'var(--color-primary)'; // default to gray if source not found
    }

    get_artwork_src(video: Song_Data | null): string {
        if (!video) return '';
        
        // If we have a downloaded blob, create a blob URL
        if (video.download_artwork_blob) {
            return URL.createObjectURL(video.download_artwork_blob);
        }
        
        // Otherwise use the regular URL
        return video.url?.artwork?.low || video.url?.artwork?.high || '';
    }

    get_playlist_primary_color(): string {
        if(this.quick_action.playlist_view_color) return this.quick_action.playlist_view_color;
        return this.playlists.selected_playlist_identifier?.colors?.primary || 'var(--color-primary)';
    }

    get playlist() {
        return this.playlists.selected_playlist;
    }
    get playlist_identifier() {
        return this.playlists.selected_playlist_identifier;
    }
    is_downloading(video_id: string): boolean {
        return this.media.is_downloading(video_id); 
    }
    video_progress(video_id: string): number {
        return this.media.download_progress(video_id); // return the current download progress
    }
    is_in_download_queue(video_id: string): boolean {
        return this.media.is_in_download_queue(video_id); 
    }

    constructor(
        private playlists: PlaylistsService,
        private route: ActivatedRoute,
        private router: Router,
        private media: MusicMediaService,
        private player: MusicPlayerService,
        public quick_action: QuickActionService,
        public hot_action: HotActionService
    ) {
        this.route.paramMap.subscribe(async params => {
            const playlist_id = params.get('playlist_id');
            if (playlist_id) {
                // Wait for playlist to load if it's async
                await this.playlists.load_playlist({id: playlist_id, name: '', track_count: 0, default: false});
                await this.load_videos();
            } else {
                this.videos = [];
            }
        });

        this.media.song_data_updated.subscribe(song_data => {
            this.update_video(song_data);
        });
    }

    // Fuzzy Search Implementation
    on_search_input(event: Event): void {
        const target = event.target as HTMLInputElement;
        this.search_query = target.value.toLowerCase().trim();
        this.apply_search_filter();
    }

    private apply_search_filter(): void {
        if (!this.search_query) {
            // If no search query, show all videos
            this.filtered_videos = [...this.videos];
        } else {
            // Apply fuzzy search filter
            this.filtered_videos = this.videos.filter(video => {
                if (!video) return false;
                return this.fuzzy_match(video, this.search_query);
            });
        }
    }

    private fuzzy_match(video: Song_Data, query: string): boolean {
        if (!video || !query) return false;

        const searchFields = [
            video.song_name?.toLowerCase() || '',
            video.original_artists?.[0]?.name?.toLowerCase() || '',
            // Add more fields as needed
            ...(video.original_artists?.map(artist => artist.name?.toLowerCase() || '') || [])
        ].filter(field => field.length > 0);

        // Check for exact substring matches first (highest priority)
        for (const field of searchFields) {
            if (field.includes(query)) {
                return true;
            }
        }

        // Check for fuzzy matching (allows for typos/partial matches)
        for (const field of searchFields) {
            if (this.calculate_similarity(field, query) >= 0.6) { // 60% similarity threshold
                return true;
            }
        }

        // Check for word-based matching (any word starts with query)
        for (const field of searchFields) {
            const words = field.split(/\s+/);
            for (const word of words) {
                if (word.startsWith(query) || this.calculate_similarity(word, query) >= 0.7) {
                    return true;
                }
            }
        }

        return false;
    }

    private calculate_similarity(str1: string, str2: string): number {
        // Levenshtein distance-based similarity
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;

        if (longer.length === 0) return 1.0;

        const distance = this.levenshtein_distance(longer, shorter);
        return (longer.length - distance) / longer.length;
    }

    private levenshtein_distance(str1: string, str2: string): number {
        const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

        for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
        for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

        for (let j = 1; j <= str2.length; j++) {
            for (let i = 1; i <= str1.length; i++) {
                const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
                matrix[j][i] = Math.min(
                    matrix[j][i - 1] + 1,     // deletion
                    matrix[j - 1][i] + 1,     // insertion
                    matrix[j - 1][i - 1] + cost // substitution
                );
            }
        }

        return matrix[str2.length][str1.length];
    }

    clear_search(): void {
        this.search_query = '';
        if (this.search_input_ref?.nativeElement) {
            this.search_input_ref.nativeElement.value = '';
        }
        this.apply_search_filter();
    }

    get current_song_identifier(): Song_Identifier | null {
        return this.player.song_data ? this.player.song_data.id : null;
    }

    get video_identifiers(): Song_Identifier[] {
        return this.playlists.selected_playlist_video_identifiers;
    }

    async load_videos() {
        // Don't load all videos at once, just prepare the array
        this.videos = new Array(this.playlists.selected_playlist_video_identifiers.length).fill(null);
        // this.videos = [];
        this.loaded_videos.clear();
        
        // Load initial batch
        await this.load_videos_in_range(0, Math.min(this.visible_end_index + this.buffer_size, this.videos.length));
        
        // Initialize filtered videos
        this.filtered_videos = [...this.videos];
    }

    get visible_videos(): (Song_Data | null)[] {
        // Use filtered videos if search is active, otherwise use regular videos
        const source_videos = this.search_query ? this.filtered_videos : this.videos;
        const playlist = this.playlists.selected_playlist;
        if(!playlist) return source_videos;
        if(playlist.song_added_timestamps.size !== playlist.songs.size) {
            console.warn('Playlist song_added_timestamps size does not match songs size. Not sorting.');
            return source_videos;
        }

        // Sort the videos based on the selected order type
        source_videos.sort((a, b) => {
            if (!a || !b) return 0;

            switch (playlist.sorting_method || 'recent_to_old') {
                case 'recent_to_old':
                    return (playlist.song_added_timestamps.get(this.media.song_key(b.id)) || 0) - (playlist.song_added_timestamps.get(this.media.song_key(a.id)) || 0);
                case 'old_to_recent':
                    return (playlist.song_added_timestamps.get(this.media.song_key(a.id)) || 0) - (playlist.song_added_timestamps.get(this.media.song_key(b.id)) || 0);
                case 'alphabetical':
                    return (a?.song_name || '').localeCompare(b?.song_name || '');
                default:
                    return 0;
                }
        });

        return source_videos.slice(this.visible_start_index, this.visible_end_index);
    }

    get padding_top(): string {
        return `${this.visible_start_index * this.item_height}px`;
    }
    get padding_bottom(): string {
        const remaining_items = this.videos.length - this.visible_end_index;
        return `${remaining_items * this.item_height}px`;
    }

    async load_videos_in_range(start: number, end: number) {
        const promises = [];
        
        for (let i = start; i < end; i++) {
            if (!this.loaded_videos.has(i) && i < this.playlists.selected_playlist_video_identifiers.length) {
                const video_id = this.playlists.selected_playlist_video_identifiers[i];
                promises.push(
                    this.media.get_song_from_indexDB(this.media.song_key(video_id))
                        .then(video => {
                            this.loaded_videos.set(i, video);
                            this.videos[i] = video;
                        })
                );
            }
        }
        
        await Promise.all(promises);
        
        // Update filtered videos after loading new data
        this.apply_search_filter();
    }

    update_video(video: Song_Data | null) {
        const index = this.videos.findIndex(v => v?.id.video_id === video?.id.video_id);
        this.loaded_videos.set(index, video);
        this.videos[index] = video;
    }
        

    @HostListener('scroll', ['$event'])
    on_scroll(event: Event) {
        const target = event.target as HTMLElement;
        const scrollTop = target.scrollTop;
        
        // Check header visibility - header has height: 50vh + padding + margins
        // Approximate total height considering 50vh + space-7 padding + space-6 margin
        const viewport_height = window.innerHeight;
        const header_height = Math.max(400, viewport_height * 0.5 + 120); // 50vh + ~120px for padding/margins
        const was_header_visible = this.is_header_visible;
        this.is_header_visible = scrollTop < header_height;
        
        // If visibility changed, trigger change detection
        if (was_header_visible !== this.is_header_visible) {
            // Optional: Add any additional logic when visibility changes
            console.log('Header visibility changed:', this.is_header_visible);
        }
        
        // Calculate visible range based on scroll position
        const new_start = Math.floor(scrollTop / this.item_height);
        const new_end = Math.min(
            new_start + Math.ceil(this.container_height / this.item_height),
            this.videos.length
        );

        const buffered_start = Math.max(0, new_start - this.buffer_size);
        const buffered_end = Math.min(this.videos.length, new_end + this.buffer_size);

        if (Math.abs(buffered_start - this.visible_start_index) > this.significant_change_size || 
            Math.abs(buffered_end - this.visible_end_index) > this.significant_change_size) {
            
            this.visible_start_index = buffered_start;
            this.visible_end_index = buffered_end;
            
            // Load videos in new range
            this.load_videos_in_range(buffered_start, buffered_end);
        }
    }

    async play(track_data: Song_Data | null) {
        if (!track_data) return;
        if(this.dont_play) return;
        console.log('Playing track:', track_data);
        
        this.player.open_player.emit();

        this.player.update_media_session(track_data)
        await this.player.load_playlist(this.playlists.selected_playlist_identifier, this.playlists.selected_playlist, false, false);
        this.player.load_and_play_track(track_data);
        this.player.remove_track_from_playlist_queue(this.media.song_key(track_data.id));
    }

    ms_to_time(ms: number): string {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
    }

    get_bare_song_key(identifier: Song_Identifier | null | undefined): string {
        if (!identifier) return '';
        return this.media.bare_song_key(identifier);
    }

    shuffle_play(): void {
        if(!this.playlists.selected_playlist) return;
        if(this.playlists.selected_playlist.songs.size === 0) return;
        this.player.shuffle = true;
        this.player.load_playlist(this.playlists.selected_playlist_identifier, this.playlists.selected_playlist, false, true);
        this.player.open_player.emit();
    }

    close(to_top: boolean): void {
        if(to_top) {
            // const host_element = this.result_videos_ref.nativeElement.closest('app-playlist') as HTMLElement;
            // if (host_element && host_element.scrollTo) {
            //     host_element.scrollTo({
            //         top: 0,
            //         behavior: 'smooth'
            //     });
            // }
            this.auto_scroll_past_search_filter(true);
            return;
        }
        this.router.navigate(['/playlists'], { replaceUrl: true });
    }

    change_color(): void {
        this.quick_action.quick_action_open = true;
        this.quick_action.action = 'pick_playlist_color';
    }

    redirect_to_search(): void {
        this.router.navigate(['/searches']);
    }

    animateValue(
        from: number, 
        to: number, 
        duration: number, 
        easing: (t: number) => number = this.linear
    ): BehaviorSubject<number> {
        const subject = new BehaviorSubject<number>(from);
        const startTime = Date.now();
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easedProgress = easing(progress);
            const currentValue = from + (to - from) * easedProgress;
            
            subject.next(currentValue);
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                subject.complete();
            }
        };
        
        requestAnimationFrame(animate);
        return subject;
    }
    
    // Easing functions
    easeOutCubic(t: number): number {
        return 1 - Math.pow(1 - t, 3);
    }

    linear(t: number): number {
        return t;
    }

    animate_swipe_value(from: number, to: number, time: number = 125): void {
        this.animateValue(from, to, time).subscribe(value => {
            this.swipe_x = value;
        });
    }

    delete_video_from_playlist(video: Song_Data | null): void {
        if (!video) return;

        this.playlists.remove_song_from_playlist(video, this.playlists.selected_playlist_identifier, this.playlists.selected_playlist);
        
        // Reset swipe state
        this.swipe_x = 0;
        this.swipe_state = 'closed';
        
        // Optionally, you can show a confirmation or feedback message
        console.log(`Video ${video.song_name} removed from playlist.`);
    }

    get_playlist_download_icon(): string {
        if (this.media.is_song_in_playlist_download_queue(this.playlists.selected_playlist_identifier)) {
            return 'loader.svg'; 
        }

        return 'download.svg'; 
    }

    how_many_songs_in_playlist_download_queue(): number {
        return this.media.how_many_songs_in_playlist_download_queue(this.playlists.selected_playlist_identifier);
    }

    request_download_playlist(): void {
        this.quick_action.quick_action_open = true;
        this.quick_action.action = 'download_playlist';
    }

    open_video_options(video: Song_Data | null): void {
        if (!video) return;
        this.dont_play = true;

        this.hot_action.open_hot_action(video, 'spotify');
        this.hot_action.action = 'add_to_playlist';
        this.swipe_x = 0;
        
    }

    toggle_like(video: Song_Data | null): void {
        if (!video) return;
        this.dont_play = true;
        
        video.liked = !video.liked;
        // this.media.save_song_to_indexDB(this.current_song_data.id.video_id, this.current_song_data);
        if(video.liked) {
            console.log('Adding song to favorites:', video);
            this.playlists.add_to_favorites(video);
        } else {
            this.playlists.remove_from_favorites(video);
        }
    }

    download_state(video: Song_Data | null): 'not_downloaded' | 'downloading' | 'downloaded' {
        if (!video) return 'not_downloaded';
        if (this.media.is_downloading(video.id.video_id)) return 'downloading';
        if (video.downloaded) return 'downloaded';
        return 'not_downloaded';
    }

    download_icon(video: Song_Data | null): string {
        const state = this.download_state(video);
        if (state === 'not_downloaded') return 'download.svg';
        if (state === 'downloading') return 'loader.svg';
        if (state === 'downloaded') return 'cloud-download.svg';
        return 'download.svg';
    }

    download_video(video: Song_Data | null): void {
        if (!video) return;
        this.dont_play = true;
        this.swipe_x = 0;
        
        this.media.request_download(this.media.song_key(video.id), {quality: DownloadQuality.Q0, bit_rate: '128k'});
    }
}
