#!/usr/bin/env python3
"""SF2 から、必要なプリセットだけを残した小さな SF2 を作る。
   使い方: sf2trim.py 入力.sf2 出力.sf2 バンク:番号[:keys=36,38,...] ...
   ・残さないサンプルは、長さ0にする（サンプルの番号は変えない）
   ・プリセットの一覧は、指定したものだけにする（ESP32 のメモリを節約するため）
"""
import struct, sys

src = open(sys.argv[1], 'rb').read()
want = []
for a in sys.argv[3:]:
    p = a.split(':'); keys = None
    for x in p[2:]:
        if x.startswith('keys='): keys = set(int(k) for k in x[5:].split(','))
    want.append((int(p[0]), int(p[1]), keys))

def chunks(buf, off, end):
    while off + 8 <= end:
        cid = buf[off:off+4]; sz = struct.unpack_from('<I', buf, off+4)[0]
        yield cid, off + 8, sz
        off += 8 + sz + (sz & 1)

info = None; smpl = None; pd = {}
for cid, off, sz in chunks(src, 12, len(src)):
    if cid != b'LIST': continue
    typ = src[off:off+4]
    if typ == b'INFO': info = src[off-8:off+sz+(sz & 1)]
    elif typ == b'sdta':
        for c2, o2, s2 in chunks(src, off+4, off+sz):
            if c2 == b'smpl': smpl = src[o2:o2+s2]
    elif typ == b'pdta':
        for c2, o2, s2 in chunks(src, off+4, off+sz): pd[c2] = src[o2:o2+s2]

def recs(name, size):
    d = pd[name]; return [d[i*size:(i+1)*size] for i in range(len(d) // size)]
phdr = recs(b'phdr', 38); pbag = recs(b'pbag', 4); pmod = recs(b'pmod', 10); pgen = recs(b'pgen', 4)
inst = recs(b'inst', 22); ibag = recs(b'ibag', 4); imod = recs(b'imod', 10); igen = recs(b'igen', 4); shdr = recs(b'shdr', 46)
u16 = lambda b, o=0: struct.unpack_from('<H', b, o)[0]

def zone_gens(bags, gens, z):      # z 番目のゾーンのジェネレーター（oper, 2バイト）
    return [(u16(gens[g]), gens[g][2:4]) for g in range(u16(bags[z]), u16(bags[z+1]))]
def keyrange(gl):
    for o, v in gl:
        if o == 43: return (v[0], v[1])
    return (0, 127)
def intersects(r, keys): return keys is None or any(r[0] <= k <= r[1] for k in keys)

new_phdr, new_pbag, new_pgen, new_pmod = [], [], [], []
need = set()
for pi in range(len(phdr) - 1):
    bank = u16(phdr[pi], 22); prog = u16(phdr[pi], 20)
    sel = [w for w in want if w[0] == bank and w[1] == prog]
    if not sel: continue
    keys = sel[0][2]
    rec = bytearray(phdr[pi]); struct.pack_into('<H', rec, 24, len(new_pbag)); new_phdr.append(bytes(rec))
    for z in range(u16(phdr[pi], 24), u16(phdr[pi+1], 24)):
        gl = zone_gens(pbag, pgen, z)
        inst_ids = [struct.unpack('<H', v)[0] for o, v in gl if o == 41]
        pk = keyrange(gl)
        if inst_ids and not intersects(pk, keys): continue      # 使わない音のゾーンは捨てる
        # このゾーンが使うサンプルを集める
        for ii in inst_ids:
            for iz in range(u16(inst[ii], 20), u16(inst[ii+1], 20)):
                igl = zone_gens(ibag, igen, iz)
                sid = [struct.unpack('<H', v)[0] for o, v in igl if o == 53]
                ik = keyrange(igl)
                if sid and (keys is None or any(max(pk[0], ik[0]) <= k <= min(pk[1], ik[1]) for k in keys)):
                    need.add(sid[0])
        new_pbag.append(struct.pack('<HH', len(new_pgen), len(new_pmod)))
        g0, g1 = u16(pbag[z]), u16(pbag[z+1]); m0, m1 = u16(pbag[z], 2), u16(pbag[z+1], 2)
        new_pgen += pgen[g0:g1]; new_pmod += pmod[m0:m1]
eop = bytearray(phdr[-1]); struct.pack_into('<H', eop, 24, len(new_pbag)); new_phdr.append(bytes(eop))
new_pbag.append(struct.pack('<HH', len(new_pgen), len(new_pmod)))
new_pgen.append(b'\0\0\0\0'); new_pmod.append(b'\0' * 10)

# サンプルを詰め直す
out_smpl = bytearray(); new_shdr = []
for sid, h in enumerate(shdr):
    h = bytearray(h)
    if sid in need and sid < len(shdr) - 1:
        st, en, sl, el = struct.unpack_from('<IIII', h, 20)
        base = len(out_smpl) // 2
        out_smpl += smpl[st*2:en*2] + b'\0' * 92      # 後ろに 46 サンプルの無音
        struct.pack_into('<IIII', h, 20, base, base + (en - st), base + (sl - st), base + (el - st))
    elif sid < len(shdr) - 1:
        struct.pack_into('<IIII', h, 20, 0, 0, 0, 0)
    new_shdr.append(bytes(h))

def ck(cid, data):
    return cid + struct.pack('<I', len(data)) + data + (b'\0' if len(data) & 1 else b'')
pdta = b'pdta' + ck(b'phdr', b''.join(new_phdr)) + ck(b'pbag', b''.join(new_pbag)) + ck(b'pmod', b''.join(new_pmod)) \
       + ck(b'pgen', b''.join(new_pgen)) + ck(b'inst', b''.join(inst)) + ck(b'ibag', b''.join(ibag)) \
       + ck(b'imod', b''.join(imod)) + ck(b'igen', b''.join(igen)) + ck(b'shdr', b''.join(new_shdr))
sdta = b'sdta' + ck(b'smpl', bytes(out_smpl))
body = b'sfbk' + info + ck(b'LIST', sdta) + ck(b'LIST', pdta)
open(sys.argv[2], 'wb').write(b'RIFF' + struct.pack('<I', len(body)) + body)
print('プリセット %d 個・使うサンプル %d 個・サンプル %.2f MB → 出力 %.2f MB' % (len(new_phdr) - 1, len(need), len(out_smpl) / 1e6, (len(body) + 8) / 1e6))
