import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { App } from './app';

describe('Tontakery participation', () => {
  let app: App;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: TranslateService, useValue: { getCurrentLang: () => 'es' } }],
    });
    app = TestBed.runInInjectionContext(() => new App());
    app.user.set({ name: 'Alice', email: 'alice@vicomtech.org', csrf: 'csrf' });
    app.round.set({
      id: 'round',
      startsAt: '2026-01-01T08:00:00Z',
      endsAt: '2026-01-02T08:00:00Z',
      serverTime: '2026-01-01T10:00:00Z',
      messages: [],
      remaining: 1,
      voteId: null,
    });
    spyOn(app, 'refresh').and.resolveTo();
  });
  afterEach(() => app.ngOnDestroy());

  it('reuses the publication key after an ambiguous network failure', async () => {
    const fetchSpy = spyOn(window, 'fetch').and.rejectWith(new Error('Connection lost'));
    app.draft = 'A good line';
    await app.publish();
    const firstBody = JSON.parse(fetchSpy.calls.mostRecent().args[1]!.body as string);
    expect(app.draft).toBe('A good line');
    expect(app.error()).toBe('requestFailed');
    fetchSpy.and.resolveTo(new Response(JSON.stringify({ id: 'message' }), { status: 201 }));
    await app.publish();
    const secondBody = JSON.parse(fetchSpy.calls.mostRecent().args[1]!.body as string);
    expect(secondBody.requestKey).toBe(firstBody.requestKey);
    expect(app.draft).toBe('');
  });

  it('keeps the draft after a deadline conflict without automatically publishing again', async () => {
    const fetchSpy = spyOn(window, 'fetch').and.resolveTo(
      new Response(JSON.stringify({ message: 'ROUND_CLOSED' }), { status: 409 }),
    );
    app.draft = 'Keep this thought';
    await app.publish();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(app.error()).toBe('roundClosed');
    expect(app.draft).toBe('Keep this thought');
    expect(app.refresh).toHaveBeenCalled();
  });

  it('drops the local session after a server-side revocation', async () => {
    spyOn(window, 'fetch').and.resolveTo(new Response('{}', { status: 401 }));
    await app.vote('message');
    expect(app.user()).toBeNull();
    expect(app.round()).toBeNull();
    expect(app.error()).toBe('sessionExpired');
  });

  it('accepts 500 Unicode characters but does not confirm a longer phrase', () => {
    app.draft = '😀'.repeat(500);
    app.confirm();
    expect(app.confirming).toBeTrue();
    expect(app.draftLength).toBe(500);
    app.confirming = false;
    app.draft += 'x';
    app.confirm();
    expect(app.confirming).toBeFalse();
  });
});
