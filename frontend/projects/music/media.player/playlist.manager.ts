import { MusicMediaService, Song_Data, Song_Playlist, Song_Playlist_Identifier } from "../music.media.service";
import MusicMediaManager from "./media.manager";

export enum Skip_Event {
    DEFAULT,
    FORCE,
    SONG_BLEND,
    OMIT_HISTORY,
    USER_INITIATED,
}
export enum Skip_Result {
    SKIPPED,
    REPLAY, // song restarted
    NOTHING, // no action taken
}

class MusicPlaylistManager {
    public current_song: Song_Data | null = null;
    public playnext: string[] = []; // same as queue, jus has priority and doesnt get changed on playlist changes
    public queue: string[] = [];
    public history_stack: string[] = [];
    public identifier: Song_Playlist_Identifier | null = null;
    public data: Song_Playlist | null = null;

    private minimum_queue_size_before_queue_refresh: number = 5;

    get has_previous_song(): boolean {
        return this.history_stack.length > 0;
    }
    get has_next_song(): boolean {
        return this.queue.length > 0 || this.playnext.length > 0;
    }
    get next_song_key(): string | null {
        if(this.playnext.length > 0) {
            return this.playnext[0];
        }
        if(this.queue.length > 0) {
            return this.queue[0];
        }
        return null;
    }

    constructor(private media: MusicMediaService, private manager: MusicMediaManager) {}

    public async load_playlist(
        identifier: Song_Playlist_Identifier | null, 
        data: Song_Playlist | null, 
        preserve_history: boolean = false // whether to preserve the current song history
    ): Promise<void> {
        this.identifier = identifier;
        this.data = data;
        this.queue = Array.from(data?.songs.values()).map(song_identifier => this.media.song_key(song_identifier)) || [];
        if (!preserve_history) {
            this.history_stack = [];
        }
        this.unshuffle();
        // put into proper order
        // this.current_song = null;

        await Promise.all(this.queue.map(song_key => {
            if(this.manager.song_cache.has(song_key)) return Promise.resolve();
            return this.media.get_song_data(song_key).then(song_data => {
                if(song_data) this.manager.song_cache.set(song_key, song_data);
            }).catch(error => {
                console.error('Error preloading song data for playlist:', song_key, error);
            });
        })).then(() => {
            console.log('Preloaded all song data for playlist.');
        });


    }

    public next(event: Skip_Event = Skip_Event.DEFAULT): Skip_Result {
        if(this.manager.repeat && event === Skip_Event.DEFAULT) {
            this.manager.seek_to(0);
            return Skip_Result.REPLAY;
        }

        if(this.queue.length <= this.minimum_queue_size_before_queue_refresh) {
            this.refresh_queue();

            if(!this.has_next_song) {
                console.warn('No songs available to skip to next.');
                return Skip_Result.NOTHING;
            }
        }

        const next_song_key = this.playnext.length > 0 ? this.playnext.shift()! : this.queue.shift()!;
        if(this.current_song) {
            const current_song_key = this.media.song_key(this.current_song.id);
            if(event !== Skip_Event.OMIT_HISTORY) {
                this.history_stack.push(current_song_key);
            }
        }

        this.manager.load_track(next_song_key).then(() => {
            this.manager.play();
        }).catch(error => {
            console.error('Error loading next song:', next_song_key, error);
        });

        return Skip_Result.SKIPPED;
    }

    public previous(event: Skip_Event = Skip_Event.DEFAULT): Skip_Result {
        if(!this.has_previous_song) {
            console.warn('No more songs in the history to skip to previous.');
            // skip to start of current song
            this.manager.seek_to(0);
            return Skip_Result.REPLAY;
        }
        // if current time > 15 seconds, skip to start of current song
        if(this.manager.current_time > 15) {
            this.manager.seek_to(0);
            return Skip_Result.REPLAY;
        }

        const previous_song_key = this.history_stack.pop()!;
        this.queue.unshift(this.media.song_key(this.current_song!.id));
        this.manager.load_track(previous_song_key).then(() => {
            this.manager.play();
        }).catch(error => {
            console.error('Error loading previous song:', previous_song_key, error);
        });

        return Skip_Result.SKIPPED;
    }

    public refresh_queue(): void {
        // dont make any changes to the playnext or the current queue
        // also dont add any songs that are already in playnext or queue
        if(this.data) {
            const existing_keys = new Set<string>([...this.playnext, ...this.queue]);
            const additional_songs = Array.from(this.data.songs.values())
                .map(song_identifier => this.media.song_key(song_identifier))
                .filter(song_key => !existing_keys.has(song_key));
            this.queue.push(...additional_songs);
        }
    }

    public shuffle(): void {
        // true random 
        if (this.queue.length > 0) {
            this.queue.sort(() => Math.random() - 0.5);
        }
        // simple fisher-yates shuffle
        // for (let i = this.queue.length - 1; i > 0; i--) {
        //     const j = Math.floor(Math.random() * (i + 1));
        //     [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
        // }
    }

