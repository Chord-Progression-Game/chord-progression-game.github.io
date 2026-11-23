# SF2（サウンドフォント）の中身を読んで、「指定したプリセットだけで使うサンプルの合計サイズ」を計算する
import struct, sys
data = open(sys.argv[1], 'rb').read()
def chunks(buf, off, end):
    while off + 8 <= end:
        cid = buf[off:off+4]; sz = struct.unpack_from('<I', buf, off+4)[0]
        yield cid, off + 8, sz
        off += 8 + sz + (sz & 1)
pdta = {}; smpl = None
for cid, off, sz in chunks(data, 12, len(data)):
    if cid == b'LIST':
        typ = data[off:off+4]
        if typ == b'pdta':
            for c2, o2, s2 in chunks(data, off+4, off+sz): pdta[c2] = (o2, s2)
        elif typ == b'sdta':
            for c2, o2, s2 in chunks(data, off+4, off+sz):
                if c2 == b'smpl': smpl = (o2, s2)
def recs(name, size):
    o, s = pdta[name]; return [struct.unpack_from('<' + 'x'*0, data, 0) and None for _ in []] or [(o + i*size) for i in range(s // size)]
phdr = recs(b'phdr', 38); pbag = recs(b'pbag', 4); pgen = recs(b'pgen', 4)
inst = recs(b'inst', 22); ibag = recs(b'ibag', 4); igen = recs(b'igen', 4); shdr = recs(b'shdr', 46)
def u16(o): return struct.unpack_from('<H', data, o)[0]
def s16(o): return struct.unpack_from('<h', data, o)[0]
def name(o, n=20): return data[o:o+n].split(b'\0')[0].decode('latin1')
# ジェネレーター番号: 41 = instrument, 53 = sampleID
def gens(start_bag, end_bag, bags, gen_list):
    out = []
    for b in range(start_bag, end_bag):
        g0 = u16(bags[b]); g1 = u16(bags[b+1])
        out.append([(u16(gen_list[g]), data[gen_list[g]+2:gen_list[g]+4]) for g in range(g0, g1)])
    return out
def preset_samples(pi):
    p = phdr[pi]; b0 = u16(p + 24); b1 = u16(phdr[pi+1] + 24)
    insts = set()
    for zone in gens(b0, b1, pbag, pgen):
        for g, v in zone:
            if g == 41: insts.add(struct.unpack('<H', v)[0])
    samples = set()
    for ii in insts:
        i0 = u16(inst[ii] + 20); i1 = u16(inst[ii+1] + 20)
        for zone in gens(i0, i1, ibag, igen):
            for g, v in zone:
                if g == 53: samples.add(struct.unpack('<H', v)[0])
    return insts, samples
def sample_bytes(samples):
    tot = 0; rates = {}
    for s in samples:
        o = shdr[s]; st = struct.unpack_from('<I', data, o+20)[0]; en = struct.unpack_from('<I', data, o+24)[0]
        rate = struct.unpack_from('<I', data, o+36)[0]
        tot += (en - st) * 2; rates[rate] = rates.get(rate, 0) + 1
    return tot, rates
want = [(int(a.split(':')[0]), int(a.split(':')[1])) for a in sys.argv[2:]]
allsamples = set(); 
for pi in range(len(phdr) - 1):
    bank = u16(phdr[pi] + 22); prog = u16(phdr[pi] + 20)
    if (bank, prog) in want:
        insts, samples = preset_samples(pi)
        tot, rates = sample_bytes(samples)
        print('%-22s bank=%3d prog=%3d  インストゥルメント %2d・サンプル %3d 個・合計 %.2f MB（16bit換算）  サンプル周波数: %s' % (name(phdr[pi]), bank, prog, len(insts), len(samples), tot/1e6, dict(sorted(rates.items()))))
        allsamples |= samples
tot, rates = sample_bytes(allsamples)
print('合計（重複を除く）: %d 個・%.2f MB' % (len(allsamples), tot/1e6))
print('参考: SF2全体のサンプル = %.1f MB' % (smpl[1]/1e6))

# ---- 追加: 指定したキー（ドラムの音）だけで使うサンプル ----
def keyrange(zone):
    for g, v in zone:
        if g == 43: return (v[0], v[1])
    return (0, 127)
def samples_for_keys(bank, prog, keys):
    for pi in range(len(phdr) - 1):
        if u16(phdr[pi] + 22) == bank and u16(phdr[pi] + 20) == prog:
            p = phdr[pi]; b0 = u16(p + 24); b1 = u16(phdr[pi+1] + 24)
            used = {}
            for pz in gens(b0, b1, pbag, pgen):
                pk = keyrange(pz)
                ii = [struct.unpack('<H', v)[0] for g, v in pz if g == 41]
                if not ii: continue
                i0 = u16(inst[ii[0]] + 20); i1 = u16(inst[ii[0]+1] + 20)
                for iz in gens(i0, i1, ibag, igen):
                    ik = keyrange(iz)
                    sid = [struct.unpack('<H', v)[0] for g, v in iz if g == 53]
                    if not sid: continue
                    for k in keys:
                        if pk[0] <= k <= pk[1] and ik[0] <= k <= ik[1]:
                            used.setdefault(k, set()).add(sid[0])
            return used
if len(sys.argv) > 1 and 'KEYS' in __import__('os').environ:
    keys = [int(x) for x in __import__('os').environ['KEYS'].split(',')]
    used = samples_for_keys(128, 0, keys)
    allk = set()
    for k in keys:
        tot, rates = sample_bytes(used.get(k, set()))
        print('ドラムのキー %3d: サンプル %d 個・%.0f KB' % (k, len(used.get(k, [])), tot/1e3))
        allk |= used.get(k, set())
    tot, _ = sample_bytes(allk)
    print('使う8種のドラムだけの合計: %d 個・%.2f MB（16bit換算）' % (len(allk), tot/1e6))
