#!/usr/bin/env python3
"""Adds an English voiceover to docs/demo/guess-the-mesh-demo.mp4.

  python3 scripts/make-voiceover.py            # TTS (cached per clip) + mix + mux
  python3 scripts/make-voiceover.py --regen    # force new TTS for every clip
  python3 scripts/make-voiceover.py --mix      # only mix + mux from existing clips

TTS: Mistral Voxtral TTS (model voxtral-mini-tts-3, preset voice "Paul - Cheerful") via
POST https://api.mistral.ai/v1/audio/speech with MISTRAL_API_KEY. (Gemini TTS was tried first but
the sandbox's Google key was rejected.) One clip per segment, placed at its segment start with
adelay, so the narration stays in sync with the edit in scripts/make-demo.py.

The silent original is kept as docs/demo/guess-the-mesh-demo-silent.mp4 and is always the video
source, so this script can be re-run. The video stream is copied, never re-encoded.
After re-running scripts/make-demo.py (which writes a new silent guess-the-mesh-demo.mp4), delete
the -silent.mp4 first so this script picks up the new cut.
"""
import base64
import shutil
import tempfile
import json
import os
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEMO = os.path.join(ROOT, 'docs/demo')
VO = os.path.join(DEMO, 'vo')
SILENT = os.path.join(DEMO, 'guess-the-mesh-demo-silent.mp4')
OUT = os.path.join(DEMO, 'guess-the-mesh-demo.mp4')
TMP_OUT = os.path.join(tempfile.gettempdir(), 'guess-the-mesh-demo-vo.mp4')
MODEL = 'voxtral-mini-tts-3'
VOICE = 'en_paul_cheerful'
MAX_TEMPO = 1.1
LUFS = -16

# Segment boundaries in output seconds, from scripts/make-demo.py (title 3.0, lobby 16.4, gen 9.96,
# reveal 47.0, round2 25.375, gallery 9.5, solo 21.1, end 4.5 = 136.83 s).
# (id, start, segment_end, text shown in the script, text sent to TTS)
# Clips start slightly after the cut; 'end' may start a little before its card (after the solo clip ends).
CLIPS = [
    ('01-title', 0.35, 3.0,
     'This is Guess the Mesh!',
     'This is Guess the Mesh!'),
    ('02-lobby', 3.3, 19.4,
     '3D Pictionary, where the AI sculpts and everyone guesses. Open a room on the big screen, '
     'scan the QR code, and join from your phone. Dana secretly types "a raccoon DJ with headphones" '
     'and picks Cartoon style.',
     '3D Pictionary, where the AI sculpts, and everyone guesses. Open a room on the big screen, '
     'scan the QR code, and join from your phone. Dana secretly types: a raccoon DJ with headphones, '
     'and picks Cartoon style.'),
    ('03-gen', 19.7, 29.36,
     'Now Aholo Lux3D text-to-3D, on G1-Turbo, sculpts a real GLB model from that phone prompt. '
     'Sped up ten times.',
     'Now Aholo Lux 3D text-to-3D, on G1 Turbo, sculpts a real G-L-B model from that phone prompt. '
     'Sped up ten times.'),
    ('04a-reveal', 29.8, 76.36,
     'Then the reveal turns generation into gameplay: voxels first, then clay, then full color, sped up '
     'four times. Everyone races to guess on their phone, and hot-and-cold feedback flags the near '
     'misses. "A cat with headphones"? Close! "A teddy bear"? Cold. Every guess pops up live on the big screen.',
     'Then the reveal turns generation into gameplay: voxels first, then clay, then full color, sped up '
     'four times. Everyone races to guess on their phone, and hot and cold feedback flags the near '
     'misses. A cat with headphones? Close! A teddy bear? Cold. Every guess pops up live on the big screen.'),
    ('04b-correct', 54.2, 76.36,
     'Fay guesses "a raccoon DJ". Correct! Then Eli nails it exactly. Faster guesses score more points.',
     'Then Fay guesses: a raccoon DJ. Correct! Then Eli nails it exactly. Faster guesses score more points.'),
    ('04c-color', 66.8, 76.36,
     'Here comes the color, and the full reveal! Dana scores too, because her prompt got solved.',
     'Here comes the color, and the full reveal! Dana scores too, because her prompt got solved.'),
    ('05-round2', 76.7, 101.74,
     'Round two starts instantly. With prompt-ahead pipelining, Fay queued her prompt during round '
     'one, so Lux3D sculpted it in the background, hiding the hundred-second wait. Now Dana guesses '
     'from her phone. "A toaster with arms"? Cold. "A robot"? Close. "Robot chef"? Nailed it, '
     'plus 395!',
     'Round two starts instantly. With prompt-ahead pipelining, Fay queued her prompt during round '
     'one, so Lux 3D sculpted it in the background, hiding the hundred-second wait. Now Dana guesses '
     'from her phone. A toaster with arms? Cold. A robot? Close. Robot chef? Nailed it! '
     'Plus three ninety-five!'),
    ('06-gallery', 102.0, 111.24,
     'The gallery keeps every model, every wrong guess, and a GLB download, so you can take your mesh anywhere.',
     'The gallery keeps every model, every wrong guess, and a G-L-B download, so you can take your mesh anywhere.'),
    ('07-solo', 111.5, 132.34,
     'Playing alone? Daily Mesh is a solo mode with twelve pre-generated, real Lux3D models, like a penguin '
     'on a skateboard and a mushroom house, with a shareable emoji score. And every sped-up part of this '
     'demo is labeled on screen.',
     'Playing alone? Daily Mesh is a solo mode with twelve pre-generated, real Lux 3D models, like a penguin '
     'on a skateboard, and a mushroom house, with a shareable emoji score. And every sped-up part of this '
     'demo is labeled on screen.'),
    ('08-end', 131.0, 136.83,
     'Guess the Mesh — built with Aholo Lux3D. #Manycorehackathon',
     'Guess the Mesh. Built with Aholo Lux 3D. Hashtag Manycore hackathon!'),
]


