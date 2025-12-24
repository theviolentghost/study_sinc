import { Injectable } from '@angular/core';
import { take } from 'rxjs/operators';

import { MusicMediaService } from './music.media.service';

@Injectable({
  providedIn: 'root'
})
export class ImageCacheService {

    constructor(private media: MusicMediaService) { }
}
