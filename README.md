# Seguimiento Hogar AC

**Hogares | Musicala** — PWA offline para que no pase el tiempo sin hacer los arreglos
chiquitos y las mejoras de cada lugar donde nos movemos.

App: https://alekcaballero20.github.io/seguimientohogarac/

## De qué se trata

No es una app de gastos ni una lista de tareas más. El enemigo es **que pase el tiempo**:
esas cosas pequeñas que no son urgentes, nunca vencen y por eso llevan meses ahí.
Cada lugar (Musicala, nuestro espacio, Casa Alek, Casa Cata) tiene cosas por
**arreglar, comprar, reponer o mejorar**, y la idea es verlas antes de que se vuelvan invisibles.

## Cómo evita que las cosas se queden ahí

- **Antigüedad visible.** Cada tarea muestra cuánto lleva esperando (`⏳ Lleva 8 meses`),
  y el color se intensifica al mes, a los 3 y a los 6.
- **Lo estancado sube, no se hunde.** El orden "Inteligente" mezcla vencimiento, prioridad
  y tiempo esperando, así que un upgrade viejo de prioridad baja ya no queda sepultado
  al fondo de la lista.
- **Lo roto pesa más.** Una reparación pendiente acumula presión 1.5× más rápido, porque
  seguir roto es peor que seguir sin mejorar.
- **Panel de Foco.** Propone una sola cosa por lugar (o las más urgentes del lugar filtrado),
  porque una lista de 40 pendientes paraliza.
- **Filtro y orden por estancamiento**, contador de estancadas y ranking de lo que lleva
  más tiempo esperando.
- **Recurrentes** que se regeneran solas al marcar "Hecho" (papel, arena, bombillos...).

## Técnico

Sin dependencias ni build: HTML + CSS + JS vanilla. Los datos viven en `localStorage`
de cada dispositivo (`hogares_pwa_v1`), con export/import JSON y export CSV para respaldos.
Funciona offline vía service worker.

Al cambiar `app.js`, `styles.css` o `index.html`, subir `VERSION` en `sw.js` para que
el cambio llegue a los dispositivos que ya tienen la app instalada.

### Correr en local

```bash
python -m http.server 5173
```

Y abrir http://localhost:5173 (hace falta servirlo por HTTP: el service worker no
funciona abriendo el archivo directamente).
