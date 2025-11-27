import { Injectable } from '@angular/core';
// import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class LoadingService {
    public loading: boolean = true;
    public global: boolean = false;
}
