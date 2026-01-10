import { Component, OnInit, OnDestroy } from '@angular/core';
import { YoutubeService } from '../youtube.service';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-login',
  imports: [CommonModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class YoutubeLoginComponent {
  constructor(private youtubeService: YoutubeService,
    private route: ActivatedRoute,
    private router: Router
  ){}

  sessionSub;
  sessionId: string = '';

  imageUrlSub;
  imageUrl: string;

  loginTypeFunction = (event) => {
    console.log(`Key pressed: ${event.key}`);
    if(!this.imageUrl) return;
    if(event.key == 'shift') return;

    this.youtubeService.attemptLoginType(event.key);
  };

  ngOnInit(){
    this.sessionSub = this.youtubeService.loginSessionId$.subscribe(id => {
      if(!id) id = '';
      this.sessionId = id;
    });

    this.imageUrlSub = this.youtubeService.loginImage$.subscribe(url => {
      if(!url) url = '';
      this.imageUrl = url;
      console.log(url);
    });

    document.addEventListener('keydown', this.loginTypeFunction);
  }

  ngOnDestroy(){
    this.sessionSub.unsubscribe();
    this.imageUrlSub.unsubscribe();
    document.removeEventListener('keydown', this.loginTypeFunction);
  }

  loginClick(event: MouseEvent, element: HTMLElement){
    console.log(event);
    let x = event.offsetX;
    let y = event.offsetY;

    let width = element.offsetWidth;
    let height = element.offsetHeight;

    let xPercentage = x / width;
    let yPercentage = y / height;

    this.youtubeService.attemptLoginClick(xPercentage, yPercentage);
  }
}
