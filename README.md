# Tontakery

Chat anónimo del departamento con concurso diario. Angular 21 + PrimeNG/Tailwind, NestJS 11, TypeORM y PostgreSQL. Un único chat y una única instancia de API; actualizaciones mediante SSE, sin sondeos continuos desde el navegador.

## Arranque con Docker

Desde esta carpeta:

```bash
cp .env.example .env
# Completar GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en .env.
docker compose -f docker-compose.dev.yml up --build
```

Abre **http://localhost:4200**. La API se sirve a través del proxy Angular bajo `/api`; PostgreSQL de desarrollo se expone solo en `127.0.0.1:5432` (usuario, clave y base: `tontakery`). Los datos se conservan en `postgres_dev_data`. Las migraciones se ejecutan al arrancar la API, antes de aceptar peticiones.

Sin credenciales Google puedes usar el acceso temporal por correo en desarrollo, descrito al final de esta guía. El acceso corporativo verificado requiere configurar Google. Si Docker no funciona desde WSL, habilita la integración de tu distribución en Docker Desktop → Settings → Resources → WSL Integration.

### Producción

1. Configura `.env`: `APP_ORIGIN=https://tu-dominio-interno` (sin barra final), una contraseña PostgreSQL aleatoria hexadecimal y las credenciales Google.
2. Configura un proxy HTTPS de la organización que apunte a `127.0.0.1:8080`. Conserva el encabezado `Host`; desactiva el buffering y permite conexiones de al menos 90 segundos para `/api/events`.
3. Ejecuta:

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 backend
```

El frontend Nginx sirve Angular y reenvía `/api` al backend. API y PostgreSQL no se exponen al host. `HTTP_PORT` cambia el puerto local del frontend. En producción las cookies requieren HTTPS; no se debe probar el login de producción desde HTTP. Nginx incluye comprobación de salud en `/healthz` y la API en `/api/health`.

No escalar el backend a varias réplicas en esta versión: los bloqueos de PostgreSQL protegen los datos, pero la distribución SSE está en memoria de una instancia. Usa los checks de salud y los logs de cierre para monitorizar el servicio.

## Configurar Google Workspace

En Google Cloud, con una cuenta autorizada por la organización:

1. Crea o selecciona un proyecto. Configura Google Auth Platform / pantalla de consentimiento como aplicación interna de la organización, si la política de Workspace lo permite.
2. Solicita únicamente los permisos `openid`, `email` y `profile`.
3. Crea un cliente OAuth de tipo **Aplicación web**. Registra las URL de retorno exactas:
   - Desarrollo: `http://localhost:4200/api/auth/google/callback`.
   - Producción: `https://tu-dominio-interno/api/auth/google/callback`.
4. Copia el ID y secreto en `.env`, nunca en archivos del frontend. Si se usan otros dominios o puertos, ajusta también `APP_ORIGIN` y el retorno registrado.
5. Si Workspace bloquea aplicaciones nuevas, pide al administrador que autorice este cliente OAuth. Comprueba el login con una cuenta real de Vicomtech.

El backend valida firma, emisor, audiencia, caducidad, nonce, email verificado y `hd=vicomtech.org`. También exige correo `@vicomtech.org`. Identifica al usuario por el `sub` de Google, no por el correo. La autorización usa `state`, nonce y PKCE; no se conserva el token de Google. Referencia: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

Las sesiones duran siete días, se guardan en PostgreSQL como hashes de tokens aleatorios y utilizan cookies HttpOnly/SameSite=Lax (Secure en producción). Las escrituras exigen origen exacto y token CSRF. Cerrar sesión revoca el token del servidor. El flujo OAuth caduca a los diez minutos y es de un solo uso.

## Reglas

