import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import { WatchHistoryService } from '../youtube-page/watch-history.service';
import { YoutubeService } from '../youtube-page/youtube.service';

@Component({
  selector: 'app-video-player',
  imports: [
      CommonModule],
  templateUrl: './video-player.component.html',
  styleUrl: './video-player.component.css'
})
export class VideoPlayerComponent implements OnInit, OnDestroy {
  TIME_BEFORE_HISTORY_SAVE_SECONDS = 3;
  HISTORY_SAVE_INTERVAL_SECONDS = 3;

  DOUBLE_CLICK_TIME_MS = 300; 
  singleClickTimer: ReturnType<typeof setTimeout> | null = null;
  lastClickTime: number = 0;

  player: Plyr;
  controlsVisible: boolean;
  isHidingControls;
  isPaused: boolean;

  videoId: string = '';
  videoIdSub;
  isSavingVideoProgress;
  initilizedVideoHistory: boolean;
  seekedFromHistory: boolean;

  widthSub;
  playerWidth = 0;
 
  minSub
  isMinimized = true;

  ySub
  playerY = 0;

  constructor(private sanitizer: DomSanitizer,
    private youtubeService: YoutubeService,
    private watchHistoryService: WatchHistoryService
  ) {}

  ngOnInit() {
    this.widthSub = this.youtubeService.videoWidth$.subscribe(width => {
      if(!width) return;
      this.playerWidth = width;
    });

    this.ySub = this.youtubeService.videoY$.subscribe(y => {
      this.playerY = 48 - y;
    });

    this.minSub = this.youtubeService.videoMinimized$.subscribe(minimized => {
      this.isMinimized = minimized;
    });

    this.videoIdSub = this.youtubeService.videoId$.subscribe(videoId => {
      if(this.videoId == videoId) return;
      this.videoId = videoId;
      if(!videoId) return;
      this.initilizedVideoHistory = false;
      this.seekedFromHistory = false;
      if(this.player){
        this.loadVideo(videoId);
        return;
      }
      this.initilizePlyr(this.videoId);
    });

    document.addEventListener('fullscreenchange', this.fullscreenFunction); 
  }

  ngOnDestroy() {
    this.videoIdSub.unsubscribe();
    this.minSub.unsubscribe();
    this.widthSub.unsubscribe();
    this.ySub.unsubscribe();
    if (this.player) {
      this.player.destroy();
    }
     document.removeEventListener('fullscreenchange', this.fullscreenFunction);
  }

  fullscreenFunction = () => {
    const isInFullscreen = document.fullscreenElement || (document as any).webkitFullscreenElement;
    if(isInFullscreen){
      document.addEventListener('click', this.fullscreenClickFunction, true);
      document.addEventListener('dblclick', this.fullscreenDoubleClickFunction, true);
    } else {
      document.removeEventListener('click', this.fullscreenClickFunction, true);
      document.removeEventListener('dblclick', this.fullscreenDoubleClickFunction, true);
    }
  };

  fullscreenClickFunction = (event: MouseEvent) =>{
    const width = window.innerWidth;
    const height = window.innerHeight;
    const mouseX = event.clientX;
    const mouseY = event.clientY;
    const ratio = mouseX / width;
    if(height - mouseY > 40){
      event.stopPropagation();
      event.preventDefault();
      this.handleSingleClick();
    }
    if(!this.isDoubleClick()) return;

    if(ratio < 0.5){
      this.rewind(10);
    } else {
      this.jumpForward(10);
    }
  };