def sh(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr)
        sys.exit(1)
    return r.stdout + r.stderr


def dur(path):
    return float(sh(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).strip())


def tts(text, mp3):
    body = json.dumps({'model': MODEL, 'input': text, 'voice': VOICE}).encode()
    req = urllib.request.Request('https://api.mistral.ai/v1/audio/speech', data=body, headers={
        'Authorization': 'Bearer ' + os.environ['MISTRAL_API_KEY'], 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.load(r)
    with open(mp3, 'wb') as f:
        f.write(base64.b64decode(data['audio_data']))


def clip_wav(cid, text, regen):
    """TTS -> mp3 (cached), then trimmed 48 kHz mono wav."""
    mp3 = os.path.join(VO, f'{cid}.mp3')
    wav = os.path.join(VO, f'{cid}.wav')
    if regen or not os.path.exists(mp3):
        print('tts', cid, flush=True)
        tts(text, mp3)
    # trim leading/trailing silence so placement is exact
    trim = ('silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,'
            'areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse')
    sh(['ffmpeg', '-y', '-v', 'error', '-i', mp3, '-af', trim, '-ar', '48000', '-ac', '1', wav])
    return wav


def main():
    regen = '--regen' in sys.argv
    mix_only = '--mix' in sys.argv
    os.makedirs(VO, exist_ok=True)
    if not os.path.exists(SILENT):
        os.rename(OUT, SILENT)
    vdur = dur(SILENT)

    placed, log = [], []
    for i, (cid, start, seg_end, _shown, spoken) in enumerate(CLIPS):
        wav = os.path.join(VO, f'{cid}.wav') if mix_only else clip_wav(cid, spoken, regen)
        d = dur(wav)
        nxt = CLIPS[i + 1][1] if i + 1 < len(CLIPS) else vdur - 0.15
        limit = min(seg_end, nxt) - start if i + 1 < len(CLIPS) else nxt - start
        tempo = 1.0
        if d > limit:
            tempo = d / limit
            if tempo > MAX_TEMPO:
                print(f'!! {cid}: {d:.2f}s does not fit {limit:.2f}s (needs atempo {tempo:.2f}); shorten text')
                sys.exit(2)
        placed.append((wav, start, tempo))
        log.append((cid, start, start + d / tempo, seg_end, tempo))

    print('\nclip        start    end    seg_end  gap_to_next  tempo')
    for i, (cid, s, e, se, t) in enumerate(log):
        nxt = log[i + 1][1] if i + 1 < len(log) else vdur
        print(f'{cid:10s} {s:7.2f} {e:7.2f} {se:8.2f} {nxt - e:9.2f}   {t:.3f}')
        assert e <= nxt, f'{cid} overlaps next clip'
    with open(os.path.join(VO, 'timings.json'), 'w') as f:
        json.dump([{'clip': c, 'start': round(s, 2), 'end': round(e, 2), 'segment_end': se, 'atempo': round(t, 3)}
                   for c, s, e, se, t in log], f, indent=2)

    # mix: delay each clip to its start, sum, pad to video length, loudness-normalize (2-pass loudnorm)
    inputs, g = [], []
    for i, (wav, start, tempo) in enumerate(placed):
        inputs += ['-i', wav]
        tf = f'atempo={tempo:.4f},' if tempo > 1.0001 else ''
        ms = int(round(start * 1000))
        g.append(f'[{i}:a]{tf}adelay={ms}|{ms}[a{i}]')
    n = len(placed)
    g.append(''.join(f'[a{i}]' for i in range(n)) + f'amix=inputs={n}:normalize=0:dropout_transition=0,'
             f'apad=whole_dur={vdur:.3f}[mix]')
    raw = os.path.join(VO, 'narration-raw.wav')
    sh(['ffmpeg', '-y', '-v', 'error'] + inputs + ['-filter_complex', ';'.join(g), '-map', '[mix]',
       '-t', f'{vdur:.3f}', '-ar', '48000', '-ac', '1', raw])
    m = sh(['ffmpeg', '-hide_banner', '-i', raw, '-af', f'loudnorm=I={LUFS}:TP=-1.5:LRA=11:print_format=json',
            '-f', 'null', '-'])
    st = json.loads(m[m.rindex('{'):m.rindex('}') + 1])
    ln = (f'loudnorm=I={LUFS}:TP=-1.5:LRA=11:measured_I={st["input_i"]}:measured_TP={st["input_tp"]}:'
          f'measured_LRA={st["input_lra"]}:measured_thresh={st["input_thresh"]}:offset={st["target_offset"]}:linear=true')
    final = os.path.join(tempfile.gettempdir(), 'guess-the-mesh-narration.wav')
    sh(['ffmpeg', '-y', '-v', 'error', '-i', raw, '-af', ln, '-ar', '48000', '-ac', '2', final])

    sh(['ffmpeg', '-y', '-v', 'error', '-i', SILENT, '-i', final, '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-t', f'{vdur:.3f}',
        '-movflags', '+faststart', TMP_OUT])
    shutil.move(TMP_OUT, OUT)  # +faststart rewrites in place, which fails on some mounted filesystems
    os.remove(raw)
    print(f'\nvideo {vdur:.3f}s -> {OUT} ({dur(OUT):.3f}s)')


if __name__ == '__main__':
    main()
