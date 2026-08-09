"""Genera el set de iconos de la PWA desde la ilustración original.

El original es un JPEG 800x800 que ya trae su propio azulejo redondeado con
margen blanco. Aquí se recorta ese margen y se generan dos familias:

  - "any"      -> el azulejo con esquinas transparentes (el navegador no recorta)
  - "maskable" -> fondo a sangre completa y el contenido dentro del 80% central,
                  para que Android pueda recortarlo en círculo sin comerse nada
"""

from PIL import Image, ImageDraw, ImageFilter
import os

SRC = "icons/original-ilustracion.jpg"  # el original respaldado
OUT = "icons"
TILE = (48, 48, 752, 752)           # el azulejo, sin el margen blanco
SS = 4                              # supersampling para bordes suaves


def load_tile():
    im = Image.open(SRC).convert("RGB").crop(TILE)
    # Un pelo más adentro: quita el borde difuso y el redondeo propio del dibujo,
    # porque abajo se aplica un redondeo nuevo y limpio.
    inset = int(im.width * 0.035)
    return im.crop((inset, inset, im.width - inset, im.height - inset))


def rounded_mask(size, radius_ratio=0.22):
    big = size * SS
    m = Image.new("L", (big, big), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, big - 1, big - 1],
                        radius=int(big * radius_ratio), fill=255)
    return m.resize((size, size), Image.LANCZOS)


def cover(im, size):
    """Escala y recorta al centro para llenar un cuadrado de `size`."""
    scale = size / min(im.size)
    w, h = max(size, round(im.width * scale)), max(size, round(im.height * scale))
    r = im.resize((w, h), Image.LANCZOS)
    left, top = (w - size) // 2, (h - size) // 2
    return r.crop((left, top, left + size, top + size))


def make_any(tile, size):
    """Icono normal: el azulejo con esquinas transparentes."""
    art = cover(tile, size).convert("RGBA")
    art.putalpha(rounded_mask(size))
    return art


def make_maskable(tile, size):
    """Icono maskable: la casa dentro del 80% central y la acuarela a sangre.

    El borde se rellena replicando el píxel del contorno hacia afuera y
    difuminando solo ese anillo. Así el color del halo sale del propio dibujo
    (empalma sin costura) y no puede aparecer ninguna forma duplicada, que es
    lo que pasaba al reflejar: se colaban copias de la maleza y del check.
    """
    import numpy as np

    inner = int(size * 0.80)
    art = cover(tile, inner).convert("RGB")

    pad_l = (size - inner) // 2
    pad_r = size - inner - pad_l
    a = np.asarray(art)
    halo = Image.fromarray(
        np.pad(a, ((pad_l, pad_r), (pad_l, pad_r), (0, 0)), mode="edge")
    ).filter(ImageFilter.GaussianBlur(size * 0.05))

    # El dibujo entra con el borde desvanecido: si se pega a filo, la textura
    # granulada contra el halo liso deja una costura cuadrada visible.
    feather = max(2, int(inner * 0.05))
    m = Image.new("L", art.size, 0)
    ImageDraw.Draw(m).rectangle(
        [feather, feather, inner - 1 - feather, inner - 1 - feather], fill=255
    )
    m = m.filter(ImageFilter.GaussianBlur(feather * 0.7))

    out = halo.copy()
    out.paste(art, (pad_l, pad_l), m)
    return out.convert("RGBA")


def make_opaque(tile, size, inset_ratio=0.0):
    """Para iOS: sin transparencia, a sangre completa (iOS pone su propia máscara)."""
    if inset_ratio <= 0:
        return cover(tile, size).convert("RGB")
    inner = int(size * (1 - inset_ratio * 2))
    bg = cover(tile, size).filter(ImageFilter.GaussianBlur(size * 0.06)).convert("RGB")
    art = cover(tile, inner)
    bg.paste(art, ((size - inner) // 2, (size - inner) // 2))
    return bg


def quantize(im, colors=128):
    """La textura de acuarela es carísima en PNG. A 128 colores el resultado es
    indistinguible al tamaño en que se ve (48-192 px) y pesa la mitad."""
    if im.mode == "RGBA":
        alpha = im.getchannel("A")
        q = im.convert("RGB").quantize(
            colors=colors,
            method=Image.Quantize.MEDIANCUT,
            dither=Image.Dither.FLOYDSTEINBERG,
        ).convert("RGBA")
        q.putalpha(alpha)
        return q
    return im.quantize(
        colors=colors,
        method=Image.Quantize.MEDIANCUT,
        dither=Image.Dither.FLOYDSTEINBERG,
    )


def save(im, name, colors=128):
    path = os.path.join(OUT, name)
    quantize(im, colors).save(path, "PNG", optimize=True)
    print(f"  {name:28} {im.size[0]}x{im.size[1]}  {os.path.getsize(path):>7,} bytes")


if __name__ == "__main__":
    tile = load_tile()
    print(f"azulejo recortado: {tile.size}")

    print("any (esquinas transparentes):")
    for s in (192, 512):
        save(make_any(tile, s), f"icon-{s}.png")

    print("maskable (fondo a sangre, zona segura 80%):")
    for s in (192, 512):
        save(make_maskable(tile, s), f"icon-maskable-{s}.png")

    print("iOS y favicon:")
    save(make_opaque(tile, 180), "apple-touch-icon.png")
    save(make_any(tile, 32), "favicon-32.png")