- Jornadas de 09:00 a 09:00 en `Europe/Madrid`, incluidos festivos y fines de semana. Los días del cambio de hora pueden durar 23 o 25 horas.
- Una publicación por persona, o dos si ganó la jornada inmediatamente anterior. La bonificación no se acumula.
- Texto plano de 1–500 caracteres, sin edición ni borrado; se confirma antes de publicar. Los reintentos reutilizan una clave de idempotencia.
- Un voto activo por persona. Puede cambiarse hasta el cierre; no se permite votar publicaciones propias.
- Autores y recuentos ocultos durante la jornada. La API solo informa si una publicación pertenece al usuario actual y cuál es su voto.
- Ganan todas las frases empatadas con el máximo de votos. Los votos no se suman por autor. Sin votos, no hay ganador.
- Solo se revelan los autores ganadores. El historial conserva fecha de cierre, nombres, frases y recuentos; no permite consultar conversaciones antiguas ni identidades de votantes.

El backend conserva las relaciones entre usuarios y votos para aplicar las reglas; el anonimato es frente a participantes, no frente al administrador de la base de datos. El nombre del ganador y su frase se guardan como copia histórica.

El cierre se comprueba cada segundo y en las peticiones. Las operaciones y el cierre se serializan con un bloqueo transaccional y un bloqueo de fila de la jornada; la hora se consulta después de adquirir el bloqueo. Desde las 09:00 se rechazan escrituras de la jornada vencida, aunque el proceso de cierre aún no haya ejecutado su siguiente comprobación. Tras una parada se recuperan todas las jornadas pendientes, incluidas las vacías, sin recalcular resultados ya guardados.

## API

Todas las rutas, salvo salud y el flujo Google, requieren sesión.

| Método y ruta                   | Uso                                                                     |
| ------------------------------- | ----------------------------------------------------------------------- |
| `GET /api/health`               | Salud y conexión con PostgreSQL                                         |
| `GET /api/auth/google`          | Iniciar acceso Google                                                   |
| `GET /api/auth/google/callback` | Retorno OAuth                                                           |
| `GET /api/auth/me`              | Nombre, correo y token CSRF del usuario actual                          |
| `POST /api/auth/logout`         | Revocar sesión                                                          |
| `GET /api/rounds/current`       | Jornada, hora servidor, mensajes, publicaciones restantes y voto propio |
| `POST /api/rounds/:id/messages` | `{body, requestKey}`; clave UUID                                        |
| `PUT /api/rounds/:id/vote`      | `{messageId}`; sustituye el voto activo                                 |
| `GET /api/history?page=0`       | 20 jornadas cerradas por página y `hasMore`                             |
| `GET /api/events`               | SSE autenticado, eventos `update` y `heartbeat`                         |

SSE solo envía avisos de invalidación. Las publicaciones y cierres generan avisos públicos sin datos personales; los cambios de voto solo avisan al propio usuario. Tras conectar, reconectar o recibir un aviso, el frontend consulta el estado autorizado. Los latidos llegan cada 20 segundos; la conexión se renueva cada minuto para revalidar la sesión. El navegador también sincroniza sus pestañas mediante BroadcastChannel.

Las respuestas JSON no se envuelven en el interceptor antiguo. Errores: 400 para entradas inválidas, 401 para sesiones inválidas, 403 para CSRF y 409 para jornada cerrada, límite de publicaciones o conflicto de idempotencia.

## Desarrollo sin contenedores

Node **22.22.0** (la imagen Docker fija esa versión). Instalar con npm; los `package-lock.json` son los lockfiles vigentes.

```bash
cd backend/api
npm ci
DATABASE_URL=postgres://tontakery:tontakery@localhost:5432/tontakery \
APP_ORIGIN=http://localhost:4200 \
GOOGLE_CLIENT_ID='tu-client-id' GOOGLE_CLIENT_SECRET='tu-client-secret' \
npm run start:dev
```

En otra terminal:

```bash
cd frontend
npm ci
npm start
```

El backend lee el entorno del proceso; no carga automáticamente un `.env` al ejecutarlo directamente. Docker Compose sí lee el `.env` de la raíz. No poner secretos en el historial del shell: para uso real, exportarlos desde un archivo local protegido o el gestor de secretos del entorno.

