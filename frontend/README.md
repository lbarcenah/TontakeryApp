# Tontakery frontend

Angular 21 standalone, PrimeNG, Tailwind y traducciones español/inglés. Consulta el [README principal](../README.md).

- `npm ci`
- `npm start`: http://localhost:4200; proxy `/api` a localhost:3000.
- `npm run build`: aplicación de producción en `dist/datanext_frontend_angular/browser`.

El componente raíz gestiona las vistas de login, chat e historial. El estado usa signals; la sesión se obtiene del backend, nunca de un token en localStorage. EventSource recibe avisos SSE y BroadcastChannel sincroniza pestañas. No se descargan autores ajenos ni recuentos durante la jornada.
