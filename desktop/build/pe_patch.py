#!/usr/bin/env python3
"""Замена значка в Windows .exe (Electron) без сторонних программ.

Значки Electron: 16, 32, 48 (32-битный DIB) и 256 (PNG). Новые картинки того же размера
пишутся на место старых (они не больше), размеры обновляются в таблице ресурсов.
Подпись Electron после изменения файла становится недействительной, поэтому удаляется.
Использование: pe_patch.py program.exe icon.png
"""
import io, struct, sys
from PIL import Image

def main(exe, png):
    b = bytearray(open(exe, 'rb').read())
    pe = struct.unpack_from('<I', b, 0x3c)[0]
    assert b[pe:pe + 4] == b'PE\0\0', 'не PE-файл'
    nsec = struct.unpack_from('<H', b, pe + 6)[0]; optsz = struct.unpack_from('<H', b, pe + 20)[0]
    opt = pe + 24; magic = struct.unpack_from('<H', b, opt)[0]
    dd = opt + (112 if magic == 0x20b else 96)
    rsrc_rva = struct.unpack_from('<I', b, dd + 16)[0]
    secs = []
    for i in range(nsec):
        o = opt + optsz + 40 * i
        vsz, va, rawsz, raw = struct.unpack_from('<IIII', b, o + 8)
        secs.append((va, max(vsz, rawsz), raw))
    def off(rva):
        for va, sz, raw in secs:
            if va <= rva < va + sz: return raw + rva - va
        raise ValueError(hex(rva))
    base = off(rsrc_rva)
    def entries(d):
        named, ids = struct.unpack_from('<HH', b, d + 12)
        for i in range(named + ids):
            yield struct.unpack_from('<II', b, d + 16 + 8 * i)
    res = {}
    for t, p1 in entries(base):
        if not p1 & 0x80000000: continue
        for nid, p2 in entries(base + (p1 & 0x7fffffff)):
            for lang, p3 in entries(base + (p2 & 0x7fffffff)):
                de = base + p3
                rva, size = struct.unpack_from('<II', b, de)
                res.setdefault(t, {})[nid] = {'entry': de, 'off': off(rva), 'size': size}
    src = Image.open(png).convert('RGBA')
    grp = res[14][min(res[14])]
    cnt = struct.unpack_from('<H', b, grp['off'] + 4)[0]
    for i in range(cnt):
        eo = grp['off'] + 6 + 14 * i
        w, h, _, _, planes, bits, nbytes, nid = struct.unpack_from('<BBBBHHIH', b, eo)
        w = w or 256; h = h or 256
        img = src.resize((w, h), Image.LANCZOS)
        old = res[3][nid]
        if w >= 256:
            buf = io.BytesIO(); img.save(buf, 'PNG', optimize=True); data = buf.getvalue()
        else:
            px = img.transpose(Image.FLIP_TOP_BOTTOM).tobytes('raw', 'BGRA')
            mask_row = ((w + 31) // 32) * 4
            data = struct.pack('<IiiHHIIiiII', 40, w, h * 2, 1, 32, 0, len(px) + mask_row * h, 0, 0, 0, 0) + px + b'\0' * (mask_row * h)
        if len(data) > old['size']:
            raise SystemExit(f'значок {w}px не помещается: {len(data)} > {old["size"]}')
        b[old['off']:old['off'] + old['size']] = data + b'\0' * (old['size'] - len(data))
        struct.pack_into('<I', b, old['entry'] + 4, len(data))
        struct.pack_into('<I', b, eo + 8, len(data))
        print(f'значок {w}x{h}: {len(data)} байт')
    # Удаляем недействительную после правки подпись (таблица сертификатов в конце файла).
    cert_off, cert_sz = struct.unpack_from('<II', b, dd + 8 * 4)
    if cert_off and cert_off + cert_sz <= len(b):
        del b[cert_off:]
        struct.pack_into('<II', b, dd + 8 * 4, 0, 0)
        print('подпись Electron удалена')
    open(exe, 'wb').write(b)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
