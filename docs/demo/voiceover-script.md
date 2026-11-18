# Guess the Mesh — demo voiceover script

Narration for `docs/demo/guess-the-mesh-demo.mp4` (2:16.8). Voice: Mistral Voxtral TTS, model `voxtral-mini-tts-3`, preset voice **Paul – Cheerful** (`en_paul_cheerful`), no speed change. Mixed to −16 LUFS, no music bed. Regenerate with `python3 scripts/make-voiceover.py` (clips in `docs/demo/vo/`, timings in `docs/demo/vo/timings.json`).

| # | Clip | Starts | Ends | Text |
|---|---|---|---|---|
| 01 | Title card | 0:00.3 | 0:02.1 | This is Guess the Mesh! |
| 02 | Lobby + secret prompt | 0:03.3 | 0:17.6 | 3D Pictionary, where the AI sculpts and everyone guesses. Open a room on the big screen, scan the QR code, and join from your phone. Dana secretly types "a raccoon DJ with headphones" and picks Cartoon style. |
| 03 | Lux3D sculpting (10x) | 0:19.7 | 0:28.2 | Now Aholo Lux3D text-to-3D, on G1-Turbo, sculpts a real GLB model from that phone prompt. Sped up ten times. |
| 04a | Reveal + guesses (4x) | 0:29.8 | 0:47.9 | Then the reveal turns generation into gameplay: voxels first, then clay, then full color, sped up four times. Everyone races to guess on their phone, and hot-and-cold feedback flags the near misses. "A cat with headphones"? Close! "A teddy bear"? Cold. Every guess pops up live on the big screen. |
| 04b | Correct guesses | 0:54.2 | 1:02.6 | Fay guesses "a raccoon DJ". Correct! Then Eli nails it exactly. Faster guesses score more points. |
| 04c | Colour + full reveal | 1:06.8 | 1:12.9 | Here comes the color, and the full reveal! Dana scores too, because her prompt got solved. |
| 05 | Round 2 (pipelined) | 1:16.7 | 1:37.0 | Round two starts instantly. With prompt-ahead pipelining, Fay queued her prompt during round one, so Lux3D sculpted it in the background, hiding the hundred-second wait. Now Dana guesses from her phone. "A toaster with arms"? Cold. "A robot"? Close. "Robot chef"? Nailed it, plus 395! |
| 06 | Gallery | 1:42.0 | 1:48.8 | The gallery keeps every model, every wrong guess, and a GLB download, so you can take your mesh anywhere. |
| 07 | Daily Mesh solo | 1:51.5 | 2:05.3 | Playing alone? Daily Mesh is a solo mode with twelve pre-generated, real Lux3D models, like a penguin on a skateboard and a mushroom house, with a shareable emoji score. And every sped-up part of this demo is labeled on screen. |
| 08 | End card | 2:11.0 | 2:16.4 | Guess the Mesh — built with Aholo Lux3D. #Manycorehackathon |

About 256 words. The TTS input spells a few words phonetically ("Lux 3D", "G-L-B", "hashtag Manycore hackathon"); see `CLIPS` in the script.
