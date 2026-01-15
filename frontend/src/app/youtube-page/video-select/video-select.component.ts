import { Component, OnInit, OnDestroy, ElementRef, QueryList, ViewChildren, HostListener } from '@angular/core';
import { RouterModule, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { YoutubeService } from '../youtube.service';
import { FullVideoData, PlaylistVideo } from '../youtube-playlist-results.model';
import { WatchHistoryService } from '../watch-history.service';


@Component({
  selector: 'app-video-select',
  standalone: true,
  imports: [RouterModule, CommonModule],
  templateUrl: './video-select.component.html',
  styleUrl: './video-select.component.css'
})
export class VideoSelectComponent {
  private homepageVideosSub;
  homepageVideos: PlaylistVideo[];
  private isAddingToHomepage: boolean = false;

  onScreenObserver: IntersectionObserver;

  constructor(
    private youtubeService: YoutubeService,
    private watchHistoryService: WatchHistoryService
  ){}

  ngOnInit(){
    if(!this.homepageVideos){
      this.isAddingToHomepage = true;
    } 

    this.homepageVideosSub = this.youtubeService.homepageVideosData$.subscribe(videos => {
      if(!videos) return;
      this.homepageVideos = videos;
      this.isAddingToHomepage = !this.youtubeService.isHomepageFullyLoaded();
    });

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
    this.homepageVideosSub.unsubscribe();
    this.onScreenObserver.disconnect();
  }

  @HostListener('window:scroll', ['$event'])
  onWindowScroll(event: Event) {
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    const pageHeight = document.getElementById('youtube_video_grid').offsetHeight - document.body.offsetHeight;
    
    if (!this.isAddingToHomepage && scrollY >= pageHeight){ 
      this.isAddingToHomepage = true;
      this.youtubeService.addToHomepage();
    }
  }

  playNewVideo(video: PlaylistVideo){
    this.youtubeService.playNewVideo(video);
  }

  public navigateToPlayer(): void {
    this.youtubeService.navigateToPlayer();
  }

  public navigateToChannel(channelId: string): void {
    this.youtubeService.navigateToChannel(channelId);
  }

  formatDuration(duration: any): string{
    return this.youtubeService.formatVideoDuration(duration);
  }

  getVideoProgressPercent(videoId: string): number{
    return this.watchHistoryService.getVideoProgress(videoId) * 100;
  }

  wasWatched(videoId: string): boolean{
    return this.watchHistoryService.wasWatched(videoId);
  }
}
