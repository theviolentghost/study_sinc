import { Component, ElementRef, OnInit, OnDestroy, AfterViewInit, QueryList, ViewChildren } from '@angular/core';
import { HistoryVideo } from '../watch-history.model';
import { YoutubeService } from '../youtube.service';
import { CommonModule } from '@angular/common';
import { WatchHistoryService } from '../watch-history.service';
import { PlaylistVideo } from '../youtube-playlist-results.model';

@Component({
  selector: 'app-library-page',
  imports: [CommonModule],
  templateUrl: './library-page.component.html',
  styleUrl: './library-page.component.css'
})
export class LibraryPageComponent {
  sortedHistory: HistoryVideo[] = [];

  onScreenObserver: IntersectionObserver;

  constructor(private youtubeService: YoutubeService,
    private watchHistoryService: WatchHistoryService
  ){}

  
  async ngOnInit(){
    this.sortedHistory = await this.watchHistoryService.getAllWatchedVideos(this.youtubeService.loginSessionId);

    this.sortedHistory.sort((a, b) => new Date(b.videoData.watchedAt).getTime() - new Date(a.videoData.watchedAt).getTime());

    this.onScreenObserver = new IntersectionObserver(this.handleIntersect.bind(this), {
      threshold: 0.1,
    });
  }

  @ViewChildren('videoItem', { read: ElementRef })
  videoElements!: QueryList<ElementRef>;
  ngAfterViewInit() {
    this.observeAll();

    this.videoElements.changes.subscribe(() => {
      this.observeAll();
    });
  }

  observeAll() {
    this.videoElements.forEach(video => {
      this.onScreenObserver.observe(video.nativeElement);
    });
  }

  handleIntersect(entries: IntersectionObserverEntry[]) {
    entries.forEach(entry => {
      const videoElement = entry.target as HTMLElement;
      const thumbnail = videoElement.querySelector('.thumbnail') as HTMLElement;

      thumbnail.dataset['backgroundImage'] = thumbnail.style.backgroundImage;;
      const originalUrl = thumbnail.getAttribute('background-url');

      if (entry.isIntersecting) {
        thumbnail.style.backgroundImage = `url(${originalUrl})`;
      } else {
        thumbnail.style.backgroundImage = 'none';
      }
    });
  }

  ngOnDestroy(){
    this.onScreenObserver.disconnect();
  }

  playNewVideo(video: HistoryVideo): void{
    let newVideo: PlaylistVideo = {id:video.id, title: video.videoData.title, duration: this.youtubeService.formatVideoDuration(video.videoData.length), channelId: video.videoData.channelId, channelTitle: video.videoData.channelTitle, viewCount: '', channelThumbnailUrl: video.videoData.channelThumbnailUrl, videoThumbnailUrl: video.videoData.videoThumbnailUrl, description: '', uploadDate: ''};

    this.youtubeService.playNewVideo(newVideo);
  }

  navigateToChannel(channelId: string): void{
    this.youtubeService.navigateToChannel(channelId);
  }

  timeAgo(isoTime: string): string {
    return this.youtubeService.timeAgo(isoTime);
  }

  formatVideoDuration(totalSeconds: number): string {
     return this.youtubeService.formatVideoDuration(totalSeconds);
  }

  getVideoProgressPercent(videoId: string): number{
    return this.watchHistoryService.getVideoProgress(videoId) * 100;
  }
}