  fullscreenDoubleClickFunction = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };

  getPlayerWidth(){
    if(this.isMinimized) return null;
    return this.playerWidth;
  }

  getPlayerY(){
    if(this.isMinimized) return null;
    return this.playerY;
  }

  initilizePlyr(videoId: string) {
    this.showControls();
    let player = document.getElementById('plyrPlayer');
    this.player = new Plyr(player, {
      autoplay: false,
      controls: [
        'play', 'progress', 'current-time', 'mute', 'volume', 'settings', 'fullscreen', 'pip'
      ]
    });

    this.player.on('controlsshown', () => {
      this.showControls();
    });

    this.player.on('controlshidden', () => {
      this.hideControls();
    });

    this.player.on('ready', () => {
      this.player.play();
      const overlay = document.createElement('div');
      overlay.id = 'end_click_blocker';
      overlay.style.position = 'absolute';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100%';
      overlay.style.height = 'calc(100% - 40px)';
      overlay.style.zIndex = '99999';
      overlay.style.cursor = 'default';
      document.querySelector('.plyr').appendChild(overlay);
    });

    this.player.on('play', () => {
      this.isPaused = false;
      this.hideControls();

      if(this.seekedFromHistory) return;
      this.seekedFromHistory = true;
      let videoProgress = this.watchHistoryService.getVideoProgress(this.videoId);
      if(this.player.duration - videoProgress * this.player.duration < 1) return;
      this.player.currentTime = videoProgress * this.player.duration - 3;
    });

    this.player.on('pause', () => {
      this.isPaused = true;
      this.showControls();

      if(!this.initilizedVideoHistory && this.player.currentTime < this.TIME_BEFORE_HISTORY_SAVE_SECONDS) return;
      this.watchHistoryService.updateVideoProgress(this.player.currentTime);
    });

    this.player.on('timeupdate', () => {
      if(this.player.currentTime < this.TIME_BEFORE_HISTORY_SAVE_SECONDS) return;

      if(!this.initilizedVideoHistory) {
        this.initilizedVideoHistory = true;
        this.watchHistoryService.addSavedVideoToWatchHistory(this.player.duration);
      }
      
      if(this.isSavingVideoProgress) return;
      this.isSavingVideoProgress = setTimeout(() => {
        this.watchHistoryService.updateVideoProgress(this.player.currentTime, this.youtubeService.loginSessionId);
        this.isSavingVideoProgress = false;
      }, this.HISTORY_SAVE_INTERVAL_SECONDS * 1000);
    });

    let clickBlocker = document.getElementById('main_click_blocker');

    clickBlocker.addEventListener('mousemove' , () => {
      this.player.elements.container.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      this.hideControls();
    });

    clickBlocker.addEventListener('click' , (event: MouseEvent) => {
      this.player.elements.container.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      this.handleSingleClick();
      this.handleDoubleClick(event);
      event.stopPropagation();
      event.preventDefault();
    });

    this.loadVideo(videoId);
  }

  showControls(): void{
    this.controlsVisible = true;
  }

  hideControls(): void{
    clearTimeout(this.isHidingControls);
    this.isHidingControls = setTimeout(() => {
      this.isHidingControls = null;
      if(this.isPaused) return;
      this.controlsVisible = false;
    } ,3000);
  }

  loadVideo(videoId: string) {
    this.player.source = {
      type: 'video',
      sources: [{
        src: videoId,
        provider: 'youtube'
      }]
    };
  }

  isDoubleClick(): boolean{
    const now = Date.now();
    if(now - this.lastClickTime > this.DOUBLE_CLICK_TIME_MS){
      this.lastClickTime = now;
      return false;
    }
    this.lastClickTime = now;
    return true;
  }

  handleSingleClick(): void{
    const now = Date.now();
    if(now - this.lastClickTime > this.DOUBLE_CLICK_TIME_MS){
      this.singleClickTimer = setTimeout(() => {
        this.togglePlay();
        this.singleClickTimer = null;
      }, this.DOUBLE_CLICK_TIME_MS);
    } else {
      if(this.singleClickTimer){
        clearTimeout(this.singleClickTimer);
        this.singleClickTimer = null;
      }
    }
  }

  handleDoubleClick(event: MouseEvent): void{
    const now = Date.now();
    if(this.isDoubleClick()){
      const mouseX = event.clientX;
      let element = document.getElementById('main_click_blocker');
      let hitBox = element.getBoundingClientRect();
      const relativeX = mouseX - hitBox.left;
      const ratio = relativeX / hitBox.right;
      if(ratio > 0.5){
        this.jumpForward(10);
      }else{
        this.rewind(10);
      }
    }
  }

  jumpForward(amount: number): void{
    if(!this.isDoubleClick()) return;
    this.player.currentTime += amount;
  }

  rewind(amount: number): void{
    if(!this.isDoubleClick()) return;
    this.player.currentTime -= amount;
  }

  togglePlay(): void{
    if(!this.player) return;

    if(this.isPaused){
      this.player.play();
      return;
    }
    this.player.pause();
  }

  minimizePlayer(){
    this.youtubeService.minimizePlayer();
  }

  expandPlayer(){
    this.youtubeService.expandPlayer();
    this.youtubeService.navigateToPlayer();
  }

  xPlayer(){
    this.player.pause();
    this.youtubeService.removeVideoPlaying();
    this.youtubeService.expandPlayer();
  }
}
