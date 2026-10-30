import { entities } from './tontakery/entities';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Tontakery1793200000000,
  MonthlyAwards1793300000000,
} from './tontakery/schema';
import { TontakeryController } from './tontakery/controller';
import { AuthService, SessionGuard } from './tontakery/auth.service';
import { GameService } from './tontakery/game.service';
import { Events } from './tontakery/events';
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url:
        process.env.DATABASE_URL ||
        'postgres://tontakery:tontakery@localhost:5432/tontakery',
      entities,
      migrations: [Tontakery1793200000000, MonthlyAwards1793300000000],
      migrationsRun: true,
      synchronize: false,
    }),
  ],
  controllers: [TontakeryController],
  providers: [AuthService, SessionGuard, GameService, Events],
})
export class AppModule {}
