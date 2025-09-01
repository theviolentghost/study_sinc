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
  }

  ngOnDestroy(){
    this.sessionSub.unsubscribe();
    this.imageUrlSub.unsubscribe();
  }
}
