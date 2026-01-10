import { Component, OnInit, OnDestroy, HostListener, ViewChildren, QueryList, ElementRef } from '@angular/core';
import { RouterModule, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { YoutubeService } from '../youtube.service';
import { SearchResultItem } from '../video-search-result.model';
import { Subscription } from 'rxjs';
import { FileManagerService } from '../../user.space/note.editor/file.manager.service';
import { YoutubeSubscriptionService } from '../youtube-subscription.service';
import { Playlist, PlaylistVideo } from '../youtube-playlist-results.model';
import { WatchHistoryService } from '../watch-history.service';


@Component({
  selector: 'app-video-search-results',
  standalone: true,
  imports: [RouterModule, CommonModule],
  templateUrl: './video-search-results.component.html',
  styleUrl: './video-search-results.component.css'
})

export class VideoSearchResultsComponent {
  results:SearchResultItem[] = [];
  resultsSub;
  isSubscribed = false;
  private isAddingToSearch: boolean = false;

  onScreenObserver: IntersectionObserver;

  constructor(private router: Router,
    private youtubeService: YoutubeService,
    private youtubeSubscriptionService: YoutubeSubscriptionService,
    private watchHistoryService: WatchHistoryService
  ){}

  ngOnInit() {
    window.scrollTo(0, 0);
    this.resultsSub = this.youtubeService.searchResults$.subscribe(searchResults => {
      this.results = searchResults || [];
      this.isAddingToSearch = false;
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

  ngOnDestroy() {
    this.resultsSub.unsubscribe();
    this.onScreenObserver.disconnect();
  }

  @HostListener('window:scroll', ['$event'])
  onWindowScroll(event: Event) {
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    const pageHeight = document.getElementById('results_list').offsetHeight - document.body.offsetHeight;

    if (!this.isAddingToSearch && scrollY >= pageHeight){ 
      this.isAddingToSearch = true;
      this.youtubeService.addToSearchList();
    }
  }

  public toggleIsSubscribed(channelId: string): void{
    this.isSubscribed = !this.isSubscribed;

    if(this.isSubscribed){
      this.youtubeSubscriptionService.subscribeToChannel(channelId);
      return;
    } 

    this.youtubeSubscriptionService.unsubscribeToChannel(channelId);
  }

  public isSubscribedToChannel(channelId: string): boolean{
    return this.youtubeSubscriptionService.isSubscribed(channelId);
  }

  playNewVideo(video: SearchResultItem){
    let playlistVideo: PlaylistVideo = video;

    this.youtubeService.playNewVideo(playlistVideo);
  }

  public navigateToChannel(channelId: string): void {
    this.youtubeService.navigateToChannel(channelId);
  }

  public timeAgo(isoDate) {
    if(!isoDate) return '';
   return this.youtubeService.timeAgo(isoDate);
  }

  getVideoProgressPercent(videoId: string): number{
    return this.watchHistoryService.getVideoProgress(videoId) * 100;
  }

  wasWatched(videoId: string): boolean{
    return this.watchHistoryService.wasWatched(videoId);
  }

  isChannel(video: SearchResultItem): boolean{
    return video.channelId == video.id;
  }

  formatVideoDuration(totalSeconds: number): string {
    return this.youtubeService.formatVideoDuration(totalSeconds);
  }
}
