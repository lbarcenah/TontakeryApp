import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsEmail,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { merge, of, timer } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AuthRequest, AuthService, SessionGuard } from './auth.service';
import { Events } from './events';
import { GameService } from './game.service';
class PublishDto {
  @IsString() @MaxLength(1000) body: string;
  @IsUUID() requestKey: string;
}
class TrialDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;
}
class TagDto {
  @IsUUID() messageId: string;
  @IsIn(['racist', 'sexist']) category: string;
  @IsBoolean() selected: boolean;
}
class VoteDto {
  @IsUUID() messageId: string;
}
@Controller()
export class TontakeryController {
  constructor(
    private auth: AuthService,
    private game: GameService,
    private events: Events,
    private db: DataSource,
  ) {}
  @Get('health') async health() {
    await this.db.query('SELECT 1');
    return { ok: true };
  }
  @Get('auth/config') config() {
    return { trialEnabled: this.auth.trialEnabled };
  }
  @Post('auth/trial') trial(
    @Body() dto: TrialDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.auth.trial(dto.email, req, res);
  }
  @Get('auth/google') start(@Res() res: Response) {
    return this.auth.start(res);
  }
  @Get('auth/google/callback') callback(
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.auth.callback(req, res);
  }
  @Get('auth/me') @UseGuards(SessionGuard) me(@Req() req: AuthRequest) {
    return this.auth.me(req);
  }
  @Post('auth/logout') @UseGuards(SessionGuard) logout(
    @Req() req: AuthRequest,
    @Res() res: Response,
  ) {
    return this.auth.logout(req, res);
  }
  @Get('rounds/current') @UseGuards(SessionGuard) current(
    @Req() req: AuthRequest,
  ) {
    return this.game.current(req.userId);
  }
  @Post('rounds/:id/messages') @UseGuards(SessionGuard) publish(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishDto,
  ) {
    return this.game.publish(req.userId, id, dto.body, dto.requestKey);
  }
  @Put('rounds/:id/vote') @UseGuards(SessionGuard) vote(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoteDto,
  ) {
    return this.game.vote(req.userId, id, dto.messageId);
  }
  @Put('rounds/:id/tag') @UseGuards(SessionGuard) tag(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TagDto,
  ) {
    return this.game.tag(
      req.userId,
      id,
      dto.messageId,
      dto.category,
      dto.selected,
    );
  }
  @Get('awards/monthly') @UseGuards(SessionGuard) monthly(
    @Query('month') month?: string,
  ) {
    return this.game.monthly(month);
  }
  @Get('history') @UseGuards(SessionGuard) history(@Query('page') page = '0') {
    return this.game.history(
      Math.min(100000, Math.max(0, parseInt(page, 10) || 0)),
    );
  }
  @Sse('events') @UseGuards(SessionGuard) stream(@Req() req: AuthRequest) {
    // Periodic reconnect revalidates revoked sessions as well as expiry.
    return merge(
      of({ type: 'update', data: { kind: 'sync' } }),
      this.events.stream(req.userId),
    ).pipe(
      takeUntil(
        timer(
          Math.max(
            0,
            Math.min(60000, req.sessionExpiry.getTime() - Date.now()),
          ),
        ),
      ),
    );
  }
}
