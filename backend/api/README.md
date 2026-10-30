# Tontakery API

NestJS + TypeORM + PostgreSQL. Consulta el [README principal](../../README.md) para configuración, OAuth, Docker y pruebas.

- `npm run build`: compila a `dist/main.js`.
- `npm run start:dev`: servidor de desarrollo.
- `npm run start:prod`: servidor compilado.
- `npm test`: pruebas unitarias; integración si existe `TEST_DATABASE_URL`.
- `npm run test:e2e`: pruebas contra PostgreSQL (requiere `TEST_DATABASE_URL`).
- `npm run test:browser`: dos sesiones de Chromium contra una base dedicada `*_test`.

El módulo Tontakery sustituye los CRUD de usuarios/artículos y la autenticación de demostración. Las migraciones definen el esquema y las restricciones; `synchronize` está desactivado. Los SQL parametrizados se ejecutan mediante TypeORM para controlar expresamente los bloqueos de cierre y participación.
