# subirdocs · Expediente del acta constitutiva de MSTRPLN

Portal privado en `consejo.gusgomez.design` para que los 6 miembros del consejo suban sus documentos personales. Solo el administrador puede ver, descargar (ZIP organizado por carpetas) y borrar los archivos.

## Cómo funciona

- **Cloudflare Worker** (`src/worker.js`) sirve la página y la API.
- **R2** (bucket privado `mstrpln-acta-docs`) guarda los archivos. Nunca son públicos.
- **PIN general**: entrar, subir, reemplazar y quitar documentos.
- **PIN de admin**: además ver cada archivo, descargar el ZIP y borrar todo.
- Después de 5 PINs incorrectos, esa IP queda bloqueada 15 minutos. La sesión dura 12 horas.
- El ZIP se arma en el navegador del admin (sin costo de CPU en el servidor):

```
MSTRPLN_Acta_Constitutiva/
  00_INDICE.txt              ← qué tiene y qué falta cada socio
  01_Mario_Ivan/01_INE_frente.pdf …
  02_Cuitlahuac/…
```

## Editar socios o documentos

Todo está en `src/config.js`. Al hacer commit en `main`, Cloudflare vuelve a desplegar solo.

## Despliegue en Cloudflare (una sola vez)

1. **R2** → crear bucket `mstrpln-acta-docs` (ubicación automática, sin acceso público).
2. **Workers & Pages → Create → Import a repository** → `guzhell/subirdocs`. Deploy command: `npx wrangler deploy` (viene por defecto).
3. En el Worker `subirdocs` → **Settings → Variables and Secrets**, agregar como tipo *Secret*:
   - `PIN_GENERAL` — el PIN para el consejo
   - `PIN_ADMIN` — tu PIN de admin (distinto al general)
   - `SESSION_SECRET` — cadena aleatoria larga (30+ caracteres)
4. **Settings → Domains & Routes → Add → Custom domain** → `consejo.gusgomez.design`.

## Desarrollo local (opcional)

```
npm install
printf 'PIN_GENERAL=1111\nPIN_ADMIN=9999\nSESSION_SECRET=dev\n' > .dev.vars
npx wrangler dev
```
