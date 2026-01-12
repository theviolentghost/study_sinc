import { Injectable } from '@angular/core';
import { Observable, of, from, switchMap, map, tap, concat, catchError, filter } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ProgressiveImageLoaderService {
    private cache = new Map<string, string>();
    private cache_added_order: string[] = [];
    private max_cache_length: number = 50;

    private load(url: string): Observable<string> {
        if(!url || !url.trim()) return of(null);
        if (this.cache.has(url)) {
            return of(this.cache.get(url)!);
        }

        return from(fetch(url))
            .pipe(
                switchMap(res => {
                    if (!res.ok) {
                        return of(null);
                    }
                    return res.blob();
                }),
                map(blob => blob ? URL.createObjectURL(blob) : null),
                tap(object_url => {
                    if (object_url) {
                        this.add_to_cache(url, object_url);
                    }
                }),
                catchError(err => {
                    return of(null);
                })
            );
    }

    private add_to_cache(key: string, object_url: string): void {
        this.cache_added_order.push(key);
        this.cache.set(key, object_url);
        if(this.cache_added_order.length > this.max_cache_length) {
            // purge oldest image
            const oldest_cached_key: string = this.cache_added_order.shift();
            this.cache.delete(oldest_cached_key);
        }
    }

    public load_progressive(...urls: string[]): Observable<string> {
        return concat(
            ...urls.map((url) => this.load(url))
        );
        // .pipe(
        //     filter(url => url !== null) // Only emit non-null values
        // );
    }

    public get(key: string): string | null {
        if(!this.cache.has(key)) return null;
        return this.cache.get(key);
    }
}
