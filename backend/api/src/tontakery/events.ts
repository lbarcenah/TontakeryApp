import { Injectable, MessageEvent } from '@nestjs/common';
import { Subject, filter, interval, map, merge } from 'rxjs';
@Injectable()
export class Events {
  private bus = new Subject<{ kind: string; userId?: string }>();
  emit(kind: string, userId?: string) {
    this.bus.next({ kind, userId });
  }
  stream(userId: string) {
    return merge(
      this.bus.pipe(
        filter((e) => !e.userId || e.userId === userId),
        map(
          (e) => ({ type: 'update', data: { kind: e.kind } }) as MessageEvent,
        ),
      ),
      interval(20000).pipe(
        map(() => ({ type: 'heartbeat', data: {} }) as MessageEvent),
      ),
    );
  }
}
