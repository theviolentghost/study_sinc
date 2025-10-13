import { TestBed } from '@angular/core/testing';

import { GlobalInfoService } from './global.info.service';

describe('GlobalInfoService', () => {
  let service: GlobalInfoService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GlobalInfoService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
