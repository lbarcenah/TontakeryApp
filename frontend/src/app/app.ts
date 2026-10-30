import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
interface Message {
  id: string;
  body: string;
  createdAt: string;
  mine: boolean;
}
interface Round {
  id: string;
  startsAt: string;
  endsAt: string;
  serverTime: string;
  messages: Message[];
  remaining: number;
  voteId: string | null;
}
interface Result {
  id: string;
  endsAt: string;
  winners: { authorName: string; body: string; votes: number }[];
}
interface History {
  items: Result[];
  hasMore: boolean;
}
interface User {
  name: string;
  email: string;
  csrf: string;
}
@Component({
  selector: 'app-root',
  imports: [
    InputTextModule,
    FormsModule,
    TranslatePipe,
    ButtonModule,
    DialogModule,
    TextareaModule,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, OnDestroy {
  readonly i18n = inject(TranslateService);
  user = signal<User | null>(null);
  round = signal<Round | null>(null);
  history = signal<History>({ items: [], hasMore: false });
  previous = signal<Result | null>(null);
  loading = signal(true);
  busy = signal(false);
  error = signal('');
  connected = signal(false);
  now = signal(Date.now());
  view = signal<'chat' | 'history'>('chat');
  page = signal(0);
  trialEnabled = signal(false);
  trialEmail = '';
  draft = '';
  confirming = false;
  private offset = 0;
  private source?: EventSource;
  private clock?: ReturnType<typeof setInterval>;
  private reconnect?: ReturnType<typeof setTimeout>;
  private channel?: BroadcastChannel;
  private pending?: { key: string; body: string; roundId: string };
  private refreshing = false;
  private again = false;
  private expiredRound = '';
  private disposed = false;
  readonly count = computed(() => {
    const r = this.round();
    if (!r) return '--:--:--';
    const n = Math.max(0, Math.floor((new Date(r.endsAt).getTime() - this.now()) / 1000));
    return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60]
      .map((v) => String(v).padStart(2, '0'))
      .join(':');
  });
  readonly ended = computed(
    () => !!this.round() && new Date(this.round()!.endsAt).getTime() <= this.now(),
  );
  private readonly online = () => {
    clearTimeout(this.reconnect);
    void this.syncSession();
  };
  private readonly offline = () => {
    this.source?.close();
    this.source = undefined;
    this.connected.set(false);
    clearTimeout(this.reconnect);
  };
  async ngOnInit() {
    document.documentElement.lang = this.i18n.getCurrentLang();
    window.addEventListener('online', this.online);
    window.addEventListener('offline', this.offline);
    if (new URLSearchParams(location.search).has('authError')) {
      this.error.set(
        new URLSearchParams(location.search).get('authError') === 'config'
          ? 'googleConfig'
          : 'authFailed',
      );
      history.replaceState({}, '', location.pathname);
    }
    this.clock = setInterval(() => {
      this.now.set(Date.now() + this.offset);
      const r = this.round();
      if (r && this.ended() && this.expiredRound !== r.id) {
        this.expiredRound = r.id;
        void this.refresh();
      }
    }, 1000);
    if ('BroadcastChannel' in window) {
      this.channel = new BroadcastChannel('tontakery');
      this.channel.onmessage = () => void this.syncSession();
    }
    await this.syncSession();
    this.loading.set(false);
  }
  ngOnDestroy() {
    window.removeEventListener('online', this.online);
    window.removeEventListener('offline', this.offline);
    this.disposed = true;
    clearInterval(this.clock);
    clearTimeout(this.reconnect);
    this.source?.close();
    this.channel?.close();
  }
  private async api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch('/api/' + path, {
      method,
      credentials: 'same-origin',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
        ...(this.user() ? { 'X-CSRF-Token': this.user()!.csrf } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 401) {
      this.user.set(null);
      this.round.set(null);
      this.source?.close();
      this.source = undefined;
      this.connected.set(false);
      throw new Error('sessionExpired');
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const code = data.message;
      throw new Error(
        (
          {
            CORPORATE_EMAIL_REQUIRED: 'corporateEmail',
            ROUND_CLOSED: 'roundClosed',
            MESSAGE_LIMIT: 'limit',
            OWN_VOTE: 'ownVote',
            INVALID_MESSAGE: 'invalidMessage',
            INVALID_CSRF: 'sessionExpired',
          } as Record<string, string>
        )[code] || 'requestFailed',
      );
    }
    return response.json();
  }
  async enterTrial() {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api('auth/trial', 'POST', { email: this.trialEmail.trim() });
      await this.syncSession();
      this.channel?.postMessage('sync');
    } catch (e) {
      this.showError(e);
    } finally {
      this.busy.set(false);
    }
  }
  private requestKey() {
    // randomUUID requires HTTPS; getRandomValues also works on private-network HTTP.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  private showError(error: unknown) {
    const key = error instanceof Error ? error.message : '';
    const known = [
      'corporateEmail',
      'roundClosed',
      'limit',
      'ownVote',
      'invalidMessage',
      'requestFailed',
      'sessionExpired',
    ];
    this.error.set(known.includes(key) ? key : 'requestFailed');
  }
  async syncSession() {
    try {
      const config = await this.api<{ trialEnabled: boolean }>('auth/config');
      this.trialEnabled.set(config.trialEnabled);
      this.user.set(await this.api<User>('auth/me'));
      if (this.error() === 'unavailable') this.error.set('');
      await this.refresh();
      if (!this.source) this.connect();
    } catch (e) {
      if ((e as Error).message !== 'sessionExpired') {
        this.error.set('unavailable');
        if (!this.disposed) {
          clearTimeout(this.reconnect);
          this.reconnect = setTimeout(() => void this.syncSession(), 3000);
        }
      }
    }
  }
  private connect() {
    if (this.disposed || !this.user()) return;
    this.source?.close();
    const source = new EventSource('/api/events');
    this.source = source;
    source.onopen = () => {
      this.connected.set(true);
      void this.refresh();
    };
    source.addEventListener('update', () => void this.refresh());
    source.onerror = () => {
      this.connected.set(false);
      source.close();
      this.source = undefined;
      clearTimeout(this.reconnect);
      this.reconnect = setTimeout(() => void this.syncSession(), 3000);
    };
  }
  async refresh() {
    if (!this.user()) return;
    if (this.refreshing) {
      this.again = true;
      return;
    }
    this.refreshing = true;
    try {
      const [r, h] = await Promise.all([
        this.api<Round>('rounds/current'),
        this.api<History>('history'),
      ]);
      if (!this.user()) return;
      if (this.round() && this.round()!.id !== r.id) {
        this.pending = undefined;
        this.confirming = false;
      }
      this.offset = new Date(r.serverTime).getTime() - Date.now();
      this.now.set(Date.now() + this.offset);
      this.round.set(r);
      this.previous.set(h.items[0] || null);
      if (this.view() === 'history') await this.loadHistory();
    } catch (e) {
      this.showError(e);
    } finally {
      this.refreshing = false;
      if (this.again) {
        this.again = false;
        void this.refresh();
      }
    }
  }
  async loadHistory(page = this.page()) {
    try {
      const data = await this.api<History>('history?page=' + page);
      this.page.set(page);
      this.history.set(data);
    } catch (e) {
      this.showError(e);
    }
  }
  async showHistory() {
    this.view.set('history');
    await this.loadHistory(0);
  }
  showChat() {
    this.view.set('chat');
  }
  get draftLength() {
    return [...this.draft.trim()].length;
  }
  confirm() {
    if (this.draft.trim() && [...this.draft.trim()].length <= 500) this.confirming = true;
  }
  async publish() {
    const r = this.round();
    if (!r || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    const body = this.draft.trim();
    if (!this.pending || this.pending.body !== body || this.pending.roundId !== r.id)
      this.pending = { key: this.requestKey(), body, roundId: r.id };
    try {
      await this.api('rounds/' + r.id + '/messages', 'POST', {
        body,
        requestKey: this.pending.key,
      });
      this.draft = '';
      this.pending = undefined;
      this.confirming = false;
      this.channel?.postMessage('sync');
    } catch (e) {
      this.showError(e);
    } finally {
      await this.refresh();
      this.busy.set(false);
    }
  }
  async vote(id: string) {
    const r = this.round();
    if (!r || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api('rounds/' + r.id + '/vote', 'PUT', { messageId: id });
      this.channel?.postMessage('sync');
    } catch (e) {
      this.showError(e);
    } finally {
      await this.refresh();
      this.busy.set(false);
    }
  }
  async logout() {
    try {
      await this.api('auth/logout', 'POST', {});
      this.source?.close();
      this.source = undefined;
      this.user.set(null);
      this.round.set(null);
      this.connected.set(false);
      this.channel?.postMessage('logout');
    } catch (e) {
      this.showError(e);
    }
  }
  formatDate(value: string, time = false) {
    return new Intl.DateTimeFormat(this.i18n.getCurrentLang() === 'es' ? 'es-ES' : 'en-GB', {
      timeZone: 'Europe/Madrid',
      ...(time
        ? ({ hour: '2-digit', minute: '2-digit' } as const)
        : ({ day: '2-digit', month: '2-digit', year: 'numeric' } as const)),
    }).format(new Date(value));
  }
  switchLanguage() {
    const lang = this.i18n.getCurrentLang() === 'es' ? 'en' : 'es';
    this.i18n.use(lang);
    document.documentElement.lang = lang;
    localStorage.setItem('lang', lang);
  }
}