    private custom_alpha_sort(a: string, b: string): number {
        const getFirst = (str: string) => str.trim()[0]?.toUpperCase() || '';
        const isAlpha = (char: string) => /^[A-Z]$/.test(char);

        const aFirst = getFirst(a);
        const bFirst = getFirst(b);

        const aIsAlpha = isAlpha(aFirst);
        const bIsAlpha = isAlpha(bFirst);

        if (!aIsAlpha && bIsAlpha) return -1; // a is non-letter, b is letter
        if (aIsAlpha && !bIsAlpha) return 1;  // a is letter, b is non-letter
        // Both are same type, sort normally
        return a.localeCompare(b);
    }

    public unshuffle(): void {
        const original_songs = Array.from(this.data.songs.values());

        if(!this.data?.song_added_timestamps || this.data?.song_added_timestamps?.size === 0) {
            // using third party playlist without timestamps, cannot unshuffle
            console.warn('Cannot unshuffle playlist without song added timestamps. Using order given as in in .songs');
            // make sure it only contains songs currently in queue
            const current_song_key = this.current_song?.id ? this.media.song_key(this.current_song.id) : null;
            const queue_keys = new Set(this.queue);
            
            // Filter original songs to only include those in current queue
            const filtered_songs = original_songs.filter(song => queue_keys.has(this.media.song_key(song)));
            
            // If current song exists and is in the filtered list, place it at the beginning
            if (current_song_key && filtered_songs.some(song => this.media.song_key(song) === current_song_key)) {
                const current_index = filtered_songs.findIndex(song => this.media.song_key(song) === current_song_key);
                if (current_index > 0) {
                    // Move current song to front
                    const current_song = filtered_songs.splice(current_index, 1)[0];
                    filtered_songs.unshift(current_song);
                }
            }
            
            this.queue = filtered_songs.map(identifier => this.media.song_key(identifier));
            return;
        }

        // unshuffle playlist to how its sorted
        const original_order = original_songs.sort((a, b) => {
            if (!a || !b) return 0;

            switch (this.data.sorting_method || 'recent_to_old') {
                case 'recent_to_old':
                    return (this.data.song_added_timestamps.get(this.media.song_key(b)) || 0) - (this.data.song_added_timestamps.get(this.media.song_key(a)) || 0);
                case 'old_to_recent':
                    return (this.data.song_added_timestamps.get(this.media.song_key(a)) || 0) - (this.data.song_added_timestamps.get(this.media.song_key(b)) || 0);
                case 'alphabetical':
                case 'title':
                    return this.custom_alpha_sort(
                        this.manager.song_cache.get(this.media.song_key(a))?.song_name || '',
                        this.manager.song_cache.get(this.media.song_key(b))?.song_name || ''
                    );
                case 'artist':
                    return this.custom_alpha_sort(
                        this.manager.song_cache.get(this.media.song_key(a))?.original_artists?.[0]?.name || '',
                        this.manager.song_cache.get(this.media.song_key(b))?.original_artists?.[0]?.name || ''
                    );
                default: return 0;
            }
        });

        if (this.data && this.data.songs.size > 0) {
            // Reset to original order based on playlist

            if (this.current_song?.id) {
                // Find the current song's index in the original playlist
                const current_song_index = original_order.findIndex(song =>
                    this.media.song_key(song) === this.media.song_key(this.current_song.id)
                );
                
                if (current_song_index !== -1) {
                    // Split the playlist: songs after current + songs before current
                    const songs_after_current = original_order.slice(current_song_index + 1).map(identifier => this.media.song_key(identifier));
                    const songs_before_current = original_order.slice(0, current_song_index).map(identifier => this.media.song_key(identifier));

                    // Combine: songs after current come first, then songs before current
                    this.queue = [...songs_after_current, ...songs_before_current];
                } else {
                    // Current song not found in playlist, use original order without current song
                    this.queue = original_order.filter(identifier =>
                        this.media.song_key(identifier) !== this.media.song_key(this.current_song.id)
                    ).map(identifier => this.media.song_key(identifier));
                }
            } else {
                // No current song, use original order
                this.queue = [...original_order].map(identifier => this.media.song_key(identifier));
            }
        }
    }

    public remove_track_from_queue(song_key: string): void {
        // remove from playnext if exists
        const playnext_index = this.playnext.indexOf(song_key);
        if(playnext_index !== -1) {
            this.playnext.splice(playnext_index, 1);
            console.log('Removed song from playnext:', song_key);
            return;
        }

        // remove from queue if exists
        const queue_index = this.queue.indexOf(song_key);
        if(queue_index !== -1) {
            this.queue.splice(queue_index, 1);
            console.log('Removed song from queue:', song_key);
            return;
        }

        console.warn('Song not found in playnext or queue:', song_key);
    }

    public add_song_to_play_next(song_key: string): void {
        console.log('Adding song to play next:', song_key);
        this.playnext.push(song_key);
    }
}

export default MusicPlaylistManager;