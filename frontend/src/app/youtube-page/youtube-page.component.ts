import { Component, OnInit, OnDestroy} from '@angular/core';
import { RouterModule, RouterOutlet, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { YoutubeService } from './youtube.service';
import { Subscription } from 'rxjs';
import { YoutubeSubscriptionService } from './youtube-subscription.service';

@Component({
  selector: 'app-youtube-page', 
  standalone: true,
  imports: [RouterModule, FormsModule, CommonModule, RouterOutlet],
  templateUrl: './youtube-page.component.html',
  styleUrl: './youtube-page.component.css'
})
export class YoutubePageComponent {
  SEARCH_DELAY_MS = 100;

  oldSearch = '';
  searchInput = '';
  search;

  displaySuggestions: boolean = false;
  searchSuggestionsSub;
  searchSuggestions: string[];

  displayLoginMenu: boolean = false;

  constructor(private router: Router,
    private youtubeService: YoutubeService,
    private subscriptionService: YoutubeSubscriptionService
  ) {
    this.router.navigate(['/youtube', { 
        outlets: { 
            youtube: ['select'] 
        } 
    }],{ skipLocationChange: true });
  }

  ngOnInit(){
    this.searchSuggestionsSub = this.youtubeService.searchSuggestions$.subscribe(suggestions => {
      if(!suggestions){ 
        this.searchSuggestions = [];
        return;
      };
      this.searchSuggestions = suggestions;
    });

    let searchElement = document.getElementById('search_bar');
    searchElement.addEventListener("focus", () => {
      this.displaySuggestions = true;
    });

    searchElement.addEventListener("blur", () => {
      setTimeout(() => {
        this.displaySuggestions = false;
      }, 100);
    });
  }

  ngOnDestroy(){
    let searchElement = document.getElementById('search_bar');
    searchElement.removeEventListener('focus' , () => {
      this.displaySuggestions = true;
    });
    searchElement.removeEventListener("blur", () => {
      setTimeout(() => {
        this.displaySuggestions = false;
      }, 100)
    });
  }

  public navigateToHome(): void {
    this.youtubeService.navigateToHome();
  }

  public navigateToSubscriptionPage(): void {
    if (this.router.url.includes('subscription-page')) {
      this.subscriptionService.refreshSubcriptions();
    } else {
      this.router.navigate(['/youtube', {
        outlets: {
          youtube: ['subscription-page']
        }
      }], { skipLocationChange: true });
    }
  }

  public navigateToSearchResults(): void {
    this.router.navigate(['/youtube', { 
        outlets: { 
            youtube: ['search-results'] 
        } 
    }], { skipLocationChange: true });
  }

  public navigateToLibraryPage(): void{
    this.router.navigate(['/youtube', { 
        outlets: { 
            youtube: ['library-page'] 
        } 
    }], { skipLocationChange: true });
  }

  public navigateToLoginPage(): void{
    this.router.navigate(['/youtube', { 
        outlets: { 
            youtube: ['youtube-login-page'] 
        } 
    }], { skipLocationChange: true });
  }

  public updateSearchInput(): void{

    clearTimeout(this.search);

    this.search = setTimeout(() => {
      if(!this.searchInput){
        this.searchSuggestions = [];
        return;
      }
      this.youtubeService.getSearchSuggestions(this.searchInput);
    }, this.SEARCH_DELAY_MS);
  }  

  public submitSearch():void{
    if(!this.searchInput) return;
    this.youtubeService.currentSearchQuery = this.searchInput;
    this.displaySuggestions = false;
    
    if(this.searchInput == this.oldSearch){
      this.navigateToSearchResults();
      return;
    }

    this.oldSearch = this.searchInput;
    this.youtubeService.searchForVideos(this.searchInput);

    this.navigateToSearchResults();
  }

  public searchWithSuggestion(searchQuery: string): void{
    this.searchInput = searchQuery;
    this.submitSearch();
  }

  public attempLogin(): void{
    this.youtubeService.youtubeFullLogin();
    this.toggleLoginMenu();
    this.navigateToLoginPage();
  }

  public isLoggedIn():boolean {
    return this.youtubeService.loginSessionId ? true : false;
  }

  public logOut(): void{
    this.youtubeService.logOut();
    this.toggleLoginMenu();
  }

  public toggleLoginMenu(): void{
    this.displayLoginMenu = !this.displayLoginMenu;
  }
}