## Validación

```bash
cd backend/api
npm run build
npm test -- --coverage=false
# PostgreSQL dedicado de pruebas: crea una base tontakery_test antes.
TEST_DATABASE_URL=postgres://usuario:clave@localhost:5432/tontakery_test npm run test:e2e
```

Las pruebas unitarias cubren el calendario de Madrid y los controles OAuth. Las pruebas de integración crean y eliminan un esquema aislado: comprueban límites concurrentes, idempotencia, cambio de voto, privacidad, empates, bonificación, snapshots, recuperación de cierres, sesiones y CSRF. Sin `TEST_DATABASE_URL`, la suite de integración se omite en `npm test`.

```bash
cd frontend
npm run build
npm test -- --watch=false --browsers=ChromeHeadless --karma-config=karma.conf.cjs
```

Las cuatro pruebas del frontend verifican reintentos idempotentes, conflictos de cierre, revocación de sesión y longitud Unicode. Si Chromium no está en el PATH, indica su ejecutable mediante `CHROME_BIN`.

### Prueba con navegador y dos sesiones

`backend/api/test/browser.cjs` usa una base dedicada cuyo nombre termina en `_test`. **Borra las tablas Tontakery de esa base.** Nunca apuntarlo a producción. Arranca la API con esa misma base y el frontend con su proxy a esa API; usa el mismo origen en `APP_ORIGIN` y `TEST_APP_ORIGIN`.

```bash
cd backend/api
npx playwright install chromium
TEST_DATABASE_URL=postgres://usuario:clave@localhost:5432/tontakery_test \
TEST_APP_ORIGIN=http://localhost:4200 npm run test:browser
```

La prueba crea sesiones directamente en la base de pruebas, sin añadir un login ficticio a la aplicación. Comprueba dos navegadores, anonimato, límite, voto, reconexión, cierre en directo, empate, historial, logout y ancho móvil. Guarda capturas en `test_reports/`. El login real de Google requiere credenciales y una cuenta corporativa y debe validarse por separado.

## Copias de seguridad y restauración

Copia (proteger el archivo: contiene datos y sesiones):

```bash
docker compose exec -T db pg_dump -U tontakery -d tontakery -Fc > tontakery.dump
```

Restauración deliberada sobre una base existente (sustituye sus datos):

```bash
docker compose stop frontend backend
docker compose exec -T db pg_restore -U tontakery -d tontakery --clean --if-exists < tontakery.dump
docker compose up -d backend frontend
```

No ejecutar `docker compose down -v` salvo que se quiera borrar la base. Las migraciones se aplican al arranque; hacer copia antes de actualizar. La migración inicial añade tablas `tk_*` y no elimina tablas antiguas de la plantilla.

## Acceso temporal «Probar la app»

El Compose de desarrollo habilita `ENABLE_TRIAL_LOGIN=true` por defecto. Permite entrar con un correo `@vicomtech.org` sin Google ni verificación del propietario: solo para pruebas. Las identidades llevan el prefijo interno `trial:` y no se vinculan a cuentas verificadas de Google.

Para probar desde la red local, abre `http://192.168.150.109:4200`. `DEV_ALLOWED_ORIGINS` admite ese origen por defecto. Si cambia la IP, configura en el `.env` raíz la lista exacta de orígenes separados por comas; no se admiten comodines. `DEV_APP_ORIGIN` configura por separado el retorno de Google (por defecto localhost).

Para desactivar el formulario y revocar el acceso de todas las sesiones de prueba, añade `ENABLE_TRIAL_LOGIN=false` al `.env` y ejecuta:

```bash
docker compose -f docker-compose.dev.yml up -d backend
```

En producción el endpoint está deshabilitado aunque se active la variable. Los mensajes de prueba existentes no se borran automáticamente. Google sigue disponible en paralelo.
