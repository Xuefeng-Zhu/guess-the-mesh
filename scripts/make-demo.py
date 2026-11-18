#!/usr/bin/env python3
"""Edits the raw footage from scripts/record-demo.mjs into docs/demo/guess-the-mesh-demo.mp4.

  python3 scripts/make-demo.py [segment ...]   # no args = every segment, then concat
  python3 scripts/make-demo.py concat          # only concat + audio track

Times below are in host-video seconds (H). The phone video lags the host by PHONE_LAG seconds
(calibrated from scene changes in the raw clips against timeline-all.json).
Raw timings come from the run with REVEAL_MS=200000 ROUND_MS=240000 ROUND_END_MS=24000
(4x the defaults), so reveal footage sped up 4x plays at the game's real pace.
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'docs/demo/raw')
B = os.path.join(ROOT, 'docs/demo/build')
SEG = os.path.join(B, 'seg')
OUT = os.path.join(ROOT, 'docs/demo/guess-the-mesh-demo.mp4')
# Playwright's two recordings drift apart under heavy software-GL load, so the phone is synced to the
# host through wall-clock anchors: (host video time H, wall time W since host page creation), read off
# the host's on-screen events / countdown. The phone clip is a steady P = W - PHONE_W_LAG.
HOST_ANCHORS = [(8.48, 10.5), (16.0, 18.1), (115.68, 117.6), (217.5, 217.8), (290.6, 289.7),
                (316.2, 315.8), (377.5, 378.6), (424.84, 425.9)]
PHONE_W_LAG = 4.06
PHONE_FIRST = 0.04  # frame 0 of the phone clip is blank; the first real frame is the join screen
ENC = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-an']

# name: (H0, H1, speed, [(caption, t0, t1 in output seconds; t1=None -> end)], fade_in, fade_out)
DUAL = {
    '02-lobby': (0.0, 16.4, 1.0, [('lobby', 0, 9.0), ('prompt', 9.0, None)], True, False),
    '03-gen': (16.4, 116.0, 10.0, [('gen', 0, None)], False, False),
    '04-reveal': (116.0, 304.0, 4.0, [('reveal', 0, 6.5), ('guesses', 6.5, None)], False, True),
    '05-round2': (312.5, 414.0, 4.0, [('round2', 0, 6.0), ('round2b', 6.0, None)], True, True),
}
# name: (file, [(t0, t1), ...], speed, caption, tail_hold)
SINGLE = {
    '06-gallery': ('gallery.webm', [(6.5, 10.0), (14.0, 20.0)], 1.0, 'gallery', 0.0),
    '07-solo': ('solo.webm', [(3.5, 19.0), (30.0, 39.0)], 1.25, 'solo', 1.5),
}
CARDS = {'01-title': ('title', 3.0), '08-end': ('end', 4.5)}
ORDER = ['01-title', '02-lobby', '03-gen', '04-reveal', '05-round2', '06-gallery', '07-solo', '08-end']
FADE = 0.3


def run(cmd):
    print(' '.join(cmd[:6]), '...', cmd[-1], flush=True)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr)
        sys.exit(1)


def fades(dur, fin, fout):
    f = []
    if fin:
        f.append(f'fade=t=in:st=0:d={FADE}')
    if fout:
        f.append(f'fade=t=out:st={dur - FADE:.3f}:d={FADE}')
    return (',' + ','.join(f)) if f else ''


def cap_chain(start_label, caps, first_input, dur):
    parts, cur = [], start_label
    for i, (name, t0, t1) in enumerate(caps):
        t1 = dur if t1 is None else t1
        nxt = f'c{i}'
        parts.append(f'[{cur}][{first_input + i}:v]overlay=0:0:enable=\'between(t,{t0},{t1})\'[{nxt}]')
        cur = nxt
    return parts, cur


def h_of_w(w):
    a = HOST_ANCHORS
    for i in range(len(a) - 1):
        if w < a[i + 1][1] or i == len(a) - 2:
            (h0, w0), (h1, w1) = a[i], a[i + 1]
            return h0 + (w - w0) * (h1 - h0) / (w1 - w0)


def w_of_h(h):
    a = HOST_ANCHORS
    for i in range(len(a) - 1):
        if h < a[i + 1][0] or i == len(a) - 2:
            (h0, w0), (h1, w1) = a[i], a[i + 1]
            return w0 + (h - h0) * (w1 - w0) / (h1 - h0)


def h_expr(x):
    """ffmpeg expression for h_of_w(x), x being an expression for W."""
    a = HOST_ANCHORS
    segs = []
    for i in range(len(a) - 1):
        (h0, w0), (h1, w1) = a[i], a[i + 1]
        segs.append((w1, f'({h0}+(({x})-{w0})*{(h1 - h0) / (w1 - w0):.6f})'))
    expr = segs[-1][1]
    for w1, e in reversed(segs[:-1]):
        expr = f'if(lt({x},{w1}),{e},{expr})'
    return expr


def dual(name):
    h0, h1, k, caps, fin, fout = DUAL[name]
    dur = (h1 - h0) / k
    pa = max(PHONE_FIRST, w_of_h(h0) - PHONE_W_LAG)
    pb = w_of_h(h1) - PHONE_W_LAG
    t_first = max(0.0, (h_of_w(pa + PHONE_W_LAG) - h0) / k)
    cmd = ['ffmpeg', '-y', '-v', 'error',
           '-loop', '1', '-framerate', '30', '-i', f'{B}/bg.png',
           '-ss', f'{h0}', '-t', f'{h1 - h0}', '-i', f'{RAW}/host-game.webm',
           '-i', f'{RAW}/phone-game.webm',
           '-loop', '1', '-framerate', '30', '-i', f'{B}/labels.png']
    for c, _, _ in caps:
        cmd += ['-loop', '1', '-framerate', '30', '-i', f'{B}/cap-{c}.png']
    # The demo server ran with PROMPT_TIMEOUT_MS=1h so nobody got auto-prompted; hide that 3600s ring.
    hide = f"delogo=x=596:y=453:w=88:h=88:enable='between(t,{8.3 - h0},{16.4 - h0})'," if h0 < 16.4 else ''
    g = [f'[1:v]{hide}setpts=(PTS-STARTPTS)/{k},fps=30,scale=1440:810:flags=lanczos[h]',
         f"[2:v]trim=start={pa:.3f}:end={pb:.3f},setpts='(({h_expr(f'T+{PHONE_W_LAG}')}-{h0})/{k}-{t_first:.3f})/TB',"
         f'fps=30,tpad=start_duration={t_first:.3f}:start_mode=clone[p]',
         '[0:v][h]overlay=40:50:eof_action=repeat[a]',
         '[a][p]overlay=1490:30:eof_action=repeat[b]',
         '[b][3:v]overlay=0:0[l]']
    parts, last = cap_chain('l', caps, 4, dur)
    g += parts
    g.append(f'[{last}]format=yuv420p{fades(dur, fin, fout)}[out]')
    cmd += ['-filter_complex', ';'.join(g), '-map', '[out]', '-t', f'{dur:.3f}'] + ENC + [f'{SEG}/{name}.mp4']
    run(cmd)


def single(name):
    f, pieces, k, cap, hold = SINGLE[name]
    dur = sum(b - a for a, b in pieces) / k + hold
    cmd = ['ffmpeg', '-y', '-v', 'error', '-loop', '1', '-framerate', '30', '-i', f'{B}/bg.png',
           '-i', f'{RAW}/{f}', '-loop', '1', '-framerate', '30', '-i', f'{B}/cap-{cap}.png']
    n = len(pieces)
    g = [f'[1:v]split={n}' + ''.join(f'[s{i}]' for i in range(n))]
    for i, (a, b) in enumerate(pieces):
        g.append(f'[s{i}]trim={a}:{b},setpts=PTS-STARTPTS,fps=30[t{i}]')
    g.append(''.join(f'[t{i}]' for i in range(n)) + f'concat=n={n}:v=1:a=0,setpts=PTS/{k},fps=30,'
             f'tpad=stop_mode=clone:stop_duration={hold},scale=1600:900:flags=lanczos[v]')
    g.append('[0:v][v]overlay=160:22:eof_action=repeat[a]')
    g.append(f"[a][2:v]overlay=0:0[c]")
    g.append(f'[c]format=yuv420p{fades(dur, True, True)}[out]')
    cmd += ['-filter_complex', ';'.join(g), '-map', '[out]', '-t', f'{dur:.3f}'] + ENC + [f'{SEG}/{name}.mp4']
    run(cmd)


def card(name):
    img, dur = CARDS[name]
    cmd = ['ffmpeg', '-y', '-v', 'error', '-loop', '1', '-framerate', '30', '-i', f'{B}/{img}.png',
           '-vf', f'format=yuv420p{fades(dur, True, True)}', '-t', f'{dur}'] + ENC + [f'{SEG}/{name}.mp4']
    run(cmd)


def concat():
    lst = os.path.join(SEG, 'list.txt')
    with open(lst, 'w') as fh:
        for n in ORDER:
            fh.write(f"file '{SEG}/{n}.mp4'\n")
    tmp = os.path.join(SEG, 'concat.mp4')
    run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', tmp])
    # silent stereo track so every player/uploader is happy
    run(['ffmpeg', '-y', '-v', 'error', '-i', tmp, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
         '-shortest', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', OUT])


if __name__ == '__main__':
    os.makedirs(SEG, exist_ok=True)
    want = sys.argv[1:] or ORDER + ['concat']
    for n in want:
        if n == 'concat':
            concat()
        elif n in DUAL:
            dual(n)
        elif n in SINGLE:
            single(n)
        elif n in CARDS:
            card(n)
        else:
            sys.exit(f'unknown segment {n}')
    print('done', want)
